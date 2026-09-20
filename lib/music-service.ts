import {z} from 'zod';
import type {Database} from '../db/adapter';
import {AppError} from './gym-service';
import {safeMusicLink,youtubeSource,type MusicRecommendation} from './music-model';
const schema=z.object({id:z.string().max(60),title:z.string().trim().min(1).max(120),artist:z.string().trim().max(120),description:z.string().trim().max(500),youtube_url:z.string().max(1000).refine(v=>!!youtubeSource(v)),links:z.array(z.object({service:z.string().trim().min(1).max(40),url:z.string().max(2000).refine(safeMusicLink)})).max(30).refine(xs=>new Set(xs.map(x=>x.service.toLowerCase())).size===xs.length),revision:z.number().int().min(0)});
export async function musicAdmin(db:Database,userId?:string){return !!userId&&!!await db.prepare('SELECT user_id FROM app_admins WHERE user_id=?').bind(userId).first();}
export async function musicList(db:Database){const result=await db.prepare('SELECT id,title,artist,description,youtube_url,links,revision FROM music_recommendations WHERE archived=0 ORDER BY created_at DESC,id LIMIT 100').all<Omit<MusicRecommendation,'links'>&{links:string}>();return result.results.map(r=>({...r,links:JSON.parse(r.links)}));}
export async function saveMusic(db:Database,userId:string,raw:unknown){
 return db.transaction(async tx=>{
  if(!await musicAdmin(tx,userId))throw new AppError('관리자만 음악 추천을 수정할 수 있어요.',403);
  const parsed=schema.safeParse(raw);if(!parsed.success)throw new AppError('제목, 유튜브 주소와 앱별 링크를 확인해주세요.');
  const r=parsed.data,now=Date.now();
  if(r.id){const result=await tx.prepare('UPDATE music_recommendations SET title=?,artist=?,description=?,youtube_url=?,links=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0').bind(r.title,r.artist,r.description,youtubeSource(r.youtube_url)!.url,JSON.stringify(r.links),now,r.id,r.revision).run();if(!result.meta.changes)throw new AppError('다른 창에서 변경됐어요. 새로고침 후 다시 시도해주세요.',409);}
  else {await tx.prepare('SELECT user_id FROM app_admins WHERE user_id=? FOR UPDATE').bind(userId).first();const count=await tx.prepare('SELECT count(*)::int AS n FROM music_recommendations WHERE archived=0').first<{n:number}>();if((count?.n??0)>=100)throw new AppError('추천은 최대 100개까지 등록할 수 있어요.');await tx.prepare('INSERT INTO music_recommendations(id,title,artist,description,youtube_url,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),r.title,r.artist,r.description,youtubeSource(r.youtube_url)!.url,JSON.stringify(r.links),now,now).run();}
 });
}
export async function archiveMusic(db:Database,userId:string,id:string,revision:number){if(!await musicAdmin(db,userId))throw new AppError('관리자만 음악 추천을 수정할 수 있어요.',403);const r=await db.prepare('UPDATE music_recommendations SET archived=1,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND archived=0').bind(Date.now(),id,revision).run();if(!r.meta.changes)throw new AppError('이미 변경된 추천이에요. 새로고침해주세요.',409);}
