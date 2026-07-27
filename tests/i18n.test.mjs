// Locale-file invariants:
//  1. RO/EN key parity — a key present in one file and missing in the other
//     renders as the literal key path in the UI ("reservations.status.…").
//  2. No double-brace {{ }} placeholders — t() only interpolates single-brace
//     {name}; the double-brace offenders shipped visibly broken (fixed 2026-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ro from '../src/i18n/ro.js';
import en from '../src/i18n/en.js';

function keyPaths(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) keyPaths(v, path, out);
    else out.push(path);
  }
  return out;
}

test('every RO key exists in EN and vice versa', () => {
  const roKeys = new Set(keyPaths(ro));
  const enKeys = new Set(keyPaths(en));
  const missingInEn = [...roKeys].filter((k) => !enKeys.has(k));
  const missingInRo = [...enKeys].filter((k) => !roKeys.has(k));
  assert.deepEqual(missingInEn, [], `keys missing in en.js:\n  ${missingInEn.join('\n  ')}`);
  assert.deepEqual(missingInRo, [], `keys missing in ro.js:\n  ${missingInRo.join('\n  ')}`);
});

test('no {{ double-brace }} placeholders anywhere', () => {
  const offenders = [];
  for (const [name, locale] of [['ro', ro], ['en', en]]) {
    for (const path of keyPaths(locale)) {
      const value = path.split('.').reduce((o, k) => o?.[k], locale);
      if (typeof value === 'string' && value.includes('{{')) offenders.push(`${name}:${path}`);
    }
  }
  assert.deepEqual(offenders, [], `double-brace values:\n  ${offenders.join('\n  ')}`);
});
