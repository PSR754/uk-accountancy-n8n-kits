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

// --- Calendar months and the short date ---------------------------------------

import { addCalendarMonths, isMonthEnd, lastDayOfMonth, formatUKDateShort } from '../../src/core/dates.js';

test('lastDayOfMonth knows every month and leap years', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => lastDayOfMonth(2026, m)),
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.equal(lastDayOfMonth(2028, 2), 29);
  assert.equal(lastDayOfMonth(2100, 2), 28);
  assert.equal(lastDayOfMonth(2000, 2), 29);
});

test('isMonthEnd', () => {
  for (const d of ['2026-01-31', '2026-02-28', '2028-02-29', '2026-04-30', '2026-12-31']) assert.equal(isMonthEnd(d), true, d);
  for (const d of ['2026-02-27', '2028-02-28', '2026-04-29', 'junk', null, '']) assert.equal(isMonthEnd(d), false, String(d));
});

test('addCalendarMonths clamps to the end of a shorter month', () => {
  assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addCalendarMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addCalendarMonths('2026-01-30', 1), '2026-02-28');
  assert.equal(addCalendarMonths('2026-03-31', 1), '2026-04-30');
  assert.equal(addCalendarMonths('2026-08-15', 1), '2026-09-15');
});

test('addCalendarMonths crosses year ends in both directions', () => {
  assert.equal(addCalendarMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addCalendarMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addCalendarMonths('2026-01-15', -1), '2025-12-15');
  assert.equal(addCalendarMonths('2026-01-15', 24), '2028-01-15');
  assert.equal(addCalendarMonths('2026-01-15', 0), '2026-01-15');
});

test('keepMonthEnd moves a month-end date to the end of the target month', () => {
  assert.equal(addCalendarMonths('2026-04-30', 1, true), '2026-05-31');
  assert.equal(addCalendarMonths('2026-04-30', 1, false), '2026-05-30');
  assert.equal(addCalendarMonths('2026-02-28', 1, true), '2026-03-31');
  assert.equal(addCalendarMonths('2028-02-29', 1, true), '2028-03-31');
  assert.equal(addCalendarMonths('2026-01-31', 1, true), '2026-02-28');
  // Not a month end: unaffected by the flag.
  assert.equal(addCalendarMonths('2026-04-29', 1, true), '2026-05-29');
});

test('addCalendarMonths is null, never an exception, for bad input', () => {
  for (const bad of [null, undefined, '', 'x', '2026-02-30', 5, {}]) assert.equal(addCalendarMonths(bad, 1), null, String(bad));
  for (const m of [1.5, NaN, '1', null, undefined]) assert.equal(addCalendarMonths('2026-01-15', m), null, String(m));
});

test('EXHAUSTIVE: adding months never changes the day number except by clamping, over 40 years', () => {
  for (let ts = Date.UTC(1999, 0, 1); ts <= Date.UTC(2040, 0, 1); ts += 86400000 * 3) {
    const iso = new Date(ts).toISOString().slice(0, 10);
    for (const months of [1, 2, 12]) {
      const out = addCalendarMonths(iso, months);
      assert.notEqual(out, null, iso);
      const [y, m, d] = iso.split('-').map(Number);
      const [oy, om, od] = out.split('-').map(Number);
      assert.equal(oy * 12 + om, y * 12 + m + months, `${iso} + ${months}`);
      assert.equal(od, Math.min(d, lastDayOfMonth(oy, om)), `${iso} + ${months}`);
    }
  }
});

test('formatUKDateShort has no weekday', () => {
  assert.equal(formatUKDateShort('2026-06-30'), '30 June 2026');
  assert.equal(formatUKDateShort('junk'), 'junk');
});

test('addDays refuses a non-numeric count instead of producing NaN dates', () => {
  for (const bad of [NaN, undefined, 'x', Infinity]) assert.equal(addDays('2026-09-15', bad), null, String(bad));
});
