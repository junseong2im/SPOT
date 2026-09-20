import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
const out=await build({entryPoints:['lib/gym-service.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {act,snapshot}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

test('friend journey: invite, join, create workout, attend, copy and personalize, reminder inbox',async()=>{
 const fixture=await createTestDatabase(),db=fixture.db;
 try {
  const host={userId:'host',displayName:'Host'},friend={userId:'friend',displayName:'Friend'};
  const {crewId}=await act(db,host,{action:'createCrew',name:'Isolated QA',nickname:'Host'});
  let crew=(await snapshot(db,host,crewId)).crew;
  await act(db,friend,{action:'joinCrew',invite:crew.invite,nickname:'Friend'});
  await act(db,friend,{action:'notificationSettings',enabled:true,pushEnabled:false,reminderMinutes:1440});
  crew=(await snapshot(db,host,crewId)).crew;
  const when=new Date(Date.now()+2*3600000+9*3600000).toISOString();
  await act(db,host,{action:'saveSession',crewId,revision:crew.revision,session:{id:'',title:'QA workout',date:when.slice(0,10),time:when.slice(11,16),routineId:crew.state.routines[0].id,capacity:2,deadlineMinutes:0}});
  crew=(await snapshot(db,friend,crewId)).crew;
  const session=crew.state.sessions[0];
  await act(db,friend,{action:'attendance',crewId,sessionId:session.id,participating:true});
  const base=crew.state.routines[0];
  await act(db,friend,{action:'copyRoutine',crewId,routineId:base.id,version:base.version});
  const mine=(await snapshot(db,friend,crewId)).crew.personal[0];
  await act(db,friend,{action:'savePersonal',crewId,revision:mine.revision,routine:{...mine,exercises:mine.exercises.map((e,i)=>i?e:{...e,sets:2})}});
  const result=await snapshot(db,friend,crewId);
  assert.deepEqual(new Set(result.crew.state.sessions[0].participants),new Set(['host','friend']));
  assert.equal(result.crew.personal[0].exercises[0].sets,2);
  assert.equal(result.crew.state.routines[0].exercises[0].sets,base.exercises[0].sets);
  assert.ok(result.notifications.items.some(n=>n.sessionId===session.id));
 } finally {await fixture.close();}
});

test('service worker displays push with no page open and opens safe notification link',async()=>{
 const handlers={},shown=[],opened=[];let pending;
 const self={location:{origin:'https://spot.example'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(await readFile('public/sw.js','utf8'),{self,URL});
 const url='https://spot.example/?crew=test&session=workout';
 handlers.push({data:{json:()=>({id:'one',title:'운동 알림',body:'10분 전',url})},waitUntil:p=>pending=p});await pending;
 assert.equal(shown.length,1);assert.equal(shown[0][0],'운동 알림');
 handlers.notificationclick({notification:{data:{url},close(){}},waitUntil:p=>pending=p});await pending;
 assert.equal(opened[0],url);
 handlers.notificationclick({notification:{data:{url:'https://malicious.example'},close(){}},waitUntil:p=>pending=p});await pending;
 assert.equal(opened[1],'https://spot.example/');
});
