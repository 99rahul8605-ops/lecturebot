'use strict';
const fs = require('node:fs');
const {Pool} = require('pg');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required. Use a separate Supabase TEST project.');

// node-postgres URL SSL query parameters override the SSL object.
// Enforce one explicit TLS configuration so CA and hostname verification cannot
// silently be replaced by an sslmode supplied in the connection string.
const connectionUrl = new URL(connectionString);
for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
  if (connectionUrl.searchParams.has(key)) {
    throw new Error('Remove ' + key + ' from DATABASE_URL; use DATABASE_CA_CERT for trusted Supabase CA instead.');
  }
}
if (process.env.DATABASE_SSL === 'false') {
  throw new Error('DATABASE_SSL=false is not supported; TLS certificate verification is required.');
}
const caPath = process.env.DATABASE_CA_CERT;
const ssl = {rejectUnauthorized: true};
if (caPath) {
  ssl.ca = fs.readFileSync(caPath, 'utf8');
}
const pool = new Pool({
  connectionString: connectionUrl.toString(),
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
async function query(sql,params=[]){return pool.query(sql,params);}
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(err){await c.query('ROLLBACK');throw err;}finally{c.release();}}
module.exports={pool,query,transaction};
