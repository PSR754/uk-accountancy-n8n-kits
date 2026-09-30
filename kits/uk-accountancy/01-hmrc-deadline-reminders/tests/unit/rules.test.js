import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MILESTONES, normaliseMilestones, milestoneFor, parseMilestoneCell,
  toneFor, toneRank, normaliseStatus, isValidEmail, addressProblems, isPlaceholderEmail,
} from '../../src/core/rules.js';
import { DEFAULT_CONFIG, withDefaults } from '../../src/core/config.js';

const M = [30, 14, 7, 1];

test('the default reminder days are the documented 30, 14, 7 and 1', () => {
  // A practice convention, not a statutory value: see rules/RULES.md.
  assert.deepEqual(DEFAULT_MILESTONES, [30, 14, 7, 1]);
  assert.deepEqual(DEFAULT_CONFIG.milestones, [30, 14, 7, 1]);
});

test('EXHAUSTIVE: the milestone reached is correct for every day count from -10 to 400', () => {
  for (let d = -10; d <= 400; d += 1) {
    const got = milestoneFor(d, M);
    const expected = d > 30 ? null : d > 14 ? 30 : d > 7 ? 14 : d > 1 ? 7 : 1;
    assert.equal(got, expected, `${d} days to go`);
  }
});

test('EXHAUSTIVE: exact boundaries', () => {
  assert.equal(milestoneFor(31, M), null);
  assert.equal(milestoneFor(30, M), 30);
  assert.equal(milestoneFor(15, M), 30);
  assert.equal(milestoneFor(14, M), 14);
  assert.equal(milestoneFor(8, M), 14);
  assert.equal(milestoneFor(7, M), 7);
  assert.equal(milestoneFor(2, M), 7);
  assert.equal(milestoneFor(1, M), 1);
  assert.equal(milestoneFor(0, M), 1);
});

test('EXHAUSTIVE: as a deadline approaches the milestone only ever tightens', () => {
  for (const gap of [1, 2, 3, 4]) {
    let previous = Infinity;
    for (let d = 400; d >= 0; d -= 1) {
      const m = milestoneFor(d, M, gap);
      if (m === null) continue;
      assert.ok(m <= previous, `milestone loosened at ${d} days with gap ${gap}`);
      previous = m;
    }
  }
});

test('a reminder that would land in a non-sending gap is brought forward', () => {
  // Friday, deadline on Monday: 3 days to go, next sending day is Monday (gap 3).
  assert.equal(milestoneFor(3, M, 1), 7);
  assert.equal(milestoneFor(3, M, 3), 1);
  // A longer bank-holiday weekend, gap 4: deadline Tuesday, 4 days to go.
  assert.equal(milestoneFor(4, M, 4), 1);
  // Bad gap values behave as an ordinary day.
  for (const gap of [0, -3, NaN, undefined, null, 'x']) assert.equal(milestoneFor(3, M, gap), 7);
});

test('milestoneFor is null, never an exception, for unusable input', () => {
  for (const bad of [NaN, null, undefined, 'x', Infinity]) assert.equal(milestoneFor(bad, M), null);
  assert.equal(milestoneFor(5, [], 1), null);
  assert.equal(milestoneFor(5, null, 1), null);
});

test('normaliseMilestones cleans a comma-separated string', () => {
  assert.deepEqual(normaliseMilestones('30,14,7,1'), { milestones: [30, 14, 7, 1], valid: true });
  assert.deepEqual(normaliseMilestones(' 1 , 7, 14 ,30, 7'), { milestones: [30, 14, 7, 1], valid: true });
  assert.deepEqual(normaliseMilestones([21, '3']), { milestones: [21, 3], valid: true });
  assert.deepEqual(normaliseMilestones(5), { milestones: [5], valid: true });
});

test('normaliseMilestones drops junk and reports it', () => {
  assert.deepEqual(normaliseMilestones('30,abc,7'), { milestones: [30, 7], valid: false });
  assert.deepEqual(normaliseMilestones('0,-3,1.5,400'), { milestones: [...DEFAULT_MILESTONES], valid: false });
  assert.deepEqual(normaliseMilestones(''), { milestones: [...DEFAULT_MILESTONES], valid: false });
  assert.deepEqual(normaliseMilestones(undefined), { milestones: [...DEFAULT_MILESTONES], valid: false });
  assert.deepEqual(normaliseMilestones({ a: 1 }), { milestones: [...DEFAULT_MILESTONES], valid: false });
});

test('withDefaults always yields a usable, sorted milestone list and never throws', () => {
  for (const bad of [undefined, null, 5, 'x', [], {}, { milestones: 'zzz' }, { milestones: null }]) {
    const c = withDefaults(bad);
    assert.ok(c.milestones.length > 0);
    assert.deepEqual(c.milestones, [...c.milestones].sort((a, b) => b - a));
  }
  assert.deepEqual(withDefaults({ milestones: '10,3' }).milestones, [10, 3]);
});

test('withDefaults derives bank holidays from the chosen gov.uk division', () => {
  const ew = withDefaults({});
  assert.ok(ew.bankHolidays.includes('2026-12-25'));
  assert.ok(withDefaults({ bankHolidayDivision: 'scotland' }).bankHolidays.length > 0);
  assert.deepEqual(withDefaults({ bankHolidayDivision: 'atlantis' }).bankHolidays, []);
  // An explicit list wins, which is how tests pin the calendar.
  assert.deepEqual(withDefaults({ bankHolidays: ['2026-01-01'] }).bankHolidays, ['2026-01-01']);
});

test('parseMilestoneCell accepts only whole numbers', () => {
  assert.equal(parseMilestoneCell(7), 7);
  assert.equal(parseMilestoneCell(' 14 '), 14);
  for (const bad of ['', null, undefined, '7 days', '-1', '1.5', 'x']) assert.equal(parseMilestoneCell(bad), null);
});

test('tone escalates with the milestone and never falls back', () => {
  assert.equal(toneFor(30), 'advance');
  assert.equal(toneFor(15), 'advance');
  assert.equal(toneFor(14), 'reminder');
  assert.equal(toneFor(8), 'reminder');
  assert.equal(toneFor(7), 'urgent');
  assert.equal(toneFor(2), 'urgent');
  assert.equal(toneFor(1), 'final');
  let prev = -1;
  for (let m = 366; m >= 1; m -= 1) {
    const r = toneRank(toneFor(m));
    assert.ok(r >= prev, `tone got softer at ${m}`);
    prev = r;
  }
  assert.equal(toneFor(NaN), 'reminder');
});

test('normaliseStatus maps sheet words to four states and rejects the rest', () => {
  for (const [input, expected] of [
    ['', 'active'], ['  ', 'active'], [undefined, 'active'], ['Pending', 'active'], ['open', 'active'],
    ['In  Progress', 'active'], ['Filed', 'filed'], ['SUBMITTED', 'filed'], ['done', 'filed'],
    ['Cancelled', 'cancelled'], ['canceled', 'cancelled'], ['Not Required', 'cancelled'],
    ['On Hold', 'on hold'], ['paused', 'on hold'],
    ['maybe', null], ['fileed', null],
  ]) {
    assert.equal(normaliseStatus(input), expected, JSON.stringify(input));
  }
});

test('isValidEmail catches the addresses that stop a send', () => {
  for (const ok of ['a@b.co.uk', 'first.last+tag@firm.com']) assert.equal(isValidEmail(ok), true, ok);
  for (const bad of ['', '  ', 'a@b', 'no-at.co.uk', 'a b@c.com', '@x.com', null, undefined, 'a@b..com']) {
    assert.equal(isValidEmail(bad), false, String(bad));
  }
  assert.equal(isValidEmail(`${'a'.repeat(250)}@b.co`), false);
});

test('placeholder and empty sender or practice addresses are reported', () => {
  assert.equal(isPlaceholderEmail('you@yourfirm.co.uk'), true);
  assert.equal(isPlaceholderEmail(' A@Example.co.uk '), true);
  assert.equal(isPlaceholderEmail('ravi@smith.co.uk'), false);
  assert.equal(isPlaceholderEmail(undefined), false);
  assert.deepEqual(addressProblems({ senderEmail: 'a@smith.co.uk', practiceEmail: 'o@smith.co.uk' }), []);
  assert.equal(addressProblems({}).length, 2);
  assert.equal(addressProblems({ senderEmail: 'a@example.co.uk', practiceEmail: 'o@smith.co.uk' }).length, 1);
  for (const bad of [null, 5, {}, [], 'x']) assert.doesNotThrow(() => addressProblems({ senderEmail: bad, practiceEmail: bad }));
});
