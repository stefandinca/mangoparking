// CSV builder: quoting/escaping rules the admin exports rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, slugify } from '../src/utils/csv.js';

test('buildCsv: plain cells stay unquoted, rows CRLF-joined', () => {
  assert.equal(buildCsv(['a', 'b'], [['1', '2']]), 'a,b\r\n1,2');
});

test('buildCsv: commas, quotes and newlines trigger RFC 4180 quoting', () => {
  const csv = buildCsv(['name'], [['Pop, Ion'], ['spune "da"'], ['linia1\nlinia2']]);
  assert.equal(csv, 'name\r\n"Pop, Ion"\r\n"spune ""da"""\r\n"linia1\nlinia2"');
});

test('buildCsv: null/undefined render as empty cells', () => {
  assert.equal(buildCsv(['a', 'b'], [[null, undefined]]), 'a,b\r\n,');
});

test('slugify: diacritics stripped, safe fallback', () => {
  assert.equal(slugify('Ștefan Dincă'), 'stefan-dinca');
  assert.equal(slugify('  --  '), 'user');
  assert.equal(slugify('', 'x'), 'x');
});
