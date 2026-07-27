// auditFormat: the DOM-free helpers behind the dashboard feed, /admin/audit
// and the reservation-detail history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shiftDay, bucharestToday, windowToIso, isActorRow,
  actionLabel, describeAction, ACTOR_STAT_TILES, countActions,
} from '../src/components/admin/auditFormat.js';
import { bucharestLocalToIso } from '../src/utils/date.js';

test('shiftDay: month boundaries and DST days stay stable', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2026-10-25', 1), '2026-10-26'); // fall-back day, noon-anchored
  assert.equal(shiftDay('2026-03-29', -1), '2026-03-28'); // spring-forward day
});

test('bucharestToday: the lot day, not the device/UTC day', () => {
  // 22:30 UTC in winter = 00:30 next day in Bucharest (+02).
  assert.equal(bucharestToday(new Date('2026-01-15T22:30:00Z')), '2026-01-16');
  // 20:59 UTC in summer = 23:59 same day (+03).
  assert.equal(bucharestToday(new Date('2026-07-27T20:59:00Z')), '2026-07-27');
});

test('windowToIso: presets and custom ranges bound Bucharest calendar days', () => {
  const now = new Date('2026-07-15T12:00:00Z');
  const today = windowToIso('today', bucharestLocalToIso, now);
  assert.equal(today.fromDay, '2026-07-15');
  assert.equal(today.toDay, '2026-07-15');
  assert.equal(today.fromIso, '2026-07-14T21:00:00.000Z'); // 00:00 Bucharest (+03)
  assert.equal(today.toIso, '2026-07-15T20:59:59.000Z');   // 23:59:59 Bucharest

  const week = windowToIso('7d', bucharestLocalToIso, now);
  assert.equal(week.fromDay, '2026-07-09'); // 6 days back, today inclusive

  const custom = windowToIso(['2026-01-01', '2026-01-31'], bucharestLocalToIso, now);
  assert.equal(custom.fromDay, '2026-01-01');
  assert.equal(custom.toDay, '2026-01-31');
});

test('isActorRow: matches on actorUid or case-insensitive email', () => {
  assert.ok(isActorRow({ actorUid: 'u1' }, { uid: 'u1' }));
  assert.ok(isActorRow({ user: 'Ana@Mango.ro' }, { email: 'ana@mango.ro' }));
  assert.ok(!isActorRow({ actorUid: 'u2', user: 'x@y.ro' }, { uid: 'u1', email: 'a@b.ro' }));
  assert.ok(!isActorRow(null, { uid: 'u1' }));
});

test('countActions counts only the listed action names', () => {
  const rows = [{ action: 'booking_checkin' }, { action: 'check_in' }, { action: 'booking_checkout' }];
  const tile = ACTOR_STAT_TILES.find((t) => t.key === 'checkins');
  assert.equal(countActions(rows, tile.actions), 2);
});

test('actionLabel: underscores become spaces', () => {
  assert.equal(actionLabel('booking_no_show'), 'booking no show');
  assert.equal(actionLabel(null), '');
});

test('describeAction: booking reference prefers entityCode > payload code > id fragment', () => {
  const row = { action: 'booking_checkout', entityId: 'aTUFw5tp9xyz', newValueObj: {} };
  assert.ok(describeAction(row, 'ro', 'LT-BW7XN').includes('LT-BW7XN'));
  assert.ok(!describeAction(row, 'ro', 'LT-BW7XN').includes('aTUFw5tp'));

  const withCode = { ...row, newValueObj: { code: 'LT-AAAAA' } };
  assert.ok(describeAction(withCode, 'ro').includes('LT-AAAAA'));

  assert.ok(describeAction(row, 'ro').includes('aTUFw5tp')); // last resort only
});

test('describeAction: booking_edited names the changed fields, skips updatedAt', () => {
  const row = {
    action: 'booking_edited',
    entityId: 'x',
    newValueObj: { contact: {}, licensePlate: 'B1ABC', updatedAt: 'x' },
  };
  const ro = describeAction(row, 'ro');
  assert.ok(ro.includes('contact'));
  assert.ok(ro.includes('număr'));
  assert.ok(!ro.includes('updatedAt'));
  const en = describeAction(row, 'en');
  assert.ok(en.includes('plate'));
});
