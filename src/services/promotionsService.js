// Admin-editable promotions page. Stored at `siteContent/promotions`:
//
//   {
//     heroImage: 'https://...',          // single image URL, shared across locales
//     ro: {
//       title: 'Oferte și promoții',
//       intro: 'Vezi mai jos vouchere active...',
//       body: '## Reduceri navetiști\\n...',     // markdown
//     },
//     en: { title, intro, body },                // same shape
//     updatedAt: ISO,
//   }
//
// The doc is publicly readable so the customer-facing /promotions page
// can render without auth; admin-only writes.

import DOMPurify from 'dompurify';
import { getDocument, setDocument } from '../firebase/db.js';
import { auditLog } from './auditService.js';

const DOC_ID = 'promotions';
const COLLECTION = 'siteContent';

export async function getPromotionsPage() {
  return getDocument(COLLECTION, DOC_ID).catch(() => null);
}

export async function savePromotionsPage(payload) {
  const existing = (await getPromotionsPage()) || {};
  const nowIso = new Date().toISOString();
  const next = {
    ...existing,
    heroImage: String(payload.heroImage || '').trim(),
    ro: {
      title: String(payload.ro?.title || '').trim(),
      intro: String(payload.ro?.intro || '').trim(),
      body: String(payload.ro?.body || ''),
    },
    en: {
      title: String(payload.en?.title || '').trim(),
      intro: String(payload.en?.intro || '').trim(),
      body: String(payload.en?.body || ''),
    },
    updatedAt: nowIso,
  };
  await setDocument(COLLECTION, DOC_ID, next);
  await auditLog('promotions_page_saved', COLLECTION, DOC_ID, null, { updatedAt: nowIso });
  return next;
}

// Minimal, safe markdown renderer. Handles the formatting that admins
// realistically need on a promo page — no external dep, no script
// injection surface. Returns an HTML string. Falls back to escaping
// only when the input is empty.
//
// Supported:
//   # Heading       → <h2>
//   ## Heading      → <h3>
//   **bold**        → <strong>
//   *italic*        → <em>
//   [text](url)     → <a> (only http/https/mailto URLs)
//   - item / * item → <ul><li>
//   1. item         → <ol><li>
//   blank line      → paragraph break
//   single \n       → <br>
export function renderMarkdown(raw) {
  if (!raw) return '';
  const text = String(raw).replace(/\r\n/g, '\n');

  // Escape HTML first so user input can't inject tags.
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Inline: bold, italic, links. Order matters — bold (`**`) before italic
  // (`*`) so `**foo**` parses as bold not italic-of-italic.
  escaped = escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-blueberry hover:underline">$1</a>');

  // Block-level: split into blocks at blank lines.
  const blocks = escaped.split(/\n\s*\n/);
  const html = blocks.map((rawBlock) => {
    const block = rawBlock.trim();
    if (!block) return '';
    // Headings
    if (/^##\s+/.test(block)) {
      return `<h3 class="font-heading font-bold text-xl text-blueberry-deep mt-6 mb-2">${block.replace(/^##\s+/, '')}</h3>`;
    }
    if (/^#\s+/.test(block)) {
      return `<h2 class="font-heading font-bold text-2xl text-blueberry-deep mt-8 mb-3">${block.replace(/^#\s+/, '')}</h2>`;
    }
    // Ordered list
    if (/^(\d+)\.\s+/.test(block)) {
      const items = block.split(/\n/).map((line) => line.replace(/^\d+\.\s+/, '').trim()).filter(Boolean);
      return `<ol class="list-decimal pl-6 space-y-1 my-3 text-[15px]">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
    }
    // Unordered list
    if (/^[-*]\s+/.test(block)) {
      const items = block.split(/\n/).map((line) => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
      return `<ul class="list-disc pl-6 space-y-1 my-3 text-[15px]">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    }
    // Paragraph — single \n inside becomes <br>
    return `<p class="my-3 leading-relaxed text-[15px]">${block.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return html;
}

// ── Rich-text (Quill) ───────────────────────────────────────────────────
// The body is authored in /admin/promotions with a Quill WYSIWYG editor
// and stored as HTML. Legacy promo pages were authored in markdown via the
// old textarea editor — `bodyToHtml` upgrades those on the fly so existing
// content keeps rendering until an admin re-saves it (which persists HTML).

// Heuristic: does this string already contain HTML tags? Quill output does
// (`<p>`, `<h2>`, `<strong>`, …); legacy markdown bodies don't.
function looksLikeHtml(raw) {
  return /<\/?[a-z][\s\S]*>/i.test(String(raw || ''));
}

// Markdown-or-HTML → HTML. Markdown is converted via the legacy renderer.
export function bodyToHtml(raw) {
  const s = String(raw || '');
  if (!s.trim()) return '';
  return looksLikeHtml(s) ? s : renderMarkdown(s);
}

// Quill 2 emits BOTH bullet and numbered lists as a single `<ol>`,
// distinguishing items only by `<li data-list="bullet|ordered">`. We keep
// that structure (the `.richtext` CSS draws bullet vs number markers via a
// counter, so numbering stays continuous across interspersed bullets) and
// only strip the empty `<span class="ql-ui">` marker placeholders Quill
// injects into each item. Legacy markdown lists have no `data-list` and use
// native markers — they pass through untouched.
function cleanQuillHtml(html) {
  if (!html || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('span.ql-ui').forEach((s) => s.remove());
  return doc.body.innerHTML;
}

// Force every link to open safely in a new tab. Without rel=noopener a
// target=_blank link can reach back into our window via `window.opener`.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// Whitelist exactly the shapes Quill emits: block + inline formatting,
// links, and the `ql-align-*` / `ql-indent-*` classes plus inline
// color/background styles the toolbar produces. Everything else is dropped.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'span', 'strong', 'em', 'u', 's',
    'h1', 'h2', 'h3', 'h4', 'blockquote',
    'ol', 'ul', 'li', 'a',
  ],
  // `data-list` (Quill's bullet/ordered marker) survives via DOMPurify's
  // default ALLOW_DATA_ATTR; it doesn't need to be listed here.
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
};

// Sanitize stored HTML before it ever reaches innerHTML on the public page.
export function sanitizeRichHtml(html) {
  return DOMPurify.sanitize(String(html || ''), SANITIZE_CONFIG);
}

// One-call helper for renderers: legacy-markdown-or-HTML → safe HTML.
export function renderPromoBody(raw) {
  return sanitizeRichHtml(cleanQuillHtml(bodyToHtml(raw)));
}
