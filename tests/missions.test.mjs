import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
async function moduleFor(path){const r=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);}
const {act,snapshot}=await moduleFor('lib/gym-service.ts'),{missionAction,missionSnapshot}=await moduleFor('lib/missions.ts');
const now=Date.parse('2100-01-04T10:00:00+09:00');
async function setup(){const f=await createTestDatabase();const a={userId:'a',displayName:'A'},b={userId:'b',displayName:'B'};const {crewId}=await act(f.db,a,{action:'createCrew',name:'Missions',nickname:'A'});const crew=(await snapshot(f.db,a,crewId)).crew;await act(f.db,b,{action:'joinCrew',invite:crew.invite,nickname:'B'});return {...f,a,b,crewId};}
test('mission requires opt-in, peer-confirmed attendance, and counts each date once',async()=>{
 const f=await setup(),db=f.db;try{
  const mission={action:'create',title:'Two days',starts:'2100-01-04',ends:'2100-01-10',target:2,promise:'커피 한 잔',accepted:true};
  await assert.rejects(missionAction(db,f.crewId,'a',{...mission,accepted:false},now));
  await missionAction(db,f.crewId,'a',mission,now-86400000);
  let m=(await missionSnapshot(db,f.crewId,'a',now)).missions[0];
  await assert.rejects(missionAction(db,f.crewId,'stranger',{action:'join',missionId:m.id,accepted:true},now-86400000+1),e=>e.status===403);
  await missionAction(db,f.crewId,'b',{action:'join',missionId:m.id,accepted:true},now-86400000+1);
  for(let i=0;i<2;i++){
   let crew=(await snapshot(db,f.a,f.crewId)).crew;
   await act(db,f.a,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{id:'',title:'Workout '+i,date:'2100-01-04',time:'10:00',routineId:''}});
   crew=(await snapshot(db,f.a,f.crewId)).crew;const session=crew.state.sessions.at(-1);
   await missionAction(db,f.crewId,'a',{action:'checkin',sessionId:session.id},now+1000);
   await assert.rejects(missionAction(db,f.crewId,'a',{action:'confirm',sessionId:session.id,userId:'a'},now+2000));
   assert.equal((await missionSnapshot(db,f.crewId,'a',now)).missions[0].progress.find(p=>p.userId==='a').days,i?1:0);
   await missionAction(db,f.crewId,'b',{action:'confirm',sessionId:session.id,userId:'a'},now+2000);
   await missionAction(db,f.crewId,'a',{action:'checkin',sessionId:session.id},now+3000);
  }
  m=(await missionSnapshot(db,f.crewId,'a',now)).missions[0];assert.equal(m.progress.find(p=>p.userId==='a').days,1);
  await missionAction(db,f.crewId,'b',{action:'withdraw',missionId:m.id},now+4000);
  assert.equal((await missionSnapshot(db,f.crewId,'b',now)).missions[0].progress.find(p=>p.userId==='b').forfeited,true);
  await assert.rejects(missionAction(db,f.crewId,'b',{action:'cancel',missionId:m.id},now),e=>e.status===403);
 }finally{await f.close();}
});
test('attendance rejects wrong windows and stale confirmations after schedule changes',async()=>{
 const f=await setup(),db=f.db;try{
  let crew=(await snapshot(db,f.a,f.crewId)).crew;await act(db,f.a,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{id:'',title:'Workout',date:'2100-01-04',time:'10:00',routineId:''}});crew=(await snapshot(db,f.a,f.crewId)).crew;const session=crew.state.sessions[0];
  await assert.rejects(missionAction(db,f.crewId,'a',{action:'checkin',sessionId:session.id},now-31*60000));
  await assert.rejects(missionAction(db,f.crewId,'b',{action:'checkin',sessionId:session.id},now));
  await missionAction(db,f.crewId,'a',{action:'checkin',sessionId:session.id},now);
  await act(db,f.b,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{...session,time:'10:10'}});
  await assert.rejects(missionAction(db,f.crewId,'b',{action:'confirm',sessionId:session.id,userId:'a'},now),e=>e.status===409);
  assert.equal((await missionSnapshot(db,f.crewId,'a',now)).checkins.length,0);
 }finally{await f.close();}
});

test('coffee settlement freezes results and only buyer and recipient can confirm their steps',async()=>{
 const f=await setup(),db=f.db;try{
  await missionAction(db,f.crewId,'a',{action:'create',title:'Coffee',starts:'2100-01-04',ends:'2100-01-04',target:1,promise:'',coffeePrice:5000,accepted:true},now-86400000);
  const id=(await missionSnapshot(db,f.crewId,'a',now)).missions[0].id;
  await missionAction(db,f.crewId,'b',{action:'join',missionId:id,accepted:true},now-86400000+1);
  let crew=(await snapshot(db,f.a,f.crewId)).crew;await act(db,f.a,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{id:'',title:'Workout',date:'2100-01-04',time:'10:00',routineId:''}});
  const session=(await snapshot(db,f.a,f.crewId)).crew.state.sessions[0];await missionAction(db,f.crewId,'a',{action:'checkin',sessionId:session.id},now);await missionAction(db,f.crewId,'b',{action:'confirm',sessionId:session.id,userId:'a'},now+1);
  await assert.rejects(missionAction(db,f.crewId,'a',{action:'finalizeCoffee',missionId:id},now));
  const later=now+2*86400000;await missionAction(db,f.crewId,'a',{action:'finalizeCoffee',missionId:id},later);
  let settled=(await missionSnapshot(db,f.crewId,'a',later)).missions[0].settlement;assert.equal(settled.total,5000);assert.equal(settled.buyer,'b');assert.equal(settled.cups[0].userId,'a');
  await assert.rejects(missionAction(db,f.crewId,'a',{action:'coffeeProgress',missionId:id,kind:'bought',targetId:'a'},later),e=>e.status===403);
  await assert.rejects(missionAction(db,f.crewId,'a',{action:'coffeeProgress',missionId:id,kind:'received',targetId:'a'},later));
  await missionAction(db,f.crewId,'b',{action:'coffeeProgress',missionId:id,kind:'bought',targetId:'a'},later);
  await missionAction(db,f.crewId,'a',{action:'coffeeProgress',missionId:id,kind:'received',targetId:'a'},later);
  await missionAction(db,f.crewId,'a',{action:'finalizeCoffee',missionId:id},later+1);
  settled=(await missionSnapshot(db,f.crewId,'a',later)).missions[0].settlement;assert.equal(settled.cups[0].received,true);
  await assert.rejects(missionAction(db,f.crewId,'a',{action:'cancel',missionId:id},later));
 }finally{await f.close();}
});

test('coffee split conserves total including odd amounts and no-charge cases',async()=>{
 const {coffeeSettlement}=await moduleFor('lib/coffee-settlement.ts');
 const p=(userId,days)=>({userId,days,withdrawn:false});
 const result=coffeeSettlement([p('w',3),p('a',0),p('b',0),p('c',0)],3,5000,1);
 assert.deepEqual(result.shares.map(s=>s.amount),[1667,1667,1666]);assert.equal(result.shares.reduce((n,s)=>n+s.amount,0),5000);
 assert.equal(coffeeSettlement([p('a',3),p('b',3)],3,5000,1).total,0);
 assert.equal(coffeeSettlement([p('a',0),p('b',0)],3,5000,1).total,0);
});

test('new mission rules retain forfeits and block settlement while disputes are open',async()=>{
 const f=await setup(),db=f.db;try{
  await missionAction(db,f.crewId,'a',{action:'create',title:'Fair rules',starts:'2100-01-04',ends:'2100-01-04',target:1,promise:'',coffeePrice:5000,accepted:true},now-86400000);
  const id=(await missionSnapshot(db,f.crewId,'a',now)).missions[0].id;
  await missionAction(db,f.crewId,'b',{action:'join',missionId:id,accepted:true},now-86400000+1000);
  await missionAction(db,f.crewId,'b',{action:'withdraw',missionId:id},now);
  let state=await missionSnapshot(db,f.crewId,'a',now);assert.equal(state.missions[0].progress.find(p=>p.userId==='b').withdrawn,false);assert.equal(state.missions[0].progress.find(p=>p.userId==='b').forfeited,true);
  await missionAction(db,f.crewId,'b',{action:'dispute',missionId:id,reason:'출석 확인이 누락됐어요.'},now);
  await assert.rejects(missionAction(db,f.crewId,'a',{action:'finalizeCoffee',missionId:id},now+2*86400000),/이의/);
  state=await missionSnapshot(db,f.crewId,'a',now);const dispute=state.disputes[0];
  await assert.rejects(missionAction(db,f.crewId,'b',{action:'resolveDispute',missionId:id,disputeId:dispute.id,reply:'임의 처리'},now),e=>e.status===403);
  await missionAction(db,f.crewId,'a',{action:'resolveDispute',missionId:id,disputeId:dispute.id,reply:'함께 확인하여 미달성에 동의했습니다.'},now);
  await missionAction(db,f.crewId,'a',{action:'finalizeCoffee',missionId:id},now+2*86400000);
  assert.ok((await missionSnapshot(db,f.crewId,'a',now+2*86400000)).missions[0].settlement);
 }finally{await f.close();}
});

test('confirmed attendance survives schedule changes and cheers are idempotent',async()=>{
 const f=await setup(),db=f.db;try{
  let crew=(await snapshot(db,f.a,f.crewId)).crew;await act(db,f.a,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{id:'',title:'Workout',date:'2100-01-04',time:'10:00',routineId:''}});
  crew=(await snapshot(db,f.a,f.crewId)).crew;const s=crew.state.sessions[0];await missionAction(db,f.crewId,'a',{action:'checkin',sessionId:s.id},now);await missionAction(db,f.crewId,'b',{action:'confirm',sessionId:s.id,userId:'a'},now+1);
  await act(db,f.b,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{...s,time:'11:00'}});
  for(let i=0;i<2;i++)await missionAction(db,f.crewId,'b',{action:'cheer',sessionId:s.id,userId:'a'},now+2);
  const state=await missionSnapshot(db,f.crewId,'a',now);assert.equal(state.checkins.length,1);assert.equal(state.cheers.length,1);assert.ok(state.events.some(e=>e.kind==='scheduleEdited'));
 }finally{await f.close();}
});

