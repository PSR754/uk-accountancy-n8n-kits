import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheetDate, daysBetween, addDays, isWeekend, sendableDay, formatUKDate, utcFromParts,
} from '../../src/core/dates.js';
import holidays from '../../rules/bank-holidays.json' with { type: 'json' };

test('parses ISO dates', () => {
  assert.equal(parseSheetDate('2026-09-15'), '2026-09-15');
  assert.equal(parseSheetDate(' 2026-01-01 '), '2026-01-01');
});

test('parses UK dd/mm/yyyy without the American ambiguity', () => {
  // The shipped kit used new Date(string), which reads this as 9 May.
  assert.equal(parseSheetDate('05/09/2026'), '2026-09-05');
  assert.equal(parseSheetDate('15/09/2026'), '2026-09-15');
  assert.equal(parseSheetDate('1/2/2026'), '2026-02-01');
  assert.equal(parseSheetDate('05-09-2026'), '2026-09-05');
});

test('rejects impossible dates instead of rolling them forward', () => {
  assert.equal(parseSheetDate('31/02/2026'), null);
  assert.equal(parseSheetDate('2026-02-30'), null);
  assert.equal(parseSheetDate('2026-13-01'), null);
  assert.equal(utcFromParts(2026, 2, 30), null);
});

test('accepts leap days only in leap years', () => {
  assert.equal(parseSheetDate('2028-02-29'), '2028-02-29');
  assert.equal(parseSheetDate('2026-02-29'), null);
});

test('parses Google Sheets serial numbers', () => {
  // Anchored on a known pair: serial 44197 is 1 January 2021.
  assert.equal(parseSheetDate(44197), '2021-01-01');
  assert.equal(parseSheetDate(46280), '2026-09-15');
  assert.equal(parseSheetDate(0), null);
});

test('returns null for unusable values rather than guessing', () => {
  for (const v of ['', '   ', null, undefined, 'next Tuesday', 'N/A', {}, NaN]) {
    assert.equal(parseSheetDate(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test('day arithmetic is exact across month and year ends', () => {
  assert.equal(daysBetween('2026-09-05', '2026-09-15'), 10);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(daysBetween('2026-09-15', '2026-09-05'), -10);
  assert.equal(daysBetween('2026-09-15', '2026-09-15'), 0);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('day arithmetic is unaffected by British Summer Time', () => {
  // 29 March 2026 is the BST transition. Local-time arithmetic loses an hour
  // here, which is how off-by-one day bugs appear in date-only logic.
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
});

test('identifies weekends', () => {
  assert.equal(isWeekend('2026-09-19'), true);  // Saturday
  assert.equal(isWeekend('2026-09-20'), true);  // Sunday
  assert.equal(isWeekend('2026-09-21'), false); // Monday
});

test('will not send on weekends, bank holidays or the quiet period', () => {
  const config = {
    bankHolidays: holidays, sendOnWeekends: false, sendOnBankHolidays: false,
    quietPeriods: [{ from: '12-24', to: '01-01' }],
  };
  assert.deepEqual(sendableDay('2026-09-15', config), { sendable: true, reason: null });
  assert.equal(sendableDay('2026-09-19', config).reason, 'weekend');
  assert.equal(sendableDay('2026-12-25', config).reason, 'bank holiday');
  assert.equal(sendableDay('2026-12-29', config).reason, 'quiet period');
  assert.equal(sendableDay('2027-01-01', config).reason, 'bank holiday');
});

test('quiet period wrapping the year end covers both sides', () => {
  const config = { bankHolidays: [], quietPeriods: [{ from: '12-24', to: '01-02' }] };
  assert.equal(sendableDay('2026-12-24', config).sendable, false);
  assert.equal(sendableDay('2027-01-02', config).sendable, false);
  assert.equal(sendableDay('2027-01-05', config).sendable, true);
});

test('formats dates the way a UK client reads them', () => {
  assert.equal(formatUKDate('2026-10-14'), 'Wednesday 14 October 2026');
  assert.equal(formatUKDate('2026-01-01'), 'Thursday 1 January 2026');
});

test('every bank holiday in the table is a real date and none fall on a weekend', () => {
  for (const h of holidays) {
    assert.equal(parseSheetDate(h), h, `${h} is not a valid date`);
    assert.equal(isWeekend(h), false, `${h} falls on a weekend, which no UK bank holiday does`);
  }
});
