import { env } from '@/lib/runtime';
import { authorizedJob, dispatchPush, pushConfigured, sendWebPush } from '@/lib/push';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request){
 if(!authorizedJob(request.headers.get('authorization'),process.env.CRON_SECRET))return Response.json({error:'Unauthorized'},{status:401});
 if(!env.DB)return Response.json({error:'Database unavailable'},{status:503});
 try{return Response.json(await dispatchPush(env.DB,{enabled:process.env.PUSH_DELIVERY_ENABLED==='true'&&pushConfigured(),send:sendWebPush}));}
 catch{return Response.json({error:'Notification job failed'},{status:503});}
}
export const GET=POST;
