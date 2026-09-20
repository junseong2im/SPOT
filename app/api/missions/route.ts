import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {AppError} from '@/lib/gym-service';
import {missionAction,missionSnapshot} from '@/lib/missions';
export const dynamic='force-dynamic';
const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,write=false){try{
 const user=await getAppUser(request);if(!user)throw new AppError('로그인 후 이용해주세요.',401);if(!env.DB)throw new AppError('연결을 확인해주세요.',503);
 if(!write){const crewId=new URL(request.url).searchParams.get('crew');if(!crewId)throw new AppError('크루를 선택해주세요.');return respond(await missionSnapshot(env.DB,crewId,user.userId));}
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('올바른 페이지에서 시도해주세요.',403);
 const text=await request.text();if(text.length>5000)throw new AppError('입력 내용이 너무 길어요.');let input;try{input=JSON.parse(text);}catch{throw new AppError('입력 형식을 확인해주세요.');}if(typeof input?.crewId!=='string')throw new AppError('크루를 선택해주세요.');await missionAction(env.DB,input.crewId,user.userId,input);return respond({ok:true});
 }catch(e){return respond({error:e instanceof AppError?e.message:'출석·미션을 처리하지 못했어요.'},e instanceof AppError?e.status:503);}}
export const GET=(r:Request)=>handle(r);
export const POST=(r:Request)=>handle(r,true);
