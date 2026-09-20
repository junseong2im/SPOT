import {env} from '@/lib/runtime';
import {getAppUser} from '@/lib/auth';
import {musicAdmin,musicList,saveMusic,archiveMusic} from '@/lib/music-service';
import {youtubeSource} from '@/lib/music-model';
import {AppError} from '@/lib/gym-service';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){try{if(!env.DB)return respond({items:[],admin:false});const user=await getAppUser(request);return respond({items:await musicList(env.DB),admin:await musicAdmin(env.DB,user?.userId)});}catch{return respond({error:'음악 추천을 불러오지 못했어요.'},503);}}
export async function POST(request:Request){try{
 const user=await getAppUser(request);if(!user)throw new AppError('로그인이 필요해요.',401);
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError('올바른 페이지에서 다시 시도해주세요.',403);
 if(!env.DB)throw new AppError('저장소 연결을 확인해주세요.',503);
 if(!await musicAdmin(env.DB,user.userId))throw new AppError('관리자만 사용할 수 있어요.',403);
 const text=await request.text();if(text.length>20000)throw new AppError('입력 내용이 너무 길어요.',413);
 let input;try{input=JSON.parse(text);}catch{throw new AppError('입력 형식을 확인해주세요.');}
 if(input.action==='preview'){
  const source=youtubeSource(String(input.url));if(!source)throw new AppError('유튜브 노래 또는 플레이리스트 주소를 넣어주세요.');
  if(!source.video)return respond({title:'',artist:'',note:'플레이리스트 이름과 추천 설명을 직접 입력해주세요.'});
  const response=await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v='+source.video)}`,{signal:AbortSignal.timeout(6000)});
  if(!response.ok)return respond({title:'',artist:'',note:'정보를 가져오지 못했어요. 직접 입력할 수 있어요.'});
  const meta=await response.json() as {title?:string;author_name?:string};return respond({title:String(meta.title??'').slice(0,120),artist:String(meta.author_name??'').slice(0,120)});
 }
 if(input.action==='archive'){if(typeof input.id!=='string'||!Number.isInteger(input.revision))throw new AppError('추천을 다시 선택해주세요.');await archiveMusic(env.DB,user.userId,input.id,input.revision);}
 else if(input.action==='save')await saveMusic(env.DB,user.userId,input.item);
 else throw new AppError('지원하지 않는 요청이에요.');
 return respond({ok:true});
}catch(error){return respond({error:error instanceof AppError?error.message:'음악 추천을 처리하지 못했어요. 잠시 후 다시 시도해주세요.'},error instanceof AppError?error.status:503);}}
