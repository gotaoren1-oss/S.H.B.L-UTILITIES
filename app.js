// =====================================================================
//  REEF · אשקלון — מערכת מעקב אינסטלציה
//  ש.ה.ב.ל תשתיות ומערכות מים בע״מ
// =====================================================================
import { CONFIG } from './config.js';
import { Api } from './api.js';
import {
  BUILDINGS, FLOORS, ROOM_FLOORS, AREAS, STAGES, AREA_STAGES, TESTS, STATUS,
  allRoomIds, parseRoom, roomId, roomStatus, roomProgress, openGaps, summarize, isDisabled, DEFAULT_DISABLED
} from './data.js';
import { planSVG } from './plan.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' · ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); };
const ago = iso => { if (!iso) return ''; const m = (Date.now() - new Date(iso)) / 6e4; if (m < 1) return 'עכשיו'; if (m < 60) return `לפני ${Math.round(m)} דק׳`; const h = m / 60; if (h < 24) return `לפני ${Math.round(h)} שע׳`; return `לפני ${Math.round(h / 24)} ימים`; };
const uid = () => 'g' + Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o || {}));

const api = new Api(CONFIG.API_URL);
const state = { data: null, view: 'dashboard', sel: { b: null, f: null }, room: null, gapFilter: 'open', scene: null, sceneReady: false };

// ================================================================ BOOT
init();
async function init() {
  if (!api.live) { $('#demoBanner').hidden = false; $('#demoActions').hidden = false; }
  bindIntro();
  bindApp();
  loadScene();
  try { state.data = await api.load(); setSync('ok'); } catch (e) { console.error(e); state.data = { structure: { disabled: DEFAULT_DISABLED }, rooms: {}, log: [] }; setSync('err', 'אין חיבור לשרת'); }
  renderAll();
  updateLockBtn();
  setInterval(poll, Math.max(10, CONFIG.POLL_SECONDS) * 1000);
}

async function poll() {
  if (document.hidden) return;
  if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  try { const d = await api.load(); if (d && d.updatedAt !== state.data.updatedAt) { state.data = d; renderAll(true); } setSync('ok'); }
  catch { setSync('err', 'אין חיבור'); }
}

function setSync(s, txt) {
  const el = $('#syncState'); el.className = 'sync ' + s;
  $('em', el).textContent = txt || (api.live ? 'מסונכרן לדרייב' : 'מצב הדגמה');
}

// ================================================================ 3D SCENE + INTRO
async function loadScene() {
  try {
    const { ReefScene } = await import('./scene.js');
    const sc = state.scene = new ReefScene($('#stage'));
    state.sceneReady = true;
    sc.on('tod', ({ phase }) => { const el = $('#hudPhase'); if (el) el.textContent = phase; });
    sc.on('pickBuilding', b => selectBuilding(b));
    sc.on('pickFloor', (b, f) => { if (state.sel.b !== b) selectBuilding(b, true); selectFloor(f); });
    sc.on('hover', (b, f) => {
      if (state.view !== 'explore') return;
      $('#exploreHint').textContent = b ? (f ? `${bName(b)} · ${floorName(f)} — לחצו לפתיחה` : `${bName(b)} — לחצו לבחירה`) : (state.sel.b ? 'בחרו מפלס בבניין' : 'בחרו בניין על גבי ההדמיה');
    });
    startIntro();
  } catch (e) {
    console.error('3D unavailable', e);
    $('#intro').classList.add('no3d');
    startIntro(true);
  }
}

function startIntro(no3d) {
  tickClock(); setInterval(tickClock, 15000);
  const curtain = $('#introCurtain');
  setTimeout(() => curtain.classList.add('show'), 80);
  setTimeout(() => {
    curtain.classList.add('out');
    $('#introHud').classList.add('show');
    if (state.skipped) return;
    if (!no3d && state.scene) {
      state.scene.playIntro((cap, i) => {
        const c = $('#hudCaption'); c.classList.remove('in'); void c.offsetWidth;
        c.textContent = cap; if (cap) c.classList.add('in');
        if (i >= 1) $('#introHud').classList.add('titled');
      }, () => { $('#introHud').classList.add('ready'); $('#btnSkip').classList.add('gone'); });
    } else { $('#introHud').classList.add('titled', 'ready'); }
  }, 3300);
}
function tickClock() {
  if (!$('#hudTime')) return;
  $('#hudTime').textContent = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
}

function bindIntro() {
  $('#btnSkip').addEventListener('click', () => {
    state.skipped = true;
    $('#introCurtain').classList.add('show', 'out'); $('#introHud').classList.add('show', 'titled', 'ready');
    if (state.scene) { if (state.scene.mode !== 'intro') state.scene.playIntro(() => { }, () => { }); state.scene.skipIntro(); }
    $('#btnSkip').classList.add('gone');
  });
  $$('.tod-switch button').forEach(b => b.addEventListener('click', () => {
    $$('.tod-switch button').forEach(x => x.classList.toggle('on', x === b));
    const v = b.dataset.tod; state.scene && state.scene.setTimeOfDay(v === 'auto' ? null : +v);
    if (v !== 'auto') $('#hudTime').textContent = `${String(Math.floor(+v)).padStart(2, '0')}:${String(Math.round((+v % 1) * 60)).padStart(2, '0')}`; else tickClock();
  }));
  $('#btnEnter').addEventListener('click', enterApp);
}

function enterApp() {
  document.body.classList.add('leaving');
  setTimeout(() => {
    document.body.classList.remove('is-intro', 'leaving');
    $('#intro').remove();
    $('#app').hidden = false;
    if (state.scene) { state.scene.pause(); state.scene.setTimeOfDay(null); }
    setView(location.hash.slice(1) || 'dashboard');
    requestAnimationFrame(() => document.body.classList.add('app-in'));
  }, 900);
}

// ================================================================ NAV
function bindApp() {
  $$('#tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]'); if (g) setView(g.dataset.goto);
    const r = e.target.closest('[data-open]'); if (r) openRoom(r.dataset.open);
  });
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== state.view && !document.body.classList.contains('is-intro')) setView(v); });
  $('#btnLock').addEventListener('click', () => { if (api.canEdit) { api.logout(); updateLockBtn(); toast('יצאת ממצב עריכה'); rerenderDrawer(); } else openLogin(); });
  $('#scrim').addEventListener('click', closeRoom);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRoom(); });
  $('#gapFilter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.gapFilter = b.dataset.f; $$('#gapFilter button').forEach(x => x.classList.toggle('on', x === b)); renderGaps(); });
  $('#btnExport').addEventListener('click', exportCSV);
  $('#formCode').addEventListener('submit', onChangeCode);
  $('#btnSeed').addEventListener('click', e => { if (armed(e.currentTarget, 'לחצו שוב לאישור')) { state.data = api.demoReset(true); renderAll(); toast('נטענו נתוני הדגמה'); } });
  $('#btnReset').addEventListener('click', e => { if (armed(e.currentTarget, 'לחצו שוב לאיפוס')) { state.data = api.demoReset(false); renderAll(); toast('הנתונים אופסו'); } });
  bindLogin();
}

const VIEWS = ['dashboard', 'explore', 'gaps', 'log', 'settings'];
function setView(v) {
  if (!VIEWS.includes(v)) v = 'dashboard';
  state.view = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'view-' + v));
  if (v === 'explore') {
    if (state.scene) {
      $('#stage').classList.add('docked');
      state.scene.mount($('#explore3d'));
      state.scene.enterPicker();
      state.scene.setFloorStats(summarize(state.data).floor);
      if (state.sel.b) { state.scene.selectBuilding(state.sel.b); state.scene.selectFloor(state.sel.f); }
    } else $('#explore3d').classList.add('no3d');
    renderExplore();
  } else if (state.scene) state.scene.pause();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const bName = b => `בניין ${b}`;
const floorName = f => (FLOORS.find(x => x.id === f) || { name: f === 'R' ? 'גג' : `קומה ${f}` }).name;

// ================================================================ RENDER
function renderAll(fromPoll) {
  if (!state.data) return;
  renderDashboard();
  renderGaps();
  renderLog();
  renderSettings();
  if (state.view === 'explore') { renderExplore(); state.scene && state.scene.setFloorStats(summarize(state.data).floor); }
  if (state.room && !fromPoll) rerenderDrawer();
  if (state.room && fromPoll && !$('#drawer').contains(document.activeElement)) rerenderDrawer();
}

function renderDashboard() {
  const d = state.data, S = summarize(d);
  const pct = Math.round(S.pct * 100);
  $('#ringVal').textContent = pct + '%';
  const C = 2 * Math.PI * 52; const fg = $('#ringFg'); fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C * (1 - S.pct);
  $('#dashUpdated').textContent = d.updatedAt ? `עודכן לאחרונה ${fmtDate(d.updatedAt)} (${ago(d.updatedAt)})` : 'טרם הוזנו נתונים';
  $('#gapsBadge').textContent = S.gaps; $('#gapsBadge').classList.toggle('zero', !S.gaps);

  const doneAll = S.by.done + S.by.approved;
  const k = [
    ['סה״כ חדרים', S.total, 'חדרי שינה בפרויקט', 'k-total'],
    ['הושלמו', doneAll, `${Math.round(doneAll / S.total * 100) || 0}% מהחדרים`, 'k-done'],
    ['נבדקו ואושרו', S.by.approved, 'עם שם הבודק', 'k-ok'],
    ['בעבודה', S.by.progress, 'נותרו עבודות אינסטלציה', 'k-prog'],
    ['טרם החלו', S.by.none, 'ממתינים לתחילת עבודה', 'k-none'],
    ['פערים פתוחים', S.gaps, `ב-${S.by.gap} חדרים`, 'k-gap'],
    ['בדיקות שעברו', `${S.testsPass}/${S.testsTotal}`, S.testsFail ? `${S.testsFail} בדיקות נכשלו` : 'לחץ · ניקוז · תפקוד', 'k-test']
  ];
  $('#kpis').innerHTML = k.map(([t, v, s, c], i) => `<div class="kpi ${c}" style="--i:${i}"><span class="kpi-t">${t}</span><b class="kpi-v" data-count="${typeof v === 'number' ? v : ''}">${v}</b><span class="kpi-s">${esc(s)}</span></div>`).join('');
  countUp();

  $('#bldBars').innerHTML = BUILDINGS.map(b => {
    const B = S.bld[b.id]; const p = B.total ? B.progress / B.total : 0;
    return `<button class="bbar" data-bld="${b.id}"><div class="bbar-h"><b>${b.name}</b><span>${B.done}/${B.total} הושלמו${B.gaps ? ` · <em>${B.gaps} פערים</em>` : ''}</span><strong>${Math.round(p * 100)}%</strong></div><div class="bar"><i style="width:${p * 100}%"></i></div></button>`;
  }).join('');
  $$('#bldBars .bbar').forEach(el => el.addEventListener('click', () => { setView('explore'); selectBuilding(el.dataset.bld); }));

  const ids = allRoomIds(d.structure);
  $('#testStats').innerHTML = TESTS.map(t => {
    let pass = 0, fail = 0; ids.forEach(id => { const v = d.rooms[id] && d.rooms[id].t && d.rooms[id].t[t.k]; if (v && v.r === 'pass') pass++; if (v && v.r === 'fail') fail++; });
    return `<div class="tstat"><div class="tstat-h"><span>${t.t}</span><b>${pass}<small>/${ids.length}</small></b></div><div class="bar bar--split"><i class="p" style="width:${pass / ids.length * 100}%"></i><i class="f" style="width:${fail / ids.length * 100}%"></i></div>${fail ? `<span class="tfail">${fail} נכשלו — דורש בדיקה חוזרת</span>` : ''}</div>`;
  }).join('');

  $('#legend').innerHTML = ['none', 'progress', 'gap', 'done', 'approved'].map(s => `<span><i style="background:${STATUS[s].c}"></i>${STATUS[s].t} <b>${S.by[s]}</b></span>`).join('');

  // heatmap
  let h = `<div class="heat-row heat-head"><span></span>${BUILDINGS.map(b => `<span class="hh">${b.name}</span>`).join('')}</div>`;
  [...ROOM_FLOORS].reverse().forEach(f => {
    h += `<div class="heat-row"><span class="hf">${f}</span>`;
    BUILDINGS.forEach(b => {
      h += `<span class="hgrp">` + b.rooms.map(i => {
        const id = roomId(f, i);
        if (isDisabled(d.structure, id)) return `<i class="cell off" title="${id} · לא פעיל"></i>`;
        const r = d.rooms[id], st = roomStatus(r), g = openGaps(r).length;
        return `<button class="cell st-${st}" data-open="${id}" style="--c:${STATUS[st].c};--p:${roomProgress(r)}" title="חדר ${id} · ${STATUS[st].t}"><em>${id}</em>${g ? '<s></s>' : ''}</button>`;
      }).join('') + `</span>`;
    });
    h += `</div>`;
  });
  $('#heat').innerHTML = h;

  // gaps
  const gl = collectGaps('open').slice(0, 6);
  $('#dashGaps').innerHTML = gl.length ? gl.map(gapRow).join('') : `<p class="empty">אין פערים פתוחים 🎉</p>`;
  // approvals
  const ap = Object.entries(d.rooms).filter(([, r]) => r.ap).sort((a, b) => b[1].ap.at.localeCompare(a[1].ap.at)).slice(0, 6);
  $('#dashApprovals').innerHTML = ap.length ? ap.map(([id, r]) => `<button class="li" data-open="${id}"><span class="li-ic ok">✓</span><span class="li-b"><b>${esc(parseRoom(id).name)}</b><small>אושר ע״י ${esc(r.ap.by)}</small></span><span class="li-t">${ago(r.ap.at)}</span></button>`).join('') : `<p class="empty">עדיין אין אישורי מסירה</p>`;

  // areas
  $('#areasGrid').innerHTML = AREAS.map(a => {
    const r = d.rooms[a.id], st = roomStatus(r), p = roomProgress(r);
    return `<button class="area st-${st}" data-open="${a.id}" style="--c:${STATUS[st].c}"><span class="area-f">${a.floor === 'B' ? 'מרתף' : a.floor === '0' ? 'קרקע' : 'גג'}</span><b>${esc(a.name)}</b><span class="area-s">${STATUS[st].t}</span><div class="bar"><i style="width:${p * 100}%"></i></div></button>`;
  }).join('');
}

function countUp() {
  $$('.kpi-v[data-count]').forEach(el => {
    const to = +el.dataset.count; if (!el.dataset.count) return;
    const t0 = performance.now(); const from = 0;
    const step = now => { const k = Math.min(1, (now - t0) / 900); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

function collectGaps(filter) {
  const out = [];
  Object.entries(state.data.rooms).forEach(([id, r]) => (r.gaps || []).forEach(g => {
    if (filter === 'open' && g.closed) return; if (filter === 'closed' && !g.closed) return;
    out.push({ id, g });
  }));
  return out.sort((a, b) => (b.g.at || '').localeCompare(a.g.at || ''));
}
const gapRow = ({ id, g }) => `<button class="li" data-open="${id}"><span class="li-ic ${g.closed ? 'ok' : 'gap'}">${g.closed ? '✓' : '!'}</span><span class="li-b"><b>${esc(parseRoom(id).name)}${parseRoom(id).b ? ' · ' + bName(parseRoom(id).b) : ''}</b><small>${esc(g.text)}</small><small class="by">דווח ע״י ${esc(g.by)}${g.closed ? ` · טופל ע״י ${esc(g.closed.by)}` : ''}</small></span><span class="li-t">${ago(g.closed ? g.closed.at : g.at)}</span></button>`;

function renderGaps() {
  const l = collectGaps(state.gapFilter);
  $('#gapsList').innerHTML = l.length ? l.map(gapRow).join('') : `<p class="empty">אין פריטים להצגה</p>`;
}

function renderLog() {
  const l = (state.data.log || []).slice(0, 200);
  $('#logList').innerHTML = l.length ? l.map(x => `<div class="li li--log">${x.id && x.id !== '—' ? `<button class="tag" data-open="${esc(x.id)}">${esc(x.id)}</button>` : '<span class="tag">כללי</span>'}<span class="li-b"><b>${esc(x.a)}</b><small>${esc(x.by)} · ${fmtDate(x.at)}</small></span></div>`).join('') : `<p class="empty">היומן ריק</p>`;
}

function renderSettings() {
  const d = state.data;
  const edit = api.canEdit;
  let h = `<div class="struct ${edit ? 'edit' : ''}">`;
  ROOM_FLOORS.forEach(f => {
    h += `<div class="struct-row"><span>${f}</span>` + BUILDINGS.map(b => `<span class="sg">` + b.rooms.map(i => { const id = roomId(f, i); const off = isDisabled(d.structure, id); return `<button class="sc ${off ? 'off' : ''}" data-toggle="${id}" ${edit ? '' : 'disabled'} title="${id}">${String(i).padStart(2, '0')}</button>`; }).join('') + `</span>`).join('') + `</div>`;
  });
  h += `</div><p class="muted small">סה״כ פעילים: <b>${allRoomIds(d.structure).length}</b> חדרים${edit ? ' · לחיצה על חדר מפעילה/מכבה אותו' : ' · כניסה למצב עריכה נדרשת לשינוי'}</p>`;
  $('#structureEditor').innerHTML = h;
  $$('#structureEditor [data-toggle]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.toggle; const s = clone(d.structure); s.disabled = s.disabled || [];
    s.disabled = s.disabled.includes(id) ? s.disabled.filter(x => x !== id) : [...s.disabled, id];
    try { state.data = await api.saveStructure(state.data, s); renderAll(); toast('המבנה עודכן ונשמר'); } catch (e) { toast(e.message, true); }
  }));
}

// ================================================================ EXPLORE
function renderExplore() {
  const { b, f } = state.sel;
  const S = summarize(state.data);
  $('#bldChips').innerHTML = BUILDINGS.map(x => `<button class="${b === x.id ? 'on' : ''}" data-b="${x.id}">${x.name}<small>${Math.round((S.bld[x.id].total ? S.bld[x.id].progress / S.bld[x.id].total : 0) * 100)}%</small></button>`).join('');
  $$('#bldChips button').forEach(el => el.addEventListener('click', () => selectBuilding(el.dataset.b === state.sel.b ? null : el.dataset.b)));

  const crumbs = [`<button data-c="root">REEF</button>`];
  if (b) crumbs.push(`<button data-c="b">${bName(b)}</button>`);
  if (f) crumbs.push(`<span>${floorName(f)}</span>`);
  $('#crumbs').innerHTML = crumbs.join('<i>›</i>');
  $$('#crumbs button').forEach(el => el.addEventListener('click', () => { if (el.dataset.c === 'root') selectBuilding(null); else selectFloor(null); }));

  const rail = $('#floorRail');
  if (b) {
    rail.hidden = false;
    rail.innerHTML = `<span class="rail-t">מפלס</span>` + [...FLOORS].reverse().map(F => {
      const st = S.floor[`${b}|${F.id}`] || { pct: 0, gaps: 0, total: 0 };
      const isRooms = ROOM_FLOORS.includes(F.id);
      const active = isRooms ? st.total > 0 : true;
      return `<button class="${f === F.id ? 'on' : ''} ${active ? '' : 'na'}" data-f="${F.id}" ${active ? '' : 'disabled'} style="--p:${st.pct}"><b>${F.short}</b><i class="${st.gaps ? 'g' : ''}"></i></button>`;
    }).join('');
    $$('#floorRail button').forEach(el => el.addEventListener('click', () => selectFloor(el.dataset.f)));
    $('#exploreHint').textContent = f ? 'בחרו חדר בתוכנית' : 'בחרו מפלס — בהדמיה או בסרגל';
  } else { rail.hidden = true; $('#exploreHint').textContent = 'בחרו בניין על גבי ההדמיה'; }

  // plan
  if (!b || !f) { $('#planEmpty').hidden = false; $('#planWrap').hidden = true; return; }
  $('#planEmpty').hidden = true; $('#planWrap').hidden = false;
  if (!ROOM_FLOORS.includes(f)) {
    const list = AREAS.filter(a => a.floor === f);
    $('#planTitle').textContent = `${floorName(f)} — מערכות ושטחים`;
    $('#planStats').innerHTML = '';
    $('#planSvg').innerHTML = `<div class="areas areas--plan">${list.map(a => { const r = state.data.rooms[a.id], st = roomStatus(r); return `<button class="area st-${st}" data-open="${a.id}" style="--c:${STATUS[st].c}"><b>${esc(a.name)}</b><span class="area-s">${STATUS[st].t}</span><div class="bar"><i style="width:${roomProgress(r) * 100}%"></i></div></button>`; }).join('')}</div>`;
    return;
  }
  const ids = BUILDINGS.find(x => x.id === b).rooms.map(i => roomId(f, i)).filter(id => !isDisabled(state.data.structure, id));
  const sts = ids.map(id => roomStatus(state.data.rooms[id]));
  $('#planTitle').innerHTML = `${bName(b)} · ${floorName(f)} <small>תוכנית קומה טיפוסית</small>`;
  $('#planStats').innerHTML = ['approved', 'done', 'progress', 'gap', 'none'].map(s => { const n = sts.filter(x => x === s).length; return n ? `<span style="--c:${STATUS[s].c}"><i></i>${STATUS[s].t} ${n}</span>` : ''; }).join('') || '<span>אין חדרים פעילים בקומה זו</span>';
  $('#planSvg').innerHTML = planSVG({ floor: f, building: b, data: state.data });
  $$('#planSvg .room').forEach(g => {
    const id = g.dataset.room; const meta = parseRoom(id);
    const go = () => { if (g.classList.contains('off')) return; if (meta.b !== state.sel.b) selectBuilding(meta.b, true); openRoom(id); };
    g.addEventListener('click', go);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  $$('#planSvg .wing').forEach(w => w.addEventListener('click', e => { if (!e.target.closest('.room') && w.dataset.b !== state.sel.b) selectBuilding(w.dataset.b, true); }));
}

function selectBuilding(b, keepFloor) {
  state.sel.b = b || null; if (!keepFloor) state.sel.f = null;
  if (state.view !== 'explore') setView('explore');
  if (state.scene) { state.scene.selectBuilding(state.sel.b); state.scene.selectFloor(state.sel.f); }
  renderExplore();
}
function selectFloor(f) {
  state.sel.f = f || null;
  state.scene && state.scene.selectFloor(state.sel.f);
  renderExplore();
  if (f && window.innerWidth < 980) $('#explorePlan').scrollIntoView({ behavior: 'smooth' });
}

// ================================================================ ROOM DRAWER
function openRoom(id) {
  state.room = id;
  rerenderDrawer();
  $('#drawer').classList.add('open'); $('#scrim').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeRoom() {
  if (!state.room) return;
  state.room = null; $('#drawer').classList.remove('open'); $('#scrim').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true');
}

function siblings(id) {
  const meta = parseRoom(id);
  if (meta.area) return AREAS.map(a => a.id);
  return allRoomIds(state.data.structure);
}

function rerenderDrawer() {
  const id = state.room; if (!id) return;
  const d = state.data, r = d.rooms[id] || {}, meta = parseRoom(id);
  const st = roomStatus(d.rooms[id]), p = roomProgress(d.rooms[id]);
  const edit = api.canEdit;
  const stages = meta.area ? AREA_STAGES : STAGES;
  const sib = siblings(id); const i = sib.indexOf(id);
  const prev = sib[i - 1], next = sib[i + 1];
  const roomLog = (d.log || []).filter(x => x.id === id).slice(0, 12);
  const allDone = STAGES.every(s => r.s && r.s[s.k]) && TESTS.every(t => r.t && r.t[t.k] && r.t[t.k].r === 'pass');

  $('#drawerIn').innerHTML = `
  <div class="dr-head" style="--c:${STATUS[st].c}">
    <div class="dr-nav">
      <button class="icon" id="drClose" aria-label="סגירה">✕</button>
      <span class="dr-crumb">${meta.area ? floorName(meta.floor === 'R' ? 'R' : meta.floor) : `${bName(meta.b)} · ${floorName(meta.floor)}`}</span>
      <span class="dr-arrows"><button class="icon" ${next ? `data-open="${next}"` : 'disabled'} aria-label="הבא">‹</button><button class="icon" ${prev ? `data-open="${prev}"` : 'disabled'} aria-label="הקודם">›</button></span>
    </div>
    <h2>${esc(meta.name)}</h2>
    <div class="dr-status"><span class="chip" style="--c:${STATUS[st].c}">${STATUS[st].t}</span><span class="dr-pct">${Math.round(p * 100)}%</span></div>
    <div class="bar bar--lg"><i style="width:${p * 100}%"></i></div>
    ${r.u ? `<p class="muted small">עודכן ע״י ${esc(r.u.by)} · ${fmtDate(r.u.at)}</p>` : '<p class="muted small">טרם עודכן</p>'}
    ${edit ? '' : `<button class="btn-ghost sm" id="drLogin">🔒 כניסה לעדכון החדר</button>`}
  </div>

  <section class="dr-sec">
    <h4>שלבי עבודת אינסטלציה</h4>
    <div class="steps">
      ${stages.map((s, n) => { const v = r.s && r.s[s.k]; return `<button class="step ${v ? 'done' : ''}" data-stage="${s.k}" ${edit ? '' : 'disabled'}><span class="step-n">${v ? '✓' : n + 1}</span><span class="step-b"><b>${s.t}</b>${v ? `<small>בוצע ע״י ${esc(v.by)} · ${fmtDate(v.at)}</small>` : '<small>ממתין</small>'}</span></button>`; }).join('')}
    </div>
  </section>

  <section class="dr-sec">
    <h4>בדיקות מערכת</h4>
    ${TESTS.map(t => { const v = r.t && r.t[t.k]; return `<div class="test ${v ? v.r : ''}">
      <div class="test-h"><b>${t.t}</b>${v ? `<span class="res ${v.r}">${v.r === 'pass' ? 'עבר ✓' : 'נכשל ✕'}</span>` : '<span class="res">טרם נבדק</span>'}</div>
      ${v ? `<small>נבדק ע״י <b>${esc(v.by)}</b> · ${fmtDate(v.at)}${v.v ? ` · ${esc(v.v)} ${t.unit || ''}` : ''}${v.note ? ` · ${esc(v.note)}` : ''}</small>` : ''}
      ${edit ? `<form class="test-f" data-test="${t.k}" autocomplete="off">
        <input name="by" placeholder="שם הבודק" required maxlength="40" value="${esc(api.who)}">
        ${t.unit ? `<input name="v" placeholder="${t.unit}" inputmode="decimal" maxlength="8" class="short">` : ''}
        <input name="note" placeholder="הערה (אופציונלי)" maxlength="120">
        <div class="test-btns"><button type="submit" name="r" value="pass" class="b-pass">עבר</button><button type="submit" name="r" value="fail" class="b-fail">נכשל</button></div>
      </form>` : ''}
    </div>`; }).join('')}
  </section>

  <section class="dr-sec">
    <h4>פערים וסטטוס חופשי ${openGaps(r).length ? `<b class="pill">${openGaps(r).length}</b>` : ''}</h4>
    ${(r.gaps || []).length ? (r.gaps || []).slice().reverse().map(g => `<div class="gap ${g.closed ? 'closed' : ''}">
      <p>${esc(g.text)}</p><small>${esc(g.by)} · ${fmtDate(g.at)}</small>
      ${g.closed ? `<small class="fixed">✓ טופל ע״י ${esc(g.closed.by)} · ${fmtDate(g.closed.at)}${g.closed.note ? ' — ' + esc(g.closed.note) : ''}</small>` : (edit ? `<div class="gap-close"><input placeholder="הערת טיפול (אופציונלי)" maxlength="120" data-note-for="${esc(g.id)}"><button class="btn-ghost sm" data-close-gap="${esc(g.id)}">סימון כטופל</button></div>` : '')}
    </div>`).join('') : '<p class="empty sm">אין פערים בחדר זה</p>'}
    ${edit ? `<form class="gap-f" id="gapForm" autocomplete="off"><textarea name="text" rows="2" maxlength="400" placeholder="תיאור הפער / סטטוס — לדוגמה: חסר ברז ניל בכיור, ממתין לאספקה" required></textarea><button class="btn-gold sm" type="submit">הוספת פער</button></form>` : ''}
  </section>

  <section class="dr-sec">
    <h4>אישור ומסירה</h4>
    ${r.ap ? `<div class="approved"><span class="seal">✓</span><div><b>החדר נבדק ואושר</b><small>ע״י ${esc(r.ap.by)} · ${fmtDate(r.ap.at)}${r.ap.note ? ' — ' + esc(r.ap.note) : ''}</small></div>${edit ? '<button class="btn-ghost sm" id="unapprove">ביטול אישור</button>' : ''}</div>`
      : edit ? `<form class="ap-f" id="apForm" autocomplete="off">${allDone ? '' : '<p class="warn">שימו לב: לא כל השלבים והבדיקות הושלמו.</p>'}<input name="by" required maxlength="40" placeholder="שם המאשר" value="${esc(api.who)}"><input name="note" maxlength="120" placeholder="הערה (אופציונלי)"><button class="btn-gold" type="submit">אישור החדר בשמי</button></form>`
        : '<p class="empty sm">טרם אושר</p>'}
  </section>

  ${roomLog.length ? `<section class="dr-sec"><h4>היסטוריית החדר</h4>${roomLog.map(x => `<div class="hist"><b>${esc(x.a)}</b><small>${esc(x.by)} · ${fmtDate(x.at)}</small></div>`).join('')}</section>` : ''}
  `;

  $('#drClose').addEventListener('click', closeRoom);
  const lb = $('#drLogin'); if (lb) lb.addEventListener('click', openLogin);
  if (!edit) return;

  $$('#drawerIn [data-stage]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.stage, t = stages.find(s => s.k === k).t;
    const nr = clone(r); nr.s = nr.s || {};
    if (nr.s[k]) { delete nr.s[k]; save(id, nr, `ביטול שלב: ${t}`); } else { nr.s[k] = { by: api.who, at: new Date().toISOString() }; save(id, nr, `שלב הושלם: ${t}`); }
  }));
  $$('#drawerIn .test-f').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault(); const res = e.submitter ? e.submitter.value : 'pass'; const fd = new FormData(f);
    const k = f.dataset.test, t = TESTS.find(x => x.k === k);
    const nr = clone(r); nr.t = nr.t || {};
    nr.t[k] = { r: res, by: String(fd.get('by')).trim(), at: new Date().toISOString(), v: String(fd.get('v') || '').trim(), note: String(fd.get('note') || '').trim() };
    save(id, nr, `${t.t}: ${res === 'pass' ? 'עבר' : 'נכשל'} (בודק: ${nr.t[k].by})`);
  }));
  const gf = $('#gapForm'); if (gf) gf.addEventListener('submit', e => {
    e.preventDefault(); const text = String(new FormData(gf).get('text')).trim(); if (!text) return;
    const nr = clone(r); nr.gaps = nr.gaps || []; nr.gaps.push({ id: uid(), text, by: api.who, at: new Date().toISOString() });
    save(id, nr, `פער חדש: ${text.slice(0, 60)}`);
  });
  $$('#drawerIn [data-close-gap]').forEach(b => b.addEventListener('click', () => {
    const inp = $(`[data-note-for="${b.dataset.closeGap}"]`, $('#drawerIn')); const note = (inp && inp.value.trim()) || 'תוקן';
    const nr = clone(r); const g = nr.gaps.find(x => x.id === b.dataset.closeGap); g.closed = { by: api.who, at: new Date().toISOString(), note: note.slice(0, 120) };
    save(id, nr, `פער טופל: ${g.text.slice(0, 50)}`);
  }));
  const af = $('#apForm'); if (af) af.addEventListener('submit', e => {
    e.preventDefault(); const fd = new FormData(af);
    const nr = clone(r); nr.ap = { by: String(fd.get('by')).trim(), at: new Date().toISOString(), note: String(fd.get('note') || '').trim() };
    save(id, nr, `החדר אושר ע״י ${nr.ap.by}`);
  });
  const ua = $('#unapprove'); if (ua) ua.addEventListener('click', () => { if (!armed(ua, 'לחצו שוב לביטול')) return; const nr = clone(r); delete nr.ap; save(id, nr, 'ביטול אישור חדר'); });
}

async function save(id, room, action) {
  room.u = { by: api.who, at: new Date().toISOString() };
  setSync('busy', 'שומר…');
  const prev = state.data.rooms[id];
  state.data.rooms[id] = room; rerenderDrawer(); // optimistic
  try {
    const d = await api.saveRoom(state.data, id, room, action);
    if (d) state.data = d;
    setSync('ok'); toast(api.live ? 'נשמר בדרייב ✓' : 'נשמר ✓');
    renderAll();
  } catch (e) {
    state.data.rooms[id] = prev; setSync('err', 'שגיאת שמירה'); toast(e.message || 'שמירה נכשלה', true);
    if (e.code === 'AUTH') updateLockBtn();
    renderAll();
  }
}

// ================================================================ LOGIN / CODE
function bindLogin() {
  const dlg = $('#dlgLogin'), f = $('#formLogin');
  $('#loginCancel').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(f); $('#loginErr').textContent = '';
    const btn = $('#loginSubmit'); btn.disabled = true; btn.textContent = 'מאמת…';
    try {
      await api.login(fd.get('who'), fd.get('code'));
      dlg.close(); f.reset(); updateLockBtn(); renderSettings(); rerenderDrawer();
      toast(`שלום ${api.who} — מצב עריכה פעיל`);
    } catch (err) { $('#loginErr').textContent = err.message || 'שגיאה'; f.code.value = ''; f.code.focus(); }
    finally { btn.disabled = false; btn.textContent = 'כניסה'; }
  });
}
function openLogin() { const dlg = $('#dlgLogin'); $('#loginErr').textContent = ''; dlg.showModal(); setTimeout(() => $('#formLogin [name=who]').focus(), 50); }
function updateLockBtn() {
  const b = $('#btnLock'); b.classList.toggle('on', api.canEdit);
  $('span', b).textContent = api.canEdit ? `עריכה · ${api.who}` : 'צפייה בלבד';
  b.title = api.canEdit ? 'לחצו ליציאה ממצב עריכה' : 'כניסה למצב עריכה';
  document.body.classList.toggle('can-edit', api.canEdit);
}
async function onChangeCode(e) {
  e.preventDefault(); const f = e.target; const fd = new FormData(f);
  if (!api.canEdit) { toast('יש להיכנס למצב עריכה תחילה', true); openLogin(); return; }
  if (fd.get('nw') !== fd.get('nw2')) { toast('הקודים החדשים אינם תואמים', true); return; }
  try { await api.changeCode(fd.get('old'), fd.get('nw')); f.reset(); toast('הקוד הוחלף בהצלחה'); } catch (err) { toast(err.message, true); }
}

// ================================================================ EXPORT
function exportCSV() {
  const d = state.data; const rows = [['חדר', 'בניין', 'קומה', 'סטטוס', 'התקדמות %', ...STAGES.map(s => s.t), ...TESTS.map(t => t.t), ...TESTS.map(t => 'בודק: ' + t.t), 'פערים פתוחים', 'אושר ע״י', 'תאריך אישור', 'עודכן ע״י', 'עדכון אחרון']];
  [...allRoomIds(d.structure), ...AREAS.map(a => a.id)].forEach(id => {
    const r = d.rooms[id] || {}; const m = parseRoom(id);
    rows.push([m.area ? m.name : id, m.b || '', m.floor, STATUS[roomStatus(d.rooms[id])].t, Math.round(roomProgress(d.rooms[id]) * 100),
      ...STAGES.map(s => (r.s && r.s[s.k] ? '✓ ' + r.s[s.k].by : '')), ...TESTS.map(t => (r.t && r.t[t.k] ? (r.t[t.k].r === 'pass' ? 'עבר' : 'נכשל') : '')),
      ...TESTS.map(t => (r.t && r.t[t.k] ? r.t[t.k].by : '')), openGaps(r).map(g => g.text).join(' | '), r.ap ? r.ap.by : '', r.ap ? fmtDate(r.ap.at) : '', r.u ? r.u.by : '', r.u ? fmtDate(r.u.at) : '']);
  });
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `REEF-אינסטלציה-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ================================================================ CONFIRM (two-click, works inside sandboxed frames)
function armed(btn, msg) {
  if (btn.dataset.armed) { delete btn.dataset.armed; return true; }
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = msg; btn.classList.add('armed');
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove('armed'); } }, 3500);
  return false;
}

// ================================================================ TOAST
let tt;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => (t.className = 'toast'), 2600); }
