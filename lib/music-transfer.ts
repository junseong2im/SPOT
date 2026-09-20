import {z} from 'zod';
export const transferSchema=z.object({title:z.string().trim().min(1).max(120),tracks:z.array(z.object({title:z.string().trim().min(1).max(200),artist:z.string().trim().max(160)})).min(1).max(200)});
export function transferPayload(raw:unknown){const data=transferSchema.parse(raw);return {title:data.title,sourceName:'SPOT 운동 크루',description:'SPOT에서 선택한 운동 음악',tracklist:data.tracks.map(t=>({title:t.title,...(t.artist?{artists:t.artist}:{})}))};}
export function validTransferUrl(value:unknown):value is string{if(typeof value!=='string')return false;try{const u=new URL(value);return u.origin==='https://soundiiz.com'&&!u.username&&!u.password&&/^\/go\/import-playlist\/[a-zA-Z0-9_-]+$/.test(u.pathname);}catch{return false;}}
