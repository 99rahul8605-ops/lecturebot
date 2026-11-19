'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
test('Auto Save admin forms and batch cover controls exist',()=>{
 const html=read('public/index.html');
 for(const id of ['adminAutoSaveForm','v2AutoSaveStatus','v2StopAutoSave','v2RefreshAutoSave','adminCoverForm','v2BatchCoverPreview','v2EditCoverPreview'])assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 for(const panel of ['autosave','cover'])assert.ok(html.includes('data-panel="'+panel+'"'));
 assert.ok(html.includes('/admin-media.js'));
});
test('Auto Save SQL persists session and deduplication receipts',()=>{
 const schema=read('sql/004_auto_save_batch_covers.sql');
 for(const name of ['batch_covers','auto_save_sessions','auto_save_receipts','PRIMARY KEY(telegram_id,chat_id,message_id)','ENABLE ROW LEVEL SECURITY'])assert.ok(schema.includes(name));
});
test('Auto Save never overwrites existing PDF notes and requires owner',()=>{
 const auto=read('src/auto-save.js'),bot=read('src/bot.js');
 assert.ok(auto.includes('telegram_notes_id IS NULL'));
 assert.ok(auto.includes('FOR UPDATE OF a'));
 assert.ok(auto.includes('chat_id=$2 AND message_id=$3'));
 assert.ok(bot.includes("String(msg.from?.id)!==String(ownerId)"));
 assert.ok(bot.includes('processAutoSave(msg,ownerId)'));
});
test('batch image upload validates file signature and keeps storage portable',()=>{
 const server=read('src/server.js'),app=read('public/admin-media.js');
 assert.ok(server.includes("express.raw({type:['image/jpeg','image/png','image/webp']"));
 assert.ok(server.includes('Buffer.isBuffer(req.body)'));
 assert.ok(server.includes('batch_covers'));
 assert.ok(app.includes('uploadBatchCover'));
 assert.ok(!app.includes('localStorage'));
});
