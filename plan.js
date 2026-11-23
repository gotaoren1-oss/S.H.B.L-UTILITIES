// =====================================================================
//  תוכנית קומה טיפוסית — שרטוט SVG לפי תוכנית האינסטלציה (PDF)
//  שלוש כנפיים: A (עליונה, באלכסון), B (אמצעית), C (תחתונה)
// =====================================================================
import { roomId, roomStatus, roomProgress, openGaps, STATUS, isDisabled, TESTS } from './data.js';

const RW = 150, RH = 62, COR = 34, L = RH * 4;
const WINGS = [
  { b: 'A', x: 236, y: 64, rot: 33, idx: [1, 2, 3, 4] },
  { b: 'B', x: 250, y: 352, rot: -19, idx: [5, 6, 7, 8] },
  { b: 'C', x: 306, y: 650, rot: 0, idx: [9, 10, 11, 12] }
];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function planSVG({ floor, building, data }) {
  const out = [];
  out.push(`<svg viewBox="60 -20 560 960" class="plan" role="img" aria-label="תוכנית קומה ${esc(floor)}">
  <defs>
    <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(233,224,207,.18)" stroke-width="2"/></pattern>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(233,224,207,.05)" stroke-width="1"/></pattern>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="pipe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fe3f0"/><stop offset="1" stop-color="#2f8fd0"/></linearGradient>
  </defs>
  <rect width="700" height="960" fill="url(#grid)"/>`);

  // skylight between A and B (west side)
  out.push(`<g class="pl-skylight"><path d="M118 300 A120 120 0 0 0 214 420 L250 352 L180 290 Z" fill="rgba(95,227,240,.05)" stroke="rgba(233,224,207,.25)" stroke-dasharray="4 4"/><text x="186" y="352" class="pl-lbl" transform="rotate(-30 186 352)">SKYLIGHT</text></g>`);
  // central lobby between B and C + service core
  out.push(`<g class="pl-core"><path d="M330 572 L470 548 L494 660 L340 660 Z" fill="rgba(233,224,207,.04)" stroke="rgba(233,224,207,.22)"/><text x="410" y="612" class="pl-lbl">מבואה · מעליות</text></g>`);

  WINGS.forEach(W => {
    const active = !building || building === W.b;
    out.push(`<g class="wing ${active ? 'on' : 'dim'}" data-b="${W.b}" transform="translate(${W.x} ${W.y}) rotate(${W.rot})">`);
    // wing outline
    out.push(`<rect x="-6" y="-6" width="${RW + COR + 12}" height="${L + 12}" rx="6" class="wing-shell"/>`);
    // corridor + risers line
    out.push(`<rect x="${RW}" y="0" width="${COR}" height="${L}" class="corr"/>`);
    out.push(`<line x1="${RW + 8}" y1="4" x2="${RW + 8}" y2="${L - 4}" class="riser riser-c"/><line x1="${RW + 14}" y1="4" x2="${RW + 14}" y2="${L - 4}" class="riser riser-h"/>`);
    // cores at wing ends
    if (W.b === 'A') out.push(`<g class="core"><rect x="70" y="-70" width="114" height="64" rx="3"/><text x="127" y="-34" class="pl-lbl" transform="rotate(${-W.rot} 127 -38)">גרם 1 · ממ״ק</text></g>`);
    if (W.b === 'C') out.push(`<g class="core"><rect x="${RW + COR + 6}" y="0" width="70" height="96" rx="3"/><text x="${RW + COR + 41}" y="52" class="pl-lbl">גרם 2</text><rect x="96" y="${L + 6}" width="96" height="54" rx="3"/><text x="144" y="${L + 38}" class="pl-lbl">ממ״ק</text></g>`);

    W.idx.forEach((i, k) => {
      const id = roomId(floor, i);
      const off = isDisabled(data.structure, id);
      const r = data.rooms[id];
      const st = off ? 'off' : roomStatus(r);
      const p = off ? 0 : roomProgress(r);
      const gaps = off ? 0 : openGaps(r).length;
      const y = k * RH;
      const cx = 78, cy = y + RH / 2;
      const tests = TESTS.map(t => (r && r.t && r.t[t.k] ? r.t[t.k].r : '')).map((v, n) => `<circle cx="${96 + n * 9}" cy="${y + RH - 10}" r="3" class="td ${v}"/>`).join('');
      out.push(`<g class="room st-${st}${off ? ' off' : ''}" data-room="${id}" tabindex="${active && !off ? 0 : -1}" role="button" aria-label="חדר ${id} · ${STATUS[st].t}">
        <rect x="2" y="${y + 2}" width="${RW - 4}" height="${RH - 4}" rx="4" class="rm" style="--c:${STATUS[st].c}"/>
        <rect x="2" y="${y + 2}" width="22" height="${RH - 4}" rx="3" class="balc"/>
        <rect x="${RW - 50}" y="${y + 6}" width="44" height="30" rx="2" class="bath"/>
        <path d="M${RW - 28} ${y + 12} c4 6 7 9 7 13 a7 7 0 0 1 -14 0 c0 -4 3 -7 7 -13z" class="drop"/>
        <rect x="26" y="${y + RH - 8}" width="${(RW - 30) * p}" height="3" rx="1.5" class="pbar"/>
        <g transform="rotate(${-W.rot} ${cx - 12} ${cy - 6})"><text x="${cx - 12}" y="${cy - 1}" class="rnum">${id}</text></g>
        ${off ? '' : tests}
        ${gaps ? `<g transform="rotate(${-W.rot} 34 ${y + 14})"><circle cx="34" cy="${y + 14}" r="8" class="gapdot"/><text x="34" y="${y + 18}" class="gapn">${gaps}</text></g>` : ''}
        ${st === 'approved' ? `<path d="M30 ${y + 14} l4 4 l8 -8" class="ok"/>` : ''}
      </g>`);
    });
    // wing label
    out.push(`</g>`);
  });
  // label for A placed outside (avoid core clash)
  [['A', 120, 150], ['B', 520, 420], ['C', 560, 800]].forEach(([b, x, y]) => out.push(`<text x="${x}" y="${y}" class="wing-lbl ${!building || building === b ? '' : 'dim'}">בניין ${b}</text>`));
  // north arrow + legend water lines
  out.push(`<g class="pl-north" transform="translate(640 60)"><circle r="20"/><path d="M0 -14 L6 6 L0 2 L-6 6Z"/><text y="38">N</text></g>
  <g class="pl-key" transform="translate(470 880)"><line x1="0" y1="0" x2="26" y2="0" class="riser riser-c"/><text x="-8" y="4">מים קרים</text><line x1="0" y1="18" x2="26" y2="18" class="riser riser-h"/><text x="-8" y="22">מים חמים</text></g>`);
  out.push(`</svg>`);
  return out.join('');
}
