// Client-side image downscale + recompress, run before any upload.
//
// Keeps both the upload and every visitor's download small without any backend:
// decode the file, draw it onto a canvas capped at `maxDimension` on the long
// edge (never upscaling), and re-encode to WebP — falling back to JPEG where a
// browser can't encode WebP. Anything that isn't a raster image, can't be
// decoded, or wouldn't get smaller passes through unchanged.

const MAX_DIMENSION = 1600;
const QUALITY = 0.85;

export async function compressImage(file, { maxDimension = MAX_DIMENSION, quality = QUALITY } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  // GIFs (often animated) and SVGs don't survive a canvas round-trip — leave them.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

  let source;
  try {
    source = await decode(file);
  } catch {
    return file; // undecodable → upload the original
  }

  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  if (!sw || !sh) return file;

  const scale = Math.min(1, maxDimension / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  source.close?.();

  const blob = await toBlob(canvas, quality);
  // Skip when re-encoding gave no benefit (e.g. an already-tiny image).
  if (!blob || blob.size >= file.size) return file;

  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

function decode(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  // Fallback for browsers without createImageBitmap.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => {
    // Prefer WebP; if the browser can't encode it, toBlob yields null or a PNG —
    // fall back to JPEG, which every canvas can produce.
    canvas.toBlob((webp) => {
      if (webp && webp.type === 'image/webp') return resolve(webp);
      canvas.toBlob((jpeg) => resolve(jpeg), 'image/jpeg', quality);
    }, 'image/webp', quality);
  });
}
