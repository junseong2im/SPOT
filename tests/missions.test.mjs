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
  await missionAction(db,f.crewId,'a',mission,now);
  let m=(await missionSnapshot(db,f.crewId,'a',now)).missions[0];
  await assert.rejects(missionAction(db,f.crewId,'stranger',{action:'join',missionId:m.id,accepted:true},now),e=>e.status===403);
  await missionAction(db,f.crewId,'b',{action:'join',missionId:m.id,accepted:true},now);
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
  assert.equal((await missionSnapshot(db,f.crewId,'b',now)).missions[0].progress.find(p=>p.userId==='b').withdrawn,true);
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

