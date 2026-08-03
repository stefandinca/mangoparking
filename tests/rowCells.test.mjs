// Shared admin row cells — the phone tel: link and the return-flight cell.
//
// Worth testing because the phone value is customer-supplied and lands in an
// href AND a title attribute on admin screens, and because the dial string has
// to be stripped: the activity page used to put the raw value in the href, and
// spaces/dashes break some dialers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telHref, phoneLinkHtml, returnFlightHtml } from '../src/components/admin/rowCells.js';

test('telHref: keeps only + and digits', () => {
  assert.equal(telHref('+40 720 000 111'), '+40720000111');
  assert.equal(telHref('0720-000-111'), '0720000111');
  assert.equal(telHref('(0720) 000 111'), '0720000111');
  assert.equal(telHref(''), '');
  assert.equal(telHref(null), '');
});

test('phoneLinkHtml: dials the stripped number, shows the original', () => {
  const html = phoneLinkHtml('+40 720 000 111');
  assert.match(html, /href="tel:\+40720000111"/);
  assert.match(html, />\+40 720 000 111</);
  assert.match(html, /data-tel/);  // lets row handlers recognise it
});

test('phoneLinkHtml: empty input returns the caller-supplied placeholder', () => {
  assert.equal(phoneLinkHtml('', { empty: '—' }), '—');
  assert.equal(phoneLinkHtml(null, { empty: '—' }), '—');
  assert.equal(phoneLinkHtml('   '), '');   // default: render nothing
});

test('phoneLinkHtml: a value with no digits is shown but not linked', () => {
  // Staff sometimes type a note into the field; never build a dead tel: href.
  const html = phoneLinkHtml('n/a');
  assert.ok(!html.includes('href'));
  assert.match(html, /n\/a/);
});

test('phoneLinkHtml: escapes the value in text and title', () => {
  // The payload's own characters must be neutralised. The literal string
  // "onerror=..." surviving as inert TEXT is fine — what matters is that no
  // raw `<` opens a tag and no raw `"` closes the title attribute early.
  const html = phoneLinkHtml('"><img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'), 'must not emit a raw tag');
  assert.ok(!html.includes('"><img'), 'must not break out of the attribute');
  assert.match(html, /title="[^"]*&quot;&gt;&lt;img/, 'title is fully escaped');
  assert.match(html, /<span>&quot;&gt;&lt;img/, 'visible text is escaped');
});

test('returnFlightHtml: renders the value, or the placeholder when unset', () => {
  assert.match(returnFlightHtml('W6 3251'), />W6 3251</);
  assert.equal(returnFlightHtml('', { empty: '—' }), '—');
  assert.equal(returnFlightHtml(null, { empty: '—' }), '—');
  assert.equal(returnFlightHtml('  '), '');
});

test('returnFlightHtml: escapes the value', () => {
  const html = returnFlightHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script'), 'must not emit a raw tag');
  assert.match(html, /&lt;script&gt;/);
});
