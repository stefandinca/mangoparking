// Unit tests for the ParkVia poll-window sizing — the overlap that protects
// the sync from ParkCloud's late/out-of-id-order event publication (the
// 2026-07-29 PC90417080 incident). Run: `cd functions && npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parkviaWindowHours,
  PARKVIA_LOOKBACK_HOURS,
  PARKVIA_FEED_MAX_HOURS,
} from '../src/parkvia.js';

const NOW = Date.parse('2026-07-29T08:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test('normal cadence (synced minutes ago) → the rolling lookback', () => {
  assert.equal(parkviaWindowHours(hoursAgo(0.25), NOW), PARKVIA_LOOKBACK_HOURS);
});

test('downtime shorter than the lookback still returns the lookback', () => {
  assert.equal(parkviaWindowHours(hoursAgo(30), NOW), PARKVIA_LOOKBACK_HOURS);
});

test('downtime beyond the lookback stretches the window by the gap + a day of margin', () => {
  assert.equal(parkviaWindowHours(hoursAgo(100), NOW), 124);
});

test('very long downtime is capped at the feed maximum', () => {
  assert.equal(parkviaWindowHours(hoursAgo(10_000), NOW), PARKVIA_FEED_MAX_HOURS);
});

test('missing or unparsable lastSyncAt asks for everything the feed has', () => {
  assert.equal(parkviaWindowHours(null, NOW), PARKVIA_FEED_MAX_HOURS);
  assert.equal(parkviaWindowHours('', NOW), PARKVIA_FEED_MAX_HOURS);
  assert.equal(parkviaWindowHours('not-a-date', NOW), PARKVIA_FEED_MAX_HOURS);
});

test('a clock skew putting lastSyncAt in the future never shrinks below the lookback', () => {
  assert.equal(parkviaWindowHours(hoursAgo(-2), NOW), PARKVIA_LOOKBACK_HOURS);
});
