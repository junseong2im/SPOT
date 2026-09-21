import type {Routine} from '../gym-model';
import {sameExercise,normalizeName,resolveName} from './catalog';
import {classifyIntent} from './intent';
import {resolveChoice,requireDecision,numericAnswer,DecisionReview,type Answers,type EditPlan,type Operation} from './decisions';

export function proposeEdit(routine:Routine,raw:string,answers:Answers={}):{routine:Routine;changes:string[];intent:string;plan:EditPlan}{
 const text=raw.normalize('NFKC').trim();if(!text||text.length>500)throw Error('수정 요청을 500자 안으로 적어주세요.');
 if(/하지\s*마|말아|취소|아니|않|말고.*말고|[;\n]|그리고|동시에/.test(text))throw Error('한 번에 한 가지 변경을 구체적으로 적어주세요. 예: 벤치를 3세트로 바꿔줘');
 const weekday=text.match(/[월화수목금토일]요일/);if(weekday&&!routine.name.includes(weekday[0]))throw Error('선택한 루틴과 요청한 요일이 달라요. 바꿀 루틴을 먼저 선택해주세요.');
 const classified=classifyIntent(text);
 let operation=classified.label;
 // Model output is a routing hint, never authority to mutate a routine.
 const exactRemove=/(?:빼줘|삭제|없애|제외|지워|제거)/.test(text);
 const exactReplace=/(?:대신|교체|대체|말고)/.test(text);
 const exactSets=/세트/.test(text),exactReps=/횟수|반복|\d+\s*회/.test(text);
 if(exactRemove)operation='remove';else if(exactReplace)operation='replace';else if(exactSets&&!exactReps)operation='sets';else if(exactReps&&!exactSets)operation='reps';else throw Error('세트·횟수 변경, 운동 제외, 운동 교체 중 하나를 구체적으로 적어주세요.');
 const operationLabels={sets:'세트 수 변경',reps:'반복 횟수 변경',remove:'운동 제외',replace:'운동 교체'};
 const operationOptions=[{value:operation as Operation,label:operationLabels[operation as Operation]}];
 let operationDecision=resolveChoice('어떤 변경인가요?',operationOptions,answers.operation);
 if(classified.label!==operation&&answers.operation===undefined)operationDecision={...operationDecision,status:'review',value:null,source:'local-model'};
 operation=requireDecision(operationDecision,{id:'operation',question:`${operationLabels[operation as Operation]} 요청이 맞나요?`,options:operationOptions});
 if(operation==='remove'&&!exactRemove||operation==='replace'&&!exactReplace)throw Error('수정할 내용을 확인해주세요.');
 let selector='';let replacement='';let value:number|null=null;let delta=0;
 if(operation==='replace'){
  const m=text.match(/^(.+?)(?:\s*대신(?:에)?\s*|(?:을|를)\s*|\s+말고\s+)(.+?)(?:으로|로)\s*(?:바꿔|교체|대체|변경|넣어)/);
  if(!m)throw Error('예: 벤치 대신 체스트 프레스로 교체해줘');selector=m[1];replacement=resolveName(m[2].trim()).name;
  if(!resolveName(replacement).known)throw Error('교체할 운동 이름이 불확실해요. 운동 도감의 정확한 이름으로 적어주세요.');
 }else if(operation==='remove')selector=text.replace(/(?:루틴에서\s*)?/,'').split(/빼줘|삭제|없애|제외|지워|제거/)[0];
 else{
  const unit=operation==='sets'?'세트':'회';
  const amount=text.match(new RegExp('(\\d+)\\s*'+unit));
  const absolute=amount&&new RegExp('\\d+\\s*'+unit+'(?:로|으로)').test(text);
  const relative=!absolute&&/줄여|늘려|더\s*추가|더\s*해/.test(text);
  const supplied=numericAnswer(answers.amount,1,operation==='sets'?30:100);
  if(relative){const n=supplied??(amount?Number(amount[1]):/두|둘/.test(text)?2:/하나|한\s*(세트|회)/.test(text)?1:0);if(!n)throw new DecisionReview({id:'amount',question:`몇 ${unit}를 ${/줄여/.test(text)?'줄일까요?':'늘릴까요?'}`,min:1,max:operation==='sets'?30:100});delta=/줄여/.test(text)?-n:n;}
  else if((amount||supplied!==null)&&/(?:로|으로|설정|수정|변경|맞춰|바꿔)/.test(text))value=supplied??Number(amount![1]);
  else if(/변경|수정|바꿔|설정|맞춰/.test(text))throw new DecisionReview({id:'amount',question:`몇 ${unit}로 바꿀까요?`,min:1,max:operation==='sets'?30:100});
  else throw Error(`예: 벤치를 ${operation==='sets'?'3세트':'12회'}로 바꿔줘`);
  selector=text.split(/(?:\d+\s*(?:세트|회)|세트|횟수|반복|하나|한\s*세트|두\s*세트)/)[0];
 }
 selector=selector.trim().replace(/(?:\s*운동|\s*종목)?(?:을|를|은|는)?\s*$/,'').replace(/^루틴에서\s*/,'').trim();
 const all=/^(전체|모든)(?:\s*운동)?$/.test(selector);
 const matched=routine.exercises.filter(e=>all||sameExercise(e.name,selector));
 const targetOptions=(matched.length?matched:routine.exercises).map(e=>({value:e.id,label:`${routine.exercises.findIndex(x=>x.id===e.id)+1}. ${e.name}`}));
 let targetDecision=resolveChoice('어떤 운동을 바꿀까요?',targetOptions,answers.target);
 if(!matched.length&&answers.target===undefined)targetDecision={...targetDecision,status:'review',value:null};
 const targets=all?matched:[routine.exercises.find(e=>e.id===requireDecision(targetDecision,{id:'target',question:matched.length?'같은 이름이 여러 개예요. 어느 운동인가요?':`“${selector||'대상 운동'}”을 찾지 못했어요. 바꿀 운동을 선택해주세요.`,options:targetOptions}))!];
 if(operation==='remove'&&all)throw Error('전체 운동을 한 번에 삭제할 수 없어요.');
 const next=structuredClone(routine),changes:string[]=[];
 if(operation==='remove'){
  if(next.exercises.length===targets.length)throw Error('루틴에는 운동이 한 개 이상 있어야 해요.');
  next.exercises=next.exercises.filter(e=>!targets.some(t=>t.id===e.id));changes.push(`${targets[0].name} 제외`);
 }else for(const e of next.exercises.filter(e=>targets.some(t=>t.id===e.id))){
  if(operation==='replace'){changes.push(`${e.name} → ${replacement} (세트·횟수 유지, 기존 운동 수행법 비움)`);e.name=replacement;e.prescription='';continue;}
  if(e.prescription&&(/웜업|워밍업|탑\s*세트|백\s*오프|슈퍼\s*세트|드롭|~|–|\d\s*-\s*\d/.test(e.prescription)||(e.prescription.match(/\d+\s*세트/g)?.length??0)>1))throw Error(`${e.name}은 복합 수행법이 있어요. 충돌을 피하려면 상세 편집에서 변경해주세요.`);
  const field=operation==='sets'?'sets':'reps',before=e[field],after=value??before+delta;
  if(!Number.isInteger(after)||after<1||after>(field==='sets'?30:100))throw Error('변경 후 세트는 1~30, 횟수는 1~100이어야 해요.');
  e[field]=after;changes.push(`${e.name}: ${before} → ${after}${field==='sets'?'세트':'회'}`);
  if(e.prescription){e.prescription=e.prescription.replace(/\d+\s*[x×*]\s*\d+/g,`${e.sets}×${e.reps}`).replace(new RegExp('\\d+\\s*'+(field==='sets'?'세트':'회'),'g'),`${after}${field==='sets'?'세트':'회'}`);}
 }
 if(new Set(next.exercises.map(e=>normalizeName(e.name))).size<next.exercises.length&&operation==='replace')throw Error('교체하면 같은 운동이 중복돼요. 상세 편집에서 확인해주세요.');
 const plan:EditPlan={operation:operationDecision,target:{question:'변경 대상 운동',status:'resolved',value:targets.map(t=>t.id),evidence:[selector],source:answers.target?'user':'rule'},amount:{question:'지정한 수 또는 증감량',status:'resolved',value:value??delta,evidence:[text],source:answers.amount?'user':'rule'},replacement:{question:'교체할 운동',status:'resolved',value:replacement,evidence:[replacement],source:'rule'},checks:[{id:'target_scope',passed:true,reason:'현재 선택한 루틴 안의 운동 ID만 사용'},{id:'numeric_bounds',passed:true,reason:'세트 1~30, 반복 1~100 검사'},{id:'nonempty_routine',passed:true,reason:'운동 1개 이상 유지'},{id:'preview_only',passed:true,reason:'원본과 저장소는 변경하지 않음'}],model:{probabilities:classified.probabilities,concentration:classified.concentration,calibrated:false},requiresConfirmation:true};
 return {routine:next,changes,intent:classified.label,plan};
}
