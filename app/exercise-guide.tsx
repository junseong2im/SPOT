'use client';
import {useState} from 'react';
import Image from 'next/image';
import {ChevronDown,BookOpen} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {exerciseGuides,guideFor,findExerciseGuides,bodyFilters,equipmentFilters,type ExerciseGuide} from '@/lib/exercise-guides';
import imageCatalog from '@/lib/exercise-images.json';
import type {Exercise} from '@/lib/gym-model';
import './exercise-guide.css';
import {GuideRequest} from './guide-request';

type ImageSet={exerciseName:string;source:string;images:{src:string;original:string;author:string;license:string;licenseUrl:string}[]};
function GuideMedia({guide,compact=false}:{guide:ExerciseGuide;compact?:boolean}){
 const media=(imageCatalog as Record<string,ImageSet>)[guide.id];
 if(!media)return <div className="guide-image-missing"><BookOpen size={28}/><span>정확한 동작 이미지 준비 중</span></div>;
 return <div className={compact?'guide-media-compact':'guide-media'}><div className="guide-photo-grid">{(compact?media.images.slice(0,1):media.images).map((img,i)=><figure key={img.src}><Image src={img.src} alt={`${guide.name} 참고 동작 ${i+1}`} width={800} height={800} sizes={compact?"(max-width: 600px) 42vw, 300px":"(max-width: 600px) 85vw, 340px"} quality={75} loading="lazy"/>{!compact&&<figcaption>동작 참고 {i+1}</figcaption>}</figure>)}</div>{!compact&&<><p className="muted">참고 동작: {media.exerciseName}. 기구와 운동 변형에 따라 자세가 달라질 수 있어요.</p><div className="guide-image-credit">{media.images.map((img,i)=><p key={img.src}>이미지 {i+1}: {img.author} · <a href={img.licenseUrl} target="_blank" rel="noopener noreferrer">{img.license}</a> · <a href={img.original} target="_blank" rel="noopener noreferrer">원본</a></p>)}<a href={media.source} target="_blank" rel="noopener noreferrer">wger 출처 · 이미지는 원본 그대로 사용</a></div></>}</div>;
}
function GuideContent({guide}:{guide:ExerciseGuide}){return <><div className="guide-tags"><span>{guide.body}</span><span>{guide.equipment}</span></div><GuideMedia guide={guide}/><div className="guide-steps"><p><strong>01 준비</strong>{guide.start}</p><p><strong>02 움직이기</strong>{guide.finish}</p></div><ul className="guide-cues">{guide.cues.map(c=><li key={c}>{c}</li>)}</ul><p className="muted">처음에는 가벼운 무게로 배우고 통증이 생기면 중단하세요. 초보자에게 강제반복·실패 지점 훈련은 기본 목표가 아닙니다.</p><a href="https://www.nasm.org/workout-exercise-guidance" target="_blank" rel="noopener noreferrer" className="text-button">전문기관 운동 자료 보기 ↗</a></>;}
export function ExercisePreview({exercises}:{exercises:Exercise[]}){
 const [expanded,setExpanded]=useState(false),[selected,setSelected]=useState<Exercise|null>(null);const guide=selected?guideFor(selected.name):undefined;
 return <><ol className="exercise-preview guide-preview">{(expanded?exercises:exercises.slice(0,3)).map((e,i)=><li key={e.id}><button type="button" onClick={()=>setSelected(e)} aria-label={`${e.name} 그림 가이드`}><span className="exercise-no">{String(i+1).padStart(2,'0')}</span><span>{e.name}<small>{guideFor(e.name)?.body||'직접 추가한 운동'}</small></span><BookOpen size={14}/><small>{e.sets}세트</small></button></li>)}</ol>{exercises.length>3&&<button type="button" className="text-button exercise-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'접기':`+ ${exercises.length-3}개 운동 펼치기`}<ChevronDown size={14}/></button>}<Dialog open={!!selected} onOpenChange={v=>!v&&setSelected(null)}><DialogContent className="app-dialog guide-dialog"><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>그림으로 살펴보는 운동 가이드</DialogDescription>{guide?<GuideContent guide={guide}/>:<p>아직 이 운동의 그림 가이드가 없어요. 이름이 비슷한 다른 운동의 자세를 그대로 적용하지 말고, 트레이너에게 확인해주세요.</p>}{selected&&<GuideRequest key={selected.id} name={selected.name}/>}
{selected?.prescription&&<details className="routine-details"><summary>내 루틴 수행법</summary><p>{selected.prescription}</p></details>}</DialogContent></Dialog></>;
}
export function ExerciseLibrary({onPick}:{onPick?:(name:string,unit?:'seconds'|'reps')=>void}={}){
 const [open,setOpen]=useState(false),[part,setPart]=useState('전체'),[equipment,setEquipment]=useState('전체'),[query,setQuery]=useState(''),[limit,setLimit]=useState(24),[selected,setSelected]=useState<ExerciseGuide|null>(null);
 const filtered=findExerciseGuides(query,part,equipment);
 return <><button type="button" className="secondary" aria-label="그림으로 운동 찾기" onClick={()=>setOpen(true)}><BookOpen size={16}/><span className="nav-label-long">그림으로 운동 찾기</span><span className="nav-label-short">운동 찾기</span></button>
 <Dialog open={open} onOpenChange={v=>{setOpen(v);if(!v)setSelected(null);}}><DialogContent className="app-dialog guide-library"><DialogTitle>{selected?.name||'그림으로 운동 찾기'}</DialogTitle><DialogDescription>{selected?'기구와 동작을 확인하고 내 루틴에 활용해요.':`${exerciseGuides.length}종의 운동 · 부위, 기구, 한글·영문 이름으로 찾아보세요.`}</DialogDescription>
 {selected?<><button type="button" className="text-button" onClick={()=>setSelected(null)}>← 목록으로</button><GuideContent guide={selected}/>{selected.unit==='seconds'&&<p className="muted">횟수 대신 유지 시간(초)을 정하는 운동이에요.</p>}<GuideRequest key={selected.id} name={selected.name}/>{onPick&&<button type="button" className="primary" onClick={()=>{onPick(selected.name,selected.unit);setOpen(false);setSelected(null);}}>{selected.unit==='seconds'?'이 운동 추가 · 기본 30초':'이 운동 추가'}</button>}</>:<>
 <label className="field">운동 검색<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(24);}} placeholder="턱걸이, 사레레, dumbbell, leg curl…"/></label>
 <div className="two-fields guide-selectors"><label className="field">운동 부위<select value={part} onChange={e=>{setPart(e.target.value);setLimit(24);}}>{bodyFilters.map(p=><option key={p}>{p}</option>)}</select></label><label className="field">사용 기구<select value={equipment} onChange={e=>{setEquipment(e.target.value);setLimit(24);}}>{equipmentFilters.map(p=><option key={p}>{p}</option>)}</select></label></div>
 <div className="section-line"><p className="muted" role="status">{filtered.length}종 검색됨 · {Math.min(limit,filtered.length)}종 표시</p>{(query||part!=='전체'||equipment!=='전체')&&<button type="button" className="text-button" onClick={()=>{setQuery('');setPart('전체');setEquipment('전체');setLimit(24);}}>필터 초기화</button>}</div>
 <div className="guide-library-grid">{filtered.slice(0,limit).map(g=><button type="button" key={g.id} onClick={()=>setSelected(g)}><GuideMedia guide={g} compact/><strong>{g.name}</strong><small>{g.body} · {g.equipment}</small>{g.unit==='seconds'&&<small>시간 기준 운동</small>}</button>)}</div>
 {filtered.length>limit&&<button type="button" className="secondary full-width" onClick={()=>setLimit(limit+24)}>운동 24개 더 보기 · {filtered.length-limit}개 남음</button>}
 {!filtered.length&&<><p>일치하는 운동이 없어요. 부위·기구 필터를 풀거나 다른 이름으로 검색해보세요.</p>{query.trim()&&<GuideRequest key={query.trim()} name={query.trim().slice(0,60)}/>}</>}
 </>}
 </DialogContent></Dialog></>;
}
