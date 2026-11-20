/**
 * study-social.js — Groups, Global Room, group timers + chat, admin/co-admin tools.
 * Extends window.Study (see study.js). Backend: /api/study/groups*, /live, /leaderboard
 */
(function () {
  var S = window.Study, $ = S.$, esc = S.esc, ACT = S.ACT;
  var SO = S.social = {};
  var GCOL = ['#FFD9C2', '#CDEBDD', '#DCD6F7', '#CFE6F5', '#D4F25C'];
  var RANK = { admin: 3, coadmin: 2, member: 1 };
  var G = null;                                  // currently open group {id, meta, members, role}

  function body() { return $('stBody'); }
  function role(r) { return r === 'admin' ? '<span class="st-role st-role-a">ADMIN</span>' : r === 'coadmin' ? '<span class="st-role st-role-c">CO-ADMIN</span>' : ''; }
  function av(name, size) { return '<span class="st-av" style="background:' + S.avatarColor(name) + ';' + (size ? 'width:' + size + 'px;height:' + size + 'px' : '') + '">' + S.initial(name) + '</span>'; }
  function back(act, label) { return '<button class="st-back" data-act="' + act + '" aria-label="' + (label || 'Back') + '"><i class="ti ti-chevron-left"></i></button>'; }
  function copy(text, okMsg) {
    function fallback() { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); S.say(okMsg || 'Copied'); } catch (_) { S.say('Copy failed', 'error'); } document.body.removeChild(t); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { S.say(okMsg || 'Copied'); }, fallback); else fallback();
  }
  function statusDot(st) { return '<i class="st-sdot ' + (st === 'focus' ? 'g' : st === 'offline' ? 'o' : 'y') + '"></i>'; }

  // 1-second visual tick for running timers (values come from the server every few seconds)
  var fetchedAt = 0;
  function startTimerTick() {
    S.polls.push(setInterval(function () {
      var els = document.querySelectorAll('[data-live="focus"]');
      var add = (Date.now() - fetchedAt) / 1000;
      for (var i = 0; i < els.length; i++) els[i].textContent = S.hms(+els[i].getAttribute('data-sec') + add);
    }, 1000));
  }

  // ═════════════════════════ GROUPS LIST ═════════════════════════
  SO.groups = async function () {
    body().innerHTML = '<div class="st-empty">Loading\u2026</div>';
    try {
      var d = await S.api('/groups');
      var h = '<div class="st-row st-between"><div class="st-lbl" style="margin:0">Study groups</div><button class="st-btn-acc" data-act="newGroup"><i class="ti ti-plus"></i>Create</button></div>' +
        '<div class="st-join"><input id="joinCode" maxlength="16" autocapitalize="characters" placeholder="Invite code" aria-label="Invite code"><button data-act="joinByCode">Join</button></div>' +
        '<button class="st-gcard st-dark" data-act="goRoom"><span class="st-gic" style="background:var(--accent);color:#fff"><i class="ti ti-world"></i></span><span class="st-grow"><b>Global Room</b><small>All students \u00b7 you are in automatically</small></span><span class="st-livepill"><i></i>' + d.global.liveCount + ' live</span></button>' +
        '<div class="st-lbl">My groups</div>';
      h += d.groups.length ? d.groups.map(function (g) {
        return '<button class="st-gcard" data-act="openGroup" data-id="' + g.id + '"><span class="st-gic" style="background:' + esc(g.color) + ';color:#17150F">' + esc(g.name.slice(0, 2).toUpperCase()) + '</span>' +
          '<span class="st-grow"><b>' + esc(g.name) + '</b><small>' + g.memberCount + ' members' + (g.top ? ' \u00b7 Top: ' + esc(g.top.name) + ' ' + S.dur(g.top.sec) : '') + '</small></span>' +
          (g.liveCount ? '<span class="st-livepill"><i></i>' + g.liveCount + ' live</span>' : '<span class="st-muted">quiet</span>') + '</button>';
      }).join('') : '<div class="st-empty">You are not in any group yet. Create one, or join with an invite code.</div>';
      body().innerHTML = h;
    } catch (e) { body().innerHTML = '<div class="st-empty">' + esc(S.err(e)) + '</div>'; }
  };
  ACT.openGroup = function (el) { S.go('group', { id: el.getAttribute('data-id'), view: 'timers' }); };
  ACT.goRoom = function () { S.go('room'); };

  ACT.joinByCode = function () { var c = $('joinCode').value.trim(); if (c) SO.joinPreview(c); };
  SO.joinPreview = async function (code) {
    try {
      var p = await S.api('/groups/preview/' + encodeURIComponent(code.toUpperCase()));
      if (p.joined) { S.say('You are already in ' + p.name); return; }
      S.sheet('<div class="st-center"><span class="st-gic st-gic-lg" style="background:' + esc(p.color) + ';color:#17150F">' + esc(p.name.slice(0, 2).toUpperCase()) + '</span><h2 class="st-h2">' + esc(p.name) + '</h2><p class="st-muted">' + p.memberCount + ' members</p></div>' +
        '<button class="st-cta" data-act="joinConfirm" data-code="' + esc(code.toUpperCase()) + '">Join group</button>');
    } catch (e) { S.say(S.err(e), 'error'); }
  };
  ACT.joinConfirm = async function (el) {
    try { var r = await S.api('/groups/join', 'POST', { code: el.getAttribute('data-code') }); S.closeSheet(); S.go('group', { id: r.group.id, view: 'timers' }); }
    catch (e) { S.say(S.err(e), 'error'); }
  };

  // ── create group ──
  var nd = {};
  ACT.newGroup = function () {
    nd = { color: GCOL[0], joinType: 'invite', showTimers: true };
    S.sheet('<h2 class="st-h2">New group</h2><label class="st-field"><span>Group name</span><input id="gName" maxlength="40" placeholder="e.g. CA Inter Warriors"></label>' +
      '<div class="st-swatches" id="gSw">' + GCOL.map(function (c) { return '<button class="' + (c === nd.color ? 'on' : '') + '" style="background:' + c + '" data-act="gColor" data-c="' + c + '" aria-label="Colour"></button>'; }).join('') + '</div>' +
      '<div class="st-lbl">Who can invite</div><div class="st-seg st-seg-sm" id="gJoin"><button class="on" data-act="gJoin" data-v="invite">Only admins</button><button data-act="gJoin" data-v="link">Any member</button></div>' +
      '<label class="st-field"><span>Group daily goal (hours, whole group)</span><input id="gGoal" type="number" inputmode="decimal" min="0" max="1000" value="12"></label>' +
      '<label class="st-toggle"><span><b>Show live timers</b><small>Members can see each other\'s timers</small></span><input id="gShow" type="checkbox" checked></label>' +
      '<button class="st-cta" data-act="createGroup">Create group</button>');
  };
  ACT.gColor = function (el) { nd.color = el.getAttribute('data-c'); var b = $('gSw').children; for (var i = 0; i < b.length; i++) b[i].classList.toggle('on', b[i] === el); };
  ACT.gJoin = function (el) { nd.joinType = el.getAttribute('data-v'); var b = $('gJoin').children; for (var i = 0; i < b.length; i++) b[i].classList.toggle('on', b[i] === el); };
  ACT.createGroup = async function () {
    try {
      var r = await S.api('/groups', 'POST', { name: $('gName').value, color: nd.color, joinType: nd.joinType, dailyGoalMin: Math.round((+$('gGoal').value || 0) * 60), showTimers: $('gShow').checked });
      SO.inviteSheet(r.group, true);
    } catch (e) { S.say(S.err(e), 'error'); }
  };
  SO.inviteSheet = function (g, created) {
    if (!g.inviteLink && !g.inviteCode) { S.say('Only admins can invite to this group', 'error'); return; }
    S.sheet('<h2 class="st-h2">' + (created ? 'Group created' : 'Invite friends') + '</h2><p class="st-muted">Share this link. People who open it can join ' + esc(g.name) + '.</p>' +
      '<div class="st-copybox"><span id="invLink">' + esc(g.inviteLink || g.inviteCode) + '</span><button data-act="copyInvite" data-t="' + esc(g.inviteLink || g.inviteCode) + '">Copy</button></div>' +
      '<div class="st-muted" style="margin:8px 0">Invite code: <b>' + esc(g.inviteCode || '') + '</b></div>' +
      '<button class="st-cta" data-act="shareInvite" data-t="' + esc(g.inviteLink || g.inviteCode) + '" data-n="' + esc(g.name) + '"><i class="ti ti-brand-telegram"></i>Share on Telegram</button>' +
      (created ? '<button class="st-cta st-ghostbtn" data-act="openGroup" data-id="' + g.id + '">Open group</button>' : ''));
  };
  ACT.copyInvite = function (el) { copy(el.getAttribute('data-t'), 'Invite link copied'); };
  ACT.shareInvite = function (el) {
    var url = 'https://t.me/share/url?url=' + encodeURIComponent(el.getAttribute('data-t')) + '&text=' + encodeURIComponent('Join my study group "' + el.getAttribute('data-n') + '" and study together!');
    try { Telegram.WebApp.openTelegramLink(url); } catch (_) { window.open(url, '_blank'); }
  };

  // ═════════════════════════ GLOBAL ROOM ═════════════════════════
  var roomTab = 'live';
  SO.room = function () {
    body().innerHTML = '<div class="st-row"><button class="st-back" data-act="backGroups" aria-label="Back"><i class="ti ti-chevron-left"></i></button><div class="st-grow"><div class="st-muted">Study together</div><h2 class="st-h2" style="margin:0">Global Room</h2></div><span class="st-livepill" id="rmCount"><i></i>\u2026</span></div>' +
      '<div class="st-seg st-seg-sm"><button data-act="roomTab" data-t="live" class="' + (roomTab === 'live' ? 'on' : '') + '">Live now</button><button data-act="roomTab" data-t="top" class="' + (roomTab === 'top' ? 'on' : '') + '">Today\'s top</button></div><div id="rmBody"></div>';
    if (roomTab === 'live') { S.poll(loadLive, 8000); startTimerTick(); } else S.poll(loadTop, 30000);
  };
  ACT.backGroups = function () { S.go('groups'); };
  ACT.roomTab = function (el) { roomTab = el.getAttribute('data-t'); S.go('room'); };

  async function loadLive() {
    try {
      var d = await S.api('/live'); fetchedAt = Date.now();
      if (!$('rmBody')) return;
      $('rmCount').innerHTML = '<i></i>' + d.count + ' live';
      $('rmBody').innerHTML = (S.T.phase !== 'idle' ? '<div class="st-you"><i class="st-sdot g"></i><div class="st-grow"><b>You are live</b><small>Your timer is visible here</small></div></div>' : '') +
        (d.items.length ? '<div class="st-list">' + d.items.map(function (i) {
          var st = i.status === 'focus' ? 'focus' : 'break';
          return '<div class="st-mem ' + (i.mine ? 'me' : '') + '">' + av(i.name) + '<div class="st-grow"><b>' + esc(i.mine ? i.name + ' (you)' : i.name) + '</b><small>' + (st === 'break' ? (i.status === 'break' ? 'On break' : 'Paused') : esc(i.subjectName || 'Studying')) + '</small></div>' +
            '<span class="st-t">' + statusDot(st) + '<span data-live="' + st + '" data-sec="' + i.sec + '">' + S.hms(i.sec) + '</span></span></div>';
        }).join('') + '</div>' : '<div class="st-empty">Nobody is studying right now. Start a timer and be the first!</div>');
    } catch (e) { if ($('rmBody')) $('rmBody').innerHTML = '<div class="st-empty">' + esc(S.err(e)) + '</div>'; }
  }
  async function loadTop() {
    try {
      var d = await S.api('/leaderboard');
      if (!$('rmBody')) return;
      $('rmCount').innerHTML = '<i class="ti ti-trophy" style="font-style:normal"></i> top 20';
      $('rmBody').innerHTML = d.items.length ? '<div class="st-list">' + d.items.map(function (i) {
        return '<div class="st-mem ' + (i.mine ? 'me' : '') + '"><span class="st-rank">' + i.rank + '</span><div class="st-grow"><b>' + esc(i.name) + (i.mine ? ' (you)' : '') + '</b></div><span class="st-t">' + S.dur(i.sec) + '</span></div>';
      }).join('') + '</div>' : '<div class="st-empty">No study time logged yet today.</div>';
    } catch (e) { if ($('rmBody')) $('rmBody').innerHTML = '<div class="st-empty">' + esc(S.err(e)) + '</div>'; }
  }

  // ═════════════════════════ GROUP (timers + chat) ═════════════════════════
  function header(g, isMod) {
    return '<div class="st-row">' + back('backGroups') + '<span class="st-gic" style="background:' + esc(g.color) + ';color:#17150F;width:40px;height:40px;font-size:14px">' + esc(g.name.slice(0, 2).toUpperCase()) + '</span>' +
      '<div class="st-grow"><h2 class="st-h2" style="margin:0">' + esc(g.name) + '</h2><div class="st-muted" id="gSub"></div></div>' +
      '<button class="st-back" data-act="invite" aria-label="Invite"><i class="ti ti-user-plus"></i></button>' +
      (isMod ? '<button class="st-back" data-act="manage" aria-label="Manage group"><i class="ti ti-settings"></i></button>' : '') + '</div>';
  }
  SO.group = function (arg) {
    G = { id: arg.id, view: arg.view || 'timers', meta: null, members: [], cursor: null, msgs: [] };
    body().innerHTML = '<div class="st-empty">Loading\u2026</div>';
    loadGroup(true);
  };
  async function loadGroup(first) {
    try {
      var d = await S.api('/groups/' + G.id);
      G.meta = d.group; G.members = d.members; G.role = d.group.role; fetchedAt = Date.now();
      var isMod = G.role === 'admin' || G.role === 'coadmin';
      if (first) {
        body().innerHTML = header(d.group, isMod) +
          '<div class="st-seg st-seg-sm"><button data-act="gView" data-v="timers" class="' + (G.view === 'timers' ? 'on' : '') + '">Timers</button><button data-act="gView" data-v="chat" class="' + (G.view === 'chat' ? 'on' : '') + '">Chat</button></div><div id="gBody"></div>';
        if (G.view === 'chat') startChat(); else { S.poll(function () { if (G.view === 'timers') loadGroup(false); }, 8000); startTimerTick(); }
      }
      $('gSub').textContent = d.group.memberCount + ' members \u00b7 ' + d.liveCount + ' live';
      if (G.view === 'timers') paintTimers(d);
    } catch (e) { body().innerHTML = '<div class="st-empty">' + esc(S.err(e)) + '</div><button class="st-cta st-ghostbtn" data-act="backGroups">Back</button>'; }
  }
  function paintTimers(d) {
    var g = d.group, goal = d.goal, pct = goal.doneSec != null && goal.goalSec ? Math.min(100, Math.round(goal.doneSec / goal.goalSec * 100)) : null;
    var h = '';
    if (pct != null) h += '<div class="st-card st-dark st-vcard"><div class="st-row st-between"><span class="st-eyebrow">GROUP GOAL TODAY</span><span class="st-muted">' + S.dur(goal.doneSec) + ' / ' + S.dur(goal.goalSec) + '</span></div><div class="st-bar st-bar-d"><div style="width:' + pct + '%"></div></div></div>';
    if (g.pinned) h += '<div class="st-pinned"><i class="ti ti-pin"></i><span>' + esc(g.pinned.text) + '</span></div>';
    h += '<div class="st-list">' + d.members.map(function (m) {
      var st = m.status === 'focus' ? 'focus' : m.status === 'offline' || m.status === undefined ? 'offline' : 'break';
      var sub = m.live === undefined ? '' : st === 'offline' ? 'Offline \u00b7 today ' + S.dur(m.todaySec) : st === 'break' ? (m.status === 'break' ? 'On break' : 'Paused') : esc(m.subjectName || 'Studying');
      return '<div class="st-mem ' + (m.self ? 'me' : '') + (st === 'offline' ? ' off' : '') + '">' + av(m.name) + '<div class="st-grow"><b>' + esc(m.self ? m.name + ' (you)' : m.name) + '</b>' + role(m.role) + (m.muted ? '<span class="st-role">MUTED</span>' : '') + '<small>' + sub + '</small></div>' +
        (m.live === undefined ? '' : '<span class="st-t">' + statusDot(st) + (st === 'offline' ? '<span>--:--:--</span>' : '<span data-live="' + st + '" data-sec="' + m.liveSec + '">' + S.hms(m.liveSec) + '</span>') + '</span>') + '</div>';
    }).join('') + '</div>';
    $('gBody').innerHTML = h;
  }
  ACT.gView = function (el) {
    var v = el.getAttribute('data-v'); if (G.view === v) return;
    S.go('group', { id: G.id, view: v });
  };
  ACT.invite = function () { SO.inviteSheet(G.meta, false); };
  ACT.manage = function () { S.go('manage', { id: G.id }); };

  // ── chat ──
  function startChat() {
    $('gBody').innerHTML = '<div id="gPin"></div><div class="st-chat" id="gChat"></div><div class="st-compose" id="gCompose"></div>';
    G.cursor = null; G.msgs = [];
    S.poll(loadMsgs, 4000);
    S.polls.push(setInterval(function () { if (G.view === 'chat') loadGroupMetaQuiet(); }, 20000));
  }
  async function loadGroupMetaQuiet() { try { var d = await S.api('/groups/' + G.id); G.meta = d.group; G.members = d.members; G.role = d.group.role; } catch (_) {} }
  var busy = false;
  async function loadMsgs() {
    if (busy || G.view !== 'chat') return; busy = true;
    try {
      var d = await S.api('/groups/' + G.id + '/messages?limit=60' + (G.cursor ? '&after=' + G.cursor : ''));
      var box = $('gChat'); if (!box) return;
      var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80 || !G.cursor;
      if (d.items.length) { G.msgs = G.cursor ? G.msgs.concat(d.items) : d.items; G.cursor = G.msgs[G.msgs.length - 1].id; paintChat(); if (atBottom) box.scrollTop = box.scrollHeight; }
      $('gPin').innerHTML = d.pinned ? '<div class="st-pinned"><i class="ti ti-pin"></i><span>' + esc(d.pinned.text) + '</span></div>' : '';
      var c = $('gCompose');
      c.innerHTML = d.canPost
        ? '<input id="gMsg" maxlength="500" placeholder="Write a message\u2026" aria-label="Message"><button data-act="sendMsg" aria-label="Send"><i class="ti ti-send"></i></button>'
        : '<div class="st-muted st-center">' + (d.mutedUntil ? 'You are muted in this group for now.' : 'Only admins can chat right now.') + '</div>';
      if (!c.getAttribute('data-bound') && $('gMsg')) { c.setAttribute('data-bound', '1'); }
    } catch (e) { /* transient; next poll retries */ } finally { busy = false; }
  }
  function paintChat() {
    $('gChat').innerHTML = G.msgs.map(function (m) {
      if (m.kind === 'system') return '<div class="st-sys">' + esc(m.text) + '</div>';
      var canAct = !m.deleted && (m.mine || G.role === 'admin' || G.role === 'coadmin');
      return '<div class="st-msg ' + (m.mine ? 'mine' : '') + '"><div class="st-bub' + (m.deleted ? ' del' : '') + '"' + (canAct ? ' data-act="msgMenu" data-id="' + m.id + '"' : '') + '>' +
        (m.mine ? '' : '<div class="st-bn">' + esc(m.name) + role(m.role) + '</div>') + (m.deleted ? '<i>message deleted</i>' : esc(m.text).replace(/\n/g, '<br>')) + '</div></div>';
    }).join('') || '<div class="st-empty">No messages yet. Say hello!</div>';
  }
  ACT.sendMsg = async function () {
    var inp = $('gMsg'); if (!inp) return; var text = inp.value.trim(); if (!text) return;
    inp.value = '';
    try { await S.api('/groups/' + G.id + '/messages', 'POST', { text: text }); await loadMsgs(); var b = $('gChat'); if (b) b.scrollTop = b.scrollHeight; }
    catch (e) { inp.value = text; S.say(S.err(e), 'error'); }
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'gMsg') { e.preventDefault(); ACT.sendMsg(); } });

  function canModerate(targetRole) { return RANK[G.role] > RANK[targetRole || 'member'] && (G.role === 'admin' || G.role === 'coadmin'); }
  ACT.msgMenu = function (el) {
    var m = G.msgs.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (!m) return;
    var isMod = G.role === 'admin' || G.role === 'coadmin', can = !m.mine && canModerate(m.role) && m.userId !== 'system';
    S.sheet('<div class="st-quote">' + esc(m.text.slice(0, 120)) + '</div><div class="st-list">' +
      (isMod ? '<button class="st-opt" data-act="pinMsg" data-id="' + m.id + '"><i class="ti ti-pin"></i><span>Pin message</span></button>' : '') +
      (can ? '<button class="st-opt" data-act="muteUser" data-u="' + m.userId + '" data-min="60"><i class="ti ti-volume-off"></i><span>Mute ' + esc(m.name) + ' for 1 hour</span></button>' : '') +
      '<button class="st-opt st-bad" data-act="delMsg" data-id="' + m.id + '"><i class="ti ti-trash"></i><span>Delete message</span></button></div>');
  };
  ACT.pinMsg = async function (el) { try { await S.api('/groups/' + G.id + '/pin', 'POST', { messageId: el.getAttribute('data-id') }); S.closeSheet(); loadMsgs(); S.say('Pinned'); } catch (e) { S.say(S.err(e), 'error'); } };
  ACT.delMsg = async function (el) {
    try { await S.api('/groups/' + G.id + '/messages/' + el.getAttribute('data-id'), 'DELETE'); S.closeSheet(); G.cursor = null; busy = false; loadMsgs(); } catch (e) { S.say(S.err(e), 'error'); }
  };
  ACT.muteUser = async function (el) {
    try { await S.api('/groups/' + G.id + '/members/' + el.getAttribute('data-u') + '/mute', 'POST', { minutes: +el.getAttribute('data-min') }); S.closeSheet(); S.say(+el.getAttribute('data-min') ? 'Member muted' : 'Member unmuted'); } catch (e) { S.say(S.err(e), 'error'); }
  };

  // ═════════════════════════ MANAGE (roles + settings) ═════════════════════════
  SO.manage = async function (arg) {
    G = G && G.id === arg.id ? G : { id: arg.id, view: 'timers' };
    body().innerHTML = '<div class="st-empty">Loading\u2026</div>';
    try {
      var d = await S.api('/groups/' + G.id);
      G.meta = d.group; G.members = d.members; G.role = d.group.role;
      var g = d.group, isAdmin = G.role === 'admin';
      if (G.role !== 'admin' && G.role !== 'coadmin') { S.go('group', { id: G.id, view: 'timers' }); return; }
      var co = d.members.filter(function (m) { return m.role === 'coadmin'; }), mem = d.members.filter(function (m) { return m.role === 'member'; });
      var h = '<div class="st-row">' + back('backGroup') + '<div class="st-grow"><div class="st-muted">' + esc(g.name) + '</div><h2 class="st-h2" style="margin:0">Manage group</h2></div></div>' +
        '<div class="st-note"><b>Co-admin</b> can moderate chat and mute or remove members. Only the <b>Admin</b> can appoint co-admins.</div>' +
        '<div class="st-lbl">Co-admins \u00b7 ' + co.length + ' of ' + g.maxCoAdmins + '</div><div class="st-list">' +
        (co.length ? co.map(function (m) { return '<div class="st-mem">' + av(m.name) + '<div class="st-grow"><b>' + esc(m.name) + '</b></div>' + (isAdmin ? '<button class="st-btn-out" data-act="rmCo" data-u="' + m.userId + '">Remove role</button>' : '') + '</div>'; }).join('') : '<div class="st-empty">No co-admins yet</div>') + '</div>' +
        '<div class="st-lbl">Members</div><div class="st-list">' + mem.map(function (m) {
          return '<div class="st-mem">' + av(m.name) + '<div class="st-grow"><b>' + esc(m.name) + '</b>' + (m.muted ? '<span class="st-role">MUTED</span>' : '') + '</div>' +
            (isAdmin && co.length < g.maxCoAdmins ? '<button class="st-btn-out st-fill" data-act="mkCo" data-u="' + m.userId + '">Make co-admin</button>' : '') +
            '<button class="st-back st-sm" data-act="memMenu" data-u="' + m.userId + '" aria-label="More actions"><i class="ti ti-dots"></i></button></div>';
        }).join('') + (mem.length ? '' : '<div class="st-empty">Invite friends to see them here</div>') + '</div>' +
        '<div class="st-lbl">Chat settings</div><div class="st-card"><div class="st-seg st-seg-sm"><button data-act="chatMode" data-v="everyone" class="' + (g.chatMode === 'everyone' ? 'on' : '') + '">Everyone</button><button data-act="chatMode" data-v="admins" class="' + (g.chatMode === 'admins' ? 'on' : '') + '">Admins only</button></div>' +
        '<label class="st-toggle"><span><b>Slow mode</b><small>Each member can send one message every 30 seconds</small></span><input id="slowMode" type="checkbox" ' + (g.slowSec ? 'checked' : '') + ' data-act="slowMode"></label></div>' +
        (isAdmin ? '<div class="st-lbl">Group</div><div class="st-card"><label class="st-field"><span>Daily goal (hours)</span><input id="goalH" type="number" min="0" step="0.5" value="' + (g.dailyGoalMin / 60) + '"></label>' +
          '<label class="st-toggle"><span><b>Show live timers</b><small>Members see each other\'s timers</small></span><input id="showT" type="checkbox" ' + (g.showTimers ? 'checked' : '') + '></label><button class="st-cta" data-act="saveGroup">Save changes</button></div>' : '') +
        '<button class="st-cta st-danger" data-act="' + (isAdmin ? 'delGroup' : 'leaveGroup') + '">' + (isAdmin ? 'Delete group' : 'Leave group') + '</button>' +
        (isAdmin ? '<button class="st-cta st-ghostbtn" data-act="leaveGroup">Leave group (hand over admin)</button>' : '');
      body().innerHTML = h;
    } catch (e) { body().innerHTML = '<div class="st-empty">' + esc(S.err(e)) + '</div>'; }
  };
  ACT.backGroup = function () { S.go('group', { id: G.id, view: 'timers' }); };
  function act(fn) { return async function (el) { try { await fn(el); } catch (e) { S.say(S.err(e), 'error'); } }; }
  ACT.mkCo = act(async function (el) { await S.api('/groups/' + G.id + '/coadmins', 'POST', { userId: el.getAttribute('data-u') }); S.say('Co-admin appointed'); SO.manage({ id: G.id }); });
  ACT.rmCo = act(async function (el) { await S.api('/groups/' + G.id + '/coadmins/' + el.getAttribute('data-u'), 'DELETE'); SO.manage({ id: G.id }); });
  ACT.chatMode = act(async function (el) { await S.api('/groups/' + G.id, 'PUT', { chatMode: el.getAttribute('data-v') }); SO.manage({ id: G.id }); });
  ACT.slowMode = act(async function (el) { await S.api('/groups/' + G.id, 'PUT', { slowSec: el.checked ? 30 : 0 }); });
  ACT.saveGroup = act(async function () { await S.api('/groups/' + G.id, 'PUT', { dailyGoalMin: Math.round((+$('goalH').value || 0) * 60), showTimers: $('showT').checked }); S.say('Saved'); });
  ACT.memMenu = function (el) {
    var u = el.getAttribute('data-u'), m = G.members.filter(function (x) { return x.userId === u; })[0]; if (!m) return;
    S.sheet('<h2 class="st-h2">' + esc(m.name) + '</h2><div class="st-list">' +
      (m.muted ? '<button class="st-opt" data-act="muteUser" data-u="' + u + '" data-min="0"><i class="ti ti-volume"></i><span>Unmute</span></button>'
        : '<button class="st-opt" data-act="muteUser" data-u="' + u + '" data-min="60"><i class="ti ti-volume-off"></i><span>Mute for 1 hour</span></button><button class="st-opt" data-act="muteUser" data-u="' + u + '" data-min="1440"><i class="ti ti-volume-off"></i><span>Mute for 24 hours</span></button>') +
      '<button class="st-opt st-bad" data-act="kick" data-u="' + u + '"><i class="ti ti-user-x"></i><span>Remove from group</span></button></div>');
  };
  ACT.kick = function (el) {
    var u = el.getAttribute('data-u');
    S.confirm('Remove this member from the group?', act(async function () { await S.api('/groups/' + G.id + '/members/' + u, 'DELETE'); S.closeSheet(); SO.manage({ id: G.id }); }));
  };
  ACT.delGroup = function () { S.confirm('Delete this group for everyone? This cannot be undone.', act(async function () { await S.api('/groups/' + G.id, 'DELETE'); S.go('groups'); })); };
  ACT.leaveGroup = function () { S.confirm('Leave this group?', act(async function () { await S.api('/groups/' + G.id + '/leave', 'POST'); S.go('groups'); })); };

  // ═════════════════════════ ?join=CODE (opened from a group invite link) ═════════════════════════
  SO.handleJoinParam = function () {
    var code = new URLSearchParams(location.search).get('join');
    if (!code || !/^[A-Za-z0-9]{6,16}$/.test(code)) return;
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    var tries = 0;
    (function waitReady() {                                   // wait until the app has logged the user in
      if (typeof switchNavTab === 'function' && document.getElementById('page-study') && (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData)) {
        switchNavTab('study'); setTimeout(function () { S.go('groups'); SO.joinPreview(code); }, 600);
      } else if (tries++ < 40) setTimeout(waitReady, 250);
    })();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', SO.handleJoinParam); else SO.handleJoinParam();
})();
