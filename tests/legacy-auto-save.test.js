'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const calls=[];
let mode='video';
const chapter='11111111-1111-4111-8111-111111111111',unit='22222222-2222-4222-8222-222222222222',lecture='33333333-3333-4333-8333-333333333333';
const fakeQuery=async(sql,params=[])=>{
 calls.push({sql,params});
 const indices=[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]));
 const max=Math.max(0,...indices);
 assert.ok(params.length>=max, 'Missing SQL parameters for '+sql.slice(0,80));
 if(sql.includes('SELECT a.chapter_id,a.unit_id,a.is_active'))return {rowCount:1,rows:[{chapter_id:chapter,unit_id:unit,is_active:true,chapter_title:'Unit Test Chapter',unit_title:'Unit 1',subject_title:'Accounts',batch_title:'CA Inter'}]};
 if(sql.includes('SELECT 1 FROM auto_save_receipts'))return {rowCount:0,rows:[]};
 if(sql.includes('AS total'))return {rowCount:1,rows:[{total:2,next_order:5}]};
 if(sql.includes('INSERT INTO lectures'))return {rowCount:1,rows:[{id:lecture,title:'Lecture 3'}]};
 if(sql.includes('SELECT id,title FROM lectures'))return {rowCount:1,rows:[{id:lecture,title:'Lecture 1'}]};
 if(sql.includes('(sort_order,id)<='))return {rowCount:1,rows:[{n:1}]};
 if(sql.includes('SELECT count(*)::int AS n FROM lectures'))return {rowCount:1,rows:[{n:3}]};
 if(sql.includes('SELECT title FROM lectures'))return {rowCount:1,rows:[{title:'Lecture 2'}]};
 return {rowCount:1,rows:[]};
};
const fakeDb={query:fakeQuery,transaction:async cb=>cb({query:fakeQuery})};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='./db'&&parent?.filename?.endsWith(path.join('src','auto-save.js')))return fakeDb;
 return originalLoad.apply(this,arguments);
};
const auto=require('../src/auto-save');
Module._load=originalLoad;

test('legacy classification: video/doc/PDF/photo/audio/voice/video note',()=>{
 assert.equal(auto.classifyMedia({video:{file_id:'v'}}).kind,'video');
 assert.equal(auto.classifyMedia({document:{file_id:'p',mime_type:'application/pdf'}}).kind,'pdf');
 assert.equal(auto.classifyMedia({document:{file_id:'v',file_name:'lecture.mp4'}}).fileType,'document');
 assert.equal(auto.classifyMedia({photo:[{file_id:'p'}]}).fileType,'photo');
 assert.equal(auto.classifyMedia({audio:{file_id:'a'}}).fileType,'audio');
 assert.equal(auto.classifyMedia({voice:{file_id:'o'}}).fileType,'voice');
 assert.equal(auto.classifyMedia({video_note:{file_id:'vn'}}).fileType,'video_note');
 assert.equal(auto.autoTitle({caption:'Some Other Name'},4),'Lecture 4');
 assert.equal(auto.fileLink('TestBot','aaaaaaaaaaaaaaaa'),'https://t.me/TestBot?start=file_aaaaaaaaaaaaaaaa');
});
test('unit-scoped Auto Save serializes video creation and has correct bound parameters',async()=>{
 calls.length=0;
 const result=await auto.processAutoSave({from:{id:123,first_name:'Test'},chat:{id:123,type:'private'},message_id:11,video:{file_id:'my_v_id'}},'123');
 assert.equal(result.kind,'video');
 assert.equal(result.title,'Lecture 3');
 assert.equal(result.unit,'Unit 1');
 assert.equal(result.nextLecture,4);
 const inserted=calls.find(c=>c.sql.startsWith('INSERT INTO lectures'));
 assert.equal(inserted.params[1],unit);
 assert.equal(inserted.params[2],'Lecture 3');
 assert.ok(calls.some(c=>c.sql.includes('unit_id IS NOT DISTINCT FROM $2::uuid')));
});
test('unit-scoped PDF attaches to first missing note rather than most recent upload',async()=>{
 calls.length=0;
 const result=await auto.processAutoSave({from:{id:123,first_name:'Test'},chat:{id:123,type:'private'},message_id:12,document:{file_id:'my_pdf',mime_type:'application/pdf',file_name:'notes.pdf'}},'123');
 assert.equal(result.kind,'pdf');
 assert.equal(result.title,'Lecture 1');
 assert.equal(result.nextMissingNotes,'Lecture 2');
 const selected=calls.find(c=>c.sql.includes('SELECT id,title FROM lectures'));
 assert.ok(selected.sql.includes('telegram_notes_id IS NULL'));
 assert.ok(selected.sql.includes('unit_id IS NOT DISTINCT FROM $2::uuid'));
 assert.equal(selected.params[1],unit);
});
