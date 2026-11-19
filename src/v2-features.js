'use strict';
// Isolated V2 test routes. All requests reach this router after Telegram initData auth.
const crypto = require('node:crypto');
const uuid = /^[a-f0-9-]{36}$/i;
const codePattern = /^[a-f0-9]{16}$/i;
const validId = (id) => typeof id === 'string' && uuid.test(id);
const intIn = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
};
const sendError = (res, status, message) => res.status(status).json({error:message});
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req,res)).catch(next);

function mountV2Features(api, {query, transaction, bot, getBotUsername}) {
  async function requireMember(id, user, res) {
    if (!validId(id)) { sendError(res,400,'Invalid group'); return null; }
    const {rows} = await query(
      'SELECT g.id,g.name,g.owner_id,g.visibility,g.invite_code,g.target_minutes,g.show_live_timers,g.chat_mode,g.slow_mode_seconds,g.pinned_message_id,gm.role,gm.muted_until FROM study_groups g JOIN group_members gm ON gm.group_id=g.id AND gm.telegram_id=$2 WHERE g.id=$1',
      [id,user]
    );
    if (!rows[0]) { sendError(res,403,'Join the group first'); return null; }
    return rows[0];
  }
  const canModerate = g => g.role === 'owner' || g.role === 'coadmin';
  const todaySql = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

  api.get('/study/subjects', asyncRoute(async(req,res)=>{
    const {rows}=await query(
      'SELECT DISTINCT ON (s.title) s.id,s.title,s.icon FROM subjects s JOIN batches b ON b.id=s.batch_id WHERE b.is_published=true ORDER BY s.title,s.sort_order LIMIT 100');
    res.json(rows);
  }));

  api.get('/study/plan', asyncRoute(async(req,res)=>{
    const id=req.user.id;
    const [goal,done,subjects,tasks]=await Promise.all([
      query('SELECT target_minutes FROM study_goals WHERE telegram_id=$1 AND goal_day='+todaySql,[id]),
      query("SELECT coalesce(sum(extract(epoch from (least(coalesce(ended_at,now()),started_at+interval '12 hours')-started_at))/60),0)::int AS minutes FROM study_sessions WHERE telegram_id=$1 AND (started_at AT TIME ZONE 'Asia/Kolkata')::date="+todaySql,[id]),
      query("SELECT coalesce(s.title,'Other') AS title,coalesce(sum(extract(epoch from (least(coalesce(ss.ended_at,now()),ss.started_at+interval '12 hours')-ss.started_at))/60),0)::int AS minutes FROM study_sessions ss LEFT JOIN subjects s ON s.id=ss.subject_id WHERE ss.telegram_id=$1 AND (ss.started_at AT TIME ZONE 'Asia/Kolkata')::date="+todaySql+" GROUP BY s.title ORDER BY minutes DESC",[id]),
      query('SELECT id,title,is_done,subject_id FROM study_tasks WHERE telegram_id=$1 AND (due_day IS NULL OR due_day='+todaySql+') ORDER BY is_done,created_at DESC LIMIT 100',[id])
    ]);
    res.json({targetMinutes:goal.rows[0]?.target_minutes||240,doneMinutes:Math.max(0,done.rows[0]?.minutes||0),subjects:subjects.rows,tasks:tasks.rows});
  }));

  api.post('/study/goal', asyncRoute(async(req,res)=>{
    const targetMinutes=intIn(req.body?.targetMinutes,15,1440,null);
    if(targetMinutes===null)return sendError(res,400,'Goal must be 15 to 1440 minutes');
    const {rows}=await query('INSERT INTO study_goals(telegram_id,goal_day,target_minutes) VALUES($1,'+todaySql+',$2) ON CONFLICT(telegram_id,goal_day) DO UPDATE SET target_minutes=$2 RETURNING target_minutes',[req.user.id,targetMinutes]);
    res.json({targetMinutes:rows[0].target_minutes});
  }));

  api.get('/study/global-room', asyncRoute(async(req,res)=>{
    const [live,leaders,me]=await Promise.all([
      query("SELECT u.telegram_id,u.first_name,s.title AS subject,ss.started_at FROM study_sessions ss JOIN app_users u ON u.telegram_id=ss.telegram_id LEFT JOIN subjects s ON s.id=ss.subject_id WHERE ss.ended_at IS NULL AND ss.started_at>now()-interval '12 hours' AND u.show_in_global=true ORDER BY ss.started_at ASC LIMIT 100"),
      query("SELECT u.telegram_id,u.first_name,COALESCE(sum(extract(epoch from (least(coalesce(ss.ended_at,now()),ss.started_at+interval '12 hours')-ss.started_at)))/60,0)::int AS minutes FROM study_sessions ss JOIN app_users u ON u.telegram_id=ss.telegram_id WHERE u.show_in_global=true AND (ss.started_at AT TIME ZONE 'Asia/Kolkata')::date="+todaySql+" GROUP BY u.telegram_id,u.first_name ORDER BY minutes DESC LIMIT 20"),
      query('SELECT show_in_global FROM app_users WHERE telegram_id=$1',[req.user.id])
    ]);
    res.json({live:live.rows,leaders:leaders.rows,shareMyTimer:Boolean(me.rows[0]?.show_in_global)});
  }));

  api.post('/study/global-visibility', asyncRoute(async(req,res)=>{
    if(typeof req.body?.enabled!=='boolean')return sendError(res,400,'enabled must be boolean');
    await query('UPDATE app_users SET show_in_global=$2 WHERE telegram_id=$1',[req.user.id,req.body.enabled]);
    res.json({enabled:req.body.enabled});
  }));

  api.get('/study/stats/detail', asyncRoute(async(req,res)=>{
    const days=req.query.period==='month'?30:7;
    const [byDay,bySubject]=await Promise.all([
      query("SELECT to_char(started_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day,COALESCE(sum(extract(epoch from (least(coalesce(ended_at,now()),started_at+interval '12 hours')-started_at)))/60,0)::int AS minutes FROM study_sessions WHERE telegram_id=$1 AND started_at>=now()-($2::int*interval '1 day') GROUP BY 1 ORDER BY 1",[req.user.id,days]),
      query("SELECT coalesce(s.title,'Other') AS title,COALESCE(sum(extract(epoch from (least(coalesce(ss.ended_at,now()),ss.started_at+interval '12 hours')-ss.started_at)))/60,0)::int AS minutes FROM study_sessions ss LEFT JOIN subjects s ON s.id=ss.subject_id WHERE ss.telegram_id=$1 AND ss.started_at>=now()-($2::int*interval '1 day') GROUP BY s.title ORDER BY minutes DESC",[req.user.id,days])
    ]);
    res.json({period:days===7?'week':'month',byDay:byDay.rows,bySubject:bySubject.rows});
  }));

  api.get('/groups/:id/detail', asyncRoute(async(req,res)=>{
    const g=await requireMember(req.params.id,req.user.id,res);if(!g)return;
    const [counts,pin]=await Promise.all([
      query("SELECT count(*)::int AS members,count(*) FILTER (WHERE ss.id IS NOT NULL)::int AS live FROM group_members gm LEFT JOIN study_sessions ss ON ss.telegram_id=gm.telegram_id AND ss.ended_at IS NULL AND ss.started_at>now()-interval '12 hours' WHERE gm.group_id=$1",[g.id]),
      g.pinned_message_id?query('SELECT body FROM group_messages WHERE id=$1 AND group_id=$2 AND is_deleted=false',[g.pinned_message_id,g.id]):Promise.resolve({rows:[]})
    ]);
    const {invite_code, ...safe}=g;
    res.json({...safe,counts:counts.rows[0],pinnedMessage:pin.rows[0]?.body||null,inviteUrl:getBotUsername()?('https://t.me/'+getBotUsername()+'?start=grp_'+invite_code):null});
  }));

  api.get('/groups/:id/members', asyncRoute(async(req,res)=>{
    const g=await requireMember(req.params.id,req.user.id,res);if(!g)return;
    const {rows}=await query(
      "SELECT gm.telegram_id,u.first_name,gm.role,gm.muted_until,ss.started_at,CASE WHEN $3=true THEN s.title ELSE NULL END AS subject,coalesce(t.minutes,0)::int AS today_minutes FROM group_members gm JOIN app_users u ON u.telegram_id=gm.telegram_id LEFT JOIN study_sessions ss ON ss.telegram_id=gm.telegram_id AND ss.ended_at IS NULL AND ss.started_at>now()-interval '12 hours' LEFT JOIN subjects s ON s.id=ss.subject_id LEFT JOIN LATERAL (SELECT coalesce(sum(extract(epoch from (least(coalesce(z.ended_at,now()),z.started_at+interval '12 hours')-z.started_at)))/60,0)::int AS minutes FROM study_sessions z WHERE z.telegram_id=gm.telegram_id AND (z.started_at AT TIME ZONE 'Asia/Kolkata')::date="+todaySql+") t ON true WHERE gm.group_id=$1 ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'coadmin' THEN 1 ELSE 2 END,gm.joined_at LIMIT 150",
      [g.id,req.user.id,g.show_live_timers]
    );
    res.json(rows.map(r=>({...r,started_at:g.show_live_timers||r.telegram_id===req.user.id?r.started_at:null})));
  }));

  api.post('/groups/join-code', asyncRoute(async(req,res)=>{
    const code=String(req.body?.code||'').toLowerCase().trim();
    if(!codePattern.test(code))return sendError(res,400,'Enter a valid invite code');
    const {rows}=await query('SELECT id,name FROM study_groups WHERE invite_code=$1',[code]);
    if(!rows[0])return sendError(res,404,'Invite code not found');
    await query('INSERT INTO group_members(group_id,telegram_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[rows[0].id,req.user.id]);
    res.json({id:rows[0].id,name:rows[0].name});
  }));

  api.patch('/groups/:id/settings', asyncRoute(async(req,res)=>{
    const g=await requireMember(req.params.id,req.user.id,res);if(!g)return;
    if(g.role!=='owner')return sendError(res,403,'Only the group owner can change settings');
    const name=String(req.body?.name||g.name).trim();
    const visibility=req.body?.visibility||g.visibility;
    const chatMode=req.body?.chatMode||g.chat_mode;
    const goal=req.body?.targetMinutes===undefined?g.target_minutes:intIn(req.body.targetMinutes,15,1440,null);
    const slow=req.body?.slowModeSeconds===undefined?g.slow_mode_seconds:intIn(req.body.slowModeSeconds,0,3600,null);
    const show=req.body?.showLiveTimers===undefined?g.show_live_timers:req.body.showLiveTimers;
    if(name.length<3||name.length>70||!['link','public'].includes(visibility)||!['everyone','admins'].includes(chatMode)||goal===null||slow===null||typeof show!=='boolean')return sendError(res,400,'Invalid group settings');
    await query('UPDATE study_groups SET name=$2,visibility=$3,chat_mode=$4,target_minutes=$5,slow_mode_seconds=$6,show_live_timers=$7 WHERE id=$1',[g.id,name,visibility,chatMode,goal,slow,show]);
    res.json({ok:true});
  }));

  api.post('/groups/:id/members/:user/role', asyncRoute(async(req,res)=>{
    const g=await requireMember(req.params.id,req.user.id,res);if(!g)return;
    if(g.role!=='owner')return sendError(res,403,'Only owner can assign co-admins');
    const nextRole=req.body?.role;
    if(!['member','coadmin'].includes(nextRole)||req.params.user===g.owner_id)return sendError(res,400,'Invalid role change');
    const {rows}=await query('SELECT role FROM group_members WHERE group_id=$1 AND telegram_id=$2',[g.id,req.params.user]);
    if(!rows.length)return sendError(res,404,'Member not found');
    if(nextRole==='coadmin'){
      const {rows:count}=await query("SELECT count(*)::int AS n FROM group_members WHERE group_id=$1 AND role='coadmin'",[g.id]);
      if(count[0].n>=3 && rows[0].role!=='coadmin')return sendError(res,409,'Maximum 3 co-admins');
    }
    await query('UPDATE group_members SET role=$3 WHERE group_id=$1 AND telegram_id=$2',[g.id,req.params.user,nextRole]);
    res.json({ok:true,role:nextRole});
  }));

  api.post('/groups/:id/members/:user/mute', asyncRoute(async(req,res)=>{
    const g=await requireMember(req.params.id,req.user.id,res);if(!g)return;
    if(!canModerate(g))return sendError(res,403,'Only admins can mute members');
    const member=await query('SELECT role FROM group_members WHERE group_id=$1 AND telegram_id=$2',[g.id,req.params.user]);
    if(!member.rowCount)return sendError(res,404,'Member not found');
    if(member.rows[0].role==='owner'||(member.rows[0].role==='coadmin'&&g.role!=='owner'))return sendError(res,403,'Cannot mute this admin');
    const mins=intIn(req.body?.minutes,0,1440,null);if(mins===null)return sendError(res,400,'Invalid mute duration');
    await query('UPDATE group_members SET muted_until=CASE WHEN $3::int=0 THEN NULL ELSE now()+($3::int*interval \'1 minute\') END WHERE group_id=$1 AND telegram_id=$2',[g.id,req.params.user,mins]);
    res.json({ok:true});
  }));

  api.post('/groups/:id/messages/:messageId/pin', asyncRoute(async(req,res)=>{
    const g=await requireMember(req.params.id,req.user.id,res);if(!g)return;
    if(!canModerate(g))return sendError(res,403,'Only admins can pin messages');
    const {rows}=await query('SELECT id FROM group_messages WHERE id=$1 AND group_id=$2 AND is_deleted=false',[req.params.messageId,g.id]);
    if(!rows[0])return sendError(res,404,'Message not found');
    await query('UPDATE study_groups SET pinned_message_id=$2 WHERE id=$1',[g.id,rows[0].id]);
    res.json({ok:true});
  }));

  api.post('/groups/:id/messages/:messageId/delete', asyncRoute(async(req,res)=>{
    const g=await requireMember(req.params.id,req.user.id,res);if(!g)return;
    const {rows}=await query('SELECT sender_id FROM group_messages WHERE id=$1 AND group_id=$2',[req.params.messageId,g.id]);
    if(!rows[0])return sendError(res,404,'Message not found');
    if(rows[0].sender_id!==req.user.id&&!canModerate(g))return sendError(res,403,'Not permitted');
    await query('UPDATE group_messages SET is_deleted=true,body=$3 WHERE id=$1 AND group_id=$2',[req.params.messageId,g.id,'[deleted]']);
    await query('UPDATE study_groups SET pinned_message_id=NULL WHERE id=$1 AND pinned_message_id=$2',[g.id,req.params.messageId]);
    res.json({ok:true});
  }));
}

module.exports={mountV2Features};
