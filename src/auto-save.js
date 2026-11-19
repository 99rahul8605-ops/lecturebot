'use strict';
// V2 test bot: legacy CA Inter auto-save behavior. PostgreSQL transactions serialize
// media and undo events; no writes to the production SQLite/MongoDB.
const crypto=require('node:crypto');
const {query,transaction}=require('./db');
const validUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function classifyMedia(msg) {
  if(msg.video?.file_id)return {kind:'video',fileId:msg.video.file_id,fileName:msg.video.file_name||'video.mp4'};
  
  if(msg.document?.file_id) {
    const mime=String(msg.document.mime_type||'').toLowerCase(),name=String(msg.document.file_name||'').toLowerCase();
    if(mime==='application/pdf'||name.endsWith('.pdf'))return {kind:'pdf',fileId:msg.document.file_id,fileName:msg.document.file_name||'notes.pdf'};
    if(mime.startsWith('video/')||/\.(mp4|mkv|mov|webm|avi)$/.test(name))return {kind:'video',fileId:msg.document.file_id,fileName:msg.document.file_name||'video.mp4',fileType:'document'};
  }
  return null;
}
const autoTitle=(_msg,n)=>'Lecture '+n;
const safeFileName=name=>String(name||'file').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180);
const fileLink=(botName,code)=>botName&&code?'https://t.me/'+botName+'?start=file_'+code:null;
async function getAutoSaveStatus(ownerId){
  const {rows}=await query(
    "SELECT a.*,c.title AS chapter_title,s.id AS subject_id,s.title AS subject_title,b.id AS batch_id,b.title AS batch_title,(SELECT count(*)::int FROM lectures l WHERE l.chapter_id=a.chapter_id) AS lecture_count,(SELECT count(*)::int FROM lectures l WHERE l.chapter_id=a.chapter_id AND l.telegram_video_id IS NOT NULL AND l.telegram_notes_id IS NULL) AS missing_notes FROM auto_save_sessions a JOIN chapters c ON c.id=a.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id WHERE a.telegram_id=$1",
    [String(ownerId)]
  );
  const r=rows[0];
  if(!r)return {is_active:false,saved_videos:0,saved_pdfs:0,lecture_count:0,next_lecture_number:1};
  return {...r,next_lecture_number:r.lecture_count+1};
}
async function startAutoSave(ownerId,chapterId) {
  if(!validUuid.test(chapterId))return null;
  return transaction(async c=>{
    const target=await c.query('SELECT c.id,c.title AS chapter_title,s.title AS subject_title,b.title AS batch_title FROM chapters c JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id WHERE c.id=$1',[chapterId]);
    if(!target.rowCount)return null;
    await c.query("INSERT INTO auto_save_sessions(telegram_id,chapter_id,is_active,saved_videos,saved_pdfs,updated_at) VALUES($1,$2,true,0,0,now()) ON CONFLICT(telegram_id) DO UPDATE SET chapter_id=$2,is_active=true,saved_videos=0,saved_pdfs=0,updated_at=now(),last_receipt_chat_id=NULL,last_receipt_message_id=NULL,last_action_type=NULL,last_lecture_id=NULL",[String(ownerId),chapterId]);
    const count=await c.query('SELECT count(*)::int AS n FROM lectures WHERE chapter_id=$1',[chapterId]);
    return {...target.rows[0],is_active:true,lecture_count:count.rows[0].n,next_lecture_number:count.rows[0].n+1};
  });
}
async function stopAutoSave(ownerId){
  const {rows}=await query("UPDATE auto_save_sessions SET is_active=false,updated_at=now(),last_receipt_chat_id=NULL,last_receipt_message_id=NULL,last_action_type=NULL,last_lecture_id=NULL WHERE telegram_id=$1 RETURNING chapter_id,saved_videos,saved_pdfs",[String(ownerId)]);
  return rows[0]||null;
}
async function nextChapter(ownerId) {
  return transaction(async c=>{
    const locked=await c.query('SELECT chapter_id,is_active FROM auto_save_sessions WHERE telegram_id=$1 FOR UPDATE',[String(ownerId)]);
    if(!locked.rows[0]?.is_active)return {error:'Auto Save is OFF'};
    const current=locked.rows[0].chapter_id;
    const {rows}=await c.query(
      'SELECT nextc.id,nextc.title FROM chapters curr JOIN chapters nextc ON nextc.subject_id=curr.subject_id WHERE curr.id=$1 AND (nextc.sort_order,nextc.title,nextc.id)>(curr.sort_order,curr.title,curr.id) ORDER BY nextc.sort_order,nextc.title,nextc.id LIMIT 1',
      [current]
    );
    if(!rows[0])return {error:'This is the last chapter in the subject'};
    await c.query("UPDATE auto_save_sessions SET chapter_id=$2,updated_at=now(),last_receipt_chat_id=NULL,last_receipt_message_id=NULL,last_action_type=NULL,last_lecture_id=NULL WHERE telegram_id=$1",[String(ownerId),rows[0].id]);
    const count=await c.query('SELECT count(*)::int AS n FROM lectures WHERE chapter_id=$1',[rows[0].id]);
    return {chapter_title:rows[0].title,next_lecture_number:count.rows[0].n+1};
  });
}
async function undoAutoSave(ownerId){
  const id=String(ownerId);
  return transaction(async c=>{
    const {rows}=await c.query('SELECT chapter_id,is_active,last_receipt_chat_id,last_receipt_message_id,last_action_type,last_lecture_id FROM auto_save_sessions WHERE telegram_id=$1 FOR UPDATE',[id]);
    const session=rows[0];
    if(!session?.is_active)return {error:'Auto Save is OFF'};
    if(!session.last_action_type||!session.last_lecture_id)return {error:'Nothing to undo'};
    const {rows:receipts}=await c.query("SELECT chat_id,message_id,file_code FROM auto_save_receipts WHERE telegram_id=$1 AND chat_id=$2 AND message_id=$3 AND is_undone=false FOR UPDATE",[id,session.last_receipt_chat_id,session.last_receipt_message_id]);
    if(!receipts[0])return {error:'Last action already undone'};
    if(session.last_action_type==='lecture'){
      const found=await c.query('SELECT id,title FROM lectures WHERE id=$1 AND chapter_id=$2 FOR UPDATE',[session.last_lecture_id,session.chapter_id]);
      if(!found.rowCount)return {error:'Lecture no longer exists'};
      await c.query('DELETE FROM lectures WHERE id=$1',[session.last_lecture_id]);
    }else{
      const found=await c.query('SELECT id FROM lectures WHERE id=$1 AND chapter_id=$2 AND telegram_notes_id IS NOT NULL FOR UPDATE',[session.last_lecture_id,session.chapter_id]);
      if(!found.rowCount)return {error:'Notes already missing'};
      await c.query('UPDATE lectures SET telegram_notes_id=NULL WHERE id=$1',[session.last_lecture_id]);
    }
    await c.query('UPDATE auto_save_receipts SET is_undone=true WHERE telegram_id=$1 AND chat_id=$2 AND message_id=$3',[id,session.last_receipt_chat_id,session.last_receipt_message_id]);
    await c.query('UPDATE auto_save_sessions SET last_receipt_chat_id=NULL,last_receipt_message_id=NULL,last_action_type=NULL,last_lecture_id=NULL,updated_at=now(),'+(session.last_action_type==='lecture'?'saved_videos':'saved_pdfs')+'=greatest(0,'+(session.last_action_type==='lecture'?'saved_videos':'saved_pdfs')+'-1) WHERE telegram_id=$1',[id]);
    return {kind:session.last_action_type,code:receipts[0].file_code};
  });
}
async function processAutoSave(message,ownerId) {
  if(!message||message.chat?.type!=='private'||String(message.from?.id)!==String(ownerId))return null;
  const media=classifyMedia(message);
  if(!media||!Number.isSafeInteger(message.message_id))return null;
  const owner=String(ownerId),chatId=String(message.chat.id),msgId=message.message_id;
  return transaction(async c=>{
    const {rows}=await c.query("SELECT a.chapter_id,a.is_active,c.title AS chapter_title,s.title AS subject_title,b.title AS batch_title FROM auto_save_sessions a JOIN chapters c ON c.id=a.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id WHERE a.telegram_id=$1 FOR UPDATE OF a",[owner]);
    const session=rows[0];
    if(!session?.is_active)return null;
    const dup=await c.query('SELECT 1 FROM auto_save_receipts WHERE telegram_id=$1 AND chat_id=$2 AND message_id=$3',[owner,chatId,msgId]);
    if(dup.rowCount)return {kind:'duplicate'};
    const code=crypto.randomBytes(12).toString('base64url');
    const fileType=media.fileType||(media.kind==='pdf'?'document':'video');
    await c.query('INSERT INTO saved_telegram_files(code,telegram_id,telegram_file_id,file_type,file_name) VALUES($1,$2,$3,$4,$5)',[code,owner,media.fileId,fileType==='photo'||fileType==='audio'?'document':fileType,safeFileName(media.fileName)]);
    let lecture,lectureNumber=null;
    if(media.kind==='video'){
      const n=await c.query('SELECT count(*)::int AS total,coalesce(max(sort_order),-1)+1 AS next_order FROM lectures WHERE chapter_id=$1',[session.chapter_id]);
      lectureNumber=n.rows[0].total+1;
      const saved=await c.query('INSERT INTO lectures(chapter_id,title,telegram_video_id,telegram_video_type,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id,title',[session.chapter_id,autoTitle(message,lectureNumber),media.fileId,media.fileType||'video',n.rows[0].next_order]);
      lecture=saved.rows[0];
    }else{
      // Same legacy rule: attach PDFs to FIRST lecture lacking notes, not latest.
      const found=await c.query('SELECT id,title FROM lectures WHERE chapter_id=$1 AND telegram_video_id IS NOT NULL AND telegram_notes_id IS NULL ORDER BY sort_order,created_at,id LIMIT 1 FOR UPDATE',[session.chapter_id]);
      if(!found.rowCount)return {kind:'no_lecture',chapter:session.chapter_title,code,fileName:media.fileName};
      lecture=found.rows[0];
      await c.query('UPDATE lectures SET telegram_notes_id=$2 WHERE id=$1 AND telegram_notes_id IS NULL',[lecture.id,media.fileId]);
      const position=await c.query('SELECT count(*)::int AS n FROM lectures WHERE chapter_id=$1 AND (sort_order,id)<=(SELECT sort_order,id FROM lectures WHERE id=$2)',[session.chapter_id,lecture.id]);
      lectureNumber=position.rows[0].n;
    }
    await c.query('INSERT INTO auto_save_receipts(telegram_id,chat_id,message_id,media_kind,lecture_id,file_code) VALUES($1,$2,$3,$4,$5,$6)',[owner,chatId,msgId,media.kind,lecture.id,code]);
    const column=media.kind==='video'?'saved_videos':'saved_pdfs';
    await c.query('UPDATE auto_save_sessions SET '+column+'='+column+'+1,last_receipt_chat_id=$2,last_receipt_message_id=$3,last_action_type=$4,last_lecture_id=$5,updated_at=now() WHERE telegram_id=$1',[owner,chatId,msgId,media.kind==='pdf'?'notes':'lecture',lecture.id]);
    const progress=await c.query('SELECT count(*)::int AS n FROM lectures WHERE chapter_id=$1',[session.chapter_id]);
    const missing=await c.query('SELECT title FROM lectures WHERE chapter_id=$1 AND telegram_video_id IS NOT NULL AND telegram_notes_id IS NULL ORDER BY sort_order,created_at,id LIMIT 1',[session.chapter_id]);
    return {kind:media.kind,lectureId:lecture.id,title:lecture.title,lectureNumber,fileName:media.fileName,chapter:session.chapter_title,subject:session.subject_title,batch:session.batch_title,code,nextLecture:progress.rows[0].n+1,nextMissingNotes:missing.rows[0]?.title||null};
  });
}
module.exports={classifyMedia,autoTitle,fileLink,getAutoSaveStatus,startAutoSave,stopAutoSave,nextChapter,undoAutoSave,processAutoSave};
