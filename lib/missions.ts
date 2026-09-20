import {z} from 'zod';
import type {Database} from '../db/adapter';
import {AppError} from './gym-service';
import {localDate,type CrewState} from './gym-model';
import {sessionStart} from './planning';
export type Checkin={crew_id:string;session_id:string;user_id:string;session_version:number;workout_date:string;checked_at:number|string;confirmed_by:string|null;confirmed_at:number|string|null};
export type Mission={id:string;crew_id:string;creator:string;title:string;starts:string;ends:string;target:number;promise:string;cancelled:number;progress:{userId:string;days:number;withdrawn:boolean}[];finished:boolean};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;});
const actionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('checkin'),sessionId:z.string()}),
 z.object({action:z.literal('confirm'),sessionId:z.string(),userId:z.string()}),
 z.object({action:z.literal('create'),title:z.string().trim().min(1).max(80),starts:date,ends:date,target:z.number().int().min(1).max(90),promise:z.string().trim().max(200),accepted:z.literal(true)}),
 z.object({action:z.literal('join'),missionId:z.string(),accepted:z.literal(true)}),
 z.object({action:z.literal('withdraw'),missionId:z.string()}),
 z.object({action:z.literal('cancel'),missionId:z.string()}),
]);
async function group(db:Database,crewId:string,userId:string,lock=false){const row=await db.prepare('SELECT c.* FROM crews c JOIN members m ON m.crew_id=c.id WHERE c.id=? AND m.user_id=? AND m.active=1 AND c.archived=0'+(lock?' FOR UPDATE OF c':'')).bind(crewId,userId).first<{id:string;owner:string;state:string}>();if(!row)throw new AppError('이 크루에 접근할 수 없어요.',403);return {...row,state:JSON.parse(row.state) as CrewState};}
export async function missionSnapshot(db:Database,crewId:string,userId:string,now=Date.now()){
 const crew=await group(db,crewId,userId);
 const members=(await db.prepare('SELECT user_id FROM members WHERE crew_id=? AND active=1').bind(crewId).all<{user_id:string}>()).results.map(r=>r.user_id);
 const records=(await db.prepare('SELECT * FROM checkins WHERE crew_id=? ORDER BY checked_at DESC').bind(crewId).all<Checkin>()).results.filter(c=>members.includes(c.user_id)&&crew.state.sessions.some(s=>s.id===c.session_id&&!s.cancelled&&(s.version??1)===c.session_version&&s.participants.includes(c.user_id)));
 const missions=(await db.prepare('SELECT * FROM missions WHERE crew_id=? ORDER BY created_at DESC LIMIT 50').bind(crewId).all<Mission>()).results;
 const enrollments=(await db.prepare('SELECT mm.* FROM mission_members mm JOIN missions m ON m.id=mm.mission_id WHERE m.crew_id=?').bind(crewId).all<{mission_id:string;user_id:string;joined_at:number|string;withdrawn:number}>()).results;
 return {checkins:records,missions:missions.map(m=>({...m,finished:now>=Date.parse(m.ends+'T23:59:59+09:00')+12*3600000,progress:enrollments.filter(p=>p.mission_id===m.id).map(p=>({userId:p.user_id,withdrawn:!!p.withdrawn||!members.includes(p.user_id),days:new Set(records.filter(c=>c.user_id===p.user_id&&c.confirmed_by&&c.workout_date>=m.starts&&c.workout_date<=m.ends&&Number(c.checked_at)>=Number(p.joined_at)).map(c=>c.workout_date)).size}))}))};
}
export async function missionAction(db:Database,crewId:string,userId:string,raw:unknown,now=Date.now()){
 const parsed=actionSchema.safeParse(raw);if(!parsed.success)throw new AppError('입력 내용과 참여 동의를 확인해주세요.');
 return db.transaction(async tx=>{
 const crew=await group(tx,crewId,userId,true),input=parsed.data;
 if(input.action==='checkin'||input.action==='confirm'){
  const session=crew.state.sessions.find(s=>s.id===input.sessionId&&!s.cancelled);if(!session)throw new AppError('진행할 수 있는 일정을 찾지 못했어요.');
  const start=sessionStart(session);if(now<start-30*60000||now>start+12*3600000)throw new AppError('출석과 확인은 시작 30분 전부터 시작 후 12시간까지 가능해요.');
  if(input.action==='checkin'){
   if(!session.participants.includes(userId))throw new AppError('먼저 일정에 참여해주세요.');
   await tx.prepare('INSERT INTO checkins(crew_id,session_id,user_id,session_version,workout_date,checked_at) VALUES(?,?,?,?,?,?) ON CONFLICT(crew_id,session_id,user_id) DO UPDATE SET session_version=EXCLUDED.session_version,workout_date=EXCLUDED.workout_date,checked_at=EXCLUDED.checked_at,confirmed_by=NULL,confirmed_at=NULL WHERE checkins.session_version!=EXCLUDED.session_version').bind(crewId,session.id,userId,session.version??1,session.date,now).run();
  }else{
   if(input.userId===userId)throw new AppError('내 출석은 다른 크루원이 확인해야 해요.');
   if(!session.participants.includes(input.userId)||!await tx.prepare('SELECT user_id FROM members WHERE crew_id=? AND user_id=? AND active=1').bind(crewId,input.userId).first())throw new AppError('현재 참여 중인 친구의 출석만 확인할 수 있어요.');
   const r=await tx.prepare('UPDATE checkins SET confirmed_by=?,confirmed_at=? WHERE crew_id=? AND session_id=? AND user_id=? AND session_version=? AND confirmed_by IS NULL').bind(userId,now,crewId,session.id,input.userId,session.version??1).run();if(!r.meta.changes)throw new AppError('이미 확인했거나 일정이 바뀌었어요. 출석을 다시 확인해주세요.',409);
  }return;
 }
 if(input.action==='create'){
  const duration=(Date.parse(input.ends)-Date.parse(input.starts))/86400000+1;
  if(input.starts<localDate(new Date(now))||duration<1||duration>90||input.target>duration)throw new AppError('오늘 이후, 최대 90일 범위에서 목표 일수를 설정해주세요.');
  const count=await tx.prepare('SELECT count(*)::int AS n FROM missions WHERE crew_id=? AND cancelled=0 AND ends>=?').bind(crewId,localDate(new Date(now))).first<{n:number}>();if((count?.n??0)>=20)throw new AppError('진행 중인 미션은 크루당 최대 20개입니다.');
  const id=crypto.randomUUID();await tx.prepare('INSERT INTO missions(id,crew_id,creator,title,starts,ends,target,promise,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,crewId,userId,input.title,input.starts,input.ends,input.target,input.promise,now).run();await tx.prepare('INSERT INTO mission_members(mission_id,user_id,joined_at) VALUES(?,?,?)').bind(id,userId,now).run();return;
 }
 const mission=await tx.prepare('SELECT * FROM missions WHERE id=? AND crew_id=?').bind(input.missionId,crewId).first<Mission>();if(!mission||mission.cancelled)throw new AppError('활성 미션이 아니에요.');
 if(input.action==='cancel'){if(mission.creator!==userId&&crew.owner!==userId)throw new AppError('작성자 또는 크루장만 미션을 취소할 수 있어요.',403);await tx.prepare('UPDATE missions SET cancelled=1 WHERE id=?').bind(mission.id).run();return;}
 if(now>Date.parse(mission.ends+'T23:59:59+09:00'))throw new AppError('이미 종료된 미션이에요.');
 if(input.action==='join')await tx.prepare('INSERT INTO mission_members(mission_id,user_id,joined_at) VALUES(?,?,?) ON CONFLICT(mission_id,user_id) DO UPDATE SET withdrawn=0,joined_at=EXCLUDED.joined_at WHERE mission_members.withdrawn=1').bind(mission.id,userId,now).run();
 else await tx.prepare('UPDATE mission_members SET withdrawn=1 WHERE mission_id=? AND user_id=?').bind(mission.id,userId).run();
 });
}
