/* ===========================================================
   Freedom Performance OS — app.js
   Centro operativo: tracker reale + obiettivi + dashboard.
   Backend: Supabase (os_entries, profiles). Auth + RLS server-side.
   Il simulatore resta vivo come modulo separato (link).
   =========================================================== */
/* supabase-js self-hostato (vendor/supabase.umd.js) — niente dipendenza esm.sh, nessun flash */
const { createClient } = window.supabase;

/* ---------- CONFIG ---------- */
const SUPABASE_URL = 'https://cqktepwrpalwyvrdproh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxa3RlcHdycGFsd3l2cmRwcm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMjQyNzcsImV4cCI6MjA5NTgwMDI3N30.6R0Skc9833fyEazmfj0Uyl3Gx5wrH-_PC1y_GeVF3Ok';
const SIMULATOR_URL = 'https://freedomuniversity.github.io/fu-profit-engine/';
const WORKDAYS_WEEK = 6;   // giorni lavorativi/settimana (placeholder, configurabile)
const WORKDAYS_MONTH = 26; // giorni lavorativi/mese (placeholder)

/* KPI + TARGET per ruolo.
   ⚙️ DINAMICO: a runtime ROLES/ROLE_ORDER vengono RICOSTRUITI da DB (kpi_catalog) via loadCatalog().
   Questo blocco resta solo come FALLBACK se il catalogo non è raggiungibile (resilienza) e per la demo. */
let ROLES = {
  ba:      { label:'Brand Ambassador', icon:'👑', north:'lead',
    kpis:[ {key:'video',label:'Video pubblicati',unit:'n',daily:3},
           {key:'views',label:'Views totali',unit:'n',daily:5000},
           {key:'lead', label:'Lead generati',unit:'n',daily:1} ] },
  chatter: { label:'Chatter', icon:'💬', north:'qualificati',
    kpis:[ {key:'chat',label:'Chat gestite',unit:'n',daily:80},
           {key:'qualificati',label:'Lead qualificati',unit:'n',daily:8},
           {key:'appuntamenti',label:'Appuntamenti generati',unit:'n',daily:2} ] },
  setter:  { label:'Setter', icon:'📞', north:'show',
    kpis:[ {key:'chiamate',label:'Chiamate fatte',unit:'n',daily:40},
           {key:'fissati',label:'Appuntamenti fissati',unit:'n',daily:5},
           {key:'show',label:'Appuntamenti presentati',unit:'n',daily:3} ] },
  closer:  { label:'Closer', icon:'🎯', north:'cash',
    kpis:[ {key:'call',label:'Call di vendita',unit:'n',daily:6},
           {key:'vendite',label:'Vendite chiuse',unit:'n',daily:1},
           {key:'cash',label:'Cash collected',unit:'€',daily:1000} ] },
  sm:      { label:'Sales Manager', icon:'🛡️', north:'cash_team',
    kpis:[ {key:'vendite_team',label:'Vendite team',unit:'n',daily:4},
           {key:'cash_team',label:'Cash team',unit:'€',daily:8000} ] },
};
let ROLE_ORDER = ['ba','chatter','setter','closer','sm'];

/* ---------- CATALOGO DINAMICO (kpi_catalog → ROLES/ROLE_ORDER) ---------- */
// Ricostruisce ROLES e ROLE_ORDER dal DB. Admin può aggiungere reparti/KPI senza toccare il codice.
async function loadCatalog(){
  if(DEMO) return; // demo usa il fallback hardcoded
  try{
    const {data,error} = await sb.from('kpi_catalog').select('*').eq('active',true).order('role_sort').order('sort');
    if(error||!data||!data.length){ console.warn('catalog vuoto/errore, uso fallback',error); return; }
    const built={}, order=[];
    data.forEach(r=>{
      if(!built[r.role]){
        built[r.role]={label:r.role_label,icon:r.role_icon||'•',dept:r.dept||'',sort:r.role_sort??99,north:null,kpis:[]};
        order.push(r.role);
      }
      built[r.role].kpis.push({key:r.kpi_key,label:r.label,unit:r.unit||'n',daily:+r.daily||0,descr:r.descr||''});
      if(r.is_north) built[r.role].north=r.kpi_key;
    });
    Object.values(built).forEach(R=>{ if(!R.north && R.kpis[0]) R.north=R.kpis[0].key; });
    order.sort((a,b)=>built[a].sort-built[b].sort);
    ROLES=built; ROLE_ORDER=order;
  }catch(e){ console.warn('loadCatalog fail, fallback attivo',e); }
}

/* ---------- SUPABASE ---------- */
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {auth:{persistSession:true,autoRefreshToken:true}});

/* ---------- DEMO MODE (solo dati finti, nessun accesso DB — per anteprima/QA) ---------- */
const DEMO = new URLSearchParams(location.search).get('demo');
function demoFixtures(){
  const t=new Date(), ms=new Date(t.getFullYear(),t.getMonth(),1);
  const days=[]; for(let d=new Date(ms);d<=t;d.setDate(d.getDate()+1)){if(d.getDay()===0)continue;
    days.push({day:isoDay(d),kpis:{call:4+(d.getDate()%4),vendite:(d.getDate()%3===0?1:0)+(d.getDate()%5===0?1:0),cash:800+(d.getDate()*137%2600)}});}
  return {days};
}

/* ---------- STATE ---------- */
const S = { user:null, profile:null, role:null, isAdmin:false, isManager:false, view:'today', sidebarOpen:false };

/* ---------- HELPERS ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const el = (tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;};
const nf = new Intl.NumberFormat('it-IT');
const fmtv = (v,unit)=> unit==='€' ? '€'+nf.format(Math.round(v)) : nf.format(Math.round(v));
const pad = n=>String(n).padStart(2,'0');
function isoDay(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
const today = ()=> new Date();
function monthStart(d=today()){return new Date(d.getFullYear(),d.getMonth(),1);}
function weekStart(d=today()){const x=new Date(d);const wd=(x.getDay()+6)%7;x.setDate(x.getDate()-wd);x.setHours(0,0,0,0);return x;} // lunedì
function daysBetween(a,b){return Math.floor((b-a)/86400000);}
// giorni lavorativi (lun-sab) trascorsi dall'inizio mese fino a oggi incluso
function workdaysElapsedMonth(){const s=monthStart(),t=today();let n=0;for(let d=new Date(s);d<=t;d.setDate(d.getDate()+1)){if(d.getDay()!==0)n++;}return Math.max(1,n);}
function workdaysElapsedWeek(){const s=weekStart(),t=today();let n=0;for(let d=new Date(s);d<=t;d.setDate(d.getDate()+1)){if(d.getDay()!==0)n++;}return Math.max(1,n);}
function statusOf(pct){return pct>=1?'good':pct>=0.6?'warn':'bad';}
function statusLabel(st){return st==='good'?'in linea':st==='warn'?'sotto ritmo':'in ritardo';}
function initials(name){return (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();}

function mount(node){const r=$('#root');r.innerHTML='';r.appendChild(node);}

/* ---------- AUTH ---------- */
async function boot(){
  if(DEMO){
    S.user={id:'demo',email:'demo@freedomuniversity.it'};
    S.profile={display_name: DEMO==='admin'?'Jonny Pancaldi':'Mario Rossi'};
    const dv=new URLSearchParams(location.search).get('view');
    if(DEMO==='admin'){S.isAdmin=true;S.view=dv||'admin';}
    else if(DEMO==='manager'){S.isManager=true;S.role='closer';S.profile={display_name:'Lorenzo Mariani'};S.view=dv||'admin';}
    else {S.role='closer';S.view=dv||'today';}
    renderApp(); return;
  }
  const {data:{session}} = await sb.auth.getSession();
  if(session){ S.user=session.user; await loadProfile(); await loadCatalog(); await loadTargets(); renderApp(); }
  else renderLogin();
  sb.auth.onAuthStateChange((_e,sess)=>{
    const was=S.user; S.user=sess?.user||null;
    if(S.user && !was){ loadProfile().then(loadCatalog).then(loadTargets).then(renderApp); }
    else if(!S.user && was){ S.profile=null;S.role=null;S.isAdmin=false; renderLogin(); }
  });
}
async function loadProfile(){
  const {data} = await sb.from('profiles').select('role,sales_role,display_name').eq('id',S.user.id).maybeSingle();
  S.profile=data||{};
  S.isAdmin = data?.role==='admin';
  S.isManager = data?.role==='manager';
  S.role = data?.sales_role||null;
}
// applica gli override target del singolo collaboratore sopra i target di catalogo
async function loadTargets(){
  if(DEMO || !S.role || !ROLES[S.role]) return;
  try{
    const {data} = await sb.from('target_overrides').select('kpi_key,daily').eq('user_id',S.user.id);
    (data||[]).forEach(o=>{const kp=ROLES[S.role]?.kpis.find(k=>k.key===o.kpi_key); if(kp)kp.daily=+o.daily;});
  }catch(e){ console.warn('overrides load fail',e); }
}

/* ---------- DATA ---------- */
async function myEntries(fromISO){
  if(DEMO) return demoFixtures().days;
  const {data} = await sb.from('os_entries').select('day,kpis').eq('user_id',S.user.id).gte('day',fromISO).order('day');
  return data||[];
}
async function myToday(){
  if(DEMO){const d=demoFixtures().days;return d.length?{kpis:d[d.length-1].kpis}:null;}
  const {data} = await sb.from('os_entries').select('id,kpis,note').eq('user_id',S.user.id).eq('day',isoDay(today())).maybeSingle();
  return data;
}
// suggerimenti pre-compilati (CloudTalk/Pipedrive) per oggi
async function mySuggestion(){
  if(DEMO) return null;
  try{
    const {data} = await sb.from('os_suggestions').select('kpis,source').eq('user_id',S.user.id).eq('day',isoDay(today())).maybeSingle();
    return data;
  }catch(e){ return null; }
}
async function saveToday(kpis,note){
  const row={user_id:S.user.id,role:S.role,day:isoDay(today()),kpis,note:note||null,updated_at:new Date().toISOString()};
  return sb.from('os_entries').upsert(row,{onConflict:'user_id,day'});
}
async function adminData(){
  if(DEMO){
    const names=[['Mario Rossi','closer'],['Agata Bruni','chatter'],['Sharon Vitale','chatter'],['Luca Verdi','setter'],['Sara Neri','setter'],['Marco Blu','closer'],['Elisa Sole','ba'],['Davide Po','ba'],['Anna Lualdi','sm']];
    const profiles=names.map((n,i)=>({id:'demo'+i,display_name:n[0],role:'collaborator',sales_role:n[1]}));
    const td=isoDay(today()); const entries=[];
    profiles.forEach((p,i)=>{ if(i%4===2)return; // alcuni non compilano oggi
      const R=ROLES[p.sales_role]; const k={}; R.kpis.forEach(kp=>k[kp.key]=Math.round(kp.daily*(0.5+(i%5)*0.22)));
      entries.push({user_id:p.id,role:p.sales_role,day:td,kpis:k});
      for(let b=1;b<8;b++){const k2={};R.kpis.forEach(kp=>k2[kp.key]=Math.round(kp.daily*(0.6+((i+b)%4)*0.2)));entries.push({user_id:p.id,role:p.sales_role,day:td,kpis:k2});}
    });
    if(S.isManager){const r=S.role;return {profiles:profiles.filter(p=>p.sales_role===r),entries:entries.filter(e=>e.role===r)};}
    return {profiles,entries};
  }
  const [{data:profiles},{data:entries}] = await Promise.all([
    sb.from('profiles').select('id,display_name,role,sales_role,active,trackable'),
    sb.from('os_entries').select('user_id,role,day,kpis').gte('day',isoDay(monthStart()))
  ]);
  return {profiles:profiles||[], entries:entries||[]};
}

/* ---------- ANALYTICS: storico esteso (cache) per grafici/periodi ---------- */
let _anCache=null;
async function analyticsData(){
  if(_anCache) return _anCache;
  if(DEMO){
    const names=[['Mario Rossi','closer'],['Agata Bruni','chatter'],['Sharon Vitale','chatter'],['Luca Verdi','setter'],['Sara Neri','setter'],['Marco Blu','closer'],['Elisa Sole','ba'],['Davide Po','ba'],['Anna Lualdi','sm']];
    const profiles=names.map((n,i)=>({id:'demo'+i,display_name:n[0],role:'collaborator',sales_role:n[1],active:true,trackable:true}));
    const entries=[]; const end=today();
    profiles.forEach((p,i)=>{
      const R=ROLES[p.sales_role]; const diligence=0.45+(i%5)*0.13; // chi compila più spesso
      for(let back=0;back<45;back++){
        const d=new Date(end);d.setDate(d.getDate()-back);
        if(d.getDay()===0)continue;                          // niente domenica
        const wd=d.getDay();
        const weekdayBoost = wd===2||wd===3?1.18:wd===5?0.8:1; // mar/mer top, ven calo
        if((Math.sin(i*9.7+back*1.3)+1)/2 > diligence) continue; // alcuni giorni non compila
        const k={};R.kpis.forEach(kp=>k[kp.key]=Math.max(0,Math.round(kp.daily*(0.55+((i+back)%5)*0.16)*weekdayBoost)));
        entries.push({user_id:p.id,role:p.sales_role,day:isoDay(d),kpis:k});
      }
    });
    _anCache={profiles,entries};
    if(S.isManager){const r=S.role;_anCache={profiles:profiles.filter(p=>p.sales_role===r),entries:entries.filter(e=>e.role===r)};}
    return _anCache;
  }
  const fromISO=isoDay(new Date(Date.now()-120*86400000));
  const [{data:profiles},{data:entries}] = await Promise.all([
    sb.from('profiles').select('id,display_name,role,sales_role,active,trackable'),
    sb.from('os_entries').select('user_id,role,day,kpis').gte('day',fromISO).order('day')
  ]);
  _anCache={profiles:profiles||[], entries:entries||[]};
  return _anCache;
}

/* ===========================================================
   VIEWS
   =========================================================== */

/* ---------- LOGIN ---------- */
function renderLogin(msg){
  const w=el('div','login-wrap');
  w.innerHTML=`<form class="login" id="lgForm">
    <div class="lg-brand"><span class="dot">⚡</span> Freedom Performance OS</div>
    <p class="lg-sub">Il centro operativo del team. Accedi con il tuo account.</p>
    <label>Email</label><input id="lgEmail" type="email" autocomplete="email" placeholder="nome@freedomuniversity.it" required>
    <label>Password</label><input id="lgPass" type="password" autocomplete="current-password" placeholder="••••••••" required>
    <button class="btn btn-primary btn-block" type="submit" style="margin-top:20px">Entra</button>
    <div class="lg-msg ${msg?'err':''}" id="lgMsg">${msg||''}</div>
  </form>`;
  mount(w);
  $('#lgForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=$('#lgForm button'); btn.disabled=true; $('#lgMsg').className='lg-msg'; $('#lgMsg').textContent='Accesso…';
    const {error}=await sb.auth.signInWithPassword({email:$('#lgEmail').value.trim(),password:$('#lgPass').value});
    if(error){ btn.disabled=false; $('#lgMsg').className='lg-msg err'; $('#lgMsg').textContent='Credenziali non valide. Riprova.'; }
  });
}

/* ---------- SHELL ---------- */
function shell(navItems,content){
  const wrap=el('div');
  const name=S.profile?.display_name||S.user.email.split('@')[0];
  const roleLabel = S.isAdmin ? 'Admin' : (ROLES[S.role]?.label||'Collaboratore');
  wrap.innerHTML=`
  <div class="topbar"><div class="tb-brand"><span class="dot">⚡</span> Performance OS</div><button class="burger" id="burger">☰</button></div>
  <div class="scrim" id="scrim"></div>
  <div class="app">
    <aside class="sidebar ${S.sidebarOpen?'open':''}" id="sidebar">
      <div class="sb-brand"><span class="dot">⚡</span> Performance OS</div>
      <nav class="sb-nav">${navItems.map(n=>`<a class="sb-link ${n.id===S.view?'on':''}" data-v="${n.id}"><span class="i">${n.icon}</span>${n.label}</a>`).join('')}</nav>
      <div class="sb-foot">
        <div class="sb-user"><div class="av">${initials(name)}</div><div><div class="nm">${name}</div><div class="rl">${roleLabel}</div></div></div>
        <button class="sb-logout" id="logout">↩ Esci</button>
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  mount(wrap);
  $('#main').appendChild(content);
  wrap.querySelectorAll('.sb-link').forEach(a=>a.addEventListener('click',()=>{S.view=a.dataset.v;S.sidebarOpen=false;renderApp();}));
  $('#logout').addEventListener('click',async()=>{await sb.auth.signOut();});
  const burger=$('#burger'),scrim=$('#scrim');
  if(burger)burger.addEventListener('click',()=>{S.sidebarOpen=!S.sidebarOpen;$('#sidebar').classList.toggle('open');scrim.classList.toggle('on');});
  if(scrim)scrim.addEventListener('click',()=>{S.sidebarOpen=false;$('#sidebar').classList.remove('open');scrim.classList.remove('on');});
}

/* ---------- ROUTER ---------- */
function renderApp(){
  if(!S.user){renderLogin();return;}
  if(S.isAdmin){
    const nav=[{id:'admin',icon:'🛰️',label:'Cabina di comando'},{id:'analytics',icon:'📊',label:'Analisi'},{id:'roles',icon:'👥',label:'Team'},{id:'targets',icon:'🎯',label:'Obiettivi'},{id:'sim',icon:'🎚️',label:'Simulatore'}];
    if(!['admin','analytics','roles','targets','sim'].includes(S.view))S.view='admin';
    const c=el('div'); shell(nav,c);
    if(S.view==='sim') viewSimulator(c);
    else if(S.view==='analytics') viewAnalytics(c,'admin');
    else if(S.view==='roles') viewTeamAssign(c);
    else if(S.view==='targets') viewTargets(c);
    else viewAdmin(c,'admin');
    return;
  }
  if(S.isManager){
    const nav=[{id:'admin',icon:'👥',label:'Il mio reparto'},{id:'analytics',icon:'📊',label:'Analisi'},{id:'sim',icon:'🎚️',label:'Simulatore'}];
    if(!['admin','analytics','sim'].includes(S.view))S.view='admin';
    const c=el('div'); shell(nav,c);
    if(S.view==='sim') viewSimulator(c);
    else if(S.view==='analytics') viewAnalytics(c,'manager');
    else viewAdmin(c,'manager');
    return;
  }
  if(!S.role){ renderNotAssigned(); return; }
  const nav=[{id:'today',icon:'📌',label:'Oggi'},{id:'trend',icon:'📈',label:'Andamento'},{id:'sim',icon:'🎚️',label:'Simulatore'}];
  if(!['today','trend','sim'].includes(S.view))S.view='today';
  const c=el('div'); shell(nav,c);
  if(S.view==='today') viewToday(c);
  else if(S.view==='trend') viewTrend(c);
  else viewSimulator(c);
}

function renderNotAssigned(){
  const w=el('div');
  shell([{id:'today',icon:'📌',label:'Oggi'}],w);
  w.innerHTML=`<div class="page-head"><div><h1>Area non ancora assegnata</h1><p class="sub">Il tuo profilo è attivo ma non è ancora collegato a un ruolo.</p></div></div>
  <div class="banner warn">⏳ Un amministratore deve assegnarti la tua area (Brand Ambassador, Chatter, Setter, Closer o Sales Manager). Scrivi a Lorenzo o al tuo responsabile. Appena fatto, qui comparirà il tuo tracker.</div>`;
}

/* ---------- TOAST ---------- */
function toast(msg){let t=$('#toast');if(!t){t=el('div');t.id='toast';t.style.cssText='position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#0f1729;color:#fff;padding:11px 18px;border-radius:11px;font-size:14px;font-weight:600;z-index:200;box-shadow:0 12px 40px -16px rgba(0,0,0,.5);opacity:0;transition:opacity .2s';document.body.appendChild(t);}t.textContent=msg;t.style.opacity='1';clearTimeout(t._h);t._h=setTimeout(()=>t.style.opacity='0',2200);}

/* ---------- ADMIN: OBIETTIVI (editor target) ---------- */
async function viewTargets(c){
  c.innerHTML=`<div class="page-head"><div><h1>🎯 Obiettivi</h1><p class="sub">Target giornalieri per ruolo (tutti gli ${ROLE_ORDER.length} reparti). Da qui "sotto/sopra ritmo" diventa reale per il team.</p></div></div>
  <input id="tgFilter" placeholder="🔎 Filtra reparto…" style="width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:11px;margin-bottom:14px;font-size:15px">
  <div id="tgBody"></div>`;
  const body=$('#tgBody',c);
  function paint(){
    const q=($('#tgFilter',c)?.value||'').toLowerCase().trim();
    body.innerHTML='';
    ROLE_ORDER.filter(r=>!q||ROLES[r].label.toLowerCase().includes(q)||(ROLES[r].dept||'').toLowerCase().includes(q)).forEach(r=>{
      const R=ROLES[r];const card=el('div','card');card.style.marginBottom='16px';
      card.innerHTML=`<div class="card-h"><h3>${R.icon} ${R.label}</h3><span class="muted">${R.dept||''}</span></div>`;
      const form=el('div','kpi-form');
      R.kpis.forEach(k=>{
        const f=el('div','field');
        f.innerHTML=`<div class="f-lbl">${k.label}<small>${k.key===R.north?'⭐ KPI nord · ':''}obiettivo giornaliero a persona</small></div><div class="f-in"><input id="tg_${r}_${k.key}" type="number" min="0" inputmode="numeric" value="${k.daily}"><span class="unit">${k.unit}</span></div>`;
        form.appendChild(f);});
      card.appendChild(form);body.appendChild(card);
    });
  }
  paint(); $('#tgFilter',c).addEventListener('input',paint);
  const row=el('div');row.style.cssText='display:flex;align-items:center;gap:12px;position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 40%);padding:14px 0';
  const save=el('button','btn btn-primary','💾 Salva tutti gli obiettivi');const msg=el('span','muted');
  row.appendChild(save);row.appendChild(msg);c.appendChild(row);
  save.addEventListener('click',async()=>{
    save.disabled=true;save.textContent='Salvo…';
    const rows=[];let touched=0;
    ROLE_ORDER.forEach(r=>ROLES[r].kpis.forEach(k=>{const inp=$('#tg_'+r+'_'+k.key,c);if(!inp)return;const nv=+(inp.value||0);if(nv!==k.daily)touched++;k.daily=nv;rows.push({role:r,kpi_key:k.key,daily:nv,updated_at:new Date().toISOString()});}));
    const {error}=await sb.from('kpi_catalog').upsert(rows,{onConflict:'role,kpi_key'});
    if(error){save.disabled=false;save.textContent='💾 Salva tutti gli obiettivi';msg.style.color='var(--bad)';msg.textContent='Errore: '+error.message;return;}
    save.textContent='✓ Salvato';msg.textContent=`Target aggiornati (${touched} modificati).`;toast('Obiettivi salvati');
    setTimeout(()=>{save.disabled=false;save.textContent='💾 Salva tutti gli obiettivi';},1600);
  });
}

/* ---------- ADMIN: TEAM / COLLABORATORI (ruolo + attivo + trackable) ---------- */
const SYSTEM_NAMES=['Amministrazione','Human Resources','Ufficio Legale','Closer Team','Setter Team','Setter2','Setter3','Matteo Community','Marco Manigrassi (Spoki)'];
async function viewTeamAssign(c){
  c.innerHTML=`<div class="page-head"><div><h1>👥 Team / Collaboratori</h1><p class="sub">Assegna ruolo, attiva/disattiva e decidi chi è tracciato. I non-tracciati non sporcano la dashboard.</p></div></div>
  <input id="raSearch" placeholder="🔎 Cerca per nome…" style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:11px;margin-bottom:14px;font-size:15px">
  <div id="raAlert"></div>
  <div class="card" style="padding:0;overflow:auto" id="raBody"><div class="empty">Carico…</div></div>`;
  const {data}=await sb.from('profiles').select('id,display_name,role,sales_role,active,trackable').order('display_name');
  const profs=(data||[]).map(p=>({active:true,trackable:true,...p}));
  const opts=['',...ROLE_ORDER];
  // profili "da verificare": sistema, admin, o nome duplicato (stesso primo token)
  const firstTok={};profs.forEach(p=>{const t=(p.display_name||'').split(' ')[0].toLowerCase();if(t)(firstTok[t]=firstTok[t]||[]).push(p.display_name);});
  const isDirty=p=> p.role==='admin'||SYSTEM_NAMES.includes(p.display_name);
  const dirtyCount=profs.filter(isDirty).length;
  const realHumans=profs.filter(p=>!isDirty(p));
  const assigned=realHumans.filter(p=>p.sales_role).length;
  $('#raAlert',c).innerHTML=`<div class="banner info" style="margin-bottom:14px">👥 <b>${realHumans.length}</b> persone reali · <b>${assigned}</b> con ruolo · <b>${realHumans.length-assigned}</b> senza ruolo · <b>${dirtyCount}</b> account sistema/admin esclusi dal tracking.</div>`;
  async function patch(id,field,value,p){
    const {error}=await sb.from('profiles').update({[field]:value}).eq('id',id);
    if(error){toast('Errore: '+error.message);return false;}
    if(p)p[field]=value;return true;
  }
  function render(){
    const q=($('#raSearch',c)?.value||'').toLowerCase().trim();
    const rows=profs.filter(p=>!q||(p.display_name||p.id).toLowerCase().includes(q));
    $('#raBody',c).innerHTML=`<table class="tbl"><thead><tr><th>Persona</th><th>Ruolo / reparto</th><th>Tracciato</th><th>Attivo</th></tr></thead><tbody>${
      rows.map(p=>{
        const nm=p.display_name||('utente '+p.id.slice(0,8));
        const dirty=isDirty(p);
        const tag = p.role==='admin'?'<span class="pill role">🛡️ Admin</span>':SYSTEM_NAMES.includes(nm)?'<span class="pill" style="background:var(--warn-soft);color:var(--warn)">⚙️ sistema</span>':'';
        const sel=`<select data-id="${p.id}" class="ra-sel" ${p.role==='admin'?'disabled':''} style="padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface);font-weight:600">${opts.map(o=>`<option value="${o}" ${(p.sales_role||'')===o?'selected':''}>${o===''?'— nessuno —':ROLES[o].icon+' '+ROLES[o].label}</option>`).join('')}</select>`;
        return `<tr style="${dirty?'opacity:.6':''}">
          <td><b>${nm}</b> ${tag}</td>
          <td>${sel}</td>
          <td><input type="checkbox" class="ra-track" data-id="${p.id}" ${p.trackable!==false?'checked':''}></td>
          <td><input type="checkbox" class="ra-active" data-id="${p.id}" ${p.active!==false?'checked':''}></td>
        </tr>`;
      }).join('')||'<tr><td colspan="4" class="empty">Nessuno trovato.</td></tr>'
    }</tbody></table>`;
    c.querySelectorAll('.ra-sel').forEach(s=>s.addEventListener('change',async()=>{
      const p=profs.find(x=>x.id===s.dataset.id);
      if(await patch(s.dataset.id,'sales_role',s.value||null,p)) toast(s.value?('Ruolo: '+ROLES[s.value].label):'Ruolo rimosso');
    }));
    c.querySelectorAll('.ra-track').forEach(t=>t.addEventListener('change',async()=>{
      const p=profs.find(x=>x.id===t.dataset.id);
      if(await patch(t.dataset.id,'trackable',t.checked,p)) toast(t.checked?'Ora tracciato':'Escluso dal tracking');
    }));
    c.querySelectorAll('.ra-active').forEach(t=>t.addEventListener('change',async()=>{
      const p=profs.find(x=>x.id===t.dataset.id);
      if(await patch(t.dataset.id,'active',t.checked,p)) toast(t.checked?'Attivo':'Disattivato');
    }));
  }
  render();$('#raSearch',c).addEventListener('input',render);
}

/* ---------- COLLAB: OGGI ---------- */
async function viewToday(c){
  const role=ROLES[S.role];
  c.innerHTML=`<div class="page-head"><div><h1>Oggi · ${role.icon} ${role.label}</h1><p class="sub" id="dateSub"></p></div></div><div id="todayBody"><div class="empty">Carico i tuoi numeri…</div></div>`;
  $('#dateSub',c).textContent = today().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
  const [entry,monthEntries,suggestion] = await Promise.all([myToday(),myEntries(isoDay(monthStart())),mySuggestion()]);
  const cur = entry?.kpis||{};
  const sug = (!entry && suggestion?.kpis) ? suggestion.kpis : {}; // pre-fill solo se non ha già compilato
  const wkStartISO=isoDay(weekStart());
  const monthSum={},weekSum={};
  role.kpis.forEach(k=>{monthSum[k.key]=0;weekSum[k.key]=0;});
  monthEntries.forEach(e=>{role.kpis.forEach(k=>{const v=+(e.kpis?.[k.key]||0);monthSum[k.key]+=v;if(e.day>=wkStartISO)weekSum[k.key]+=v;});});
  const wdM=workdaysElapsedMonth(), wdW=workdaysElapsedWeek();

  const body=$('#todayBody',c); body.innerHTML='';
  // progress cards (north + period)
  const north=role.kpis.find(k=>k.key===role.north)||role.kpis[0];
  const cards=el('div','grid grid-3');
  [['Oggi',+(cur[north.key]||0),north.daily],
   ['Questa settimana',weekSum[north.key]||0,north.daily*wdW],
   ['Questo mese',monthSum[north.key]||0,north.daily*wdM]
  ].forEach(([lbl,val,tgt])=>{
    const pct=tgt>0?val/tgt:0,st=statusOf(pct),gap=Math.max(0,tgt-val);
    const s=el('div','stat');
    s.innerHTML=`<div class="tag ${st}">${statusLabel(st)}</div>
      <div class="lbl">${north.unit==='€'?'💶':'⭐'} ${north.label} · ${lbl}</div>
      <div class="val mono">${fmtv(val,north.unit)}</div>
      <div class="meta">obiettivo ${fmtv(tgt,north.unit)} · ${gap>0?('mancano <b>'+fmtv(gap,north.unit)+'</b>'):'raggiunto ✓'}</div>
      <div class="bar ${st}"><span style="width:${Math.min(100,Math.round(pct*100))}%"></span></div>`;
    cards.appendChild(s);
  });
  body.appendChild(cards);

  // streak di compilazione (premia il rito quotidiano)
  const daySet=new Set(monthEntries.map(e=>e.day));
  let streak=0, probe=new Date(today());
  if(!daySet.has(isoDay(probe))) probe.setDate(probe.getDate()-1); // se oggi non ancora compilato, non spezzare
  for(let i=0;i<62;i++){ if(probe.getDay()===0){probe.setDate(probe.getDate()-1);continue;} if(daySet.has(isoDay(probe))){streak++;probe.setDate(probe.getDate()-1);} else break; }
  if(streak>0){ const sc=el('div','banner good'); sc.style.marginTop='16px';
    sc.innerHTML=`🔥 <b>${streak} giorn${streak===1?'o':'i'} di fila</b> che compili. L'abitudine è metà del risultato — non spezzarla.`;
    body.appendChild(sc); }

  // ritmo ideale (mese)
  const idealPct = wdM/WORKDAYS_MONTH;
  const realPct = (north.daily*WORKDAYS_MONTH)>0 ? (monthSum[north.key]||0)/(north.daily*WORKDAYS_MONTH) : 0;
  const pace = realPct>=idealPct ? 'good':'warn';
  const paceBanner=el('div','banner '+(pace==='good'?'good':'warn'));
  paceBanner.style.marginTop='16px';
  paceBanner.innerHTML = pace==='good'
    ? `🔥 Sei <b>avanti o in pari</b> col ritmo del mese. Stai costruendo il risultato — continua così.`
    : `⚠️ Sei <b>sotto il ritmo ideale</b> del mese. Per rientrare servono ~<b>${fmtv(Math.max(0,(north.daily*wdM)-(monthSum[north.key]||0)),north.unit)}</b> di ${north.label.toLowerCase()} in più, da recuperare nei prossimi giorni.`;
  body.appendChild(paceBanner);

  // form compilazione
  const formCard=el('div','card'); formCard.style.marginTop='16px';
  const hasSug=Object.keys(sug).length>0;
  formCard.innerHTML=`<div class="card-h"><h3>Compila la giornata · 60 secondi</h3></div>`;
  if(hasSug){const sb=el('div','banner info');sb.style.marginBottom='14px';sb.innerHTML=`📥 Alcuni campi sono <b>già pre-compilati dai tuoi dati reali</b> (${suggestion.source||'auto'}). Controlla e salva — correggi solo se serve.`;formCard.appendChild(sb);}
  const form=el('div','kpi-form');
  role.kpis.forEach(k=>{
    const pre = cur[k.key]!=null ? cur[k.key] : (sug[k.key]!=null?sug[k.key]:'');
    const fromSug = cur[k.key]==null && sug[k.key]!=null;
    const f=el('div','field');
    f.innerHTML=`<div class="f-lbl">${k.label}<small>obiettivo giornaliero: ${fmtv(k.daily,k.unit)}${fromSug?' · <b style="color:var(--brand)">📥 da '+(suggestion.source||'auto')+'</b>':''}</small></div>
      <div class="f-in"><input id="k_${k.key}" type="number" min="0" inputmode="numeric" value="${pre}" placeholder="0"><span class="unit">${k.unit}</span></div>`;
    form.appendChild(f);
  });
  formCard.appendChild(form);
  const saveBtn=el('button','btn btn-primary btn-block','💾 Salva la giornata'); saveBtn.style.marginTop='18px';
  const msg=el('div','muted'); msg.style.cssText='text-align:center;margin-top:10px;font-size:13px';
  msg.textContent = entry ? '✓ Giornata già compilata oggi — puoi aggiornarla.' : '';
  formCard.appendChild(saveBtn); formCard.appendChild(msg);
  body.appendChild(formCard);

  saveBtn.addEventListener('click',async()=>{
    const kpis={}; role.kpis.forEach(k=>{kpis[k.key]=+($('#k_'+k.key,c).value||0);});
    saveBtn.disabled=true; saveBtn.textContent='Salvo…';
    const {error}=await saveToday(kpis);
    if(error){saveBtn.disabled=false;saveBtn.textContent='💾 Salva la giornata';msg.style.color='var(--bad)';msg.textContent='Errore: '+error.message;return;}
    viewToday(c); // ricarica con i nuovi numeri
  });
}

/* ---------- COLLAB: ANDAMENTO ---------- */
async function viewTrend(c){
  const role=ROLES[S.role];
  c.innerHTML=`<div class="page-head"><div><h1>Andamento · ${role.icon} ${role.label}</h1><p class="sub">Il tuo storico del mese e la proiezione di fine mese.</p></div></div><div id="trendBody"><div class="empty">Carico…</div></div>`;
  const entries=await myEntries(isoDay(monthStart()));
  const body=$('#trendBody',c); body.innerHTML='';
  const north=role.kpis.find(k=>k.key===role.north)||role.kpis[0];
  // serie giornaliera del north per spark
  const byDay={}; entries.forEach(e=>byDay[e.day]=+(e.kpis?.[north.key]||0));
  const days=Object.keys(byDay).sort();
  const monthSum=days.reduce((a,d)=>a+byDay[d],0);
  const wdM=workdaysElapsedMonth();
  const projection = Math.round((monthSum/Math.max(1,wdM))*WORKDAYS_MONTH);
  const monthTarget=north.daily*WORKDAYS_MONTH;

  const top=el('div','grid grid-3');
  top.innerHTML=`
    <div class="stat"><div class="lbl">📅 Giorni compilati</div><div class="val mono">${days.length}</div><div class="meta">su ${wdM} lavorativi del mese</div></div>
    <div class="stat"><div class="lbl">⭐ ${north.label} · mese</div><div class="val mono">${fmtv(monthSum,north.unit)}</div><div class="meta">obiettivo ${fmtv(monthTarget,north.unit)}</div></div>
    <div class="stat"><div class="tag ${statusOf(monthTarget?projection/monthTarget:0)}">${projection>=monthTarget?'sopra':'sotto'}</div><div class="lbl">🔮 Proiezione fine mese</div><div class="val mono">${fmtv(projection,north.unit)}</div><div class="meta">col ritmo di adesso</div></div>`;
  body.appendChild(top);

  // sparkline ultimi giorni
  const sparkCard=el('div','card'); sparkCard.style.marginTop='16px';
  const max=Math.max(1,...days.map(d=>byDay[d]));
  sparkCard.innerHTML=`<div class="card-h"><h3>${north.label} · giorno per giorno</h3></div>
    <div class="spark">${days.map(d=>`<i class="${byDay[d]>=north.daily?'on':''}" style="height:${Math.max(6,Math.round(byDay[d]/max*100))}%" title="${d}: ${fmtv(byDay[d],north.unit)}"></i>`).join('')||'<span class="muted">Nessun dato ancora questo mese.</span>'}</div>`;
  body.appendChild(sparkCard);

  // link simulatore
  const simCard=el('div','card'); simCard.style.marginTop='16px';
  simCard.innerHTML=`<div class="card-h"><h3>Simulatore compenso</h3></div>
    <p class="muted" style="margin-bottom:14px">Vuoi vedere quanto vale il tuo lavoro muovendo le leve del ruolo? Apri il simulatore.</p>
    <a class="btn btn-ghost" href="${SIMULATOR_URL}#${S.role}" target="_blank" rel="noopener">🎚️ Apri il simulatore ${role.label} →</a>`;
  body.appendChild(simCard);
}

/* ---------- SIMULATORE (modulo) ---------- */
function viewSimulator(c){
  const target = S.isAdmin ? '' : ('#'+S.role);
  c.innerHTML=`<div class="page-head"><div><h1>🎚️ Simulatore compensi</h1><p class="sub">Quanto vale il tuo lavoro in base alle leve del ruolo. Modulo separato.</p></div>
    <a class="btn btn-ghost" href="${SIMULATOR_URL}${target}" target="_blank" rel="noopener">Apri a tutto schermo ↗</a></div>
  <div class="card" style="padding:0;overflow:hidden"><iframe src="${SIMULATOR_URL}${target}" style="width:100%;height:78vh;border:none;display:block"></iframe></div>`;
}

/* ---------- ADMIN: CABINA DI COMANDO ---------- */
async function viewAdmin(c,sub){
  const isMgr = sub==='manager';
  const mgrLabel = isMgr && ROLES[S.role] ? ROLES[S.role].label : '';
  c.innerHTML=`<div class="page-head"><div><h1>${isMgr?('👥 Il mio reparto · '+mgrLabel):'🛰️ Cabina di comando'}</h1><p class="sub">${today().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'})} · ${isMgr?'vista reparto':'vista azienda'}</p></div></div><div id="adminBody"><div class="empty">Carico i dati del team…</div></div>`;
  const {profiles,entries}=await adminData();
  const collaborators=profiles.filter(p=>p.role!=='admin'&&p.sales_role&&p.trackable!==false&&p.active!==false);
  const todayISO=isoDay(today());
  const byUserToday={}; entries.filter(e=>e.day===todayISO).forEach(e=>byUserToday[e.user_id]=e.kpis);
  const monthByUser={}; entries.forEach(e=>{(monthByUser[e.user_id]=monthByUser[e.user_id]||[]).push(e);});
  const compiledToday=collaborators.filter(p=>byUserToday[p.id]).length;
  const body=$('#adminBody',c); body.innerHTML='';

  // top stats
  const wdM=workdaysElapsedMonth();
  const perRole={}; ROLE_ORDER.forEach(r=>perRole[r]={count:0,northToday:0,northMonth:0});
  collaborators.forEach(p=>{const r=p.sales_role;if(!perRole[r])return;perRole[r].count++;
    const nk=ROLES[r].north;
    perRole[r].northToday += +(byUserToday[p.id]?.[nk]||0);
    perRole[r].northMonth += (monthByUser[p.id]||[]).reduce((a,e)=>a+ +(e.kpis?.[nk]||0),0);
  });
  const top=el('div','grid grid-4');
  const compPct=collaborators.length?compiledToday/collaborators.length:0;
  top.innerHTML=`
    <div class="stat"><div class="tag ${statusOf(compPct)}">${Math.round(compPct*100)}%</div><div class="lbl">✅ Compilato oggi</div><div class="val mono">${compiledToday}/${collaborators.length}</div><div class="meta">collaboratori attivi</div></div>
    <div class="stat"><div class="lbl">👥 Team attivo</div><div class="val mono">${collaborators.length}</div><div class="meta">con area assegnata</div></div>
    <div class="stat"><div class="lbl">🚫 Non compilato</div><div class="val mono">${collaborators.length-compiledToday}</div><div class="meta">da sollecitare oggi</div></div>
    <div class="stat"><div class="lbl">📅 Giorno lavorativo</div><div class="val mono">${wdM}/${WORKDAYS_MONTH}</div><div class="meta">del mese in corso</div></div>`;
  body.appendChild(top);

  // ALERT OPERATIVI — cosa richiede azione oggi
  const alerts=[];
  function workdaysSince(iso){ if(!iso) return 999; let n=0; const d=new Date(iso+'T00:00:00'),t=today(); for(let x=new Date(d);x<t;x.setDate(x.getDate()+1)){if(x.getDay()!==0)n++;} return n; }
  collaborators.forEach(p=>{
    const days=(monthByUser[p.id]||[]).map(e=>e.day).sort();
    const last=days.length?days[days.length-1]:null;
    const since=workdaysSince(last);
    const nm=p.display_name||p.id.slice(0,8);
    if(!last) alerts.push({sev:'bad',msg:`<b>${nm}</b> non ha mai compilato questo mese.`});
    else if(since>=2) alerts.push({sev:'bad',msg:`<b>${nm}</b> non compila da <b>${since} giorni</b>.`});
  });
  ROLE_ORDER.filter(r=>perRole[r].count>0).forEach(r=>{
    const R=ROLES[r],nk=R.kpis.find(k=>k.key===R.north);if(!nk)return;
    const tgt=nk.daily*perRole[r].count*wdM, pct=tgt?perRole[r].northMonth/tgt:1;
    if(pct<0.6) alerts.push({sev:'warn',msg:`Reparto <b>${R.icon} ${R.label}</b> sotto target ${nk.label.toLowerCase()} (${Math.round(pct*100)}% del ritmo mese).`});
  });
  if(!isMgr && !profiles.some(p=>(p.display_name||'').toLowerCase().includes('daniela')))
    alerts.push({sev:'warn',msg:`<b>Daniela</b> risulta attiva su CloudTalk (top setter) ma non è presente nell'OS — va creata.`});
  const alertCard=el('div','card'); alertCard.style.marginTop='16px';
  alertCard.innerHTML=`<div class="card-h"><h3>🚨 Alert operativi</h3><span class="muted">${alerts.length} da gestire</span></div>`;
  if(alerts.length){
    const list=el('div'); list.style.cssText='display:flex;flex-direction:column;gap:8px';
    alerts.sort((a,b)=>(a.sev==='bad'?0:1)-(b.sev==='bad'?0:1)).slice(0,12).forEach(a=>{
      const b=el('div','banner '+(a.sev==='bad'?'bad':'warn')); b.style.margin='0'; b.innerHTML=(a.sev==='bad'?'🔴 ':'⚠️ ')+a.msg; list.appendChild(b);
    });
    alertCard.appendChild(list);
  } else alertCard.appendChild(el('div','banner good','✅ Tutto in ordine: nessun alert oggi.'));
  body.appendChild(alertCard);

  // per reparto
  const roleCard=el('div','card'); roleCard.style.marginTop='16px';
  roleCard.innerHTML=`<div class="card-h"><h3>Performance per reparto · oggi vs ritmo mese</h3></div>`;
  const rtbl=el('table','tbl');
  rtbl.innerHTML=`<thead><tr><th>Reparto</th><th>Persone</th><th>KPI nord oggi</th><th>Mese</th><th>Ritmo</th></tr></thead><tbody>${
    ROLE_ORDER.filter(r=>perRole[r].count>0).map(r=>{
      const R=ROLES[r],nk=R.kpis.find(k=>k.key===R.north),tgtMonth=nk.daily*perRole[r].count*wdM;
      const pct=tgtMonth?perRole[r].northMonth/tgtMonth:0,st=statusOf(pct);
      return `<tr><td><b>${R.icon} ${R.label}</b></td><td>${perRole[r].count}</td>
        <td class="mono">${fmtv(perRole[r].northToday,nk.unit)}</td>
        <td class="mono">${fmtv(perRole[r].northMonth,nk.unit)} <span class="muted">/ ${fmtv(tgtMonth,nk.unit)}</span></td>
        <td><span class="pill ${st==='good'?'role':''}" style="${st==='bad'?'background:var(--bad-soft);color:var(--bad)':st==='warn'?'background:var(--warn-soft);color:var(--warn)':'background:var(--good-soft);color:var(--good)'}">${statusLabel(st)}</span></td></tr>`;
    }).join('')||'<tr><td colspan="5" class="empty">Nessun dato ancora. Quando il team compila, comparirà qui.</td></tr>'
  }</tbody>`;
  roleCard.appendChild(rtbl);
  body.appendChild(roleCard);

  // persone (chi ha compilato / chi no, performance mese)
  const peopleCard=el('div','card'); peopleCard.style.marginTop='16px';
  peopleCard.innerHTML=`<div class="card-h"><h3>Persone · stato di oggi e performance mese</h3></div>`;
  const ptbl=el('table','tbl');
  const rows=collaborators.map(p=>{
    const R=ROLES[p.sales_role],nk=R.kpis.find(k=>k.key===R.north);
    const did=!!byUserToday[p.id];
    const month=(monthByUser[p.id]||[]).reduce((a,e)=>a+ +(e.kpis?.[nk.key]||0),0);
    const tgt=nk.daily*wdM,pct=tgt?month/tgt:0,st=statusOf(pct);
    return {p,R,nk,did,month,tgt,st,pct};
  }).sort((a,b)=>(a.did-b.did)|| (b.pct-a.pct));
  ptbl.innerHTML=`<thead><tr><th>Persona</th><th>Reparto</th><th>Oggi</th><th>KPI nord · mese</th><th>Stato</th></tr></thead><tbody>${
    rows.map(({p,R,nk,did,month,tgt,st})=>`<tr>
      <td><b>${p.display_name||p.id.slice(0,8)}</b></td>
      <td><span class="pill role">${R.icon} ${R.label}</span></td>
      <td>${did?'<span class="dotk g"></span> compilato':'<span class="dotk b"></span> <span class="muted">manca</span>'}</td>
      <td class="mono">${fmtv(month,nk.unit)} <span class="muted">/ ${fmtv(tgt,nk.unit)}</span></td>
      <td><span class="dotk ${st==='good'?'g':st==='warn'?'w':'b'}"></span> ${statusLabel(st)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Nessun collaboratore con area assegnata.</td></tr>'
  }</tbody>`;
  peopleCard.appendChild(ptbl);
  body.appendChild(peopleCard);

  // nota placeholder target
  if(!isMgr){
    const note=el('div','banner info'); note.style.marginTop='16px';
    note.innerHTML='ℹ️ I target sono modificabili in <b>🎯 Obiettivi</b>. Imposta lì i valori reali per ruolo e tutto il "sotto/sopra ritmo" si aggiorna per il team.';
    body.appendChild(note);
  }
}

/* ---------- ADMIN/MANAGER: ANALISI (grafici + selettore periodo) ---------- */
async function viewAnalytics(c,scope){
  const isMgr=scope==='manager';
  if(!S.period) S.period={mode:'30',from:null,to:null};
  c.innerHTML=`<div class="page-head"><div><h1>📊 Analisi${isMgr&&ROLES[S.role]?' · '+ROLES[S.role].label:''}</h1><p class="sub">Chi lavora di più, giorni più produttivi e andamento. Scegli il periodo.</p></div></div>
    <div id="anCtrl" class="card" style="margin-bottom:16px"></div>
    <div id="anBody"><div class="empty">Carico lo storico…</div></div>`;
  const {profiles,entries}=await analyticsData();
  let collaborators=profiles.filter(p=>p.role!=='admin'&&p.sales_role&&p.trackable!==false&&p.active!==false);
  if(isMgr) collaborators=collaborators.filter(p=>p.sales_role===S.role);
  const collabIds=new Set(collaborators.map(p=>p.id));
  const wdNames=['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
  const hbar=(label,sub,pct,color)=>`<div style="margin-bottom:11px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><b>${label}</b><span class="muted">${sub}</span></div><div style="background:var(--line);border-radius:6px;height:13px;overflow:hidden"><span style="display:block;height:100%;width:${Math.max(2,Math.min(100,pct))}%;background:${color};transition:width .3s"></span></div></div>`;

  function range(){
    const t=today(),iso=isoDay,m=S.period.mode;
    if(m==='custom'&&S.period.from&&S.period.to) return {from:S.period.from,to:S.period.to,label:'periodo scelto'};
    if(m==='today') return {from:iso(t),to:iso(t),label:'oggi'};
    if(m==='month') return {from:iso(monthStart()),to:iso(t),label:'questo mese'};
    const n=+m||30,f=new Date(t);f.setDate(f.getDate()-(n-1));
    return {from:iso(f),to:iso(t),label:'ultimi '+n+' giorni'};
  }
  function wire(){
    const m=S.period.mode;
    const chip=(id,lbl)=>`<button class="anchip${m===id?' on':''}" data-m="${id}">${lbl}</button>`;
    $('#anCtrl',c).innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
      ${chip('today','Oggi')}${chip('7','7 giorni')}${chip('30','30 giorni')}${chip('month','Questo mese')}${chip('90','90 giorni')}
      <span style="margin-left:6px;color:var(--muted);font-size:13px">dal</span>
      <input type="date" id="anFrom" value="${S.period.from||''}" style="padding:7px 9px;border:1px solid var(--line);border-radius:9px">
      <span style="color:var(--muted);font-size:13px">al</span>
      <input type="date" id="anTo" value="${S.period.to||''}" style="padding:7px 9px;border:1px solid var(--line);border-radius:9px">
      <button class="anchip${m==='custom'?' on':''}" id="anApply">Applica</button></div>`;
    $('#anCtrl',c).querySelectorAll('.anchip[data-m]').forEach(b=>b.addEventListener('click',()=>{S.period={mode:b.dataset.m,from:null,to:null};wire();paint();}));
    const ap=$('#anApply',c);if(ap)ap.addEventListener('click',()=>{const f=$('#anFrom',c).value,t=$('#anTo',c).value;if(f&&t){S.period={mode:'custom',from:f,to:t};wire();paint();}else toast('Scegli data inizio e fine');});
  }
  function paint(){
    const {from,to,label}=range();
    const ents=entries.filter(e=>e.day>=from&&e.day<=to&&collabIds.has(e.user_id));
    const per={};collaborators.forEach(p=>per[p.id]={days:new Set(),perf:0,pn:0,vol:0});
    ents.forEach(e=>{const p=per[e.user_id];if(!p)return;const R=ROLES[e.role];if(!R)return;const nk=R.kpis.find(k=>k.key===R.north);if(!nk)return;const v=+(e.kpis?.[nk.key]||0);p.days.add(e.day);p.vol+=v;if(nk.daily>0){p.perf+=Math.min(2,v/nk.daily);p.pn++;}});
    const rank=collaborators.map(p=>({p,days:per[p.id].days.size,perf:per[p.id].pn?per[p.id].perf/per[p.id].pn:0})).filter(r=>r.days>0).sort((a,b)=>b.days-a.days||b.perf-a.perf);
    const wd=wdNames.map(()=>({ents:0,perf:0,pn:0}));const wdMap={1:0,2:1,3:2,4:3,5:4,6:5,0:6};
    ents.forEach(e=>{const d=new Date(e.day+'T00:00:00'),slot=wd[wdMap[d.getDay()]];slot.ents++;const R=ROLES[e.role],nk=R&&R.kpis.find(k=>k.key===R.north);if(nk&&nk.daily>0){slot.perf+=Math.min(2,(+(e.kpis?.[nk.key]||0))/nk.daily);slot.pn++;}});
    const dayMap={};ents.forEach(e=>dayMap[e.day]=(dayMap[e.day]||0)+1);const dayKeys=Object.keys(dayMap).sort();
    const roleCount={};ents.forEach(e=>roleCount[e.role]=(roleCount[e.role]||0)+1);
    const totalComp=ents.length,bestWdIdx=wd.reduce((bi,s,i,a)=>s.ents>a[bi].ents?i:bi,0);
    const body=$('#anBody',c);body.innerHTML='';

    const sum=el('div','grid grid-4');
    sum.innerHTML=`
      <div class="stat"><div class="lbl">📝 Compilazioni</div><div class="val mono">${totalComp}</div><div class="meta">${label}</div></div>
      <div class="stat"><div class="lbl">👥 Persone attive</div><div class="val mono">${rank.length}</div><div class="meta">hanno compilato</div></div>
      <div class="stat"><div class="lbl">🏆 Più costante</div><div class="val mono" style="font-size:19px">${rank[0]?(rank[0].p.display_name||'—'):'—'}</div><div class="meta">${rank[0]?rank[0].days+' giorni':'nessun dato'}</div></div>
      <div class="stat"><div class="lbl">📅 Giorno top</div><div class="val mono" style="font-size:19px">${totalComp?wdNames[bestWdIdx]:'—'}</div><div class="meta">${totalComp?wd[bestWdIdx].ents+' compilazioni':'—'}</div></div>`;
    body.appendChild(sum);

    const rc=el('div','card');rc.style.marginTop='16px';
    rc.innerHTML=`<div class="card-h"><h3>🏅 Chi lavora di più</h3><span class="muted">giorni compilati · % ritmo medio</span></div>`;
    if(rank.length){const maxDays=rank[0].days;
      rc.insertAdjacentHTML('beforeend',rank.map(r=>{const col=r.perf>=1?'var(--good)':r.perf>=0.6?'var(--warn)':'var(--bad)';return hbar(`${ROLES[r.p.sales_role]?.icon||''} ${r.p.display_name||'—'}`,`${r.days} gg · ${Math.round(r.perf*100)}% ritmo`,maxDays?r.days/maxDays*100:0,col);}).join(''));
    } else rc.insertAdjacentHTML('beforeend','<div class="empty">Nessuna compilazione nel periodo.</div>');
    body.appendChild(rc);

    const wc=el('div','card');wc.style.marginTop='16px';
    wc.innerHTML=`<div class="card-h"><h3>📆 Produttività per giorno</h3><span class="muted">quando il team lavora davvero</span></div>`;
    const maxWd=Math.max(1,...wd.map(s=>s.ents));
    wc.insertAdjacentHTML('beforeend',`<div style="display:flex;align-items:flex-end;gap:10px;height:150px;padding-top:10px">${wd.map((s,i)=>{const h=Math.round(s.ents/maxWd*100),avg=s.pn?Math.round(s.perf/s.pn*100):0,col=i===bestWdIdx&&totalComp?'var(--good)':'#3b82f6';return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">${s.ents||''}</div><div title="${avg}% ritmo medio" style="width:100%;background:${col};border-radius:6px 6px 0 0;height:${Math.max(2,h)}%"></div><div style="font-size:12px;margin-top:6px;font-weight:600">${wdNames[i]}</div></div>`;}).join('')}</div>`);
    body.appendChild(wc);

    const dc=el('div','card');dc.style.marginTop='16px';
    dc.innerHTML=`<div class="card-h"><h3>📈 Andamento compilazioni</h3><span class="muted">giorno per giorno</span></div>`;
    if(dayKeys.length){const maxd=Math.max(1,...dayKeys.map(k=>dayMap[k]));
      dc.insertAdjacentHTML('beforeend',`<div class="spark" style="height:90px">${dayKeys.map(k=>`<i style="height:${Math.max(6,Math.round(dayMap[k]/maxd*100))}%" title="${k}: ${dayMap[k]} compilazioni"></i>`).join('')}</div>`);
    } else dc.insertAdjacentHTML('beforeend','<div class="empty">Nessun dato nel periodo.</div>');
    body.appendChild(dc);

    const pc=el('div','card');pc.style.marginTop='16px';
    pc.innerHTML=`<div class="card-h"><h3>🏢 Distribuzione per reparto</h3></div>`;
    const roles=Object.keys(roleCount).sort((a,b)=>roleCount[b]-roleCount[a]);
    if(roles.length){const maxr=Math.max(...roles.map(r=>roleCount[r]));
      pc.insertAdjacentHTML('beforeend',roles.map(r=>hbar(`${ROLES[r]?.icon||''} ${ROLES[r]?.label||r}`,`${roleCount[r]} compilazioni`,roleCount[r]/maxr*100,'#3b82f6')).join(''));
    } else pc.insertAdjacentHTML('beforeend','<div class="empty">Nessun dato.</div>');
    body.appendChild(pc);
  }
  wire();paint();
}

/* ---------- GO ---------- */
boot();
