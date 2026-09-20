import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {AppError} from '@/lib/gym-service';
import {createSuggestion,listSuggestions,updateSuggestion} from '@/lib/suggestions';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,write=false){try{
 const user=await getAppUser(request);if(!user)throw new AppError('로그인 후 건의함을 이용해주세요.',401);
 if(!env.DB)throw new AppError('잠시 후 다시 시도해주세요.',503);
 if(!write)return respond(await listSuggestions(env.DB,user.userId));
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('올바른 페이지에서 다시 시도해주세요.',403);
 const text=await request.text();if(text.length>12000)throw new AppError('입력 내용이 너무 길어요.',413);
 let input;try{input=JSON.parse(text);}catch{throw new AppError('입력 형식을 확인해주세요.');}
 if(input?.action==='create')await createSuggestion(env.DB,user,input.item);
 else if(input?.action==='update')await updateSuggestion(env.DB,user.userId,input.item);
 else throw new AppError('지원하지 않는 요청입니다.');
 return respond({ok:true});
}catch(e){return respond({error:e instanceof AppError?e.message:'건의함에 연결하지 못했어요.'},e instanceof AppError?e.status:503);}}
export const GET=(r:Request)=>handle(r);
export const POST=(r:Request)=>handle(r,true);
