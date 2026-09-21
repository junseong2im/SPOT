'use client';
import {useEffect,useRef,useState} from 'react';
import type {Worker} from 'tesseract.js';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Routine} from '@/lib/gym-model';
import {parseRoutineText,finalizeImport,type ImportDraft} from '@/lib/routine-assistant/parser';
import {proposeEdit} from '@/lib/routine-assistant/edits';
import {DecisionReview,type Answers,type Clarification} from '@/lib/routine-assistant/decisions';
import './routine-assistant.css';

type Props={open:boolean;onClose:()=>void;routine?:Routine;onImport?:(routines:Routine[])=>Promise<boolean>;onEdit?:(routine:Routine)=>void;busy?:boolean;serverError?:string};
export function RoutineAssistant({open,onClose,routine,onImport,onEdit,busy=false,serverError}:Props){
 const [text,setText]=useState(''),[draft,setDraft]=useState<ImportDraft|null>(null),[edit,setEdit]=useState<ReturnType<typeof proposeEdit>|null>(null),[error,setError]=useState('');
 const [confirmed,setConfirmed]=useState(false),[working,setWorking]=useState(false),[progress,setProgress]=useState(''),[ocrReview,setOcrReview]=useState(false);
 const [answers,setAnswers]=useState<Answers>({}),[question,setQuestion]=useState<Clarification|null>(null),[quantity,setQuantity]=useState('');
 const worker=useRef<Worker|null>(null),generation=useRef(0),locked=useRef(false);
 const reset=()=>{setDraft(null);setEdit(null);setConfirmed(false);setError('');setQuestion(null);};
 useEffect(()=>()=>{generation.current++;void worker.current?.terminate();},[]);
 function close(){if(busy)return;generation.current++;void worker.current?.terminate();worker.current=null;locked.current=false;setWorking(false);onClose();}
 async function readImage(file:File){
  if(locked.current)return;locked.current=true;
  const run=++generation.current;reset();setWorking(true);setProgress('사진을 준비하는 중…');let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('10MB 이하의 PNG·JPG·WebP 사진을 선택해주세요.');
   const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>30000000){bitmap.close();throw Error('사진이 너무 커요. 루틴 부분만 잘라서 올려주세요.');}
   const ratio=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
   const {createWorker}=await import('tesseract.js');if(run!==generation.current)return;
   // The image stays in this browser; all OCR code and languages come from our own static files.
   const operation=(async()=>{
    const w=await createWorker('kor+eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr',langPath:'/ocr',logger:m=>{if(run===generation.current)setProgress(m.status==='recognizing text'?`글자 읽는 중 ${Math.round(m.progress*100)}%`:'문자 인식 모델 준비 중…');}});
    if(run!==generation.current){await w.terminate();return '';}
    worker.current=w;const result=await w.recognize(canvas);return result.data.text;
   })();
   const recognized=await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('사진 인식 시간이 길어졌어요. 더 작은 사진이나 글 붙여넣기로 다시 시도해주세요.')),90000);})]);
   if(run!==generation.current)return;
   if(!recognized.trim())throw Error('읽을 수 있는 글자가 없어요. 밝고 선명한 루틴표를 선택해주세요.');
   if(recognized.length>12000)throw Error('사진의 글이 너무 많아요. 루틴 부분만 잘라서 다시 선택해주세요.');
   setText(recognized);setOcrReview(true);setProgress('사진에서 읽은 글을 먼저 확인해주세요. 숫자와 표 순서가 틀릴 수 있어요.');
  }catch(e){if(run===generation.current)setError((e as Error).message);}finally{if(timer)clearTimeout(timer);if(run===generation.current){generation.current++;void worker.current?.terminate();worker.current=null;setWorking(false);locked.current=false;}}
 }
 function analyze(nextAnswers=answers){reset();try{if(routine)setEdit(proposeEdit(routine,text,nextAnswers));else{const parsed=parseRoutineText(text);parsed.routines=parsed.routines.map(r=>({...r,id:crypto.randomUUID(),exercises:r.exercises.map(e=>({...e,id:crypto.randomUUID()}))}));setDraft(parsed);}}catch(e){if(e instanceof DecisionReview){setQuestion(e.clarification);setQuantity('');}else setError((e as Error).message);}}
 function answer(value:string){if(!question)return;const next={...answers,[question.id]:value};setAnswers(next);analyze(next);}
 async function apply(){setError('');try{if(edit&&onEdit){onEdit(edit.routine);close();}else if(draft&&onImport){const routines=finalizeImport(draft);if(await onImport(routines))close();}}catch(e){setError((e as Error).message);}}
 const unresolved=draft?.routines.flatMap(r=>r.exercises).some(e=>!e.name.trim()||e.name.length>60||e.sets==null||e.reps==null||e.sets<1||e.sets>30||e.reps<1||e.reps>100);
 return <Dialog open={open} onOpenChange={v=>!v&&close()}><DialogContent className="app-dialog assistant-dialog"><DialogTitle>{routine?'말로 루틴 수정':'글·사진으로 루틴 만들기'}</DialogTitle><DialogDescription>{routine?`${routine.name}의 변경 초안을 만들어요. 실제 저장은 편집 화면에서 합니다.`:'루틴표를 붙여넣으면 운동별로 정리해요. 사진은 기기 안에서 읽습니다.'}</DialogDescription>
  {!draft&&!edit?<div className="form-stack">
   {!routine&&<label className="secondary assistant-upload">루틴 사진 가져오기<input type="file" accept="image/png,image/jpeg,image/webp" disabled={working||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void readImage(file);}}/></label>}
   {progress&&<p role="status" className="muted">{progress}</p>}
   <label className="field">{routine?'어떻게 바꿀까요?':'루틴 글'}<textarea rows={routine?4:9} maxLength={routine?500:12000} disabled={working||busy} value={text} onChange={e=>{setText(e.target.value);setError('');setAnswers({});setQuestion(null);}} placeholder={routine?'벤치를 3세트로 바꿔줘':'월요일 가슴\n벤치 4×10\n인클라인 덤벨 프레스 3세트 8~12회\n\n수요일 등\n랫풀 4×12'}/></label>
   {ocrReview&&!working&&<label className="check-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>사진에서 읽은 글자·숫자·순서를 확인했어요</label>}
   {question&&<section className="assistant-question" aria-label="추가 확인"><strong>{question.question}</strong>{question.options?<div className="form-stack">{question.options.map(option=><button type="button" className="secondary" key={option.value} onClick={()=>answer(option.value)}>{option.label}</button>)}</div>:<div className="form-stack"><label className="field">확인할 숫자<input type="number" inputMode="numeric" min={question.min} max={question.max} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><button type="button" className="secondary" disabled={!quantity} onClick={()=>answer(quantity)}>이 숫자로 확인</button></div>}</section>}
   {!question&&<button type="button" className="primary" disabled={working||busy||!text.trim()||(ocrReview&&!confirmed)} onClick={()=>analyze()}>초안 만들기</button>}
   <details><summary>어떻게 읽나요?</summary><p className="muted">운동 이름·세트·횟수는 사전과 규칙으로 해석하고, 수정 의도는 작은 학습 모델로 분류해요. 자유로운 상담 AI는 아니며 모호한 내용은 확인을 요청합니다. 수정 예: 벤치를 3세트로 / 랫풀 2회 줄여줘 / 벤치 대신 체스트 프레스로 교체해줘.</p></details>
  </div>:<div className="form-stack">
   {edit&&<ul>{edit.changes.map((change,i)=><li key={i}>{change}</li>)}</ul>}
   {draft&&<><p className="muted">{draft.routines.length}개 루틴 · 반복 범위는 수행법에 보존하고 기준 횟수는 하한값으로 표시해요.</p>{!draft.routines.length&&<p role="alert">운동을 찾지 못했어요. “벤치 4×10”처럼 운동별로 줄을 나눠주세요.</p>}
    {draft.routines.map((r,ri)=><section key={r.id} className="assistant-routine"><label className="field">루틴 이름<input value={r.name} maxLength={60} onChange={e=>setDraft({...draft,routines:draft.routines.map((x,i)=>i===ri?{...x,name:e.target.value}:x)})}/></label>{r.exercises.map((ex,ei)=><div className="assistant-exercise" key={ex.id}><div className="assistant-fields"><label className="field">운동<input value={ex.name} maxLength={60} onChange={e=>setDraft({...draft,routines:draft.routines.map((x,i)=>i===ri?{...x,exercises:x.exercises.map((v,j)=>j===ei?{...v,name:e.target.value}:v)}:x)})}/></label>{(['sets','reps'] as const).map(field=><label className="field" key={field}>{field==='sets'?'세트':'횟수'}<input type="number" min={1} max={field==='sets'?30:100} value={ex[field]??''} onChange={e=>setDraft({...draft,routines:draft.routines.map((x,i)=>i===ri?{...x,exercises:x.exercises.map((v,j)=>j===ei?{...v,[field]:e.target.value?Number(e.target.value):null}:v)}:x)})}/></label>)}</div>{ex.issues.length>0&&<p className="assistant-warning">확인 필요: {ex.issues.join(' ')}</p>}<details><summary>읽은 원문</summary><p>{ex.source}</p></details></div>)}</section>)}
    {draft.unparsed.length>0&&<details className="assistant-warning" open><summary>운동 항목으로 읽지 못한 {draft.unparsed.length}줄</summary><p>누락된 운동이 있다면 원문으로 돌아가 수정해주세요. 아래 내용은 프로그램 메모에 보존됩니다.</p><pre>{draft.unparsed.join('\n')}</pre></details>}
   </>}
   <label className="check-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>운동 이름·숫자와 확인 필요한 부분을 검토했어요</label>
   <button type="button" className="primary" disabled={busy||!confirmed||!!unresolved||!!draft&&!draft.routines.length} onClick={()=>void apply()}>{busy?'저장 중…':edit?'변경 초안을 편집기에 적용':'공통 루틴으로 한 번에 저장'}</button>
   <button type="button" className="text-button" disabled={busy} onClick={reset}>원문으로 돌아가기</button>
  </div>}
  {(error||serverError)&&<p role="alert" className="form-error">{error||serverError}</p>}
 </DialogContent></Dialog>;
}
