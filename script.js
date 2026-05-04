// ============================================================
// CONFIG — Admin passwords updated to 1414 / 1414
// ============================================================
const ADMIN_C1 = '1414';
const ADMIN_C2 = '1414';
const DB_KEY = 'footbola_v4';

function xpForLevel(lvl){return Math.floor(100*Math.pow(lvl,1.4))}
function getLevelFromXP(xp){let lvl=1;while(lvl<100&&xp>=xpForLevel(lvl+1))lvl++;return lvl}
function getLevelTitle(lvl){if(lvl>=90)return'LEGEND';if(lvl>=70)return'ELITE';if(lvl>=50)return'VETERAN';if(lvl>=30)return'REGULAR';if(lvl>=15)return'ROOKIE';return'AMATEUR'}

// ============================================================
// SUPABASE CLOUD ADAPTER
// ============================================================
const supabaseUrl = 'https://jvkjjpqlmofprmugkbxs.supabase.co';
const supabaseKey = 'sb_publishable_Dhyyi9tDjzS6cjSeqAK-_g_xL1DctLB';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let cloudDB = { players: [], pending: [], tournaments: [], news: [] };

function getDB() { return cloudDB; }
function freshDB() { return { players: [], pending: [], tournaments: [], news: [] }; }

// THE FULLY REPAIRED CLOUD SYNC (Fixes New User Freezes)
async function saveDB(db) {
    cloudDB = db;
    localStorage.setItem(DB_KEY, JSON.stringify(db)); // Local Backup

    // 1. Bulk Sync Players (Includes Status for Archive/Ban) & Tournaments
    const playerUpdates = db.players.map(p => ({
        player_id: p.id, name: p.name, pin: p.pin, photo: p.photo,
        tier: p.tier, stars: p.stars, stats: p.stats, market_value: p.marketValue,
        status: p.status || 'active'
    }));

    const tournamentUpdates = db.tournaments.map(t => ({
        id: t.id, name: t.name, format: t.format, type: t.type, status: t.status,
        participants: t.participants, standings: t.standings, matches: t.matches,
        phase: t.phase, schedule: t.schedule, bracket: t.bracket
    }));

    try {
        await Promise.all([
            supabaseClient.from('players').upsert(playerUpdates, { onConflict: 'player_id' }),
            supabaseClient.from('tournaments').upsert(tournamentUpdates)
        ]);

        // 3. Sync News properly
        if(db.news && db.news.length > 0) {
            const latestNews = db.news[0];
            await supabaseClient.from('news').upsert({
                text: latestNews.text, icon: latestNews.icon, ts: latestNews.ts
            }, { onConflict: 'ts' });
        }
        
        // 4. Sync Admin Codes to Cloud
        if(db.adminCodes) {
            await supabaseClient.from('admin_settings').upsert({
                key: 'codes', value: db.adminCodes
            });
        }
    } catch (error) {
        console.error("Cloud Sync Failed", error);
    }
}

// THE SURGICAL SAVES (No more bulldozers)
async function saveSingleTournament(t) {
    if(!t) return;
    await supabaseClient.from('tournaments').upsert({
        id: t.id, name: t.name, format: t.format, type: t.type, status: t.status,
        participants: t.participants, standings: t.standings, matches: t.matches,
        phase: t.phase, schedule: t.schedule, bracket: t.bracket
    });
}

async function saveSinglePlayer(p) {
    if(!p) return;
    await supabaseClient.from('players').upsert({
        player_id: p.id, name: p.name, pin: p.pin, photo: p.photo,
        tier: p.tier, stars: p.stars, stats: p.stats, market_value: p.marketValue,
        status: p.status || 'active'
    }, { onConflict: 'player_id' });
}

// ============================================================
// STATE
// ============================================================
let currentUser=null;
let activeTournIdx=null;
let cData={format:'league',type:'1v1',selected:[],teams:[]};
let pendingPro=null;
let motmMatchIdx=null;
let motmVotes={motm:null,ratings:{}};

// ============================================================
// UTILS
// ============================================================
function genID(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return'FBL-'+Array.from({length:4},()=>c[Math.floor(Math.random()*c.length)]).join('')}
function initials(name){return name.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'??'}
function avHTML(p,size=46){
  const s=`width:${size}px;height:${size}px;font-size:${Math.round(size*0.32)}px`;
  return `<div class="pav" style="${s}">${p.photo?`<img src="${p.photo}">`:`${initials(p.name)}`}</div>`
}
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id)?.classList.add('active')}

// ============================================================
// NEW AVATAR HELPER FOR TOURNAMENTS
// ============================================================
function getMiniAv(id, t, db) {
  if(!id) return `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);border:1px dashed var(--border);flex-shrink:0"></div>`;
  const s = t.standings.find(x => x.id === id);
  if(!s) return '';

  if(t.type === '1v1') {
    const p = db.players.find(x => x.id === id);
    if(p && p.photo) return `<img src="${p.photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex-shrink:0">`;
    return `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);border:1px solid var(--border);flex-shrink:0">${initials(s.name)}</div>`;
  } else {
    // 2v2 Logic: Overlapping Photos
    const p1 = db.players.find(x => x.id === s.proId);
    const p2 = db.players.find(x => x.id === s.youthId);
    const i1 = (p1 && p1.photo) ? `<img src="${p1.photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid var(--card);flex-shrink:0;position:relative;z-index:2">` : `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);border:1px solid var(--card);flex-shrink:0;position:relative;z-index:2">${initials(s.proName||'?')}</div>`;
    const i2 = (p2 && p2.photo) ? `<img src="${p2.photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid var(--card);flex-shrink:0;margin-left:-10px;position:relative;z-index:1">` : `<div style="width:22px;height:22px;border-radius:50%;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--gold);border:1px solid var(--card);flex-shrink:0;margin-left:-10px;position:relative;z-index:1">${initials(s.youthName||'?')}</div>`;
    return `<div style="display:flex;align-items:center">${i1}${i2}</div>`;
  }
}
function showTab(tab){
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  renderTab(tab);
}
function showErr(id,msg){const el=document.getElementById(id);if(el){el.textContent=msg;el.classList.add('show')}}
function hideErr(id){document.getElementById(id)?.classList.remove('show')}
function snack(msg){const el=document.getElementById('snack');el.textContent=msg;el.classList.add('show');clearTimeout(snack._t);snack._t=setTimeout(()=>el.classList.remove('show'),2800)}
function closeModal(id){document.getElementById(id)?.classList.remove('active')}
function closeConf(){document.getElementById('conf-ov')?.classList.remove('active')}

// ============================================================
// THE SAFE NEWS SYSTEM (WITH TELEGRAM)
// ============================================================
async function addNews(text, icon='📰'){
  const db=getDB();
  db.news=db.news||[];
  const newItem = {text, icon, ts:Date.now()};
  db.news.unshift(newItem);
  
  try {
      await supabaseClient.from('news').insert([newItem]);
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      
      // نرسل الأيقونة مع النص للبوت ليعرف كيف يتفاعل
      sendTelegramAlert(`${icon} ${text}`);
      
  } catch(e) { console.error("News sync error", e); }
}

function timeAgo(ts){
  const diff=Date.now()-ts;
  const m=Math.floor(diff/60000);
  if(m<1)return'Just now';
  if(m<60)return`${m}m ago`;
  const h=Math.floor(m/60);
  if(h<24)return`${h}h ago`;
  return`${Math.floor(h/24)}d ago`;
}

// ============================================================
// PHOTO UPLOAD
// ============================================================
function handlePhoto(input,prevId,dataId){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      const size=240;canvas.width=canvas.height=size;
      const ctx=canvas.getContext('2d');
      const min=Math.min(img.width,img.height);
      ctx.drawImage(img,(img.width-min)/2,(img.height-min)/2,min,min,0,0,size,size);
      const data=canvas.toDataURL('image/jpeg',0.72);
      document.getElementById(prevId).innerHTML=`<img src="${data}">`;
      document.getElementById(dataId).value=data;
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================================
// AUTH
// ============================================================
function gateToggle(which){
  ['player','new','admin'].forEach(g=>{
    const el=document.getElementById('gate-'+g);
    if(g===which)el.classList.toggle('expanded');
    else el.classList.remove('expanded');
  });
}
function playerLogin(){
  const id=document.getElementById('login-id').value.trim();
  const pin=document.getElementById('login-pin').value.trim();
  hideErr('login-error');
  const db=getDB();
  const p=db.players.find(p=>p.id.toLowerCase()===id.toLowerCase() && p.pin===pin);
  if(!p){showErr('login-error','Invalid Username or PIN.');return}
  if(p.status === 'banned') {showErr('login-error', '🚫 Your account has been removed.');return;}
  // 🔒 Block suspended players
  if(p.status === 'suspended') {showErr('login-error', '🟥 You are currently suspended!');return;}
  currentUser={type:'player',id:p.id,name:p.name};
  localStorage.setItem('footbola_session', JSON.stringify(currentUser));
  enterApp();
}
// ============================================================
// NEW ACCOUNT (DIRECT ASYNC UPLOAD)
// ============================================================
async function newAccount(){
  const btn = document.querySelector('#gate-new .btn-green');
  const originalText = btn.innerHTML;
  
  const name=document.getElementById('new-name').value.trim();
  const username=document.getElementById('new-username').value.trim();
  const pin=document.getElementById('new-pin').value.trim();
  const photo=document.getElementById('new-photo-data').value;
  hideErr('new-error');
  
  if(!name){showErr('new-error','Please enter your name.');return}

  const userRegex = /^[a-zA-Z\u0621-\u064A]+[0-9]{4}[^a-zA-Z0-9\u0621-\u064A\s]$/;
  if(!userRegex.test(username)) {
      showErr('new-error', 'Username MUST be: Name + 4 Numbers + 1 Symbol (e.g. Kasr2026!)');
      return;
  }
  if(!/^\d{4}$/.test(pin)){showErr('new-error','PIN must be exactly 4 digits.');return}
  
  const db=getDB();
  if(db.players.find(p=>p.id.toLowerCase()===username.toLowerCase())){showErr('new-error','This Username is already taken!');return}
  if(db.pending.find(p=>p.username?.toLowerCase()===username.toLowerCase())){showErr('new-error','This Username is waiting for approval.');return}
  
  const reqData = { name:name, username:username, pin:pin, photo:photo||'', ts:Date.now() };
  
  try {
      btn.innerHTML = '⏳ جاري الإرسال...';
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.7';

      const { error } = await supabaseClient.from('pending_requests').insert([reqData]);
      if(error) throw error;
      
      db.pending.push(reqData);

      snack('✅ تم الارسال.. يرجي الانتظار للموافقة');
      
      gateToggle(''); 
      showScreen('screen-auth'); 
      
      ['new-name','new-username','new-pin','new-photo-data'].forEach(id => {
          const el = document.getElementById(id);
          if(el) el.value = '';
      });
      document.getElementById('new-photo-prev').innerHTML = '📷';

  } catch (err) {
      console.error(err);
      showErr('new-error','Network Error. Could not send request.');
  } finally {
      btn.innerHTML = originalText;
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
  }
}

function adminLogin(){
  const c1=document.getElementById('admin-c1').value.trim();
  const c2=document.getElementById('admin-c2').value.trim();
  hideErr('admin-error');
  const db=getDB();
  const validC1=db.adminCodes?.c1||ADMIN_C1;
  const validC2=db.adminCodes?.c2||ADMIN_C2;
  if(c1!==validC1||c2!==validC2){showErr('admin-error','Invalid secret codes. Access denied.');return}
  currentUser={type:'admin',id:'ADMIN',name:'Manager'};
  localStorage.setItem('footbola_session', JSON.stringify(currentUser));
  enterApp();
}

function enterApp(){
    showScreen('screen-app');
    renderUserBadge();
    showTab('arena');
    // START MUSIC
    if(bgMusic.paused) toggleMusic(); 
}
function logout(){
  currentUser=null;
  localStorage.removeItem('footbola_session');
  showScreen('screen-auth');
  ['login-id','login-pin','new-name','new-pin','new-photo-data','admin-c1','admin-c2'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
  document.getElementById('new-photo-prev').innerHTML='📷';
  ['login-error','new-error','admin-error'].forEach(hideErr);
  document.querySelectorAll('.gate').forEach(g=>g.classList.remove('expanded'));
}

// ============================================================
// USER BADGE
// ============================================================
function renderUserBadge(){
  const el=document.getElementById('user-badge');if(!el||!currentUser)return;
  if(currentUser.type==='admin'){
    el.innerHTML='<span>🛡️</span><span style="font-size:13px">Manager</span>';
  } else {
    const db=getDB();const p=db.players.find(x=>x.id===currentUser.id);
    const xp=p?.stats?.xp||0;const lvl=getLevelFromXP(xp);
    const avEl=p?.photo?`<div class="uav"><img src="${p.photo}"></div>`:`<div class="uav">${initials(currentUser.name)}</div>`;
    el.innerHTML=`${avEl}<span style="font-size:13px">${currentUser.name}</span><span class="lvl-badge">LVL ${lvl}</span>`;
  }
}

// ============================================================
// SELF PROFILE / EDIT
// ============================================================
function openSelfProfile(){
  if(currentUser?.type==='admin'){openAdminSettings();return}
  const db=getDB();
  const pIdx=db.players.findIndex(x=>x.id===currentUser?.id);
  if(pIdx>=0)openProfile(pIdx,true);
}

function openAdminSettings(){
  const body=document.getElementById('edit-profile-body');
  body.innerHTML=`
    <div class="settings-card">
      <div class="settings-title">🔑 Change Admin Codes</div>
      <div class="field"><label>New Code 1</label><input id="admin-new-c1" type="password" placeholder="New first code"></div>
      <div class="field"><label>New Code 2</label><input id="admin-new-c2" type="password" placeholder="New second code"></div>
      <button class="btn btn-red" onclick="changeAdminCodes()" style="margin-top:4px">CHANGE CODES</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🛡️ Reset Any Player PIN</div>
      <select class="select-field" id="admin-reset-player-sel" style="margin-bottom:12px">
        <option value="">— Select Player —</option>
        ${getDB().players.map(p=>`<option value="${p.id}">${p.name} (${p.id})</option>`).join('')}
      </select>
      <div class="field"><label>New PIN</label><input id="admin-reset-new-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn btn-gold" onclick="adminResetPin()">RESET PIN</button>
    </div>`;
  document.getElementById('modal-edit-profile').classList.add('active');
}

// ============================================================
// SECURE ADMIN CODES UPDATE
// ============================================================
async function changeAdminCodes(){
  const c1=document.getElementById('admin-new-c1').value.trim();
  const c2=document.getElementById('admin-new-c2').value.trim();
  if(!c1||!c2){snack('⚠️ Enter both codes');return}
  const db=getDB();
  db.adminCodes={c1,c2};
  
  // رفع الأكواد السرية فقط للسيرفر
  try {
      await supabaseClient.from('admin_settings').upsert({ key: 'codes', value: db.adminCodes });
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      snack('✅ Admin codes updated');
      closeModal('modal-edit-profile');
  } catch(e) {
      snack('❌ Failed to update codes');
  }
}

async function adminResetPin(){
  const pid=document.getElementById('admin-reset-player-sel').value;
  const pin=document.getElementById('admin-reset-new-pin').value.trim();
  if(!pid){snack('⚠️ Select a player');return}
  if(!/^\d{4}$/.test(pin)){snack('⚠️ PIN must be 4 digits');return}
  const db=getDB();
  const p=db.players.find(x=>x.id===pid);
  if(p){
      p.pin=pin;
      // الحفظ الذكي
      await saveSinglePlayer(p); 
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      snack(`✅ PIN reset for ${p.name}`);
  }
  closeModal('modal-edit-profile');
}

// ============================================================
// TAB ROUTING
// ============================================================
function renderTab(tab){
  if(tab==='arena')renderArena();
  else if(tab==='locker')renderLocker();
  else if(tab==='history')renderHistory();
  else if(tab==='market')renderMarket();
}

// ============================================================
// NEWS FEED
// ============================================================
// ============================================================
// LIVE BREAKING NEWS RENDERER
// ============================================================
function renderNewsFeed(){
  const db=getDB();
  const feed=document.getElementById('news-feed');if(!feed)return;
  const items=db.news||[];
  
  if(items.length===0){
    feed.innerHTML='<div style="font-size:13px;color:var(--sub);padding:14px 0;text-align:center;background:var(--card);border-radius:12px">No news yet — play some matches!</div>';
    return;
  }
  
  feed.innerHTML=items.slice(0,10).map((n, i)=>{
    const isLatest = (i === 0) ? 'latest' : '';
    const timeDisplay = (i === 0) ? '🔴 LIVE NOW' : timeAgo(n.ts);
    
    return `
    <div class="news-item ${isLatest}">
      <div class="news-ico">${n.icon||'📰'}</div>
      <div class="news-body">
        <div class="news-txt">${n.text}</div>
        <div class="news-time">${timeDisplay}</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// ARENA
// ============================================================
function renderArena(){
  const db=getDB();
  const isAdmin=currentUser?.type==='admin';
  const createBtn=document.getElementById('create-btn');
  if(createBtn)createBtn.style.display=isAdmin?'flex':'none';
  renderNewsFeed();
  const list=document.getElementById('tournament-list');
  if(db.tournaments.length===0){
    list.innerHTML=`<div class="empty-state"><div class="empty-ico">🏟️</div><div class="empty-txt">No tournaments yet.<br>${isAdmin?'Tap CREATE to start!':'Ask the Manager.'}</div></div>`;
    return;
  }
  list.innerHTML=db.tournaments.map((t,i)=>{
    const badge=t.status==='ended'
      ?`<span class="ended-badge">ENDED</span>`
      :`<div class="live-badge"><div class="live-dot"></div>LIVE</div>`;
    return `<div class="t-card" onclick="openTournament(${i})">
      <div class="t-card-top">${badge}<div class="av-stack">${buildAvatarStack(t,db)}</div></div>
      <div class="t-name">${t.name}</div>
      <div class="t-meta">${t.type.toUpperCase()} · ${t.format==='league'?'🏅 League':'🌳 Elimination'} · ${t.participants.length} ${t.type==='2v2'?'teams':'players'}</div>
    </div>`;
  }).join('');
}

function buildAvatarStack(t,db){
  const MAX=4;
  return t.participants.slice(0,MAX).map(p=>{
    if(t.type==='2v2')return`<div class="av-circle">${(p.proName||p.name||'?').slice(0,2).toUpperCase()}</div>`;
    const player=db.players.find(x=>x.id===p);
    if(!player)return`<div class="av-circle">?</div>`;
    return player.photo?`<div class="av-circle"><img src="${player.photo}"></div>`:`<div class="av-circle">${initials(player.name)}</div>`;
  }).join('')+(t.participants.length>MAX?`<div class="av-circle">+${t.participants.length-MAX}</div>`:'');
}

// ============================================================
// CREATE TOURNAMENT
// ============================================================
function openCreate(){
  cData={format:'league',type:'1v1',selected:[],teams:[]};pendingPro=null;
  document.getElementById('cup-name').value='';
  document.querySelectorAll('#format-row .f-opt').forEach(el=>el.classList.toggle('sel',el.dataset.val==='league'));
  document.querySelectorAll('#type-row .f-opt').forEach(el=>el.classList.toggle('sel',el.dataset.val==='1v1'));
  hideErr('create-err');
  renderCreatePlayers();
  document.getElementById('modal-create').classList.add('active');
}
function setCreate(prop,el){
  el.parentElement.querySelectorAll('.f-opt').forEach(x=>x.classList.remove('sel'));
  el.classList.add('sel');cData[prop]=el.dataset.val;
  cData.selected=[];cData.teams=[];pendingPro=null;
  renderCreatePlayers();
}
function renderCreatePlayers(){
  const db=getDB();const sec=document.getElementById('create-players-section');
  if(cData.type==='1v1'){
    if(db.players.length===0){sec.innerHTML=`<div class="field"><label>Select Players</label><div style="font-size:13px;color:var(--sub);padding:6px 0">No approved players yet.</div></div>`;return}
    sec.innerHTML=`<div class="field"><label>Select Players (min 2)</label><div class="p-sel-list">
      ${db.players.map(p=>{
        const sel=cData.selected.includes(p.id);
        return`<div class="p-sel-item ${sel?'sel':''}" onclick="toggleSel('${p.id}')">
          <div class="pav" style="width:32px;height:32px;font-size:11px">${p.photo?`<img src="${p.photo}">`:`${initials(p.name)}`}</div>
          <div style="flex:1"><div style="font-size:13px;font-weight:700">${p.name}</div><div style="font-size:11px;color:var(--sub)">${p.id}</div></div>
          <div class="check">${sel?'✓':''}</div>
        </div>`;
      }).join('')}
    </div></div>`;
  } else {
    const pros=db.players.filter(p=>p.tier==='pro');
    const youths=db.players.filter(p=>p.tier!=='pro');
    const usedIds=cData.teams.flatMap(t=>[t.proId,t.youthId]);
    sec.innerHTML=`
      <div class="divider"></div>
      <div class="pot-lbl">⭐ PRO POT</div>
      <div class="pot-chips">${pros.map(p=>`<div class="p-chip${usedIds.includes(p.id)?' used':''}" data-id="${p.id}" data-tier="pro" onclick="selectPotPlayer(this)">${p.name}</div>`).join('')}${pros.length===0?`<span style="font-size:12px;color:var(--sub)">No PRO players</span>`:''}</div>
      <div class="pot-lbl">🌱 YOUTH POT</div>
      <div class="pot-chips">${youths.map(p=>`<div class="p-chip${usedIds.includes(p.id)?' used':''}" data-id="${p.id}" data-tier="youth" onclick="selectPotPlayer(this)">${p.name}</div>`).join('')}${youths.length===0?`<span style="font-size:12px;color:var(--sub)">No Youth players</span>`:''}</div>
      <div class="divider"></div>
      <div class="pot-lbl">Teams formed (${cData.teams.length})</div>
      <div class="formed-teams">
        ${cData.teams.map((t,i)=>`<div class="team-pair"><span>⭐ ${t.proName}</span><span style="color:var(--sub)">+</span><span>🌱 ${t.youthName}</span><button class="rm-team" onclick="removeTeam(${i})">✕</button></div>`).join('')}
        ${cData.teams.length===0?`<div style="font-size:12px;color:var(--sub)">Select a PRO then a YOUTH to form a team.</div>`:''}
      </div>`;
    if(pendingPro){const el=document.querySelector(`.p-chip[data-id="${pendingPro.id}"]`);if(el)el.classList.add('sp')}
  }
}
function toggleSel(pid){
  const idx=cData.selected.indexOf(pid);
  if(idx===-1)cData.selected.push(pid);else cData.selected.splice(idx,1);
  renderCreatePlayers();
}
function selectPotPlayer(el){
  const id=el.dataset.id;const tier=el.dataset.tier;
  const db=getDB();const player=db.players.find(p=>p.id===id);if(!player)return;
  if(tier==='pro'){
    pendingPro={id,name:player.name};
    document.querySelectorAll('.p-chip[data-tier="pro"]').forEach(c=>c.classList.remove('sp'));
    el.classList.add('sp');snack('⭐ PRO: '+player.name+' — now pick a YOUTH');
  } else {
    if(!pendingPro){snack('Pick a PRO player first!');return}
    cData.teams.push({name:pendingPro.name+' & '+player.name,proId:pendingPro.id,proName:pendingPro.name,youthId:id,youthName:player.name});
    pendingPro=null;renderCreatePlayers();
  }
}
function removeTeam(i){cData.teams.splice(i,1);renderCreatePlayers()}

// ============================================================
// CREATE TOURNAMENT — WITH BUTTON LOCK
// ============================================================
async function createTournament(){
  hideErr('create-err');
  const name=document.getElementById('cup-name').value.trim();
  if(!name){showErr('create-err','Enter a cup name!');return}
  let participants;
  if(cData.type==='1v1'){
    if(cData.selected.length<2){showErr('create-err','Select at least 2 players!');return}
    participants=cData.selected;
  } else {
    if(cData.teams.length<2){showErr('create-err','Create at least 2 teams!');return}
    participants=cData.teams;
  }

  // 🛑 قفل الزر لمنع الضغط المزدوج
  const btn = document.querySelector('#modal-create .btn-gold');
  if(btn) { btn.innerHTML = '⏳ CREATING...'; btn.style.pointerEvents = 'none'; }

  const db=getDB();
  const standings=participants.map(p=>{
    if(cData.type==='1v1'){
      const pl=db.players.find(x=>x.id===p);
      return{id:p,name:pl?.name||p,PL:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,PTS:0};
    } else {
      return{id:p.name,name:p.name,proId:p.proId,youthId:p.youthId,PL:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,PTS:0};
    }
  });

  let t={id:Date.now(),name,format:cData.format,type:cData.type,participants,standings,matches:[],status:'active'};
  const n=participants.length;

  if(![2,4,8,16].includes(n)){
    t.format='league'; t.phase='group'; t.schedule=generateRoundRobin(standings,cData.type);
    snack('⚠️ Odd number! Forced League format (Double Leg).');
  } else {
    if(cData.format==='tree'){
      t.phase='elimination'; t.bracket=generateBracket(standings.map(s=>s.id),cData.type);
    } else {
      t.phase='group'; t.schedule=generateRoundRobin(standings,cData.type);
    }
  }

  db.tournaments.unshift(t);

  await saveSingleTournament(t);
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  addNews(`🏆 New tournament created: "${name}" with ${participants.length} ${cData.type==='2v2'?'teams':'players'}!`,'🏆');
  
  if(btn) { btn.innerHTML = '🏆 CREATE CUP'; btn.style.pointerEvents = 'auto'; }
  closeModal('modal-create');snack('🏆 "'+name+'" created!');renderArena();
}

// Generate all round-robin matchups (each pair plays twice)
function generateRoundRobin(standings,type){
  const ids=standings.map(s=>s.id);
  const schedule=[];
  for(let i=0;i<ids.length;i++){
    for(let j=i+1;j<ids.length;j++){
      schedule.push({aId:ids[i],bId:ids[j],leg:1,played:false});
      schedule.push({aId:ids[j],bId:ids[i],leg:2,played:false});
    }
  }
  return schedule;
}

// Generate elimination bracket
function generateBracket(playerIds,type){
  const shuffled=[...playerIds].sort(()=>Math.random()-0.5);
  const size=Math.pow(2,Math.ceil(Math.log2(shuffled.length)));
  while(shuffled.length<size)shuffled.push(null);
  const rounds=[];
  let current=[];
  for(let i=0;i<shuffled.length;i+=2){
    current.push({p1:shuffled[i],p2:shuffled[i+1],winner:null,score1:null,score2:null});
  }
  rounds.push(current);
  while(current.length>1){
    const next=[];
    for(let i=0;i<current.length;i+=2){
      next.push({p1:null,p2:null,winner:null,score1:null,score2:null,feedFrom:[rounds.length-1,i,i+1]});
    }
    rounds.push(next);
    current=next;
  }
  return rounds;
}

// ============================================================
// TOURNAMENT SCREEN — Updated to show Qualify button
// ============================================================
function openTournament(idx){activeTournIdx=idx;renderTournamentScreen();showScreen('screen-tournament')}
function backToApp(){activeTournIdx=null;showScreen('screen-app');renderArena()}
function getTournament(){if(activeTournIdx===null)return null;return getDB().tournaments[activeTournIdx]}

function renderTournamentScreen(){
  const t=getTournament();if(!t)return;
  document.getElementById('t-scr-name').textContent=t.name;
  document.getElementById('t-scr-meta').innerHTML=`${t.type.toUpperCase()} · ${t.format==='league'?'🏅 League':'🌳 Elimination'} · <span style="color:${t.status==='active'?'var(--green)':'var(--sub)'}">● ${t.status==='active'?'LIVE':'ENDED'}</span>`;
  renderNextMatch(t);
  renderStandings();
  renderMatchHistory();

  const ctrl=document.getElementById('admin-ctrl');
  ctrl.style.display=(currentUser?.type==='admin'&&t.status==='active')?'block':'none';

  // Show Qualify button only when in group phase (league with pending elimination)
  const qBtn=document.getElementById('btn-qualify');
  if(qBtn) qBtn.style.display=(t.phase==='group')?'flex':'none';
}

// ============================================================
// QUALIFY TO KNOCKOUT — New function
// ============================================================
// ============================================================
// QUALIFY TO KNOCKOUT ASYNC FIX
// ============================================================
async function qualifyToKnockout(){
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t||t.phase!=='group')return;

  const qNum=parseInt(prompt('How many players qualify to the Knockout Tree?\nEnter 2, 4, 8, or 16:'));
  if(![2,4,8,16].includes(qNum)){snack('⚠️ Enter 2, 4, 8, or 16');return}
  if(qNum>=t.participants.length){snack('⚠️ Number must be less than total players');return}

  if(!confirm(`Qualify Top ${qNum} players to the Knockout Tree?`))return;

  const sorted=sortedStandings(t);
  const topPlayers=sorted.slice(0,qNum).map(s=>s.id);

  t.phase='elimination';
  t.bracket=generateBracket(topPlayers,t.type);

  // AWAIT THE SERVER BEFORE UPDATING UI
  await saveSingleTournament(t);
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  addNews(`⚡ Top ${qNum} players qualified to the Knockout stage of "${t.name}"!`,'⚡');
  snack(`✅ Top ${qNum} qualified! Bracket generated.`);
  renderTournamentScreen();
}

function renderNextMatch(t){
  const section=document.getElementById('next-match-section');
  if(!t.schedule&&!t.bracket){section.innerHTML='';return}
  let nextA='',nextB='',roundLabel='';
  if(t.phase==='group'&&t.schedule){
    const next=t.schedule.find(m=>!m.played);
    if(next){
      const sA=t.standings.find(s=>s.id===next.aId);
      const sB=t.standings.find(s=>s.id===next.bId);
      nextA=sA?.name||next.aId;nextB=sB?.name||next.bId;
      roundLabel=`Matchday · Leg ${next.leg}`;
    }
  } else if(t.bracket){
    for(let r=0;r<t.bracket.length;r++){
      const match=t.bracket[r].find(m=>m.p1&&m.p2&&m.winner===null);
      if(match){
        const getN=id=>{const s=t.standings.find(x=>x.id===id);return s?.name||id};
        nextA=getN(match.p1);nextB=getN(match.p2);
        const rNames=['Round of 32','Round of 16','Quarter-Final','Semi-Final','Final'];
        roundLabel=rNames[r]||`Round ${r+1}`;
        break;
      }
    }
  }
  if(!nextA){section.innerHTML='';return}
  section.innerHTML=`<div class="next-match-card">
    <div class="nmc-title">⚡ Next Match</div>
    <div class="nmc-teams">
      <div class="nmc-team">${nextA}</div>
      <div class="nmc-vs">VS</div>
      <div class="nmc-team">${nextB}</div>
    </div>
    <div class="nmc-round">${roundLabel}</div>
  </div>`;
}

function sortedStandings(t){return[...t.standings].sort((a,b)=>b.PTS-a.PTS||b.GD-a.GD)}

function renderStandings(){
  const t=getTournament();if(!t)return;
  const content=document.getElementById('standings-content');
  if(t.phase==='elimination'&&t.bracket){
    document.getElementById('standings-sub-hdr').textContent='🌳 Bracket';
    content.innerHTML=`<div class="bracket-scroll"><div class="bracket-container" id="bracket-inner"></div></div>`;
    renderBracket(t);
  } else {
    document.getElementById('standings-sub-hdr').textContent='📊 Live Standings';
    renderLeagueTable(t,content);
  }
}

// ============================================================
// INTERACTIVE LEAGUE TABLE RENDERER
// ============================================================
function renderLeagueTable(t,content){
  const db = getDB();
  const sorted=sortedStandings(t);
  const n=sorted.length;
  const topCount=2;
  let relegCount=0;
  if(n>4)relegCount=Math.max(1,Math.floor(n*0.25));

  content.innerHTML=`<table class="standings-table">
    <thead>
      <tr>
        <th>#</th>
        <th style="text-align:left">Club / Player</th>
        <th>Form</th>
        <th>PL</th>
        <th>GD</th>
        <th>PTS</th>
      </tr>
    </thead>
    <tbody>${sorted.map((p,i)=>{
      let rowClass='';
      if(i<topCount)rowClass='row-blue';
      else if(i>=n-relegCount&&relegCount>0)rowClass='row-relegation';
      
      let formHTML = '';
      if(t.type === '1v1') {
          formHTML = getPlayerForm(p.id, db);
          if(!formHTML) formHTML = '<span style="font-size:10px;color:var(--sub)">-</span>';
      } else {
          formHTML = '<div style="font-size:9px;color:var(--sub);font-weight:700">DUO</div>'; 
      }

      return`<tr class="${rowClass}" onclick="openProfileByName('${encodeURIComponent(p.name)}')">
        <td><span class="s-rank ${i===0?'g':''}">${i===0?'👑':i+1}</span></td>
        <td style="text-align:left">
          <div style="display:flex;align-items:center;gap:10px">
            ${getMiniAv(p.id, t, db)}
            <span style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px">${p.name}</span>
          </div>
        </td>
        <td><div style="display:flex;gap:2px;justify-content:center">${formHTML}</div></td>
        <td style="font-weight:700;color:var(--sub)">${p.PL}</td>
        <td style="font-weight:700;color:${p.GD>0?'var(--green)':p.GD<0?'var(--red)':'var(--sub)'}">${p.GD>0?'+':''}${p.GD}</td>
        <td style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--gold);text-shadow:0 0 10px rgba(240,180,41,0.2)">${p.PTS}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  ${topCount>0?`<div style="display:flex;gap:12px;margin-top:16px;font-size:11px;font-weight:700;background:rgba(17,17,37,0.8);padding:12px;border-radius:12px;border:1px solid var(--border);justify-content:center">
    <span style="color:var(--blue)">🔵 Top ${topCount} — Home Advantage</span>
    ${relegCount>0?`<span style="color:var(--red)">🔴 Relegation Zone</span>`:''}
  </div>`:''}`;
}

// ============================================================
// ADVANCED BRACKET RENDERER
// ============================================================
function renderBracket(t){
  const el=document.getElementById('bracket-inner');if(!el)return;
  if(!t.bracket){el.innerHTML='<div style="color:var(--sub);font-size:13px;padding:20px;text-align:center;width:100%">Bracket will be generated after group stage.</div>';return}
  
  const rNames=['Round 1','Round of 16','Quarter-Finals','Semi-Finals','The Final'];
  const getN=id=>{if(!id)return'TBD';const s=t.standings.find(x=>x.id===id);return s?.name||id};
  
  let html='';
  t.bracket.forEach((round,ri)=>{
    const name=rNames[Math.max(0,rNames.length-(t.bracket.length-ri))];
    html+=`<div class="bracket-round-wrap">
      <div class="bracket-round-title">${name}</div>
      <div class="bracket-round">`;
      
    round.forEach(m=>{
      const w=m.winner;
      const cls=w?'b-match winner-match':'b-match';
      const n1=getN(m.p1);const n2=getN(m.p2||null);
      const isTbd1=!m.p1;const isTbd2=!m.p2;
      
      html+=`<div class="${cls}">
        <div class="b-player">
          <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
            ${getMiniAv(m.p1, t, getDB())}
            <span class="${m.winner===m.p1?'b-winner':''} ${isTbd1?'b-tbd':''}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n1}</span>
          </div>
          ${m.score1!==null?`<span class="b-score">${m.score1}</span>`:''}
        </div>
        <div class="b-player">
          <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
            ${getMiniAv(m.p2, t, getDB())}
            <span class="${m.winner===m.p2?'b-winner':''} ${isTbd2?'b-tbd':''}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${isTbd2?'TBD':n2}</span>
          </div>
          ${m.score2!==null?`<span class="b-score">${m.score2}</span>`:''}
        </div>
      </div>`;
    });
    
    html+='</div></div>';
    
    if(ri<t.bracket.length-1){
      html+=`<div class="bracket-connector">
        <svg width="100%" height="100%" style="position:absolute;inset:0" preserveAspectRatio="none">
          <path d="M0,25 L17,25 L17,75 L35,75" stroke="rgba(255,255,255,0.12)" fill="none" stroke-width="2"/>
        </svg>
      </div>`;
    }
  });
  el.innerHTML=html;
}

function openProfileByName(encodedName){
  const name=decodeURIComponent(encodedName);
  const db=getDB();
  const idx=db.players.findIndex(p=>p.name===name);
  if(idx>=0)openProfile(idx,false);
}

function renderMatchHistory(){
  const t=getTournament();if(!t)return;
  const el=document.getElementById('match-history');
  if(t.matches.length===0){el.innerHTML='<div style="font-size:13px;color:var(--sub);text-align:center;padding:14px 0">No matches recorded yet.</div>';return}
  el.innerHTML=[...t.matches].reverse().map((m,ri)=>{
    const origIdx=t.matches.length-1-ri;
    const motm=m.motm?`<div class="motm-badge">⭐ ${m.motm}</div>`:'';
    const hasVoted=m.votes&&m.votes[currentUser?.id||''];
    const canVote=currentUser&&t.status==='active'&&!hasVoted;
    return`<div class="mh-item" onclick="openMotmVote(${origIdx})">
      <div class="mh-teams">
        <div style="display:flex;align-items:center;gap:6px;flex:1">
          ${getMiniAv(m.aId, t, getDB())}
          <span style="font-weight:${m.goalsA>m.goalsB?700:400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.teamA}</span>
        </div>
        <div class="mh-score">${m.goalsA} – ${m.goalsB}</div>
        <div style="display:flex;align-items:center;gap:6px;flex:1;justify-content:flex-end">
          <span style="font-weight:${m.goalsB>m.goalsA?700:400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right">${m.teamB}</span>
          ${getMiniAv(m.bId, t, getDB())}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;margin-left:8px">
        ${motm}
        ${canVote?`<div style="font-size:9px;color:var(--gold);font-weight:700;letter-spacing:0.5px">TAP TO VOTE</div>`:''}
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// RECORD MATCH
// ============================================================
// ============================================================
// THE MASTER MATCH CONSOLE (Replaces old openRecord)
// ============================================================
function openRecord(){
  const t=getTournament();if(!t)return;
  hideErr('rec-err');
  let poolStandings=t.standings;
  if(t.phase==='elimination'&&t.bracket){
    const activeIds=new Set();
    t.bracket.forEach(round=>{
      round.forEach(m=>{
        if(m.p1&&!m.winner)activeIds.add(m.p1);
        if(m.p2&&!m.winner)activeIds.add(m.p2);
        if(m.winner)activeIds.add(m.winner);
      });
    });
    poolStandings=t.standings.filter(s=>activeIds.has(s.id));
  }
  const opts=poolStandings.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  let scheduleHint='';
  if(t.phase==='group'&&t.schedule){
    const next=t.schedule.find(m=>!m.played);
    if(next){
      const sA=t.standings.find(s=>s.id===next.aId);
      const sB=t.standings.find(s=>s.id===next.bId);
      scheduleHint=`<div style="background:rgba(240,180,41,0.08);border:1px solid rgba(240,180,41,0.15);border-radius:9px;padding:10px 14px;margin-bottom:12px;font-size:13px">
        <span style="color:var(--gold);font-weight:700">📅 Scheduled: </span>${sA?.name} vs ${sB?.name} (Leg ${next.leg})
        <button onclick="autoFillScheduled('${next.aId}','${next.bId}')" style="margin-left:8px;background:rgba(240,180,41,0.1);color:var(--gold);border:1px solid rgba(240,180,41,0.2);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Rajdhani',sans-serif">AUTO-FILL</button>
      </div>`;
    }
  }
  document.getElementById('record-body').innerHTML=`
    ${scheduleHint}
    <div class="field"><label>Home</label><select class="select-field" id="rec-a" onchange="buildMatchConsole()"><option value="">— Select —</option>${opts}</select></div>
    <div class="field"><label>Away</label><select class="select-field" id="rec-b" onchange="buildMatchConsole()"><option value="">— Select —</option>${opts}</select></div>
    <div id="master-console" style="margin-top:15px"></div>
    <div style="margin-top:15px; border-top:1px solid var(--border); padding-top:15px">
      <div style="font-size:10px; font-weight:700; color:var(--red); margin-bottom:8px; letter-spacing:1px">⚠️ FORFEIT (WALKOVER)</div>
      <div style="display:flex; gap:10px">
        <button class="btn btn-ghost" style="color:var(--red); border-color:rgba(255,71,87,0.3); font-size:12px; padding:10px" onclick="submitWithdraw('a')">Home Withdrew</button>
        <button class="btn btn-ghost" style="color:var(--red); border-color:rgba(255,71,87,0.3); font-size:12px; padding:10px" onclick="submitWithdraw('b')">Away Withdrew</button>
      </div>
    </div>`;
  document.getElementById('modal-record').classList.add('active');
}

function buildMatchConsole() {
    const t = getTournament();
    const aId = document.getElementById('rec-a').value;
    const bId = document.getElementById('rec-b').value;
    const consoleDiv = document.getElementById('master-console');

    if(!aId || !bId || aId === bId) {
        consoleDiv.innerHTML = '';
        return;
    }

    const tA = t.standings.find(p => p.id === aId);
    const tB = t.standings.find(p => p.id === bId);

    if(t.type === '1v1') {
        consoleDiv.innerHTML = `
            <div class="score-row">
              <div class="score-team" style="color:var(--sub)">${tA.name}</div>
              <input type="number" id="sc-a" class="score-in" value="0" min="0" max="99">
              <div class="score-vs">VS</div>
              <input type="number" id="sc-b" class="score-in" value="0" min="0" max="99">
              <div class="score-team" style="color:var(--sub)">${tB.name}</div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:12px; background:var(--card); padding:10px; border-radius:8px">
                <div>
                    <span style="color:var(--sub); font-size:10px; display:block; margin-bottom:5px">CARDS FOR HOME:</span>
                    <label><input type="checkbox" id="y-${aId}"> 🟨</label>
                    <label style="margin-left:5px"><input type="checkbox" id="r-${aId}"> 🟥</label>
                </div>
                <div style="text-align:right">
                    <span style="color:var(--sub); font-size:10px; display:block; margin-bottom:5px">CARDS FOR AWAY:</span>
                    <label><input type="checkbox" id="y-${bId}"> 🟨</label>
                    <label style="margin-left:5px"><input type="checkbox" id="r-${bId}"> 🟥</label>
                </div>
            </div>
        `;
    } else {
        const renderPlayerRow = (pid, pname) => `
            <div style="display:flex; align-items:center; justify-content:space-between; background:var(--card); padding:8px; margin-bottom:5px; border-radius:8px; border:1px solid var(--border)">
                <div style="font-size:12px; font-weight:700; width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${pname}</div>
                <div style="display:flex; align-items:center; gap:8px">
                    ⚽ <input type="number" id="g-${pid}" value="0" min="0" style="width:40px; background:var(--card2); border:1px solid var(--border); color:white; border-radius:4px; text-align:center; font-family:'Bebas Neue', sans-serif; font-size:16px; padding:2px">
                    <label><input type="checkbox" id="y-${pid}"> 🟨</label>
                    <label><input type="checkbox" id="r-${pid}"> 🟥</label>
                </div>
            </div>
        `;
        
        consoleDiv.innerHTML = `
            <div style="font-size:11px; color:var(--gold); margin-bottom:5px; text-transform:uppercase; font-weight:bold">Home Team (${tA.name})</div>
            ${renderPlayerRow(tA.proId, tA.proName)}
            ${renderPlayerRow(tA.youthId, tA.youthName)}
            
            <div style="font-size:11px; color:var(--gold); margin-top:15px; margin-bottom:5px; text-transform:uppercase; font-weight:bold">Away Team (${tB.name})</div>
            ${renderPlayerRow(tB.proId, tB.proName)}
            ${renderPlayerRow(tB.youthId, tB.youthName)}
        `;
    }
}

function autoFillScheduled(aId,bId){
  const t=getTournament();if(!t)return;
  document.getElementById('rec-a').value=aId;
  document.getElementById('rec-b').value=bId;
  buildMatchConsole(); 
}

function submitWithdraw(whoQuit) {
    const t = getTournament();
    if(!t) return;
    const aId = document.getElementById('rec-a').value;
    const bId = document.getElementById('rec-b').value;
    if(!aId || !bId) { snack('⚠️ Select the players first!'); return; }
    
    // 🔒 Lock: Prevent clicking before the input fields exist
    if(t.type === '1v1' && !document.getElementById('sc-a')) return;
    if(t.type === '2v2') { const _s = t.standings.find(p=>p.id===aId); if(!_s || !document.getElementById(`g-${_s.proId}`)) return; }
    
    if(t.type === '1v1') {
        if(whoQuit === 'a') { document.getElementById('sc-a').value = 0; document.getElementById('sc-b').value = 3; } 
        else { document.getElementById('sc-a').value = 3; document.getElementById('sc-b').value = 0; }
    } else {
        const tA = t.standings.find(p => p.id === aId);
        const tB = t.standings.find(p => p.id === bId);
        if(whoQuit === 'a') {
            document.getElementById(`g-${tA.proId}`).value = 0; document.getElementById(`g-${tA.youthId}`).value = 0;
            document.getElementById(`g-${tB.proId}`).value = 3; document.getElementById(`g-${tB.youthId}`).value = 0;
        } else {
            document.getElementById(`g-${tA.proId}`).value = 3; document.getElementById(`g-${tA.youthId}`).value = 0;
            document.getElementById(`g-${tB.proId}`).value = 0; document.getElementById(`g-${tB.youthId}`).value = 0;
        }
    }
    snack('⚠️ Walkover applied: 3 - 0. Click SAVE RESULT.');
}

// ============================================================
// THE SMART SAVE ENGINE (With Market Value Automation)
// ============================================================
// ============================================================
// THE SMART SAVE ENGINE (WITH BUTTON LOCK)
// ============================================================
async function saveMatch(){
  hideErr('rec-err');
  const aId=document.getElementById('rec-a').value;
  const bId=document.getElementById('rec-b').value;
  if(!aId||!bId){showErr('rec-err','Select both teams/players.');return}
  if(aId===bId){showErr('rec-err','Cannot play against yourself!');return}
  
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t) return;
  const tA=t.standings.find(p=>p.id===aId);
  const tB=t.standings.find(p=>p.id===bId);
  if(!tA||!tB) return;

  let goalsA = 0, goalsB = 0;
  if(t.type === '1v1') {
      goalsA = parseInt(document.getElementById('sc-a').value)||0;
      goalsB = parseInt(document.getElementById('sc-b').value)||0;
  } else {
      [tA.proId, tA.youthId].forEach(pid => { goalsA += parseInt(document.getElementById(`g-${pid}`).value)||0; });
      [tB.proId, tB.youthId].forEach(pid => { goalsB += parseInt(document.getElementById(`g-${pid}`).value)||0; });
  }

  // 🛑 ANTI-DRAW KNOCKOUT SHIELD
  if (goalsA === goalsB && t.phase === 'elimination') {
      showErr('rec-err', 'Knockout matches cannot end in a draw! Play penalties and add 1 goal to the winner.');
      return;
  }

  // 🛑 قفل الزر لمنع الضغط المزدوج
  const btn = document.querySelector('#modal-record .btn-green');
  if(btn) { btn.innerHTML = '⏳ SAVING...'; btn.style.pointerEvents = 'none'; }

  let matchEvents = { goals: {}, cards: {} };
  if(t.type === '1v1') {
      matchEvents.goals[aId] = goalsA; matchEvents.goals[bId] = goalsB;
      if(document.getElementById(`y-${aId}`)?.checked) matchEvents.cards[aId] = 'yellow';
      if(document.getElementById(`r-${aId}`)?.checked) matchEvents.cards[aId] = 'red';
      if(document.getElementById(`y-${bId}`)?.checked) matchEvents.cards[bId] = 'yellow';
      if(document.getElementById(`r-${bId}`)?.checked) matchEvents.cards[bId] = 'red';
  } else {
      [tA.proId, tA.youthId].forEach(pid => {
          let g = parseInt(document.getElementById(`g-${pid}`).value)||0;
          matchEvents.goals[pid] = g;
          if(document.getElementById(`y-${pid}`)?.checked) matchEvents.cards[pid] = 'yellow';
          if(document.getElementById(`r-${pid}`)?.checked) matchEvents.cards[pid] = 'red';
      });
      [tB.proId, tB.youthId].forEach(pid => {
          let g = parseInt(document.getElementById(`g-${pid}`).value)||0;
          matchEvents.goals[pid] = g;
          if(document.getElementById(`y-${pid}`)?.checked) matchEvents.cards[pid] = 'yellow';
          if(document.getElementById(`r-${pid}`)?.checked) matchEvents.cards[pid] = 'red';
      });
  }

  const matchRecord={
      teamA:tA.name, teamB:tB.name, aId, bId, goalsA, goalsB, 
      ts:Date.now(), votes:{}, motm:null, avgRatings:{}, events: matchEvents 
  };
  t.matches.push(matchRecord);

  tA.PL++;tB.PL++;
  tA.GF+=goalsA;tA.GA+=goalsB;tB.GF+=goalsB;tB.GA+=goalsA;
  tA.GD=tA.GF-tA.GA;tB.GD=tB.GF-tB.GA;
  if(goalsA>goalsB){tA.W++;tA.PTS+=3;tB.L++}
  else if(goalsB>goalsA){tB.W++;tB.PTS+=3;tA.L++}
  else{tA.D++;tA.PTS++;tB.D++;tB.PTS++}

  if(t.schedule){
    const schedIdx=t.schedule.findIndex(m=>!m.played&&((m.aId===aId&&m.bId===bId)||(m.aId===bId&&m.bId===aId)));
    if(schedIdx>=0)t.schedule[schedIdx].played=true;
  }
  if(t.bracket) updateBracket(t,aId,bId,goalsA,goalsB);

  Object.keys(matchEvents.goals).forEach(pid => {
      let g = matchEvents.goals[pid]; let card = matchEvents.cards[pid];
      let matchResult = 'draw';
      let isTeamA = (t.type === '1v1' ? pid === aId : (pid === tA.proId || pid === tA.youthId));
      let isTeamB = (t.type === '1v1' ? pid === bId : (pid === tB.proId || pid === tB.youthId));
      if(isTeamA && goalsA > goalsB) matchResult = 'win';
      else if(isTeamA && goalsA < goalsB) matchResult = 'loss';
      else if(isTeamB && goalsB > goalsA) matchResult = 'win';
      else if(isTeamB && goalsB < goalsA) matchResult = 'loss';

      updatePlayerMarketValue(db, pid, { result: matchResult, goals: g, card: card });
      if(g > 0 && card !== 'red') { 
          const p = db.players.find(x => x.id === pid);
          if(p) { p.stats.goals = (p.stats.goals || 0) + g; awardXP(db, pid, g * 10); }
      }
  });

  let teamA_Ids = t.type === '1v1' ? [aId] : [tA.proId, tA.youthId];
  let teamB_Ids = t.type === '1v1' ? [bId] : [tB.proId, tB.youthId];
  let resultA = goalsA > goalsB ? 1 : (goalsA < goalsB ? 0 : 0.5);
  
  updateELO(db, teamA_Ids, teamB_Ids, resultA);
  teamA_Ids.forEach(id => awardXP(db, id, goalsA > goalsB ? 30 : (goalsA === goalsB ? 10 : 5)));
  teamB_Ids.forEach(id => awardXP(db, id, goalsB > goalsA ? 30 : (goalsA === goalsB ? 10 : 5)));

  Object.keys(matchEvents.cards).forEach(pid => {
      const cardType = matchEvents.cards[pid]; const p = db.players.find(x => x.id === pid);
      if(!p) return;
      if(cardType === 'yellow') p.stats.yellow = (p.stats.yellow || 0) + 1;
      else if (cardType === 'red') {
          p.stats.red = (p.stats.red || 0) + 1; p.stats.points = (p.stats.points || 0) - 1; 
          let entry = (t.type === '1v1') 
              ? t.standings.find(s => s.id === pid) 
              : t.standings.find(s => s.proId === pid || s.youthId === pid);
          if(entry) {
              entry.reds = entry.reds || {}; entry.reds[pid] = (entry.reds[pid] || 0) + 1;
              if(entry.reds[pid] > 3) {
                  if(t.format === 'league') { entry.PTS -= 4; addNews(`🚨 PENALTY: ${p.name} exceeded 3 red cards. Team loses 4 Points!`,'🚨'); }
                  p.status = 'suspended'; 
              }
          }
      }
  });

  const goalDiff = Math.abs(goalsA - goalsB); let headline = '';
  if (goalsA > goalsB) headline = goalDiff >= 3 ? `💥 DEMOLITION: ${tA.name} destroys ${tB.name} ${goalsA}-${goalsB}!` : `👏 SOLID WIN: ${tA.name} edges past ${tB.name} ${goalsA}-${goalsB}.`;
  else if (goalsB > goalsA) headline = goalDiff >= 3 ? `💥 DEMOLITION: ${tB.name} destroys ${tA.name} ${goalsB}-${goalsA}!` : `👏 SOLID WIN: ${tB.name} edges past ${tA.name} ${goalsB}-${goalsA}.`;
  else headline = `🤝 STALEMATE: A tense battle ends ${goalsA}-${goalsB} between ${tA.name} and ${tB.name}.`;
  
  addNews(headline, '📰');
  checkAchievements(db, matchEvents);
  
  // 🛡️ حزام الأمان (Try/Catch) لمنع تجمد الزر
  try {
      await saveSingleTournament(t);
      if(t.type === '1v1') {
          await saveSinglePlayer(db.players.find(x => x.id === aId)); await saveSinglePlayer(db.players.find(x => x.id === bId));
      } else {
          await saveSinglePlayer(db.players.find(x => x.id === tA.proId)); await saveSinglePlayer(db.players.find(x => x.id === tA.youthId));
          await saveSinglePlayer(db.players.find(x => x.id === tB.proId)); await saveSinglePlayer(db.players.find(x => x.id === tB.youthId));
      }
      localStorage.setItem(DB_KEY, JSON.stringify(db));

      closeModal('modal-record');
      renderTournamentScreen();
      showGoalAnimation(`${goalsA} – ${goalsB}`);
      snack(`⚽ ${tA.name} ${goalsA}–${goalsB} ${tB.name}`);
  } catch(err) {
      console.error(err);
      showErr('rec-err', '❌ Network Error. Match not saved.');
  } finally {
      // 🔓 فك تجميد الزر دائماً مهما حدث
      if(btn) { btn.innerHTML = '✅ SAVE RESULT'; btn.style.pointerEvents = 'auto'; }
  }
}

function updateBracket(t,aId,bId,goalsA,goalsB){
  if(!t.bracket)return;
  for(let r=0;r<t.bracket.length;r++){
    for(let m=0;m<t.bracket[r].length;m++){
      const match=t.bracket[r][m];
      if((match.p1===aId&&match.p2===bId)||(match.p1===bId&&match.p2===aId)){
        if(match.winner)return;
        match.score1=match.p1===aId?goalsA:goalsB;
        match.score2=match.p1===aId?goalsB:goalsA;
        match.winner=goalsA>goalsB?aId:goalsB>goalsA?bId:null;
        if(match.winner&&r+1<t.bracket.length){
          const nextMatchIdx=Math.floor(m/2);
          const nextMatch=t.bracket[r+1][nextMatchIdx];
          if(!nextMatch)return;
          if(m%2===0)nextMatch.p1=match.winner;
          else nextMatch.p2=match.winner;
        }
        return;
      }
    }
  }
}

function awardXP(db,pid,xp){
  const p=db.players.find(x=>x.id===pid);if(!p)return;
  p.stats=p.stats||{xp:0,points:0,trophies:0,goals:0};
  p.stats.xp=(p.stats.xp||0)+xp;
}

// ============================================================
// MOTM VOTING
// ============================================================
// ============================================================
// THE REALISTIC VOTING SYSTEM (Hides Red Cards + 2v2 Support)
// ============================================================
function openMotmVote(matchIdx){
  const t=getTournament();if(!t)return;
  const match=t.matches[matchIdx];if(!match)return;
  if(!currentUser){snack('Login to vote!');return}
  const hasVoted=match.votes&&match.votes[currentUser.id];
  motmMatchIdx=matchIdx;
  motmVotes={motm:null,ratings:{}};
  const db=getDB();
  
  let pids = [];
  if(t.type === '1v1') pids = [match.aId, match.bId];
  else {
      const tA = t.standings.find(s=>s.id === match.aId);
      const tB = t.standings.find(s=>s.id === match.bId);
      if(tA) pids.push(tA.proId, tA.youthId);
      if(tB) pids.push(tB.proId, tB.youthId);
  }
  
  const validPids = pids.filter(id => !match.events || !match.events.cards || match.events.cards[id] !== 'red');
  const players = validPids.map(id => db.players.find(x=>x.id===id)||{id,name:id});

  let resultsHtml='';
  if(hasVoted||t.status==='ended'){
    const allVotes=Object.values(match.votes||{});
    const motmCounts={};
    players.forEach(p=>{
      const votes=allVotes.filter(v=>v.motm===p.id);
      motmCounts[p.id]=votes.length;
      const avgRating=votes.length?Math.round(votes.reduce((s,v)=>s+(v.ratings[p.id]||3),0)/votes.length*10)/10:0;
      resultsHtml+=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="flex:1;font-size:13px;font-weight:600">${p.name}</span>
        <span style="color:var(--gold);font-size:12px">⭐ ${avgRating}/5</span>
        <span style="color:var(--sub);font-size:11px">${motmCounts[p.id]||0} MOTM votes</span>
      </div>`;
    });
    const motmWinner=Object.entries(motmCounts).sort((a,b)=>b[1]-a[1])[0];
    const winnerName=motmWinner?db.players.find(x=>x.id===motmWinner[0])?.name||motmWinner[0]:'N/A';
    document.getElementById('motm-body').innerHTML=`
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:11px;color:var(--gold);letter-spacing:2px;font-weight:700;margin-bottom:6px">MATCH: ${match.teamA} ${match.goalsA}–${match.goalsB} ${match.teamB}</div>
        ${hasVoted?`<div style="font-size:12px;color:var(--green);font-weight:600">✅ You already voted</div>`:''}
      </div>
      <div style="background:var(--card);border-radius:12px;padding:14px;margin-bottom:12px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin-bottom:10px">CURRENT RESULTS</div>
        ${resultsHtml}
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--gold);font-weight:700">🏅 Man of the Match: ${winnerName}</div>
      </div>
      <button class="btn btn-ghost" onclick="closeModal('modal-motm')">Close</button>`;
    document.getElementById('modal-motm').classList.add('active');
    return;
  }

  let votingHtml=`<div style="text-align:center;margin-bottom:16px;font-size:14px;font-weight:600">${match.teamA} <span style="color:var(--gold)">${match.goalsA}–${match.goalsB}</span> ${match.teamB}</div>`;
  if(players.length === 0) votingHtml += `<div style="font-size:12px; color:var(--red); text-align:center">All players received Red Cards. No MOTM possible.</div>`;
  players.forEach(p=>{
    const isMe = (currentUser.id === p.id);
    votingHtml+=`<div class="motm-section" style="${isMe ? 'opacity:0.4; pointer-events:none' : ''}">
      <div class="motm-title">${isMe ? 'Fair Play: Cannot vote for yourself' : 'Rate: ' + p.name}</div>
      <div class="motm-player-row">
        <div class="motm-name">${p.name}</div>
        <div class="motm-stars">
          ${[1,2,3,4,5].map(n=>`<button class="motm-star-btn" data-player="${p.id}" data-star="${n}" onclick="setMotmStar('${p.id}',${n})">⭐</button>`).join('')}
        </div>
      </div>
      <button class="motm-pick-btn" data-motm="${p.id}" onclick="setMotmPick('${p.id}','${encodeURIComponent(p.name)}')">🏅 Vote as MOTM</button>
    </div>`;
  });
  document.getElementById('motm-body').innerHTML=votingHtml;
  document.getElementById('modal-motm').classList.add('active');
}

function setMotmStar(pid,stars){
  motmVotes.ratings[pid]=stars;
  document.querySelectorAll(`.motm-star-btn[data-player="${pid}"]`).forEach(btn=>{
    btn.classList.toggle('lit',parseInt(btn.dataset.star)<=stars);
  });
}
function setMotmPick(pid,encodedName){
  motmVotes.motm=pid;
  document.querySelectorAll('.motm-pick-btn').forEach(btn=>{
    btn.classList.toggle('picked',btn.dataset.motm===pid);
  });
  snack(`🏅 Voted for ${decodeURIComponent(encodedName)} as MOTM`);
}

// ============================================================
// THE SECURE MOTM VOTE (Exploit Fix + Tournament Lock)
// ============================================================
// ============================================================
// THE SECURE MOTM VOTE (Exploit Fix + Button Lock)
// ============================================================
async function submitMotmVote(){
  if(!currentUser){snack('Login to vote!');return}
  if(!motmVotes.motm){showErr('motm-err','Pick a Man of the Match!');return}
  const db=getDB();
  const t=getTournament();
  if(!t){closeModal('modal-motm');return}
  const match=t.matches[motmMatchIdx];
  if(!match){closeModal('modal-motm');return}
  
  if(t.status === 'ended') {
      showErr('motm-err', 'Voting is permanently locked. The Cup has ended!');
      return;
  }

  // 🛑 قفل الزر لمنع الضغط المزدوج
  const btn = document.querySelector('#modal-motm .btn-gold');
  if(btn) { btn.innerHTML = '⏳ SAVING...'; btn.style.pointerEvents = 'none'; }

  match.votes=match.votes||{};
  match.votes[currentUser.id]={motm:motmVotes.motm,ratings:motmVotes.ratings};
  const allVotes=Object.values(match.votes);
  
  let pids = [];
  if(t.type === '1v1') pids = [match.aId, match.bId];
  else {
      const tA = t.standings.find(s=>s.id === match.aId);
      const tB = t.standings.find(s=>s.id === match.bId);
      if(tA) pids.push(tA.proId, tA.youthId);
      if(tB) pids.push(tB.proId, tB.youthId);
  }

  const motmCounts={};
  pids.forEach(pid=>{
    if(match.events && match.events.cards && match.events.cards[pid] === 'red') return; 
    const vs=allVotes.filter(v=>v.motm===pid);
    if(vs.length > 0) motmCounts[pid]=vs.length;
    const avg=vs.length?Math.round(vs.reduce((s,v)=>s+(v.ratings[pid]||3),0)/vs.length*10)/10:0;
    match.avgRatings=match.avgRatings||{};
    match.avgRatings[pid]=avg;
  });
  
  const winner=Object.entries(motmCounts).sort((a,b)=>b[1]-a[1])[0];
  const prevMotmName=match.motm;
  let playersToSave = [];

  if(winner){
    const winnerPlayer = db.players.find(x=>x.id===winner[0]);
    const winnerName = winnerPlayer ? winnerPlayer.name : winner[0];
    
    if(prevMotmName !== winnerName){
      if(prevMotmName) {
          const oldWinner = db.players.find(x=>x.name===prevMotmName);
          if(oldWinner) {
              oldWinner.stats.xp = Math.max(0, (oldWinner.stats.xp || 0) - 30);
              oldWinner.marketValue = Math.max(100000, (oldWinner.marketValue || 500000) - 200000);
              playersToSave.push(oldWinner);
          }
      }
      match.motm = winnerName; awardXP(db,winner[0],30); awardMotmValue(db,winner[0]);
      if(winnerPlayer) playersToSave.push(winnerPlayer);
      addNews(`🏅 ${winnerName} won Man of the Match!`,'⭐');
    }
  }
  
  await saveSingleTournament(t);
  for(let p of playersToSave) { await saveSinglePlayer(p); }
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  if(btn) { btn.innerHTML = '✅ SUBMIT RATINGS'; btn.style.pointerEvents = 'auto'; }
  closeModal('modal-motm'); renderTournamentScreen(); snack('✅ Vote submitted!');
}

// ============================================================
// END CUP
// ============================================================
function confirmEnd(){document.getElementById('conf-ov').classList.add('active')}
// ============================================================
// END CUP (FIXED TRUE CHAMPION LOGIC)
// ============================================================
// ============================================================
// END CUP (ANTI-SPAM & SAFE SAVE FIX)
// ============================================================
async function endCup(){
  const db=getDB();
  const t=db.tournaments[activeTournIdx];
  if(!t) { closeConf(); return; }
  
  // 🛑 الحماية من التكرار (منع ثغرة الجوائز اللانهائية)
  if(t.status === 'ended') { closeConf(); snack('⚠️ Cup is already ended!'); return; }
  if(t.matches.length===0){closeConf();snack('⚠️ Record at least one match first!');return}
  
  const btn = document.querySelector('.conf-btns .btn-red');
  if(btn) { btn.innerHTML = '⏳ SAVING...'; btn.style.pointerEvents = 'none'; }
  
  const goalCounts={};
  t.matches.forEach(m=>{if(m.events&&m.events.goals){Object.keys(m.events.goals).forEach(pid=>{goalCounts[pid]=(goalCounts[pid]||0)+m.events.goals[pid];});}});
  let topScorerIds=[];let maxGoals=0;
  Object.keys(goalCounts).forEach(pid=>{if(goalCounts[pid]>maxGoals){maxGoals=goalCounts[pid];topScorerIds=[pid];}else if(goalCounts[pid]===maxGoals&&maxGoals>0){topScorerIds.push(pid);}});
  
  let winner;
  if(t.phase === 'elimination' && t.bracket && t.bracket.length > 0) {
      const finalMatch = t.bracket[t.bracket.length - 1][0];
      if(!finalMatch.winner) {
          closeConf(); snack('⚠️ The Final Match is not played yet!'); 
          if(btn) { btn.innerHTML = 'End Cup'; btn.style.pointerEvents = 'auto'; }
          return;
      }
      winner = t.standings.find(s => s.id === finalMatch.winner);
  } else {
      winner = sortedStandings(t)[0];
  }
  if(!winner) { closeConf(); snack('⚠️ Could not determine a winner!'); if(btn){btn.innerHTML='End Cup';btn.style.pointerEvents='auto';} return; }

  t.standings.forEach(entry=>{
    const pids=t.type==='1v1'?[entry.id]:[entry.proId,entry.youthId].filter(Boolean);
    pids.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(!p)return;p.stats=p.stats||{xp:0,points:0,trophies:0,goals:0,elo:1000,goldenBoots:0};p.stats.points=(p.stats.points||0)+entry.PTS;});
  });
  
  const winPids=t.type==='1v1'?[winner.id]:[winner.proId,winner.youthId].filter(Boolean);
  winPids.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(!p)return;p.stats.trophies=(p.stats.trophies||0)+1;awardXP(db,pid,200);p.marketValue=(p.marketValue||500000)+500000;});
  
  let bootNames=[];
  topScorerIds.forEach(pid=>{const p=db.players.find(x=>x.id===pid);if(p){p.stats.goldenBoots=(p.stats.goldenBoots||0)+1;awardXP(db,pid,100);p.marketValue=(p.marketValue||500000)+300000;bootNames.push(p.name);}});
  
  t.status='ended';
  addNews(`🏆 "${t.name}" ended! Winner: ${winner.name}! 🎉`,'🏆');
  if(bootNames.length>0)addNews(`🥾 GOLDEN BOOT: ${bootNames.join(' & ')} (${maxGoals} Goals)`,'🥾');
  
  // رفع البيانات للسيرفر بأمان تام
  await saveSingleTournament(t);
  const playersToSave = new Set();
  t.standings.forEach(entry => {
      if(t.type === '1v1') Object.keys(entry).includes('id') && playersToSave.add(entry.id);
      else { if(entry.proId) playersToSave.add(entry.proId); if(entry.youthId) playersToSave.add(entry.youthId); }
  });
  for(let pid of Array.from(playersToSave)) {
      const p = db.players.find(x => x.id === pid);
      if(p) await saveSinglePlayer(p);
  }
  localStorage.setItem(DB_KEY, JSON.stringify(db));

  if(btn) { btn.innerHTML = 'End Cup'; btn.style.pointerEvents = 'auto'; }
  closeConf();renderTournamentScreen();showGoalAnimation('🏆 CHAMPION!');snack(`🏆 ${winner.name} wins the cup!`);setTimeout(()=>showWinnerCelebration(winner,t,db),1200);
}

// ============================================================
// DELETE TOURNAMENT (ADMIN ONLY)
// ============================================================
async function deleteTournament(){
  if(currentUser?.type !== 'admin') return;
  const db = getDB();
  const t = db.tournaments[activeTournIdx];
  if(!t) return;
  
  const confirmText = prompt(`⚠️ DANGER: Type "DELETE" to permanently remove the tournament "${t.name}". This cannot be undone!`);
  if(confirmText !== "DELETE") { snack("❌ Deletion canceled."); return; }
  
  try {
      // Delete from Supabase Server
      await supabaseClient.from('tournaments').delete().eq('id', t.id);
      
      // Delete from Local UI
      db.tournaments.splice(activeTournIdx, 1);
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      
      snack(`🗑️ Tournament "${t.name}" deleted successfully.`);
      backToApp(); // Return to main arena
  } catch(err) {
      console.error(err);
      snack("❌ Error deleting tournament from server.");
  }
}

function showWinnerCelebration(winner,t,db){
  const p = (t.type === '1v1') ? db.players.find(x=>x.id===winner.id) : null;
  const avEl=document.getElementById('winner-avatar');
  if(p?.photo)avEl.innerHTML=`<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover">`;
  else avEl.innerHTML=initials(winner.name);
  document.getElementById('winner-name').textContent=winner.name;
  document.getElementById('winner-cup-name').textContent=`🏆 ${t.name} Champion`;
  const conf=document.getElementById('winner-confetti');
  conf.innerHTML='';
  const colors=['#f0b429','#ffd166','#06d77b','#4dabf7','#ff4757','#a855f7'];
  for(let i=0;i<60;i++){
    const d=document.createElement('div');
    d.className='confetti-piece';
    d.style.cssText=`left:${Math.random()*100}%;background:${colors[i%colors.length]};animation:confettiFall ${1.5+Math.random()*2}s ${Math.random()*2}s linear forwards;width:${4+Math.random()*8}px;height:${4+Math.random()*8}px;border-radius:${Math.random()>0.5?'50%':'2px'}`;
    conf.appendChild(d);
  }
  document.getElementById('winner-overlay').classList.add('active');
}
function closeWinnerOverlay(){document.getElementById('winner-overlay').classList.remove('active')}

// ============================================================
// LOCKER ROOM
// ============================================================
function renderLocker(){
  const db=getDB();const isAdmin=currentUser?.type==='admin';
  const container=document.getElementById('tab-locker');
  let html='';
  
  if(isAdmin){
    const pend=db.pending||[];
    html+=`<div class="req-box">
      <div class="req-box-title">📥 Pending Requests <span style="background:rgba(255,71,87,0.18);padding:1px 8px;border-radius:10px">${pend.length}</span></div>
      ${pend.length===0?'<div style="font-size:13px;color:var(--sub)">No pending requests.</div>'
        :pend.map((p,i)=>`<div class="req-item">
          <div class="pav" style="width:40px;height:40px;font-size:14px;flex-shrink:0">${p.photo?`<img src="${p.photo}">`:initials(p.name)}</div>
          <div class="req-info"><div class="req-name">${p.name}</div><div class="req-sub">Waiting for approval</div></div>
          <button class="btn-ok" onclick="approvePlayer(${i})">APPROVE</button>
          <button class="btn-x" onclick="denyPlayer(${i})">✕</button>
        </div>`).join('')}
    </div>`;
  }

  // Helper to draw cards
  const createCard = (p, i, isMyDashboard) => {
      let opacityStyle = (p.status === 'archived') ? 'opacity: 0.4; filter: grayscale(1);' : '';
      let dashStyle = isMyDashboard ? 'border: 1px solid var(--gold); box-shadow: 0 0 20px rgba(240,180,41,0.15); background: linear-gradient(135deg, rgba(240,180,41,0.1), var(--card));' : '';
      const xp=p.stats?.xp||0;const lvl=getLevelFromXP(xp);const stars=p.stars||0;const tier=p.tier||'youth';
      const xpThisLevel=lvl>1?xpForLevel(lvl):0;const xpNextLevel=xpForLevel(lvl+1);
      const xpPct=lvl>=100?100:Math.round(((xp-xpThisLevel)/(xpNextLevel-xpThisLevel))*100);
      const starHTML=[1,2,3,4,5].map(n=>`<button class="star-b ${stars>=n?'lit':''}" onclick="${isAdmin?`setStar(${i},${n})`:'void(0)'}" ${isAdmin?'':'disabled'}>⭐</button>`).join('');
      
      return `<div class="player-card" style="${opacityStyle} ${dashStyle}">
        <div class="pav" style="cursor:pointer" onclick="openProfile(${i},${currentUser?.id===p.id})">${p.photo?`<img src="${p.photo}">`:`${initials(p.name)}`}</div>
        <div class="p-info" style="cursor:pointer" onclick="openProfile(${i},${currentUser?.id===p.id})">
          <div class="p-name">${p.name} ${p.status === 'suspended' ? '<span style="background:var(--red); color:#fff; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:bold; margin-left:5px">🟥 SUSPENDED</span>' : ''} <span class="lvl-badge">LVL ${lvl}</span><span class="tier-chip ${tier==='pro'?'tc-pro':'tc-youth'}">${tier==='pro'?'⭐ PRO':'🌱 YOUTH'}</span></div>
          <div class="p-id">${p.id}</div>
          <div class="star-row">${starHTML}</div>
          <div class="xp-bar-wrap"><div class="xp-bar" style="width:${xpPct}%"></div></div>
          <div style="font-size:10px;color:var(--sub);margin-top:3px;font-weight:600">${xp} XP</div>
        </div>
        ${isAdmin?`<button class="tier-toggle-btn" onclick="openAdminManagePlayer(${i})" style="color:var(--blue)">MANAGE</button>`:''}
      </div>`;
  };

  if(currentUser?.type === 'player'){
      const myIdx = db.players.findIndex(x => x.id === currentUser.id);
      if(myIdx >= 0){
          html += `<div class="sec-hdr"><div class="sec-ttl" style="color:var(--gold)">🌟 My Dashboard</div></div>`;
          html += `<div class="player-list" style="margin-bottom:18px">${createCard(db.players[myIdx], myIdx, true)}</div>`;
      }
  }

  html+=`<div class="sec-hdr"><div class="sec-ttl">👕 Official Roster</div><div style="font-size:12px;color:var(--sub)">${db.players.length} players</div></div>`;
  html+=`<div class="player-list">`;
  db.players.forEach((p,i)=>{
      if(p.status === 'archived' && !isAdmin) return;
      if(p.status === 'banned') return;
      if(currentUser?.type === 'player' && p.id === currentUser.id) return; 
      html += createCard(p, i, false);
  });
  html+='</div>';
  container.innerHTML=html;
}

function getPlayerForm(pid,db){
  const matches=[];
  db.tournaments.forEach(t=>{
    (t.matches||[]).forEach(m=>{
      if(t.type === '1v1') {
          if(m.aId===pid||m.bId===pid) matches.push({m,isA:m.aId===pid,ts:m.ts});
      } else {
          // 2v2 Logic
          if(m.events && m.events.goals && m.events.goals[pid] !== undefined) {
              const tA = t.standings.find(s => s.id === m.aId);
              const isA = tA && (tA.proId === pid || tA.youthId === pid);
              matches.push({m, isA: !!isA, ts: m.ts});
          }
      }
    });
  });
  matches.sort((a,b)=>b.ts-a.ts);
  return matches.slice(0,5).map(({m,isA})=>{
    const myG=isA?m.goalsA:m.goalsB;const thG=isA?m.goalsB:m.goalsA;
    if(myG>thG)return`<div class="form-w">W</div>`;
    if(thG>myG)return`<div class="form-l">L</div>`;
    return`<div class="form-d">D</div>`;
  }).join('');
}

function getPlayerAvgRating(pid,db){
  let total=0,count=0;
  db.tournaments.forEach(t=>{
    (t.matches||[]).forEach(m=>{
      if((m.aId===pid||m.bId===pid)&&m.avgRatings&&m.avgRatings[pid]){
        total+=m.avgRatings[pid];count++;
      }
    });
  });
  if(!count)return null;
  return Math.round(total/count*10)/10;
}

// ============================================================
// ADMIN APPROVAL (TARGETED ASYNC QUERIES)
// ============================================================
async function approvePlayer(idx){
  const db=getDB();
  const req=db.pending[idx];
  if(!req) return;
  
  let id = req.username; 
  
  // 🔒 Anti-Duplicate Check
  if(db.players.some(x => x.id === id)) {
      snack('⚠️ Username already exists!');
      await supabaseClient.from('pending_requests').delete().eq('username', id);
      db.pending.splice(idx,1);
      renderLocker();
      return;
  }
  
  const newPlayer = {
      player_id: id, name: req.name, pin: req.pin, photo: req.photo||'', 
      tier: 'youth', stars: 0, stats: {xp:0,points:0,trophies:0,goals:0}, 
      market_value: 500000, status: 'active'
  };

  try {
      // 1. Insert directly into players table
      const { error: insertErr } = await supabaseClient.from('players').insert([newPlayer]);
      if(insertErr) throw insertErr;

      // 2. Delete exactly one row from pending_requests
      await supabaseClient.from('pending_requests').delete().eq('username', id);

      // 3. Update Local UI safely
      db.players.push({id:id, name:req.name, pin:req.pin, photo:req.photo||'', tier:'youth', stars:0, stats:{xp:0,points:0,trophies:0,goals:0}, marketValue:500000, status: 'active'});
      db.pending.splice(idx,1);
      
      addNews(`✅ ${req.name} joined! Username: ${id}`,'👋');
      snack(`✅ Approved! Username: ${id}`);
      renderLocker();
  } catch (err) {
      console.error(err);
      snack('❌ Failed to approve player on server.');
  }
}

async function denyPlayer(idx){
  const db=getDB();
  const req=db.pending[idx];
  if(!req) return;

  try {
      // Target specific deletion
      await supabaseClient.from('pending_requests').delete().eq('username', req.username);
      
      const name = req.name;
      db.pending.splice(idx,1);
      snack(`Removed request from ${name}`);
      renderLocker();
  } catch (err) {
      console.error(err);
      snack('❌ Network Error.');
  }
}
async function setStar(playerIdx,stars){
  const db=getDB();db.players[playerIdx].stars=stars;
  await saveSinglePlayer(db.players[playerIdx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderLocker();
}
async function toggleTier(playerIdx){
  const db=getDB();const p=db.players[playerIdx];p.tier=p.tier==='pro'?'youth':'pro';
  await saveSinglePlayer(p); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack(`${p.name} is now ${p.tier==='pro'?'⭐ PRO':'🌱 YOUTH'}`);renderLocker();
}

function openAdminManagePlayer(idx){
  const db=getDB();const p=db.players[idx];if(!p)return;
  const body=document.getElementById('admin-player-body');
  body.innerHTML=`
    <div style="text-align:center;margin-bottom:16px">
      <div class="pav" style="width:60px;height:60px;margin:0 auto 10px;font-size:20px">${p.photo?`<img src="${p.photo}">`:`${initials(p.name)}`}</div>
      <div style="font-weight:700;font-size:16px">${p.name}</div>
      <div style="font-size:11px;color:var(--sub)">${p.id}</div>
    </div>
    <div class="settings-card">
      <div class="settings-title">✏️ Edit Name</div>
      <div class="field"><label>New Name</label><input id="manage-name" type="text" value="${p.name}"></div>
      <button class="btn btn-blue" onclick="adminUpdateName(${idx})">UPDATE NAME</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🔑 Reset PIN</div>
      <div class="field"><label>New PIN</label><input id="manage-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn btn-gold" onclick="adminUpdatePin(${idx})">RESET PIN</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🖼️ Update Photo</div>
      <div class="photo-row">
        <div class="photo-preview" id="manage-photo-prev" onclick="document.getElementById('manage-photo-file').click()">${p.photo?`<img src="${p.photo}">`:'📷'}</div>
        <div><div style="font-size:14px;font-weight:600">Tap to change</div></div>
      </div>
      <input type="file" id="manage-photo-file" accept="image/*" style="display:none" onchange="handlePhoto(this,'manage-photo-prev','manage-photo-data')">
      <input type="hidden" id="manage-photo-data">
      <button class="btn btn-green" onclick="adminUpdatePhoto(${idx})">UPDATE PHOTO</button>
    </div>
    <div class="settings-card" style="border-color:rgba(255,71,87,0.3)">
      <div class="settings-title" style="color:var(--red)">📦 Archive Player</div>
      <div style="font-size:11px; color:var(--sub); margin-bottom:8px;">Archiving hides the player from the Locker Room but keeps their stats safe.</div>
      <button class="btn btn-gold" style="margin-bottom:10px" onclick="adminToggleArchive(${idx})">${p.status === 'archived' ? 'UN-ARCHIVE PLAYER' : 'ARCHIVE PLAYER'}</button>
      
      <div class="settings-title" style="color:var(--red); margin-top:15px; border-top:1px solid rgba(255,71,87,0.2); padding-top:10px">🚫 Danger Zone</div>
      ${p.status === 'suspended' ? `<button class="btn btn-blue" style="margin-bottom:10px" onclick="adminClearSuspension(${idx})">✅ CLEAR SUSPENSION</button>` : ''}
      <button class="btn btn-red" onclick="adminToggleBan(${idx})">${p.status === 'banned' ? 'RESTORE PLAYER' : 'BAN / REMOVE PLAYER'}</button>
    </div>`;
  document.getElementById('modal-admin-player').classList.add('active');
}

// ============================================================
// ADMIN CONTROLS (WITH FORCED CLOUD SAVE)
// ============================================================
async function adminToggleBan(idx) {
    const db=getDB();const p=db.players[idx];
    if(!p) return;
    if(p.status==='banned'){p.status='active';snack(`✅ ${p.name} is RESTORED.`);}
    else{p.status='banned';snack(`🚫 ${p.name} is BANNED.`);}
    await saveSinglePlayer(p); localStorage.setItem(DB_KEY,JSON.stringify(db));
    closeModal('modal-admin-player');renderLocker();
}
async function adminToggleArchive(idx) {
    const db=getDB();const p=db.players[idx];
    if(!p) return;
    if(p.status==='archived'){p.status='active';snack(`✅ ${p.name} is now ACTIVE.`);}
    else{p.status='archived';snack(`📦 ${p.name} is now ARCHIVED.`);}
    await saveSinglePlayer(p); localStorage.setItem(DB_KEY,JSON.stringify(db));
    closeModal('modal-admin-player');renderLocker();
}

// ============================================================
// ADMIN CONTROLS (SAFE ASYNC UPDATES)
// ============================================================
async function adminUpdateName(idx){
  const name=document.getElementById('manage-name').value.trim();
  if(!name){snack('Enter a name');return}
  const db=getDB();if(!db.players[idx])return;db.players[idx].name=name;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack(`✅ Name updated to ${name}`);closeModal('modal-admin-player');renderLocker();
}

async function adminUpdatePin(idx){
  const pin=document.getElementById('manage-pin').value.trim();
  if(!/^\d{4}$/.test(pin)){snack('PIN must be 4 digits');return}
  const db=getDB();if(!db.players[idx])return;db.players[idx].pin=pin;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack('✅ PIN updated');closeModal('modal-admin-player');renderLocker();
}

async function adminUpdatePhoto(idx){
  const photo=document.getElementById('manage-photo-data').value;
  if(!photo){snack('Select a photo first');return}
  const db=getDB();if(!db.players[idx])return;db.players[idx].photo=photo;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack('✅ Photo updated');closeModal('modal-admin-player');renderLocker();
}

// ============================================================
// PLAYER PROFILE WITH PERFORMANCE GRAPH
// ============================================================
function openProfile(idx,canEdit=false){
  const db=getDB();const p=db.players[idx];if(!p)return;
  const xp=p.stats?.xp||0;const lvl=getLevelFromXP(xp);const lvlTitle=getLevelTitle(lvl);
  const xpThisLevel=lvl>1?xpForLevel(lvl):0;const xpNextLevel=xpForLevel(lvl+1);
  const xpPct=lvl>=100?100:Math.round(((xp-xpThisLevel)/(xpNextLevel-xpThisLevel))*100);
  const s=p.stats||{};
  const avgRating=getPlayerAvgRating(p.id,db);
  const formHTML=getPlayerForm(p.id,db);

  // --- ENGINE UPGRADE: Calculate Graph Data ---
  const playerMatches = [];
  db.tournaments.forEach(t => {
      (t.matches || []).forEach(m => {
          if (t.type === '1v1') {
              if(m.aId === p.id || m.bId === p.id) {
                  playerMatches.push({ goals: m.aId === p.id ? m.goalsA : m.goalsB, ts: m.ts });
              }
          } else {
              // 2v2 check
              if(m.events && m.events.goals && m.events.goals[p.id] !== undefined) {
                  playerMatches.push({ goals: m.events.goals[p.id], ts: m.ts });
              }
          }
      });
  });
  
  // Sort oldest to newest, get the last 5 matches
  playerMatches.sort((a,b) => a.ts - b.ts);
  const last5 = playerMatches.slice(-5);
  
  // Find the highest goals scored to calculate the bar height percentages
  const maxGoals = Math.max(...last5.map(m => m.goals), 1); 
  
  let graphHtml = `<div class="graph-container">`;
  if(last5.length === 0) {
      graphHtml += `<div style="font-size:11px; color:var(--sub); padding-bottom:10px;">No matches played yet to draw a graph.</div>`;
  } else {
      last5.forEach((m, index) => {
          let heightPercentage = (m.goals / maxGoals) * 100;
          graphHtml += `
          <div class="graph-bar-wrap">
              <div class="graph-val">${m.goals}</div>
              <div class="graph-bar" style="height:${heightPercentage}%"></div>
              <div class="graph-lbl">M${index + 1}</div>
          </div>`;
      });
  }
  graphHtml += `</div>`;
  // ---------------------------------------------

  const badgesHtml = (s.badges && s.badges.length > 0) 
      ? s.badges.map(b => `<div style="display:inline-block; background:rgba(240,180,41,0.1); border:1px solid var(--gold); border-radius:8px; padding:4px 8px; font-size:11px; margin:2px; font-weight:700; color:var(--gold)">${b}</div>`).join('') 
      : '<div style="font-size:11px; color:var(--sub)">No badges yet.</div>';

  document.getElementById('profile-content').innerHTML=`
    <div class="profile-header">
      <div class="profile-avatar">${p.photo?`<img src="${p.photo}">`:`${initials(p.name)}`}</div>
      <div class="profile-name">${p.name}</div>
      <div class="profile-id">${p.id} · ${p.tier==='pro'?'⭐ PRO':'🌱 YOUTH'}</div>
      <div style="margin-top:6px;font-size:16px;color:var(--purple);font-weight:700;font-family:'Bebas Neue',sans-serif;letter-spacing:1px">🌐 ${s.elo || 1000} GLOBAL ELO</div>
      <div style="margin-top:10px"><span class="lvl-badge" style="font-size:13px;padding:4px 14px">LVL ${lvl} · ${lvlTitle}</span></div>
      <div style="margin:12px 0 0">
        <div class="xp-bar-wrap" style="height:6px"><div class="xp-bar" style="width:${xpPct}%"></div></div>
        <div style="font-size:11px;color:var(--sub);margin-top:5px;font-weight:600">${xp} XP · Next at ${xpNextLevel} XP</div>
      </div>
      <div style="display:flex;justify-content:center;gap:4px;margin-top:12px">${formHTML}</div>
    </div>
    
    <div style="margin-top:14px; padding:14px; background:var(--card); border-radius:12px; border:1px solid var(--border); text-align:center">
      <div style="font-size:10px; font-weight:700; letter-spacing:1.5px; color:var(--sub); margin-bottom:8px">ACHIEVEMENTS</div>
      ${badgesHtml}
    </div>

    <div class="stat-grid" style="grid-template-columns: 1fr 1fr 1fr 1fr; gap:6px; margin-top:14px">
      <div class="stat-cell" style="padding:10px 4px"><div class="stat-val" style="font-size:24px">${s.points||0}</div><div class="stat-lbl">Points</div></div>
      <div class="stat-cell" style="padding:10px 4px"><div class="stat-val" style="font-size:24px">${s.trophies||0}</div><div class="stat-lbl">Cups 🏆</div></div>
      <div class="stat-cell" style="padding:10px 4px"><div class="stat-val" style="font-size:24px">${s.goals||0}</div><div class="stat-lbl">Goals ⚽</div></div>
      <div class="stat-cell" style="padding:10px 4px; background:rgba(240,180,41,0.08); border-color:var(--gold)"><div class="stat-val" style="font-size:24px">${s.goldenBoots||0}</div><div class="stat-lbl" style="color:var(--gold)">Boots 🥾</div></div>
    </div>

    <div class="stat-grid" style="margin-top:8px; grid-template-columns: 1fr 1fr;">
      <div class="stat-cell" style="background:rgba(240,180,41,0.05); border-color:rgba(240,180,41,0.2)">
        <div class="stat-val" style="color:var(--gold)">${s.yellow||0}</div><div class="stat-lbl">Yellows 🟨</div>
      </div>
      <div class="stat-cell" style="background:rgba(255,71,87,0.05); border-color:rgba(255,71,87,0.2)">
        <div class="stat-val" style="color:var(--red)">${s.red||0}</div><div class="stat-lbl">Reds 🟥</div>
      </div>
    </div>

    <div class="graph-card">
      <div class="graph-title">📊 Goals History (Last 5)</div>
      ${graphHtml}
    </div>

    <div style="margin-top:14px;padding:14px;background:var(--card);border-radius:12px;border:1px solid var(--border)">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin-bottom:8px">MARKET VALUE</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:var(--gold)">€${((p.marketValue||500000)/1000000).toFixed(2)}M</div>
    </div>
    ${canEdit?`<button class="btn btn-ghost" style="margin-top:14px" onclick="openEditSelfProfile(${idx})">✏️ Edit My Profile</button>`:''}`;
    
  document.getElementById('modal-profile').classList.add('active');
  
  // Small trick to trigger the animation of the bars growing
  setTimeout(() => {
      document.querySelectorAll('.graph-bar').forEach(bar => {
          let h = bar.style.height;
          bar.style.height = '0%';
          setTimeout(() => { bar.style.height = h; }, 50);
      });
  }, 10);
}

function openEditSelfProfile(idx){
  closeModal('modal-profile');
  const db=getDB();const p=db.players[idx];if(!p)return;
  const body=document.getElementById('edit-profile-body');
  body.innerHTML=`
    <div class="settings-card">
      <div class="settings-title">🖼️ Change Photo</div>
      <div class="photo-row">
        <div class="photo-preview" id="self-photo-prev" onclick="document.getElementById('self-photo-file').click()">${p.photo?`<img src="${p.photo}">`:'📷'}</div>
        <div><div style="font-size:14px;font-weight:600">Tap to upload</div></div>
      </div>
      <input type="file" id="self-photo-file" accept="image/*" style="display:none" onchange="handlePhoto(this,'self-photo-prev','self-photo-data')">
      <input type="hidden" id="self-photo-data" value="${p.photo||''}">
      <button class="btn btn-green" style="margin-top:8px" onclick="selfUpdatePhoto(${idx})">UPDATE PHOTO</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">✏️ Change Name</div>
      <div class="field"><label>New Name</label><input id="self-name" type="text" value="${p.name}"></div>
      <button class="btn btn-blue" onclick="selfUpdateName(${idx})">UPDATE NAME</button>
    </div>
    <div class="settings-card">
      <div class="settings-title">🔑 Change PIN</div>
      <div class="field"><label>Current PIN</label><input id="self-cur-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <div class="field"><label>New PIN</label><input id="self-new-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn btn-gold" onclick="selfUpdatePin(${idx})">CHANGE PIN</button>
    </div>`;
  document.getElementById('modal-edit-profile').classList.add('active');
}

// ============================================================
// PROFILE UPDATES (FIXED ASYNC & NO BULLDOZER)
// ============================================================
async function selfUpdatePhoto(idx){
  const photo=document.getElementById('self-photo-data').value;
  if(!photo){snack('Select a photo');return}
  const db=getDB();db.players[idx].photo=photo;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderUserBadge();snack('✅ Photo updated');closeModal('modal-edit-profile');renderLocker();
}

async function selfUpdateName(idx){
  const name=document.getElementById('self-name').value.trim();
  if(!name){snack('Enter a name');return}
  const db=getDB();db.players[idx].name=name;
  if(currentUser)currentUser.name=name;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderUserBadge();snack('✅ Name updated');closeModal('modal-edit-profile');renderLocker();
}

async function selfUpdatePin(idx){
  const cur=document.getElementById('self-cur-pin').value.trim();
  const nw=document.getElementById('self-new-pin').value.trim();
  const db=getDB();const p=db.players[idx];
  if(p.pin!==cur){snack('❌ Current PIN incorrect');return}
  if(!/^\d{4}$/.test(nw)){snack('New PIN must be 4 digits');return}
  p.pin=nw;
  await saveSinglePlayer(db.players[idx]); // الحفظ الذكي
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  snack('✅ PIN changed');closeModal('modal-edit-profile');
}

// ============================================================
// HALL OF FAME
// ============================================================
function renderHistory(){
  const db=getDB();const el=document.getElementById('tab-history');
  const sorted=[...db.players].sort((a,b)=>{const eloA=a.stats?.elo||1000,eloB=b.stats?.elo||1000;if(eloB!==eloA)return eloB-eloA;return(b.stats?.points||0)-(a.stats?.points||0);});
  if(sorted.length===0){el.innerHTML=`<div class="empty-state"><div class="empty-ico">🏛️</div><div class="empty-txt">Hall of Fame is empty.<br>Complete a tournament to fill it.</div></div>`;return;}
  el.innerHTML=`<div class="sec-hdr"><div class="sec-ttl">👑 Hall of Fame (Global Rank)</div></div><div class="hof-list">
    ${sorted.map((p,i)=>{
      const s=p.stats||{};const xp=s.xp||0;const lvl=getLevelFromXP(xp);const lvlTitle=getLevelTitle(lvl);const elo=s.elo||1000;const pIdx=db.players.indexOf(p);
      return`<div class="hof-item ${i===0?'r1':''}" onclick="openProfile(${pIdx},false)">
        <div class="rank-n">${i===0?'👑':i+1}</div>${avHTML(p,46)}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">${p.name}<span class="lvl-badge" style="font-size:9px">LVL ${lvl}</span></div>
          <div style="font-size:11px;color:var(--sub);margin-top:2px;font-weight:600">${lvlTitle}</div>
          <div class="hof-stats">
            <div class="sp">🌐&thinsp;<strong style="color:var(--purple)">${elo} ELO</strong></div>
            <div class="sp">🏆&thinsp;<strong>${s.trophies||0}</strong></div>
            <div class="sp">🥾&thinsp;<strong style="color:var(--gold)">${s.goldenBoots||0}</strong></div>
            <div class="sp">⚽&thinsp;<strong>${s.goals||0}</strong></div>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ============================================================
// TRANSFER MARKET
// ============================================================
function renderMarket(){
  const db=getDB();const isAdmin=currentUser?.type==='admin';
  const el=document.getElementById('market-content');
  if(db.players.length===0){
    el.innerHTML=`<div class="empty-state"><div class="empty-ico">💸</div><div class="empty-txt">No players in the market yet.</div></div>`;
    return;
  }
  const sorted=[...db.players].sort((a,b)=>(b.marketValue||500000)-(a.marketValue||500000));
  el.innerHTML=`
    <div class="budget-bar">
      <div><div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--sub);margin-bottom:3px">CLUB BUDGET</div><div class="budget-val">€100.00M</div></div>
      <div style="font-size:12px;color:var(--sub);font-weight:600">Virtual Currency</div>
    </div>
    <div style="padding:6px 14px">
      ${sorted.map((p,i)=>{
        const val=p.marketValue||500000;
        const valStr=val>=1000000?`€${(val/1000000).toFixed(2)}M`:`€${(val/1000).toFixed(0)}K`;
        const xp=p.stats?.xp||0;const lvl=getLevelFromXP(xp);
        return`<div class="market-card">
          ${avHTML(p,44)}
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">${p.name}<span class="lvl-badge">LVL ${lvl}</span></div>
            <div style="font-size:12px;color:var(--sub);margin-top:2px;font-weight:600">${p.tier==='pro'?'⭐ PRO':'🌱 YOUTH'} · ${p.stats?.goals||0} goals</div>
          </div>
          <div>
            <div class="market-val">${valStr}</div>
            <div class="market-val-lbl">VALUE</div>
            ${isAdmin?`<button class="bid-btn" style="margin-top:6px" onclick="adjustValue(${i})">ADJUST</button>`:`<button class="bid-btn" style="margin-top:6px;opacity:0.5;cursor:default">BID</button>`}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

async function adjustValue(idx){
  const db=getDB();const p=db.players[idx];
  const cur=((p.marketValue||500000)/1000000).toFixed(2);
  const input=prompt(`Set new market value for ${p.name} (in millions €):`,cur);
  if(!input||isNaN(parseFloat(input)))return;
  p.marketValue=Math.round(parseFloat(input)*1000000);
  // الحفظ الذكي الموجه للاعب واحد فقط
  await saveSinglePlayer(p); 
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  renderMarket();
  snack(`💰 ${p.name} valued at €${parseFloat(input).toFixed(2)}M`);
}

// ============================================================
// GOAL ANIMATION
// ============================================================
function showGoalAnimation(scoreText){
  const ov=document.getElementById('goal-overlay');
  const txt=document.getElementById('goal-text');
  const parts=document.getElementById('goal-particles');
  txt.textContent=scoreText||'GOAL!';
  parts.innerHTML='';
  const colors=['#f0b429','#ffd166','#06d77b','#4dabf7','#ff4757'];
  for(let i=0;i<20;i++){
    const d=document.createElement('div');d.className='particle';
    const angle=(i/20)*360;const dist=120+Math.random()*100;
    const tx=Math.cos(angle*Math.PI/180)*dist;const ty=Math.sin(angle*Math.PI/180)*dist;
    d.style.cssText=`left:50%;top:50%;background:${colors[i%colors.length]};--tx:${tx}px;--ty:${ty}px;animation-delay:${Math.random()*0.2}s`;
    parts.appendChild(d);
  }
  ov.classList.add('show');
  setTimeout(()=>ov.classList.remove('show'),1800);
}

// ============================================================
// REFRESH SYSTEM
// ============================================================
// ============================================================
// REFRESH SYSTEM (HIGH-SPEED PARALLEL FETCH)
// ============================================================
async function refreshData() {
    snack('🔄 Syncing live data...'); 
    try {
        const [pRes, tRes, nRes, pendRes, admRes] = await Promise.all([
            supabaseClient.from('players').select('*'),
            supabaseClient.from('tournaments').select('*'), 
            supabaseClient.from('news').select('*').order('ts', { ascending: false }).limit(20),
            supabaseClient.from('pending_requests').select('*'),
            supabaseClient.from('admin_settings').select('value').eq('key', 'codes').single()
        ]);

        if(pRes.error) console.error("Players Fetch Error:", pRes.error);
        if(tRes.error) console.error("Tournaments Fetch Error:", tRes.error);

        if(pRes.data) cloudDB.players = pRes.data.map(p => ({
            id: p.player_id, name: p.name, pin: p.pin, photo: p.photo,
            tier: p.tier, stars: p.stars, stats: p.stats || {xp:0,points:0,trophies:0,goals:0}, 
            marketValue: p.market_value || 500000,
            status: p.status || 'active'
        }));

        if(tRes.data) {
            cloudDB.tournaments = tRes.data.map(t => ({
                ...t,
                matches: t.matches || [],
                standings: t.standings || [],
                participants: t.participants || [],
                schedule: t.schedule || null,
                bracket: t.bracket || null
            })).sort((a,b) => b.id - a.id); 
        }

        if(nRes.data) cloudDB.news = nRes.data;
        if(pendRes.data) cloudDB.pending = pendRes.data.map(req => ({
            name: req.name, username: req.username, pin: req.pin, photo: req.photo, ts: req.ts
        }));
        if(admRes.data && admRes.data.value) cloudDB.adminCodes = admRes.data.value;

        if(currentUser) renderUserBadge();
        const activeTab = document.querySelector('.nav-item.active')?.dataset.tab || 'arena';
        renderTab(activeTab); 
        if (activeTournIdx !== null) renderTournamentScreen(); 
        
        snack('✅ Data is up to date!');
    } catch(e) { 
        console.error("Refresh Error", e); 
        snack('❌ Sync failed. Check internet.');
    }
}

// ============================================================
async function adminClearSuspension(idx) {
    const db=getDB();const p=db.players[idx];
    if(!p) return;
    if(p.status==='suspended'){
        p.status='active';snack(`✅ Suspension cleared for ${p.name}`);
        await saveSinglePlayer(p); localStorage.setItem(DB_KEY,JSON.stringify(db));
        closeModal('modal-admin-player');renderLocker();
    }
}

// ============================================================
// ENGINE 2: ELO GLOBAL RATING ALGORITHM
// ============================================================
function updateELO(db, teamA_Ids, teamB_Ids, resultA) {
    // resultA: 1 (Win), 0 (Loss), 0.5 (Draw)
    const teamA = teamA_Ids.map(id => db.players.find(x => x.id === id)).filter(Boolean);
    const teamB = teamB_Ids.map(id => db.players.find(x => x.id === id)).filter(Boolean);
    if(teamA.length === 0 || teamB.length === 0) return;

    // 1. Give everyone a default ELO of 1000 if they don't have one
    [...teamA, ...teamB].forEach(p => { p.stats.elo = p.stats.elo || 1000; });

    // 2. Calculate average team strength (Crucial for 2v2 Doubles)
    const avgEloA = teamA.reduce((sum, p) => sum + p.stats.elo, 0) / teamA.length;
    const avgEloB = teamB.reduce((sum, p) => sum + p.stats.elo, 0) / teamB.length;

    // 3. The Math Magic: Calculate expected chances of winning
    const expectedA = 1 / (1 + Math.pow(10, (avgEloB - avgEloA) / 400));
    const expectedB = 1 / (1 + Math.pow(10, (avgEloA - avgEloB) / 400));
    const K = 40; // High stakes: Maximum points you can steal in one match

    // 4. Update Team A
    teamA.forEach(p => {
        let eloChange = Math.round(K * (resultA - expectedA));
        p.stats.elo += eloChange;
    });

    // 5. Update Team B
    teamB.forEach(p => {
        let resultB = 1 - resultA;
        let eloChange = Math.round(K * (resultB - expectedB));
        p.stats.elo += eloChange;
    });
}

// ============================================================
// DYNAMIC MARKET VALUE ENGINE
// ============================================================
function updatePlayerMarketValue(db, pid, matchData) {
    const p = db.players.find(x => x.id === pid);
    if(!p) return;
    
    let val = p.marketValue || 500000; // Default starting price is 500k
    
    // 1. Match Result Impact
    if(matchData.result === 'win') val += 100000;
    else if(matchData.result === 'draw') val += 25000;
    else if(matchData.result === 'loss') val -= 50000;
    
    // 2. Goals Impact (+50k per goal)
    if(matchData.goals > 0) val += (matchData.goals * 50000);
    
    // 3. Cards Penalty
    if(matchData.card === 'yellow') val -= 50000;
    else if(matchData.card === 'red') val -= 150000;
    
    // Floor Limit: Player price cannot go below €100,000
    if(val < 100000) val = 100000;
    
    p.marketValue = val;
}

function awardMotmValue(db, pid) {
    const p = db.players.find(x => x.id === pid);
    if(p) {
        p.marketValue = (p.marketValue || 500000) + 200000; // MOTM gets +200k bonus
    }
}

// FIFA-STYLE MUSIC ENGINE (Your Custom Playlist)
// ============================================================
const playlist = [
    "https://jvkjjpqlmofprmugkbxs.supabase.co/storage/v1/object/public/music/Untitled%20folder/YTDown_YouTube_Bad-Bunny-DtMF-Letra_Media_4X4uckVyk9o_009_128k.mp3",
    "https://jvkjjpqlmofprmugkbxs.supabase.co/storage/v1/object/public/music/Untitled%20folder/YTDown_YouTube_Hayya-Hayya-Better-Together-FIFA-World-C_Media_vyDjFVZgJoo_009_128k.mp3",
    "https://jvkjjpqlmofprmugkbxs.supabase.co/storage/v1/object/public/music/Untitled%20folder/YTDown_YouTube_IShowSpeed-World-Cup-Official-Music-Vide_Media_8n5dJwWXrbo_009_128k.mp3",
    "https://jvkjjpqlmofprmugkbxs.supabase.co/storage/v1/object/public/music/Untitled%20folder/YTDown_YouTube_Travis-Scott-STARGAZING-Audio_Media_2a8PgqWrc_4_009_128k.mp3"
];

let currentSong = 0;
let bgMusic = new Audio(playlist[currentSong]);
bgMusic.volume = 0.2; // Background volume (20%)

// Auto-play next song when current finishes
bgMusic.addEventListener('ended', nextSong);

function toggleMusic() {
    if(bgMusic.paused) {
        bgMusic.play().catch(e => console.log("Browser blocked autoplay until user clicks"));
        document.getElementById('music-btn').textContent = '🔊';
    } else {
        bgMusic.pause();
        document.getElementById('music-btn').textContent = '🔇';
    }
}

function nextSong() {
    bgMusic.pause();
    currentSong = (currentSong + 1) % playlist.length; 
    bgMusic = new Audio(playlist[currentSong]);
    bgMusic.volume = 0.2;
    bgMusic.addEventListener('ended', nextSong);
    bgMusic.play();
    document.getElementById('music-btn').textContent = '🔊';
    snack('🎵 Playing next track...');
}

// ============================================================
// ACHIEVEMENT ENGINE (BADGES ONLY)
// ============================================================
function checkAchievements(db, matchEvents) {
    Object.keys(matchEvents.goals).forEach(pid => {
        const p = db.players.find(x => x.id === pid);
        if(!p) return;
        p.stats.badges = p.stats.badges || [];
        let newBadges = [];
        if(matchEvents.goals[pid] >= 3 && !p.stats.badges.includes('🎩 Hat-Trick')) {
            p.stats.badges.push('🎩 Hat-Trick'); newBadges.push('🎩 Hat-Trick');
        }
        if((p.stats.goals || 0) >= 50 && !p.stats.badges.includes('🎯 Sniper')) {
            p.stats.badges.push('🎯 Sniper'); newBadges.push('🎯 Sniper');
        }
        if(newBadges.length > 0) {
            snack(`🏆 ${p.name} unlocked: ${newBadges.join(', ')}`);
            addNews(`🏅 ACHIEVEMENT: ${p.name} earned ${newBadges.join(', ')}!`, '🏅');
        }
    });
}

// ============================================================
// INIT (STARTUP)
// ============================================================
// ============================================================
// INIT (STARTUP) - WITH BAN/SUSPEND SESSION CHECK
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  showScreen('screen-waiting');
  document.querySelector('.waiting-title').textContent = "CONNECTING...";
  document.querySelector('.waiting-sub').textContent = "Downloading live data from server...";

  await refreshData();

  const savedSession = localStorage.getItem('footbola_session');
  if(savedSession) {
      const parsedSession = JSON.parse(savedSession);
      if (parsedSession.type === 'player') {
          const livePlayer = cloudDB.players.find(p => p.id === parsedSession.id);
          // 🔒 الطرد الفوري للمحظورين
          if (!livePlayer || livePlayer.status === 'banned' || livePlayer.status === 'suspended') {
              logout(); 
              snack('🚫 Session Expired or Account Suspended.');
              return;
          }
      }
      currentUser = parsedSession;
      enterApp();
  } else {
      setTimeout(() => showScreen('screen-auth'), 800);
  }
});

// ============================================================
// THE ULTIMATE TELEGRAM HYPE ENGINE (INTERACTIVE & ANIMATED)
// ============================================================
function sendTelegramAlert(text) {
    const token = "8723447398:AAGg-dbMpTMSg8qOiwGkWbX1VDQaIKbx1Cw";
    const chatId = "-5226636156";
    const websiteUrl = "https://footbola.netlify.app";
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    // 🎭 محرك الدراما الرياضية (The Drama Engine)
    let header = "📺 FOOTBOLA TV | بـث حـي";
    let animation = "⚡";
    let hypeText = "تغطية مستمرة لأحداث الساحة الآن...";

    if(text.includes('🏆')) {
        header = "👑 THE CHAMPION HAS ARRIVED";
        animation = "🎊✨🏆✨🎊";
        hypeText = "لحظة تاريخية! الكأس يجد صاحبه الجديد وسط احتفالات صاخبة! 🥁";
    } 
    else if(text.includes('💥')) {
        header = "🔥 MATCH EXPLOSION | إنفجار كروي";
        animation = "💣⚽🔥";
        hypeText = "أداء مرعب! الخصم لم يجد فرصة للتنفس.. تدمير شامل! 🌋";
    }
    else if(text.includes('🚨') || text.includes('🟥')) {
        header = "🚫 VAR DECISION | قرار الفار";
        animation = "🚨📢🚨";
        hypeText = "الأجواء تشتعل! البطاقة الحمراء تظهر والتوتر سيد الموقف! 😤";
    }
    else if(text.includes('🎩')) {
        header = "🎩 HAT-TRICK HERO | الهاتريك";
        animation = "🎯🎯🎯";
        hypeText = "سيدات وسادتي.. استعدوا للتصفيق! سوبر هاتريك تاريخي! 👏";
    }

    // 🏗️ تصميم هيكل الرسالة الفخم (UI Template)
    const formattedMessage = `
${animation}
<b>${header}</b>
━━━━━━━━━━━━━━━━━━━━
📣 <b>الحدث:</b>
<i>${text}</i>

🎙️ <b>تحليل المعلق:</b>
<code>${hypeText}</code>
━━━━━━━━━━━━━━━━━━━━
📍 <b>الموقع:</b> Arena Live
⏱️ <b>التوقيت:</b> ${new Date().toLocaleTimeString('ar-EG')}
`;

    // 🔘 الأزرار التفاعلية (Inline Buttons)
    const keyboard = {
        inline_keyboard: [
            [
                { text: "🏟️ دخول الملعب (Live)", url: websiteUrl },
                { text: "📊 جدول الترتيب", url: websiteUrl }
            ],
            [
                { text: "💸 سوق الانتقالات", url: websiteUrl }
            ]
        ]
    };

    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            chat_id: chatId, 
            text: formattedMessage,
            parse_mode: 'HTML',
            reply_markup: keyboard // إضافة الأزرار
        })
    }).catch(err => console.error("Telegram Integration Error", err));
}
