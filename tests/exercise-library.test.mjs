import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
async function moduleAt(path){const out=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);}
const {exerciseGuides,guideFor,findExerciseGuides}=await moduleAt('lib/exercise-guides.ts');
const {parseRoutineText,finalizeImport}=await moduleAt('lib/routine-assistant/parser.ts');
const {act,snapshot}=await moduleAt('lib/gym-service.ts');

test('large exercise catalog has distinct names and exact movement matching before generic families',()=>{
 assert.ok(exerciseGuides.length>=170);
 assert.equal(new Set(exerciseGuides.map(g=>g.id)).size,exerciseGuides.length);
 assert.equal(new Set(exerciseGuides.map(g=>g.name.replaceAll(' ',''))).size,exerciseGuides.length);
 for(const [name,id] of [['덤벨 벤치프레스','wger-75'],['클로즈 그립 벤치프레스','wger-76'],['바벨 컬','wger-91'],['시티드 레그 컬','wger-366'],['라잉 레그 컬','wger-365'],['친업','wger-152'],['턱걸이','wger-475']])assert.equal(guideFor(name)?.id,id,name);
 assert.ok(findExerciseGuides('leg curl','하체','머신').length>=3);
 assert.ok(findExerciseGuides('덤벨','가슴','덤벨').length>=3);
 assert.ok(findExerciseGuides('사레레').some(g=>g.id==='lateral'));
 assert.ok(findExerciseGuides('레그익스','하체').some(g=>g.id==='legextend'));
 assert.equal(findExerciseGuides('zzzz-nonexistent').length,0);
});
test('every expanded guide has local images and individual source/license attribution',async()=>{
 const images=JSON.parse(await readFile('lib/exercise-images.json','utf8'));
 for(const guide of exerciseGuides.filter(g=>g.id.startsWith('wger-'))){
  const media=images[guide.id];assert.ok(media?.images.length,guide.id);assert.ok(media.source.endsWith('/'+guide.id.slice(5)+'/'));
  for(const image of media.images){assert.ok(image.author);assert.match(image.licenseUrl,/creativecommons.org/);assert.ok(image.original.startsWith('https://wger.de/media/exercise-images/'));await access('public'+image.src);}
 }
});
test('timed exercises import, persist and round trip as seconds, never repetition counts',async()=>{
 const draft=parseRoutineText('플랭크 3세트 30초\n오버헤드 삼두 스트레칭 2세트 1분');
 const routines=finalizeImport(draft);assert.equal(routines[0].exercises[0].durationSeconds,30);assert.equal(routines[0].exercises[1].durationSeconds,60);
 assert.equal(parseRoutineText('플랭크 3세트 휴식 30초').routines[0].exercises[0].durationSeconds,null);
 const f=await createTestDatabase(),user={userId:'timed',displayName:'Timed'};
 try{
  const {crewId}=await act(f.db,user,{action:'createCrew',name:'Timed',nickname:'Timed'});
  await act(f.db,user,{action:'importRoutines',crewId,revision:1,routines});
  let state=await snapshot(f.db,user,crewId);const saved=state.crew.state.routines.at(-1);assert.equal(saved.exercises[0].durationSeconds,30);
  await act(f.db,user,{action:'saveCommon',crewId,version:1,routine:{...saved,exercises:saved.exercises.map(e=>({...e,durationSeconds:45}))}});
  state=await snapshot(f.db,user,crewId);assert.equal(state.crew.state.routines.at(-1).exercises[0].durationSeconds,45);
  await assert.rejects(act(f.db,user,{action:'saveCommon',crewId,version:2,routine:{...saved,exercises:[{...saved.exercises[0],durationSeconds:0}]}}));
 }finally{await f.close();}
});
