import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:['lib/snapshot-loader.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {createSnapshotLoader}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const snapshot={user:null,crew:null,crews:[]};
test('repeated refreshes share a slow request and all receive its result',async()=>{
 let calls=0,finish;const load=createSnapshotLoader(()=>{calls++;return new Promise(resolve=>finish=resolve);},1000);
 const first=load('crew'),second=load('crew');assert.equal(first,second);assert.equal(calls,1);
 finish(Response.json(snapshot));assert.deepEqual(await first,snapshot);assert.deepEqual(await second,snapshot);
});
test('a hung request times out even if fetch ignores abort, then can retry',async()=>{
 let calls=0,signal;const load=createSnapshotLoader((_url,options)=>{calls++;signal=options.signal;return calls===1?new Promise(()=>{}):Promise.resolve(Response.json(snapshot));},20);
 await assert.rejects(load(),/연결이 지연/);assert.equal(signal.aborted,true);
 assert.deepEqual(await load(),snapshot);assert.equal(calls,2);
});
test('server errors are surfaced and do not become an empty unauthenticated snapshot',async()=>{
 const load=createSnapshotLoader(async()=>Response.json({error:'크루 접근 불가'},{status:403}));
 await assert.rejects(load('crew'),/크루 접근 불가/);
});
