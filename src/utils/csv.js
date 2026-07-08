// Minimal CSV builder + browser download.
//
// Excel-friendly by design: a field is quoted only when it contains a comma,
// quote, or newline (embedded quotes are doubled per RFC 4180); rows are
// CRLF-terminated; and the downloaded file is prefixed with a UTF-8 BOM so
// Excel detects UTF-8 and renders Romanian diacritics (s-comma / t-comma / a /
// i / a-circumflex) correctly instead of falling back to ANSI.

function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// header: array of column titles. rows: array of arrays (one per record).
export function buildCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Local YYYY-MM-DD, for filenames.
export function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A safe, diacritic-free filename fragment from an arbitrary label.
export function slugify(s, fallback = 'user') {
  const out = String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return out || fallback;
}
