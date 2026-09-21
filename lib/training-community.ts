import {z} from 'zod';
import type {Database} from '../db/adapter';
import {AppError} from './gym-service';
import {musicAdmin} from './music-service';
export type Question={id:string;author_name:string;body:string;revision:number;created_at:number;mine:boolean;reports:number};
export async function questionPage(db:Database,userId:string,parent?:string|null,cursor?:string|null){
 const admin=await musicAdmin(db,userId);if(parent&&!z.string().uuid().safeParse(parent).success)throw new AppError('질문을 다시 열어주세요.');
 let bound:{time:number;id:string}|null=null;if(cursor){try{bound=z.object({time:z.number().int(),id:z.string().uuid()}).parse(JSON.parse(Buffer.from(cursor,'base64url').toString()));}catch{throw new AppError('목록을 다시 열어주세요.');}}
 if(parent&&!await db.prepare('SELECT id FROM training_questions WHERE id=? AND parent_id IS NULL AND hidden=0').bind(parent).first())throw new AppError('질문을 찾을 수 없어요.',404);
 const rows=(await db.prepare('SELECT q.*, (SELECT count(*)::int FROM training_question_reports r WHERE r.question_id=q.id) AS reports FROM training_questions q WHERE q.hidden=0 AND '+(parent?'q.parent_id=?':'q.parent_id IS NULL')+(bound?' AND (q.created_at<? OR (q.created_at=? AND q.id<?))':'')+' ORDER BY q.created_at DESC,q.id DESC LIMIT 21').bind(...(parent?[parent]:[]),...(bound?[bound.time,bound.time,bound.id]:[])).all<{id:string;user_id:string;author_name:string;body:string;revision:number;created_at:number|string;reports:number}>()).results;
 const page=rows.slice(0,20),last=page.at(-1);return {admin,items:page.map(q=>({id:q.id,author_name:q.author_name,body:q.body,revision:q.revision,created_at:Number(q.created_at),mine:q.user_id===userId,reports:admin?q.reports:0})),cursor:rows.length>20&&last?Buffer.from(JSON.stringify({time:Number(last.created_at),id:last.id})).toString('base64url'):null};
}
export async function questionAction(db:Database,user:{userId:string;displayName:string},raw:unknown){const parsed=z.discriminatedUnion('action',[
 z.object({action:z.literal('post'),id:z.string().uuid(),parent:z.string().uuid().nullable(),body:z.string().trim().min(5).max(2000),publishConfirmed:z.literal(true)}),
 z.object({action:z.literal('edit'),id:z.string().uuid(),revision:z.number().int(),body:z.string().trim().min(5).max(2000)}),
 z.object({action:z.literal('hide'),id:z.string().uuid(),revision:z.number().int()}),z.object({action:z.literal('report'),id:z.string().uuid()})]).safeParse(raw);if(!parsed.success)throw new AppError('내용과 공개 범위를 확인해주세요.');const a=parsed.data;
 return db.transaction(async tx=>{await tx.prepare("INSERT INTO training_profiles(user_id,content,updated_at) VALUES(?,'{}',?) ON CONFLICT(user_id) DO NOTHING").bind(user.userId,Date.now()).run();await tx.prepare('SELECT user_id FROM training_profiles WHERE user_id=? FOR UPDATE').bind(user.userId).first();
 if(a.action==='post'){
  const old=await tx.prepare('SELECT user_id FROM training_questions WHERE id=?').bind(a.id).first<{user_id:string}>();if(old){if(old.user_id!==user.userId)throw new AppError('새 글로 다시 시도하세요.',409);return {ok:true};}
  const count=await tx.prepare('SELECT count(*)::int AS n FROM training_questions WHERE user_id=? AND created_at>?').bind(user.userId,Date.now()-86400000).first<{n:number}>();if((count?.n??0)>=30)throw new AppError('하루 30개까지 작성할 수 있어요.',429);
  if(a.parent&&!await tx.prepare('SELECT id FROM training_questions WHERE id=? AND parent_id IS NULL AND hidden=0 FOR UPDATE').bind(a.parent).first())throw new AppError('질문이 닫혔어요.',404);
  await tx.prepare('INSERT INTO training_questions(id,user_id,author_name,parent_id,body,created_at) VALUES(?,?,?,?,?,?)').bind(a.id,user.userId,user.displayName.slice(0,60),a.parent,a.body,Date.now()).run();return {ok:true};
 }
 const row=await tx.prepare('SELECT * FROM training_questions WHERE id=? AND hidden=0 FOR UPDATE').bind(a.id).first<{user_id:string;revision:number}>();if(!row)throw new AppError('글을 찾을 수 없어요.',404);
 if(a.action==='report'){await tx.prepare('INSERT INTO training_question_reports(question_id,user_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(a.id,user.userId,Date.now()).run();return {ok:true};}
 if(row.user_id!==user.userId&&!(a.action==='hide'&&await musicAdmin(tx,user.userId)))throw new AppError('이 글을 수정할 권한이 없어요.',403);
 if(row.revision!==a.revision)throw new AppError('글이 바뀌었어요. 목록을 다시 열어주세요.',409);
 if(a.action==='edit')await tx.prepare('UPDATE training_questions SET body=?,revision=revision+1 WHERE id=?').bind(a.body,a.id).run();else await tx.prepare('UPDATE training_questions SET hidden=1,revision=revision+1 WHERE id=?').bind(a.id).run();return {ok:true};
 });
}
