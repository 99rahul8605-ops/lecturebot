'use strict';
/* EduBot reference-style study UI. All displayed users, groups and timers
   come from authenticated V2 APIs; no prefilled showcase members. */
const v2={groupId:null,group:null,groupMembers:[],groupTab:'timers',roomTab:'live',statsPeriod:'week',subjectId:null,roomData:null};
const v2e=id=>document.getElementById(id);
const v2fmt=m=>{m=Math.max(0,Number(m)||0);return Math.floor(m/60)+'h '+String(Math.floor(m%60)).padStart(2,'0')+'m'};
const v2clock=start=>{if(!start)return '--:--:--';let s=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':')};
const v2esc=escapeHtml;
const v2call=async(fn)=>{try{return await fn()}catch(e){toast(e.message);throw e}};
const v2initials=name=>String(name||'?').trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
function v2SwitchGroupTab(tab){v2.groupTab=tab;document.querySelectorAll('[data-grouptab]').forEach(x=>x.classList.toggle('active',x.dataset.grouptab===tab));v2e('v2GroupTimers').classList.toggle('hidden',tab!=='timers');v2e('v2GroupChat').classList.toggle('hidden',tab!=='chat');if(tab==='chat')v2LoadChat().catch(e=>toast(e.message))}
function v2MemberHtml(m,ownId){const isMe=String(m.telegram_id)===String(ownId);return '<div class="v2-member '+(isMe?'me':'')+'"><span class="v2-avatar">'+v2esc(v2initials(m.first_name))+'</span><span class="v2-name"><b>'+v2esc(isMe?'You':(m.first_name||'Student'))+(m.role==='owner'?' <span class="v2-role">ADMIN</span>':m.role==='coadmin'?' <span class="v2-role">CO-ADMIN</span>':'')+'</b><small>'+v2esc(m.subject||(!m.started_at?'Offline':'Focusing'))+'</small></span><span class="v2-clock">'+(m.started_at?v2clock(m.started_at):v2fmt(m.today_minutes))+'</span></div>'}
function v2Share(url){if(!url)return toast('Share link unavailable');const share='https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+encodeURIComponent('Join my EduBot study group');if(tg?.openTelegramLink)tg.openTelegramLink(share);else window.open(share,'_blank','noopener')}
async function v2LoadGroups(){
 const [groups,room]=await Promise.all([api('/groups'),api('/study/global-room')]);
 v2e('v2GlobalLive').textContent=room.live.length+' live ↗';
 const mine=groups.filter(x=>x.joined);const discover=groups.filter(x=>!x.joined);
 const render=g=>'<button type="button" class="v2-group-card" data-v2group="'+v2esc(g.id)+'" data-joined="'+(g.joined?'1':'0')+'"><span class="v2-avatar">'+v2esc(v2initials(g.name))+'</span><span class="v2-name"><b>'+v2esc(g.name)+'</b><small>'+g.members+' members · '+g.live+' live</small></span><strong>↗</strong></button>';
 v2e('v2GroupList').innerHTML=(mine.length?mine.map(render).join(''):'<div class="empty">Abhi koi group join nahi kiya. Naya group banao!</div>')+(discover.length?'<div class="section-heading"><h2>Discover public groups</h2></div>'+discover.map(render).join(''):'');
}
async function v2LoadGlobal(){
 const data=await api('/study/global-room');v2.roomData=data;
 v2e('v2LiveCount').textContent=data.live.length+' live';v2e('v2RoomShare').checked=data.shareMyTimer;
 const me=data.live.find(x=>String(x.telegram_id)===String(state.userId));
 v2e('v2GlobalSelf').textContent=me?'● You are live · '+(me.subject||'Studying')+' · '+v2clock(me.started_at):'Start Study Timer to join. Enable “Share my live timer” to appear here.';
 document.querySelectorAll('[data-roomtab]').forEach(x=>x.classList.toggle('active',x.dataset.roomtab===v2.roomTab));
 const items=v2.roomTab==='top'?data.leaders:data.live;
 v2e('v2GlobalList').innerHTML=items.length?items.map(m=>'<div class="v2-member"><span class="v2-avatar">'+v2esc(v2initials(m.first_name))+'</span><span class="v2-name"><b>'+v2esc(String(m.telegram_id)===String(state.userId)?'You':(m.first_name||'Student'))+'</b><small>'+v2esc(v2.roomTab==='top'?'Today':(m.subject||'Studying'))+'</small></span><span class="v2-clock">'+(v2.roomTab==='top'?v2fmt(m.minutes):v2clock(m.started_at))+'</span></div>').join(''):'<div class="empty">Abhi koi student is list mein nahi hai.</div>';
}
async function v2LoadDetail(){
 if(!v2.groupId){setPage('groups');return}
 const [g,members]=await Promise.all([api('/groups/'+v2.groupId+'/detail'),api('/groups/'+v2.groupId+'/members')]);
 v2.group=g;v2.groupMembers=members;
 v2e('v2GroupTitle').textContent=g.name;v2e('v2GroupMeta').textContent=g.counts.members+' members · '+g.counts.live+' live';
 const isAdmin=['owner','coadmin'].includes(g.role);v2e('v2ManageGroupBtn').classList.toggle('hidden',g.role!=='owner');
 let total=members.reduce((s,m)=>s+Number(m.today_minutes||0),0),goal=Number(g.target_minutes||180)*members.length;
 v2e('v2GroupGoal').textContent=v2fmt(total)+' / '+v2fmt(goal);
 v2e('v2GroupGoalBar').style.width=Math.min(100,goal?100*total/goal:0)+'%';
 v2e('v2GroupMembers').innerHTML=members.map(m=>v2MemberHtml(m,state.userId)).join('');
 v2e('v2GroupInvite').disabled=!g.inviteUrl;v2e('v2GroupInvite').dataset.invite=g.inviteUrl||'';
 v2e('v2GroupPinned').classList.toggle('hidden',!g.pinnedMessage);
 v2e('v2GroupPinned').textContent='📌 Pinned: '+(g.pinnedMessage||'');
 v2e('v2ChatHint').textContent=g.chat_mode==='admins'?'Admins-only chat':(g.slow_mode_seconds?'Slow mode: '+g.slow_mode_seconds+' seconds':'');
 v2e('v2ChatInput').disabled=g.chat_mode==='admins'&&!isAdmin;
 v2SwitchGroupTab(v2.groupTab);
}
async function v2LoadChat(){
 if(!v2.groupId)return;const messages=await api('/groups/'+v2.groupId+'/messages');
 v2e('v2ChatMessages').innerHTML=messages.length?messages.map(m=>{const own=String(m.sender_id)===String(state.userId);const actions=m.is_deleted?'':('<div class="v2-msg-controls">'+(own||['owner','coadmin'].includes(v2.group?.role)?'<button type="button" data-v2del="'+m.id+'">Delete</button>':'')+(['owner','coadmin'].includes(v2.group?.role)?'<button type="button" data-v2pin="'+m.id+'">Pin</button>':'')+'</div>');return '<div class="v2-msg '+(own?'me':'')+'"><small>'+v2esc(m.first_name||'Student')+' · '+new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'</small><p>'+v2esc(m.is_deleted?'[deleted]':m.body)+'</p>'+actions+'</div>'}).join(''):'<div class="empty">No messages yet. Say hello!</div>';
 v2e('v2ChatMessages').scrollTop=v2e('v2ChatMessages').scrollHeight;
}
async function v2LoadManage(){
 const g=v2.group;if(!g||g.role!=='owner'){setPage('groups');return}
 v2e('v2ManageGroupName').textContent=g.name;
 v2e('v2ManageName').value=g.name;v2e('v2ManageVisibility').value=g.visibility;
 v2e('v2ManageChatMode').value=g.chat_mode;v2e('v2ManageSlowMode').value=String(g.slow_mode_seconds);
 v2e('v2ManageGoal').value=g.target_minutes;v2e('v2ManageTimers').checked=g.show_live_timers;
 v2e('v2ManageMembers').innerHTML=v2.groupMembers.map(m=>'<div class="v2-member"><span class="v2-avatar">'+v2esc(v2initials(m.first_name))+'</span><span class="v2-name"><b>'+v2esc(m.first_name||'Student')+'</b><small>'+v2esc(m.role)+'</small></span>'+(m.role==='owner'?'':('<button type="button" data-v2role="'+v2esc(m.telegram_id)+'" data-role="'+(m.role==='coadmin'?'member':'coadmin')+'">'+(m.role==='coadmin'?'Remove role':'Make co-admin')+'</button>'))+'</div>').join('');
}
async function v2LoadPlan(){
 const r=await api('/study/plan');v2e('v2PlanPct').textContent=Math.min(100,Math.floor(r.doneMinutes/r.targetMinutes*100))+'%';
 v2e('v2PlanTarget').textContent=v2fmt(r.targetMinutes);
 v2e('v2PlanDone').textContent=v2fmt(r.doneMinutes)+' done · '+v2fmt(Math.max(0,r.targetMinutes-r.doneMinutes))+' baaki';
 v2e('v2PlanBar').style.width=Math.min(100,r.doneMinutes/r.targetMinutes*100)+'%';
 v2e('v2PlanSubjects').innerHTML=r.subjects.length?r.subjects.map(s=>'<div class="v2-member"><span class="v2-avatar">📚</span><span class="v2-name"><b>'+v2esc(s.title)+'</b></span><strong>'+v2fmt(s.minutes)+'</strong></div>').join(''):'<div class="empty">Aaj abhi study time record nahi hua.</div>';
 v2e('v2PlanTasks').innerHTML=r.tasks.length?r.tasks.map(t=>'<label class="task-row"><input type="checkbox" data-v2task="'+t.id+'" '+(t.is_done?'checked':'')+'><span '+(t.is_done?'style="text-decoration:line-through"':'')+'>'+v2esc(t.title)+'</span></label>').join(''):'<div class="empty">Add your first task.</div>';
}
async function v2LoadPick(){
 const subjects=await api('/study/subjects');v2.subjectId=subjects[0]?.id||null;
 v2e('v2SubjectChoices').innerHTML=subjects.map((s,i)=>'<button type="button" class="v2-subject-choice '+(i===0?'active':'')+'" data-v2subject="'+v2esc(s.id)+'"><span class="dot"></span><b>'+v2esc(s.title)+'</b></button>').join('')+'<button type="button" class="v2-subject-choice" data-v2subject="">No subject · General study</button>';
}
async function v2LoadStats(){
 const r=await api('/study/stats/detail?period='+v2.statsPeriod);
 let total=r.byDay.reduce((s,x)=>s+Number(x.minutes),0),best=[...r.byDay].sort((a,b)=>b.minutes-a.minutes)[0];
 v2e('v2StatsSummary').innerHTML='<div><small>Total</small><b>'+v2fmt(total)+'</b></div><div><small>Daily avg</small><b>'+v2fmt(total/(v2.statsPeriod==='week'?7:30))+'</b></div><div><small>Best day</small><b>'+(best?v2esc(best.day.slice(5)):'—')+'</b></div>';
 const days=[];for(let i=(v2.statsPeriod==='week'?6:13);i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const day=d.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});days.push({day,minutes:Number(r.byDay.find(x=>x.day===day)?.minutes||0)})}
 const top=Math.max(240,...days.map(x=>x.minutes));
 v2e('v2StatsChart').innerHTML=days.map(d=>'<div><div class="v2-bar" title="'+v2fmt(d.minutes)+'" style="height:'+Math.max(2,118*d.minutes/top)+'px"></div><small>'+v2esc(d.day.slice(-2))+'</small></div>').join('');
 const max=Math.max(1,...r.bySubject.map(x=>x.minutes));
 v2e('v2StatsSubjects').innerHTML=r.bySubject.length?r.bySubject.map(s=>'<div class="v2-subject-row"><header><b>'+v2esc(s.title)+'</b><b>'+v2fmt(s.minutes)+'</b></header><div class="v2-subject-bar"><i style="width:'+Math.max(0,s.minutes/max*100)+'%"></i></div></div>').join(''):'<div class="empty">No study sessions recorded yet.</div>';
 document.querySelectorAll('[data-statsperiod]').forEach(x=>x.classList.toggle('active',x.dataset.statsperiod===v2.statsPeriod));
}
async function v2Load(page){if(page==='groups')return v2LoadGroups();if(page==='global-room')return v2LoadGlobal();if(page==='group-detail')return v2LoadDetail();if(page==='manage-group')return v2LoadManage();if(page==='study-plan')return v2LoadPlan();if(page==='study-pick')return v2LoadPick();if(page==='study-stats')return v2LoadStats();}

document.addEventListener('click',async e=>{
 const open=e.target.closest('[data-v2group]');
 if(open){const id=open.dataset.v2group;try{if(open.dataset.joined==='0')await api('/groups/'+id+'/join',{method:'POST',body:'{}'});v2.groupId=id;v2.groupTab='timers';setPage('group-detail')}catch(err){toast(err.message)}return}
 const subject=e.target.closest('[data-v2subject]');if(subject){v2.subjectId=subject.dataset.v2subject||null;document.querySelectorAll('[data-v2subject]').forEach(x=>x.classList.toggle('active',x===subject));return}
 const groupTab=e.target.closest('[data-grouptab]');if(groupTab){v2SwitchGroupTab(groupTab.dataset.grouptab);return}
 const roomTab=e.target.closest('[data-roomtab]');if(roomTab){v2.roomTab=roomTab.dataset.roomtab;v2LoadGlobal().catch(err=>toast(err.message));return}
 const stats=e.target.closest('[data-statsperiod]');if(stats){v2.statsPeriod=stats.dataset.statsperiod;v2LoadStats().catch(err=>toast(err.message));return}
 const role=e.target.closest('[data-v2role]');if(role){try{await api('/groups/'+v2.groupId+'/members/'+encodeURIComponent(role.dataset.v2role)+'/role',{method:'POST',body:JSON.stringify({role:role.dataset.role})});await v2LoadDetail();await v2LoadManage();toast('Role updated')}catch(err){toast(err.message)}return}
 const del=e.target.closest('[data-v2del]');if(del){if(!confirm('Delete this message?'))return;try{await api('/groups/'+v2.groupId+'/messages/'+del.dataset.v2del+'/delete',{method:'POST',body:'{}'});await v2LoadChat()}catch(err){toast(err.message)}return}
 const pin=e.target.closest('[data-v2pin]');if(pin){try{await api('/groups/'+v2.groupId+'/messages/'+pin.dataset.v2pin+'/pin',{method:'POST',body:'{}'});await v2LoadDetail();toast('Message pinned')}catch(err){toast(err.message)}return}
});
v2e('v2ManageGroupBtn').onclick=()=>setPage('manage-group');
v2e('v2GroupInvite').onclick=()=>v2Share(v2e('v2GroupInvite').dataset.invite);
v2e('v2JoinForm').onsubmit=async e=>{e.preventDefault();try{const r=await api('/groups/join-code',{method:'POST',body:JSON.stringify({code:v2e('v2JoinCode').value.trim()})});v2.groupId=r.id;v2.groupTab='timers';setPage('group-detail');toast('Group joined')}catch(err){toast(err.message)}};
v2e('v2NewGroupForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));data.targetMinutes=Number(data.targetMinutes);data.showLiveTimers=form.elements.showLiveTimers.checked;try{const r=await api('/groups',{method:'POST',body:JSON.stringify(data)});v2.groupId=r.id;v2.groupTab='timers';form.reset();setPage('group-detail');toast('Group created')}catch(err){toast(err.message)}};
v2e('v2ManageForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const data=Object.fromEntries(new FormData(form));data.targetMinutes=Number(data.targetMinutes);data.slowModeSeconds=Number(data.slowModeSeconds);data.showLiveTimers=form.elements.showLiveTimers.checked;try{await api('/groups/'+v2.groupId+'/settings',{method:'PATCH',body:JSON.stringify(data)});await v2LoadDetail();toast('Settings saved')}catch(err){toast(err.message)}};
v2e('v2RoomShare').onchange=async e=>{const value=e.target.checked;try{await api('/study/global-visibility',{method:'POST',body:JSON.stringify({enabled:value})});await v2LoadGlobal()}catch(err){e.target.checked=!value;toast(err.message)}};
v2e('v2ChatForm').onsubmit=async e=>{e.preventDefault();const input=v2e('v2ChatInput');try{await api('/groups/'+v2.groupId+'/messages',{method:'POST',body:JSON.stringify({body:input.value})});input.value='';await v2LoadChat()}catch(err){toast(err.message)}};
v2e('v2PlanTaskForm').onsubmit=async e=>{e.preventDefault();try{await api('/tasks',{method:'POST',body:JSON.stringify({title:v2e('v2PlanTaskInput').value})});v2e('v2PlanTaskInput').value='';await v2LoadPlan()}catch(err){toast(err.message)}};
v2e('v2PlanTasks').onchange=async e=>{const id=e.target.dataset.v2task;if(!id)return;try{await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify({isDone:e.target.checked})});await v2LoadPlan()}catch(err){toast(err.message)}};
v2e('v2EditGoal').onclick=async()=>{const hours=prompt('Daily study goal (hours, 0.25 to 24):','4');if(hours===null)return;const mins=Math.round(Number(hours)*60);if(!Number.isFinite(mins)||mins<15||mins>1440)return toast('Choose between 0.25 and 24 hours');try{await api('/study/goal',{method:'POST',body:JSON.stringify({targetMinutes:mins})});await v2LoadPlan()}catch(err){toast(err.message)}};
v2e('v2StartFocus').onclick=async()=>{try{const r=await api('/study/start',{method:'POST',body:JSON.stringify({subjectId:v2.subjectId})});setStudy(r.started_at);setPage('study');toast('Focus session started')}catch(err){toast(err.message)}};
// Old primary button launches the reference subject picker instead of starting an untagged timer.
v2e('studyStart').onclick=()=>setPage('study-pick');
// Keep full group UI refreshed when realtime messages arrive.
setInterval(()=>{if(state.page==='group-detail'&&v2.groupTab==='timers')v2LoadDetail().catch(()=>{});if(state.page==='global-room')v2LoadGlobal().catch(()=>{})},20000);
