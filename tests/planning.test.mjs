import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
const out=await build({entryPoints:['lib/gym-service.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {act,snapshot}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
let fixture,db;
const alice={userId:'planning-alice',displayName:'Alice'},bob={userId:'planning-bob',displayName:'Bob'},carol={userId:'planning-carol',displayName:'Carol'};
before(async()=>{fixture=await createTestDatabase();db=fixture.db;});after(()=>fixture.close());
async function group(){const {crewId}=await act(db,alice,{action:'createCrew',name:'Plan',nickname:'Alice'});let state=await snapshot(db,alice,crewId);for(const user of[bob,carol])await act(db,user,{action:'joinCrew',invite:state.crew.invite,nickname:user.displayName});return {crewId,get:()=>snapshot(db,alice,crewId)};}
async function schedule(f,extra={}){const {crew}=await f.get();await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{id:'',title:'Workout',date:'2100-01-04',time:'19:00',routineId:'',...extra}});return (await f.get()).crew.state.sessions.at(-1);}
test('weekly series creates only selected weekdays and uses each weekday routine',async()=>{
 const f=await group();let crew=(await f.get()).crew;
 await act(db,alice,{action:'saveWeekPlan',crewId:f.crewId,revision:crew.revision,plan:{1:'push',3:'pull',5:'legs'}});
 crew=(await f.get()).crew;
 await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{id:'',title:'Weekly',date:'2100-01-04',time:'19:00',routineId:''},repeat:{weekdays:[1,3,5],until:'2100-01-15'}});
 const sessions=(await f.get()).crew.state.sessions;assert.equal(sessions.length,6);assert.equal(new Set(sessions.map(s=>s.seriesId)).size,1);
 for(const session of sessions)assert.equal(session.routineId,{1:'push',3:'pull',5:'legs'}[new Date(session.date).getUTCDay()]);
 const count=sessions.length;
 await assert.rejects(act(db,alice,{action:'saveSession',crewId:f.crewId,revision:(await f.get()).crew.revision,session:{id:'',title:'Bad',date:'2100-01-04',time:'19:00',routineId:''},repeat:{weekdays:[1],until:'2101-01-04'}}),e=>e.status===400);
 assert.equal((await f.get()).crew.state.sessions.length,count);
});
test('series edits preserve earlier dates and cancellation only affects selected future occurrences',async()=>{
 const f=await group();await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:1,session:{id:'',title:'Series',date:'2100-01-04',time:'19:00',routineId:''},repeat:{weekdays:[1],until:'2100-01-25'}});
 let crew=(await f.get()).crew;const second=crew.state.sessions[1];
 await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{...second,time:'20:00'},scope:'future'});
 crew=(await f.get()).crew;assert.equal(crew.state.sessions[0].time,'19:00');assert.ok(crew.state.sessions.slice(1).every(s=>s.time==='20:00'));
 await act(db,alice,{action:'cancelSession',crewId:f.crewId,sessionId:second.id,scope:'future'});
 crew=(await f.get()).crew;assert.equal(crew.state.sessions[0].cancelled,false);assert.ok(crew.state.sessions.slice(1).every(s=>s.cancelled));
});
test('last available spot is allocated to only one simultaneous participant',async()=>{
 const f=await group();const session=await schedule(f,{capacity:2});
 const attempts=await Promise.allSettled([bob,carol].map(user=>act(db,user,{action:'attendance',crewId:f.crewId,sessionId:session.id,participating:true})));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.get()).crew.state.sessions[0].participants.length,2);
 const joined=(await f.get()).crew.state.sessions[0].participants[1]==='planning-bob'?bob:carol;
 await act(db,joined,{action:'attendance',crewId:f.crewId,sessionId:session.id,participating:true});assert.equal((await f.get()).crew.state.sessions[0].participants.length,2);
});
test('deadline prevents late joining but allows a participant to withdraw',async()=>{
 const f=await group();const start=new Date(Date.now()+30*60000+9*3600000).toISOString();const session=await schedule(f,{date:start.slice(0,10),time:start.slice(11,16),deadlineMinutes:60});
 await assert.rejects(act(db,bob,{action:'attendance',crewId:f.crewId,sessionId:session.id,participating:true}),/마감/);
 await act(db,alice,{action:'attendance',crewId:f.crewId,sessionId:session.id,participating:false});assert.equal((await f.get()).crew.state.sessions[0].participants.length,0);
});
test('poll voting is replaceable, private to the crew and finalization is one-time',async()=>{
 const f=await group();await act(db,alice,{action:'createPoll',crewId:f.crewId,title:'When?',routineId:'push',capacity:3,closesAt:Date.now()+3600000,options:[{date:'2100-01-04',time:'19:00'},{date:'2100-01-05',time:'20:00'}]});
 let poll=(await f.get()).crew.state.polls[0];
 await act(db,bob,{action:'votePoll',crewId:f.crewId,pollId:poll.id,optionIds:poll.options.map(o=>o.id)});
 await act(db,bob,{action:'votePoll',crewId:f.crewId,pollId:poll.id,optionIds:[poll.options[1].id]});
 poll=(await f.get()).crew.state.polls[0];assert.deepEqual(poll.options[0].votes,[]);assert.deepEqual(poll.options[1].votes,[bob.userId]);
 await assert.rejects(act(db,bob,{action:'confirmPoll',crewId:f.crewId,pollId:poll.id,optionId:poll.options[1].id}),e=>e.status===403);
 const attempts=await Promise.allSettled([1,2].map(()=>act(db,alice,{action:'confirmPoll',crewId:f.crewId,pollId:poll.id,optionId:poll.options[1].id})));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);const crew=(await f.get()).crew;assert.equal(crew.state.sessions.length,1);assert.deepEqual(crew.state.sessions[0].participants,[alice.userId]);assert.equal(crew.state.sessions[0].time,'20:00');
});
test('polls reject duplicate options, options before close and votes after closing',async()=>{
 const f=await group();const raw={action:'createPoll',crewId:f.crewId,title:'Poll',routineId:'',closesAt:Date.now()+3600000,options:[{date:'2100-01-04',time:'19:00'},{date:'2100-01-04',time:'19:00'}]};
 await assert.rejects(act(db,alice,raw),/중복/);
 await assert.rejects(act(db,alice,{...raw,closesAt:Date.parse('2101-01-01'),options:[{date:'2100-01-04',time:'19:00'},{date:'2100-01-05',time:'19:00'}]}),/마감 이후/);
 await act(db,alice,{...raw,options:[{date:'2100-01-04',time:'19:00'},{date:'2100-01-05',time:'19:00'}]});const poll=(await f.get()).crew.state.polls[0];
 await act(db,alice,{action:'closePoll',crewId:f.crewId,pollId:poll.id});await assert.rejects(act(db,bob,{action:'votePoll',crewId:f.crewId,pollId:poll.id,optionIds:[]}),e=>e.status===409);
});
test('crew management requires ownership; rotated invitations invalidate old links',async()=>{
 const f=await group();const old=(await f.get()).crew.invite;
 await assert.rejects(act(db,bob,{action:'renameCrew',crewId:f.crewId,name:'Hijack'}),e=>e.status===403);
 await act(db,alice,{action:'renameCrew',crewId:f.crewId,name:'Renamed'});await act(db,alice,{action:'rotateInvite',crewId:f.crewId});
 assert.equal((await f.get()).crew.name,'Renamed');assert.notEqual((await f.get()).crew.invite,old);
 await assert.rejects(act(db,{userId:'new',displayName:'New'},{action:'joinCrew',invite:old,nickname:'New'}),e=>e.status===404);
 await assert.rejects(act(db,alice,{action:'leaveCrew',crewId:f.crewId}),/위임/);
 await act(db,alice,{action:'transferOwner',crewId:f.crewId,userId:bob.userId});
 await assert.rejects(act(db,alice,{action:'rotateInvite',crewId:f.crewId}),e=>e.status===403);
});
test('leaving removes votes, attendance and access while preserving personal data',async()=>{
 const f=await group();const session=await schedule(f);await act(db,bob,{action:'copyRoutine',crewId:f.crewId,routineId:'push',version:1});await act(db,bob,{action:'attendance',crewId:f.crewId,sessionId:session.id,participating:true});
 await act(db,bob,{action:'leaveCrew',crewId:f.crewId});
 await assert.rejects(snapshot(db,bob,f.crewId),e=>e.status===403);assert.ok(!(await f.get()).crew.state.sessions[0].participants.includes(bob.userId));
 const stored=await db.prepare('SELECT content FROM personal WHERE crew_id=? AND user_id=?').bind(f.crewId,bob.userId).first();assert.ok(stored);
 await act(db,bob,{action:'joinCrew',invite:(await f.get()).crew.invite,nickname:'Returned'});assert.equal((await snapshot(db,bob,f.crewId)).crew.personal.length,1);
});
test('last member departure archives crew and cannot be rejoined through old invitation',async()=>{
 const {crewId}=await act(db,alice,{action:'createCrew',name:'Solo',nickname:'A'});const invite=(await snapshot(db,alice,crewId)).crew.invite;
 await act(db,alice,{action:'leaveCrew',crewId});await assert.rejects(act(db,bob,{action:'joinCrew',invite,nickname:'B'}),e=>e.status===404);
 assert.equal((await db.prepare('SELECT archived FROM crews WHERE id=?').bind(crewId).first()).archived,1);
});
test('failed multi-session edit rolls back earlier modifications and notifications',async()=>{
 const f=await group();await act(db,alice,{action:'saveSession',crewId:f.crewId,revision:1,session:{id:'',title:'Rollback',date:'2100-01-04',time:'19:00',routineId:''},repeat:{weekdays:[1],until:'2100-01-11'}});
 let crew=(await f.get()).crew;await act(db,bob,{action:'attendance',crewId:f.crewId,sessionId:crew.state.sessions[1].id,participating:true});crew=(await f.get()).crew;
 const before=JSON.stringify(crew.state);await assert.rejects(act(db,alice,{action:'saveSession',crewId:f.crewId,revision:crew.revision,session:{...crew.state.sessions[0],time:'20:00',capacity:1},scope:'future'}),/정원/);
 assert.equal(JSON.stringify((await f.get()).crew.state),before);assert.equal((await db.prepare("SELECT count(*)::int AS n FROM notifications WHERE crew_id=? AND kind='updated'").bind(f.crewId).first()).n,0);
});
