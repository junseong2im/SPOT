import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
const out=await build({entryPoints:['lib/gym-service.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {act,snapshot}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
await build({entryPoints:['lib/push.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.data/tests/push.mjs'});
const {dispatchPush,validPushEndpoint,authorizedJob}=await import('../.data/tests/push.mjs');
let fixture,db;
before(async()=>{fixture=await createTestDatabase();db=fixture.db;});after(()=>fixture.close());
function future(minutes=120){const date=new Date(Date.now()+minutes*60000+9*3600000).toISOString();return {date:date.slice(0,10),time:date.slice(11,16)};}
async function ready({push=false}={}){
 const user={userId:crypto.randomUUID(),displayName:'Tester'};const {crewId}=await act(db,user,{action:'createCrew',name:'Notifications',nickname:'Tester'});
 await act(db,user,{action:'notificationSettings',enabled:true,pushEnabled:push,reminderMinutes:1440});
 if(push)await db.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,active,created_at) VALUES(?,?,?,?,?,1,?)').bind(crypto.randomUUID(),user.userId,'https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID(),'public-key','auth-key',Date.now()).run();
 await act(db,user,{action:'saveSession',crewId,revision:1,session:{id:'',title:'Upcoming workout',...future(),routineId:''}});
 const get=()=>snapshot(db,user,crewId);return {user,crewId,get,session:(await get()).crew.state.sessions[0]};
}
test('notifications are scoped to their user and unread status can only be changed by the owner',async()=>{
 const f=await ready();const current=await f.get();assert.equal(current.notifications.items.length,1);const item=current.notifications.items[0];
 await act(db,{userId:'other-user',displayName:'Other'},{action:'readNotifications',ids:[item.id]});assert.equal((await f.get()).notifications.items[0].readAt,null);
 await act(db,f.user,{action:'readNotifications',ids:[item.id]});assert.ok((await f.get()).notifications.items[0].readAt);
 assert.equal((await snapshot(db,{userId:'other-user',displayName:'Other'})).notifications.items.length,0);
});

test('new users receive reminders ten minutes before their workout and changing time reschedules it',async()=>{
 const user={userId:crypto.randomUUID(),displayName:'Ten minute tester'};
 const {crewId}=await act(db,user,{action:'createCrew',name:'Ten minute crew',nickname:'Tester'});
 await act(db,user,{action:'saveSession',crewId,revision:1,session:{id:'',title:'Workout',...future(120),routineId:''}});
 let state=await snapshot(db,user,crewId);const session=state.crew.state.sessions[0];
 let reminder=await db.prepare("SELECT due_at FROM notifications WHERE crew_id=? AND kind='reminder' AND push_state='queued'").bind(crewId).first();
 assert.equal(Number(reminder.due_at),Date.parse(`${session.date}T${session.time}:00+09:00`)-600000);
 await act(db,user,{action:'saveSession',crewId,revision:state.crew.revision,session:{...session,...future(180)}});
 state=await snapshot(db,user,crewId);const changed=state.crew.state.sessions[0];
 reminder=await db.prepare("SELECT due_at FROM notifications WHERE crew_id=? AND kind='reminder' AND push_state='queued'").bind(crewId).first();
 assert.equal(Number(reminder.due_at),Date.parse(`${changed.date}T${changed.time}:00+09:00`)-600000);
});
test('rescheduling and cancellation invalidate old reminders',async()=>{
 const f=await ready();const oldId=(await f.get()).notifications.items[0].id;
 await act(db,f.user,{action:'saveSession',crewId:f.crewId,revision:2,session:{...f.session,...future(180)}});
 assert.equal((await db.prepare('SELECT push_state FROM notifications WHERE id=?').bind(oldId).first()).push_state,'invalid');
 assert.ok(!(await f.get()).notifications.items.some(n=>n.id===oldId));
 await act(db,f.user,{action:'cancelSession',crewId:f.crewId,sessionId:f.session.id});
 assert.equal((await db.prepare("SELECT count(*)::int AS n FROM notifications WHERE crew_id=? AND kind='reminder' AND push_state!='invalid'").bind(f.crewId).first()).n,0);
 assert.ok((await f.get()).notifications.items.some(n=>n.title.includes('취소')));
});
test('turning off notifications invalidates pending reminders',async()=>{
 const f=await ready({push:true});await act(db,f.user,{action:'notificationSettings',enabled:false,pushEnabled:false,reminderMinutes:60});
 assert.equal((await db.prepare("SELECT count(*)::int AS n FROM notifications WHERE crew_id=? AND push_state='queued'").bind(f.crewId).first()).n,0);
});
test('push jobs require a strong configured secret and reject untrusted endpoints',()=>{
 assert.equal(authorizedJob('Bearer undefined',undefined),false);assert.equal(authorizedJob('Bearer short','short'),false);
 const secret='a'.repeat(40);assert.equal(authorizedJob('Bearer '+secret,secret),true);assert.equal(authorizedJob('Bearer '+secret+'b',secret),false);
 for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x'])assert.equal(validPushEndpoint(endpoint),false);
 assert.equal(validPushEndpoint('https://fcm.googleapis.com/fcm/send/test'),true);
 assert.equal(validPushEndpoint('https://web.push.apple.com/test'),true);
});
test('disabled dispatcher makes no network calls',async()=>{
 await ready({push:true});let calls=0;const result=await dispatchPush(db,{enabled:false,send:async()=>{calls++;}});assert.equal(result.disabled,true);assert.equal(calls,0);
});
test('concurrent dispatch does not send the same notification twice',async()=>{
 const f=await ready({push:true});const seen=new Map();
 const send=async(_,payload)=>{const n=JSON.parse(payload);seen.set(n.id,(seen.get(n.id)??0)+1);};
 await Promise.all([dispatchPush(db,{enabled:true,send}),dispatchPush(db,{enabled:true,send})]);
 const id=(await f.get()).notifications.items[0].id;assert.equal(seen.get(id),1);assert.equal((await db.prepare('SELECT push_state FROM notifications WHERE id=?').bind(id).first()).push_state,'sent');
});
test('expired subscriptions are deactivated and uncertain sends are not blindly retried',async()=>{
 const f=await ready({push:true});let calls=0;await dispatchPush(db,{enabled:true,send:async()=>{calls++;throw Object.assign(new Error('Gone'),{statusCode:410});}});
 assert.ok(calls>=1);assert.equal((await db.prepare('SELECT active FROM push_subscriptions WHERE user_id=?').bind(f.user.userId).first()).active,0);
 const before=calls;await dispatchPush(db,{enabled:true,send:async()=>{calls++;}});assert.equal(calls,before);
});
test('departed members never receive queued notifications',async()=>{
 const f=await ready({push:true});await act(db,f.user,{action:'leaveCrew',crewId:f.crewId});let received=false;
 await dispatchPush(db,{enabled:true,send:async(_,payload)=>{if(JSON.parse(payload).body.includes('Upcoming workout'))received=true;}});
 assert.equal(received,false);
});
