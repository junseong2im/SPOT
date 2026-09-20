import {getAppUser} from '@/lib/auth';
import {transferSchema,transferPayload,validTransferUrl} from '@/lib/music-transfer';
export const dynamic='force-dynamic';
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 try{
  if(!await getAppUser(request))return respond({error:'로그인 후 음악을 옮길 수 있어요.'},401);
  if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'올바른 페이지에서 시도해주세요.'},403);
  const text=await request.text();if(text.length>80000)return respond({error:'최대 200곡까지 선택해주세요.'},413);
  let raw;try{raw=JSON.parse(text);}catch{return respond({error:'곡 목록 형식을 확인해주세요.'},400);}
  const parsed=transferSchema.safeParse(raw);if(!parsed.success)return respond({error:'플레이리스트 이름과 곡 제목을 확인해주세요. 1~200곡을 넣을 수 있어요.'},400);
  const result=await fetch('https://soundiiz.com/go/import-playlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(transferPayload(parsed.data)),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!result.ok)return respond({error:'전송 서비스가 응답하지 않았어요. 잠시 후 다시 시도해주세요.'},502);
  const body=await result.json() as {status?:string;shareUrl?:string;nbTracks?:number};
  if(body.status!=='success'||!validTransferUrl(body.shareUrl))return respond({error:'전송 링크를 만들지 못했어요.'},502);
  return respond({url:body.shareUrl,count:body.nbTracks});
 }catch{return respond({error:'전송 연결이 지연됐어요. 잠시 후 다시 시도해주세요.'},503);}
}
