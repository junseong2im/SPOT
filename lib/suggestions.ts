import {z} from 'zod';
import type {Database} from '../db/adapter';
import {AppError} from './gym-service';
import {musicAdmin} from './music-service';
import {safeMusicLink} from './music-model';
export const categories={feature:'기능 개선',music:'음악 · 플레이리스트',bug:'오류 제보',other:'기타'};
export const statuses={received:'접수',reviewing:'검토 중',planned:'반영 예정',done:'반영 완료',closed:'검토 종료'};
export type Suggestion={id:string;user_id:string;author_name:string;category:keyof typeof categories;title:string;body:string;link:string;status:keyof typeof statuses;reply:string;revision:number;created_at:number|string};
const createSchema=z.object({id:z.string().uuid(),category:z.enum(['feature','music','bug','other']),title:z.string().trim().min(1).max(100),body:z.string().trim().min(1).max(3000),link:z.string().trim().max(2000).refine(v=>!v||safeMusicLink(v))});
export async function listSuggestions(db:Database,userId:string){const admin=await musicAdmin(db,userId);if(!admin)return {admin:false,items:[]};const items=(await db.prepare('SELECT id,user_id,author_name,category,title,body,link,status,reply,revision,created_at FROM suggestions'+(admin?'':' WHERE user_id=?')+' ORDER BY created_at DESC,id LIMIT 100').bind(...(admin?[]:[userId])).all<Suggestion>()).results;return {admin,items};}
export async function createSuggestion(db:Database,user:{userId:string;displayName:string},raw:unknown){const p=createSchema.safeParse(raw);if(!p.success)throw new AppError('제목, 내용과 링크를 확인해주세요.');return db.transaction(async tx=>{
 const item=p.data;
 // Serialize a user's submissions without exposing or changing their authentication records.
 await tx.prepare('SELECT user_id FROM auth_sessions WHERE user_id=? FOR UPDATE').bind(user.userId).all();
 const existing=await tx.prepare('SELECT user_id FROM suggestions WHERE id=?').bind(item.id).first<{user_id:string}>();if(existing){if(existing.user_id!==user.userId)throw new AppError('새 건의로 다시 작성해주세요.',409);return;}
 const count=await tx.prepare('SELECT count(*)::int AS n FROM suggestions WHERE user_id=? AND created_at>?').bind(user.userId,Date.now()-86400000).first<{n:number}>();if((count?.n??0)>=20)throw new AppError('하루에 20개까지 남길 수 있어요.',429);
 const now=Date.now();await tx.prepare('INSERT INTO suggestions(id,user_id,author_name,category,title,body,link,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(item.id,user.userId,user.displayName,item.category,item.title,item.body,item.link,now,now).run();
});}
export async function updateSuggestion(db:Database,userId:string,raw:unknown){if(!await musicAdmin(db,userId))throw new AppError('관리자만 답변과 상태를 변경할 수 있어요.',403);const p=z.object({id:z.string().uuid(),revision:z.number().int().min(1),status:z.enum(['received','reviewing','planned','done','closed']),reply:z.string().trim().max(3000)}).safeParse(raw);if(!p.success)throw new AppError('답변 내용을 확인해주세요.');const r=p.data;const result=await db.prepare('UPDATE suggestions SET status=?,reply=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(r.status,r.reply,Date.now(),r.id,r.revision).run();if(!result.meta.changes)throw new AppError('다른 창에서 변경됐어요. 목록을 다시 불러와주세요.',409);}
