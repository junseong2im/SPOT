import type {Database} from '../db/adapter';
import type {Routine} from './gym-model';
import {guideFor,normalizeExerciseSearch} from './exercise-guides';
import {AppError} from './gym-service';
import {trainingProfileSchema,workoutStateSchema,workoutTotals,type Workout,type WorkoutState,type TrainingProfile} from './training-model';
import {analyzeTraining} from './training-analysis';
import {journalSummary} from './training-journal';
import {trainingInsights,referenceMax} from './training-insights';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {nextPlanItems,repeatState,type NextPlan} from './training-next-plan';
type Row=Omit<Workout,'state'|'started_at'|'finished_at'|'updated_at'>&{state:string;started_at:string|number;finished_at:string|number|null;updated_at:string|number};
const hydrate=(row:Row):Workout=>({...row,state:workoutStateSchema.parse(JSON.parse(row.state)),started_at:Number(row.started_at),finished_at:row.finished_at===null?null:Number(row.finished_at),updated_at:Number(row.updated_at)});
export async function workoutHistory(db:Database,userId:string,cursor?:string|null,search=''){
 let boundary:{time:number;id:string}|null=null;
 if(cursor){try{boundary=z.object({time:z.number().int().nonnegative(),id:z.string().uuid()}).parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));}catch{throw new AppError('기록 페이지를 다시 열어주세요.');}}
 const query=search.trim().slice(0,100);
 const rows=(await db.prepare("SELECT * FROM workout_sessions WHERE user_id=? AND status='completed'"+(query?" AND (strpos(lower(routine_name),lower(?))>0 OR strpos(lower(state),lower(?))>0)":'')+(boundary?' AND (finished_at<? OR (finished_at=? AND id<?))':'')+' ORDER BY finished_at DESC,id DESC LIMIT 21').bind(userId,...(query?[query,query]:[]),...(boundary?[boundary.time,boundary.time,boundary.id]:[])).all<Row>()).results;
 const page=rows.slice(0,20).map(hydrate),last=page.at(-1);
 return {history:page.map(w=>({id:w.id,name:w.routine_name,date:w.finished_at,...workoutTotals(w)})),cursor:rows.length>20&&last?Buffer.from(JSON.stringify({time:last.finished_at,id:last.id})).toString('base64url'):null};
}
export async function trainingSnapshot(db:Database,userId:string,id?:string|null){
 if(id){const row=await db.prepare('SELECT * FROM workout_sessions WHERE id=? AND user_id=?').bind(id,userId).first<Row>();if(!row)throw new AppError('운동 기록을 찾을 수 없어요.',404);return {workout:hydrate(row)};}
 const active=await db.prepare("SELECT * FROM workout_sessions WHERE user_id=? AND status='active'").bind(userId).first<Row>();
 const rows=(await db.prepare("SELECT * FROM workout_sessions WHERE user_id=? AND status='completed' AND finished_at>=? ORDER BY finished_at DESC LIMIT 201").bind(userId,Date.now()-90*86400000).all<Row>()).results;
 const rawProfile=await db.prepare('SELECT content FROM training_profiles WHERE user_id=?').bind(userId).first<{content:string}>();
 const parsed=trainingProfileSchema.safeParse(rawProfile?JSON.parse(rawProfile.content):{});const profile=parsed.success?parsed.data:null;
 const history=rows.slice(0,200).map(hydrate);
 return {active:active?hydrate(active):null,profile,...await workoutHistory(db,userId),analysis:analyzeTraining(history,profile),insights:trainingInsights(history),journal:await journalSummary(db,userId),truncated:rows.length>200};
}
export async function nextWorkoutPlan(db:Database,userId:string,sourceId:string):Promise<NextPlan>{
 const sourceRow=await db.prepare("SELECT * FROM workout_sessions WHERE id=? AND user_id=? AND status='completed'").bind(sourceId,userId).first<Row>();if(!sourceRow)throw new AppError('원본 기록을 찾을 수 없어요.',404);
 const rows=(await db.prepare("SELECT * FROM workout_sessions WHERE user_id=? AND status='completed' AND finished_at>=? ORDER BY finished_at DESC,id DESC LIMIT 200").bind(userId,Date.now()-90*86400000).all<Row>()).results;
 const raw=await db.prepare('SELECT content FROM training_profiles WHERE user_id=?').bind(userId).first<{content:string}>();const parsed=trainingProfileSchema.safeParse(raw?JSON.parse(raw.content):{}),profile=parsed.success?parsed.data:null;
 const source=hydrate(sourceRow),history=rows.map(hydrate),items=nextPlanItems(source,history,profile);
 const token=createHash('sha256').update(JSON.stringify({source:source.id,revision:source.revision,records:history.map(w=>[w.id,w.revision]),profile,items})).digest('hex');
 return {sourceId:source.id,sourceRevision:source.revision,items,token};
}
const actions=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),id:z.string().uuid(),crewId:z.string(),routineId:z.string(),kind:z.enum(['common','personal']),version:z.number().int()}),
 z.object({action:z.literal('save'),id:z.string().uuid(),revision:z.number().int().min(1),state:workoutStateSchema}),
 z.object({action:z.literal('correct'),id:z.string().uuid(),revision:z.number().int().min(1),state:workoutStateSchema}),
 z.object({action:z.literal('finish'),id:z.string().uuid(),revision:z.number().int().min(1),state:workoutStateSchema}),
 z.object({action:z.literal('discard'),id:z.string().uuid(),revision:z.number().int().min(1)}),
 z.object({action:z.literal('profile'),profile:trainingProfileSchema}),
 z.object({action:z.literal('repeat'),id:z.string().uuid(),sourceId:z.string().uuid(),planToken:z.string().regex(/^[a-f0-9]{64}$/).optional()}),
]);
export async function trainingAction(db:Database,userId:string,raw:unknown){
 const parsed=actions.safeParse(raw);if(!parsed.success)throw new AppError('입력 범위를 확인해주세요. 완료한 세트에는 횟수 또는 시간이 필요해요.');const input=parsed.data;
 return db.transaction(async tx=>{
  const now=Date.now();await tx.prepare("INSERT INTO training_profiles(user_id,content,updated_at) VALUES(?,'{}',?) ON CONFLICT(user_id) DO NOTHING").bind(userId,now).run();
  await tx.prepare('SELECT user_id FROM training_profiles WHERE user_id=? FOR UPDATE').bind(userId).first();
  if(input.action==='profile'){await tx.prepare('UPDATE training_profiles SET content=?,updated_at=? WHERE user_id=?').bind(JSON.stringify(input.profile),now,userId).run();return {profile:input.profile};}
  if(input.action==='repeat'){
   const active=await tx.prepare("SELECT * FROM workout_sessions WHERE user_id=? AND status='active'").bind(userId).first<Row>();if(active)return {workout:hydrate(active),resumed:true};
   const source=await tx.prepare("SELECT * FROM workout_sessions WHERE id=? AND user_id=? AND status='completed'").bind(input.sourceId,userId).first<Row>();if(!source)throw new AppError('원본 기록을 찾을 수 없어요.',404);
   let plan:NextPlan|undefined;if(input.planToken){plan=await nextWorkoutPlan(tx,userId,input.sourceId);if(plan.token!==input.planToken)throw new AppError('기록이나 코칭 기준이 바뀌었어요. 다음 운동 초안을 다시 확인해주세요.',409);}
   const state=repeatState(hydrate(source),plan?.items);if(plan)state.planBasis={sourceId:plan.sourceId,sourceRevision:plan.sourceRevision,token:plan.token,createdAt:now};
   const row=await tx.prepare('INSERT INTO workout_sessions(id,user_id,crew_id,routine_id,routine_name,state,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?) RETURNING *').bind(input.id,userId,source.crew_id,source.routine_id,source.routine_name,JSON.stringify(workoutStateSchema.parse(state)),now,now).first<Row>();return {workout:hydrate(row!),resumed:false};
  }
  if(input.action==='start'){
   const active=await tx.prepare("SELECT * FROM workout_sessions WHERE user_id=? AND status='active'").bind(userId).first<Row>();if(active)return {workout:hydrate(active),resumed:true};
   const duplicate=await tx.prepare('SELECT id FROM workout_sessions WHERE id=?').bind(input.id).first();if(duplicate)throw new AppError('이미 처리한 시작 요청이에요. 기록 목록을 확인해주세요.',409);
   const crew=await tx.prepare('SELECT c.state FROM crews c JOIN members m ON m.crew_id=c.id WHERE c.id=? AND m.user_id=? AND m.active=1 AND c.archived=0').bind(input.crewId,userId).first<{state:string}>();if(!crew)throw new AppError('이 크루에 접근할 수 없어요.',403);
   let routine:Routine|undefined;
   if(input.kind==='personal'){const own=await tx.prepare('SELECT content FROM personal WHERE crew_id=? AND user_id=? AND routine_id=?').bind(input.crewId,userId,input.routineId).first<{content:string}>();if(own)routine=JSON.parse(own.content);}
   else routine=(JSON.parse(crew.state).routines as Routine[]).find(r=>r.id===input.routineId);
   if(!routine)throw new AppError('루틴을 찾을 수 없어요.',404);if(routine.version!==input.version)throw new AppError('루틴이 바뀌었어요. 목록을 새로고침해주세요.',409);
   const past=(await tx.prepare("SELECT * FROM workout_sessions WHERE user_id=? AND status='completed' ORDER BY finished_at DESC LIMIT 30").bind(userId).all<Row>()).results.map(hydrate);
   let carried=0;
   const state:WorkoutState={restSeconds:90,note:'',discomfort:'unreported',conditionsConfirmed:false,exercises:routine.exercises.map(e=>{
    const guide=guideFor(e.name),equipment=guide?.equipment??'',timed=e.durationSeconds!==undefined;
    const convention=equipment.includes('머신')||equipment.includes('케이블')?'machine':equipment.includes('덤벨')&&!equipment.includes('바벨')?'per_hand':equipment.includes('바벨')||equipment.includes('이지바')?'total':equipment.includes('맨몸')?'bodyweight':'unknown';
    const prior=past.flatMap(w=>w.state.exercises).find(x=>normalizeExerciseSearch(x.name)===normalizeExerciseSearch(e.name)&&x.timed===timed&&x.convention===convention);
    const priorSets=prior?.sets.filter(s=>s.done&&s.kind==='working')??[];
    if(priorSets.length)carried++;
    const ranges=[...(e.prescription??'').matchAll(/(\d+)\s*[~–-]\s*(\d+)\s*회/g)];const plannedReps=ranges.length===1&&!/웜업|워밍업|탑\s*세트|백\s*오프/.test(e.prescription??'')?Number(ranges[0][2]):e.reps;
    return {id:e.id,name:e.name,timed,plannedReps,convention,equipmentLabel:prior?.equipmentLabel??'',restSeconds:prior?.restSeconds,superset:prior?.superset,note:'',prescription:e.prescription??'',sets:Array.from({length:e.sets},(_,i)=>({id:crypto.randomUUID(),kind:'working' as const,weight:priorSets[i]?.weight??null,reps:timed?null:priorSets[i]?.reps??e.reps,seconds:timed?priorSets[i]?.seconds??e.durationSeconds!:null,rir:null,done:false}))};
   })};
   state.exercises.forEach(e=>{e.referenceMax=referenceMax(past,e);});
   const validated=workoutStateSchema.parse(state);
   const row=await tx.prepare("INSERT INTO workout_sessions(id,user_id,crew_id,routine_id,routine_name,state,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?) RETURNING *").bind(input.id,userId,input.crewId,routine.id,routine.name,JSON.stringify(validated),now,now).first<Row>();return {workout:hydrate(row!),resumed:false,carried};
  }
  const row=await tx.prepare('SELECT * FROM workout_sessions WHERE id=? AND user_id=? FOR UPDATE').bind(input.id,userId).first<Row>();if(!row)throw new AppError('운동 기록에 접근할 수 없어요.',404);
  if('state' in input)input.state.planBasis=hydrate(row).state.planBasis;
  if(input.action==='correct'){
   if(row.status!=='completed')throw new AppError('완료한 운동 기록만 여기에서 수정할 수 있어요.',409);
   if(row.revision!==input.revision)throw new AppError('다른 기기에서 변경됐어요. 기록을 다시 열어주세요.',409);
   if(!input.state.exercises.some(e=>e.sets.some(s=>s.done)))throw new AppError('완료한 세트가 한 개 이상 있어야 해요.');
   const saved=await tx.prepare('UPDATE workout_sessions SET state=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? RETURNING *').bind(JSON.stringify(input.state),now,input.id,userId).first<Row>();return {workout:hydrate(saved!)};
  }
  if(row.status==='completed'&&input.action==='finish'&&JSON.stringify(input.state)===JSON.stringify(hydrate(row).state))return {workout:hydrate(row)};
  if(row.status==='discarded'&&input.action==='discard')return {workout:hydrate(row)};
  if(row.status!=='active')throw new AppError('이미 종료된 운동이에요. 기록 목록을 확인해주세요.',409);
  if(row.revision!==input.revision)throw new AppError('다른 기기에서 기록이 바뀌었어요. 서버 기록을 다시 불러와주세요.',409);
  const state=input.action==='discard'?hydrate(row).state:input.state;
  if(input.action==='finish'&&!state.exercises.some(e=>e.sets.some(s=>s.done)))throw new AppError('완료한 세트가 없어요. 기록하지 않으려면 기록 버리기를 선택해주세요.');
  const status=input.action==='finish'?'completed':input.action==='discard'?'discarded':'active';
  const saved=await tx.prepare('UPDATE workout_sessions SET state=?,status=?,revision=revision+1,finished_at=?,updated_at=? WHERE id=? AND user_id=? RETURNING *').bind(JSON.stringify(state),status,status==='active'?null:now,now,input.id,userId).first<Row>();return {workout:hydrate(saved!)};
 });
}
