import { env } from '@/lib/runtime';
import { getAppUser } from '@/lib/auth';
import { act, snapshot, AppError } from '@/lib/gym-service';
export const dynamic='force-dynamic';
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function db(){if(!env.DB)throw new AppError('저장소에 연결할 수 없어요. 잠시 후 다시 시도해주세요.',503);return env.DB;}
function failure(error:unknown){if(error instanceof AppError)return response({error:error.message},error.status);console.error('Gym request failed',error);return response({error:'저장소에 연결하지 못했어요. 입력 내용은 유지됩니다. 잠시 후 다시 시도해주세요.'},503);}
export async function GET(request:Request){try{const user=await getAppUser(request);if(!user)return response({user:null,crews:[],crew:null});return response(await snapshot(db(),user,new URL(request.url).searchParams.get('crew')));}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const user=await getAppUser(request);if(!user)throw new AppError('로그인 후 이용해주세요.',401);
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)throw new AppError('올바른 페이지에서 다시 시도해주세요.',403);
 const raw=await request.text();if(raw.length>50000)throw new AppError('입력 내용이 너무 길어요.',413);
 let input:unknown;try{input=JSON.parse(raw);}catch{throw new AppError('입력 형식을 확인해주세요.');}
 return response(await act(db(),user,input));
 }catch(e){return failure(e);}}
