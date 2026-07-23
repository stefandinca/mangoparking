// Unit tests for the ParkVia (ParkCloud) import mapper — the one piece of the
// scaffold with real logic. Run: `cd functions && npm test`.
//
// The fixture mirrors the REAL ParkCloud Operator API <Booking> schema,
// captured live on 2026-07-23 from GET /operator/{id}/booking/{reference}
// (see documentation/parkvia-response.txt, gitignored, for raw copies):
// namespaced <Vehicle> children (d2p1:Registration), i:nil empties, naive
// local wall-time dates, AmountPaid/AmountDue, Passengers(+Child/Infant).
// These assertions pin the mapping contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapParkviaBookingToImport,
  parseParkviaXml,
  normalizeStatus,
  xmlText,
  parkcloudLocalToIso,
  deriveDays,
  parkviaRefDocId,
} from '../src/parkvia.js';

const SAMPLE_XML = `
<Booking xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://parkcloud.net/operator">
  <Reference>PC90288686</Reference>
  <Status>CONFIRMED</Status>
  <AmountPaid>90</AmountPaid>
  <AmountDue>0</AmountDue>
  <Currency>RON</Currency>
  <BookingDate>2026-07-09T07:17:31.317</BookingDate>
  <ArrivalDate>2026-07-20T11:00:00</ArrivalDate>
  <DepartureDate>2026-07-23T16:15:00</DepartureDate>
  <LanguageCode>RO</LanguageCode>
  <Customer>
    <Title></Title>
    <FirstName>Ion</FirstName>
    <Surname>Popescu</Surname>
    <Address></Address><Town></Town><County></County><Postcode></Postcode>
    <Mobile>720000111</Mobile>
    <Email>Ion.Popescu@example.com</Email>
  </Customer>
  <Vehicle xmlns:d2p1="http://parkcloud.net">
    <d2p1:Registration>b 63-30 tt</d2p1:Registration>
    <d2p1:Make i:nil="true" />
    <d2p1:Model i:nil="true" />
    <d2p1:Colour i:nil="true" />
  </Vehicle>
  <Passengers>2</Passengers>
  <PassengersChild>1</PassengersChild>
  <PassengersInfant>0</PassengersInfant>
  <Options><Option><Quantity>1</Quantity><Description>Parcare</Description></Option></Options>
  <OutboundTerminal i:nil="true" />
  <OutboundFlight i:nil="true" />
  <ReturningFrom i:nil="true" />
  <ReturnTerminal i:nil="true" />
  <ReturnFlight i:nil="true" />
  <SpecialRequests i:nil="true" />
  <IsNoShow>false</IsNoShow>
</Booking>`;

test('maps a real-shaped ParkCloud booking to import params', async () => {
  const parsed = await parseParkviaXml(SAMPLE_XML);
  const imp = mapParkviaBookingToImport(parsed.Booking);

  assert.equal(imp.ref, 'PC90288686');
  assert.equal(imp.plate, 'B6330TT', 'plate from the namespaced Vehicle node, upper-cased, spaces/hyphens stripped');
  // ArrivalDate 2026-07-20T11:00 is Bucharest wall-time; July = EEST (+03:00).
  assert.equal(imp.dropoffAt, '2026-07-20T08:00:00.000Z');
  assert.equal(imp.pickupAt, '2026-07-23T13:15:00.000Z');
  assert.equal(imp.totalPrice, 90, 'AmountPaid + AmountDue');
  assert.equal(imp.amountDue, 0);
  assert.equal(imp.currency, 'RON');
  assert.equal(imp.passengers, 3, 'adults + children + infants');
  assert.equal(imp.flightNumberDropoff, null, 'i:nil OutboundFlight → null, not "[object Object]"');
  assert.equal(imp.flightNumberPickup, null);
  assert.equal(imp.brokerName, 'ParkVia');
  assert.equal(imp.rawStatus, 'active');
  assert.deepEqual(imp.contact, {
    name: 'Ion Popescu',
    email: 'ion.popescu@example.com',   // lower-cased
    phone: '720000111',
  });
  // 3d 5h15 span, 2h grace applied once → ceil ≈ 4 billing days.
  assert.equal(imp.days, 4);
});

test('pay-on-arrival: AmountDue folds into totalPrice and is surfaced', async () => {
  const xml = SAMPLE_XML
    .replace('<AmountPaid>90</AmountPaid>', '<AmountPaid>0</AmountPaid>')
    .replace('<AmountDue>0</AmountDue>', '<AmountDue>150</AmountDue>');
  const imp = mapParkviaBookingToImport((await parseParkviaXml(xml)).Booking);
  assert.equal(imp.totalPrice, 150);
  assert.equal(imp.amountDue, 150);
});

test('flight numbers map through when present', async () => {
  const xml = SAMPLE_XML
    .replace('<OutboundFlight i:nil="true" />', '<OutboundFlight>RO301</OutboundFlight>')
    .replace('<ReturnFlight i:nil="true" />', '<ReturnFlight>RO302</ReturnFlight>');
  const imp = mapParkviaBookingToImport((await parseParkviaXml(xml)).Booking);
  assert.equal(imp.flightNumberDropoff, 'RO301');
  assert.equal(imp.flightNumberPickup, 'RO302');
});

test('status enum: CONFIRMED / CANCELLED / ENQUIRY', async () => {
  assert.equal(normalizeStatus('CONFIRMED'), 'active');
  assert.equal(normalizeStatus('CANCELLED'), 'cancelled');
  assert.equal(normalizeStatus('ENQUIRY'), 'enquiry');
  assert.equal(normalizeStatus(''), 'active', 'default-safe');
  const xml = SAMPLE_XML.replace('<Status>CONFIRMED</Status>', '<Status>CANCELLED</Status>');
  const imp = mapParkviaBookingToImport((await parseParkviaXml(xml)).Booking);
  assert.equal(imp.rawStatus, 'cancelled');
});

test('throws on missing reference / plate / dates', async () => {
  assert.throws(() => mapParkviaBookingToImport({}), /reference/);
  assert.throws(
    () => mapParkviaBookingToImport({ Reference: 'PC1', ArrivalDate: '2026-08-01T06:00:00', DepartureDate: '2026-08-02T06:00:00' }),
    /plate/,
  );
  assert.throws(
    () => mapParkviaBookingToImport({ Reference: 'PC1', Vehicle: { Registration: 'B1XYZ' } }),
    /dates/,
  );
});

test('xmlText: strings, empty elements, and i:nil objects', () => {
  assert.equal(xmlText('  x  '), 'x');
  assert.equal(xmlText(''), '');
  assert.equal(xmlText(null), '');
  assert.equal(xmlText({ $: { nil: 'true' } }), '', 'i:nil="true" → empty, never "[object Object]"');
  assert.equal(xmlText({ _: 'inner', $: { attr: 'v' } }), 'inner');
});

test('parkcloudLocalToIso: Bucharest wall-time → instant, DST-aware', () => {
  assert.equal(parkcloudLocalToIso('2026-07-20T11:00:00'), '2026-07-20T08:00:00.000Z', 'summer = EEST +03:00');
  assert.equal(parkcloudLocalToIso('2026-01-15T10:00:00'), '2026-01-15T08:00:00.000Z', 'winter = EET +02:00');
  assert.equal(parkcloudLocalToIso('2026-07-03T14:00:06.757'), '2026-07-03T11:00:06.000Z', 'fractional seconds tolerated');
  assert.equal(parkcloudLocalToIso(''), '');
  assert.equal(parkcloudLocalToIso('not-a-date'), '');
});

test('deriveDays: 2h grace applied once, minimum 1', () => {
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-02T09:00:00Z'), 1, '25h → 1 day (within 24h+grace)');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-02T10:00:00Z'), 1, '26h → exactly 1 day');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-02T12:00:00Z'), 2, '28h → 2 days');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-03T10:00:00Z'), 2, '50h → 2 days');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-01T09:00:00Z'), 1, 'sub-day → 1');
  assert.equal(deriveDays('bad', 'worse'), 1, 'unparseable → 1');
});

test('parses an ArrayOfEvent envelope the way listParkviaEvents expects', async () => {
  const xml = `
<ArrayOfEvent xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://parkcloud.net/operator">
  <Event><Id>34407328</Id><Date>2026-07-03T14:00:06.757</Date><Type>NEW</Type><BookingReference>PC90243780</BookingReference></Event>
  <Event><Id>34408087</Id><Date>2026-07-03T14:42:43.947</Date><Type>CANCEL</Type><BookingReference>PC90244034</BookingReference></Event>
</ArrayOfEvent>`;
  const parsed = await parseParkviaXml(xml);
  const node = parsed.ArrayOfEvent.Event;
  assert.equal(Array.isArray(node), true);
  assert.equal(xmlText(node[0].Id), '34407328');
  assert.equal(xmlText(node[1].Type), 'CANCEL');
  // Single-event envelope collapses to a plain object (explicitArray:false).
  const one = await parseParkviaXml(xml.replace(/<Event><Id>34408087[\s\S]*?<\/Event>/, ''));
  assert.equal(Array.isArray(one.ArrayOfEvent.Event), false);
});

test('parkviaRefDocId strips Firestore-illegal characters', () => {
  assert.equal(parkviaRefDocId('PV/100/245'), 'PV_100_245');
  assert.equal(parkviaRefDocId('a.b#c$d[e]'), 'a_b_c_d_e_');
});
