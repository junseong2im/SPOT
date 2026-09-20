import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const r=await build({entryPoints:['lib/music-transfer.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {transferPayload,validTransferUrl}=await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
test('transfer sends only selected track metadata and validates destination',()=>{
 const p=transferPayload({title:'My mix',tracks:[{title:'Unstoppable',artist:'The Score'}],userId:'private-id'});
 assert.deepEqual(p.tracklist,[{title:'Unstoppable',artists:'The Score'}]);assert.equal('userId' in p,false);
 assert.equal(validTransferUrl('https://soundiiz.com/go/import-playlist/abc123'),true);
 for(const url of ['https://soundiiz.com.evil.test/go/import-playlist/abc','javascript:bad','https://user:pass@soundiiz.com/go/import-playlist/abc','https://soundiiz.com/other'])assert.equal(validTransferUrl(url),false);
 assert.throws(()=>transferPayload({title:'x',tracks:[]}));
});
