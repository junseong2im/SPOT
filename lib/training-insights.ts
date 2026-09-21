import type {Workout,ExerciseLog,WorkoutSet} from './training-model';
import {workoutTotals} from './training-model';
import {guideFor,normalizeExerciseSearch} from './exercise-guides';
import {localDate} from './gym-model';
// Formula spread is NOT a statistical confidence interval. Only reported maximum-effort sets qualify.
export function estimateMax(e:ExerciseLog,s:WorkoutSet){
 if(e.timed||e.convention!=='total'||!s.done||!['working','failure'].includes(s.kind)||!s.weight||!s.reps||s.reps>10||s.rir!==0)return null;
 const epley=s.reps===1?s.weight:s.weight*(1+s.reps/30),brzycki=s.weight*36/(37-s.reps);
 return {low:Math.round(Math.min(epley,brzycki)*10)/10,high:Math.round(Math.max(epley,brzycki)*10)/10,measured:s.reps===1};
}
const liftNames={squat:['스쿼트','바벨스쿼트','바벨백스쿼트','backsquat','barbellbacksquat'],bench:['벤치프레스','바벨벤치프레스','benchpress','barbellbenchpress'],deadlift:['데드리프트','바벨데드리프트','컨벤셔널데드리프트','conventionaldeadlift','barbelldeadlift']};
export function trainingInsights(history:Workout[],now=Date.now()){
 const ws=history.filter(w=>w.status==='completed'&&w.finished_at!==null&&w.finished_at<=now).sort((a,b)=>a.finished_at!-b.finished_at!);
 const groups=new Map<string,{key:string;name:string;equipment:string;maxWeight:number;bestReps:number;estimate:ReturnType<typeof estimateMax>;date:number;points:{date:number;low:number;high:number}[]}>();
 const body=new Map<string,{name:string;sets:number;last:number}>();
 const lifts:{squat:number|null;bench:number|null;deadlift:number|null}={squat:null,bench:null,deadlift:null};
 for(const w of ws){for(const e of w.state.exercises){
  const sets=e.sets.filter(s=>s.done&&s.kind!=='warmup');if(!sets.length)continue;
  const bodyName=guideFor(e.name)?.body??'분류 미확인';
  if(w.finished_at!>=now-7*86400000){const old=body.get(bodyName)??{name:bodyName,sets:0,last:0};old.sets+=sets.length;old.last=Math.max(old.last,w.finished_at!);body.set(bodyName,old);}
  if(e.timed)continue;
  const key=JSON.stringify([normalizeExerciseSearch(e.name),e.convention,e.equipmentLabel.trim().toLowerCase()]);
  const record=groups.get(key)??{key,name:e.name,equipment:e.equipmentLabel||e.convention,maxWeight:0,bestReps:0,estimate:null,date:w.finished_at!,points:[]};
  let sessionBest:ReturnType<typeof estimateMax>=null;
  for(const s of sets){if(s.weight!==null&&s.reps!==null&&(s.weight>record.maxWeight||(s.weight===record.maxWeight&&s.reps>record.bestReps))){record.maxWeight=s.weight;record.bestReps=s.reps;record.date=w.finished_at!;}
   const estimate=w.state.discomfort==='none'&&w.state.conditionsConfirmed?estimateMax(e,s):null;
   if(estimate&&(!record.estimate||estimate.low>record.estimate.low))record.estimate=estimate;
   if(estimate&&(!sessionBest||estimate.low>sessionBest.low))sessionBest=estimate;
   if(s.reps===1&&estimate?.measured){for(const [lift,names] of Object.entries(liftNames)){if(names.includes(normalizeExerciseSearch(e.name))){const k=lift as keyof typeof lifts;lifts[k]=Math.max(lifts[k]??0,s.weight!);}}}
  }
  if(sessionBest)record.points.push({date:w.finished_at!,low:sessionBest.low,high:sessionBest.high});groups.set(key,record);
 }}
 const slice=(start:number,end:number)=>ws.filter(w=>w.finished_at!>=start&&w.finished_at!<end);
 const summarize=(items:Workout[])=>({sessions:items.length,days:new Set(items.map(w=>localDate(new Date(w.finished_at!)))).size,sets:items.reduce((n,w)=>n+workoutTotals(w).sets,0),minutes:Math.round(items.reduce((n,w)=>n+(w.state.durationMinutes!==undefined?w.state.durationMinutes*60000:Math.max(0,w.finished_at!-w.started_at)),0)/60000),missingWeights:items.reduce((n,w)=>n+workoutTotals(w).missingWeights,0)});
 const current=summarize(slice(now-7*86400000,now+1)),previous=summarize(slice(now-14*86400000,now-7*86400000));
 const months=new Map<string,{month:string;sessions:number;sets:number;volume:number;missingWeights:number}>();
 const calendar=new Map<string,number>();for(const w of ws){const day=localDate(new Date(w.finished_at!)),month=day.slice(0,7),t=workoutTotals(w);calendar.set(day,(calendar.get(day)??0)+1);const m=months.get(month)??{month,sessions:0,sets:0,volume:0,missingWeights:0};m.sessions++;m.sets+=t.sets;m.volume+=t.volume;m.missingWeights+=t.missingWeights;months.set(month,m);}
 return {current,previous,body:[...body.values()].sort((a,b)=>b.sets-a.sets),records:[...groups.values()].filter(g=>g.bestReps>0).map(g=>({...g,points:g.points.slice(-12)})),lifts,total:Object.values(lifts).every(x=>x!==null)?Object.values(lifts).reduce<number>((n,x)=>n+(x??0),0):null,months:[...months.values()].reverse(),calendar:[...calendar].map(([date,count])=>({date,count}))};
}
export function platePlan(target:number,bar:number,plates:{weight:number;pairs:number}[]){
 if(!Number.isFinite(target)||!Number.isFinite(bar)||target<bar||bar<0||target>1500)throw Error('총 중량은 바벨 무게 이상이어야 해요.');
 const remaining=Math.round((target-bar)*50); // integer hundredths of one side
 const choices=new Map<number,number[]>();choices.set(0,plates.map(()=>0));
 plates.forEach((p,i)=>{if(!Number.isFinite(p.weight)||p.weight<=0||p.weight>100||!Number.isInteger(p.pairs)||p.pairs<0||p.pairs>20)throw Error('원판 무게와 보유 쌍 수를 확인하세요.');const size=Math.round(p.weight*100);const prior=[...choices];for(const [sum,counts] of prior)for(let n=1;n<=p.pairs&&sum+n*size<=remaining;n++){const next=[...counts];next[i]=n;const old=choices.get(sum+n*size);if(!old||old.reduce((a,b)=>a+b,0)>next.reduce((a,b)=>a+b,0))choices.set(sum+n*size,next);}});
 let best=0;for(const value of choices.keys())if(value>best)best=value;const counts=choices.get(best)!;return {actual:bar+best/50,exact:best===remaining,side:plates.flatMap((p,i)=>counts[i]?[{weight:p.weight,count:counts[i]}]:[])};
}
export function intervalState(start:number,now:number,work:number,rest:number,rounds:number){const elapsed=Math.max(0,Math.floor((now-start)/1000));const total=rounds*work+(rounds-1)*rest;if(elapsed>=total)return {phase:'done' as const,round:rounds,remaining:0};const cycle=work+rest,round=Math.floor(elapsed/cycle)+1,offset=elapsed%cycle;return {phase:offset<work?'work' as const:'rest' as const,round,remaining:offset<work?work-offset:cycle-offset};}

export function referenceMax(history:Workout[],exercise:ExerciseLog,now=Date.now()){
 let best:{low:number;high:number;date:number}|undefined;
 for(const w of history){if(w.status!=='completed'||!w.finished_at||w.finished_at<now-90*86400000||w.finished_at>now||w.state.discomfort!=='none'||!w.state.conditionsConfirmed)continue;
 for(const e of w.state.exercises){if(normalizeExerciseSearch(e.name)!==normalizeExerciseSearch(exercise.name)||e.convention!==exercise.convention||e.equipmentLabel.trim().toLowerCase()!==exercise.equipmentLabel.trim().toLowerCase()||e.timed!==exercise.timed)continue;
 for(const s of e.sets){const v=estimateMax(e,s);if(v&&(!best||v.low>best.low))best={low:v.low,high:v.high,date:w.finished_at};}
 }}return best;
}
