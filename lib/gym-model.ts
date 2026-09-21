export type Exercise = { id: string; name: string; sets: number; reps: number; prescription?: string };
export type Routine = { id: string; name: string; subtitle: string; notes?: string; exercises: Exercise[]; version: number };
export type PersonalRoutine = Routine & { baseVersion: number; revision: number };
export type Session = { id: string; title: string; date: string; time: string; routineId: string; creator: string; participants: string[]; cancelled: boolean; capacity?: number | null; deadlineMinutes?: number; seriesId?: string; version?: number; responses?: Record<string,'going'|'notGoing'> };
export type PollOption = { id: string; date: string; time: string; votes: string[] };
export type TimePoll = { id: string; title: string; creator: string; routineId: string; options: PollOption[]; closesAt: number; capacity: number | null; status: 'open' | 'confirmed' | 'closed'; sessionId?: string };
export type CrewState = { routines: Routine[]; sessions: Session[]; weekPlan?: Record<string,string>; polls?: TimePoll[] };
export type Member = { userId: string; name: string };
export type Crew = { id: string; name: string; invite: string; owner: string; revision: number; state: CrewState; members: Member[]; personal: PersonalRoutine[] };
export type InboxItem = { id:string; crewId:string; sessionId:string; title:string; body:string; dueAt:number|string; readAt:number|string|null; pushState:string };
export type Snapshot = { user: { userId: string; displayName: string } | null; crews: { id: string; name: string }[]; crew: Crew | null; notifications?: {items:InboxItem[];settings:{enabled:number;push_enabled:number;reminder_minutes:number}} };
export const starterRoutines: Routine[] = [
  {id:'push',name:'PUSH DAY',subtitle:'가슴 · 어깨 · 삼두',version:1,exercises:[{id:'bench',name:'벤치프레스',sets:4,reps:10},{id:'incline',name:'인클라인 덤벨프레스',sets:3,reps:12},{id:'shoulder',name:'숄더프레스',sets:3,reps:10},{id:'lateral',name:'사이드 레터럴 레이즈',sets:3,reps:15},{id:'triceps',name:'케이블 푸시다운',sets:3,reps:12}]},
  {id:'pull',name:'PULL DAY',subtitle:'등 · 이두',version:1,exercises:[{id:'lat',name:'랫풀다운',sets:4,reps:10},{id:'row',name:'시티드 로우',sets:3,reps:12},{id:'dbrow',name:'덤벨 로우',sets:3,reps:12},{id:'curl',name:'덤벨 컬',sets:3,reps:12}]},
  {id:'legs',name:'LEG DAY',subtitle:'하체 · 코어',version:1,exercises:[{id:'squat',name:'스쿼트',sets:4,reps:10},{id:'press',name:'레그프레스',sets:3,reps:12},{id:'legcurl',name:'레그 컬',sets:3,reps:12},{id:'crunch',name:'크런치',sets:3,reps:15}]},
];
export function localDate(date=new Date()){ const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-'); }
export function addDays(date:string,n:number){ const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); }
export function weekDates(date:string){const d=new Date(`${date}T12:00:00`);return Array.from({length:7},(_,i)=>addDays(date,i-(d.getDay()+6)%7));}
