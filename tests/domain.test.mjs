import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createTestDatabase } from './database.mjs';

const output=await build({entryPoints:['lib/gym-service.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {act,snapshot}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
let fixtureDatabase;
let db;
const alice={userId:'alice',displayName:'Alice'},bob={userId:'bob',displayName:'Bob'},outsider={userId:'stranger',displayName:'Stranger'};
before(async()=>{fixtureDatabase=await createTestDatabase();db=fixtureDatabase.db;});
after(()=>fixtureDatabase.close());
async function fixture(){const {crewId}=await act(db,alice,{action:'createCrew',name:'Test crew',nickname:'앨리스'});const a=await snapshot(db,alice,crewId);await act(db,bob,{action:'joinCrew',invite:a.crew.invite,nickname:'밥'});return {crewId,getA:()=>snapshot(db,alice,crewId),getB:()=>snapshot(db,bob,crewId)};}

test('detailed prescriptions and program notes survive common save, personal copy and edit',async()=>{
 const f=await fixture();const routine={id:'detailed',name:'Day 1',subtitle:'가슴',notes:'훈련 철학\n실행 가이드',exercises:[{id:'press',name:'프레스',sets:3,reps:6,prescription:'웜업 3세트 / 탑세트 6~8회 / 백오프 2세트 8~10회, 휴식 90초'}]};
 await act(db,alice,{action:'saveCommon',crewId:f.crewId,routine,version:0});
 await act(db,bob,{action:'copyRoutine',crewId:f.crewId,routineId:routine.id,version:1});
 const copied=(await f.getB()).crew.personal.find(r=>r.id===routine.id);
 assert.equal(copied.notes,routine.notes);assert.equal(copied.exercises[0].prescription,routine.exercises[0].prescription);
 await act(db,bob,{action:'savePersonal',crewId:f.crewId,routine:{...copied,notes:'내 메모'},revision:1});
 assert.equal((await f.getA()).crew.state.routines.find(r=>r.id===routine.id).notes,routine.notes);
 assert.equal((await f.getB()).crew.personal.find(r=>r.id===routine.id).notes,'내 메모');
 await assert.rejects(act(db,alice,{action:'saveCommon',crewId:f.crewId,routine:{...routine,notes:'x'.repeat(12001)},version:1}));
});

test('invite membership is required; outsider cannot read or modify crew',async()=>{
 const f=await fixture();assert.equal((await f.getB()).crew.members.length,2);
 await assert.rejects(snapshot(db,outsider,f.crewId),e=>e.status===403);
 await assert.rejects(act(db,outsider,{action:'profile',crewId:f.crewId,name:'Intruder'}),e=>e.status===403);
 await assert.rejects(act(db,outsider,{action:'joinCrew',invite:'invalid-invitation-code',nickname:'x'}),e=>e.status===404);
 await act(db,bob,{action:'joinCrew',invite:(await f.getA()).crew.invite,nickname:'another'});assert.equal((await f.getB()).crew.members.length,2);
});
test('personal edits never mutate the common routine or another member; sync is explicit',async()=>{
 const f=await fixture();const original=(await f.getA()).crew.state.routines[0];
 for(const user of [alice,bob])await act(db,user,{action:'copyRoutine',crewId:f.crewId,routineId:original.id,version:1});
 const custom=structuredClone(original);custom.exercises[0].sets=8;custom.name='My custom push';
 await act(db,alice,{action:'savePersonal',crewId:f.crewId,routine:custom,revision:1});
 assert.equal((await f.getA()).crew.personal[0].exercises[0].sets,8);
 assert.equal((await f.getB()).crew.personal[0].exercises[0].sets,4);
 assert.equal((await f.getA()).crew.state.routines[0].exercises[0].sets,4);
 const updated=structuredClone(original);updated.exercises[0].reps=15;
 await act(db,bob,{action:'saveCommon',crewId:f.crewId,routine:updated,version:1});
 const beforeSync=(await f.getA()).crew;assert.equal(beforeSync.personal[0].baseVersion,1);assert.equal(beforeSync.personal[0].exercises[0].reps,10);
 await act(db,alice,{action:'syncRoutine',crewId:f.crewId,routineId:original.id,revision:2,version:2});
 const synced=(await f.getA()).crew.personal[0];assert.equal(synced.baseVersion,2);assert.equal(synced.exercises[0].reps,15);assert.equal(synced.exercises[0].sets,4);
 assert.equal((await f.getB()).crew.personal[0].baseVersion,1);
});
test('stale writes reject without losing saved edits',async()=>{
 const f=await fixture();const original=(await f.getA()).crew.state.routines[0];
 await act(db,alice,{action:'saveCommon',crewId:f.crewId,routine:{...original,name:'Updated'},version:1});
 await assert.rejects(act(db,bob,{action:'saveCommon',crewId:f.crewId,routine:original,version:1}),e=>e.status===409);
 await act(db,alice,{action:'copyRoutine',crewId:f.crewId,routineId:original.id,version:2});
 await act(db,alice,{action:'savePersonal',crewId:f.crewId,routine:{...original,name:'Saved'},revision:1});
 await assert.rejects(act(db,alice,{action:'savePersonal',crewId:f.crewId,routine:original,revision:1}),e=>e.status===409);
 assert.equal((await f.getA()).crew.personal[0].name,'Saved');
});
test('schedule create, edit, attendance idempotence, owner restrictions and cancellation',async()=>{
 const f=await fixture();let a=await f.getA();
 await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:a.crew.revision,session:{id:'',title:'Together',date:'2026-09-21',time:'19:00',routineId:'push'}});
 a=await f.getA();const event=a.crew.state.sessions[0];assert.deepEqual(event.participants,['alice']);
 for(let i=0;i<2;i++)await act(db,bob,{action:'attendance',crewId:f.crewId,sessionId:event.id,participating:true});
 assert.deepEqual((await f.getA()).crew.state.sessions[0].participants,['alice','bob']);
 await assert.rejects(act(db,bob,{action:'cancelSession',crewId:f.crewId,sessionId:event.id}),e=>e.status===403);
 a=await f.getA();await assert.rejects(act(db,bob,{action:'saveSession',crewId:f.crewId,revision:a.crew.revision,session:{...event,time:'20:00'}}),e=>e.status===403);
 await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:a.crew.revision,session:{...event,time:'20:00'}});
 await act(db,bob,{action:'attendance',crewId:f.crewId,sessionId:event.id,participating:false});
 assert.deepEqual((await f.getA()).crew.state.sessions[0].participants,['alice']);
 await act(db,alice,{action:'cancelSession',crewId:f.crewId,sessionId:event.id});
 assert.equal((await f.getB()).crew.state.sessions[0].cancelled,true);
 await assert.rejects(act(db,bob,{action:'attendance',crewId:f.crewId,sessionId:event.id,participating:true}),e=>e.status===400);
});
test('invalid dates, blank fields and invalid exercises are rejected before storing',async()=>{
 const f=await fixture();const a=await f.getA();
 for(const date of ['2026-02-30','2026-13-01'])await assert.rejects(act(db,alice,{action:'saveSession',crewId:f.crewId,revision:1,session:{id:'',title:'Workout',date,time:'19:00',routineId:''}}),e=>e.status===400);
 const r=a.crew.state.routines[0];await assert.rejects(act(db,alice,{action:'saveCommon',crewId:f.crewId,version:1,routine:{...r,exercises:[{...r.exercises[0],sets:0}]}}),e=>e.status===400);
 await assert.rejects(act(db,alice,{action:'createCrew',name:'   ',nickname:'Alice'}),e=>e.status===400);
 assert.equal((await f.getA()).crew.state.sessions.length,0);
});
test('simultaneous attendance uses conflict detection instead of overwriting members',async()=>{
 const f=await fixture();await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:1,session:{id:'',title:'Concurrent',date:'2026-09-22',time:'20:00',routineId:''}});
 const s=(await f.getA()).crew.state.sessions[0];
 const results=await Promise.allSettled([act(db,alice,{action:'attendance',crewId:f.crewId,sessionId:s.id,participating:false}),act(db,bob,{action:'attendance',crewId:f.crewId,sessionId:s.id,participating:true})]);
 for(let i=0;i<results.length;i++){if(results[i].status==='rejected'){assert.equal(results[i].reason.status,409);await act(db,i===0?alice:bob,{action:'attendance',crewId:f.crewId,sessionId:s.id,participating:i===1});}}
 assert.deepEqual((await f.getA()).crew.state.sessions[0].participants,['bob']);
});
