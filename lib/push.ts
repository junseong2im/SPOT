import webpush from 'web-push';
import type { Database } from '../db/adapter';
import { createHash, timingSafeEqual } from 'node:crypto';

export function validPushEndpoint(value:string) {
 try { const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(
  url.hostname==='fcm.googleapis.com'||url.hostname==='updates.push.services.mozilla.com'||url.hostname==='web.push.apple.com'||url.hostname.endsWith('.push.apple.com')||url.hostname.endsWith('.notify.windows.com')
 ); }catch{return false;}
}
export function authorizedJob(header:string|null,secret:string|undefined) {
 if(!secret||secret.length<32||!header)return false;
 const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(header);
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
type Sender=(subscription:webpush.PushSubscription,payload:string)=>Promise<unknown>;
type NotificationRow={id:string;user_id:string;crew_id:string;session_id:string;title:string;body:string;kind:string;expires_at:number|string};
export async function dispatchPush(db:Database,options:{enabled:boolean;send:Sender;now?:number}) {
 if(!options.enabled)return {disabled:true,accepted:0,failed:0,skipped:0};
 const now=options.now??Date.now();
 // A crashed request may already have reached the device. Never blindly resend it.
 await db.prepare("UPDATE notifications SET push_state='unknown',result='worker_interrupted' WHERE push_state='sending' AND lease_until<?").bind(now).run();
 const due=(await db.prepare("SELECT id FROM notifications WHERE push_state='queued' AND due_at<=? ORDER BY due_at LIMIT 100").bind(now).all<{id:string}>()).results;
 const counts={disabled:false,accepted:0,failed:0,skipped:0};
 const stopAt=Date.now()+45000;
 for(const item of due){
  if(Date.now()>=stopAt)break;
  const notification=await db.prepare("UPDATE notifications SET push_state='sending',lease_until=? WHERE id=? AND push_state='queued' RETURNING id,user_id,crew_id,session_id,title,body,kind,expires_at").bind(now+120000,item.id).first<NotificationRow>();
  if(!notification)continue;
  const allowed=await db.prepare('SELECT m.user_id FROM members m JOIN crews c ON c.id=m.crew_id JOIN notification_preferences p ON p.user_id=m.user_id WHERE m.crew_id=? AND m.user_id=? AND m.active=1 AND c.archived=0 AND p.enabled=1 AND p.push_enabled=1').bind(notification.crew_id,notification.user_id).first();
  const subscriptions=(await db.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=? AND active=1').bind(notification.user_id).all<{id:string;endpoint:string;p256dh:string;auth:string}>()).results;
  if(!allowed||Number(notification.expires_at)<=now||!subscriptions.length){await db.prepare("UPDATE notifications SET push_state='skipped' WHERE id=? AND push_state='sending'").bind(notification.id).run();counts.skipped++;continue;}
  let accepted=0,failed=0;
  for(const subscription of subscriptions){
   if(Date.now()>=stopAt){failed++;continue;}
   if(!validPushEndpoint(subscription.endpoint)){failed++;continue;}
   const current=await db.prepare('SELECT push_state FROM notifications WHERE id=?').bind(notification.id).first<{push_state:string}>();if(current?.push_state!=='sending')break;
   try{
    await options.send({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify({id:notification.id,title:notification.title,body:notification.body,confirmAttendance:notification.kind==='reminder',url:`/?crew=${encodeURIComponent(notification.crew_id)}&session=${encodeURIComponent(notification.session_id)}`}));accepted++;
   }catch(error){
    const status=(error as {statusCode?:number}).statusCode;
    if(status===404||status===410)await db.prepare('UPDATE push_subscriptions SET active=0 WHERE id=?').bind(subscription.id).run();
    failed++;
   }
  }
  await db.prepare("UPDATE notifications SET push_state=?,result=? WHERE id=? AND push_state='sending'").bind(failed?'unknown':'sent',`${accepted} accepted, ${failed} failed`,notification.id).run();
  if(failed)counts.failed++;else counts.accepted++;
 }
 return counts;
}
export function pushConfigured(){return !!process.env.VAPID_PUBLIC_KEY&&!!process.env.VAPID_PRIVATE_KEY&&!!process.env.VAPID_SUBJECT;}
export async function sendWebPush(subscription:webpush.PushSubscription,payload:string){
 if(!pushConfigured())throw new Error('Push is not configured');
 return webpush.sendNotification(subscription,payload,{TTL:300,timeout:10000,topic:createHash('sha256').update(JSON.parse(payload).id).digest('base64url').slice(0,32),vapidDetails:{subject:process.env.VAPID_SUBJECT!,publicKey:process.env.VAPID_PUBLIC_KEY!,privateKey:process.env.VAPID_PRIVATE_KEY!}});
}
