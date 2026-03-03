/**
 * Update document head meta tags for SEO
 */
export function updateMeta({ title, description, ogTitle, ogDescription, ogImage, canonical, lang, hreflang }) {
  document.title = title || 'Mango Parking';
  document.documentElement.lang = lang || 'ro';

  setMeta('description', description);
  setMeta('og:title', ogTitle || title, 'property');
  setMeta('og:description', ogDescription || description, 'property');
  setMeta('og:type', 'website', 'property');
  setMeta('og:site_name', 'Mango Parking', 'property');
  if (ogImage) setMeta('og:image', ogImage, 'property');

  // Canonical
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = canonical || window.location.href;

  // Hreflang
  document.querySelectorAll('link[hreflang]').forEach((el) => el.remove());
  if (hreflang) {
    for (const [lang, url] of Object.entries(hreflang)) {
      const l = document.createElement('link');
      l.rel = 'alternate';
      l.hreflang = lang;
      l.href = url;
      document.head.appendChild(l);
    }
  }
}

function setMeta(name, content, attr = 'name') {
  if (!content) return;
  let meta = document.querySelector(`meta[${attr}="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attr, name);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

/**
 * Inject JSON-LD structured data
 */
export function setStructuredData(data) {
  let script = document.querySelector('script[data-structured]');
  if (!script) {
    script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-structured', '');
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}
