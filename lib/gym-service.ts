import { z } from 'zod';
import { starterRoutines, type CrewState, type Routine, type PersonalRoutine } from './gym-model';

export class AppError extends Error { constructor(message:string, public status=400){super(message);} }
type Actor={userId:string;displayName:string};
type CrewRow={id:string;name:string;invite:string;owner:string;state:string;revision:number};
const short=z.string().trim().min(1).max(60);
const exercise=z.object({id:z.string().min(1).max(60),name:short,sets:z.number().int().min(1).max(30),reps:z.number().int().min(1).max(100)});
const routine=z.object({id:z.string().min(1).max(60),name:short,subtitle:z.string().trim().max(80),exercises:z.array(exercise).min(1).max(30).refine(xs=>new Set(xs.map(x=>x.id)).size===xs.length,'운동 ID가 중복됐어요.')});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>{const parsed=new Date(`${d}T12:00:00Z`);return !isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===d;},'날짜를 확인해주세요.');
const actionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('createCrew'),name:short,nickname:short}),
  z.object({action:z.literal('joinCrew'),invite:z.string().trim().min(16).max(100),nickname:short}),
  z.object({action:z.literal('profile'),crewId:z.string(),name:short}),
  z.object({action:z.literal('saveCommon'),crewId:z.string(),routine,version:z.number().int().min(0)}),
  z.object({action:z.literal('savePersonal'),crewId:z.string(),routine,revision:z.number().int().min(1)}),
  z.object({action:z.literal('copyRoutine'),crewId:z.string(),routineId:z.string(),version:z.number().int().min(1)}),
  z.object({action:z.literal('syncRoutine'),crewId:z.string(),routineId:z.string(),version:z.number().int().min(1),revision:z.number().int().min(1)}),
  z.object({action:z.literal('saveSession'),crewId:z.string(),revision:z.number().int().min(1),session:z.object({id:z.string().max(60),title:short,date,time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),routineId:z.string()})}),
  z.object({action:z.literal('attendance'),crewId:z.string(),sessionId:z.string(),participating:z.boolean()}),
  z.object({action:z.literal('cancelSession'),crewId:z.string(),sessionId:z.string()}),
]);
async function memberCrew(db:D1Database,crewId:string,userId:string){
 const row=await db.prepare('SELECT c.* FROM crews c JOIN members m ON m.crew_id=c.id WHERE c.id=? AND m.user_id=?').bind(crewId,userId).first<CrewRow>();
 if(!row)throw new AppError('이 크루에 접근할 수 없어요. 초대 링크로 가입해주세요.',403);return row;
}
export async function snapshot(db:D1Database,user:Actor,requested?:string|null){
 const crews=(await db.prepare('SELECT c.id,c.name FROM crews c JOIN members m ON m.crew_id=c.id WHERE m.user_id=? ORDER BY c.rowid').bind(user.userId).all<{id:string;name:string}>()).results;
 const id=requested||crews[0]?.id;
 if(!id)return {user,crews,crew:null};
 const row=await memberCrew(db,id,user.userId);
 const [members,own]=await Promise.all([
 db.prepare('SELECT user_id AS userId,name FROM members WHERE crew_id=? ORDER BY rowid').bind(id).all(),
 db.prepare('SELECT content,base_version,revision FROM personal WHERE crew_id=? AND user_id=?').bind(id,user.userId).all<{content:string;base_version:number;revision:number}>()]);
 return {user,crews,crew:{...row,state:JSON.parse(row.state),members:members.results,personal:own.results.map(p=>({...JSON.parse(p.content),baseVersion:p.base_version,revision:p.revision}))}};
}
export async function act(db:D1Database,user:Actor,raw:unknown){
 const parsed=actionSchema.safeParse(raw);if(!parsed.success)throw new AppError('입력 내용을 확인해주세요. 이름, 날짜와 운동 구성이 올바른지 확인하세요.');const input=parsed.data;
 if(input.action==='createCrew'){
  const id=crypto.randomUUID(),invite=crypto.randomUUID().replaceAll('-','');
  await db.batch([
    db.prepare('INSERT INTO crews(id,name,invite,owner,state,revision) VALUES(?,?,?,?,?,1)').bind(id,input.name,invite,user.userId,JSON.stringify({routines:starterRoutines,sessions:[]})),
    db.prepare('INSERT INTO members(crew_id,user_id,name) VALUES(?,?,?)').bind(id,user.userId,input.nickname),
  ]);return {crewId:id};
 }
 if(input.action==='joinCrew'){
  const crew=await db.prepare('SELECT id FROM crews WHERE invite=?').bind(input.invite).first<{id:string}>();if(!crew)throw new AppError('초대 링크를 찾을 수 없어요.',404);
  await db.prepare('INSERT INTO members(crew_id,user_id,name) VALUES(?,?,?) ON CONFLICT(crew_id,user_id) DO NOTHING').bind(crew.id,user.userId,input.nickname).run();return {crewId:crew.id};
 }
 const row=await memberCrew(db,input.crewId,user.userId);const state=JSON.parse(row.state) as CrewState;
 if(input.action==='profile'){await db.prepare('UPDATE members SET name=? WHERE crew_id=? AND user_id=?').bind(input.name,row.id,user.userId).run();return {crewId:row.id};}
 if(input.action==='copyRoutine'||input.action==='syncRoutine'||input.action==='savePersonal'){
   const id=input.action==='savePersonal'?input.routine.id:input.routineId;
   const base=state.routines.find(r=>r.id===id);if(!base)throw new AppError('공통 루틴을 찾을 수 없어요.',404);
   const prior=await db.prepare('SELECT content,base_version,revision FROM personal WHERE crew_id=? AND user_id=? AND routine_id=?').bind(row.id,user.userId,id).first<{content:string;base_version:number;revision:number}>();
   if(input.action==='copyRoutine'){
    if(base.version!==input.version)throw new AppError('공통 루틴이 변경됐어요. 새로 확인해주세요.',409);
    if(prior)throw new AppError('이미 내 루틴에 있어요. 내 루틴에서 수정해주세요.',409);
    const result=await db.prepare('INSERT INTO personal(crew_id,user_id,routine_id,content,base_version,revision) VALUES(?,?,?,?,?,1) ON CONFLICT DO NOTHING').bind(row.id,user.userId,id,JSON.stringify(base),base.version).run();
    if(!result.meta.changes)throw new AppError('이미 내 루틴에 있어요.',409);
   }else{
    if(!prior)throw new AppError('공통 루틴을 먼저 가져와주세요.',404);
    if(input.action==='syncRoutine'&&input.version!==base.version)throw new AppError('공통 루틴이 변경됐어요. 새로 확인해주세요.',409);
    const content=input.action==='syncRoutine'?base:{...input.routine,version:JSON.parse(prior.content).version};
    const result=await db.prepare('UPDATE personal SET content=?,base_version=?,revision=revision+1 WHERE crew_id=? AND user_id=? AND routine_id=? AND revision=?').bind(JSON.stringify(content),input.action==='syncRoutine'?base.version:prior.base_version,row.id,user.userId,id,input.revision).run();
    if(!result.meta.changes)throw new AppError('다른 창에서 내 루틴을 수정했어요. 새로 확인한 뒤 저장해주세요.',409);
   }return {crewId:row.id};
 }
 if(input.action==='saveCommon'){
  const index=state.routines.findIndex(r=>r.id===input.routine.id);const old=state.routines[index];
  if((old?.version??0)!==input.version)throw new AppError('친구가 공통 루틴을 수정했어요. 새로 확인해주세요.',409);
  const next:Routine={...input.routine,version:(old?.version??0)+1};
  if(index<0){if(state.routines.length>=50)throw new AppError('공통 루틴은 최대 50개까지 만들 수 있어요.');state.routines.push(next);}else state.routines[index]=next;
 }
 if(input.action==='saveSession'){
  if(input.revision!==row.revision)throw new AppError('일정이 변경됐어요. 새로 확인한 뒤 저장해주세요.',409);
  if(input.session.routineId&&!state.routines.some(r=>r.id===input.session.routineId))throw new AppError('루틴을 다시 선택해주세요.');
  const existing=input.session.id?state.sessions.find(s=>s.id===input.session.id):undefined;
  if(input.session.id&&!existing)throw new AppError('일정을 찾을 수 없어요.',404);
  if(existing&&(existing.creator!==user.userId&&row.owner!==user.userId))throw new AppError('작성자 또는 크루장만 일정을 수정할 수 있어요.',403);
  if(existing?.cancelled)throw new AppError('취소된 일정은 수정할 수 없어요.');
  if(existing)Object.assign(existing,input.session);
  else{if(state.sessions.length>=1000)throw new AppError('크루 일정이 가득 찼어요.');state.sessions.push({...input.session,id:crypto.randomUUID(),creator:user.userId,participants:[user.userId],cancelled:false});}
 }
 if(input.action==='attendance'||input.action==='cancelSession'){
  const session=state.sessions.find(s=>s.id===input.sessionId);if(!session)throw new AppError('일정을 찾을 수 없어요.',404);
  if(session.cancelled)throw new AppError('취소된 일정이에요.');
  if(input.action==='cancelSession'){
   if(session.creator!==user.userId&&row.owner!==user.userId)throw new AppError('작성자 또는 크루장만 취소할 수 있어요.',403);
   session.cancelled=true;
  }else session.participants=input.participating?[...new Set([...session.participants,user.userId])]:session.participants.filter(id=>id!==user.userId);
 }
 const result=await db.prepare('UPDATE crews SET state=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(state),row.id,row.revision).run();
 if(!result.meta.changes)throw new AppError('친구의 변경사항이 먼저 저장됐어요. 새로고침 후 다시 시도해주세요.',409);
 return {crewId:row.id};
}
