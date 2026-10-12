import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bankHolidayDates, isWeekend, tsOf, daysBetween } from '../../src/core/dates.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'rules', 'bank-holidays.json');
const data = JSON.parse(readFileSync(FILE, 'utf8'));
const DIVISIONS = ['england-and-wales', 'scotland', 'northern-ireland'];

// rules/bank-holidays.json is the gov.uk feed, unmodified. These tests check
// that it is still the shape the code reads and that it is internally sane.
// They cannot prove it matches gov.uk today: re-download and compare, see
// rules/RULES.md.

test('the file has the three gov.uk divisions, each with dated events', () => {
  assert.deepEqual(Object.keys(data).sort(), [...DIVISIONS].sort());
  for (const d of DIVISIONS) {
    assert.equal(data[d].division, d);
    assert.ok(data[d].events.length > 50, d);
    for (const e of data[d].events) {
      assert.equal(typeof e.title, 'string');
      assert.notEqual(tsOf(e.date), null, `${d}: ${e.date} is not a real date`);
    }
  }
});

test('every bank holiday is a weekday, and dates are unique and in order', () => {
  for (const d of DIVISIONS) {
    const dates = bankHolidayDates(data, d);
    assert.equal(dates.length, data[d].events.length, `${d}: an event was dropped`);
    for (const date of dates) assert.equal(isWeekend(date), false, `${d}: ${date} is a weekend`);
    assert.equal(new Set(dates).size, dates.length, `${d}: duplicate date`);
    assert.deepEqual(dates, [...dates].sort(), `${d}: out of order`);
  }
});

test('England and Wales has the eight regular bank holidays in each year the file fully covers', () => {
  const dates = bankHolidayDates(data, 'england-and-wales');
  for (let y = 2020; y <= 2028; y += 1) {
    // Substitute days can move a holiday but not add or remove one, apart from
    // one-off days (2020: VE Day moved; 2022: Jubilee and State Funeral; 2023: Coronation).
    const inYear = dates.filter((d) => d.startsWith(`${y}-`));
    assert.ok(inYear.length >= 8, `${y} has only ${inYear.length}`);
  }
});

test('the coverage window is known, so a stale file is noticed', () => {
  const dates = bankHolidayDates(data, 'england-and-wales');
  const last = dates[dates.length - 1];
  assert.ok(last >= '2028-12-01', `the file ends at ${last}`);
  // The date after which this file has no data. Past this the kit treats every
  // weekday as a sending day, so the file must be refreshed before then.
  const coverageEnds = '2028-12-31';
  assert.ok(daysBetween(last, coverageEnds) >= 0);
});

test('holidays used elsewhere in the tests are present as the feed states them', () => {
  const ew = bankHolidayDates(data, 'england-and-wales');
  for (const d of ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
    '2026-08-31', '2026-12-25', '2026-12-28']) {
    assert.ok(ew.includes(d), d);
  }
});

test('the file is byte for byte what was downloaded from gov.uk, per the checksum in RULES.md', () => {
  const register = readFileSync(join(dirname(FILE), 'RULES.md'), 'utf8');
  const recorded = /SHA-256 of the file[^`]*`([0-9a-f]{64})`/.exec(register);
  assert.ok(recorded, 'RULES.md does not record a checksum for bank-holidays.json');
  const actual = createHash('sha256').update(readFileSync(FILE)).digest('hex');
  assert.equal(actual, recorded[1],
    'bank-holidays.json has been edited. Re-download it from gov.uk instead, and update the checksum.');
});
