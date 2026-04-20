# /public/images — asset manifest

All files required for Netopia/ANPC compliance are now in place.

## Files

| File             | Purpose                                                                  |
|------------------|--------------------------------------------------------------------------|
| `logo.png`       | Mascot — navbar, footer, auth pages, favicon, hero                       |
| `logo-full.jpeg` | Wordmark+mascot — reserved for hero / press use                          |
| `sal.png`        | Footer ANPC alternative dispute resolution banner (links to anpc.ro)     |
| `sol.png`        | Footer ANPC online dispute resolution banner (links to ec.europa.eu/odr) |

The Netopia logo is **not** a static file — it's loaded via Netopia's
own hosted iframe (`https://mny.ro/npId.html?...&secret=163420`), so no
local asset is needed.

## Notes

- Do **not** hotlink ANPC or Netopia logos from their servers — download
  the files and self-host (already done for SAL/SOL via the SVGs above).
- Keep any additional images small (< 100 KB); prefer SVG over raster.
