import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {trainingAction,trainingSnapshot} from '@/lib/training-service';
import {AppError} from '@/lib/gym-service';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,write=false){try{
 const user=await getAppUser(request);if(!user)throw new AppError('로그인 후 운동 기록을 사용할 수 있어요.',401);if(!env.DB)throw new AppError('저장소 연결을 확인해주세요.',503);
 if(!write)return reply(await trainingSnapshot(env.DB,user.userId,new URL(request.url).searchParams.get('id')));
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('올바른 페이지에서 다시 시도해주세요.',403);
 const raw=await request.text();if(raw.length>200000)throw new AppError('운동 기록이 너무 커요.',413);let input;try{input=JSON.parse(raw);}catch{throw new AppError('입력 형식을 확인해주세요.');}
 return reply(await trainingAction(env.DB,user.userId,input));
 }catch(e){return reply({error:e instanceof AppError?e.message:'운동 기록을 저장하지 못했어요. 연결을 확인하고 다시 시도해주세요.'},e instanceof AppError?e.status:503);}}
export const GET=(r:Request)=>handle(r);
export const POST=(r:Request)=>handle(r,true);
