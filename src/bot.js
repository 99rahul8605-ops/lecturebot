'use strict';
const TelegramBot=require('node-telegram-bot-api');
const {query}=require('./db');
const {processAutoSave,getAutoSaveStatus,stopAutoSave,nextChapter,undoAutoSave,fileLink}=require('./auto-save');
function createBot({token,webUrl,ownerId}) {
  if(!token) throw new Error('BOT_TOKEN required');
  const bot=new TelegramBot(token,{polling:false});
  bot.onText(/^\/start(?:\s+(.*))?$/,async(msg,match)=>{
    if(msg.chat.type!=='private')return;
    const u=msg.from,id=String(u.id),arg=String(match?.[1]||'');
    try{
      await query(`INSERT INTO app_users(telegram_id,first_name,last_name,username,last_seen) VALUES($1,$2,$3,$4,now()) ON CONFLICT(telegram_id) DO UPDATE SET first_name=$2,last_name=$3,username=$4,last_seen=now()`,[id,u.first_name||'',u.last_name||'',u.username||'']);
      if(/^ref_\d+$/.test(arg)){
        const inviter=arg.slice(4);
        if(inviter!==id) await query(`INSERT INTO referrals(inviter_id,invitee_id) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM app_users WHERE telegram_id=$1) ON CONFLICT(invitee_id) DO NOTHING`,[inviter,id]);
      }
      if(/^file_[a-zA-Z0-9_-]{16}$/.test(arg)){
        const code=arg.slice(5);
        const {rows}=await query("SELECT f.code,f.telegram_file_id,f.file_type,f.file_name,f.telegram_id AS uploader,r.lecture_id,l.telegram_video_id,l.telegram_notes_id,b.is_published,(b.is_premium OR l.is_premium) AS premium,b.id AS batch_id FROM saved_telegram_files f LEFT JOIN auto_save_receipts r ON r.file_code=f.code AND r.is_undone=false LEFT JOIN lectures l ON l.id=r.lecture_id LEFT JOIN chapters c ON c.id=l.chapter_id LEFT JOIN subjects s ON s.id=c.subject_id LEFT JOIN batches b ON b.id=s.batch_id WHERE f.code=$1 ORDER BY r.saved_at DESC LIMIT 1",[code]);
        const file=rows[0];
        if(!file)return bot.sendMessage(msg.chat.id,'File not found.');
        if(id!==ownerId){
          if(!file.lecture_id||!file.is_published)return bot.sendMessage(msg.chat.id,'File not available.');
          if(file.premium){
            const access=await query("SELECT 1 FROM batch_access WHERE telegram_id=$1 AND batch_id=$2 AND (expires_at IS NULL OR expires_at>now())",[id,file.batch_id]);
            if(!access.rowCount)return bot.sendMessage(msg.chat.id,'🔒 Premium access required.');
          }
        }
        const caption=file.file_name.slice(0,900);
        if(file.file_type==='video')return bot.sendVideo(msg.chat.id,file.telegram_file_id,{caption,protect_content:true});
        return bot.sendDocument(msg.chat.id,file.telegram_file_id,{caption});
      }
      if(/^grp_[a-f0-9]{16}$/.test(arg)){
        const inviteCode=arg.slice(4);
        const group=await query('SELECT id,name FROM study_groups WHERE invite_code=$1',[inviteCode]);
        if(!group.rowCount)return bot.sendMessage(msg.chat.id,'Group invite is invalid or expired.');
        await query('INSERT INTO group_members(group_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[group.rows[0].id,id]);
        return bot.sendMessage(msg.chat.id,'✅ Joined '+escapeHtml(group.rows[0].name)+'! Open the learning app to study with your group.',{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'📚 Open Learning App',web_app:{url:webUrl}}]]}});
      }
      if(/^pack_[a-f0-9]{24}$/.test(arg)){
        const key=arg.slice(5);
        const result=await query("UPDATE delivery_jobs SET consumed_at=now() WHERE id=$1 AND telegram_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING *",[key,id]);
        const job=result.rows[0];
        if(!job)return bot.sendMessage(msg.chat.id,'This delivery request has expired, was used already, or belongs to another user.');
        const {rows}=await query(`SELECT l.id,l.title,l.telegram_video_id,l.telegram_notes_id,b.is_published,(b.is_premium OR l.is_premium) AS premium,(a.telegram_id IS NOT NULL) AS access FROM lectures l JOIN chapters c ON c.id=l.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id LEFT JOIN batch_access a ON a.batch_id=b.id AND a.telegram_id=$2 AND (a.expires_at IS NULL OR a.expires_at>now()) WHERE l.id=ANY($1::uuid[])`,[job.lecture_ids,id]);
        const byId=new Map(rows.map(r=>[r.id,r]));
        await bot.sendMessage(msg.chat.id,'📦 Sending '+job.lecture_ids.length+' selected '+(job.media_type==='lec'?'lectures':'PDF notes')+'…');
        let sent=0,failed=0;
        for(const lectureId of job.lecture_ids){
          const lecture=byId.get(lectureId),file=lecture&&(job.media_type==='lec'?lecture.telegram_video_id:lecture.telegram_notes_id);
          if(!lecture||(!lecture.is_published&&id!==ownerId)||(lecture.premium&&!lecture.access&&id!==ownerId)||!file){failed++;continue}
          try{
            if(job.media_type==='lec')await bot.sendVideo(msg.chat.id,file,{caption:lecture.title,protect_content:true});
            else await bot.sendDocument(msg.chat.id,file,{caption:'📄 '+lecture.title});
            sent++;
          }catch(error){failed++;console.error('Bulk delivery error:',error.message)}
        }
        return bot.sendMessage(msg.chat.id,'✅ Delivered: '+sent+' / '+job.lecture_ids.length+(failed?' · Failed/unavailable: '+failed:''));
      }
      if(/^lec_[a-f0-9-]{36}$/.test(arg)){
        const {rows}=await query(`SELECT l.title,l.telegram_video_id,l.is_premium,b.is_premium AS batch_premium,b.id AS batch_id FROM lectures l JOIN chapters c ON c.id=l.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id WHERE l.id=$1 AND b.is_published=true`,[arg.slice(4)]);
        const lec=rows[0]; if(!lec)return bot.sendMessage(msg.chat.id,'Lecture not found.');
        const paid=lec.is_premium||lec.batch_premium;
        if(paid && id!==ownerId){const access=await query('SELECT 1 FROM batch_access WHERE telegram_id=$1 AND batch_id=$2 AND (expires_at IS NULL OR expires_at>now())',[id,lec.batch_id]);if(!access.rowCount)return bot.sendMessage(msg.chat.id,'🔒 Premium lecture. Purchase or request access inside the app.');}
        if(!lec.telegram_video_id)return bot.sendMessage(msg.chat.id,'Lecture video not uploaded yet.');
        return bot.sendVideo(msg.chat.id,lec.telegram_video_id,{caption:lec.title,protect_content:true});
      }
      if(/^note_[a-f0-9-]{36}$/.test(arg)){
        const {rows}=await query(`SELECT l.title,l.telegram_notes_id,l.is_premium,b.is_premium AS batch_premium,b.id AS batch_id FROM lectures l JOIN chapters c ON c.id=l.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id WHERE l.id=$1 AND b.is_published=true`,[arg.slice(5)]);
        const lec=rows[0];if(!lec)return bot.sendMessage(msg.chat.id,'Notes not found.');
        if((lec.is_premium||lec.batch_premium)&&id!==ownerId){const access=await query('SELECT 1 FROM batch_access WHERE telegram_id=$1 AND batch_id=$2 AND (expires_at IS NULL OR expires_at>now())',[id,lec.batch_id]);if(!access.rowCount)return bot.sendMessage(msg.chat.id,'🔒 Premium notes.');}
        if(!lec.telegram_notes_id)return bot.sendMessage(msg.chat.id,'Notes not available yet.');
        return bot.sendDocument(msg.chat.id,lec.telegram_notes_id,{caption:`📄 ${lec.title}`});
      }
      await bot.sendMessage(msg.chat.id,`📚 <b>EduBot Next — Test Version</b>\n\nWelcome ${escapeHtml(u.first_name||'Student')}! Explore subjects, chapters, lectures and PDF notes.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'📚 Open Learning App',web_app:{url:webUrl}}],[{text:'📤 Share with Friends',url:`https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${(await bot.getMe()).username}?start=ref_${id}`)}`}]]}});
    }catch(err){console.error('start handler:',err.message);await bot.sendMessage(msg.chat.id,'Temporary error, please retry.').catch(()=>{});}
  });
  // Old bot's Auto Mode workflow on the NEW isolated V2 test bot.
  // Owner-only, persistent, transactional and deduplicated.
  const uploadQueue={chain:Promise.resolve()};
  bot.on('message',msg=>{
    if(String(msg.from?.id)!==String(ownerId)||msg.chat?.type!=='private')return;
    uploadQueue.chain=uploadQueue.chain.then(async()=>{
      const result=await processAutoSave(msg,ownerId);
      if(!result||result.kind==='duplicate')return;
      const botName=(await bot.getMe()).username;
      const link=fileLink(botName,result.code);
      if(result.kind==='no_lecture'){
        await bot.sendMessage(msg.chat.id,'ℹ️ <b>No empty Notes slots found.</b>\nEvery lecture here already has notes (or no video lecture exists).\n\n📁 Saved PDF: '+escapeHtml(result.fileName)+'\n🔗 <code>'+link+'</code>\n\nNo lecture was overwritten. Send videos first, then resend the PDF if you want to attach it.',{parse_mode:'HTML'});
        return;
      }
      const location=[result.batch,result.subject,result.chapter].map(escapeHtml).join(' › ');
      if(result.kind==='video'){
        await bot.sendMessage(msg.chat.id,'✅ <b>Auto-Saved!</b>\n📖 <b>'+escapeHtml(result.title)+'</b>\n📁 '+escapeHtml(result.fileName)+'\n📍 '+location+'\n🔗 <code>'+link+'</code>\n\n▶️ Next: <b>Lecture '+result.nextLecture+'</b>\n📎 Next PDF → '+escapeHtml(result.nextMissingNotes||'No missing notes')+'\n↩️ /undo · ➡️ /nextchapter · ⏹ /autosavestop',{parse_mode:'HTML'});
      }else{
        await bot.sendMessage(msg.chat.id,'📎 <b>Notes Attached!</b>\n📖 <b>'+escapeHtml(result.title)+'</b> (#'+result.lectureNumber+')\n📁 '+escapeHtml(result.fileName)+'\n📍 '+location+'\n🔗 <code>'+link+'</code>\n\n'+(result.nextMissingNotes?'📨 Next PDF → '+escapeHtml(result.nextMissingNotes):'✅ All existing lecture notes are filled')+'\n↩️ /undo · ➡️ /nextchapter',{parse_mode:'HTML'});
      }
    }).catch(async err=>{
      console.error('V2 Auto Save:',err.message);
      await bot.sendMessage(msg.chat.id,'❌ Auto Save error. Confirm the item in Admin before retrying.').catch(()=>{});
    });
  });
  bot.onText(/^\/autosavestatus$/,async msg=>{
    if(msg.chat.type!=='private'||String(msg.from?.id)!==String(ownerId))return;
    try{
      const a=await getAutoSaveStatus(ownerId);
      await bot.sendMessage(msg.chat.id,a.is_active
        ? '✅ <b>Auto Mode ACTIVE</b>\n📍 '+[a.batch_title,a.subject_title,a.chapter_title].map(escapeHtml).join(' › ')+'\n▶️ Next: Lecture '+a.next_lecture_number+'\n📎 Missing notes: '+a.missing_notes+'\n📊 This session: '+a.saved_videos+' videos, '+a.saved_pdfs+' PDFs'
        : '⏹ Auto Mode OFF. Open Mini App → Admin → Auto Save.',{parse_mode:'HTML'});
    }catch(e){console.error(e.message)}
  });
  bot.onText(/^\/autosavestop$/,async msg=>{
    if(msg.chat.type!=='private'||String(msg.from?.id)!==String(ownerId))return;
    try{const a=await stopAutoSave(ownerId);await bot.sendMessage(msg.chat.id,'⏹ Auto Mode OFF. Saved: '+(a?.saved_videos||0)+' videos, '+(a?.saved_pdfs||0)+' PDFs.')}catch(e){console.error(e.message)}
  });
  bot.onText(/^\/nextchapter$/,async msg=>{
    if(msg.chat.type!=='private'||String(msg.from?.id)!==String(ownerId))return;
    try{const r=await nextChapter(ownerId);await bot.sendMessage(msg.chat.id,r.error?'⚠️ '+r.error:'➡️ <b>Next chapter:</b> '+escapeHtml(r.chapter_title)+'\n▶️ Next: Lecture '+r.next_lecture_number,{parse_mode:'HTML'});}catch(e){console.error('Next chapter:',e.message);await bot.sendMessage(msg.chat.id,'Could not move to the next chapter.').catch(()=>{})}
  });
  bot.onText(/^\/undo$/,async msg=>{
    if(msg.chat.type!=='private'||String(msg.from?.id)!==String(ownerId))return;
    try{const r=await undoAutoSave(ownerId);await bot.sendMessage(msg.chat.id,r.error?'⚠️ '+r.error:r.kind==='lecture'?'↩️ <b>Undone</b> — last auto-saved lecture removed. Saved file link remains valid for owner only.':'↩️ <b>Undone</b> — last notes attachment removed. Saved PDF link remains valid for owner only.',{parse_mode:'HTML'});}catch(e){console.error('Undo:',e.message);await bot.sendMessage(msg.chat.id,'Could not undo the last action.').catch(()=>{})}
  });
  bot.onText(/^\/nextunit$/,async msg=>{
    if(msg.chat.type!=='private'||String(msg.from?.id)!==String(ownerId))return;
    await bot.sendMessage(msg.chat.id,'⚠️ Units are not yet implemented in V2. Use /nextchapter or select a chapter in Admin → Auto Save.');
  });
  return bot;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
module.exports={createBot};
