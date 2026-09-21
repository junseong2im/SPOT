import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('notification actions open a confirmation page, preserve session links and reject foreign navigation',async()=>{
 const handlers={},shown=[],opened=[];
 const self={location:{origin:'https://spot.test'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(await readFile('public/sw.js','utf8'),{self,URL});
 let pending;const waitUntil=p=>pending=p;
 handlers.push({data:{json:()=>({title:'운동',confirmAttendance:true,url:'/?crew=c&session=s'})},waitUntil});await pending;
 assert.equal(shown[0][1].actions.length,2);
 handlers.notificationclick({notification:{close(){},data:shown[0][1].data},action:'notGoing',waitUntil});await pending;
 assert.equal(opened[0],'https://spot.test/?crew=c&session=s&respond=notGoing');
 handlers.notificationclick({notification:{close(){},data:{url:'https://evil.test/?session=s',confirmAttendance:true}},action:'going',waitUntil});await pending;
 assert.equal(opened[1],'https://spot.test/');
 handlers.push({data:{json:()=>({title:'테스트'})},waitUntil});await pending;assert.equal(shown[1][1].actions.length,0);
});
