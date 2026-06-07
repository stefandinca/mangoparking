#!/usr/bin/env node
// No-browser prerender: inject per-route SEO into static HTML.
//
// Runs AFTER `vite build`. For each public route it takes the built
// dist/index.html shell and rewrites the <head> (title, description, OG,
// Twitter, canonical, hreflang, JSON-LD), writing dist/<route>/index.html.
// Crawlers and social unfurlers get correct per-page tags; the client SPA
// hydrates the body on load.
//
// Why not Puppeteer? Headless Chromium can't launch in Vercel's build
// container (missing system libs; even @sparticuz/chromium fails), so a
// browser-based prerender silently skips there. This pure-Node approach has
// no native deps and works identically everywhere.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROUTES, SITE_URL } from './seo-routes.mjs';

const DIST = 'dist';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setMeta(html, selectorAttr, name, content) {
  const re = new RegExp(`(<meta ${selectorAttr}="${name}" content=")[^"]*(">)`);
  if (re.test(html)) return html.replace(re, `$1${esc(content)}$2`);
  // Insert before </head> if the tag wasn't in the template.
  return html.replace('</head>', `  <meta ${selectorAttr}="${name}" content="${esc(content)}">\n</head>`);
}

function buildHtml(template, { title, description, canonical, hreflang, jsonld, locale }) {
  let html = template;
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${locale}"`);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:url', canonical);
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', description);
  html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(canonical)}">`);

  let inject = '';
  for (const [lang, url] of Object.entries(hreflang)) {
    inject += `\n  <link rel="alternate" hreflang="${lang}" href="${esc(url)}">`;
  }
  // data-structured so the client's setStructuredData() replaces (not duplicates) it.
  if (jsonld) inject += `\n  <script type="application/ld+json" data-structured>${JSON.stringify(jsonld)}</script>`;
  return html.replace('</head>', `${inject}\n</head>`);
}

async function main() {
  const template = await readFile(join(DIST, 'index.html'), 'utf8');
  let count = 0;

  for (const route of ROUTES) {
    const roUrl = SITE_URL + (route.path === '/' ? '/' : route.path);
    const enUrl = SITE_URL + '/en' + (route.path === '/' ? '' : route.path);
    const hreflang = { ro: roUrl, en: enUrl, 'x-default': roUrl };

    for (const locale of ['ro', 'en']) {
      const seo = route[locale];
      if (!seo) continue;
      const routePath = locale === 'en'
        ? '/en' + (route.path === '/' ? '' : route.path)
        : route.path;
      const canonical = locale === 'en' ? enUrl : roUrl;
      const html = buildHtml(template, {
        title: seo.title,
        description: seo.description,
        canonical,
        hreflang,
        jsonld: route.jsonld,
        locale,
      });
      const segments = routePath.split('/').filter(Boolean);
      const outDir = segments.length ? join(DIST, ...segments) : DIST;
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'index.html'), html, 'utf8');
      count++;
    }
  }

  console.log(`✓ SEO meta injected — ${count} route files written.`);
}

main().catch((err) => {
  // Non-fatal: the SPA still works without per-route HTML.
  console.warn('⚠ SEO injection skipped (build still succeeds):', err.message);
  process.exit(0);
});
