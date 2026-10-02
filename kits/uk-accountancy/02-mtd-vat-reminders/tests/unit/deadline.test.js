import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { vatReturnDeadline, classifyScheme, deadlineFallsOn, rulesAge } from '../../src/core/deadline.js';
import { addDays, daysBetween, tsOf, bankHolidayDates, isMonthEnd } from '../../src/core/dates.js';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = JSON.parse(readFileSync(join(KIT, 'rules', 'vat-rules.json'), 'utf8'));
const due = (end, r = rules) => vatReturnDeadline(end, r);

// The expected values below are worked from the gov.uk rule "one calendar month
// and 7 days after the end of the accounting period": a month-end period ends on
// the 7th of the month after next, any other period end moves on a calendar month
// and then seven days. See rules/RULES.md for the sources and for which parts of
// this convention are not stated on gov.uk and need a person to confirm.

test('standard quarters: the 7th of the month after next', () => {
  for (const [end, expected] of [
    ['2026-03-31', '2026-05-07'], ['2026-06-30', '2026-08-07'],
    ['2026-09-30', '2026-11-07'], ['2026-12-31', '2027-02-07'],
    ['2026-01-31', '2026-03-07'], ['2026-04-30', '2026-06-07'],
    ['2026-07-31', '2026-09-07'], ['2026-10-31', '2026-12-07'],
    ['2026-02-28', '2026-04-07'], ['2026-05-31', '2026-07-07'],
    ['2026-08-31', '2026-10-07'], ['2026-11-30', '2027-01-07'],
  ]) {
    assert.deepEqual(due(end), { ok: true, dueDate: expected }, end);
  }
});

test('leap years: 29 February is a month end', () => {
  assert.equal(due('2028-02-29').dueDate, '2028-04-07');
  assert.equal(due('2028-01-31').dueDate, '2028-03-07');
});

test('a period that does not end on the last day of a month is NOT calculated: the HMRC date is required', () => {
  // Regulation 25(1) gives the last day of the next month, not the same day, so a
  // same-day-next-month rule would be wrong. gov.uk states no rule for these.
  for (const end of ['2026-08-29', '2026-01-15', '2026-12-15', '2026-01-30', '2026-01-29', '2028-02-28', '2026-06-29']) {
    const r = due(end);
    assert.equal(r.ok, false, end);
    assert.equal(r.manual, true, end);
    assert.match(r.reason, /not the last day of a month/);
    assert.equal(r.dueDate, undefined, 'no date may be offered');
  }
});

test('the deadline is NOT moved for a weekend or a bank holiday', () => {
  // 30 September 2026 gives Saturday 7 November. gov.uk: the return and payment
  // must be in "even if it's on a weekend or bank holiday".
  assert.equal(due('2026-09-30').dueDate, '2026-11-07');
  assert.equal(deadlineFallsOn('2026-11-07', []), 'weekend');
  // 18 November 2026 gives Christmas Day, a bank holiday.
  const hols = bankHolidayDates(JSON.parse(readFileSync(join(KIT, 'rules', 'bank-holidays.json'), 'utf8')), 'england-and-wales');
  assert.equal(deadlineFallsOn('2026-12-25', hols), 'bank holiday');
  assert.equal(deadlineFallsOn('2026-08-07', hols), null);
  assert.equal(deadlineFallsOn('junk', hols), null);
  assert.equal(deadlineFallsOn('2026-12-25', undefined), null);
});

test('EXHAUSTIVE: every period end from 2020 to 2035 is either an independent month-end result or refused', () => {
  let calculated = 0;
  let refused = 0;
  for (let ts = Date.UTC(2020, 0, 1); ts <= Date.UTC(2035, 11, 31); ts += 86400000) {
    const d = new Date(ts);
    const iso = d.toISOString().slice(0, 10);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth(); // 0-based
    const isLast = d.getUTCDate() === new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const r = due(iso);
    if (isLast) {
      // the 7th of the month after next, worked independently of the code under test
      assert.deepEqual(r, { ok: true, dueDate: new Date(Date.UTC(y, m + 2, 7)).toISOString().slice(0, 10) }, iso);
      calculated += 1;
    } else {
      assert.equal(r.ok, false, iso);
      assert.equal(r.manual, true, iso);
      refused += 1;
    }
  }
  assert.ok(calculated > 180 && refused > 5000);
});

test('EXHAUSTIVE: a calculated deadline is always 35 to 38 days after the period end, and never goes backwards', () => {
  let previous = null;
  for (let ts = Date.UTC(2024, 0, 1); ts <= Date.UTC(2030, 11, 31); ts += 86400000) {
    const iso = new Date(ts).toISOString().slice(0, 10);
    const r = due(iso);
    if (!r.ok) continue;
    const gap = daysBetween(iso, r.dueDate);
    assert.ok(gap >= 35 && gap <= 38, `${iso}: ${gap} days`);
    if (previous !== null) assert.ok(r.dueDate >= previous, `${iso} deadline went backwards`);
    previous = r.dueDate;
  }
});

test('THE RULE IS DATA: changing rules/vat-rules.json changes the answer, with no code change', () => {
  const clone = (patch) => ({ ...rules, returnDeadline: { ...rules.returnDeadline, ...patch } });
  assert.equal(due('2026-06-30', clone({ daysAfterThat: 0 })).dueDate, '2026-07-31');
  assert.equal(due('2026-06-30', clone({ calendarMonthsAfterPeriodEnd: 2 })).dueDate, '2026-09-07');
  assert.equal(due('2026-06-30', clone({ calendarMonthsAfterPeriodEnd: 0, daysAfterThat: 14 })).dueDate, '2026-07-14');
  // Switching the month-end-only rule off is a data change too: other period ends are then calculated.
  assert.equal(due('2026-06-29', clone({ onlyMonthEndPeriodsCalculated: false })).dueDate, '2026-08-05');
  assert.equal(due('2026-06-29').ok, false);
});

test('the shipped rule is one calendar month and seven days', () => {
  assert.equal(rules.returnDeadline.calendarMonthsAfterPeriodEnd, 1);
  assert.equal(rules.returnDeadline.daysAfterThat, 7);
});

test('a damaged or missing rule is a flagged result, never an exception', () => {
  for (const bad of [undefined, null, {}, [], 5, 'x', { returnDeadline: null }, { returnDeadline: {} },
    { returnDeadline: { calendarMonthsAfterPeriodEnd: 'one', daysAfterThat: 7 } },
    { returnDeadline: { calendarMonthsAfterPeriodEnd: 1, daysAfterThat: -7 } },
    { returnDeadline: { calendarMonthsAfterPeriodEnd: 1.5, daysAfterThat: 7 } },
    { returnDeadline: { calendarMonthsAfterPeriodEnd: 1, daysAfterThat: 1e9 } }]) {
    const r = vatReturnDeadline('2026-06-30', bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.reason, /rule/);
  }
});

test('a bad period end is a flagged result, never an exception', () => {
  for (const bad of [null, undefined, '', 'x', '2026-02-30', '31/12/2026', 46000, {}, []]) {
    const r = due(bad);
    assert.equal(r.ok, false, String(bad));
    assert.match(r.reason, /not a real date/);
  }
});

test('classifyScheme: standard words, the unsupported scheme, and anything else', () => {
  for (const ok of ['', '  ', 'Standard', 'FLAT RATE', 'flat  rate', 'Cash Accounting', 'quarterly', 'monthly', 'stagger', undefined, null]) {
    assert.equal(classifyScheme(ok, rules).kind, 'standard', String(ok));
  }
  assert.equal(classifyScheme('Annual Accounting', rules).kind, 'unsupported');
  assert.equal(classifyScheme(' annual   accounting ', rules).kind, 'unsupported');
  for (const odd of ['mystery', 'AAS', 'annual', 5]) assert.equal(classifyScheme(odd, rules).kind, 'unknown', String(odd));
  // Without a rules file everything but blank is unknown, and nothing throws.
  for (const bad of [undefined, null, {}, 5]) assert.doesNotThrow(() => classifyScheme('x', bad));
  assert.equal(classifyScheme('', undefined).kind, 'standard');
});

test('rulesAge reports staleness from the recorded date', () => {
  const r = { validAsOf: '2026-10-02', reviewWithinDays: 365 };
  assert.deepEqual(rulesAge('2026-10-02', r), { validAsOf: '2026-10-02', ageDays: 0, stale: false });
  assert.equal(rulesAge('2027-10-02', r).stale, false);
  assert.equal(rulesAge('2027-10-03', r).stale, true);
  assert.equal(rulesAge('2026-10-02', {}).stale, true, 'no date recorded counts as stale');
  assert.equal(rulesAge('junk', r).stale, true);
  for (const bad of [undefined, null, 5]) assert.doesNotThrow(() => rulesAge('2026-10-02', bad));
});

test('the shipped rules file is not stale on the day it was written', () => {
  assert.equal(rulesAge(rules.validAsOf, rules).stale, false);
});
