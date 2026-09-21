self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()??{};}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'SPOT 운동 알림',{body:data.body||'새 운동 알림을 확인하세요.',tag:data.id||'spot-notification',data:{url:typeof data.url==='string'?data.url:'/',confirmAttendance:data.confirmAttendance===true},actions:data.confirmAttendance===true?[{action:'going',title:'참석 확인'},{action:'notGoing',title:'불참 알리기'}]:[],icon:'/favicon.svg'}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 let target=new URL('/',self.location.origin);try{const candidate=new URL(event.notification.data?.url||'/',self.location.origin);if(candidate.origin===self.location.origin&&candidate.pathname==='/')target=candidate;}catch{}
 if(event.notification.data?.confirmAttendance&&target.searchParams.has('session')&&['going','notGoing'].includes(event.action))target.searchParams.set('respond',event.action);
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.navigate(target.href);return client.focus();}}return self.clients.openWindow(target.href);}));
});
