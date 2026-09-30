import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheetDate, daysBetween, addDays, dayOfWeek, isWeekend, sendableDay,
  nextSendableDay, bankHolidayDates, formatUKDate, inQuietPeriod, tsOf,
} from '../../src/core/dates.js';

const HOLS = ['2026-12-25', '2026-12-28', '2027-01-01'];
const cfg = { bankHolidays: HOLS, quietPeriods: [] };

test('parseSheetDate accepts ISO, UK, Date and Sheets serial values', () => {
  assert.equal(parseSheetDate('2026-09-22'), '2026-09-22');
  assert.equal(parseSheetDate(' 22/09/2026 '), '2026-09-22');
  assert.equal(parseSheetDate('5.9.2026'), '2026-09-05');
  assert.equal(parseSheetDate(new Date(Date.UTC(2026, 8, 22))), '2026-09-22');
  assert.equal(parseSheetDate(46287), '2026-09-22'); // Sheets serial: days since 1899-12-30
});

test('parseSheetDate refuses to guess', () => {
  for (const bad of [null, undefined, '', '  ', 'soon', '31/02/2026', '2026-13-01', '2026-02-30', NaN, Infinity, 0, -5, {}, []]) {
    assert.equal(parseSheetDate(bad), null, `${JSON.stringify(bad)}`);
  }
  assert.equal(parseSheetDate(new Date('nope')), null);
});

test('leap days are real only in leap years', () => {
  assert.equal(parseSheetDate('2028-02-29'), '2028-02-29');
  assert.equal(parseSheetDate('2027-02-29'), null);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
});

test('daysBetween is signed, exact across clock changes, and null for bad input', () => {
  assert.equal(daysBetween('2026-09-15', '2026-09-22'), 7);
  assert.equal(daysBetween('2026-09-22', '2026-09-15'), -7);
  // UK clocks go back on 25 October 2026: the day is still exactly one day.
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('nope', '2026-09-22'), null);
  assert.equal(daysBetween('2026-09-22', undefined), null);
});

test('addDays round-trips with daysBetween', () => {
  for (let n = -400; n <= 400; n += 37) {
    assert.equal(daysBetween('2026-09-15', addDays('2026-09-15', n)), n);
  }
  assert.equal(addDays('bad', 3), null);
});

test('weekday arithmetic', () => {
  assert.equal(dayOfWeek('2026-09-15'), 2); // Tuesday
  assert.equal(isWeekend('2026-09-19'), true);
  assert.equal(isWeekend('2026-09-20'), true);
  assert.equal(isWeekend('2026-09-21'), false);
  assert.equal(dayOfWeek('bad'), null);
});

test('sendableDay: weekends, bank holidays, quiet periods and bad dates', () => {
  assert.deepEqual(sendableDay('2026-09-21', cfg), { sendable: true, reason: null });
  assert.equal(sendableDay('2026-09-19', cfg).reason, 'weekend');
  assert.equal(sendableDay('2026-12-28', cfg).reason, 'bank holiday');
  assert.equal(sendableDay('not a date', cfg).sendable, false);
  assert.equal(sendableDay('2026-12-28', { ...cfg, sendOnBankHolidays: true }).sendable, true);
  assert.equal(sendableDay('2026-09-19', { ...cfg, sendOnWeekends: true }).sendable, true);
  assert.equal(sendableDay('2026-12-29', { ...cfg, quietPeriods: [{ from: '12-24', to: '01-01' }] }).reason, 'quiet period');
});

test('quiet periods may wrap the year end', () => {
  const q = [{ from: '12-24', to: '01-01' }];
  for (const d of ['2026-12-24', '2026-12-31', '2027-01-01']) assert.equal(inQuietPeriod(d, q), true, d);
  for (const d of ['2026-12-23', '2027-01-02']) assert.equal(inQuietPeriod(d, q), false, d);
  assert.equal(inQuietPeriod('2026-06-01', undefined), false);
});

test('nextSendableDay skips weekends and bank holidays', () => {
  assert.equal(nextSendableDay('2026-09-18', cfg), '2026-09-21'); // Friday to Monday
  assert.equal(nextSendableDay('2026-09-16', cfg), '2026-09-17');
  // Thursday 24 Dec 2026: 25th and 28th are bank holidays, 26th/27th weekend.
  assert.equal(nextSendableDay('2026-12-24', cfg), '2026-12-29');
});

test('nextSendableDay returns null rather than looping when nothing is sendable', () => {
  assert.equal(nextSendableDay('2026-09-18', { ...cfg, quietPeriods: [{ from: '01-01', to: '12-31' }] }), null);
  assert.equal(nextSendableDay('garbage', cfg), null);
});

test('bankHolidayDates reads the gov.uk feed shape and never throws', () => {
  const data = { 'england-and-wales': { events: [{ date: '2026-12-25' }, { date: 'bad' }, null, { title: 'x' }] } };
  assert.deepEqual(bankHolidayDates(data, 'england-and-wales'), ['2026-12-25']);
  assert.deepEqual(bankHolidayDates(data, 'scotland'), []);
  for (const bad of [null, undefined, 5, 'x', [], {}]) assert.deepEqual(bankHolidayDates(bad, 'england-and-wales'), []);
});

test('formatUKDate reads the way a UK client expects', () => {
  assert.equal(formatUKDate('2026-09-22'), 'Tuesday 22 September 2026');
  assert.equal(formatUKDate('junk'), 'junk');
  assert.equal(tsOf('2026-09-22') !== null, true);
});
