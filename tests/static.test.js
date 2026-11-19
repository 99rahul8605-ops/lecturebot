'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
test('every primary navigation view exists',()=>{const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');for(const v of ['home','courses','study','groups','rewards','profile','admin'])assert.ok(html.includes(`id="view-${v}"`),`missing ${v}`);});
test('no hardcoded live bot token or production database URL',()=>{for(const file of ['src/server.js','src/bot.js','public/app.js','.env.example']){const s=fs.readFileSync(path.join(root,file),'utf8');assert.ok(!/\d{8,12}:AA[a-zA-Z0-9_-]{20,}/.test(s),file);assert.ok(!s.includes('31.42.125.58'),file);}});
test('SQL turns on RLS for user-sensitive tables',()=>{const sql=fs.readFileSync(path.join(root,'sql/001_initial.sql'),'utf8');for(const table of ['app_users','study_sessions','study_groups','group_messages','batch_access','point_ledger'])assert.ok(sql.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));});
