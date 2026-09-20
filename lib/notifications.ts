import type { Database } from '../db/adapter';
import type { Session } from './gym-model';
import { sessionStart } from './planning';

export type NotificationSettings = { enabled: number; push_enabled: number; reminder_minutes: number };
export async function settings(db: Database, userId: string): Promise<NotificationSettings> {
 return await db.prepare('SELECT enabled,push_enabled,reminder_minutes FROM notification_preferences WHERE user_id=?').bind(userId).first<NotificationSettings>() ?? {enabled:1,push_enabled:0,reminder_minutes:10};
}
export async function inbox(db: Database,userId: string) {
 const rows=await db.prepare(`SELECT n.id,n.crew_id AS "crewId",n.session_id AS "sessionId",n.title,n.body,n.due_at AS "dueAt",n.read_at AS "readAt",n.push_state AS "pushState"
 FROM notifications n JOIN members m ON m.crew_id=n.crew_id AND m.user_id=n.user_id
 JOIN crews c ON c.id=n.crew_id WHERE n.user_id=? AND m.active=1 AND c.archived=0 AND n.due_at<=? AND n.push_state!='invalid'
 ORDER BY n.due_at DESC LIMIT 100`).bind(userId,Date.now()).all();
 return {items:rows.results,settings:await settings(db,userId)};
}
export async function invalidateSessionNotifications(db: Database,crewId: string,sessionId: string,userId?: string) {
 const suffix=userId?' AND user_id=?':'';
 await db.prepare(`UPDATE notifications SET push_state='invalid' WHERE crew_id=? AND session_id=? AND kind='reminder'${suffix}`).bind(crewId,sessionId,...(userId?[userId]:[])).run();
}
export async function queueSessionNotifications(db: Database,crewId: string,session: Session,kind: 'reminder'|'updated'|'cancelled',recipients=session.participants) {
 const members=(await db.prepare('SELECT user_id FROM members WHERE crew_id=? AND active=1').bind(crewId).all<{user_id:string}>()).results;
 for(const userId of [...new Set(recipients)].filter(id=>members.some(m=>m.user_id===id))){
  const preference=await settings(db,userId);if(!preference.enabled)continue;
  const start=sessionStart(session);const now=Date.now();
  if(kind==='reminder'&&(session.cancelled||start<=now))continue;
  const due=kind==='reminder'?Math.max(now,start-preference.reminder_minutes*60000):now;
  const title=kind==='reminder'?'운동 약속을 준비하세요':kind==='updated'?'운동 약속이 변경됐어요':'운동 약속이 취소됐어요';
  const body=`${session.title} · ${session.date} ${session.time} (서울)`;
  const key=`${crewId}:${session.id}:${session.version??1}:${kind}:${userId}`;
  await db.prepare(`INSERT INTO notifications(id,event_key,crew_id,user_id,session_id,kind,title,body,due_at,expires_at,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key) DO UPDATE SET due_at=EXCLUDED.due_at,push_state=CASE WHEN notifications.push_state='invalid' THEN 'queued' ELSE notifications.push_state END`)
   .bind(crypto.randomUUID(),key,crewId,userId,session.id,kind,title,body,due,kind==='reminder'?start:now+86400000,now).run();
 }
}
