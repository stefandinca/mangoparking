// Europe/Bucharest time rules shared by the broker importers.
//
// Both feeds — ParkVia (ParkCloud) and Parkos — hand us naive wall-clock
// datetimes in the car park's own zone and expect us to bill the same number of
// days the rest of the app bills. Keeping the two rules here means the two
// adapters cannot drift apart (and a DST fix lands in one place).
//
// Pure, no I/O. Covered by functions/test/parkvia.mapper.test.js and
// functions/test/parkos.mapper.test.js.

// Minutes east of UTC for Europe/Bucharest AT A GIVEN INSTANT — +120 (EET) in
// winter, +180 (EEST) in summer. Resolved through Intl so the DST boundary is
// the real one rather than a hard-coded March/October guess.
export function bucharestOffsetMin(date) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Bucharest', timeZoneName: 'longOffset' })
      .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch { /* fall through to the fixed default */ }
  return 180;   // +03:00 — the summer (EEST) offset, right for peak season
}

// Billing-days: ceil of the span, 2h grace applied once, min 1 — mirrors the
// billing-days rule used across the app (see documentation/features/
// long-term-bookings.md).
export function deriveDays(dropoffIso, pickupIso) {
  const a = Date.parse(dropoffIso);
  const b = Date.parse(pickupIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  const GRACE_MS = 2 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((b - a - GRACE_MS) / (24 * 60 * 60 * 1000)));
}

// "yyyy-MM-dd" + "HH:mm(:ss)" of Bucharest wall-time → a real ISO instant.
// Both feeds send the two halves in some form; ParkCloud as one string, Parkos
// as separate date/time fields.
export function bucharestWallToIso(dateStr, timeStr = '00:00') {
  const d = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const t = String(timeStr || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!d) return '';
  const [, y, mo, da] = d;
  const [, h = '0', mi = '0', se = '0'] = t || [];
  const wallAsUtc = Date.UTC(+y, +mo - 1, +da, +h, +mi, +se);
  if (!Number.isFinite(wallAsUtc)) return '';
  return new Date(wallAsUtc - bucharestOffsetMin(new Date(wallAsUtc)) * 60_000).toISOString();
}

// The Bucharest calendar day ("yyyy-MM-dd") an instant falls on. Used to match
// an imported reservation against a booking staff already typed by hand, where
// only the arrival DAY is reliably the same (the desk rounds times).
export function bucharestDayKey(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const local = new Date(ms + bucharestOffsetMin(new Date(ms)) * 60_000);
  return local.toISOString().slice(0, 10);
}
