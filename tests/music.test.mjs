import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
async function bundle(path){const r=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);}
const {youtubeSource,safeMusicLink}=await bundle('lib/music-model.ts');
const {musicAdmin,musicList,saveMusic,archiveMusic}=await bundle('lib/music-service.ts');
test('YouTube parsing supports videos and playlists and rejects unsafe origins',()=>{
 assert.equal(youtubeSource('https://youtu.be/M7lc1UVf-VE?si=tracking').musicUrl,'https://music.youtube.com/watch?v=M7lc1UVf-VE');
 const list=youtubeSource('https://music.youtube.com/playlist?list=PL123456789012345');assert.equal(list.kind,'플레이리스트');assert.match(list.embed,/videoseries/);
 for(const url of ['javascript:alert(1)','https://youtube.com.evil.example/watch?v=M7lc1UVf-VE','https://user:pass@youtube.com/watch?v=M7lc1UVf-VE','https://youtube.com/watch?v=bad'])assert.equal(youtubeSource(url),null);
 assert.equal(safeMusicLink('javascript:alert(1)'),false);assert.equal(safeMusicLink('https://open.spotify.com/track/example'),true);
});
test('global music is readable across crews but only explicit app admins can mutate it',async()=>{
 const f=await createTestDatabase(),db=f.db;
 try{
  await db.prepare('INSERT INTO app_admins(user_id) VALUES(?)').bind('admin').run();
  const item={id:'',title:'QA song',artist:'Artist',description:'Workout',youtube_url:'https://youtu.be/M7lc1UVf-VE',links:[{service:'Spotify',url:'https://open.spotify.com/track/example'}],revision:0};
  assert.equal(await musicAdmin(db,'crew-owner'),false);
  await assert.rejects(saveMusic(db,'crew-owner',item),e=>e.status===403);
  await saveMusic(db,'admin',item);let list=await musicList(db);assert.equal(list.length,1);assert.equal(list[0].links[0].service,'Spotify');
  await assert.rejects(saveMusic(db,'admin',{...list[0],revision:0}),e=>e.status===409);
  await saveMusic(db,'admin',{...list[0],title:'Updated'});list=await musicList(db);assert.equal(list[0].title,'Updated');
  await assert.rejects(archiveMusic(db,'outsider',list[0].id,2),e=>e.status===403);
  await archiveMusic(db,'admin',list[0].id,2);assert.equal((await musicList(db)).length,0);
  await assert.rejects(saveMusic(db,'admin',{...item,links:[{service:'X',url:'javascript:bad'}]}));
 }finally{await f.close();}
});
