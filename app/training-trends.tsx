'use client';
import {useState} from 'react';
import type {ExerciseTrend} from '@/lib/training-analysis';
import {loadLabels} from '@/lib/training-model';
export function TrainingTrends({trends}:{trends:ExerciseTrend[]}){
 const [selected,setSelected]=useState('');const trend=trends.find(t=>t.key===selected)??trends[0];
 if(!trend)return <p className="muted">완료한 본세트가 쌓이면 운동별 변화를 보여드려요.</p>;
 return <div className="form-stack"><label className="field">비교할 운동·기구<select value={trend.key} onChange={e=>setSelected(e.target.value)}>{trends.map(t=><option key={t.key} value={t.key}>{t.name} · {loadLabels[t.convention]}{t.equipment?` · ${t.equipment}`:''}</option>)}</select></label><p className="muted">최근 90일 내 최대 12회. 같은 이름·중량 기준·기구 구분끼리 모았습니다. 웜업과 드롭세트는 이 표에서 제외됩니다.</p><div className="training-trend-scroll"><table className="training-trend-table"><thead><tr><th>날짜</th><th>본세트</th><th>{trend.timed?'총 초':'총 횟수'}</th>{!trend.timed&&<><th>입력 최대 kg</th><th>kg·회 합계</th></>}</tr></thead><tbody>{trend.points.map(p=><tr key={p.workoutId}><td>{new Date(p.date).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'})}</td><td>{p.sets}</td><td>{trend.timed?p.seconds:p.reps}</td>{!trend.timed&&<><td>{p.maxWeight??'—'}</td><td>{p.volume===null?'미입력':p.volume.toLocaleString()}</td></>}</tr>)}</tbody></table></div><p className="muted">세트 수·가동범위·휴식이 다르면 합계 증가만으로 근력 향상을 판단할 수 없어요. 기구 표시 중량은 다른 기구와 비교하지 않습니다.</p></div>;
}
