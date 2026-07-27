// Sync /email-templates/*.html to Brevo transactional templates.
//
// The numeric ID map lives in functions/src/emailTemplates.js (single source
// of truth — the same map the Cloud Functions send with). Each map entry
// `{name}-{locale}` pairs with email-templates/{name}-{locale}.html.
//
// Usage (API key comes from the BREVO_API_KEY env var):
//   node scripts/sync-brevo-templates.mjs list           # remote templates vs local map
//   node scripts/sync-brevo-templates.mjs diff           # compare every mapped template
//   node scripts/sync-brevo-templates.mjs diff signup-welcome-ro
//   node scripts/sync-brevo-templates.mjs push signup-welcome-ro [...]
//   node scripts/sync-brevo-templates.mjs push --all
//   node scripts/sync-brevo-templates.mjs pull signup-welcome-ro  # remote HTML -> local file
//
// The repo is the source of truth: push sends htmlContent, the subject
// (parsed from the `<!-- subject: ... -->` comment on line 1) and
// templateName (= the map key). Sender, reply-to and active state stay as
// configured in Brevo. Never prints the API key.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../functions/src/emailTemplates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TPL_DIR = path.join(ROOT, 'email-templates');
const API = 'https://api.brevo.com/v3/smtp/templates';

const KEY = process.env.BREVO_API_KEY;
if (!KEY) {
  console.error('BREVO_API_KEY env var not set.');
  console.error('  PowerShell: $env:BREVO_API_KEY = (firebase functions:secrets:access BREVO_API_KEY)');
  process.exit(1);
}

const HEADERS = { 'api-key': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: HEADERS, ...opts });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Brevo ${res.status} ${url}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function localPath(key) {
  return path.join(TPL_DIR, `${key}.html`);
}

async function readLocal(key) {
  try {
    return await readFile(localPath(key), 'utf8');
  } catch {
    return null;
  }
}

// Whitespace-insensitive compare: Brevo may re-serialize the HTML slightly.
function normalize(html) {
  return (html ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

// Subject lives in the repo as `<!-- subject: ... -->` on line 1 of each file.
function localSubject(html) {
  return html?.match(/^<!--\s*subject:\s*(.*?)\s*-->/)?.[1] ?? null;
}

// Zero-width chars sneak into Brevo subjects via copy-paste; ignore for compare.
function normSubject(s) {
  return (s ?? '').replace(/[\u200B\uFEFF]/g, '').trim();
}

function entries(args) {
  const wanted = args.filter((a) => !a.startsWith('--'));
  const all = Object.entries(TEMPLATES).filter(([, id]) => id != null);
  if (!wanted.length || args.includes('--all')) return all;
  const bad = wanted.filter((w) => !(w in TEMPLATES));
  if (bad.length) {
    console.error(`Unknown template key(s): ${bad.join(', ')}`);
    console.error(`Valid keys:\n  ${Object.keys(TEMPLATES).join('\n  ')}`);
    process.exit(1);
  }
  return all.filter(([k]) => wanted.includes(k));
}

async function cmdList() {
  const data = await api(`${API}?limit=100&offset=0`);
  const remote = new Map((data.templates ?? []).map((t) => [t.id, t]));
  const mappedIds = new Set(Object.values(TEMPLATES).filter((id) => id != null));

  console.log(`Remote templates: ${data.count} — local map: ${mappedIds.size} entries\n`);
  console.log('LOCAL KEY                        ID   ACTIVE  REMOTE NAME / SUBJECT');
  for (const [key, id] of Object.entries(TEMPLATES)) {
    const t = id != null ? remote.get(id) : null;
    const status = id == null ? '(no ID)' : t ? '' : '!! ID NOT FOUND REMOTELY';
    const info = t ? `${t.isActive ? 'yes' : 'NO '}     ${t.name} — "${t.subject}"` : status;
    console.log(`${key.padEnd(32)} ${String(id ?? '-').padEnd(4)} ${info}`);
  }
  const unmapped = [...remote.values()].filter((t) => !mappedIds.has(t.id));
  if (unmapped.length) {
    console.log('\nRemote templates NOT in the local map:');
    for (const t of unmapped) console.log(`  ${t.id}  ${t.isActive ? 'active  ' : 'inactive'}  ${t.name}`);
  }
}

async function cmdDiff(args) {
  let same = 0, differs = 0, problems = 0;
  for (const [key, id] of entries(args)) {
    const local = await readLocal(key);
    if (local == null) { console.log(`MISSING FILE  ${key} (${localPath(key)})`); problems++; continue; }
    let remote;
    try {
      remote = await api(`${API}/${id}`);
    } catch (err) {
      console.log(`FETCH FAILED  ${key} (id ${id}): ${err.message}`); problems++; continue;
    }
    const issues = [];
    if (normalize(remote.htmlContent) !== normalize(local)) {
      issues.push(`html (local ${normalize(local).length} vs remote ${normalize(remote.htmlContent).length} chars)`);
    }
    const subj = localSubject(local);
    if (subj != null && normSubject(remote.subject) !== normSubject(subj)) {
      issues.push(`subject (remote "${remote.subject}")`);
    }
    if (remote.name !== key) issues.push(`name (remote "${remote.name}")`);
    if (!issues.length) {
      console.log(`identical     ${key} (id ${id})`); same++;
    } else {
      console.log(`DIFFERS       ${key} (id ${id}) — ${issues.join('; ')}`);
      differs++;
    }
  }
  console.log(`\n${same} identical, ${differs} differ, ${problems} problem(s)`);
}

async function cmdPush(args) {
  const list = entries(args);
  if (!args.filter((a) => !a.startsWith('--')).length && !args.includes('--all')) {
    console.error('push requires explicit template keys, or --all.');
    process.exit(1);
  }
  for (const [key, id] of list) {
    const local = await readLocal(key);
    if (local == null) { console.log(`skip (no file)  ${key}`); continue; }
    const subj = localSubject(local);
    const body = {
      htmlContent: local,
      templateName: key,
      ...(subj != null ? { subject: subj } : {}),
    };
    await api(`${API}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    console.log(`pushed          ${key} -> id ${id} (${local.length} chars${subj != null ? ', +subject' : ''})`);
  }
}

async function cmdPull(args) {
  const wanted = args.filter((a) => !a.startsWith('--'));
  if (!wanted.length) { console.error('pull requires explicit template keys.'); process.exit(1); }
  for (const [key, id] of entries(args)) {
    const remote = await api(`${API}/${id}`);
    await writeFile(localPath(key), remote.htmlContent ?? '', 'utf8');
    console.log(`pulled          ${key} <- id ${id} (${(remote.htmlContent ?? '').length} chars)`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { list: cmdList, diff: cmdDiff, push: cmdPush, pull: cmdPull };
if (!commands[cmd]) {
  console.error('Usage: node scripts/sync-brevo-templates.mjs <list|diff|push|pull> [keys...] [--all]');
  process.exit(1);
}
await commands[cmd](rest);
