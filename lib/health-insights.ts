import type {JournalEntry} from './training-journal-model';
import {addDays} from './gym-model';
export type HealthSample=JournalEntry&{updatedAt:number};
export function summarizeHealth(entries:HealthSample[],today:string,days:number){
 const start=addDays(today,1-days),previous=addDays(start,-days);
 const valid=entries.filter(e=>e.date<=today).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt-a.updatedAt||b.id.localeCompare(a.id));
 const current=valid.filter(e=>e.date>=start),before=valid.filter(e=>e.date>=previous&&e.date<start);
 const unique=(rows:HealthSample[],kind:'body'|'recovery')=>{const dates=new Set<string>();return rows.filter(e=>{if(e.content.kind!==kind||dates.has(e.date))return false;dates.add(e.date);return true;});};
 const weights=(rows:HealthSample[])=>unique(rows,'body').flatMap(e=>e.content.kind==='body'&&e.content.weight!==null?[{date:e.date,value:e.content.weight}]:[]).reverse();
 const sleep=(rows:HealthSample[])=>unique(rows,'recovery').flatMap(e=>e.content.kind==='recovery'&&e.content.sleep!==null?[{date:e.date,value:e.content.sleep}]:[]).reverse();
 const average=(points:{value:number}[])=>points.length?Math.round(points.reduce((n,p)=>n+p.value,0)/points.length*100)/100:null;
 const weight=weights(current),priorWeight=weights(before),sleepPoints=sleep(current),priorSleep=sleep(before);
 const avg=average(weight),prior=average(priorWeight),sleepAvg=average(sleepPoints),sleepPrior=average(priorSleep);
 const meals=current.filter(e=>e.content.kind==='meal'),complete=meals.filter(e=>e.content.kind==='meal'&&[e.content.calories,e.content.protein,e.content.carbs,e.content.fat].every(v=>v!==null));
 const cardio=current.filter(e=>e.content.kind==='cardio');
 return {days,start,weight:{points:weight,average:avg,previousAverage:prior,previousDays:priorWeight.length,delta:weight.length>=2&&priorWeight.length>=2?Math.round((avg!-prior!)*100)/100:null},sleep:{points:sleepPoints,average:sleepAvg,previousAverage:sleepPrior,previousDays:priorSleep.length,delta:sleepPoints.length>=2&&priorSleep.length>=2?Math.round((sleepAvg!-sleepPrior!)*100)/100:null},nutrition:{entries:meals.length,days:new Set(meals.map(e=>e.date)).size,complete:complete.length,missing:meals.length-complete.length},cardio:{entries:cardio.length,minutes:cardio.reduce((n,e)=>n+(e.content.kind==='cardio'?e.content.minutes:0),0)},todayKinds:[...new Set(current.filter(e=>e.date===today).map(e=>e.content.kind))]};
}
