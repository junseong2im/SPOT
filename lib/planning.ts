import { addDays, type Session, type CrewState } from './gym-model';

export const WEEKDAYS = ['일','월','화','수','목','금','토'];
export function weekday(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
export function sessionStart(session: Pick<Session,'date'|'time'>) { return new Date(`${session.date}T${session.time}:00+09:00`).getTime(); }
export function participationClosed(session: Session, now=Date.now()) { return now >= sessionStart(session) - (session.deadlineMinutes??0)*60000; }
export function responseOpen(session: Session, now=Date.now()) { const start=sessionStart(session);return !session.cancelled&&now>=start-86400000&&now<start; }
export function repeatDates(start: string, end: string, days: number[]): string[] {
  if (end < start || (new Date(end).getTime()-new Date(start).getTime())/86400000 > 180) throw new Error('반복 기간은 시작일부터 최대 180일까지 설정해주세요.');
  const result: string[]=[];
  for(let date=start;date<=end;date=addDays(date,1)) if(days.includes(weekday(date)))result.push(date);
  if(!result.length || result.length>60)throw new Error('반복 일정은 한 번에 1~60개까지 만들 수 있어요. 기간이나 요일을 조정해주세요.');
  return result;
}
export function normalizeState(state: CrewState): CrewState {
  return {...state,weekPlan:state.weekPlan??{},polls:state.polls??[],sessions:state.sessions.map(session=>({...session,capacity:session.capacity??null,deadlineMinutes:session.deadlineMinutes??0,version:session.version??1}))};
}
