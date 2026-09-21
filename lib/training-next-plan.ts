import type {Workout,TrainingProfile,ExerciseLog} from './training-model';
import {analyzeTraining} from './training-analysis';
import {normalizeExerciseSearch} from './exercise-guides';
const identity=(e:ExerciseLog)=>JSON.stringify([normalizeExerciseSearch(e.name),e.convention,e.equipmentLabel.trim().toLowerCase(),e.timed]);
export type NextPlanItem={exerciseId:string;name:string;status:'progress'|'maintain'|'review';title:string;reasons:string[];missing:string[];sets:{setId:string;weight:number|null;from:number|null;to:number|null;seconds:number|null;kind:string}[]};
export type NextPlan={sourceId:string;sourceRevision:number;items:NextPlanItem[];token:string};
export function nextPlanItems(source:Workout,history:Workout[],profile:TrainingProfile|null,now=Date.now()):NextPlanItem[]{
 return source.state.exercises.map(e=>{
  const matching=history.map(w=>({...w,state:{...w.state,exercises:w.state.exercises.filter(x=>identity(x)===identity(e))}})).filter(w=>w.state.exercises.length);
  const advice=analyzeTraining(matching,profile,now).advice[0];
  const latest=matching.filter(w=>w.status==='completed'&&w.finished_at!==null&&w.finished_at<=now).sort((a,b)=>(b.finished_at??0)-(a.finished_at??0))[0];
  const sameSource=latest?.id===source.id;
  const ordinary=e.sets.every(s=>s.kind==='working')&&!e.superset&&!e.timed;
  const room=e.sets.every(s=>(s.reps??100)<20);
  const increase=sameSource&&ordinary&&room&&advice?.status==='progress';
  const reasons=[...(advice?.reasons??['비교 가능한 본세트 기록이 부족해요.'])];
  const missing=[...(advice?.missing??[])];if(!sameSource)missing.push('같은 운동의 가장 최근 기록에서 다시 준비');if(!ordinary)missing.push('복합 세트·시간 운동은 직접 구성 확인');if(!room&&!e.timed)missing.push('20회 이상 목표는 직접 검토');
  return {exerciseId:e.id,name:e.name,status:increase?'progress':missing.length||!advice?'review':'maintain',title:increase?'본세트 목표를 1회씩 늘린 초안':advice?.title??'현재 입력값으로 준비',reasons,missing:[...new Set(missing)],sets:e.sets.map(s=>({setId:s.id,weight:s.weight,from:s.reps,to:increase&&s.kind==='working'?(s.reps??e.plannedReps)+1:s.reps,seconds:s.seconds,kind:s.kind}))};
 });
}
export function repeatState(source:Workout,items?:NextPlanItem[]){
 const state=structuredClone(source.state);state.conditionsConfirmed=false;state.discomfort='unreported';state.note='';delete state.durationMinutes;delete state.planBasis;
 state.exercises.forEach(e=>{const item=items?.find(x=>x.exerciseId===e.id);if(item?.status==='progress')e.plannedReps=Math.min(100,e.plannedReps+1);delete e.referenceMax;e.sets=e.sets.map(s=>({...s,id:crypto.randomUUID(),reps:item?.sets.find(x=>x.setId===s.id)?.to??s.reps,done:false,rir:null}));});
 return state;
}
export function applyToRemaining(e:ExerciseLog,sourceId:string){const source=e.sets.find(s=>s.id===sourceId);if(!source)return e;return {...e,sets:e.sets.map(s=>s.done||s.id===sourceId||s.kind!==source.kind?s:{...s,weight:source.weight,reps:source.reps,seconds:source.seconds,rir:null})};}
