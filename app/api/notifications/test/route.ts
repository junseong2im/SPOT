import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {pushConfigured,sendWebPush,validPushEndpoint} from '@/lib/push';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){try{
 const user=await getAppUser(request);if(!user||!env.DB)return respond({error:'로그인이 필요해요.'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return respond({},403);
 const text=await request.text();if(text.length>3000)return respond({},400);const input=JSON.parse(text);
 if(input.action==='received'){await env.DB.prepare('UPDATE notification_preferences SET last_confirmed_at=? WHERE user_id=?').bind(Date.now(),user.userId).run();return respond({message:'이 기기에서 수신을 확인했어요.'});}
 if(!pushConfigured())return respond({error:'서버 푸시 설정을 확인해주세요.'},503);
 if(typeof input.endpoint!=='string'||!validPushEndpoint(input.endpoint))return respond({error:'이 기기의 푸시를 먼저 켜주세요.'},400);
 const sub=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=? AND endpoint=? AND active=1').bind(user.userId,input.endpoint).first<{endpoint:string;p256dh:string;auth:string}>();if(!sub)return respond({error:'기기 등록이 없어요. 알림 메뉴에서 푸시를 다시 켜주세요.'},404);
 await env.DB.prepare('INSERT INTO notification_preferences(user_id,enabled,push_enabled,reminder_minutes) VALUES(?,1,0,10) ON CONFLICT DO NOTHING').bind(user.userId).run();
 const claimed=await env.DB.prepare('UPDATE notification_preferences SET last_test_at=?,last_test_result=? WHERE user_id=? AND last_test_at<?').bind(Date.now(),'pending',user.userId,Date.now()-60000).run();if(!claimed.meta.changes)return respond({error:'테스트는 1분에 한 번 가능해요.'},429);
 try{await sendWebPush({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({id:crypto.randomUUID(),title:'SPOT 알림 테스트',body:'이 알림이 보이면 기기 수신이 동작하고 있어요.',url:'/'}));await env.DB.prepare('UPDATE notification_preferences SET last_test_result=? WHERE user_id=?').bind('accepted',user.userId).run();return respond({message:'푸시 서버가 접수했어요. 기기 알림이 보이는지 확인해주세요.'});}
 catch(e){if([404,410].includes((e as {statusCode:number}).statusCode))await env.DB.prepare('UPDATE push_subscriptions SET active=0 WHERE user_id=? AND endpoint=?').bind(user.userId,sub.endpoint).run();await env.DB.prepare('UPDATE notification_preferences SET last_test_result=? WHERE user_id=?').bind('failed',user.userId).run();return respond({error:'발송에 실패했어요. 푸시를 껐다가 다시 등록해주세요.'},502);}
 }catch{return respond({error:'알림 테스트를 처리하지 못했어요.'},503);}}
