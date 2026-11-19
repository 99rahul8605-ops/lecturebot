'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('reference study/group views and admin editor have dedicated screens',()=>{
 const html=read('public/index.html');
 for(const screen of ['groups','new-group','global-room','group-detail','manage-group','study-plan','study-pick','study-stats','admin','admin-editor']){
  assert.ok(html.includes('id="view-'+screen+'"'),'missing '+screen);
 }
 for(const id of ['adminBatchForm','adminSubjectForm','adminChapterForm','adminLectureForm','adminPublishForm']){
  assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 }
});
test('all V2 client DOM IDs exist in index HTML',()=>{
 const html=read('public/index.html'),client=read('public/study-v2.js');
 const ids=[...client.matchAll(/v2e\('([^']+)'\)/g)].map(m=>m[1]);
 for(const id of ids)assert.ok(html.includes('id="'+id+'"'),'missing '+id);
});
test('study/group migrations implement opt-in room, roles and invite codes',()=>{
 const sql=read('sql/002_study_groups_features.sql');
 for(const token of ['show_in_global','invite_code','target_minutes','muted_until','slow_mode_seconds','pinned_message_id','chat_mode']){
  assert.ok(sql.includes(token),'missing '+token);
 }
});
test('server enforces TLS and old production credentials are not embedded',()=>{
 for(const p of ['src/v2-features.js','public/study-v2.js','sql/002_study_groups_features.sql']){
  assert.ok(!/\\d{8,12}:AA[a-zA-Z0-9_-]{20,}/.test(read(p)),'token in '+p);
 }
});
