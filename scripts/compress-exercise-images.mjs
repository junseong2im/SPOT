// Lossless, same-format optimization only. Never remove or resize a live asset.
import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,extname} from 'node:path';
const root=resolve('public/exercise-images');
const catalog=JSON.parse(await readFile('lib/exercise-images.json','utf8'));
const paths=[...new Set(Object.values(catalog).flatMap(item=>item.images.map(i=>i.src)))];
let saved=0,changed=0,before=0,skipped=0;
const updates=new Map();
for(const src of paths){
 const path=resolve('public'+src);if(!path.startsWith(root+'/')&&!path.startsWith(root+'\\'))throw Error('Unexpected asset path');
 const input=await readFile(path);before+=input.length;if(extname(path).toLowerCase()!=='.png')continue;
 const metadata=await sharp(input).metadata();if((metadata.pages??1)>1||metadata.orientation&&metadata.orientation!==1)continue;
 const output=await sharp(input).png({compressionLevel:9,adaptiveFiltering:true,effort:10}).toBuffer();
 if(output.length>=input.length)continue;
 const sourcePixels=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const resultPixels=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(sourcePixels.info.width!==resultPixels.info.width||sourcePixels.info.height!==resultPixels.info.height||!sourcePixels.data.equals(resultPixels.data)){skipped++;continue;}
 const sourceHash=createHash('sha256').update(input).digest('hex'),hash=createHash('sha256').update(output).digest('hex');
 await writeFile(path,output);updates.set(src,{hash,sourceHash});saved+=input.length-output.length;changed++;
}
for(const item of Object.values(catalog))for(const image of item.images){const change=updates.get(image.src);if(change){image.originalSha256??=image.sha256??change.sourceHash;image.sha256=change.hash;image.optimization='lossless PNG; decoded RGBA pixels verified identical';}}
await writeFile('lib/exercise-images.json',JSON.stringify(catalog,null,2)+'\n');
await writeFile('public/exercise-images/ATTRIBUTION.json',JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({assets:paths.length,optimized:changed,skippedPixelChange:skipped,beforeBytes:before,savedBytes:saved,afterBytes:before-saved,pixels:'identical for every changed file'}));
