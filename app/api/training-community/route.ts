import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {questionAction,questionPage} from '@/lib/training-community';
import {AppError} from '@/lib/gym-service';
export const dynamic='force-dynamic';
async function handle(r:Request,write=false){try{const user=await getAppUser(r);if(!user)throw new AppError('로그인이 필요해요.',401);if(!env.DB)throw new AppError('저장소를 확인해주세요.',503);let result;
 if(!write){const p=new URL(r.url).searchParams;result=await questionPage(env.DB,user.userId,p.get('parent'),p.get('cursor'));}else{if(r.headers.get('origin')!==new URL(r.url).origin)throw new AppError('올바른 페이지에서 다시 시도하세요.',403);const text=await r.text();if(text.length>12000)throw new AppError('글이 너무 길어요.',413);let raw;try{raw=JSON.parse(text);}catch{throw new AppError('입력을 확인해주세요.');}result=await questionAction(env.DB,user,raw);}
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof AppError?e.message:'커뮤니티에 연결하지 못했어요.'},{status:e instanceof AppError?e.status:503,headers:{'Cache-Control':'no-store'}});}}
export const GET=(r:Request)=>handle(r);export const POST=(r:Request)=>handle(r,true);
