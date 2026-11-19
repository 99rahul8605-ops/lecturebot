'use strict';
const TelegramBot=require('node-telegram-bot-api');
const {query}=require('./db');
const {processAutoSave,getAutoSaveStatus,stopAutoSave}=require('./auto-save');
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
  // Auto Save is owner-only, private-chat-only, and requires an active chapter
  // chosen through the authenticated Mini App admin panel.
  bot.on('message',async msg=>{
    if(String(msg.from?.id)!==String(ownerId)||msg.chat?.type!=='private')return;
    try{
      const result=await processAutoSave(msg,ownerId);
      if(!result)return;
      if(result.kind==='duplicate')return; // Telegram retry: already persisted
      if(result.kind==='no_lecture'){await bot.sendMessage(msg.chat.id,'⚠️ PDF not saved. No lecture without notes exists in '+result.chapter+'. Send videos first; this PDF can be resent later.');return;}
      if(result.kind==='video'){await bot.sendMessage(msg.chat.id,'✅ Auto saved video: '+result.title+'\n📂 '+result.chapter);return;}
      if(result.kind==='pdf'){await bot.sendMessage(msg.chat.id,'📄 PDF attached: '+result.title+'\n📂 '+result.chapter);return;}
    }catch(err){
      console.error('Auto Save failed:',err.message);
      await bot.sendMessage(msg.chat.id,'❌ Auto Save failed. This item was not confirmed saved. Try again or check Admin → Auto Save.').catch(()=>{});
    }
  });
  bot.onText(/^\/autosavestatus$/,async msg=>{
    if(msg.chat.type!=='private'||String(msg.from?.id)!==String(ownerId))return;
    try{const a=await getAutoSaveStatus(ownerId);await bot.sendMessage(msg.chat.id,a.is_active?'✅ Auto Save ON: '+a.batch_title+' / '+a.subject_title+' / '+a.chapter_title+'\nVideos: '+a.saved_videos+' · PDFs: '+a.saved_pdfs:'⏹ Auto Save is OFF. Open Mini App → Admin → Auto Save to choose a chapter.');}catch(e){console.error(e.message)}
  });
  bot.onText(/^\/autosavestop$/,async msg=>{
    if(msg.chat.type!=='private'||String(msg.from?.id)!==String(ownerId))return;
    try{const a=await stopAutoSave(ownerId);await bot.sendMessage(msg.chat.id,'⏹ Auto Save stopped. Videos: '+(a?.saved_videos||0)+' · PDFs: '+(a?.saved_pdfs||0));}catch(e){console.error(e.message)}
  });
  return bot;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
module.exports={createBot};
