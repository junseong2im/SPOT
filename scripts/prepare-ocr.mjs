// Copy pinned, locally installed OCR assets. Never download models during user inference.
import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dest='public/ocr';await mkdir(dest,{recursive:true});
const files=[['node_modules/tesseract.js/dist/worker.min.js','worker.min.js'],['node_modules/tesseract.js/LICENSE.md','TESSERACT-LICENSE.md'],['node_modules/tesseract.js-core/LICENSE','CORE-LICENSE.txt']];
for(const name of await readdir('node_modules/tesseract.js-core'))if(name.endsWith('.wasm.js'))files.push(['node_modules/tesseract.js-core/'+name,name]);
for(const lang of ['kor','eng'])files.push([`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,`${lang}.traineddata.gz`]);
const manifest=[];
for(const [source,name] of files){await copyFile(source,`${dest}/${name}`);const data=await readFile(source);manifest.push({name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
await writeFile(dest+'/manifest.json',JSON.stringify(manifest,null,2));
console.log(`Prepared ${manifest.length} OCR assets (${(manifest.reduce((n,f)=>n+f.bytes,0)/1048576).toFixed(1)} MB).`);
