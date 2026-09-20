import { env } from '@/lib/runtime';
import { getAppUser } from '@/lib/auth';
import { pushConfigured, validPushEndpoint } from '@/lib/push';
import { z } from 'zod';
export const dynamic='force-dynamic';
const subscriptionSchema=z.object({endpoint:z.string().max(2048).refine(validPushEndpoint),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),auth:z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/)})});
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){if(!await getAppUser(request))return respond({error:'로그인 후 이용해주세요.'},401);return pushConfigured()?respond({publicKey:process.env.VAPID_PUBLIC_KEY}):respond({error:'푸시 연결을 준비 중이에요. 웹 안 알림은 사용할 수 있어요.'},503);}
async function change(request:Request,remove:boolean){
 try{
  const user=await getAppUser(request);if(!user)return respond({error:'로그인 후 이용해주세요.'},401);
  if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'올바른 페이지에서 시도해주세요.'},403);
  if(!env.DB)return respond({error:'저장소에 연결할 수 없어요.'},503);
  const text=await request.text();if(text.length>8192)return respond({error:'입력이 너무 길어요.'},413);
  let raw:unknown;try{raw=JSON.parse(text);}catch{return respond({error:'입력 형식을 확인해주세요.'},400);}
  if(remove){const data=z.object({endpoint:z.string().max(2048)}).safeParse(raw);if(!data.success)return respond({error:'기기 정보를 확인해주세요.'},400);await env.DB.prepare('UPDATE push_subscriptions SET active=0 WHERE endpoint=? AND user_id=?').bind(data.data.endpoint,user.userId).run();return respond({ok:true});}
  if(!pushConfigured())return respond({error:'푸시 연결을 준비 중이에요.'},503);
  const data=subscriptionSchema.safeParse(raw);if(!data.success)return respond({error:'지원되는 브라우저에서 다시 시도해주세요.'},400);
  await env.DB.transaction(async db=>{
   await db.prepare('SELECT user_id FROM auth_sessions WHERE user_id=? FOR UPDATE').bind(user.userId).all();
   const count=await db.prepare('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id=? AND active=1').bind(user.userId).first<{n:number}>();
   const exists=await db.prepare('SELECT id FROM push_subscriptions WHERE endpoint=?').bind(data.data.endpoint).first();
   if(!exists&&(count?.n??0)>=10)throw new Error('device_limit');
   await db.prepare('INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,active,created_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,active=1').bind(crypto.randomUUID(),user.userId,data.data.endpoint,data.data.keys.p256dh,data.data.keys.auth,Date.now()).run();
  });return respond({ok:true});
 }catch{return respond({error:'기기 등록을 저장하지 못했어요. 기기는 계정당 최대 10개까지 등록할 수 있어요.'},503);}
}
export const POST=(request:Request)=>change(request,false);
export const DELETE=(request:Request)=>change(request,true);
