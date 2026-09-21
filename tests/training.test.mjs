import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
async function moduleAt(path){const out=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);}
const {trainingAction,trainingSnapshot,workoutHistory}=await moduleAt('lib/training-service.ts');
const {analyzeTraining}=await moduleAt('lib/training-analysis.ts');
const {workoutTotals}=await moduleAt('lib/training-model.ts');
const {act,snapshot}=await moduleAt('lib/gym-service.ts');
const owner={userId:'owner',displayName:'Owner'},other={userId:'other',displayName:'Other'};

test('workout state is private, versioned and resumable; finish does not manufacture crew attendance',async()=>{
 const f=await createTestDatabase(),db=f.db;
 try{
  const {crewId}=await act(db,owner,{action:'createCrew',name:'Training',nickname:'Owner'});
  const payload={action:'start',id:crypto.randomUUID(),crewId,routineId:'push',kind:'common',version:1};
  await assert.rejects(trainingAction(db,other.userId,{...payload,id:crypto.randomUUID()}),e=>e.status===403);
  const started=await trainingAction(db,owner.userId,payload),w=started.workout;
  assert.equal(w.state.exercises[0].sets[0].done,false);assert.equal(w.state.exercises[0].sets[0].weight,null);
  assert.equal((await trainingAction(db,owner.userId,{...payload,id:crypto.randomUUID()})).workout.id,w.id);
  await assert.rejects(trainingSnapshot(db,other.userId,w.id),e=>e.status===404);
  assert.equal((await trainingSnapshot(db,other.userId)).active,null);
  await assert.rejects(trainingAction(db,owner.userId,{action:'finish',id:w.id,revision:w.revision,state:w.state}));
  const state=structuredClone(w.state);state.exercises[0].sets[0]={...state.exercises[0].sets[0],weight:50,reps:10,rir:2,done:true};
  const save=await trainingAction(db,owner.userId,{action:'save',id:w.id,revision:w.revision,state});
  await assert.rejects(trainingAction(db,owner.userId,{action:'save',id:w.id,revision:w.revision,state}),e=>e.status===409);
  await assert.rejects(trainingAction(db,other.userId,{action:'save',id:w.id,revision:save.workout.revision,state}),e=>e.status===404);
  const finish={action:'finish',id:w.id,revision:save.workout.revision,state};
  const completed=await trainingAction(db,owner.userId,finish);assert.equal(completed.workout.status,'completed');
  assert.equal((await trainingAction(db,owner.userId,finish)).workout.id,w.id);
  assert.equal((await db.prepare('SELECT count(*)::int AS n FROM checkins').first()).n,0);
  const report=await trainingSnapshot(db,owner.userId);assert.equal(report.analysis.sessions,1);assert.equal(report.analysis.sets,1);assert.equal(report.history[0].volume,500);
  const next=await trainingAction(db,owner.userId,{...payload,id:crypto.randomUUID()});assert.equal(next.workout.state.exercises[0].sets[0].weight,50);assert.equal(next.workout.state.exercises[0].sets[0].done,false);assert.equal(next.workout.state.exercises[0].sets[0].rir,null);
 }finally{await f.close();}
});

test('invalid measurements and profile input roll back without corrupting the active workout',async()=>{
 const f=await createTestDatabase(),db=f.db;
 try{
  const {crewId}=await act(db,owner,{action:'createCrew',name:'Validation',nickname:'Owner'});
  const {workout:w}=await trainingAction(db,owner.userId,{action:'start',id:crypto.randomUUID(),crewId,routineId:'legs',kind:'common',version:1});
  const bad=structuredClone(w.state);bad.exercises[0].sets[0].weight=-5;
  await assert.rejects(trainingAction(db,owner.userId,{action:'save',id:w.id,revision:1,state:bad}));assert.equal((await trainingSnapshot(db,owner.userId,w.id)).workout.revision,1);
  await assert.rejects(trainingAction(db,owner.userId,{action:'profile',profile:{goal:'hypertrophy',experience:'beginner',daysPerWeek:9,adult:true}}));
  const done=await trainingAction(db,owner.userId,{action:'discard',id:w.id,revision:1});assert.equal(done.workout.status,'discarded');assert.equal((await trainingSnapshot(db,owner.userId)).analysis.sessions,0);
 }finally{await f.close();}
});

function histories(overrides={}){return [0,1,2].map(i=>({id:String(i),user_id:'owner',crew_id:'crew',routine_id:'r',routine_name:'Bench',status:'completed',revision:1,started_at:Date.now()-(i+1)*86400000-3600000,finished_at:Date.now()-(i+1)*86400000,updated_at:Date.now(),state:{restSeconds:90,note:'',discomfort:'none',conditionsConfirmed:true,exercises:[{id:'bench',name:'벤치프레스',plannedReps:10,timed:false,convention:'total',equipmentLabel:'bar',prescription:'',sets:[{id:'s',kind:'working',weight:50,reps:10,seconds:null,rir:2,done:true}],...overrides}]}}));}
const profile={goal:'hypertrophy',experience:'intermediate',daysPerWeek:3,adult:true};
test('guidance abstains for missing data, pain, changed conditions and unknown machine identity',()=>{
 assert.equal(analyzeTraining(histories(),profile).advice[0].status,'progress');
 assert.equal(analyzeTraining(histories().slice(0,1),profile).advice[0].status,'review');
 assert.equal(analyzeTraining(histories(),null).advice[0].status,'review');
 assert.equal(analyzeTraining(histories({convention:'machine',equipmentLabel:''}),profile).advice[0].status,'review');
 const pain=histories();pain[0].state.discomfort='yes';assert.equal(analyzeTraining(pain,profile).advice[0].status,'review');
 const missing=histories();missing[0].state.exercises[0].sets[0].rir=null;assert.equal(analyzeTraining(missing,profile).advice[0].status,'review');
 const changed=histories();changed[0].state.exercises[0].sets[0].weight=55;assert.equal(analyzeTraining(changed,profile).advice[0].status,'review');
 const labels=histories();labels[0].state.exercises[0].equipmentLabel='other bar';assert.ok(analyzeTraining(labels,profile).advice.every(a=>a.status==='review'));
 const complex=histories({prescription:'탑세트와 백오프'});assert.equal(analyzeTraining(complex,profile).advice[0].status,'review');
 const declining=histories();declining[0].state.exercises[0].sets[0].reps=8;declining[1].state.exercises[0].sets[0].reps=9;assert.match(analyzeTraining(declining,profile).advice[0].title,/감소/);
});
test('warmups and timed sets do not create false load volume; unfinished sessions do not enter analysis',()=>{
 const h=histories();h[0].state.exercises[0].sets.push({id:'wu',kind:'warmup',weight:100,reps:10,seconds:null,rir:null,done:true});assert.equal(workoutTotals(h[0]).volume,500);
 h[0].state.exercises[0].timed=true;h[0].state.exercises[0].sets[0].seconds=30;assert.equal(workoutTotals(h[0]).volume,0);assert.equal(workoutTotals(h[0]).timedSeconds,30);
 h[0].status='active';assert.equal(analyzeTraining(h,profile).sessions,2);
});

test('completed record correction is private and revision checked, preserves workout date and updates analysis',async()=>{
 const f=await createTestDatabase(),db=f.db;
 try{
  const {crewId}=await act(db,owner,{action:'createCrew',name:'Correction',nickname:'Owner'});
  const {workout:w}=await trainingAction(db,owner.userId,{action:'start',id:crypto.randomUUID(),crewId,routineId:'push',kind:'common',version:1});
  const state=structuredClone(w.state);state.exercises[0].sets[0]={...state.exercises[0].sets[0],done:true,weight:50,reps:10};
  const {workout:done}=await trainingAction(db,owner.userId,{action:'finish',id:w.id,revision:1,state});
  state.exercises[0].sets[0].weight=60;
  const update={action:'correct',id:w.id,revision:done.revision,state};
  await assert.rejects(trainingAction(db,other.userId,update),e=>e.status===404);
  const {workout:corrected}=await trainingAction(db,owner.userId,update);assert.equal(corrected.finished_at,done.finished_at);assert.equal(corrected.started_at,done.started_at);assert.equal(corrected.revision,done.revision+1);
  assert.equal((await trainingSnapshot(db,owner.userId)).history[0].volume,600);
  await assert.rejects(trainingAction(db,owner.userId,update),e=>e.status===409);
  const empty=structuredClone(state);empty.exercises.forEach(e=>e.sets.forEach(s=>s.done=false));await assert.rejects(trainingAction(db,owner.userId,{...update,revision:corrected.revision,state:empty}));
 }finally{await f.close();}
});
test('history pagination includes old records and remains stable for equal timestamps without leaking other users',async()=>{
 const f=await createTestDatabase(),db=f.db;
 try{
  const state=histories()[0].state,time=Date.now()-100*86400000;
  for(let i=0;i<23;i++)await db.prepare("INSERT INTO workout_sessions(id,user_id,crew_id,routine_id,routine_name,status,state,started_at,finished_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)").bind(crypto.randomUUID(),'owner','crew','r','Old',JSON.stringify(state),time-1000,time,time).run();
  const first=await workoutHistory(db,'owner');assert.equal(first.history.length,20);assert.ok(first.cursor);
  const second=await workoutHistory(db,'owner',first.cursor);assert.equal(second.history.length,3);assert.equal(second.cursor,null);
  assert.equal(new Set([...first.history,...second.history].map(w=>w.id)).size,23);
  assert.equal((await workoutHistory(db,'other',first.cursor)).history.length,0);
  assert.equal((await trainingSnapshot(db,'owner')).analysis.sessions,0);
  assert.equal((await trainingSnapshot(db,'owner')).history.length,20);
  await assert.rejects(workoutHistory(db,'owner','bad cursor'));
 }finally{await f.close();}
});
test('same-day sessions, stale data and painful timed exercise never trigger progression; trends keep incomplete weights unknown',()=>{
 const now=Date.parse('2026-09-21T12:00:00Z');const sameDay=histories();sameDay.forEach((w,i)=>w.finished_at=Date.parse('2026-09-20T01:00:00Z')+i*3600000);
 assert.equal(analyzeTraining(sameDay,profile,now).advice[0].status,'review');
 const stale=histories();stale.forEach((w,i)=>w.finished_at=now-(20+i)*86400000);assert.equal(analyzeTraining(stale,profile,now).advice[0].status,'review');
 const timed=histories({timed:true});timed[0].state.discomfort='yes';assert.equal(analyzeTraining(timed,profile).advice[0].status,'review');
 const missing=histories();missing[0].state.exercises[0].sets[0].weight=null;const report=analyzeTraining(missing,profile);assert.equal(report.trends[0].points.at(-1).volume,null);
 const blocks=histories();blocks[0].state.exercises.push({...structuredClone(blocks[0].state.exercises[0]),id:'second'});const b=analyzeTraining(blocks,profile);assert.equal(b.advice[0].status,'review');assert.equal(b.trends[0].points.at(-1).sets,2);
});
