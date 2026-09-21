 'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {healthDashboard} from '@/lib/training-journal';
import type {JournalEntry} from '@/lib/training-journal-model';
import {TrainingJournal} from '../training-journal';
import '../training.css';
import './health.css';
type Dashboard=Awaited<ReturnType<typeof healthDashboard>>;
const sections=[{id:'body',title:'신체 변화',description:'체중·체지방·골격근'},{id:'meal',title:'식단 기록',description:'식사와 영양표 기록'},{id:'cardio',title:'유산소',description:'시간·거리 기록'},{id:'recovery',title:'수면·컨디션',description:'수면·활력·근육통'}] as const;
export function HealthDashboard(){
 const records=useRef<HTMLDivElement>(null);
 const [data,setData]=useState<Dashboard|null>(null),[auth,setAuth]=useState<'loading'|'guest'|'member'>('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[section,setSection]=useState<JournalEntry['content']['kind']|null>(null);
 const load=useCallback(async()=>{setBusy(true);setError('');try{const r=await fetch('/api/journal?dashboard=1',{cache:'no-store'});const d=await r.json() as Dashboard&{error?:string};if(r.status===401){setAuth('guest');setData(null);return;}if(!r.ok)throw Error(d.error||'건강 기록을 불러오지 못했어요.');setData(d);setAuth('member');}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(section){records.current?.focus({preventScroll:true});records.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}},[section]);
 function choose(kind:JournalEntry['content']['kind']){setSection(kind);if(section===kind){records.current?.focus({preventScroll:true});records.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}}
 const body=data?.body?.content.kind==='body'?data.body.content:null,recovery=data?.recovery?.content.kind==='recovery'?data.recovery.content:null;
 return <div className="health-shell"><header className="health-header"><a href="/" className="brand" aria-label="SPOT 운동 홈">SPOT<span className="brand-dot">.</span></a><nav aria-label="대시보드 이동"><a href="/">운동</a><a href="/health" aria-current="page">건강</a></nav><a className="text-button" href="/">운동 홈으로 ↗</a></header><main className="health-workspace"><div className="health-heading"><div><p className="eyebrow">MY HEALTH, MY PACE</p><h1>나의 건강 대시보드</h1><p className="muted">생활 기록을 한곳에. 작은 변화를 꾸준히 확인해요.</p></div><span className="health-private">나만 보는 개인 기록</span></div>
 {error&&<div className="error-banner" role="alert"><p>{error}</p><button className="secondary" disabled={busy} onClick={()=>void load()}>다시 불러오기</button></div>}
 {auth==='loading'&&!error&&<section className="panel" role="status">건강 기록을 불러오는 중…</section>}
 {auth==='guest'&&<section className="panel health-guest"><h2>내 건강 기록을 이어가세요</h2><p>로그인하면 신체·식단·유산소·컨디션을 저장하고 확인할 수 있어요.</p><a className="primary" href="/login?returnTo=%2Fhealth">로그인하고 시작하기</a></section>}
 {data&&<><div className="health-section-line"><h2>한눈에 보기</h2><span>{data.today} · 서울 시간</span><button className="text-button" disabled={busy} onClick={()=>void load()}>{busy?'갱신 중…':'새로고침'}</button></div><div className="health-overview">
 <button className="health-card" onClick={()=>choose('body')}><span>최근 신체 측정</span><strong>{body?.weight??'—'}<small> kg</small></strong><p>체지방 {body?.fat??'—'}% · 골격근 {body?.muscle??'—'}kg</p><small>{data.body?`${data.body.date} 기록`:'아직 측정 기록이 없어요'} · 기록 보기 ↗</small></button>
 <button className="health-card" onClick={()=>choose('meal')}><span>오늘 식단</span><strong>{data.nutrition.calories.total?.toLocaleString()??'—'}<small> kcal</small></strong><p>{data.nutrition.meals}건 기록 · 열량 입력 {data.nutrition.calories.recorded}건</p><small>입력한 음식만 합산 · 기록 보기 ↗</small></button>
 <button className="health-card" onClick={()=>choose('recovery')}><span>최근 수면·컨디션</span><strong>{recovery?.sleep??'—'}<small> 시간</small></strong><p>활력 {recovery?.energy??'—'}/5 · 근육통 {recovery?.soreness??'—'}/5</p><small>{data.recovery?`${data.recovery.date} 기록`:'아직 컨디션 기록이 없어요'} · 기록 보기 ↗</small></button>
 <button className="health-card" onClick={()=>choose('cardio')}><span>최근 유산소 기록</span><strong>{data.week.cardioEntries?data.week.cardioMinutes.toLocaleString():'—'}<small> 분</small></strong><p>오늘과 이전 7일 · {data.week.cardioEntries}건 입력</p><small>입력한 운동 시간 · 기록 보기 ↗</small></button>
 </div><details className="panel health-nutrition"><summary>오늘 영양 기록 자세히 보기</summary><div className="health-nutrients">{(['protein','carbs','fat'] as const).map((key,i)=><div key={key}><span>{['단백질','탄수화물','지방'][i]}</span><strong>{data.nutrition[key].total??'—'}g</strong><small>{data.nutrition[key].recorded}/{data.nutrition.meals}건 입력</small></div>)}</div><p className="muted">미입력 값을 0으로 계산하지 않아요. 입력된 영양소 합계는 실제 하루 섭취량이나 권장량 달성률이 아닙니다.</p></details>
 {(data.week.truncated||data.nutrition.truncated)&&<p className="muted">기록이 많아 각 요약을 최대 1,000건까지 계산했어요.</p>}
 <section className="health-records" aria-labelledby="health-records-title"><div className="health-section-line"><h2 id="health-records-title">내 기록 관리</h2><span>필요한 항목만 열어보세요</span></div><div className="health-record-nav">{sections.map(item=><button className="secondary" key={item.id} aria-pressed={section===item.id} aria-controls="health-record-panel" onClick={()=>choose(item.id)}><strong>{item.title}</strong><small>{item.description}</small></button>)}</div><div id="health-record-panel" ref={records} tabIndex={-1} aria-label="선택한 건강 기록">{section?<section className="panel health-editor"><div className="health-section-line"><h2>{sections.find(s=>s.id===section)?.title}</h2><button className="text-button" onClick={()=>setSection(null)}>기록 접기</button></div><TrainingJournal key={section} initialKind={section} hideNavigation onSaved={()=>void load()}/></section>:<p className="muted health-empty">신체, 식단, 유산소, 컨디션 중 관리할 항목을 선택하세요.</p>}</div></section></>}
 <p className="health-footnote">크루와 공유되지 않는 개인 기록입니다. 운동 수행 기록과 루틴 분석은 운동 대시보드에서 확인하세요.</p></main></div>;
}
