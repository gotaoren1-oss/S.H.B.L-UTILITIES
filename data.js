// =====================================================================
//  מבנה הפרויקט, שלבי עבודה, בדיקות וחישובי סטטוס
// =====================================================================
export const BUILDINGS = [
  { id: 'A', name: 'בניין A', rooms: [1, 2, 3, 4] },
  { id: 'B', name: 'בניין B', rooms: [5, 6, 7, 8] },
  { id: 'C', name: 'בניין C', rooms: [9, 10, 11, 12] }
];

export const ROOM_FLOORS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const FLOORS = [
  { id: 'B', name: 'מרתף', short: 'B' },
  { id: '0', name: 'קומת קרקע · לובי', short: '0' },
  ...ROOM_FLOORS.map(f => ({ id: f, name: `קומה ${f}`, short: f }))
];

// שטחים ציבוריים / מערכות (לא חדרי שינה)
export const AREAS = [
  { id: 'B-pumps', floor: 'B', name: 'חדר משאבות' },
  { id: 'B-tanks', floor: 'B', name: 'מאגרי מים' },
  { id: 'B-heat', floor: 'B', name: 'חדר מערכות חימום מים' },
  { id: 'B-sump', floor: 'B', name: 'בורות שאיבה וניקוז מרתף' },
  { id: 'B-fire', floor: 'B', name: 'מערכת מתזים (ספרינקלרים)' },
  { id: '0-wc', floor: '0', name: 'שירותים ציבוריים · לובי' },
  { id: '0-kitchen', floor: '0', name: 'מטבח מסעדה ומפריד שומן' },
  { id: '0-pool', floor: '0', name: 'בריכת אינפיניטי · מערכות סינון' },
  { id: '0-spa', floor: '0', name: 'ספא וחדר כושר' },
  { id: 'R-solar', floor: 'R', name: 'גג · קולטים ודודים' },
  { id: 'R-drain', floor: 'R', name: 'גג · ניקוז מי גשם' }
];

// ברירת מחדל: קומות 1–8 מלאות (12 חדרים), בקומה 9 שתי סוויטות (905, 906) => 98 חדרים
export const DEFAULT_DISABLED = ['901', '902', '903', '904', '907', '908', '909', '910', '911', '912'];

export const STAGES = [
  { k: 'sleeves', t: 'שרוולים והכנות בתקרה/רצפה' },
  { k: 'drain', t: 'ניקוז ודלוחין (HDPE)' },
  { k: 'supply', t: 'צנרת מים קרים / חמים' },
  { k: 'closing', t: 'אישור לסגירת קירות ותקרה' },
  { k: 'fixtures', t: 'כלים סניטריים ואביזרים' }
];
export const AREA_STAGES = [
  { k: 'sleeves', t: 'הכנות ושרוולים' },
  { k: 'drain', t: 'קווי ניקוז' },
  { k: 'supply', t: 'קווי אספקה ומערכות' },
  { k: 'closing', t: 'חיבור ציוד והפעלה' },
  { k: 'fixtures', t: 'גמר ושילוט' }
];
export const TESTS = [
  { k: 'pressure', t: 'בדיקת לחץ צנרת מים', unit: 'בר' },
  { k: 'drainTest', t: 'בדיקת אטימות וזרימה בניקוז' },
  { k: 'final', t: 'בדיקת תפקוד סופית (חם/קר/ספיקה)' }
];

export const STATUS = {
  none: { t: 'טרם החל', c: '#3c4f48' },
  progress: { t: 'בעבודה', c: '#ba9b5f' },
  gap: { t: 'פער פתוח', c: '#d9695b' },
  done: { t: 'הושלם · ממתין לאישור', c: '#9cc48e' },
  approved: { t: 'נבדק ואושר', c: '#4fb286' },
  off: { t: 'לא פעיל', c: '#1f302a' }
};

export const buildingOfIndex = i => (i <= 4 ? 'A' : i <= 8 ? 'B' : 'C');
export const roomId = (f, i) => `${f}${String(i).padStart(2, '0')}`;
export const parseRoom = id => {
  const area = AREAS.find(a => a.id === id);
  if (area) return { area: true, floor: area.floor, name: area.name, b: null };
  const f = id.slice(0, -2), i = +id.slice(-2);
  return { area: false, floor: f, idx: i, b: buildingOfIndex(i), name: `חדר ${id}` };
};

export function allRoomIds(structure) {
  const dis = new Set((structure && structure.disabled) || DEFAULT_DISABLED);
  const out = [];
  ROOM_FLOORS.forEach(f => { for (let i = 1; i <= 12; i++) { const id = roomId(f, i); if (!dis.has(id)) out.push(id); } });
  return out;
}
export const isDisabled = (structure, id) => ((structure && structure.disabled) || DEFAULT_DISABLED).includes(id);

export function roomProgress(r) {
  if (!r) return 0;
  const s = STAGES.filter(x => r.s && r.s[x.k]).length;
  const t = TESTS.filter(x => r.t && r.t[x.k] && r.t[x.k].r === 'pass').length;
  return (s + t + (r.ap ? 1 : 0)) / (STAGES.length + TESTS.length + 1);
}
export const openGaps = r => (r && r.gaps ? r.gaps.filter(g => !g.closed) : []);
export function roomStatus(r) {
  if (!r) return 'none';
  if (openGaps(r).length || TESTS.some(x => r.t && r.t[x.k] && r.t[x.k].r === 'fail')) return 'gap';
  if (r.ap) return 'approved';
  const p = roomProgress(r);
  if (p >= (STAGES.length + TESTS.length) / (STAGES.length + TESTS.length + 1) - 1e-6) return 'done';
  if (p > 0) return 'progress';
  return 'none';
}

export function summarize(data) {
  const ids = allRoomIds(data.structure);
  const sum = { total: ids.length, by: { none: 0, progress: 0, gap: 0, done: 0, approved: 0 }, gaps: 0, testsPass: 0, testsFail: 0, testsTotal: ids.length * TESTS.length, progress: 0, bld: {}, floor: {} };
  BUILDINGS.forEach(b => (sum.bld[b.id] = { total: 0, progress: 0, done: 0, gaps: 0 }));
  ids.forEach(id => {
    const r = data.rooms[id]; const st = roomStatus(r); const p = roomProgress(r); const meta = parseRoom(id);
    sum.by[st]++; sum.progress += p; sum.gaps += openGaps(r).length;
    TESTS.forEach(x => { const v = r && r.t && r.t[x.k]; if (v && v.r === 'pass') sum.testsPass++; if (v && v.r === 'fail') sum.testsFail++; });
    const B = sum.bld[meta.b]; B.total++; B.progress += p; if (st === 'done' || st === 'approved') B.done++; B.gaps += openGaps(r).length;
    const key = `${meta.b}|${meta.floor}`; const F = (sum.floor[key] ||= { total: 0, p: 0, gaps: 0 });
    F.total++; F.p += p; F.gaps += openGaps(r).length;
  });
  Object.values(sum.floor).forEach(F => (F.pct = F.total ? F.p / F.total : 0));
  // basement/ground per building slices (areas shown on all towers)
  BUILDINGS.forEach(b => ['B', '0'].forEach(f => { sum.floor[`${b.id}|${f}`] = { total: 0, p: 0, gaps: 0, pct: 0 }; }));
  sum.pct = ids.length ? sum.progress / ids.length : 0;
  return sum;
}

// ---------------------------------------------------------------- demo seed
export function demoSeed() {
  let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const workers = ['יוסי אברהם', 'מוחמד חסן', 'אבי לוי', 'דניאל כהן', 'סרגיי פטרוב'];
  const testers = ['רון שטרן · מהנדס ביצוע', 'מיכל דהן · מפקחת', 'אבי לוי · מנהל עבודה'];
  const gapTexts = ['דליפה בחיבור ברז ניל מתחת לכיור', 'שיפוע ניקוז מקלחת לא תקין — מים עומדים', 'חסר שרוול במעבר תקרה לפיר', 'ירידת לחץ 0.4 בר תוך 30 דק׳ — לבדוק מחברים', 'מיכל הדחה סמוי לא מתמלא בספיקה מלאה', 'רעש פטיש מים בקו החם'];
  const now = Date.now(); const day = 864e5;
  const rooms = {}; const log = [];
  allRoomIds({ disabled: DEFAULT_DISABLED }).forEach(id => {
    const f = +id.slice(0, -2);
    const level = Math.max(0, Math.min(9, Math.round((10 - f) * 1.15 + (rnd() - 0.5) * 3)));
    if (level <= 0) return;
    const r = { s: {}, t: {}, gaps: [] };
    const w = () => workers[Math.floor(rnd() * workers.length)];
    const at = k => new Date(now - (40 - f * 3.5 - k) * day - rnd() * day).toISOString();
    STAGES.forEach((s, k) => { if (level > k) r.s[s.k] = { by: w(), at: at(k) }; });
    if (level > 2) r.t.pressure = { r: rnd() < 0.92 ? 'pass' : 'fail', by: testers[Math.floor(rnd() * 3)], at: at(3), v: '10' };
    if (level > 4) r.t.drainTest = { r: 'pass', by: testers[Math.floor(rnd() * 3)], at: at(5) };
    if (level > 6) r.t.final = { r: 'pass', by: testers[Math.floor(rnd() * 3)], at: at(7) };
    if (level > 7 && rnd() < 0.85) r.ap = { by: 'רון שטרן · מהנדס ביצוע', at: at(8) };
    if (rnd() < 0.09 && level > 1) r.gaps.push({ id: 'g' + Math.floor(rnd() * 1e9).toString(36), text: gapTexts[Math.floor(rnd() * gapTexts.length)], by: w(), at: at(4) });
    if (rnd() < 0.05 && level > 3) r.gaps.push({ id: 'g' + Math.floor(rnd() * 1e9).toString(36), text: gapTexts[Math.floor(rnd() * gapTexts.length)], by: w(), at: at(2), closed: { by: w(), at: at(5), note: 'תוקן ונבדק' } });
    r.u = { by: w(), at: at(level) };
    rooms[id] = r;
    log.push({ at: r.u.at, by: r.u.by, id, a: 'עדכון סטטוס חדר (נתוני הדגמה)' });
  });
  log.sort((a, b) => b.at.localeCompare(a.at));
  return { v: 1, structure: { disabled: DEFAULT_DISABLED.slice() }, rooms, log: log.slice(0, 300), updatedAt: new Date().toISOString() };
}

export const emptyData = () => ({ v: 1, structure: { disabled: DEFAULT_DISABLED.slice() }, rooms: {}, log: [], updatedAt: null });
