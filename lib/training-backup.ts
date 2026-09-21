import {z} from 'zod';
import type {Database} from '../db/adapter';
import {AppError} from './gym-service';
import {backupBatch} from './training-backup-model';
export async function exportTraining(db:Database,userId:string,cursor?:string|null){
 if(cursor&&!z.string().uuid().safeParse(cursor).success)throw new AppError('백업 페이지를 다시 시작해주세요.');
 const rows=(await db.prepare("SELECT id,routine_name,state,started_at,finished_at FROM workout_sessions WHERE user_id=? AND status='completed'"+(cursor?' AND id>?':'')+' ORDER BY id LIMIT 11').bind(userId,...(cursor?[cursor]:[])).all<{id:string;routine_name:string;state:string;started_at:string|number;finished_at:string|number}>()).results;
 const page=rows.slice(0,10);return {format:'spot-training-v1',workouts:page.map(w=>({...w,state:JSON.parse(w.state),started_at:Number(w.started_at),finished_at:Number(w.finished_at)})),cursor:rows.length>10?page.at(-1)!.id:null};
}
export async function restoreTraining(db:Database,userId:string,raw:unknown){
 const parsed=backupBatch.safeParse(raw);if(!parsed.success)throw new AppError('SPOT 백업 형식·날짜·기록값을 확인해주세요.');const b=parsed.data;
 return db.transaction(async tx=>{
  await tx.prepare("INSERT INTO training_profiles(user_id,content,updated_at) VALUES(?,'{}',?) ON CONFLICT(user_id) DO NOTHING").bind(userId,Date.now()).run();
  await tx.prepare('SELECT user_id FROM training_profiles WHERE user_id=? FOR UPDATE').bind(userId).first();
  let added=0,skipped=0;
  for(const w of b.workouts){const prior=await tx.prepare('SELECT user_id FROM workout_sessions WHERE id=?').bind(w.id).first<{user_id:string}>();if(prior){if(prior.user_id!==userId)throw new AppError('다른 계정의 기록 ID가 포함돼 있어요.',403);skipped++;continue;}
   await tx.prepare("INSERT INTO workout_sessions(id,user_id,crew_id,routine_id,routine_name,status,state,started_at,finished_at,updated_at) VALUES(?,?,?, ?,?,'completed',?,?,?,?)").bind(w.id,userId,'imported','imported',w.routine_name,JSON.stringify(w.state),w.started_at,w.finished_at,Date.now()).run();added++;
  }
  for(const e of b.journal){const prior=await tx.prepare('SELECT user_id FROM training_journal WHERE id=?').bind(e.id).first<{user_id:string}>();if(prior){if(prior.user_id!==userId)throw new AppError('다른 계정의 생활 기록 ID가 포함돼 있어요.',403);skipped++;continue;}
   await tx.prepare('INSERT INTO training_journal(id,user_id,date,kind,content,updated_at) VALUES(?,?,?,?,?,?)').bind(e.id,userId,e.date,e.content.kind,JSON.stringify(e.content),Date.now()).run();added++;
  }
  if(b.profile)await tx.prepare("UPDATE training_profiles SET content=?,updated_at=? WHERE user_id=? AND content='{}'").bind(JSON.stringify(b.profile),Date.now(),userId).run();
  return {added,skipped};
 });
}
