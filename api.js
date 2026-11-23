// =====================================================================
//  שכבת נתונים — Google Drive (Apps Script) או מצב הדגמה מקומי
//  הקוד לעולם לא נשמר כאן. במצב חי הוא מאומת בשרת בלבד.
// =====================================================================
import { demoSeed, emptyData } from './data.js';

const LS_DATA = 'shbl-reef-demo-data';
const LS_HASH = 'shbl-reef-demo-hash';
const SS_SESSION = 'shbl-reef-session';
// מצב הדגמה בלבד: גיבוב SHA-256 (לא הקוד עצמו). במצב חי האימות נעשה בשרת.
const DEMO_HASH = '1cc0b22df1a9c22f47787014e4b3382c2c044b08ec51be35e484071f190a7d28';

export const normalizeCode = c => String(c || '').replace(/[\s"'״׳`]/g, '').trim();
async function sha256(txt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export class Api {
  constructor(url) {
    this.url = (url || '').trim();
    this.live = !!this.url;
    try { this.session = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null'); } catch { this.session = null; }
    if (this.session && this.session.exp < Date.now()) this.logout();
  }

  get canEdit() { return !!(this.session && this.session.exp > Date.now()); }
  get who() { return this.session ? this.session.who : ''; }

  async _post(body) {
    const res = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
    const j = await res.json();
    if (!j.ok) { const e = new Error(j.error || 'שגיאת שרת'); e.code = j.code; throw e; }
    return j;
  }

  async load() {
    if (!this.live) {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(LS_DATA) || 'null'); } catch { }
      if (!d) { d = demoSeed(); localStorage.setItem(LS_DATA, JSON.stringify(d)); }
      return d;
    }
    const res = await fetch(`${this.url}?action=get&t=${Date.now()}`, { redirect: 'follow' });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'שגיאה בטעינה');
    return j.data || emptyData();
  }

  async login(who, code) {
    who = String(who || '').trim().slice(0, 40);
    if (!this.live) {
      await new Promise(r => setTimeout(r, 450));
      const h = await sha256('shbl-reef|' + normalizeCode(code));
      if (h !== (localStorage.getItem(LS_HASH) || DEMO_HASH)) throw new Error('קוד שגוי');
      this.session = { who, token: 'demo', exp: Date.now() + 8 * 36e5 };
    } else {
      const j = await this._post({ action: 'login', who, code });
      this.session = { who, token: j.token, exp: Date.now() + (j.ttl || 6 * 3600) * 1000 };
    }
    sessionStorage.setItem(SS_SESSION, JSON.stringify(this.session));
    return this.session;
  }

  logout() {
    if (this.live && this.session) this._post({ action: 'logout', token: this.session.token }).catch(() => { });
    this.session = null; sessionStorage.removeItem(SS_SESSION);
  }

  _guard() { if (!this.canEdit) { const e = new Error('נדרשת כניסה למצב עריכה'); e.code = 'AUTH'; throw e; } }

  async saveRoom(data, id, room, action) {
    this._guard();
    if (!this.live) {
      data.rooms[id] = room;
      data.log.unshift({ at: new Date().toISOString(), by: this.who, id, a: action });
      data.log = data.log.slice(0, 500);
      data.updatedAt = new Date().toISOString();
      localStorage.setItem(LS_DATA, JSON.stringify(data));
      return data;
    }
    try {
      const j = await this._post({ action: 'saveRoom', token: this.session.token, id, room, note: action });
      return j.data;
    } catch (e) { if (e.code === 'AUTH') this.logout(); throw e; }
  }

  async saveStructure(data, structure) {
    this._guard();
    if (!this.live) {
      data.structure = structure; data.updatedAt = new Date().toISOString();
      data.log.unshift({ at: data.updatedAt, by: this.who, id: '—', a: 'עדכון מבנה הפרויקט' });
      localStorage.setItem(LS_DATA, JSON.stringify(data));
      return data;
    }
    const j = await this._post({ action: 'saveStructure', token: this.session.token, structure });
    return j.data;
  }

  async changeCode(oldCode, newCode) {
    this._guard();
    if (normalizeCode(newCode).length < 6) throw new Error('הקוד החדש קצר מדי');
    if (!this.live) {
      const h = await sha256('shbl-reef|' + normalizeCode(oldCode));
      if (h !== (localStorage.getItem(LS_HASH) || DEMO_HASH)) throw new Error('הקוד הנוכחי שגוי');
      localStorage.setItem(LS_HASH, await sha256('shbl-reef|' + normalizeCode(newCode)));
      return true;
    }
    await this._post({ action: 'changeCode', token: this.session.token, oldCode, newCode });
    return true;
  }

  // demo helpers
  demoReset(seed) { if (this.live) return; const d = seed ? demoSeed() : emptyData(); localStorage.setItem(LS_DATA, JSON.stringify(d)); return d; }
}
