'use strict';
require('dotenv').config();
const crypto=require('node:crypto');
const express=require('express');
const helmet=require('helmet');
const path=require('node:path');
const {createServer}=require('node:http');
const {Server}=require('socket.io');
const {query,transaction,pool}=require('./db');
const {verifyTelegramInitData}=require('./auth');
const {createBot}=require('./bot');
const {getAutoSaveStatus,startAutoSave,stopAutoSave,nextChapter,undoAutoSave}=require('./auto-save');
const {mountV2Features}=require('./v2-features');
const app=express();const httpServer=createServer(app);
app.disable('x-powered-by');app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'32kb'}));
app.use(express.static(path.join(__dirname,'../public'),{extensions:['html']}));
const BOT_TOKEN=process.env.BOT_TOKEN||'';
const OWNER_ID=String(process.env.OWNER_ID||'');
const bot=BOT_TOKEN?createBot({token:BOT_TOKEN,webUrl:process.env.WEB_URL||'http://localhost:3102',ownerId:OWNER_ID}):null;
let botName='';
function auth(req,res,next){try{req.user=verifyTelegramInitData(req.get('x-telegram-init-data')||'',BOT_TOKEN);next();}catch(err){res.status(401).json({error:err.message});}}
const api=express.Router();app.use('/api',api);
api.get('/health',async(_req,res)=>{try{await query('SELECT 1');res.json({ok:true,database:'connected',version:'v2-test'});}catch{res.status(503).json({ok:false,database:'unavailable'});}});
api.get('/config',(_req,res)=>res.json({botUsername:botName,adsEnabled:false,testMode:true}));
// Published batch covers are public assets; unpublished draft covers require owner API.
api.get('/batches/:id/cover',async(req,res,next)=>{
 try{
  if(!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.sendStatus(404);
  const {rows}=await query('SELECT c.content_type,c.image_bytes FROM batch_covers c JOIN batches b ON b.id=c.batch_id WHERE c.batch_id=$1 AND b.is_published=true',[req.params.id]);
  if(!rows[0])return res.sendStatus(404);
  res.set({'Content-Type':rows[0].content_type,'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'});
  res.send(rows[0].image_bytes);
 }catch(e){next(e);}
});
api.use(auth);
api.get('/me',async(req,res,next)=>{try{
 const u=req.user;await query(`INSERT INTO app_users(telegram_id,first_name,last_name,username,last_seen) VALUES($1,$2,$3,$4,now()) ON CONFLICT(telegram_id) DO UPDATE SET first_name=$2,last_name=$3,username=$4,last_seen=now()`,[u.id,u.firstName,u.lastName,u.username]);
 const [points,streak]=await Promise.all([query('SELECT coalesce(sum(points),0)::int AS points FROM point_ledger WHERE telegram_id=$1',[u.id]),query(`SELECT count(DISTINCT started_at::date)::int AS days FROM study_sessions WHERE telegram_id=$1 AND started_at >= now()-interval '7 days'`,[u.id])]);
 res.json({user:u,points:points.rows[0].points,studyDaysLast7:streak.rows[0].days,isAdmin:u.id===OWNER_ID});
}catch(e){next(e);}});
api.get('/batches',async(req,res,next)=>{try{const {rows}=await query(`SELECT b.id,b.title,b.description,b.cover_url,b.is_premium,count(DISTINCT s.id)::int AS subjects_count FROM batches b LEFT JOIN subjects s ON s.batch_id=b.id WHERE b.is_published=true OR $1=true GROUP BY b.id ORDER BY b.sort_order,b.title`,[req.user.id===OWNER_ID]);res.json(rows);}catch(e){next(e);}});
api.get('/batches/:id/subjects',async(req,res,next)=>{try{const {rows}=await query(`SELECT s.id,s.title,s.icon,count(c.id)::int AS chapter_count FROM subjects s JOIN batches b ON b.id=s.batch_id LEFT JOIN chapters c ON c.subject_id=s.id WHERE s.batch_id=$1 AND (b.is_published OR $2=true) GROUP BY s.id ORDER BY s.sort_order,s.title`,[req.params.id,req.user.id===OWNER_ID]);res.json(rows);}catch(e){next(e);}});
api.get('/subjects/:id/chapters',async(req,res,next)=>{try{const {rows}=await query(`SELECT c.id,c.title,count(l.id)::int AS lecture_count,count(p.lecture_id)::int AS completed_count FROM chapters c JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id LEFT JOIN lectures l ON l.chapter_id=c.id LEFT JOIN lecture_progress p ON p.lecture_id=l.id AND p.telegram_id=$2 WHERE c.subject_id=$1 AND (b.is_published OR $3=true) GROUP BY c.id ORDER BY c.sort_order,c.title`,[req.params.id,req.user.id,req.user.id===OWNER_ID]);res.json(rows);}catch(e){next(e);}});
api.get('/chapters/:id/lectures',async(req,res,next)=>{try{const {rows}=await query(`SELECT l.id,l.title,l.is_premium,(l.telegram_video_id IS NOT NULL) AS has_video,(l.telegram_notes_id IS NOT NULL) AS has_notes,(p.lecture_id IS NOT NULL) AS completed,(b.is_premium OR l.is_premium) AS locked,(a.telegram_id IS NOT NULL) AS access_granted FROM lectures l JOIN chapters c ON c.id=l.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id LEFT JOIN lecture_progress p ON p.lecture_id=l.id AND p.telegram_id=$2 LEFT JOIN batch_access a ON a.batch_id=b.id AND a.telegram_id=$2 AND (a.expires_at IS NULL OR a.expires_at>now()) WHERE c.id=$1 AND (b.is_published OR $3=true) ORDER BY l.sort_order,l.created_at`,[req.params.id,req.user.id,req.user.id===OWNER_ID]);res.json(rows.map(r=>({...r,locked:r.locked&&!r.access_granted&&req.user.id!==OWNER_ID})));}catch(e){next(e);}});
api.post('/lectures/:id/complete',async(req,res,next)=>{try{const found=await query(`SELECT l.id,b.is_published,(b.is_premium OR l.is_premium) AS premium, a.telegram_id IS NOT NULL AS access FROM lectures l JOIN chapters c ON c.id=l.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id LEFT JOIN batch_access a ON a.batch_id=b.id AND a.telegram_id=$2 AND (a.expires_at IS NULL OR a.expires_at>now()) WHERE l.id=$1`,[req.params.id,req.user.id]);const l=found.rows[0];if(!l||(!l.is_published&&req.user.id!==OWNER_ID))return res.status(404).json({error:'Not found'});if(l.premium&&!l.access&&req.user.id!==OWNER_ID)return res.status(403).json({error:'Premium access required'});await query('INSERT INTO lecture_progress(telegram_id,lecture_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.user.id,req.params.id]);res.json({ok:true});}catch(e){next(e);}});
api.post('/deliveries',async(req,res,next)=>{try{
 const ids=req.body?.lectureIds,kind=req.body?.kind;
 if(!['lec','note'].includes(kind)||!Array.isArray(ids)||ids.length<1||ids.length>25||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))return res.status(400).json({error:'Select 1 to 25 unique lecture IDs'});
 if(!botName)return res.status(503).json({error:'Test bot is not ready'});
 const recent=await query("SELECT count(*)::int AS n FROM delivery_jobs WHERE telegram_id=$1 AND created_at>now()-interval '15 minutes'",[req.user.id]);
 if(recent.rows[0].n>=10)return res.status(429).json({error:'Too many requests. Retry later'});
 const {rows}=await query(`SELECT l.id, l.telegram_video_id,l.telegram_notes_id, b.is_published,(b.is_premium OR l.is_premium) AS premium,(a.telegram_id IS NOT NULL) AS access
 FROM lectures l JOIN chapters c ON c.id=l.chapter_id JOIN subjects s ON s.id=c.subject_id JOIN batches b ON b.id=s.batch_id
 LEFT JOIN batch_access a ON a.batch_id=b.id AND a.telegram_id=$2 AND (a.expires_at IS NULL OR a.expires_at>now())
 WHERE l.id=ANY($1::uuid[])`,[ids,req.user.id]);
 if(rows.length!==ids.length||rows.some(l=>(!l.is_published&&req.user.id!==OWNER_ID)||(l.premium&&!l.access&&req.user.id!==OWNER_ID)||!(kind==='lec'?l.telegram_video_id:l.telegram_notes_id)))return res.status(403).json({error:'Some selected items are unavailable or locked'});
 const token=crypto.randomBytes(12).toString('hex');
 await query('INSERT INTO delivery_jobs(id,telegram_id,media_type,lecture_ids) VALUES($1,$2,$3,$4::uuid[])',[token,req.user.id,kind,ids]);
 res.status(201).json({url:'https://t.me/'+botName+'?start=pack_'+token,count:ids.length});
 }catch(e){next(e);}});
api.get('/study/status',async(req,res,next)=>{try{const {rows}=await query('SELECT id,subject_id,started_at FROM study_sessions WHERE telegram_id=$1 AND ended_at IS NULL LIMIT 1',[req.user.id]);res.json({active:rows[0]||null});}catch(e){next(e);}});
api.post('/study/start',async(req,res,next)=>{try{const subject=req.body?.subjectId||null;const {rows}=await query(`INSERT INTO study_sessions(telegram_id,subject_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id,started_at`,[req.user.id,subject]);if(!rows.length)return res.status(409).json({error:'Session already running'});io.emit('room:count',await activeCount());res.json(rows[0]);}catch(e){next(e);}});
api.post('/study/stop',async(req,res,next)=>{try{const {rows}=await query(`UPDATE study_sessions SET ended_at=now() WHERE telegram_id=$1 AND ended_at IS NULL RETURNING id,started_at,ended_at`,[req.user.id]);if(!rows.length)return res.status(409).json({error:'No running study session'});io.emit('room:count',await activeCount());res.json(rows[0]);}catch(e){next(e);}});
api.get('/study/stats',async(req,res,next)=>{try{const {rows}=await query(`SELECT COALESCE(sum(extract(epoch from (COALESCE(ended_at,now())-started_at)))/60,0)::int AS total_minutes,count(*)::int AS sessions FROM study_sessions WHERE telegram_id=$1`,[req.user.id]);res.json(rows[0]);}catch(e){next(e);}});
api.get('/tasks',async(req,res,next)=>{try{res.json((await query('SELECT id,title,is_done,due_day FROM study_tasks WHERE telegram_id=$1 ORDER BY is_done,created_at DESC LIMIT 100',[req.user.id])).rows);}catch(e){next(e);}});
api.post('/tasks',async(req,res,next)=>{try{const title=String(req.body?.title||'').trim();if(!title||title.length>240)return res.status(400).json({error:'Title must be 1–240 characters'});const {rows}=await query('INSERT INTO study_tasks(telegram_id,title) VALUES($1,$2) RETURNING id,title,is_done',[req.user.id,title]);res.status(201).json(rows[0]);}catch(e){next(e);}});
api.patch('/tasks/:id',async(req,res,next)=>{try{if(typeof req.body?.isDone!=='boolean')return res.status(400).json({error:'isDone must be boolean'});const {rows}=await query('UPDATE study_tasks SET is_done=$3 WHERE id=$1 AND telegram_id=$2 RETURNING id,title,is_done',[req.params.id,req.user.id,req.body.isDone]);if(!rows.length)return res.sendStatus(404);res.json(rows[0]);}catch(e){next(e);}});
api.get('/groups',async(req,res,next)=>{try{const {rows}=await query(`SELECT g.id,g.name,g.owner_id,g.target_minutes,COUNT(DISTINCT m.telegram_id)::int AS members,BOOL_OR(m.telegram_id=$1) AS joined,COUNT(DISTINCT ss.telegram_id)::int AS live FROM study_groups g LEFT JOIN group_members m ON m.group_id=g.id LEFT JOIN study_sessions ss ON ss.telegram_id=m.telegram_id AND ss.ended_at IS NULL AND ss.started_at>now()-interval '12 hours' WHERE g.visibility='public' OR EXISTS(SELECT 1 FROM group_members mine WHERE mine.group_id=g.id AND mine.telegram_id=$1) GROUP BY g.id ORDER BY g.created_at DESC LIMIT 100`,[req.user.id]);res.json(rows);}catch(e){next(e);}});
api.post('/groups',async(req,res,next)=>{try{const name=String(req.body?.name||'').trim();if(name.length<3||name.length>70)return res.status(400).json({error:'Group name 3–70 characters'});const visibility=['public','link'].includes(req.body?.visibility)?req.body.visibility:'link';const goal=Number(req.body?.targetMinutes||180);if(!Number.isInteger(goal)||goal<15||goal>1440)return res.status(400).json({error:'Invalid daily target'});const invite=crypto.randomBytes(8).toString('hex');const row=await transaction(async c=>{const {rows}=await c.query('INSERT INTO study_groups(name,owner_id,visibility,invite_code,target_minutes,show_live_timers) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,invite_code',[name,req.user.id,visibility,invite,goal,req.body?.showLiveTimers!==false]);await c.query("INSERT INTO group_members(group_id,telegram_id,role) VALUES($1,$2,'owner')",[rows[0].id,req.user.id]);return rows[0];});res.status(201).json(row);}catch(e){next(e);}});
api.post('/groups/:id/join',async(req,res,next)=>{try{const exists=await query("SELECT 1 FROM study_groups WHERE id=$1 AND visibility='public'",[req.params.id]);if(!exists.rowCount)return res.status(403).json({error:'Invite code required'});await query('INSERT INTO group_members(group_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.user.id]);res.json({ok:true});}catch(e){next(e);}});
api.get('/groups/:id/messages',async(req,res,next)=>{try{const member=await query('SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2',[req.params.id,req.user.id]);if(!member.rowCount)return res.sendStatus(403);const {rows}=await query(`SELECT m.id,m.sender_id,u.first_name,m.body,m.created_at,m.is_deleted FROM group_messages m JOIN app_users u ON u.telegram_id=m.sender_id WHERE m.group_id=$1 ORDER BY m.id DESC LIMIT 50`,[req.params.id]);res.json(rows.reverse());}catch(e){next(e);}});
api.post('/groups/:id/messages',async(req,res,next)=>{try{const body=String(req.body?.body||'').trim();if(!body||body.length>2000)return res.status(400).json({error:'Message 1–2000 characters'});const member=await query('SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2',[req.params.id,req.user.id]);if(!member.rowCount)return res.sendStatus(403);const {rows}=await query('INSERT INTO group_messages(group_id,sender_id,body) VALUES($1,$2,$3) RETURNING id,group_id,sender_id,body,created_at',[req.params.id,req.user.id,body]);io.to('group:'+req.params.id).emit('group:message',rows[0]);res.status(201).json(rows[0]);}catch(e){next(e);}});
api.get('/referrals',async(req,res,next)=>{try{const [ref,points]=await Promise.all([query('SELECT count(*)::int AS count FROM referrals WHERE inviter_id=$1',[req.user.id]),query('SELECT coalesce(sum(points),0)::int AS balance FROM point_ledger WHERE telegram_id=$1',[req.user.id])]);res.json({count:ref.rows[0].count,balance:points.rows[0].balance,inviteUrl:botName?`https://t.me/${botName}?start=ref_${req.user.id}`:null});}catch(e){next(e);}});
mountV2Features(api,{query,transaction,bot,getBotUsername:()=>botName});
// Temporary admin import endpoints for manually created test content. No production DB writes.
function owner(req,res,next){if(req.user.id!==OWNER_ID)return res.sendStatus(403);next();}
api.post('/admin/batches',owner,async(req,res,next)=>{try{const title=String(req.body?.title||'').trim();if(!title||title.length>120)return res.status(400).json({error:'Invalid title'});const {rows}=await query('INSERT INTO batches(title,description,is_published,is_premium) VALUES($1,$2,false,$3) RETURNING *',[title,String(req.body?.description||'').slice(0,500),!!req.body?.isPremium]);res.status(201).json(rows[0]);}catch(e){next(e);}});
api.post('/admin/subjects',owner,async(req,res,next)=>{try{const title=String(req.body?.title||'').trim();if(!title||title.length>120)return res.status(400).json({error:'Invalid title'});const {rows}=await query('INSERT INTO subjects(batch_id,title) VALUES($1,$2) RETURNING *',[req.body?.batchId,title]);res.status(201).json(rows[0]);}catch(e){next(e);}});
api.post('/admin/chapters',owner,async(req,res,next)=>{try{const title=String(req.body?.title||'').trim();if(!title||title.length>120)return res.status(400).json({error:'Invalid title'});const {rows}=await query('INSERT INTO chapters(subject_id,title,sort_order) VALUES($1,$2,COALESCE((SELECT max(sort_order)+1 FROM chapters WHERE subject_id=$1),0)) RETURNING *',[req.body?.subjectId,title]);res.status(201).json(rows[0]);}catch(e){next(e);}});
api.post('/admin/lectures',owner,async(req,res,next)=>{try{const title=String(req.body?.title||'').trim();if(!title||title.length>120)return res.status(400).json({error:'Invalid title'});const {rows}=await query('INSERT INTO lectures(chapter_id,title,telegram_video_id,telegram_notes_id) VALUES($1,$2,$3,$4) RETURNING id,title',[req.body?.chapterId,title,req.body?.videoFileId||null,req.body?.notesFileId||null]);res.status(201).json(rows[0]);}catch(e){next(e);}});
api.post('/admin/batches/:id/publish',owner,async(req,res,next)=>{try{const {rows}=await query('UPDATE batches SET is_published=$2 WHERE id=$1 RETURNING id,is_published',[req.params.id,req.body?.published===true]);if(!rows.length)return res.sendStatus(404);res.json(rows[0]);}catch(e){next(e);}});
// Owner-only test admin media automation and batch cover image API.
api.get('/admin/auto-save',owner,async(req,res,next)=>{
 try{res.json(await getAutoSaveStatus(req.user.id));}catch(e){next(e);}
});
api.post('/admin/auto-save/start',owner,async(req,res,next)=>{
 try{
  const chapterId=req.body?.chapterId;
  if(typeof chapterId!=='string'||!/^[a-f0-9-]{36}$/i.test(chapterId))return res.status(400).json({error:'Choose a valid chapter'});
  const session=await startAutoSave(req.user.id,chapterId);
  if(!session)return res.status(404).json({error:'Chapter not found'});
  res.json(session);
 }catch(e){next(e);}
});
api.post('/admin/auto-save/stop',owner,async(req,res,next)=>{
 try{res.json({ok:true,session:await stopAutoSave(req.user.id)});}catch(e){next(e);}
});
api.post('/admin/auto-save/next-chapter',owner,async(req,res,next)=>{
 try{const result=await nextChapter(req.user.id);if(result.error)return res.status(409).json(result);res.json(result);}catch(e){next(e);}
});
api.post('/admin/auto-save/undo',owner,async(req,res,next)=>{
 try{const result=await undoAutoSave(req.user.id);if(result.error)return res.status(409).json(result);res.json(result);}catch(e){next(e);}
});
api.put('/admin/batches/:id/cover',owner,express.raw({type:['image/jpeg','image/png','image/webp'],limit:'1536kb'}),async(req,res,next)=>{
 try{
  const id=req.params.id;
  if(!/^[a-f0-9-]{36}$/i.test(id))return res.status(400).json({error:'Invalid batch ID'});
  const type=req.get('content-type')?.split(';')[0].trim().toLowerCase();
  if(!['image/jpeg','image/png','image/webp'].includes(type)||!Buffer.isBuffer(req.body)||req.body.length<16||req.body.length>1536*1024){
   return res.status(400).json({error:'Upload JPEG, PNG or WebP under 1.5 MB'});
  }
  const ok=(type==='image/jpeg'&&req.body[0]===255&&req.body[1]===216&&req.body[2]===255)
   ||(type==='image/png'&&req.body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
   ||(type==='image/webp'&&req.body.toString('ascii',0,4)==='RIFF'&&req.body.toString('ascii',8,12)==='WEBP');
  if(!ok)return res.status(400).json({error:'Image contents do not match file type'});
  const found=await query('SELECT 1 FROM batches WHERE id=$1',[id]);
  if(!found.rowCount)return res.status(404).json({error:'Batch not found'});
  await transaction(async c=>{
   await c.query('INSERT INTO batch_covers(batch_id,content_type,image_bytes) VALUES($1,$2,$3) ON CONFLICT(batch_id) DO UPDATE SET content_type=$2,image_bytes=$3,updated_at=now()',[id,type,req.body]);
   await c.query('UPDATE batches SET cover_url=$2 WHERE id=$1',[id,'/api/batches/'+id+'/cover']);
  });
  res.json({ok:true,coverUrl:'/api/batches/'+id+'/cover'});
 }catch(e){next(e);}
});
api.delete('/admin/batches/:id/cover',owner,async(req,res,next)=>{
 try{
  await transaction(async c=>{
   await c.query('DELETE FROM batch_covers WHERE batch_id=$1',[req.params.id]);
   await c.query('UPDATE batches SET cover_url=NULL WHERE id=$1',[req.params.id]);
  });
  res.json({ok:true});
 }catch(e){next(e);}
});
api.get('/admin/batches/:id/cover',owner,async(req,res,next)=>{
 try{
  const {rows}=await query('SELECT content_type,image_bytes,updated_at FROM batch_covers WHERE batch_id=$1',[req.params.id]);
  if(!rows[0])return res.sendStatus(404);
  res.set({'Content-Type':rows[0].content_type,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'});
  res.send(rows[0].image_bytes);
 }catch(e){next(e);}
});
api.get('/admin/overview',owner,async(_req,res,next)=>{try{const [users,batches,lectures]=await Promise.all([query('SELECT count(*)::int AS n FROM app_users'),query('SELECT count(*)::int AS n FROM batches'),query('SELECT count(*)::int AS n FROM lectures')]);res.json({users:users.rows[0].n,batches:batches.rows[0].n,lectures:lectures.rows[0].n});}catch(e){next(e);}});
app.use((err,req,res,next)=>{console.error('API error:',err.message);if(err.code==='22P02')return res.status(400).json({error:'Invalid identifier'});if(err.code==='23503')return res.status(400).json({error:'Linked record not found'});res.status(500).json({error:'Internal server error'});});
const io=new Server(httpServer,{cors:{origin:false}});
io.use((socket,next)=>{try{socket.data.user=verifyTelegramInitData(socket.handshake.auth?.initData||'',BOT_TOKEN);next();}catch{next(new Error('Unauthorized'));}});
io.on('connection',socket=>{socket.on('group:join',async id=>{if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))return;try{const m=await query('SELECT 1 FROM group_members WHERE group_id=$1 AND telegram_id=$2',[id,socket.data.user.id]);if(m.rowCount)socket.join('group:'+id);}catch{}});});
async function activeCount(){try{return Number((await query('SELECT count(*) AS n FROM study_sessions WHERE ended_at IS NULL')).rows[0].n);}catch{return 0;}}
api.get('/room',async(_req,res)=>res.json({active:await activeCount()}));
const port=Number(process.env.PORT||3102);
(async()=>{await query('SELECT 1');if(bot){botName=(await bot.getMe()).username;if(process.env.BOT_POLLING==='true'){await bot.startPolling();console.log('TEST bot polling ON:',botName);}else console.log('TEST bot polling OFF; API available');}httpServer.listen(port,'0.0.0.0',()=>console.log('EduBot Next test server listening on',port));})().catch(err=>{console.error('Startup failed:',err.message);process.exitCode=1;pool.end().catch(()=>{});});
process.on('SIGTERM',async()=>{try{await bot?.stopPolling();}catch{}httpServer.close();await pool.end();});
