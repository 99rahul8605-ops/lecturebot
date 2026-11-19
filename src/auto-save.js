'use strict';
// Telegram Auto Save for the isolated V2 test bot.
// One owner-selected chapter at a time; every media message is deduplicated.
const {transaction,query}=require('./db');
function classifyMedia(message){
  if(message.video?.file_id)return {kind:'video',fileId:message.video.file_id};
  const document=message.document;
  if(!document?.file_id)return null;
  const mime=String(document.mime_type||'').toLowerCase();
  const name=String(document.file_name||'').toLowerCase();
  if(mime==='application/pdf'||(!mime&&name.endsWith('.pdf')))return {kind:'pdf',fileId:document.file_id};
  if(mime.startsWith('video/')||(!mime&&/\.(mp4|mkv|mov|webm|avi)$/.test(name)))return {kind:'video',fileId:document.file_id};
  return null;
}
function autoTitle(message,number){
  const caption=String(message.caption||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  const fileName=String(message.document?.file_name||'').replace(/\.[a-z0-9]{1,8}$/i,'').trim();
  return (caption||fileName||'Lecture '+String(number).padStart(2,'0')).slice(0,120);
}
async function getAutoSaveStatus(ownerId){
  const {rows}=await query(
    'SELECT a.is_active,a.chapter_id,a.saved_videos,a.saved_pdfs,a.updated_at,c.title AS chapter_title,s.title AS subject_title,b.title AS batch_title FROM auto_save_sessions a JOIN chapters c ON c.id=a.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id WHERE a.telegram_id=$1',
    [String(ownerId)]
  );
  return rows[0]||{is_active:false,saved_videos:0,saved_pdfs:0};
}
async function startAutoSave(ownerId,chapterId){
  return transaction(async c=>{
    const target=await c.query(
      'SELECT c.id,c.title AS chapter_title,s.title AS subject_title,b.title AS batch_title FROM chapters c JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id WHERE c.id=$1',
      [chapterId]
    );
    if(!target.rowCount)return null;
    await c.query(
      'INSERT INTO auto_save_sessions(telegram_id,chapter_id,is_active,saved_videos,saved_pdfs,updated_at) VALUES($1,$2,true,0,0,now()) ON CONFLICT(telegram_id) DO UPDATE SET chapter_id=$2,is_active=true,saved_videos=0,saved_pdfs=0,updated_at=now()',
      [String(ownerId),chapterId]
    );
    return {...target.rows[0],is_active:true};
  });
}
async function stopAutoSave(ownerId){
  const {rows}=await query('UPDATE auto_save_sessions SET is_active=false,updated_at=now() WHERE telegram_id=$1 RETURNING chapter_id,saved_videos,saved_pdfs',[String(ownerId)]);
  return rows[0]||null;
}
async function processAutoSave(message,ownerId){
  if(!message||message.chat?.type!=='private'||String(message.from?.id)!==String(ownerId))return null;
  const media=classifyMedia(message);
  if(!media)return null;
  const owner=String(ownerId);
  const chatId=String(message.chat.id);
  const messageId=message.message_id;
  if(!Number.isSafeInteger(messageId))return null;
  return transaction(async c=>{
    // Serializes media events, even when Telegram sends a burst/albums.
    const {rows}=await c.query(
      'SELECT a.chapter_id,a.is_active,c.title AS chapter_title FROM auto_save_sessions a JOIN chapters c ON c.id=a.chapter_id WHERE a.telegram_id=$1 FOR UPDATE OF a',
      [owner]
    );
    const session=rows[0];
    if(!session?.is_active)return null;
    const receipt=await c.query(
      'SELECT lecture_id,media_kind FROM auto_save_receipts WHERE telegram_id=$1 AND chat_id=$2 AND message_id=$3',
      [owner,chatId,messageId]
    );
    if(receipt.rowCount)return {kind:'duplicate'};
    let lecture;
    if(media.kind==='video'){
      const next=await c.query(
        'SELECT count(*)::int AS total,coalesce(max(sort_order),-1)+1 AS next_order FROM lectures WHERE chapter_id=$1',
        [session.chapter_id]
      );
      const count=next.rows[0];
      const result=await c.query(
        'INSERT INTO lectures(chapter_id,title,telegram_video_id,sort_order) VALUES($1,$2,$3,$4) RETURNING id,title',
        [session.chapter_id,autoTitle(message,count.total+1),media.fileId,count.next_order]
      );
      lecture=result.rows[0];
    }else{
      // Strict order: first existing lecture missing notes, never replace notes.
      const next=await c.query(
        'SELECT id,title FROM lectures WHERE chapter_id=$1 AND telegram_notes_id IS NULL ORDER BY sort_order ASC,created_at ASC,id ASC LIMIT 1 FOR UPDATE',
        [session.chapter_id]
      );
      if(!next.rowCount)return {kind:'no_lecture',chapter:session.chapter_title};
      lecture=next.rows[0];
      const assigned=await c.query(
        'UPDATE lectures SET telegram_notes_id=$2 WHERE id=$1 AND telegram_notes_id IS NULL RETURNING id',
        [lecture.id,media.fileId]
      );
      if(!assigned.rowCount)throw new Error('Notes assignment conflict; retry');
    }
    await c.query(
      'INSERT INTO auto_save_receipts(telegram_id,chat_id,message_id,media_kind,lecture_id) VALUES($1,$2,$3,$4,$5)',
      [owner,chatId,messageId,media.kind,lecture.id]
    );
    const column=media.kind==='video'?'saved_videos':'saved_pdfs';
    await c.query('UPDATE auto_save_sessions SET '+column+'='+column+'+1,updated_at=now() WHERE telegram_id=$1',[owner]);
    return {kind:media.kind,lectureId:lecture.id,title:lecture.title,chapter:session.chapter_title};
  });
}
module.exports={classifyMedia,autoTitle,getAutoSaveStatus,startAutoSave,stopAutoSave,processAutoSave};
