# /public/images — asset manifest

Drop the files listed below into this directory before going live.
Missing files degrade gracefully (images hide, text labels remain), but the
site is **not Netopia- or ANPC-compliant** until they are present.

## Required for launch

| File                   | Purpose                                                     | Source                                                                                      |
|------------------------|-------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| `netopia-logo.svg`     | Footer "Secure payments" — required by Netopia merchant T&Cs| Netopia merchant portal → brand assets                                                      |
| `anpc-sal.png`         | Footer ANPC alternative dispute resolution banner           | https://anpc.ro/ro/solutionarea-alternativa-a-litigiilor-sal/ (download official banner)    |
| `anpc-sol.png`         | Footer ANPC online dispute resolution banner                | https://anpc.ro/ro/solutionarea-online-a-litigiilor-sol/ (download official banner)         |

## Already present

| File              | Purpose                                                |
|-------------------|--------------------------------------------------------|
| `logo.png`        | Mascot — navbar, footer, auth pages, favicon, hero     |
| `logo-full.jpeg`  | Wordmark+mascot — reserved for hero / press use        |

## Notes

- Footer image tags use `onerror="this.style.display='none'"` so a missing
  file is hidden and the sibling text label remains readable.
- Do **not** hotlink ANPC or Netopia logos from their servers — download
  the files and self-host.
- If you add additional images, keep them small (< 100 KB) and serve as SVG
  where possible.
