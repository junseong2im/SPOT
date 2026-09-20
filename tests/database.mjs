import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
const output=await build({entryPoints:['db/adapter.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {createDatabase}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
export async function createTestDatabase(){
 const client=new PGlite();
 for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) await client.exec(await readFile('supabase/migrations/'+name,'utf8'));
 const execute=async(connection,{sql,args})=>{const result=await connection.query(sql,args);return {rows:result.rows,changes:result.affectedRows??0};};
 const scoped=connection=>({execute:q=>execute(connection,q),batch:async queries=>{const results=[];for(const q of queries)results.push(await execute(connection,q));return results;},transaction:fn=>fn(scoped(connection))});
 const db=createDatabase({execute:q=>execute(client,q),batch:queries=>client.transaction(tx=>scoped(tx).batch(queries)),transaction:fn=>client.transaction(tx=>fn(scoped(tx)))});
 return {db,client,close:()=>client.close()};
}
