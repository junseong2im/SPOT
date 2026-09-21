import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
const out=await build({entryPoints:['lib/gym-service.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {act,snapshot}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const future=hours=>{const d=new Date(Date.now()+hours*3600000+9*3600000).toISOString();return {date:d.slice(0,10),time:d.slice(11,16)};};

test('attendance intent releases capacity, enforces access/version/time and never grants a checkin',async()=>{
 const f=await createTestDatabase();const db=f.db,owner={userId:'owner',displayName:'Owner'},friend={userId:'friend',displayName:'Friend'},other={userId:'other',displayName:'Other'};
 try{
  const {crewId}=await act(db,owner,{action:'createCrew',name:'Intent',nickname:'Owner'});
  let state=await snapshot(db,owner,crewId);
  for(const user of [friend,other])await act(db,user,{action:'joinCrew',invite:state.crew.invite,nickname:user.displayName});
  state=await snapshot(db,owner,crewId);
  await act(db,owner,{action:'saveSession',crewId,revision:state.crew.revision,session:{id:'',title:'Today',...future(2),routineId:'',capacity:1}});
  let s=(await snapshot(db,owner,crewId)).crew.state.sessions[0];
  const respond=(user,response,version=s.version)=>act(db,user,{action:'sessionResponse',crewId,sessionId:s.id,version,response});
  await assert.rejects(respond(friend,'going'),e=>e.status===403);
  await assert.rejects(respond({userId:'outsider',displayName:'X'},'going'),e=>e.status===403);
  await respond(owner,'going');await respond(owner,'going');
  assert.equal((await snapshot(db,owner,crewId)).crew.state.sessions[0].participants.length,1);
  assert.equal((await db.prepare('SELECT count(*)::int AS n FROM checkins').first()).n,0);
  await respond(owner,'notGoing');
  s=(await snapshot(db,owner,crewId)).crew.state.sessions[0];
  assert.equal(s.participants.length,0);assert.equal(s.responses.owner,'notGoing');
  assert.equal((await db.prepare("SELECT count(*)::int AS n FROM notifications WHERE user_id='owner' AND kind='reminder' AND push_state!='invalid'").first()).n,0);
  await act(db,friend,{action:'attendance',crewId,sessionId:s.id,participating:true});
  await assert.rejects(respond(owner,'going'),e=>e.status===409);
  await act(db,friend,{action:'attendance',crewId,sessionId:s.id,participating:false});
  await respond(owner,'going');
  state=await snapshot(db,owner,crewId);
  await act(db,owner,{action:'saveSession',crewId,revision:state.crew.revision,session:{...s,...future(3)}});
  await assert.rejects(respond(owner,'going'),e=>e.status===409);
  s=(await snapshot(db,owner,crewId)).crew.state.sessions[0];assert.deepEqual(s.responses,{});
  state=await snapshot(db,owner,crewId);
  await act(db,owner,{action:'saveSession',crewId,revision:state.crew.revision,session:{...s,...future(26)}});
  s=(await snapshot(db,owner,crewId)).crew.state.sessions[0];await assert.rejects(respond(owner,'going'),/24시간/);
  state=await snapshot(db,owner,crewId);
  await act(db,owner,{action:'saveSession',crewId,revision:state.crew.revision,session:{...s,...future(-1)}});
  s=(await snapshot(db,owner,crewId)).crew.state.sessions[0];await assert.rejects(respond(owner,'going'),/24시간/);
 }finally{await f.close();}
});
