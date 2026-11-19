'use strict';
const {Pool}=require('pg');
const url=process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required. Use a separate Supabase TEST project.');
const ssl=process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:true};
const pool=new Pool({connectionString:url, ssl, max:10, idleTimeoutMillis:30000, connectionTimeoutMillis:10000});
async function query(sql,params=[]){return pool.query(sql,params);}
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(err){await c.query('ROLLBACK');throw err;}finally{c.release();}}
module.exports={pool,query,transaction};
