 'use client';
import {useCallback,useEffect,useState} from 'react';
import type {healthDashboard} from '@/lib/training-journal';
import type {JournalEntry} from '@/lib/training-journal-model';
import {HealthTrends} from './health-trends';
import {TrainingJournal} from '../training-journal';
import '../training.css';
import './health.css';
type Dashboard=Awaited<ReturnType<typeof healthDashboard>>;
const sections=[{id:'body',title:'신체 변화',description:'체중·체지방·골격근'},{id:'meal',title:'식단 기록',description:'식사와 영양표 기록'},{id:'cardio',title:'유산소',description:'시간·거리 기록'},{id:'recovery',title:'수면·컨디션',description:'수면·활력·근육통'}] as const;
export function HealthDashboard({embedded=false}:{embedded?:boolean}={}){
 const Container=embedded?'section':'main';
 const [data,setData]=useState<Dashboard|null>(null),[auth,setAuth]=useState<'loading'|'guest'|'member'>('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[section,setSection]=useState<JournalEntry['content']['kind']|null>(null);
 const load=useCallback(async()=>{setBusy(true);setError('');try{const r=await fetch('/api/journal?dashboard=1',{cache:'no-store'});const d=await r.json() as Dashboard&{error?:string};if(r.status===401){setAuth('guest');setData(null);return;}if(!r.ok)throw Error(d.error||'건강 기록을 불러오지 못했어요.');setData(d);setAuth('member');}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{window.scrollTo({top:0,behavior:'auto'});},[section]);
 const [dirty,setDirty]=useState(false),[leaving,setLeaving]=useState(false);
 useEffect(()=>{if(!dirty)setLeaving(false);},[dirty]);
 function choose(kind:JournalEntry['content']['kind']){setSection(kind);setDirty(false);setLeaving(false);}
 function back(){if(dirty)setLeaving(true);else setSection(null);}
 const body=data?.body?.content.kind==='body'?data.body.content:null,recovery=data?.recovery?.content.kind==='recovery'?data.recovery.content:null;
 const todayKinds=new Set(data?.timeline.filter(e=>e.date===data.today).map(e=>e.content.kind)??[]);
 const actionKind:JournalEntry['content']['kind']=!todayKinds.has('recovery')?'recovery':!todayKinds.has('meal')?'meal':'body';
 const activeSection=sections.find(s=>s.id===section);
return <div className={`health-shell${embedded?' health-embedded':''}`}>{!embedded&&<><header className="health-header"><a href="/" className="brand" aria-label="SPOT 운동 홈">SPOT<span className="brand-dot">.</span></a><span className="health-header-title">PERSONAL HEALTH</span><a className="text-button" href="/">운동 홈으로 ↗</a></header><nav className="health-main-nav" aria-label="주요 메뉴">{[['home','대시보드','홈'],['schedule','운동 일정','일정'],['routines','루틴','루틴'],['health','건강','건강'],['crew','우리 크루','크루'],['missions','미션','미션'],['music','음악','음악']].map(([value,label,short])=><a key={value} href={value==='health'?'/health':value==='home'?'/':'/?view='+value} aria-current={value==='health'?'page':undefined} aria-label={label}><span className="nav-label-long" aria-hidden="true">{label}</span><span className="nav-label-short" aria-hidden="true">{short}</span></a>)}</nav></>}<Container className="health-workspace health-v2">
 {section&&data?<><div className="health-detail-heading"><button className="health-back" onClick={back}>← 건강 개요</button><span>나만 보는 기록</span></div><div className="health-heading"><div><p className="eyebrow">PERSONAL JOURNAL</p><h1>{activeSection?.title}</h1><p className="muted">{activeSection?.description}을 날짜별로 관리하세요.</p></div></div>{leaving&&<div className="health-leave" role="alert"><p>작성 중인 내용이 있어요. 저장하지 않고 개요로 돌아갈까요?</p><div className="button-row"><button className="secondary" onClick={()=>setLeaving(false)}>계속 작성</button><button className="secondary" onClick={()=>{setLeaving(false);setDirty(false);setSection(null);}}>저장하지 않고 돌아가기</button></div></div>}<div className="health-editor-page"><TrainingJournal key={section} initialKind={section} hideNavigation onSaved={()=>void load()} onDraftChange={setDirty}/></div></>:<>
 <div className="health-heading"><div><p className="eyebrow">HEALTH OVERVIEW</p><h1>오늘의 나를 살펴봐요.</h1><p className="muted">{data?.today??'건강 기록'} · 내 기록에서 발견하는 작은 변화</p></div><span className="health-private">개인 기록 · 비공개</span></div>
 {error&&<div className="error-banner" role="alert"><p>{error}</p><button className="secondary" disabled={busy} onClick={()=>void load()}>다시 불러오기</button></div>}
 {auth==='loading'&&!error&&<section className="health-loading" role="status">건강 기록을 준비하고 있어요…</section>}
 {auth==='guest'&&<section className="health-today"><div><span className="health-tag">START HERE</span><h2>첫 기록부터 가볍게.</h2><p>체중, 식단, 수면을 한곳에 모아 변화의 흐름을 확인하세요.</p></div><a className="primary" href="/login?returnTo=%2Fhealth">로그인하고 시작하기 ↗</a></section>}
 {data&&<><section className="health-today"><div><span className="health-tag">TODAY</span><h2>{todayKinds.size?'오늘도 기록을 이어가요.':'오늘 컨디션은 어때요?'}</h2><p>{todayKinds.size?`오늘 ${todayKinds.size}가지 항목을 기록했어요. 필요한 것만 남겨도 괜찮아요.`:'수면과 컨디션부터 짧게 남겨보세요.'}</p></div><button className="primary" onClick={()=>choose(actionKind)}>{todayKinds.has(actionKind)?'오늘 기록 살펴보기':actionKind==='recovery'?'컨디션 기록하기':actionKind==='meal'?'식단 기록하기':'신체 기록하기'} <span aria-hidden="true">↗</span></button></section>
 <div className="health-overview health-v2-overview"><button className="health-card" onClick={()=>choose('body')}><span>신체</span><strong>{body?.weight??'—'}<small>kg</small></strong><small>{data.body?`${data.body.date.slice(5)} 최근 측정`:'첫 측정을 남겨보세요'}</small><span className="health-card-action">신체 기록 →</span></button><button className="health-card" onClick={()=>choose('meal')}><span>오늘 식단</span><strong>{data.nutrition.calories.total?.toLocaleString()??'—'}<small>kcal</small></strong><small>{data.nutrition.meals}건 기록 · 열량 입력 {data.nutrition.calories.recorded}건</small><span className="health-card-action">식단 기록 →</span></button><button className="health-card" onClick={()=>choose('recovery')}><span>수면</span><strong>{recovery?.sleep??'—'}<small>시간</small></strong><small>{data.recovery?`${data.recovery.date.slice(5)} 최근 기록`:'수면 기록을 시작하세요'}</small><span className="health-card-action">컨디션 기록 →</span></button><button className="health-card" onClick={()=>choose('cardio')}><span>최근 유산소</span><strong>{data.week.cardioEntries?data.week.cardioMinutes:'—'}<small>분</small></strong><small>오늘과 이전 7일 · {data.week.cardioEntries}건</small><span className="health-card-action">유산소 기록 →</span></button></div>
 {data.nutrition.truncated&&<p className="health-caption">오늘 식단 요약은 최대 1,000건 기준입니다.</p>}<HealthTrends entries={data.timeline} today={data.today} truncated={data.timelineTruncated}/>
 <div className="health-overview-footer"><span>빈 값은 미기록입니다. 숫자만으로 건강 상태를 판단하지 않아요.</span><button className="text-button" disabled={busy} onClick={()=>void load()}>{busy?'갱신 중…':'기록 새로고침'}</button></div>
 </>}
 </>}
 </Container></div>;
}
