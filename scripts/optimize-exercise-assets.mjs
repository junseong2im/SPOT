// Default is a read-only plan. --write archives originals and updates live references.
import sharp from 'sharp';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const write=process.argv.includes('--write');
const root=resolve('public/exercise-images'),archive=resolve('.data/asset-originals');
const catalog=JSON.parse(await readFile('lib/exercise-images.json','utf8'));
const routeFile='data/exercise-asset-redirects.json';
let redirects=[];try{redirects=JSON.parse(await readFile(routeFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=[...new Set(Object.values(catalog).flatMap(x=>x.images.map(i=>i.src)))];
const changes=new Map();let before=0,after=0,skipped=0;
for(const src of paths){
 const file=resolve('public'+src);if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\'))throw Error('Asset escapes public image directory');
 const input=await readFile(file);before+=input.length;after+=input.length;if(!src.endsWith('.png'))continue;
 const metadata=await sharp(input).metadata();if((metadata.pages??1)>1||(metadata.orientation&&metadata.orientation!==1))continue;
 const output=await sharp(input).webp({lossless:true,effort:6}).toBuffer();
 if(output.length>=input.length*0.95)continue;
 const a=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const b=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(a.info.width!==b.info.width||a.info.height!==b.info.height||!a.data.equals(b.data)){skipped++;continue;}
 const destination=src.replace(/\.png$/,'.webp'),sourceHash=hash(input),outputHash=hash(output);
 if(paths.includes(destination))throw Error('Replacement conflicts with another catalog asset');
 changes.set(src,{destination,sourceHash,outputHash,before:input.length,after:output.length});after-=input.length-output.length;
 if(write){await mkdir(archive,{recursive:true});await writeFile(resolve(archive,sourceHash+'.png.gz'),gzipSync(input,{level:9}));await writeFile(resolve('public'+destination),output);}
}
if(write){
 for(const item of Object.values(catalog))for(const i of item.images){const c=changes.get(i.src);if(!c)continue;i.originalSha256??=i.sha256??c.sourceHash;i.previousAsset=i.src;i.src=c.destination;i.sha256=c.outputHash;i.optimization='lossless WebP; same dimensions and decoded RGBA verified identical';}
 for(const [source,c] of changes){const old=redirects.find(r=>r.source===source);if(old&&old.destination!==c.destination)throw Error('Conflicting existing redirect');if(!old)redirects.push({source,destination:c.destination,permanent:true});}
 await writeFile('lib/exercise-images.json',JSON.stringify(catalog,null,2)+'\n');
 await writeFile('public/exercise-images/ATTRIBUTION.json',JSON.stringify(catalog,null,2)+'\n');
 await mkdir(dirname(routeFile),{recursive:true});await writeFile(routeFile,JSON.stringify(redirects,null,2)+'\n');
 await mkdir(archive,{recursive:true});await writeFile(resolve(archive,'manifest-'+Date.now()+'.json'),JSON.stringify(Object.fromEntries(changes),null,2));
 // Originals are removed only after their archive, replacement and live references exist.
 for(const [source,c] of changes){if(hash(gunzipSync(await readFile(resolve(archive,c.sourceHash+'.png.gz'))))!==c.sourceHash||hash(await readFile(resolve('public'+c.destination)))!==c.outputHash)throw Error('Archive or replacement verification failed');await unlink(resolve('public'+source));}
}
console.log(JSON.stringify({mode:write?'write':'plan',assets:paths.length,converted:changes.size,skippedPixelDifference:skipped,beforeBytes:before,afterBytes:after,savedBytes:before-after,savedPercent:Math.round((before-after)/before*1000)/10,largestSavings:[...changes].sort((a,b)=>(b[1].before-b[1].after)-(a[1].before-a[1].after)).slice(0,5)},null,2));
