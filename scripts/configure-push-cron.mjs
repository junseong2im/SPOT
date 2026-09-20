import { Client } from 'pg';
const {DATABASE_URL,APP_ORIGIN,CRON_SECRET}=process.env;
if(!DATABASE_URL||!APP_ORIGIN||!CRON_SECRET||CRON_SECRET.length<32)throw new Error('DATABASE_URL, APP_ORIGIN and CRON_SECRET are required.');
const origin=new URL(APP_ORIGIN);if(origin.protocol!=='https:')throw new Error('Use the production HTTPS origin.');
const url=new URL(DATABASE_URL);
const response=await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt');if(!response.ok)throw new Error('Could not load Supabase CA');
const ssl={ca:await response.text(),rejectUnauthorized:true};for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
const client=new Client({connectionString:url.href,ssl,connectionTimeoutMillis:10000});
try{
 await client.connect();await client.query('CREATE EXTENSION IF NOT EXISTS pg_cron');await client.query('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');
 await client.query('BEGIN');
 for(const [name,value]of[['spot_push_cron_secret',CRON_SECRET],['spot_push_job_url',origin.origin+'/api/jobs/notifications']]){
  const existing=await client.query('SELECT id FROM vault.secrets WHERE name=$1',[name]);
  if(existing.rows.length)await client.query('SELECT vault.update_secret($1,$2)',[existing.rows[0].id,value]);
  else await client.query('SELECT vault.create_secret($1,$2)',[value,name]);
 }
 const command=`SELECT net.http_post(url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='spot_push_job_url'),headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='spot_push_cron_secret')),body := '{}'::jsonb,timeout_milliseconds := 60000);`;
 await client.query('SELECT cron.schedule($1,$2,$3)',['spot-workout-notifications','* * * * *',command]);
 await client.query('COMMIT');
 const jobs=await client.query("SELECT jobname,schedule,active FROM cron.job WHERE jobname='spot-workout-notifications'");console.log(jobs.rows);
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Push scheduler setup failed:',error.code??'unknown');process.exitCode=1;}finally{await client.end();}
