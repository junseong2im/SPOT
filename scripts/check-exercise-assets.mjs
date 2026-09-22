import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const catalog=JSON.parse(await readFile('lib/exercise-images.json','utf8'));
const attribution=JSON.parse(await readFile('public/exercise-images/ATTRIBUTION.json','utf8'));
const redirects=JSON.parse(await readFile('data/exercise-asset-redirects.json','utf8'));
const budget=JSON.parse(await readFile('data/asset-budget.json','utf8'));
if(JSON.stringify(catalog)!==JSON.stringify(attribution))throw Error('Image attribution does not match the catalog');
const files=new Map();
for(const entry of Object.values(catalog))for(const image of entry.images){
 if(!/^\/exercise-images\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/.test(image.src))throw Error('Unsafe image path');
 if(!image.author||!image.licenseUrl||!image.original)throw Error('Missing source attribution');
 if(files.has(image.src))continue;
 const bytes=await readFile('public'+image.src);if(image.sha256&&createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('Asset hash mismatch: '+image.src);
 if(bytes.length>budget.maxAssetBytes)throw Error('Single asset budget exceeded: '+image.src);
 files.set(image.src,bytes.length);
}
const oldPaths=new Set();for(const r of redirects){if(oldPaths.has(r.source)||!r.source.startsWith('/exercise-images/')||!files.has(r.destination)||r.permanent!==true||r.source===r.destination)throw Error('Invalid asset redirect');oldPaths.add(r.source);await stat('public'+r.destination);}
const total=[...files.values()].reduce((a,b)=>a+b,0);if(total>budget.maxTotalBytes)throw Error('Total image budget exceeded; optimize new files or explicitly revise data/asset-budget.json');
console.log(JSON.stringify({assets:files.size,bytes:total,mib:Math.round(total/1048576*100)/100,legacyRedirects:redirects.length,budgetMiB:budget.maxTotalBytes/1048576}));
