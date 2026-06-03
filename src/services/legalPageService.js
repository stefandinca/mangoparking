// Admin-editable legal pages. Each slug ∈ ['terms','privacy','gdpr',
// 'delivery','cancellation'] maps to a `legalPages/{slug}` doc that
// stores per-locale title + intro + sections + lastUpdatedISO. When no
// doc exists for a slug, the public legal page falls back to the i18n
// defaults shipped with the build. Writing requires admin role; reads
// are public so the public-facing legal routes can fetch them.

import { getDocument, setDocument } from '../firebase/db.js';
import { auditLog } from './auditService.js';

export const LEGAL_SLUGS = ['terms', 'privacy', 'gdpr', 'delivery', 'cancellation'];

export async function getLegalPage(slug, locale = 'ro') {
  if (!LEGAL_SLUGS.includes(slug)) return null;
  const doc = await getDocument('legalPages', slug).catch(() => null);
  if (!doc) return null;
  return doc[locale] || doc.ro || null;
}

export async function getLegalPageRaw(slug) {
  if (!LEGAL_SLUGS.includes(slug)) return null;
  return getDocument('legalPages', slug).catch(() => null);
}

export async function saveLegalPage(slug, locale, payload) {
  if (!LEGAL_SLUGS.includes(slug)) throw new Error('Invalid slug');
  if (!['ro', 'en'].includes(locale)) throw new Error('Invalid locale');
  const existing = (await getDocument('legalPages', slug).catch(() => null)) || {};
  const next = {
    ...existing,
    slug,
    [locale]: {
      title: String(payload.title || '').trim(),
      intro: String(payload.intro || ''),
      sections: Array.isArray(payload.sections)
        ? payload.sections.map((s) => ({
            heading: String(s.heading || '').trim(),
            body: String(s.body || ''),
          })).filter((s) => s.heading || s.body)
        : [],
      lastUpdatedISO: payload.lastUpdatedISO || new Date().toISOString().slice(0, 10),
    },
    updatedAt: new Date().toISOString(),
  };
  await setDocument('legalPages', slug, next);
  await auditLog('legal_page_saved', 'legalPage', slug, null, { locale });
}
