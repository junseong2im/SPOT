import type {Snapshot} from './gym-model';

export function createSnapshotLoader(fetcher:typeof fetch=fetch,timeoutMs=12000){
 const pending=new Map<string,Promise<Snapshot>>();
 return (id='')=>{
  const existing=pending.get(id);if(existing)return existing;
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('연결이 지연되고 있어요. 인터넷 연결을 확인하고 다시 시도해주세요.'));},timeoutMs);});
  const request=(async()=>{
   const r=await fetcher(`/api/gym${id?`?crew=${encodeURIComponent(id)}`:''}`,{cache:'no-store',signal:controller.signal});
   const data=await r.json() as Snapshot&{error?:string};
   if(!r.ok)throw new Error(data.error||'운동 정보를 불러오지 못했어요.');
   return data;
  })();
  const result=Promise.race([request,deadline]).finally(()=>{clearTimeout(timer);if(pending.get(id)===result)pending.delete(id);});
  pending.set(id,result);return result;
 };
}
