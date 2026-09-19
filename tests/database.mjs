import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const output=await build({entryPoints:['db/adapter.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {createDatabase}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
export async function createTestDatabase(){
 const client=new PGlite();
 await client.exec(await readFile('supabase/migrations/202609200001_spot.sql','utf8'));
 const execute=async(connection,{sql,args})=>{const result=await connection.query(sql,args);return {rows:result.rows,changes:result.affectedRows??0};};
 const db=createDatabase({execute:q=>execute(client,q),batch:queries=>client.transaction(async tx=>{const results=[];for(const q of queries)results.push(await execute(tx,q));return results;})});
 return {db,client,close:()=>client.close()};
}
