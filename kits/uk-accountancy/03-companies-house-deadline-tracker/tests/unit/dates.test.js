import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheetDate, addMonths, addDays, daysBetween, isLastDayOfMonth, lastDayOfMonthOf, formatUKDate,
} from '../../src/core/dates.js';

test('parseSheetDate reads ISO, UK, Date and serial values and refuses the rest', () => {
  assert.equal(parseSheetDate('2026-10-05'), '2026-10-05');
  assert.equal(parseSheetDate('5/10/2026'), '2026-10-05');
  assert.equal(parseSheetDate('05.10.2026'), '2026-10-05');
  assert.equal(parseSheetDate(new Date(Date.UTC(2026, 9, 5))), '2026-10-05');
  assert.equal(parseSheetDate(46300), '2026-10-05');
  for (const bad of ['', '  ', null, undefined, 'soon', '31/02/2026', '2026-13-01', '10/05/26', NaN, {}, [], 0, -4]) {
    assert.equal(parseSheetDate(bad), null, `accepted ${String(bad)}`);
  }
});

test('addMonths follows the corresponding-date rule from the accounts guidance', () => {
  // ACCOUNTS 5.1: ARD 4 April + 9 months = 4 January (not 31 January).
  assert.deepEqual(addMonths('2026-04-04', 9, true), { date: '2027-01-04', clamped: false });
  // ACCOUNTS 5.1: ARD 30 April (last day of month) + 9 months = 31 January.
  assert.deepEqual(addMonths('2026-04-30', 9, true), { date: '2027-01-31', clamped: false });
  // The last-day rule is stated for accounting reference dates only.
  assert.deepEqual(addMonths('2026-04-30', 9, false), { date: '2027-01-30', clamped: false });
  assert.deepEqual(addMonths('2026-03-31', 9, true), { date: '2026-12-31', clamped: false });
  assert.deepEqual(addMonths('2026-12-31', 6, true), { date: '2027-06-30', clamped: false });
});

test('addMonths flags a clamp when the corresponding date does not exist', () => {
  assert.deepEqual(addMonths('2026-05-31', 9, false), { date: '2027-02-28', clamped: true });
  assert.deepEqual(addMonths('2027-05-31', 9, false), { date: '2028-02-29', clamped: true });
  assert.deepEqual(addMonths('2024-02-29', 12, false), { date: '2025-02-28', clamped: true });
});

test('addMonths crosses years in both directions and rejects bad input', () => {
  assert.equal(addMonths('2026-11-15', 3, false).date, '2027-02-15');
  assert.equal(addMonths('2026-01-15', -2, false).date, '2025-11-15');
  assert.deepEqual(addMonths('nonsense', 3), { date: null, clamped: false });
  assert.deepEqual(addMonths('2026-01-01', 1.5), { date: null, clamped: false });
  assert.deepEqual(addMonths('2026-01-01', 'x'), { date: null, clamped: false });
});

test('day arithmetic and month ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-10-05', '2026-10-12'), 7);
  assert.equal(daysBetween('2026-10-12', '2026-10-05'), -7);
  assert.equal(daysBetween('2026-10-05', 'bad'), null);
  // Across the clock change: calendar days, not hours.
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(isLastDayOfMonth('2028-02-29'), true);
  assert.equal(isLastDayOfMonth('2027-02-28'), true);
  assert.equal(isLastDayOfMonth('2027-02-27'), false);
  assert.equal(lastDayOfMonthOf('2026-04-06'), '2026-04-30');
});

test('formatUKDate', () => {
  assert.equal(formatUKDate('2026-10-05'), 'Monday 5 October 2026');
  assert.equal(formatUKDate('garbage'), 'garbage');
});
