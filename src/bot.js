'use strict';
const TelegramBot=require('node-telegram-bot-api');
const {query}=require('./db');
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
  return bot;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
module.exports={createBot};
