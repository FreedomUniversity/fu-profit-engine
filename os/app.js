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
   ⚠️ I TARGET sono PLACEHOLDER da validare con Domenico/manager. La struttura è quella vera. */
const ROLES = {
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
const ROLE_ORDER = ['ba','chatter','setter','closer','sm'];

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
  if(session){ S.user=session.user; await loadProfile(); await loadTargets(); renderApp(); }
  else renderLogin();
  sb.auth.onAuthStateChange((_e,sess)=>{
    const was=S.user; S.user=sess?.user||null;
    if(S.user && !was){ loadProfile().then(loadTargets).then(renderApp); }
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
// carica i target reali da os_targets e sovrascrive i default in ROLES (così tutte le viste li usano)
async function loadTargets(){
  if(DEMO) return;
  try{
    const {data} = await sb.from('os_targets').select('role,kpi,daily');
    (data||[]).forEach(r=>{const kp=ROLES[r.role]?.kpis.find(k=>k.key===r.kpi); if(kp)kp.daily=+r.daily;});
  }catch(e){ console.warn('targets load fail',e); }
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
    sb.from('profiles').select('id,display_name,role,sales_role'),
    sb.from('os_entries').select('user_id,role,day,kpis').gte('day',isoDay(monthStart()))
  ]);
  return {profiles:profiles||[], entries:entries||[]};
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
    const nav=[{id:'admin',icon:'🛰️',label:'Cabina di comando'},{id:'roles',icon:'🔑',label:'Ruoli'},{id:'targets',icon:'🎯',label:'Obiettivi'},{id:'sim',icon:'🎚️',label:'Simulatore'}];
    if(!['admin','roles','targets','sim'].includes(S.view))S.view='admin';
    const c=el('div'); shell(nav,c);
    if(S.view==='sim') viewSimulator(c);
    else if(S.view==='roles') viewTeamAssign(c);
    else if(S.view==='targets') viewTargets(c);
    else viewAdmin(c,'admin');
    return;
  }
  if(S.isManager){
    const nav=[{id:'admin',icon:'👥',label:'Il mio reparto'},{id:'sim',icon:'🎚️',label:'Simulatore'}];
    if(!['admin','sim'].includes(S.view))S.view='admin';
    const c=el('div'); shell(nav,c);
    if(S.view==='sim') viewSimulator(c); else viewAdmin(c,'manager');
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
  c.innerHTML=`<div class="page-head"><div><h1>🎯 Obiettivi</h1><p class="sub">Imposta i target giornalieri per ruolo. Da qui "sotto/sopra ritmo" diventa reale per tutto il team.</p></div></div><div id="tgBody"><div class="empty">Carico…</div></div>`;
  const {data}=await sb.from('os_targets').select('role,kpi,daily');
  const cur={};(data||[]).forEach(r=>{(cur[r.role]=cur[r.role]||{})[r.kpi]=+r.daily;});
  const body=$('#tgBody',c);body.innerHTML='';
  ROLE_ORDER.forEach(r=>{
    const R=ROLES[r];const card=el('div','card');card.style.marginBottom='16px';
    card.innerHTML=`<div class="card-h"><h3>${R.icon} ${R.label}</h3></div>`;
    const form=el('div','kpi-form');
    R.kpis.forEach(k=>{const v=cur[r]?.[k.key] ?? k.daily;
      const f=el('div','field');
      f.innerHTML=`<div class="f-lbl">${k.label}<small>obiettivo giornaliero a persona</small></div><div class="f-in"><input id="tg_${r}_${k.key}" type="number" min="0" inputmode="numeric" value="${v}"><span class="unit">${k.unit}</span></div>`;
      form.appendChild(f);});
    card.appendChild(form);body.appendChild(card);
  });
  const row=el('div');row.style.cssText='display:flex;align-items:center;gap:12px;position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 40%);padding:14px 0';
  const save=el('button','btn btn-primary','💾 Salva tutti gli obiettivi');const msg=el('span','muted');
  row.appendChild(save);row.appendChild(msg);body.appendChild(row);
  save.addEventListener('click',async()=>{
    save.disabled=true;save.textContent='Salvo…';
    const rows=[];ROLE_ORDER.forEach(r=>ROLES[r].kpis.forEach(k=>{rows.push({role:r,kpi:k.key,daily:+($('#tg_'+r+'_'+k.key,c).value||0)});}));
    const {error}=await sb.from('os_targets').upsert(rows,{onConflict:'role,kpi'});
    if(error){save.disabled=false;save.textContent='💾 Salva tutti gli obiettivi';msg.style.color='var(--bad)';msg.textContent='Errore: '+error.message;return;}
    await loadTargets();save.textContent='✓ Salvato';msg.textContent='Target aggiornati per tutto il team.';toast('Obiettivi salvati');
    setTimeout(()=>{save.disabled=false;save.textContent='💾 Salva tutti gli obiettivi';},1600);
  });
}

/* ---------- ADMIN: RUOLI (assegnazione area) ---------- */
async function viewTeamAssign(c){
  c.innerHTML=`<div class="page-head"><div><h1>🔑 Ruoli</h1><p class="sub">Assegna a ogni persona la sua area. Senza ruolo, il collaboratore vede solo il messaggio di attesa.</p></div></div>
  <input id="raSearch" placeholder="🔎 Cerca per nome…" style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:11px;margin-bottom:14px;font-size:15px">
  <div class="card" id="raBody"><div class="empty">Carico…</div></div>`;
  const {data}=await sb.from('profiles').select('id,display_name,role,sales_role').order('display_name');
  const profs=data||[];const opts=['',...ROLE_ORDER];
  function render(){
    const q=($('#raSearch',c)?.value||'').toLowerCase().trim();
    const rows=profs.filter(p=>!q||(p.display_name||p.id).toLowerCase().includes(q));
    $('#raBody',c).innerHTML=rows.map(p=>{
      const nm=p.display_name||('utente '+p.id.slice(0,8));
      if(p.role==='admin')return `<div class="field"><div class="f-lbl">${nm}</div><span class="pill role">🛡️ Admin · vede tutto</span></div>`;
      const sel=`<select data-id="${p.id}" class="ra-sel" style="padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-weight:600">${opts.map(o=>`<option value="${o}" ${(p.sales_role||'')===o?'selected':''}>${o===''?'— nessuna area —':ROLES[o].icon+' '+ROLES[o].label}</option>`).join('')}</select>`;
      return `<div class="field"><div class="f-lbl">${nm}</div><div class="f-in">${sel}</div></div>`;
    }).join('')||'<div class="empty">Nessuno trovato.</div>';
    c.querySelectorAll('.ra-sel').forEach(s=>s.addEventListener('change',async()=>{
      const id=s.dataset.id,val=s.value||null;
      const {error}=await sb.from('profiles').update({sales_role:val}).eq('id',id);
      if(error){toast('Errore: '+error.message);return;}
      const p=profs.find(x=>x.id===id);if(p)p.sales_role=val;
      toast(val?('Assegnato: '+ROLES[val].label):'Ruolo rimosso');
    }));
  }
  render();$('#raSearch',c).addEventListener('input',render);
}

/* ---------- COLLAB: OGGI ---------- */
async function viewToday(c){
  const role=ROLES[S.role];
  c.innerHTML=`<div class="page-head"><div><h1>Oggi · ${role.icon} ${role.label}</h1><p class="sub" id="dateSub"></p></div></div><div id="todayBody"><div class="empty">Carico i tuoi numeri…</div></div>`;
  $('#dateSub',c).textContent = today().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
  const [entry,monthEntries] = await Promise.all([myToday(),myEntries(isoDay(monthStart()))]);
  const cur = entry?.kpis||{};
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
  formCard.innerHTML=`<div class="card-h"><h3>Compila la giornata · 60 secondi</h3></div>`;
  const form=el('div','kpi-form');
  role.kpis.forEach(k=>{
    const f=el('div','field');
    f.innerHTML=`<div class="f-lbl">${k.label}<small>obiettivo giornaliero: ${fmtv(k.daily,k.unit)}</small></div>
      <div class="f-in"><input id="k_${k.key}" type="number" min="0" inputmode="numeric" value="${cur[k.key]!=null?cur[k.key]:''}" placeholder="0"><span class="unit">${k.unit}</span></div>`;
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
  const collaborators=profiles.filter(p=>p.role!=='admin'&&p.sales_role);
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

/* ---------- GO ---------- */
boot();
