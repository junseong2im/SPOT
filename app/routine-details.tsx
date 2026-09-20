import type { Routine } from '@/lib/gym-model';
import './routine-details.css';

export function RoutineDetails({routine}:{routine:Routine}) {
  return <details className="routine-details"><summary>전체 운동 · 상세 수행법</summary>
    <ol>{routine.exercises.map(e=><li key={e.id}><strong>{e.name}</strong><p>{e.prescription || `${e.sets}세트 × ${e.reps}회`}</p></li>)}</ol>
    {routine.notes && <details><summary>프로그램 가이드</summary><p className="routine-notes">{routine.notes}</p></details>}
  </details>;
}

export function RoutineDetailFields({routine,onChange}:{routine:Routine;onChange:(value:Routine)=>void}) {
  return <details className="routine-details" onToggle={event=>{if(event.currentTarget.open)event.currentTarget.querySelectorAll('textarea').forEach(input=>{input.style.height='auto';input.style.height=`${input.scrollHeight+2}px`;});}} onInput={event=>{const input=event.target;if(input instanceof HTMLTextAreaElement){input.style.height='auto';input.style.height=`${input.scrollHeight+2}px`;}}}><summary>상세 수행법 · 프로그램 메모 편집</summary>
    <p className="muted">세트·횟수 칸은 기본값입니다. 반복 범위, 웜업, 탑세트·백오프, 휴식은 아래에 자세히 적어주세요.</p>
    {routine.exercises.map((e,i)=><label className="field routine-detail-field" key={e.id}>{i+1}. {e.name || '새 운동'} 수행법<textarea rows={3} maxLength={2000} value={e.prescription || ''} onChange={event=>onChange({...routine,exercises:routine.exercises.map(x=>x.id===e.id?{...x,prescription:event.target.value}:x)})}/></label>)}
    <label className="field routine-detail-field">프로그램 가이드<textarea rows={7} maxLength={12000} value={routine.notes || ''} onChange={e=>onChange({...routine,notes:e.target.value})}/></label>
  </details>;
}
