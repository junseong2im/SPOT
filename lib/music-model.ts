export type MusicLink={service:string;url:string};
export type MusicRecommendation={id:string;title:string;artist:string;description:string;youtube_url:string;links:MusicLink[];revision:number};
export const musicServices=['YouTube Music','Spotify','Apple Music','멜론','지니','FLO','VIBE','벅스','Amazon Music','TIDAL','Deezer','SoundCloud'];
export function youtubeSource(raw:string){
 try {
  const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  if(!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(u.hostname))return null;
  const candidate=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||(u.pathname.startsWith('/shorts/')?u.pathname.split('/')[2]:'');
  const video=candidate&&/^[A-Za-z0-9_-]{11}$/.test(candidate)?candidate:'';
  const list=u.searchParams.get('list')||'';
  if(list&&!/^[A-Za-z0-9_-]{10,150}$/.test(list))return null;
  if(!video&&!list)return null;
  const params=new URLSearchParams();if(video)params.set('v',video);if(list)params.set('list',list);
  const path=video?'watch':'playlist';
  const embed=new URL(video?`https://www.youtube-nocookie.com/embed/${video}`:'https://www.youtube-nocookie.com/embed/videoseries');
  if(list)embed.searchParams.set('list',list);embed.searchParams.set('playsinline','1');embed.searchParams.set('rel','0');
  return {video,list,kind:list?'플레이리스트':'노래',url:`https://www.youtube.com/${path}?${params}`,musicUrl:`https://music.youtube.com/${path}?${params}`,embed:embed.href};
 }catch{return null;}
}
export function safeMusicLink(raw:string){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.includes('.')&&!/^(localhost|127\.|192\.168\.|10\.)/.test(u.hostname);}catch{return false;}}
