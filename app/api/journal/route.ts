import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {journalAction,journalPage} from '@/lib/training-journal';
import {AppError} from '@/lib/gym-service';
export const dynamic='force-dynamic';
async function handle(request:Request,write=false){try{
 const user=await getAppUser(request);if(!user)throw new AppError('로그인이 필요해요.',401);if(!env.DB)throw new AppError('저장소 연결을 확인해주세요.',503);
 if(!write)return Response.json(await journalPage(env.DB,user.userId,new URL(request.url).searchParams.get('cursor')),{headers:{'Cache-Control':'no-store'}});
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('올바른 페이지에서 다시 시도해주세요.',403);
 const text=await request.text();if(text.length>10000)throw new AppError('입력이 너무 커요.',413);let input;try{input=JSON.parse(text);}catch{throw new AppError('입력 형식을 확인해주세요.');}
 return Response.json(await journalAction(env.DB,user.userId,input),{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof AppError?e.message:'저장하지 못했어요. 다시 시도해주세요.'},{status:e instanceof AppError?e.status:503,headers:{'Cache-Control':'no-store'}});}}
export const GET=(r:Request)=>handle(r);export const POST=(r:Request)=>handle(r,true);
