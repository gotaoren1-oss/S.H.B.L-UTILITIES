/**
 * =====================================================================
 *  שרת הנתונים — ש.ה.ב.ל תשתיות ומערכות מים · פרויקט REEF אשקלון
 *  Google Apps Script — שומר את כל הנתונים בגוגל דרייב של החברה.
 *
 *  מה נשמר בדרייב (תיקייה "ש.ה.ב.ל - REEF מעקב אינסטלציה"):
 *   • reef-data.json      — מצב כל החדרים (קובץ הנתונים הראשי)
 *   • REEF - יומן פעילות   — גיליון עם כל שינוי: תאריך, שם, חדר, פעולה
 *   • גיבויים/            — עותק יומי של קובץ הנתונים (נשמרים 60 אחרונים)
 *
 *  אבטחה:
 *   • הקוד לא מופיע באתר בכלל. כאן הוא נשמר רק כגיבוב SHA-256 עם "מלח" אקראי
 *     בתוך Script Properties (מוסתר, לא נגיש מהאינטרנט).
 *   • כניסה מוצלחת מחזירה אסימון זמני (6 שעות). כל שמירה מאומתת בשרת.
 *   • הגנה מפני ניחוש: אחרי 6 ניסיונות שגויים ב-15 דקות — נעילה ל-15 דקות.
 *   • כל קלט נבדק ומוגבל באורך; מזהי חדרים חייבים להתאים למבנה הפרויקט.
 *
 *  התקנה: ראו README.md → "חיבור לגוגל דרייב".
 * =====================================================================
 */

// הקוד ההתחלתי — משמש רק בהרצה הראשונה של setup(). מומלץ להחליף מהאתר אחר כך.
var INITIAL_CODE = 'שהבל בעמ';

var FOLDER_NAME = 'ש.ה.ב.ל - REEF מעקב אינסטלציה';
var TOKEN_TTL = 6 * 3600;           // שניות
var MAX_FAILS = 6, LOCK_SECONDS = 15 * 60;
var ROOM_RE = /^([1-9](0[1-9]|1[0-2])|B-[a-z]+|0-[a-z]+|R-[a-z]+)$/;

// ------------------------------------------------------------ setup (run once)
function setup() {
  var props = PropertiesService.getScriptProperties();
  var folder = getFolder_();
  if (!props.getProperty('DATA_FILE_ID')) {
    var empty = { v: 1, structure: { disabled: ['901','902','903','904','907','908','909','910','911','912'] }, rooms: {}, log: [], updatedAt: new Date().toISOString() };
    var f = folder.createFile('reef-data.json', JSON.stringify(empty), 'application/json');
    props.setProperty('DATA_FILE_ID', f.getId());
  }
  if (!props.getProperty('LOG_SHEET_ID')) {
    var ss = SpreadsheetApp.create('REEF - יומן פעילות');
    var sh = ss.getSheets()[0]; sh.setName('יומן'); sh.setRightToLeft(true);
    sh.appendRow(['תאריך ושעה', 'שם המעדכן', 'חדר', 'פעולה']); sh.setFrozenRows(1);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('LOG_SHEET_ID', ss.getId());
  }
  if (!props.getProperty('CODE_HASH')) setCode_(INITIAL_CODE);
  // daily backup trigger
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; });
  if (!has) ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
  Logger.log('✓ ההתקנה הושלמה. תיקייה: ' + folder.getUrl());
}

// ------------------------------------------------------------ HTTP
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'get';
  if (action === 'get') return json_({ ok: true, data: readData_() });
  return json_({ ok: false, error: 'פעולה לא מוכרת' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'בקשה לא תקינה' }); }
  try {
    switch (body.action) {
      case 'login': return json_(login_(body));
      case 'logout': CacheService.getScriptCache().remove('tok_' + String(body.token || '')); return json_({ ok: true });
      case 'saveRoom': return json_(saveRoom_(body));
      case 'saveStructure': return json_(saveStructure_(body));
      case 'changeCode': return json_(changeCode_(body));
      default: return json_({ ok: false, error: 'פעולה לא מוכרת' });
    }
  } catch (err) {
    return json_({ ok: false, error: err.code ? err.message : 'שגיאת שרת', code: err.code || 'ERR' });
  }
}

// ------------------------------------------------------------ auth
function login_(b) {
  var cache = CacheService.getScriptCache();
  if (cache.get('locked')) return { ok: false, error: 'יותר מדי ניסיונות שגויים. נסו שוב בעוד 15 דקות.', code: 'LOCK' };
  var who = clean_(b.who, 40);
  if (!who) return { ok: false, error: 'יש להזין שם מלא' };
  if (!checkCode_(b.code)) {
    var fails = (+cache.get('fails') || 0) + 1;
    cache.put('fails', String(fails), LOCK_SECONDS);
    if (fails >= MAX_FAILS) { cache.put('locked', '1', LOCK_SECONDS); cache.remove('fails'); }
    Utilities.sleep(900);
    appendLog_(who + ' (ניסיון כושל)', '—', 'ניסיון כניסה עם קוד שגוי');
    return { ok: false, error: 'קוד שגוי', code: 'BAD' };
  }
  cache.remove('fails');
  var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  cache.put('tok_' + token, who, TOKEN_TTL);
  appendLog_(who, '—', 'כניסה למצב עריכה');
  return { ok: true, token: token, ttl: TOKEN_TTL };
}

function auth_(token) {
  var who = token ? CacheService.getScriptCache().get('tok_' + String(token)) : null;
  if (!who) { var e = new Error('פג תוקף הכניסה — יש להתחבר מחדש'); e.code = 'AUTH'; throw e; }
  return who;
}

function normalize_(c) { return String(c || '').replace(/[\s"'״׳`]/g, '').trim(); }
function hash_(salt, code) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + normalize_(code), Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function setCode_(code) {
  var salt = Utilities.getUuid();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('CODE_SALT', salt);
  props.setProperty('CODE_HASH', hash_(salt, code));
}
function checkCode_(code) {
  var p = PropertiesService.getScriptProperties();
  return hash_(p.getProperty('CODE_SALT'), code) === p.getProperty('CODE_HASH');
}

function changeCode_(b) {
  var who = auth_(b.token);
  if (!checkCode_(b.oldCode)) { Utilities.sleep(900); return { ok: false, error: 'הקוד הנוכחי שגוי' }; }
  if (normalize_(b.newCode).length < 6) return { ok: false, error: 'הקוד החדש קצר מדי (6 תווים לפחות)' };
  setCode_(b.newCode);
  appendLog_(who, '—', 'הוחלף קוד הגישה למערכת');
  return { ok: true };
}

// ------------------------------------------------------------ data
function saveRoom_(b) {
  var who = auth_(b.token);
  var id = String(b.id || '');
  if (!ROOM_RE.test(id)) return { ok: false, error: 'מזהה חדר לא תקין' };
  var room = sanitizeRoom_(b.room);
  room.u = { by: who, at: new Date().toISOString() };
  var note = clean_(b.note, 160) || 'עדכון חדר';
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var data = readData_();
    data.rooms[id] = room;
    data.log = data.log || [];
    data.log.unshift({ at: room.u.at, by: who, id: id, a: note });
    data.log = data.log.slice(0, 500);
    data.updatedAt = room.u.at;
    writeData_(data);
    appendLog_(who, id, note);
    return { ok: true, data: data };
  } finally { lock.releaseLock(); }
}

function saveStructure_(b) {
  var who = auth_(b.token);
  var dis = (b.structure && b.structure.disabled) || [];
  dis = dis.map(String).filter(function (x) { return /^[1-9](0[1-9]|1[0-2])$/.test(x); }).slice(0, 120);
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var data = readData_();
    data.structure = { disabled: dis };
    data.updatedAt = new Date().toISOString();
    data.log.unshift({ at: data.updatedAt, by: who, id: '—', a: 'עדכון מבנה הפרויקט (' + (108 - dis.length) + ' חדרים פעילים)' });
    writeData_(data);
    appendLog_(who, '—', 'עדכון מבנה הפרויקט');
    return { ok: true, data: data };
  } finally { lock.releaseLock(); }
}

function sanitizeRoom_(r) {
  r = r || {};
  var out = { s: {}, t: {}, gaps: [] };
  ['sleeves', 'drain', 'supply', 'closing', 'fixtures'].forEach(function (k) {
    if (r.s && r.s[k]) out.s[k] = { by: clean_(r.s[k].by, 40), at: iso_(r.s[k].at) };
  });
  ['pressure', 'drainTest', 'final'].forEach(function (k) {
    var t = r.t && r.t[k];
    if (t && (t.r === 'pass' || t.r === 'fail')) out.t[k] = { r: t.r, by: clean_(t.by, 40), at: iso_(t.at), v: clean_(t.v, 8), note: clean_(t.note, 120) };
  });
  (r.gaps || []).slice(0, 60).forEach(function (g) {
    var o = { id: clean_(g.id, 16) || Utilities.getUuid().slice(0, 8), text: clean_(g.text, 400), by: clean_(g.by, 40), at: iso_(g.at) };
    if (g.closed) o.closed = { by: clean_(g.closed.by, 40), at: iso_(g.closed.at), note: clean_(g.closed.note, 120) };
    if (o.text) out.gaps.push(o);
  });
  if (r.ap) out.ap = { by: clean_(r.ap.by, 40), at: iso_(r.ap.at), note: clean_(r.ap.note, 120) };
  return out;
}

function clean_(s, max) { return String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max); }
function iso_(s) { var d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }

function readData_() {
  var id = PropertiesService.getScriptProperties().getProperty('DATA_FILE_ID');
  if (!id) throw Object.assign(new Error('השרת לא הותקן — הריצו setup()'), { code: 'SETUP' });
  return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'));
}
function writeData_(data) {
  var id = PropertiesService.getScriptProperties().getProperty('DATA_FILE_ID');
  DriveApp.getFileById(id).setContent(JSON.stringify(data));
}
function appendLog_(who, room, action) {
  try {
    var id = PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID');
    if (id) SpreadsheetApp.openById(id).getSheets()[0].appendRow([new Date(), who, room, action]);
  } catch (e) { }
}

function getFolder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

// ------------------------------------------------------------ daily backup
function dailyBackup() {
  var folder = getFolder_();
  var sub = folder.getFoldersByName('גיבויים');
  var bk = sub.hasNext() ? sub.next() : folder.createFolder('גיבויים');
  var stamp = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd');
  bk.createFile('reef-data-' + stamp + '.json', JSON.stringify(readData_()), 'application/json');
  var files = [], it = bk.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(60).forEach(function (f) { f.setTrashed(true); });
}

/** חירום: איפוס הקוד לקוד חדש (מריצים ידנית מתוך עורך הסקריפט בלבד) */
function emergencyResetCode() { setCode_(INITIAL_CODE); Logger.log('הקוד אופס לקוד ההתחלתי'); }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
