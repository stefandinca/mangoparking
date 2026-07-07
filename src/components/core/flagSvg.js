// Inline SVG country flags — rendered as real vector shapes, not emoji.
//
// Why this exists: Windows (Chrome/Edge/Firefox on Windows) has no country-flag
// glyphs in its emoji font, so `🇷🇴` degrades to the bare regional-indicator
// letters "RO". Our staff run the admin panel on Windows, so the phone-field
// country picker draws flags itself instead of trusting emoji.
//
// Each flag is composed from a tiny set of primitives inside a fixed 20×15
// (4:3) viewBox. Complex state emblems (crests, coats of arms, fine text) are
// intentionally omitted — the field colours + iconic shapes are enough to
// recognise a country at 20px, and the two-letter code sits next to it anyway.
// A handful of emblem-only flags fall back to a neutral code chip.

const W = 20, H = 15;

function rect(x, y, w, h, c) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
}
function circle(cx, cy, r, c) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
}
function bg(c) { return rect(0, 0, W, H, c); }

// Equal horizontal / vertical bands, top→bottom / hoist→fly.
function h(colors) {
  const bh = H / colors.length;
  return colors.map((c, i) => rect(0, i * bh, W, bh + 0.02, c)).join('');
}
function v(colors) {
  const bw = W / colors.length;
  return colors.map((c, i) => rect(i * bw, 0, bw + 0.02, H, c)).join('');
}
// Weighted bands: [[color, weight], …].
function hW(parts) {
  const tot = parts.reduce((s, p) => s + p[1], 0);
  let y = 0, out = '';
  for (const [c, w] of parts) { const bh = H * w / tot; out += rect(0, y, W, bh + 0.02, c); y += bh; }
  return out;
}
function vW(parts) {
  const tot = parts.reduce((s, p) => s + p[1], 0);
  let x = 0, out = '';
  for (const [c, w] of parts) { const bw = W * w / tot; out += rect(x, 0, bw + 0.02, H, c); x += bw; }
  return out;
}

// Scandinavian cross (hoist-offset). Optional outline for NO/IS.
function nordic(field, cross, outline) {
  const vx = 5.5, bw = 2.6, vy = (H - bw) / 2;
  let out = bg(field);
  if (outline) out += rect(vx - 0.7, 0, bw + 1.4, H, outline) + rect(0, vy - 0.7, W, bw + 1.4, outline);
  out += rect(vx, 0, bw, H, cross) + rect(0, vy, W, bw, cross);
  return out;
}
// Full-width centred cross (Switzerland / Georgia / England-ish).
function crossCenter(field, cross, bw = 3) {
  return bg(field) + rect((W - bw) / 2, 0, bw, H, cross) + rect(0, (H - bw) / 2, W, bw, cross);
}

// Regular star (5-point by default), pointing up.
function starPath(cx, cy, r, points = 5, rot = -90) {
  const inner = r * 0.382;
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const a = (rot + i * 180 / points) * Math.PI / 180;
    d += (i === 0 ? 'M' : 'L') + (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2);
  }
  return d + 'Z';
}
function star(cx, cy, r, c, points = 5) {
  return `<path d="${starPath(cx, cy, r, points)}" fill="${c}"/>`;
}
// Crescent = colour disc minus a field-coloured disc offset toward the fly.
function crescent(cx, cy, r, color, field) {
  return circle(cx, cy, r, color) + circle(cx + r * 0.32, cy, r * 0.82, field);
}
// Hoist triangle (Czechia / Philippines / Jordan).
function triHoist(color, tip = 8) {
  return `<polygon points="0,0 ${tip},${H / 2} 0,${H}" fill="${color}"/>`;
}

// A faithful-enough Union Jack (used for GB and as a canton for AU/NZ).
function unionJack() {
  return `${bg('#012169')}
    <path d="M0,0 20,15 M20,0 0,15" stroke="#fff" stroke-width="3"/>
    <path d="M0,0 20,15" stroke="#C8102E" stroke-width="1.2"/>
    <path d="M20,0 0,15" stroke="#C8102E" stroke-width="1.2"/>
    <path d="M10,0 V15 M0,7.5 H20" stroke="#fff" stroke-width="5"/>
    <path d="M10,0 V15 M0,7.5 H20" stroke="#C8102E" stroke-width="3"/>`;
}
function us() {
  let out = '';
  const sh = H / 13;
  for (let i = 0; i < 13; i++) out += rect(0, i * sh, W, sh + 0.02, i % 2 === 0 ? '#B31942' : '#fff');
  out += rect(0, 0, W * 0.42, sh * 7, '#0A3161');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) out += circle(1.3 + c * 2, 1.4 + r * 2.2, 0.45, '#fff');
  return out;
}
function iceland() {
  return nordic('#02529C', '#fff') + rect(5.5 + 0.75, 0, 1.1, H, '#DC1E35') + rect(0, (H - 1.1) / 2, W, 1.1, '#DC1E35');
}

// ISO alpha-2 → composer. Missing entries fall back to a neutral code chip.
const SPECS = {
  RO: () => v(['#002B7F', '#FCD116', '#CE1126']),
  BE: () => v(['#000000', '#FDDA24', '#EF3340']),
  FR: () => v(['#0055A4', '#FFFFFF', '#EF4135']),
  IE: () => v(['#169B62', '#FFFFFF', '#FF883E']),
  IT: () => v(['#008C45', '#F4F5F0', '#CD212A']),
  MX: () => v(['#006847', '#FFFFFF', '#CE1126']),
  MD: () => v(['#0046AE', '#FFD200', '#CC092F']),
  MT: () => vW([['#FFFFFF', 1], ['#CF142B', 1]]),
  DE: () => h(['#000000', '#DD0000', '#FFCE00']),
  AT: () => h(['#ED2939', '#FFFFFF', '#ED2939']),
  NL: () => h(['#AE1C28', '#FFFFFF', '#21468B']),
  RU: () => h(['#FFFFFF', '#0039A6', '#D52B1E']),
  HU: () => h(['#CD2A3E', '#FFFFFF', '#436F4D']),
  BG: () => h(['#FFFFFF', '#00966E', '#D62612']),
  LT: () => h(['#FDB913', '#006A44', '#C1272D']),
  EE: () => h(['#0072CE', '#000000', '#FFFFFF']),
  AM: () => h(['#D90012', '#0033A0', '#F2A800']),
  CO: () => hW([['#FCD116', 2], ['#003893', 1], ['#CE1126', 1]]),
  LV: () => hW([['#9E3039', 2], ['#FFFFFF', 1], ['#9E3039', 2]]),
  LU: () => h(['#ED2939', '#FFFFFF', '#00A1DE']),
  RS: () => h(['#C6363C', '#0C4076', '#FFFFFF']),
  SK: () => h(['#FFFFFF', '#0B4EA2', '#EE1C25']),
  SI: () => h(['#FFFFFF', '#0057B7', '#D50000']),
  HR: () => h(['#FF0000', '#FFFFFF', '#171796']),
  ES: () => hW([['#AA151B', 1], ['#F1BF00', 2], ['#AA151B', 1]]),
  LB: () => hW([['#ED1C24', 1], ['#FFFFFF', 2], ['#ED1C24', 1]]) + star(10, 7.5, 1.6, '#007A3D', 3),
  TH: () => hW([['#A51931', 1], ['#F4F5F8', 1], ['#2D2A4A', 2], ['#F4F5F8', 1], ['#A51931', 1]]),
  IR: () => h(['#239F40', '#FFFFFF', '#DA0000']),
  IQ: () => h(['#CE1126', '#FFFFFF', '#000000']),
  EG: () => h(['#CE1126', '#FFFFFF', '#000000']),
  SY: () => h(['#CE1126', '#FFFFFF', '#000000']),
  PL: () => h(['#FFFFFF', '#DC143C']),
  ID: () => h(['#FF0000', '#FFFFFF']),
  MC: () => h(['#CE1126', '#FFFFFF']),
  UA: () => h(['#0057B7', '#FFD700']),
  DK: () => nordic('#C60C30', '#FFFFFF'),
  FI: () => nordic('#FFFFFF', '#003580'),
  SE: () => nordic('#006AA7', '#FECC00'),
  NO: () => nordic('#EF2B2D', '#00205B', '#FFFFFF'),
  IS: () => iceland(),
  PT: () => vW([['#046A38', 2], ['#DA020E', 3]]) + circle(8, 7.5, 1.5, '#FFE900'),
  CH: () => bg('#D52B1E') + rect(8.5, 3.5, 3, 8, '#FFFFFF') + rect(6, 6, 8, 3, '#FFFFFF'),
  GE: () => crossCenter('#FFFFFF', '#FF0000', 2.6),
  JP: () => bg('#FFFFFF') + circle(10, 7.5, 4.2, '#BC002D'),
  TR: () => bg('#E30A17') + crescent(9, 7.5, 3.1, '#FFFFFF', '#E30A17') + star(13.2, 7.5, 1.6, '#FFFFFF'),
  TN: () => bg('#E70013') + circle(10, 7.5, 3.6, '#FFFFFF') + crescent(10.6, 7.5, 2.3, '#E70013', '#FFFFFF') + star(11.4, 7.5, 1.2, '#E70013'),
  DZ: () => v(['#006233', '#FFFFFF']) + crescent(10.2, 7.5, 2.5, '#D21034', '#FFFFFF') + star(11.4, 7.5, 1.1, '#D21034'),
  PK: () => vW([['#FFFFFF', 1], ['#01411C', 3]]) + crescent(13, 7.8, 2.4, '#FFFFFF', '#01411C') + star(15, 5.8, 1.1, '#FFFFFF'),
  SG: () => h(['#EF3340', '#FFFFFF']) + crescent(4.5, 3.8, 2, '#FFFFFF', '#EF3340') + star(7, 3.8, 0.8, '#FFFFFF'),
  MA: () => bg('#C1272D') + star(10, 7.5, 3, '#006233'),
  VN: () => bg('#DA251D') + star(10, 7.5, 4, '#FFFF00'),
  CN: () => bg('#DE2910') + star(4, 3.6, 2.2, '#FFDE00') + star(8, 1.6, 0.8, '#FFDE00') + star(9.4, 3.4, 0.8, '#FFDE00') + star(9.4, 6, 0.8, '#FFDE00') + star(8, 7.6, 0.8, '#FFDE00'),
  MK: () => bg('#D20000') + circle(10, 7.5, 2.2, '#FFE600'),
  KZ: () => bg('#00AFCA') + circle(10, 7.5, 2.6, '#FEC50C'),
  KE: () => hW([['#000000', 6], ['#FFFFFF', 1], ['#BB0000', 6], ['#FFFFFF', 1], ['#006600', 6]]),
  KW: () => h(['#007A3D', '#FFFFFF', '#CE1126']) + `<polygon points="0,0 5,5 5,10 0,15" fill="#000000"/>`,
  LY: () => hW([['#E70013', 1], ['#000000', 2], ['#239E46', 1]]) + crescent(10.2, 7.5, 1.9, '#FFFFFF', '#000000') + star(11.3, 7.5, 0.9, '#FFFFFF'),
  LI: () => h(['#002B7F', '#CE1126']),
  BY: () => hW([['#C8313E', 2], ['#4AA657', 1]]),
  BH: () => vW([['#FFFFFF', 1], ['#CE1126', 4]]),
  QA: () => vW([['#FFFFFF', 1], ['#8D1B3D', 4]]),
  IN: () => h(['#FF9933', '#FFFFFF', '#138808']) + circle(10, 7.5, 1.5, '#FFFFFF') + circle(10, 7.5, 1.4, '#000080') + circle(10, 7.5, 1, '#FFFFFF'),
  AZ: () => h(['#00B5E2', '#EF3340', '#509E2F']) + crescent(10, 7.5, 1.9, '#FFFFFF', '#EF3340') + star(11.2, 7.5, 0.9, '#FFFFFF'),
  GB: () => unionJack(),
  US: () => us(),
  AU: () => bg('#00247D') + `<g transform="translate(0,0) scale(0.5)">${unionJack()}</g>` + star(15, 11, 1.6, '#FFFFFF', 7),
  NZ: () => bg('#00247D') + `<g transform="scale(0.5)">${unionJack()}</g>` + star(15, 5, 0.9, '#CC142B') + star(16.5, 8.5, 0.9, '#CC142B') + star(14.5, 11.5, 0.9, '#CC142B'),
  CL: () => rect(0, 0, W, H / 2, '#FFFFFF') + rect(0, H / 2, W, H / 2, '#D52B1E') + rect(0, 0, W * 0.33, H / 2, '#0039A6') + star(3.3, 3.75, 1.6, '#FFFFFF'),
  BR: () => bg('#009C3B') + `<polygon points="10,1.5 18.5,7.5 10,13.5 1.5,7.5" fill="#FFDF00"/>` + circle(10, 7.5, 3, '#002776'),
  AR: () => h(['#75AADB', '#FFFFFF', '#75AADB']) + circle(10, 7.5, 1.5, '#FCBF49'),
  IL: () => bg('#FFFFFF') + rect(0, 2, W, 1.3, '#0038B8') + rect(0, H - 3.3, W, 1.3, '#0038B8') + star(10, 7.5, 1.8, '#0038B8', 6),
  KR: () => bg('#FFFFFF') + `<path d="M10,4.9 A2.6,2.6 0 0,1 10,10.1 A1.3,1.3 0 0,1 10,7.5 A1.3,1.3 0 0,0 10,4.9 Z" fill="#CD2E3A"/><path d="M10,4.9 A1.3,1.3 0 0,1 10,7.5 A1.3,1.3 0 0,0 10,10.1 A2.6,2.6 0 0,0 10,4.9 Z" fill="#0047A0"/>`,
  TW: () => bg('#FE0000') + rect(0, 0, W / 2, H / 2, '#000097') + circle(5, 3.75, 1.6, '#FFFFFF') + star(5, 3.75, 1.4, '#000097', 12),
  PH: () => rect(0, 0, W, H / 2, '#0038A8') + rect(0, H / 2, W, H / 2, '#CE1126') + triHoist('#FFFFFF', 8) + star(2.4, 7.5, 0.9, '#FCD116'),
  JO: () => h(['#000000', '#FFFFFF', '#007A3D']) + triHoist('#CE1126', 8) + star(3, 7.5, 1, '#FFFFFF', 7),
  AE: () => rect(0, 0, W * 0.25, H, '#EF3340') + rect(W * 0.25, 0, W * 0.75, H / 3, '#009739') + rect(W * 0.25, H / 3, W * 0.75, H / 3, '#FFFFFF') + rect(W * 0.25, 2 * H / 3, W * 0.75, H / 3, '#000000'),
  OM: () => rect(0, 0, W * 0.28, H, '#DB161B') + rect(W * 0.28, 0, W, H / 3, '#FFFFFF') + rect(W * 0.28, H / 3, W, H / 3, '#DB161B') + rect(W * 0.28, 2 * H / 3, W, H / 3, '#008000'),
  SA: () => bg('#006C35') + rect(3, 6.6, 14, 0.7, '#FFFFFF'),
  CZ: () => rect(0, 0, W, H / 2, '#FFFFFF') + rect(0, H / 2, W, H / 2, '#D7141A') + triHoist('#11457E', 9),
  CA: () => vW([['#FF0000', 1], ['#FFFFFF', 2], ['#FF0000', 1]]) + star(10, 7.5, 2.1, '#FF0000'),
  GR: () => {
    let out = '';
    const sh = H / 9;
    for (let i = 0; i < 9; i++) out += rect(0, i * sh, W, sh + 0.02, i % 2 === 0 ? '#0D5EAF' : '#FFFFFF');
    out += rect(0, 0, sh * 5, sh * 5, '#0D5EAF');
    out += rect(sh * 2 - 0.7, 0, 1.4, sh * 5, '#FFFFFF') + rect(0, sh * 2.5 - 0.7, sh * 5, 1.4, '#FFFFFF');
    return out;
  },
};

// Neutral code chip for emblem-only flags we don't draw (kept Windows-safe:
// it renders plain text glyphs, never an emoji).
function codeChip(iso) {
  return `${bg('#E5E7EB')}<text x="10" y="10.3" text-anchor="middle" font-size="6.5" font-family="sans-serif" font-weight="700" fill="#4B5563">${iso}</text>`;
}

// Public: an <svg> flag for the given ISO alpha-2 code. `cls` styles the svg
// element (sizing/rounding are applied by the caller's wrapper).
export function flagSvg(iso, cls = '') {
  const key = String(iso || '').toUpperCase();
  const inner = SPECS[key] ? SPECS[key]() : codeChip(key || '??');
  return `<svg viewBox="0 0 ${W} ${H}"${cls ? ` class="${cls}"` : ''} xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}
