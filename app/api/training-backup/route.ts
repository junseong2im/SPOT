import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {exportTraining,restoreTraining} from '@/lib/training-backup';
import {AppError} from '@/lib/gym-service';
export const dynamic='force-dynamic';
async function handle(r:Request,write=false){try{const user=await getAppUser(r);if(!user)throw new AppError('로그인이 필요해요.',401);if(!env.DB)throw new AppError('저장소를 확인해주세요.',503);let result;
 if(!write)result=await exportTraining(env.DB,user.userId,new URL(r.url).searchParams.get('cursor'));
 else{if(r.headers.get('origin')!==new URL(r.url).origin)throw new AppError('올바른 페이지에서 다시 시도하세요.',403);const text=await r.text();if(text.length>1500000)throw new AppError('백업 조각이 너무 커요.',413);let raw;try{raw=JSON.parse(text);}catch{throw new AppError('백업 형식을 확인해주세요.');}result=await restoreTraining(env.DB,user.userId,raw);}
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof AppError?e.message:'백업 처리에 실패했어요.'},{status:e instanceof AppError?e.status:503,headers:{'Cache-Control':'no-store'}});}}
export const GET=(r:Request)=>handle(r);export const POST=(r:Request)=>handle(r,true);
