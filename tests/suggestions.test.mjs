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
