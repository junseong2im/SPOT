import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
const out=await build({entryPoints:['lib/suggestions.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createSuggestion,listSuggestions,updateSuggestion}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
test('suggestions are private, idempotent and only administrators can reply or change status',async()=>{
 const f=await createTestDatabase(),db=f.db;
 try{
  await db.prepare('INSERT INTO app_admins(user_id) VALUES(?)').bind('admin').run();
  const user={userId:'friend',displayName:'Friend'},item={id:crypto.randomUUID(),category:'music',title:'음악 추가',body:'하체 운동 플리 부탁해요',link:'https://music.youtube.com/playlist?list=PL1234567890'};
  await createSuggestion(db,user,item);await createSuggestion(db,user,item);
  assert.equal((await listSuggestions(db,'friend')).items.length,0);
  assert.equal((await listSuggestions(db,'other')).items.length,0);
  assert.equal((await listSuggestions(db,'admin')).items.length,1);
  const update={id:item.id,revision:1,status:'planned',reply:'다음 업데이트에 추가할게요.'};
  await assert.rejects(updateSuggestion(db,'friend',update),e=>e.status===403);
  await updateSuggestion(db,'admin',update);
  const saved=(await listSuggestions(db,'admin')).items[0];assert.equal(saved.status,'planned');assert.equal(saved.reply,update.reply);
  await assert.rejects(updateSuggestion(db,'admin',update),e=>e.status===409);
  await assert.rejects(createSuggestion(db,user,{...item,id:crypto.randomUUID(),link:'javascript:alert(1)'}));
  await assert.rejects(createSuggestion(db,user,{...item,id:crypto.randomUUID(),body:' '}));
 }finally{await f.close();}
});

test('guide requests deduplicate pending requests per person and rank privately across the full backlog',async()=>{
 const f=await createTestDatabase(),db=f.db;
 try{
  await db.prepare('INSERT INTO app_admins(user_id) VALUES(?)').bind('admin').run();
  const a={userId:'a',displayName:'A'},b={userId:'b',displayName:'B'};
  const request=(user,title)=>createSuggestion(db,user,{id:crypto.randomUUID(),category:'guide',title,body:'기구 설정 사진 부탁해요.',link:''});
  await request(a,'  Leg   Press  ');await request(a,'LEG PRESS');await request(b,'leg press');await request(a,'스쿼트');
  let result=await listSuggestions(db,'admin');
  assert.equal(result.items.length,3);assert.deepEqual(result.guides[0],{title:'leg press',people:2,requests:2});
  assert.equal((await listSuggestions(db,'a','leg press')).guides.length,0);
  assert.equal((await listSuggestions(db,'a','leg press')).items.length,0);
  const filtered=await listSuggestions(db,'admin','LEG PRESS');assert.equal(filtered.items.length,2);
  const own=filtered.items.find(i=>i.user_id==='a');await updateSuggestion(db,'admin',{id:own.id,revision:own.revision,status:'done',reply:'설명 보완'});
  await request(a,'leg press');result=await listSuggestions(db,'admin');assert.equal(result.guides.find(g=>g.title==='leg press').people,2);
 }finally{await f.close();}
});
