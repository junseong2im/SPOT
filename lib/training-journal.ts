import {z} from 'zod';
import {localDate} from './gym-model';
import type {Database} from '../db/adapter';
import {AppError} from './gym-service';
import {journalDate as date,journalContent,journalEntry,type JournalEntry} from './training-journal-model';
export type {JournalEntry} from './training-journal-model';
type Row={id:string;date:string;content:string;revision:number;deleted:number};
export const hydrateJournal=(r:Row):JournalEntry=>({id:r.id,date:r.date,content:journalContent.parse(JSON.parse(r.content)),revision:r.revision});
export async function journalPage(db:Database,userId:string,cursor?:string|null){
 let bound:{date:string;id:string}|null=null;if(cursor){try{bound=z.object({date,id:z.string().uuid()}).parse(JSON.parse(Buffer.from(cursor,'base64url').toString()));}catch{throw new AppError('기록 페이지를 다시 열어주세요.');}}
 const rows=(await db.prepare('SELECT * FROM training_journal WHERE user_id=? AND deleted=0'+(bound?' AND (date<? OR (date=? AND id<?))':'')+' ORDER BY date DESC,id DESC LIMIT 101').bind(userId,...(bound?[bound.date,bound.date,bound.id]:[])).all<Row>()).results;
 const page=rows.slice(0,100),last=page.at(-1);return {entries:page.map(hydrateJournal),cursor:rows.length>100&&last?Buffer.from(JSON.stringify({date:last.date,id:last.id})).toString('base64url'):null};
}
export async function journalAction(db:Database,userId:string,raw:unknown){
 const input=z.discriminatedUnion('action',[z.object({action:z.literal('save'),entry:journalEntry}),z.object({action:z.literal('archive'),id:z.string().uuid(),revision:z.number().int().min(1)}),z.object({action:z.literal('restore'),id:z.string().uuid(),revision:z.number().int().min(1)})]).safeParse(raw);
 if(!input.success)throw new AppError('날짜와 입력 범위를 확인해주세요.');const a=input.data;
 return db.transaction(async tx=>{
  const id=a.action==='save'?a.entry.id:a.id;
  const row=await tx.prepare('SELECT * FROM training_journal WHERE id=? FOR UPDATE').bind(id).first<Row&{user_id:string}>();
  if(row&&row.user_id!==userId)throw new AppError('기록에 접근할 수 없어요.',404);
  if(a.action==='save'){
   if(row&&(row.revision!==a.entry.revision||row.deleted))throw new AppError('다른 기기에서 바뀐 기록이에요. 다시 불러오세요.',409);
   if(!row&&a.entry.revision!==0)throw new AppError('기록을 찾을 수 없어요.',404);
   const e=a.entry;
   const saved=row?await tx.prepare('UPDATE training_journal SET date=?,kind=?,content=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? RETURNING *').bind(e.date,e.content.kind,JSON.stringify(e.content),Date.now(),id,userId).first<Row>():await tx.prepare('INSERT INTO training_journal(id,user_id,date,kind,content,updated_at) VALUES(?,?,?,?,?,?) RETURNING *').bind(id,userId,e.date,e.content.kind,JSON.stringify(e.content),Date.now()).first<Row>();
   return {entry:hydrateJournal(saved!)};
  }
  if(!row)throw new AppError('기록을 찾을 수 없어요.',404);if(row.revision!==a.revision)throw new AppError('기록을 다시 불러오세요.',409);
  await tx.prepare('UPDATE training_journal SET deleted=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?').bind(a.action==='archive'?1:0,Date.now(),id,userId).run();return {id,revision:row.revision+1};
 });
}

export async function journalSummary(db:Database,userId:string,now=Date.now()){
 const since=localDate(new Date(now-7*86400000));
 const rows=(await db.prepare('SELECT * FROM training_journal WHERE user_id=? AND deleted=0 AND date>=? ORDER BY date DESC,id DESC LIMIT 1001').bind(userId,since).all<Row>()).results;
 const entries=rows.slice(0,1000).map(hydrateJournal).filter(e=>e.date<=localDate(new Date(now)));
 const meals=entries.filter(e=>e.content.kind==='meal'),cardio=entries.filter(e=>e.content.kind==='cardio'),recovery=entries.filter(e=>e.content.kind==='recovery');
 const sleeps=recovery.flatMap(e=>e.content.kind==='recovery'&&e.content.sleep!==null?[e.content.sleep]:[]);
 const protein=meals.flatMap(e=>e.content.kind==='meal'&&e.content.protein!==null?[e.content.protein]:[]);
 return {mealDays:new Set(meals.map(e=>e.date)).size,meals:meals.length,proteinEntries:protein.length,proteinTotal:protein.length?protein.reduce((n,x)=>n+x,0):null,cardioEntries:cardio.length,cardioMinutes:cardio.reduce((n,e)=>n+(e.content.kind==='cardio'?e.content.minutes:0),0),sleepEntries:sleeps.length,sleepAverage:sleeps.length?Math.round(sleeps.reduce((n,x)=>n+x,0)/sleeps.length*10)/10:null,truncated:rows.length>1000};
}

export async function healthDashboard(db:Database,userId:string,now=Date.now()){
 const today=localDate(new Date(now));
 const [body,recovery,todayRows,week]=await Promise.all([
  db.prepare("SELECT * FROM training_journal WHERE user_id=? AND kind='body' AND deleted=0 AND date<=? ORDER BY date DESC,updated_at DESC,id DESC LIMIT 1").bind(userId,today).first<Row>(),
  db.prepare("SELECT * FROM training_journal WHERE user_id=? AND kind='recovery' AND deleted=0 AND date<=? ORDER BY date DESC,updated_at DESC,id DESC LIMIT 1").bind(userId,today).first<Row>(),
  db.prepare("SELECT * FROM training_journal WHERE user_id=? AND kind='meal' AND deleted=0 AND date=? ORDER BY id LIMIT 1001").bind(userId,today).all<Row>(),
  journalSummary(db,userId,now),
 ]);
 const meals=todayRows.results.slice(0,1000).map(hydrateJournal);
 const nutrients=Object.fromEntries((['calories','protein','carbs','fat'] as const).map(key=>{const values=meals.flatMap(e=>e.content.kind==='meal'&&e.content[key]!==null?[e.content[key]!]:[]);return [key,{total:values.length?values.reduce((a,b)=>a+b,0):null,recorded:values.length}];})) as Record<'calories'|'protein'|'carbs'|'fat',{total:number|null;recorded:number}>;
 return {today,body:body?hydrateJournal(body):null,recovery:recovery?hydrateJournal(recovery):null,nutrition:{...nutrients,meals:meals.length,truncated:todayRows.results.length>1000},week};
}
