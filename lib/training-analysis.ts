import {normalizeExerciseSearch} from './exercise-guides';
import {localDate} from './gym-model';
import {workoutTotals,type Workout,type TrainingProfile,type ExerciseLog} from './training-model';
export const trainingSources=[{title:'ACSM 2026 저항훈련 지침',url:'https://pubmed.ncbi.nlm.nih.gov/41843416/'},{title:'RIR 추정 정확도 연구',url:'https://pubmed.ncbi.nlm.nih.gov/34542869/'}];
export type TrainingAdvice={exercise:string;status:'review'|'maintain'|'progress';title:string;reasons:string[];missing:string[]};
export type ExerciseTrend={key:string;name:string;convention:ExerciseLog['convention'];equipment:string;timed:boolean;points:{date:number;workoutId:string;sets:number;reps:number;seconds:number;maxWeight:number|null;volume:number|null}[]};
const working=(e:ExerciseLog)=>e.sets.filter(s=>s.done&&s.kind==='working');
const identity=(e:ExerciseLog)=>JSON.stringify([normalizeExerciseSearch(e.name),e.convention,e.equipmentLabel.trim().toLowerCase(),e.timed]);
export function analyzeTraining(history:Workout[],profile:TrainingProfile|null,now=Date.now()){
 const cutoff=now-90*86400000;
 const completed=history.filter(w=>w.status==='completed'&&w.finished_at!==null&&w.finished_at>=cutoff&&w.finished_at<=now).sort((a,b)=>b.finished_at!-a.finished_at!);
 const sessionsByExercise=new Map<string,{workout:Workout;exercise:ExerciseLog;multipleBlocks:boolean}[]>();
 for(const w of completed){
  const groups=new Map<string,ExerciseLog[]>();for(const e of w.state.exercises){if(!working(e).length)continue;const key=identity(e);groups.set(key,[...(groups.get(key)??[]),e]);}
  for(const [key,group] of groups){const entries=sessionsByExercise.get(key)??[];entries.push({workout:w,exercise:{...group[0],sets:group.flatMap(e=>e.sets)},multipleBlocks:group.length>1});sessionsByExercise.set(key,entries);}
 }
 const advice:TrainingAdvice[]=[],trends:ExerciseTrend[]=[];
 for(const entries of sessionsByExercise.values()){
  const e=entries[0].exercise,last=entries.slice(0,3),sets=last.map(x=>working(x.exercise));
  trends.push({key:identity(e),name:e.name,convention:e.convention,equipment:e.equipmentLabel,timed:e.timed,points:entries.slice(0,12).reverse().map(x=>{const ss=working(x.exercise),weights=ss.flatMap(s=>s.weight===null?[]:[s.weight]);return {date:x.workout.finished_at!,workoutId:x.workout.id,sets:ss.length,reps:ss.reduce((n,s)=>n+(s.reps??0),0),seconds:ss.reduce((n,s)=>n+(s.seconds??0),0),maxWeight:weights.length&&!e.timed?Math.max(...weights):null,volume:!e.timed&&ss.every(s=>s.weight!==null&&s.reps!==null)?ss.reduce((n,s)=>n+s.weight!*s.reps!,0):null};})});
  const missing:string[]=[];
  if(last.some(x=>x.multipleBlocks))missing.push('같은 운동의 여러 블록에 대한 개별 검토');
  if(!profile)missing.push('목표·경력 설정');else if(!profile.adult)missing.push('성인용 지침 적용 대상 확인');
  if(last.length<3)missing.push('같은 조건의 완료 기록 3회');
  if(e.convention==='unknown')missing.push('중량 표기 기준');
  if(e.convention==='machine'&&!e.equipmentLabel)missing.push('동일한 기구를 구분할 이름');
  if(/웜업|워밍업|탑\s*세트|백\s*오프|강제\s*반복|슈퍼\s*세트/.test(e.prescription))missing.push('복합 세트 구성에 대한 개별 검토');
  if(e.timed){
   if(last.some(x=>x.workout.state.discomfort!=='none'))missing.push('운동 중 불편감 확인');
   if(last.some(x=>!x.workout.state.conditionsConfirmed))missing.push('수행 조건 확인');
   advice.push({exercise:e.name,status:missing.length?'review':'maintain',title:last.some(x=>x.workout.state.discomfort==='yes')?'불편감이 있는 동작을 점검하세요':'유지 시간 추세를 확인하세요',reasons:[`최근 기록: ${working(e).reduce((n,s)=>n+(s.seconds??0),0)}초`,`시간 기준 운동에는 중량·횟수 증가 규칙을 적용하지 않습니다.`],missing});continue;
  }
  if(sets.some(ss=>ss.some(s=>s.weight===null||s.reps===null)))missing.push('본세트 중량·횟수');
  if(sets.some(ss=>ss.some(s=>s.rir===null)))missing.push('본세트의 여유 반복 수(RIR)');
  if(last.some(x=>x.workout.state.discomfort!=='none'))missing.push('운동 중 불편감 확인');
  if(last.some(x=>!x.workout.state.conditionsConfirmed))missing.push('기구·가동범위·휴식 조건을 지켰는지 확인');
  if(last.some(x=>x.workout.state.discomfort==='yes')){advice.push({exercise:e.name,status:'review',title:'증량 제안 보류',reasons:['불편감이 보고된 기록이 있습니다. 불편한 동작을 중단하고 지속되면 전문가에게 확인하세요.'],missing});continue;}
  if(last.length===3&&new Set(last.map(x=>localDate(new Date(x.workout.finished_at!)))).size<3)missing.push('서로 다른 날짜의 기록 3회');
  if(last.length&&now-last[0].workout.finished_at!>14*86400000)missing.push('최근 14일 이내 기록');
  const comparable=sets.length===3&&sets.every(ss=>ss.length===sets[0].length&&ss.every((s,i)=>s.weight===sets[0][i].weight))&&last.every(x=>x.exercise.plannedReps===e.plannedReps&&x.workout.state.restSeconds===entries[0].workout.state.restSeconds&&working(x.exercise).length===x.exercise.sets.filter(s=>s.kind==='working').length);
  if(!comparable&&last.length>=3)missing.push('동일한 본세트 수·중량·목표 횟수·설정 휴식');
  if(missing.length){advice.push({exercise:e.name,status:'review',title:'판단에 필요한 기록을 더 모으세요',reasons:['기록이 불완전하거나 비교 조건이 달라 증량을 제안하지 않습니다.'],missing:[...new Set(missing)]});continue;}
  const reps=sets.map(ss=>ss.reduce((n,s)=>n+s.reps!,0));
  const declining=reps[0]<reps[1]&&reps[1]<reps[2];
  const room=profile?.goal!=='consistency'&&sets.slice(0,2).every(ss=>ss.every(s=>s.reps!>=e.plannedReps&&(s.rir??0)>=2));
  advice.push({exercise:e.name,status:room&&!declining&&profile?.experience!=='beginner'?'progress':'maintain',title:declining?'최근 수행 감소를 점검하세요':room&&profile?.experience!=='beginner'?'작은 증가를 검토할 수 있어요':'현재 조건을 유지하며 확인하세요',reasons:[`같은 조건 최근 3회 본세트 횟수: ${reps.slice().reverse().join(' → ')}회`,declining?'휴식·컨디션·기구 조건을 먼저 확인하세요. 원인은 이 기록만으로 확정할 수 없습니다.':room?'최근 2회 목표 횟수와 입력한 RIR 조건을 충족했습니다. 다음 운동의 반복 수 또는 최소 중량 증분을 검토하세요.':'완료 기록과 주관적 RIR을 함께 관찰하세요. 자동 증량하지 않습니다.','이 판단은 SPOT의 보수적인 검토 규칙이며, 코치와 동등한 정확도가 검증된 처방이 아닙니다.'],missing:[]});
 }
 const weekly=Array.from({length:12},(_,i)=>{const end=now-(11-i)*7*86400000,start=end-7*86400000;const ws=completed.filter(w=>w.finished_at!>start&&w.finished_at!<=end);return {label:localDate(new Date(start)),sessions:ws.length,sets:ws.reduce((n,w)=>n+workoutTotals(w).sets,0)};});
 return {windowDays:90,sessions:completed.length,trainingDays:new Set(completed.map(w=>localDate(new Date(w.finished_at!)))).size,last7Days:new Set(completed.filter(w=>w.finished_at!>=now-7*86400000).map(w=>localDate(new Date(w.finished_at!)))).size,weeklyTarget:profile?.daysPerWeek??null,sets:completed.reduce((n,w)=>n+workoutTotals(w).sets,0),missingWeights:completed.reduce((n,w)=>n+workoutTotals(w).missingWeights,0),weekly,trends,advice:advice.slice(0,30),sources:trainingSources};
}
