import {auditMission} from './mission-audit';
import type { Database } from '../db/adapter';
import { z } from 'zod';
import { starterRoutines, type CrewState, type Routine, type Session, type TimePoll } from './gym-model';
import { normalizeState, repeatDates, weekday, sessionStart, participationClosed, responseOpen } from './planning';
import { inbox, invalidateSessionNotifications, queueSessionNotifications } from './notifications';

export class AppError extends Error { constructor(message:string, public status=400){super(message);} }
type Actor={userId:string;displayName:string};
type CrewRow={id:string;name:string;invite:string;owner:string;state:string;revision:number};
const short=z.string().trim().min(1).max(60);
const exercise=z.object({id:z.string().min(1).max(60),name:short,sets:z.number().int().min(1).max(30),reps:z.number().int().min(1).max(100),prescription:z.string().max(2000).optional()});
const routine=z.object({id:z.string().min(1).max(60),name:short,subtitle:z.string().trim().max(80),notes:z.string().max(12000).optional(),exercises:z.array(exercise).min(1).max(30).refine(xs=>new Set(xs.map(x=>x.id)).size===xs.length,'운동 ID가 중복됐어요.')});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>{const parsed=new Date(`${d}T12:00:00Z`);return !isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===d;},'날짜를 확인해주세요.');
const capacity=z.number().int().min(1).max(100).nullable().default(null);
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const deadlineMinutes=z.number().int().min(0).max(10080).default(0);
const actionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('createCrew'),name:short,nickname:short}),
  z.object({action:z.literal('joinCrew'),invite:z.string().trim().min(16).max(100),nickname:short}),
  z.object({action:z.literal('profile'),crewId:z.string(),name:short}),
  z.object({action:z.literal('saveCommon'),crewId:z.string(),routine,version:z.number().int().min(0)}),
  z.object({action:z.literal('importRoutines'),crewId:z.string(),revision:z.number().int().min(1),routines:z.array(routine).min(1).max(10).refine(rs=>new Set(rs.map(r=>r.id)).size===rs.length)}),
  z.object({action:z.literal('savePersonal'),crewId:z.string(),routine,revision:z.number().int().min(1)}),
  z.object({action:z.literal('copyRoutine'),crewId:z.string(),routineId:z.string(),version:z.number().int().min(1)}),
  z.object({action:z.literal('syncRoutine'),crewId:z.string(),routineId:z.string(),version:z.number().int().min(1),revision:z.number().int().min(1)}),
  z.object({action:z.literal('saveSession'),crewId:z.string(),revision:z.number().int().min(1),session:z.object({id:z.string().max(60),title:short,date,time,routineId:z.string(),capacity,deadlineMinutes}),repeat:z.object({weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),until:date}).optional(),scope:z.enum(['one','future']).default('one')}),
  z.object({action:z.literal('attendance'),crewId:z.string(),sessionId:z.string(),participating:z.boolean()}),
  z.object({action:z.literal('sessionResponse'),crewId:z.string(),sessionId:z.string(),version:z.number().int().min(1),response:z.enum(['going','notGoing'])}),
  z.object({action:z.literal('cancelSession'),crewId:z.string(),sessionId:z.string(),scope:z.enum(['one','future']).default('one')}),
  z.object({action:z.literal('saveWeekPlan'),crewId:z.string(),revision:z.number().int(),plan:z.record(z.string().regex(/^[0-6]$/),z.string().max(60))}),
  z.object({action:z.literal('createPoll'),crewId:z.string(),title:short,routineId:z.string(),capacity,closesAt:z.number().int(),options:z.array(z.object({date,time})).min(2).max(12)}),
  z.object({action:z.literal('votePoll'),crewId:z.string(),pollId:z.string(),optionIds:z.array(z.string()).max(12)}),
  z.object({action:z.literal('confirmPoll'),crewId:z.string(),pollId:z.string(),optionId:z.string()}),
  z.object({action:z.literal('closePoll'),crewId:z.string(),pollId:z.string()}),
  z.object({action:z.literal('renameCrew'),crewId:z.string(),name:short}),
  z.object({action:z.literal('transferOwner'),crewId:z.string(),userId:z.string()}),
  z.object({action:z.literal('rotateInvite'),crewId:z.string()}),
  z.object({action:z.literal('leaveCrew'),crewId:z.string()}),
  z.object({action:z.literal('readNotifications'),ids:z.array(z.string()).max(100)}),
  z.object({action:z.literal('notificationSettings'),enabled:z.boolean(),pushEnabled:z.boolean(),reminderMinutes:z.union([z.literal(10),z.literal(30),z.literal(60),z.literal(1440)])}),
]);
async function memberCrew(db:Database,crewId:string,userId:string,lock=false){
 const row=await db.prepare('SELECT c.* FROM crews c JOIN members m ON m.crew_id=c.id WHERE c.id=? AND m.user_id=? AND m.active=1 AND c.archived=0'+(lock?' FOR UPDATE OF c':'')).bind(crewId,userId).first<CrewRow>();
 if(!row)throw new AppError('이 크루에 접근할 수 없어요. 초대 링크로 가입해주세요.',403);return row;
}
export async function snapshot(db:Database,user:Actor,requested?:string|null){
 const crews=(await db.prepare('SELECT c.id,c.name FROM crews c JOIN members m ON m.crew_id=c.id WHERE m.user_id=? AND m.active=1 AND c.archived=0 ORDER BY c.name,c.id').bind(user.userId).all<{id:string;name:string}>()).results;
 const id=requested||crews[0]?.id;
 if(!id)return {user,crews,crew:null,notifications:await inbox(db,user.userId)};
 const row=await memberCrew(db,id,user.userId);
 const [members,own]=await Promise.all([
 db.prepare('SELECT user_id AS "userId",name FROM members WHERE crew_id=? AND active=1 ORDER BY user_id').bind(id).all(),
 db.prepare('SELECT content,base_version,revision FROM personal WHERE crew_id=? AND user_id=?').bind(id,user.userId).all<{content:string;base_version:number;revision:number}>()]);
 return {user,crews,notifications:await inbox(db,user.userId),crew:{...row,state:normalizeState(JSON.parse(row.state)),members:members.results,personal:own.results.map(p=>({...JSON.parse(p.content),baseVersion:p.base_version,revision:p.revision}))}};
}
export async function act(db:Database,user:Actor,raw:unknown){ return db.transaction(transaction=>actInTransaction(transaction,user,raw)); }
async function actInTransaction(db:Database,user:Actor,raw:unknown){
 const parsed=actionSchema.safeParse(raw);if(!parsed.success)throw new AppError('입력 내용을 확인해주세요. 이름, 날짜와 운동 구성이 올바른지 확인하세요.');const input=parsed.data;
 if(input.action==='readNotifications'){
  for(const id of input.ids)await db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').bind(Date.now(),id,user.userId).run();
  return {};
 }
 if(input.action==='notificationSettings'){
  await db.prepare('INSERT INTO notification_preferences(user_id,enabled,push_enabled,reminder_minutes) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,push_enabled=EXCLUDED.push_enabled,reminder_minutes=EXCLUDED.reminder_minutes').bind(user.userId,input.enabled?1:0,input.pushEnabled?1:0,input.reminderMinutes).run();
  const rows=(await db.prepare('SELECT c.id,c.state FROM crews c JOIN members m ON m.crew_id=c.id WHERE m.user_id=? AND m.active=1 AND c.archived=0 ORDER BY c.id FOR UPDATE OF c').bind(user.userId).all<{id:string;state:string}>()).results;
  for(const crew of rows){
   const state=normalizeState(JSON.parse(crew.state));
   for(const session of state.sessions.filter(s=>s.participants.includes(user.userId)&&!s.cancelled&&sessionStart(s)>Date.now())){await invalidateSessionNotifications(db,crew.id,session.id,user.userId);if(input.enabled)await queueSessionNotifications(db,crew.id,session,'reminder',[user.userId]);}
  }
  return {};
 }
 if(input.action==='createCrew'){
  const id=crypto.randomUUID(),invite=crypto.randomUUID().replaceAll('-','');
  await db.batch([
    db.prepare('INSERT INTO crews(id,name,invite,owner,state,revision) VALUES(?,?,?,?,?,1)').bind(id,input.name,invite,user.userId,JSON.stringify({routines:starterRoutines,sessions:[],polls:[],weekPlan:{}})),
    db.prepare('INSERT INTO members(crew_id,user_id,name) VALUES(?,?,?)').bind(id,user.userId,input.nickname),
  ]);return {crewId:id};
 }
 if(input.action==='joinCrew'){
  const crew=await db.prepare('SELECT id FROM crews WHERE invite=? AND archived=0 FOR UPDATE').bind(input.invite).first<{id:string}>();if(!crew)throw new AppError('초대 링크를 찾을 수 없어요.',404);
  await db.prepare('INSERT INTO members(crew_id,user_id,name) VALUES(?,?,?) ON CONFLICT(crew_id,user_id) DO UPDATE SET active=1,name=EXCLUDED.name').bind(crew.id,user.userId,input.nickname).run();return {crewId:crew.id};
 }
 const row=await memberCrew(db,input.crewId,user.userId,true);const state=normalizeState(JSON.parse(row.state) as CrewState);
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
 if(input.action==='saveWeekPlan'){
  if(input.revision!==row.revision)throw new AppError('다른 사람이 요일 루틴을 수정했어요. 새로 확인해주세요.',409);
  for(const id of Object.values(input.plan))if(id&&!state.routines.some(r=>r.id===id))throw new AppError('루틴을 다시 선택해주세요.');
  state.weekPlan=input.plan;
 }
 if(input.action==='renameCrew'||input.action==='rotateInvite'||input.action==='transferOwner'){
  if(row.owner!==user.userId)throw new AppError('크루장만 변경할 수 있어요.',403);
  if(input.action==='renameCrew')await db.prepare('UPDATE crews SET name=?,revision=revision+1 WHERE id=?').bind(input.name,row.id).run();
  if(input.action==='rotateInvite')await db.prepare('UPDATE crews SET invite=?,revision=revision+1 WHERE id=?').bind(crypto.randomUUID().replaceAll('-',''),row.id).run();
  if(input.action==='transferOwner'){
   if(input.userId===user.userId)throw new AppError('다른 크루원을 선택해주세요.');
   if(!await db.prepare('SELECT user_id FROM members WHERE crew_id=? AND user_id=? AND active=1').bind(row.id,input.userId).first())throw new AppError('현재 크루원을 선택해주세요.');
   await db.prepare('UPDATE crews SET owner=?,revision=revision+1 WHERE id=?').bind(input.userId,row.id).run();
  }return {crewId:row.id};
 }
 if(input.action==='leaveCrew'){
  await db.prepare("UPDATE mission_members mm SET forfeited=1 FROM missions m WHERE m.id=mm.mission_id AND m.crew_id=? AND mm.user_id=? AND mm.withdrawn=0 AND m.rules_version>=2 AND m.cancelled=0 AND m.starts<=? AND m.ends>=? AND m.settlement IS NULL").bind(row.id,user.userId,new Date(Date.now()+9*3600000).toISOString().slice(0,10),new Date(Date.now()+9*3600000).toISOString().slice(0,10)).run();
  await db.prepare("UPDATE mission_members mm SET withdrawn=1 FROM missions m WHERE m.id=mm.mission_id AND m.crew_id=? AND mm.user_id=? AND m.rules_version>=2 AND m.starts>? AND m.cancelled=0").bind(row.id,user.userId,new Date(Date.now()+9*3600000).toISOString().slice(0,10)).run();
  const others=(await db.prepare('SELECT user_id FROM members WHERE crew_id=? AND active=1 AND user_id!=?').bind(row.id,user.userId).all()).results;
  if(row.owner===user.userId&&others.length)throw new AppError('크루장을 다른 멤버에게 위임한 뒤 탈퇴해주세요.');
  for(const session of state.sessions){session.participants=session.participants.filter(id=>id!==user.userId);if(session.responses)delete session.responses[user.userId];}
  for(const poll of state.polls??[])for(const option of poll.options)option.votes=option.votes.filter(id=>id!==user.userId);
  await db.prepare('UPDATE members SET active=0 WHERE crew_id=? AND user_id=?').bind(row.id,user.userId).run();
  await db.prepare("UPDATE notifications SET push_state='invalid' WHERE crew_id=? AND user_id=?").bind(row.id,user.userId).run();
  await db.prepare('UPDATE crews SET state=?,archived=?,revision=revision+1 WHERE id=?').bind(JSON.stringify(state),others.length?0:1,row.id).run();
  return {crewId:''};
 }
 if(input.action==='createPoll'){
  if((state.polls??[]).filter(p=>p.status==='open').length>=20)throw new AppError('진행 중인 투표는 20개까지 만들 수 있어요.');
  if(input.closesAt<=Date.now())throw new AppError('투표 마감은 현재 이후로 설정해주세요.');
  if(new Set(input.options.map(o=>o.date+o.time)).size!==input.options.length)throw new AppError('중복된 후보 시간이 있어요.');
  if(input.options.some(o=>sessionStart(o)<=input.closesAt))throw new AppError('후보 시간은 투표 마감 이후여야 해요.');
  if(input.routineId&&!state.routines.some(r=>r.id===input.routineId))throw new AppError('루틴을 다시 선택해주세요.');
  const poll:TimePoll={id:crypto.randomUUID(),title:input.title,creator:user.userId,routineId:input.routineId,capacity:input.capacity,closesAt:input.closesAt,status:'open',options:input.options.map(o=>({...o,id:crypto.randomUUID(),votes:[]}))};
  state.polls=[...(state.polls??[]),poll];
 }
 if(input.action==='votePoll'||input.action==='confirmPoll'||input.action==='closePoll'){
  const poll=state.polls?.find(p=>p.id===input.pollId);if(!poll)throw new AppError('투표를 찾을 수 없어요.',404);
  if(poll.status!=='open')throw new AppError('이미 종료된 투표예요.',409);
  if(input.action==='votePoll'){
   if(Date.now()>=poll.closesAt)throw new AppError('투표 시간이 마감됐어요.');
   if(input.optionIds.some(id=>!poll.options.some(o=>o.id===id)))throw new AppError('투표 후보를 다시 선택해주세요.');
   for(const option of poll.options)option.votes=input.optionIds.includes(option.id)?[...new Set([...option.votes,user.userId])]:option.votes.filter(id=>id!==user.userId);
  }else{
   if(poll.creator!==user.userId&&row.owner!==user.userId)throw new AppError('투표 작성자 또는 크루장만 확정할 수 있어요.',403);
   if(input.action==='closePoll')poll.status='closed';
   else{
    const option=poll.options.find(o=>o.id===input.optionId);if(!option)throw new AppError('후보 시간을 선택해주세요.');
    if(sessionStart(option)<=Date.now())throw new AppError('이미 지난 시간으로 확정할 수 없어요.');
    const session:Session={id:crypto.randomUUID(),title:poll.title,date:option.date,time:option.time,routineId:poll.routineId||state.weekPlan?.[weekday(option.date)]||'',capacity:poll.capacity,deadlineMinutes:0,version:1,creator:user.userId,participants:[user.userId],cancelled:false};
    if(state.sessions.length>=1000)throw new AppError('크루 일정이 가득 찼어요.');
    state.sessions.push(session);poll.status='confirmed';poll.sessionId=session.id;
    await queueSessionNotifications(db,row.id,session,'updated',poll.options.flatMap(o=>o.votes));
    await queueSessionNotifications(db,row.id,session,'reminder');
   }
  }
 }
 if(input.action==='saveSession'){
  if(input.revision!==row.revision)throw new AppError('일정이 변경됐어요. 새로 확인한 뒤 저장해주세요.',409);
  if(input.session.routineId&&!state.routines.some(r=>r.id===input.session.routineId))throw new AppError('루틴을 다시 선택해주세요.');
  const existing=input.session.id?state.sessions.find(s=>s.id===input.session.id):undefined;
  if(input.session.id&&!existing)throw new AppError('일정을 찾을 수 없어요.',404);
  if(existing?.cancelled)throw new AppError('취소된 일정은 수정할 수 없어요.');
  if(existing){
   if(input.repeat)throw new AppError('기존 일정에 반복 조건을 추가할 수 없어요. 새 반복 일정을 만들어주세요.');
   if(input.scope==='future'&&input.session.date!==existing.date)throw new AppError('반복 일정 전체 수정에서는 날짜를 유지해주세요.');
   const targets=input.scope==='future'&&existing.seriesId?state.sessions.filter(s=>s.seriesId===existing.seriesId&&!s.cancelled&&s.date>=existing.date):[existing];
   for(const session of targets){
    if(input.session.capacity!==null&&session.participants.length>input.session.capacity)throw new AppError('참여 중인 인원보다 정원을 줄일 수 없어요.');
    await auditMission(db,row.id,user.userId,'scheduleEdited',{before:{date:session.date,time:session.time},after:{date:input.session.date,time:input.session.time}},session.id);
    const ownDate=session.date;
    session.responses={};
    Object.assign(session,input.session,{id:session.id,date:input.scope==='future'?ownDate:input.session.date,version:(session.version??1)+1});
    await invalidateSessionNotifications(db,row.id,session.id);
    await queueSessionNotifications(db,row.id,session,'updated');
    await queueSessionNotifications(db,row.id,session,'reminder');
   }
  }else{
   let dates=[input.session.date];
   if(input.repeat){try{dates=repeatDates(input.session.date,input.repeat.until,input.repeat.weekdays);}catch(error){throw new AppError((error as Error).message);}}
   if(state.sessions.length+dates.length>1000)throw new AppError('크루 일정은 1000개까지 만들 수 있어요.');
   const seriesId=input.repeat?crypto.randomUUID():undefined;
   for(const date of dates){const session:Session={...input.session,date,id:crypto.randomUUID(),routineId:input.session.routineId||state.weekPlan?.[weekday(date)]||'',creator:user.userId,participants:[user.userId],cancelled:false,version:1,seriesId};state.sessions.push(session);await queueSessionNotifications(db,row.id,session,'reminder');}
  }
 }
 if(input.action==='sessionResponse'){
  const session=state.sessions.find(s=>s.id===input.sessionId);
  if(!session)throw new AppError('일정을 찾을 수 없어요.',404);
  if((session.version??1)!==input.version)throw new AppError('일정이 바뀌었어요. 새 시간을 확인하고 다시 응답해주세요.',409);
  if(!responseOpen(session))throw new AppError('참석 확인은 운동 시작 24시간 전부터 시작 전까지 가능해요.');
  if(!session.participants.includes(user.userId)&&session.responses?.[user.userId]!=='notGoing')throw new AppError('먼저 이 일정에 참여해주세요.',403);
  if(input.response==='going'&&!session.participants.includes(user.userId)){
   if(session.capacity!=null&&session.participants.length>=session.capacity)throw new AppError('정원이 찼어요. 참석으로 변경할 수 없어요.',409);
   session.participants.push(user.userId);
   await queueSessionNotifications(db,row.id,session,'reminder',[user.userId]);
  }
  if(input.response==='notGoing'){
   session.participants=session.participants.filter(id=>id!==user.userId);
   await invalidateSessionNotifications(db,row.id,session.id,user.userId);
  }
  session.responses={...session.responses,[user.userId]:input.response};
 }
 if(input.action==='importRoutines'){
  if(input.revision!==row.revision)throw new AppError('크루 루틴이 바뀌었어요. 목록을 다시 확인한 뒤 가져와주세요.',409);
  if(state.routines.length+input.routines.length>50)throw new AppError('공통 루틴은 최대 50개까지 저장할 수 있어요.');
  if(input.routines.some(r=>state.routines.some(old=>old.id===r.id)))throw new AppError('이미 저장된 가져오기예요. 루틴 목록을 확인해주세요.',409);
  state.routines.push(...input.routines.map(r=>({...r,version:1})));
 }
 if(input.action==='attendance'||input.action==='cancelSession'){
  const session=state.sessions.find(s=>s.id===input.sessionId);if(!session)throw new AppError('일정을 찾을 수 없어요.',404);
  if(session.cancelled)throw new AppError('취소된 일정이에요.');
  if(input.action==='cancelSession'){
   if(session.creator!==user.userId&&row.owner!==user.userId)throw new AppError('작성자 또는 크루장만 취소할 수 있어요.',403);
   const targets=input.scope==='future'&&session.seriesId?state.sessions.filter(s=>s.seriesId===session.seriesId&&!s.cancelled&&s.date>=session.date):[session];
   for(const target of targets){target.cancelled=true;target.version=(target.version??1)+1;await invalidateSessionNotifications(db,row.id,target.id);await queueSessionNotifications(db,row.id,target,'cancelled');}
  }else{
   if(input.participating&&!session.participants.includes(user.userId)){
    if(participationClosed(session))throw new AppError('참여 신청이 마감됐어요.');
    if(session.capacity!==null&&session.capacity!==undefined&&session.participants.length>=session.capacity)throw new AppError('참여 정원이 가득 찼어요.',409);
    session.participants.push(user.userId);await queueSessionNotifications(db,row.id,session,'reminder',[user.userId]);
   }else if(!input.participating){session.participants=session.participants.filter(id=>id!==user.userId);await invalidateSessionNotifications(db,row.id,session.id,user.userId);}
   if(session.responses)delete session.responses[user.userId];
  }
 }
 const result=await db.prepare('UPDATE crews SET state=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(state),row.id,row.revision).run();
 if(!result.meta.changes)throw new AppError('친구의 변경사항이 먼저 저장됐어요. 새로고침 후 다시 시도해주세요.',409);
 return {crewId:row.id};
}
