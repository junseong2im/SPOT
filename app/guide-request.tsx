'use client';
import {useState} from 'react';

export function GuideRequest({name}:{name:string}){
 const [open,setOpen]=useState(false),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState(''),[login,setLogin]=useState(false);
 const [id]=useState(()=>crypto.randomUUID());
 async function send(){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',item:{id,category:'guide',title:name,body:note.trim()||'사진과 자세 설명을 보완해주세요.',link:''}})});
   const data=await response.json() as {error?:string};if(!response.ok){setLogin(response.status===401);throw Error(data.error||'요청을 보내지 못했어요.');}
   setSent(true);setOpen(false);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="guide-request">
  {sent?<p role="status">가이드 요청을 접수했어요. 같은 운동의 미처리 요청은 한 번만 집계돼요.</p>:<>
   <button type="button" className="text-button" aria-expanded={open} onClick={()=>setOpen(!open)}>사진·설명이 더 필요해요 · 가이드 요청</button>
   {open&&<div className="form-stack"><p className="muted">{name} · 요청 내용은 관리자만 볼 수 있어요.</p><label className="field">궁금한 점 (선택)<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} rows={3} placeholder="기구 설정이나 움직임 중 궁금한 점을 알려주세요."/></label><button type="button" className="secondary" disabled={busy} onClick={()=>void send()}>{busy?'보내는 중…':'이 운동 가이드 요청'}</button></div>}
  </>}
  {error&&<p role="alert">{error}</p>}{login&&<a href="/login?returnTo=%2F" className="text-button">로그인하기</a>}
 </div>;
}
