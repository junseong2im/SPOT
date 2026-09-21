import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createTestDatabase} from './database.mjs';
const out=await build({entryPoints:['lib/training-journal.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {healthDashboard,journalAction}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
test('health dashboard preserves private records, Seoul dates and missing nutrient values',async()=>{const f=await createTestDatabase();try{
 const now=Date.parse('2026-09-21T15:30:00Z');
 async function add(userId,date,content){return journalAction(f.db,userId,{action:'save',entry:{id:crypto.randomUUID(),revision:0,date,content}});}
 const b=await add('a','2026-08-01',{kind:'body',weight:80,fat:20,muscle:35,note:''});
 await add('b','2026-09-22',{kind:'body',weight:99,fat:30,muscle:40,note:'private'});
 await add('a','2026-10-01',{kind:'body',weight:70,fat:10,muscle:40,note:'future'});
 await add('a','2026-09-22',{kind:'meal',name:'식사',meal:'lunch',calories:500,protein:30,carbs:null,fat:0,note:''});
 await add('a','2026-09-22',{kind:'meal',name:'미입력',meal:'snack',calories:null,protein:null,carbs:null,fat:null,note:''});
 await add('a','2026-09-21',{kind:'meal',name:'어제',meal:'dinner',calories:900,protein:60,carbs:100,fat:30,note:''});
 await add('a','2026-09-21',{kind:'cardio',name:'걷기',minutes:30,distance:2,note:''});
 await add('a','2026-09-21',{kind:'recovery',sleep:7,energy:3,soreness:1,note:''});
 const d=await healthDashboard(f.db,'a',now);assert.equal(d.today,'2026-09-22');assert.equal(d.body.content.weight,80);assert.equal(d.nutrition.meals,2);assert.equal(d.nutrition.calories.total,500);assert.equal(d.nutrition.calories.recorded,1);assert.equal(d.nutrition.carbs.total,null);assert.equal(d.nutrition.fat.total,0);assert.equal(d.week.cardioMinutes,30);assert.equal(d.recovery.content.sleep,7);
 await journalAction(f.db,'a',{action:'archive',id:b.entry.id,revision:b.entry.revision});assert.equal((await healthDashboard(f.db,'a',now)).body,null);
 const empty=await healthDashboard(f.db,'empty',now);assert.equal(empty.body,null);assert.equal(empty.nutrition.meals,0);assert.equal(empty.nutrition.calories.total,null);assert.equal(empty.week.cardioEntries,0);
}finally{await f.close();}});
