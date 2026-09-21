import type {Routine} from './gym-model';
export type ProgramOptions={split:'fullbody'|'upperlower'|'ppl';goal:'hypertrophy'|'strength'|'consistency';equipment:'gym'|'home';experience:'beginner'|'experienced'};
export function buildTrainingProgram(o:ProgramOptions):Omit<Routine,'version'>[]{
 const gym=o.equipment==='gym';const sets=o.experience==='beginner'||o.goal==='consistency'?2:3,reps=o.goal==='strength'&&o.experience==='experienced'?6:10;
 const moves={push:gym?['체스트 프레스','숄더 프레스','사이드 레터럴 레이즈','케이블 푸시다운']:['푸시업','덤벨 숄더 프레스','사이드 레터럴 레이즈','덤벨 트라이셉스 익스텐션'],pull:gym?['랫 풀다운','시티드 케이블 로우','리어 델트 플라이','덤벨 컬']:['원암 덤벨 로우','인클라인 덤벨 로우','리어 델트 플라이','덤벨 컬'],legs:gym?['레그 프레스','레그 컬','레그 익스텐션','카프 레이즈']:['고블릿 스쿼트','덤벨 루마니안 데드리프트','리버스 런지','카프 레이즈']};
 const parts=o.split==='ppl'?[{name:'PUSH',moves:moves.push},{name:'PULL',moves:moves.pull},{name:'LEGS',moves:moves.legs}]:o.split==='upperlower'?[{name:'UPPER',moves:[moves.push[0],moves.pull[0],moves.pull[1],moves.push[1],moves.pull[3]]},{name:'LOWER',moves:[...moves.legs,'플랭크']}]:[{name:'FULL BODY A',moves:[moves.legs[0],moves.push[0],moves.pull[0],'플랭크']},{name:'FULL BODY B',moves:[moves.legs[1],moves.pull[1],moves.push[1],moves.pull[3]]}];
 const names={hypertrophy:'근육 성장',strength:'근력 중심',consistency:'습관 만들기'};
 return parts.map(p=>({id:crypto.randomUUID(),name:`SPOT ${p.name}`,subtitle:`${names[o.goal]} · ${gym?'헬스장':'덤벨·벤치 홈트'}`,notes:`SPOT 구성 예시. ${o.experience==='beginner'?'입문자는 가벼운 중량으로 동작을 먼저 익히세요.':'무게는 본인의 수행 기록과 컨디션을 확인해 정하세요.'} 자동 증량이나 실패지점 훈련을 요구하지 않습니다. ${o.split==='fullbody'?'A/B를 번갈아 배치':'분할 순서대로 배치'}하고 휴식일을 포함하세요. 횟수·세트는 시작 예시이며 몸 상태와 시간에 맞게 수정하세요.`,exercises:p.moves.map((name,i)=>({id:crypto.randomUUID(),name,sets,reps:name==='플랭크'?1:i>=2?12:reps,...(name==='플랭크'?{durationSeconds:30}:{})}))}));
}
