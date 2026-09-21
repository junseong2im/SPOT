'use client';
import type {Session} from '@/lib/gym-model';
import {responseOpen} from '@/lib/planning';

export function SessionResponse({session,userId,name,busy,onRespond}:{session:Session;userId?:string;name:(id:string)=>string;busy:boolean;onRespond:(response:'going'|'notGoing')=>void}){
 const answers=session.responses??{};
 const going=session.participants.filter(id=>answers[id]==='going'),waiting=session.participants.filter(id=>answers[id]!=='going'),absent=Object.keys(answers).filter(id=>answers[id]==='notGoing');
 const canRespond=!!userId&&responseOpen(session)&&(session.participants.includes(userId)||answers[userId]==='notGoing');
 if(!canRespond&&!Object.keys(answers).length)return null;
 return <div className="session-response">
  {canRespond&&<><strong>이번 운동, 올 수 있나요?</strong><div className="response-buttons"><button type="button" className={answers[userId!]==='going'?'primary':'secondary'} aria-pressed={answers[userId!]==='going'} disabled={busy} onClick={()=>onRespond('going')}>참석할게요</button><button type="button" className="secondary" aria-pressed={answers[userId!]==='notGoing'} disabled={busy} onClick={()=>onRespond('notGoing')}>못 가요</button></div><small>불참하면 자리가 비워져요. 다시 참석은 빈자리가 있을 때 가능해요. 실제 출석 체크는 별도예요.</small></>}
  <details><summary>참석 확인 {going.length} · 미응답 {waiting.length} · 불참 {absent.length}</summary>{[["참석",going],["미응답",waiting],["불참",absent]].map(([label,ids])=><p key={label as string}><strong>{label}:</strong> {(ids as string[]).map(name).join(', ')||'없음'}</p>)}</details>
 </div>;
}
