import type {Routine} from '../gym-model';
import {resolveName} from './catalog';

export type ImportExercise={id:string;name:string;sets:number|null;reps:number|null;prescription:string;source:string;issues:string[]};
export type ImportRoutine={id:string;name:string;exercises:ImportExercise[]};
export type ImportDraft={routines:ImportRoutine[];unparsed:string[];source:string};
const number='(\\d{1,3})(?:\\s*[~–-]\\s*(\\d{1,3}))?';
const multiply=new RegExp(number+'\\s*(?:세트\\s*)?[x×*]\\s*'+number+'\\s*(?:회|reps)?','i');
const korean=new RegExp(number+'\\s*세트(?:\\s*[,/:·-]?\\s*)'+number+'\\s*회');
const reversed=new RegExp(number+'\\s*회\\s*(?:[x×*]|씩)?\\s*'+number+'\\s*세트');

function parseExercise(line:string,index:number):ImportExercise|null{
 const cleaned=line.replace(/^\s*(?:[-•▪▶]+|\d+[.)])\s*/,'').trim();
 let match=cleaned.match(multiply)??cleaned.match(korean),reverse=false;
 if(!match){match=cleaned.match(reversed);reverse=!!match;}
 const marker=cleaned.search(/\d+\s*(?:세트|회)|\d+\s*[x×*]/i);
 const rawName=cleaned.slice(0,match?.index??(marker>=0?marker:cleaned.length)).replace(/\d+(?:\.\d+)?\s*(?:kg|킬로|lbs?|파운드)/gi,'').replace(/[:：|\s]+$/,'').trim();
 if(!rawName||/^[-|\d\s]+$/.test(rawName))return null;
 const resolved=resolveName(rawName);
 // Prose remains visible as unparsed material, not silently reinterpreted as an exercise.
 if(marker<0&&!match&&!resolved.known)return null;
 let sets:number|null=null,reps:number|null=null;
 const issues:string[]=[];
 if(match){
  sets=Number(match[reverse?3:1]);reps=Number(match[reverse?1:3]);
  if(match[reverse?4:2])issues.push('세트 범위에서 실제 세트 수를 정해주세요.');
 }else{
  const s=cleaned.match(/(\d+)\s*세트/),r=cleaned.match(/(\d+)\s*회/);sets=s?Number(s[1]):null;reps=r?Number(r[1]):null;
 }
 if(!resolved.known)issues.push('운동 이름을 확인해주세요. 원문 이름을 유지했어요.');
 if(sets===null)issues.push('세트 수가 없어요.');
 if(reps===null)issues.push('반복 횟수가 없어요.');
 if(sets!==null&&(sets<1||sets>30)){sets=null;issues.push('세트는 1~30 범위로 확인해주세요.');}
 if(reps!==null&&(reps<1||reps>100)){reps=null;issues.push('반복은 1~100 범위로 확인해주세요.');}
 if(/웜업|워밍업|탑\s*세트|백\s*오프|슈퍼\s*세트|드롭\s*세트|warm.?up|back.?off|top.?set/i.test(cleaned)){
  issues.push('복합 세트 구성은 본세트 수를 확인해주세요. 원문은 수행법에 보존해요.');sets=null;
 }
 if(/\d+\s*초|\d+\s*분/.test(cleaned)&&!match&&!/\d+\s*회/.test(cleaned))issues.push('시간 기반 운동은 횟수로 자동 변환하지 않아요.');
 return {id:`import-exercise-${index}`,name:resolved.name,sets,reps,prescription:cleaned,source:line,issues};
}

export function parseRoutineText(source:string):ImportDraft{
 if(!source.trim())throw Error('루틴 글을 먼저 넣어주세요.');
 if(source.length>12000)throw Error('원문을 빠짐없이 보존하기 위해 한 번에 12,000자까지 가져올 수 있어요.');
 const draft:ImportDraft={routines:[],unparsed:[],source};let current:ImportRoutine={id:'import-routine-0',name:'가져온 루틴',exercises:[]};
 const flush=()=>{if(current.exercises.length)draft.routines.push(current);};
 const lines=source.normalize('NFKC').replace(/\r/g,'').split(/[\n;]+/);
 let index=0;
 for(const raw of lines){
  const line=raw.trim().replace(/^#+\s*/,'').replace(/\*\*/g,'');if(!line)continue;
  if(/^(?:day\s*\d+|[월화수목금토일]요일|[월화수목금토일]\s*[:：]|\[.+\]|push\s*day|pull\s*day|leg\s*day)/i.test(line)&&!line.match(multiply)&&!line.match(korean)){
   flush();current={id:`import-routine-${draft.routines.length}`,name:line.replace(/^\[|\]$/g,'').slice(0,60),exercises:[]};continue;
  }
  if(/^\|?\s*(운동|종목|exercise)\s*[|\t]/i.test(line)||/^[-|:\s]+$/.test(line))continue;
  // Markdown tables with an explicit exercise / sets / reps row layout.
  const cells=line.split('|').map(s=>s.trim()).filter(Boolean);
  const normalized=cells.length===3&&/^\d+(?:\s*세트)?$/.test(cells[1])&&/^\d+(?:\s*[~–-]\s*\d+)?(?:\s*회)?$/.test(cells[2])?`${cells[0]} ${cells[1].replace('세트','')}×${cells[2].replace('회','')}`:line;
  const exercise=parseExercise(normalized,index++);
  if(exercise)current.exercises.push(exercise);else draft.unparsed.push(raw);
 }
 flush();
 if(draft.routines.length>10||draft.routines.some(r=>r.exercises.length>30))throw Error('한 번에 루틴 10개, 루틴당 운동 30개까지 가져올 수 있어요.');
 return draft;
}

export function finalizeImport(draft:ImportDraft):Routine[]{
 if(!draft.routines.length)throw Error('인식한 운동이 없어요. 운동 이름과 세트·횟수가 있는지 확인해주세요.');
 if(draft.routines.some(r=>!r.name.trim()||r.name.length>60))throw Error('루틴 이름을 1~60자로 확인해주세요.');
 return draft.routines.map(r=>({id:r.id,name:r.name.trim(),subtitle:'가져온 루틴',version:0,notes:draft.source.slice(0,12000),exercises:r.exercises.map(e=>{
  if(!e.name.trim()||e.name.length>60||!Number.isInteger(e.sets)||!Number.isInteger(e.reps)||e.sets!<1||e.sets!>30||e.reps!<1||e.reps!>100)throw Error('운동 이름·세트·횟수를 확인해주세요.');
  const original=parseExercise(e.source,0);
  const edited=!original||original.sets!==e.sets||original.reps!==e.reps||original.name!==e.name.trim();
  const prescription=edited?`확인한 기준: ${e.name.trim()} ${e.sets}세트 × ${e.reps}회.\n아래는 수정 전 참고 원문입니다:\n${e.prescription}`:e.prescription;
  return {id:e.id,name:e.name.trim(),sets:e.sets!,reps:e.reps!,prescription:prescription.slice(0,2000)};
 })}));
}
