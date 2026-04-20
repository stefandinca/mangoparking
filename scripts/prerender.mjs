#!/usr/bin/env node
// Prerender public routes to static HTML for SEO.
// Runs AFTER `vite build` — serves dist/ via `vite preview`, drives puppeteer
// through each route, waits for the router's `app-rendered` event, then writes
// the fully-rendered HTML back into dist/ at the route path.
// Client JS re-hydrates on load (content flashes briefly, acceptable for MVP).

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const SITE_URL = process.env.SITE_URL || 'https://mangoparking.ro';
const PORT = 4173;
const HOST = `http://localhost:${PORT}`;

const ROUTES = [
  '/', '/pricing', '/shuttle', '/about', '/contact',
  '/booking', '/booking/credits', '/booking/long-term',
  '/terms', '/privacy', '/gdpr', '/delivery', '/cancellation',
  '/en', '/en/pricing', '/en/shuttle', '/en/about', '/en/contact',
  '/en/booking', '/en/booking/credits', '/en/booking/long-term',
  '/en/terms', '/en/privacy', '/en/gdpr', '/en/delivery', '/en/cancellation',
];

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await fetch(url);
          if (res.ok) return resolve();
        } catch {}
        await new Promise(r => setTimeout(r, 250));
      }
      reject(new Error(`Preview server did not start within ${timeoutMs}ms`));
    })();
  });
}

async function main() {
  console.log('▶ Starting vite preview...');
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: true,
  });

  try {
    await waitForServer(HOST);
    console.log('✓ Preview server up at', HOST);

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    for (const route of ROUTES) {
      const url = HOST + route;
      process.stdout.write(`  prerendering ${route.padEnd(20)} `);

      await page.goto(url, { waitUntil: 'load', timeout: 20000 });

      // Router dispatches `app-rendered` after the page component mounts
      await page.evaluate(() => new Promise(resolve => {
        if (document.querySelector('#app')?.children.length) return resolve();
        window.addEventListener('app-rendered', () => resolve(), { once: true });
        setTimeout(resolve, 5000);
      }));

      // Small buffer for post-render meta/JSON-LD updates
      await new Promise(r => setTimeout(r, 300));

      let rendered = await page.content();
      // Rewrite localhost refs so canonical/og:url/hreflang point at prod
      rendered = rendered.split(HOST).join(SITE_URL);

      const outDir = route === '/' ? 'dist' : join('dist', ...route.split('/').filter(Boolean));
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'index.html'), rendered, 'utf8');
      console.log('✓');
    }

    await browser.close();
    console.log('\n✓ Prerender complete —', ROUTES.length, 'routes written.');
  } finally {
    server.kill();
  }
}

main().catch(err => {
  console.error('\n✗ Prerender failed:', err.message);
  process.exit(1);
});
