import {auditMission} from './mission-audit';
import {coffeeSettlement,type CoffeeSettlement} from './coffee-settlement';
import {z} from 'zod';
import type {Database} from '../db/adapter';
import {AppError} from './gym-service';
import {localDate,type CrewState} from './gym-model';
import {sessionStart} from './planning';
export type Checkin={crew_id:string;session_id:string;user_id:string;session_version:number;workout_date:string;checked_at:number|string;confirmed_by:string|null;confirmed_at:number|string|null};
export type Mission={id:string;crew_id:string;creator:string;title:string;starts:string;ends:string;target:number;promise:string;cancelled:number;coffee_price:number;rules_version:number;settlement:CoffeeSettlement|null;progress:{userId:string;days:number;withdrawn:boolean;forfeited?:boolean;name?:string}[];finished:boolean};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;});
const actionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('dispute'),missionId:z.string(),reason:z.string().trim().min(3).max(1000)}),
 z.object({action:z.literal('resolveDispute'),missionId:z.string(),disputeId:z.string(),reply:z.string().trim().min(3).max(1000)}),
 z.object({action:z.literal('cheer'),sessionId:z.string(),userId:z.string()}),
 z.object({action:z.literal('finalizeCoffee'),missionId:z.string()}),
 z.object({action:z.literal('coffeeProgress'),missionId:z.string(),kind:z.enum(['bought','received','shareSent','shareReceived']),targetId:z.string()}),
 z.object({action:z.literal('checkin'),sessionId:z.string()}),
 z.object({action:z.literal('confirm'),sessionId:z.string(),userId:z.string()}),
 z.object({action:z.literal('create'),title:z.string().trim().min(1).max(80),starts:date,ends:date,target:z.number().int().min(1).max(90),promise:z.string().trim().max(200),coffeePrice:z.number().int().min(0).max(20000).default(0),accepted:z.literal(true)}),
 z.object({action:z.literal('join'),missionId:z.string(),accepted:z.literal(true)}),
 z.object({action:z.literal('withdraw'),missionId:z.string()}),
 z.object({action:z.literal('cancel'),missionId:z.string()}),
]);
async function group(db:Database,crewId:string,userId:string,lock=false){const row=await db.prepare('SELECT c.* FROM crews c JOIN members m ON m.crew_id=c.id WHERE c.id=? AND m.user_id=? AND m.active=1 AND c.archived=0'+(lock?' FOR UPDATE OF c':'')).bind(crewId,userId).first<{id:string;owner:string;state:string}>();if(!row)throw new AppError('이 크루에 접근할 수 없어요.',403);return {...row,state:JSON.parse(row.state) as CrewState};}
export async function missionSnapshot(db:Database,crewId:string,userId:string,now=Date.now()){
 const crew=await group(db,crewId,userId);
 const members=(await db.prepare('SELECT user_id FROM members WHERE crew_id=? AND active=1').bind(crewId).all<{user_id:string}>()).results.map(r=>r.user_id);
 const records=(await db.prepare('SELECT * FROM checkins WHERE crew_id=? ORDER BY checked_at DESC').bind(crewId).all<Checkin>()).results.filter(c=>!!c.confirmed_by||(members.includes(c.user_id)&&crew.state.sessions.some(s=>s.id===c.session_id&&!s.cancelled&&(s.version??1)===c.session_version&&s.participants.includes(c.user_id))));
 const missions=(await db.prepare('SELECT * FROM missions WHERE crew_id=? ORDER BY created_at DESC LIMIT 50').bind(crewId).all<Mission>()).results;
 const enrollments=(await db.prepare('SELECT mm.* FROM mission_members mm JOIN missions m ON m.id=mm.mission_id WHERE m.crew_id=?').bind(crewId).all<{mission_id:string;user_id:string;joined_at:number|string;withdrawn:number;forfeited:number;participant_name:string}>()).results;
 const events=(await db.prepare('SELECT id,actor,kind,details,created_at,session_id,mission_id FROM mission_events WHERE crew_id=? ORDER BY created_at DESC LIMIT 50').bind(crewId).all()).results;
 const disputes=(await db.prepare('SELECT d.* FROM mission_disputes d JOIN missions m ON m.id=d.mission_id WHERE m.crew_id=? ORDER BY d.created_at DESC').bind(crewId).all()).results;
 const cheers=(await db.prepare('SELECT session_id,target_id,actor FROM cheers WHERE crew_id=?').bind(crewId).all()).results;
 return {checkins:records,events,disputes,cheers,missions:missions.map(m=>({...m,settlement:typeof m.settlement==='string'?JSON.parse(m.settlement):m.settlement,finished:now>=Date.parse(m.ends+'T23:59:59+09:00')+12*3600000,progress:(typeof m.settlement==='string'?JSON.parse(m.settlement):m.settlement)?.progress??enrollments.filter(p=>p.mission_id===m.id).map(p=>({userId:p.user_id,name:p.participant_name,forfeited:!!p.forfeited,withdrawn:!!p.withdrawn||(!members.includes(p.user_id)&&m.rules_version<2),days:p.forfeited?0:new Set(records.filter(c=>c.user_id===p.user_id&&c.confirmed_by&&c.workout_date>=m.starts&&c.workout_date<=m.ends&&Number(c.checked_at)>=Number(p.joined_at)).map(c=>c.workout_date)).size}))}))};
}
export async function missionAction(db:Database,crewId:string,userId:string,raw:unknown,now=Date.now()){
 const parsed=actionSchema.safeParse(raw);if(!parsed.success)throw new AppError('입력 내용과 참여 동의를 확인해주세요.');
 return db.transaction(async tx=>{
 const crew=await group(tx,crewId,userId,true),input=parsed.data;
 if(input.action==='cheer'){if(input.userId===userId)throw new AppError('친구의 출석에 응원을 보내주세요.');const target=await tx.prepare('SELECT user_id FROM checkins WHERE crew_id=? AND session_id=? AND user_id=? AND confirmed_by IS NOT NULL').bind(crewId,input.sessionId,input.userId).first();if(!target)throw new AppError('확인된 출석에만 응원할 수 있어요.');await tx.prepare('INSERT INTO cheers(crew_id,session_id,target_id,actor,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(crewId,input.sessionId,input.userId,userId,now).run();return;}
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
  }await auditMission(tx,crewId,userId,input.action,{target:input.action==='confirm'?input.userId:userId},session.id);return;
 }
 if(input.action==='create'){
  const duration=(Date.parse(input.ends)-Date.parse(input.starts))/86400000+1;
  if(input.starts<localDate(new Date(now))||duration<1||duration>90||input.target>duration)throw new AppError('오늘 이후, 최대 90일 범위에서 목표 일수를 설정해주세요.');
  const count=await tx.prepare('SELECT count(*)::int AS n FROM missions WHERE crew_id=? AND cancelled=0 AND ends>=?').bind(crewId,localDate(new Date(now))).first<{n:number}>();if((count?.n??0)>=20)throw new AppError('진행 중인 미션은 크루당 최대 20개입니다.');
  const id=crypto.randomUUID();await tx.prepare('INSERT INTO missions(id,crew_id,creator,title,starts,ends,target,promise,coffee_price,rules_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,2,?)').bind(id,crewId,userId,input.title,input.starts,input.ends,input.target,input.promise,input.coffeePrice,now).run();await tx.prepare('INSERT INTO mission_members(mission_id,user_id,joined_at,participant_name) VALUES(?,?,?,?)').bind(id,userId,now,(await tx.prepare('SELECT name FROM members WHERE crew_id=? AND user_id=?').bind(crewId,userId).first<{name:string}>())?.name??'크루원').run();return;
 }
 const mission=await tx.prepare('SELECT * FROM missions WHERE id=? AND crew_id=?').bind(input.missionId,crewId).first<Mission>();if(!mission||mission.cancelled)throw new AppError('활성 미션이 아니에요.');
 if(input.action==='dispute'){
  if(mission.settlement)throw new AppError('정산 확정 전 이의제기만 접수할 수 있어요.');
  if(!await tx.prepare('SELECT user_id FROM mission_members WHERE mission_id=? AND user_id=?').bind(mission.id,userId).first())throw new AppError('미션 참여자만 이의를 남길 수 있어요.',403);
  const old=await tx.prepare('SELECT id FROM mission_disputes WHERE mission_id=? AND user_id=?').bind(mission.id,userId).first();if(old)throw new AppError('이미 접수된 이의가 있어요.');
  await tx.prepare('INSERT INTO mission_disputes(id,mission_id,user_id,reason,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),mission.id,userId,input.reason,now).run();await auditMission(tx,crewId,userId,'dispute',{reason:input.reason},undefined,mission.id);return;
 }
 if(input.action==='resolveDispute'){
  if(mission.creator!==userId&&crew.owner!==userId)throw new AppError('작성자 또는 크루장이 검토할 수 있어요.',403);
  const r=await tx.prepare("UPDATE mission_disputes SET status='resolved',reply=?,reviewer=? WHERE id=? AND mission_id=? AND status='open'").bind(input.reply,userId,input.disputeId,mission.id).run();if(!r.meta.changes)throw new AppError('미처리 이의를 찾지 못했어요.');await auditMission(tx,crewId,userId,'resolveDispute',{reply:input.reply},undefined,mission.id);return;
 }
 if(input.action==='finalizeCoffee'){
  if(mission.creator!==userId&&crew.owner!==userId)throw new AppError('작성자 또는 크루장만 결과를 확정할 수 있어요.',403);
  if(mission.settlement)return;
  if(await tx.prepare("SELECT id FROM mission_disputes WHERE mission_id=? AND status='open'").bind(mission.id).first())throw new AppError('접수된 이의를 검토한 후 정산을 확정해주세요.');
  if(!mission.coffee_price)throw new AppError('커피 정산 미션이 아니에요.');
  const summary=(await missionSnapshot(tx,crewId,userId,now)).missions.find(m=>m.id===mission.id)!;
  if(!summary.finished)throw new AppError('출석 확인 기간이 끝난 뒤 확정해주세요.');
  await tx.prepare('UPDATE missions SET settlement=? WHERE id=?').bind(JSON.stringify(coffeeSettlement(summary.progress,mission.target,mission.coffee_price,now)),mission.id).run();return;
 }
 if(input.action==='coffeeProgress'){
  if(!mission.settlement)throw new AppError('먼저 결과를 확정해주세요.');
  const settled:CoffeeSettlement=typeof mission.settlement==='string'?JSON.parse(mission.settlement):mission.settlement;
  if(input.kind==='bought'||input.kind==='received'){
   const cup=settled.cups.find(c=>c.userId===input.targetId);if(!cup)throw new AppError('정산 대상을 확인해주세요.');
   if(input.kind==='bought'){if(settled.buyer!==userId)throw new AppError('구매 담당자만 표시할 수 있어요.',403);cup.bought=true;}
   else {if(cup.userId!==userId)throw new AppError('받는 사람만 수령 확인할 수 있어요.',403);if(!cup.bought)throw new AppError('구매 완료 후 수령 확인해주세요.');cup.received=true;}
  }else{
   const share=settled.shares.find(c=>c.userId===input.targetId);if(!share)throw new AppError('정산 대상을 확인해주세요.');
   if(input.kind==='shareSent'){if(share.userId!==userId)throw new AppError('본인 부담액만 표시할 수 있어요.',403);share.sent=true;}
   else {if(settled.buyer!==userId)throw new AppError('구매 담당자만 확인할 수 있어요.',403);if(!share.sent)throw new AppError('전달 완료 표시 후 확인해주세요.');share.received=true;}
  }
  await tx.prepare('UPDATE missions SET settlement=? WHERE id=?').bind(JSON.stringify(settled),mission.id).run();return;
 }
 if(input.action==='cancel'){if(mission.settlement)throw new AppError('정산이 확정된 미션은 취소할 수 없어요.');if(mission.creator!==userId&&crew.owner!==userId)throw new AppError('작성자 또는 크루장만 미션을 취소할 수 있어요.',403);await tx.prepare('UPDATE missions SET cancelled=1 WHERE id=?').bind(mission.id).run();return;}
 if(now>Date.parse(mission.ends+'T23:59:59+09:00'))throw new AppError('이미 종료된 미션이에요.');
 if(input.action==='join'&&mission.rules_version>=2&&now>=Date.parse(mission.starts+'T00:00:00+09:00'))throw new AppError('시작된 미션에는 새로 참여할 수 없어요. 다음 미션에 참여해주세요.');
 if(input.action==='withdraw'&&mission.rules_version>=2&&now>=Date.parse(mission.starts+'T00:00:00+09:00')){await tx.prepare('UPDATE mission_members SET forfeited=1 WHERE mission_id=? AND user_id=? AND withdrawn=0').bind(mission.id,userId).run();await auditMission(tx,crewId,userId,'forfeit',{},undefined,mission.id);return;}
 if(input.action==='join')await tx.prepare('INSERT INTO mission_members(mission_id,user_id,joined_at,participant_name) VALUES(?,?,?,?) ON CONFLICT(mission_id,user_id) DO UPDATE SET withdrawn=0,joined_at=EXCLUDED.joined_at WHERE mission_members.withdrawn=1 AND mission_members.forfeited=0').bind(mission.id,userId,now,(await tx.prepare('SELECT name FROM members WHERE crew_id=? AND user_id=?').bind(crewId,userId).first<{name:string}>())?.name??'크루원').run();
 else await tx.prepare('UPDATE mission_members SET withdrawn=1 WHERE mission_id=? AND user_id=?').bind(mission.id,userId).run();
 });
}
