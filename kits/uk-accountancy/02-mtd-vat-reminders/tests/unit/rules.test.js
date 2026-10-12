import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseMilestones, milestoneFor, parseMilestoneCell,
  toneFor, toneRank, normaliseSubmitted, isValidEmail, addressProblems, isPlaceholderEmail,
} from '../../src/core/rules.js';
import { DEFAULT_CONFIG, withDefaults } from '../../src/core/config.js';

const M = [21, 14, 7, 3];
const DEFAULTS = [21, 14, 7, 3];

test('the default reminder days are 21, 14, 7 and 3, and come from rules/vat-rules.json', () => {
  // A practice convention, not a statutory value: see rules/RULES.md.
  assert.deepEqual(DEFAULT_CONFIG.milestones, DEFAULTS);
  assert.deepEqual(withDefaults({}).milestones, DEFAULTS);
  const custom = { ...DEFAULT_CONFIG.vatRules, practiceDefaults: { ...DEFAULT_CONFIG.vatRules.practiceDefaults, reminderDays: [10, 2] } };
  assert.deepEqual(withDefaults({ vatRules: custom, milestones: 'junk' }).milestones, [10, 2]);
});

test('EXHAUSTIVE: the milestone reached is correct for every day count from -10 to 400', () => {
  for (let d = -10; d <= 400; d += 1) {
    const got = milestoneFor(d, M);
    const expected = d > 21 ? null : d > 14 ? 21 : d > 7 ? 14 : d > 3 ? 7 : 3;
    assert.equal(got, expected, `${d} days to go`);
  }
});

test('EXHAUSTIVE: exact boundaries', () => {
  assert.equal(milestoneFor(22, M), null);
  assert.equal(milestoneFor(21, M), 21);
  assert.equal(milestoneFor(15, M), 21);
  assert.equal(milestoneFor(14, M), 14);
  assert.equal(milestoneFor(8, M), 14);
  assert.equal(milestoneFor(7, M), 7);
  assert.equal(milestoneFor(4, M), 7);
  assert.equal(milestoneFor(3, M), 3);
  assert.equal(milestoneFor(0, M), 3);
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
  // Friday with the next sending day Monday (gap 3): a 7-day reminder due on Sunday goes on Friday.
  assert.equal(milestoneFor(9, M, 1), 14);
  assert.equal(milestoneFor(9, M, 3), 7);
  // A longer bank-holiday weekend, gap 4.
  assert.equal(milestoneFor(6, M, 4), 3);
  for (const gap of [0, -3, NaN, undefined, null, 'x']) assert.equal(milestoneFor(9, M, gap), 14);
});

test('milestoneFor is null, never an exception, for unusable input', () => {
  for (const bad of [NaN, null, undefined, 'x', Infinity]) assert.equal(milestoneFor(bad, M), null);
  assert.equal(milestoneFor(5, [], 1), null);
  assert.equal(milestoneFor(5, null, 1), null);
});

test('normaliseMilestones cleans a comma-separated string', () => {
  assert.deepEqual(normaliseMilestones('21,14,7,3', DEFAULTS), { milestones: [21, 14, 7, 3], valid: true });
  assert.deepEqual(normaliseMilestones(' 3 , 7, 14 ,21, 7', DEFAULTS), { milestones: [21, 14, 7, 3], valid: true });
  assert.deepEqual(normaliseMilestones([28, '3'], DEFAULTS), { milestones: [28, 3], valid: true });
  assert.deepEqual(normaliseMilestones(5, DEFAULTS), { milestones: [5], valid: true });
});

test('normaliseMilestones drops junk and reports it', () => {
  assert.deepEqual(normaliseMilestones('21,abc,7', DEFAULTS), { milestones: [21, 7], valid: false });
  assert.deepEqual(normaliseMilestones('0,-3,1.5,400', DEFAULTS), { milestones: DEFAULTS, valid: false });
  assert.deepEqual(normaliseMilestones('', DEFAULTS), { milestones: DEFAULTS, valid: false });
  assert.deepEqual(normaliseMilestones(undefined, DEFAULTS), { milestones: DEFAULTS, valid: false });
  assert.deepEqual(normaliseMilestones({ a: 1 }, DEFAULTS), { milestones: DEFAULTS, valid: false });
  // With no defaults to fall back on it still does not throw.
  assert.deepEqual(normaliseMilestones('x', undefined), { milestones: [], valid: false });
});

test('withDefaults always yields a usable, sorted milestone list and never throws', () => {
  for (const bad of [undefined, null, 5, 'x', [], {}, { milestones: 'zzz' }, { milestones: null }, { vatRules: null, milestones: 'x' }, { vatRules: 5 }]) {
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

test('withDefaults repairs an unusable lookback', () => {
  for (const bad of [-1, 'x', NaN, undefined]) assert.equal(withDefaults({ confirmationLookbackDays: bad }).confirmationLookbackDays, 150);
  assert.equal(withDefaults({ confirmationLookbackDays: 30 }).confirmationLookbackDays, 30);
});

test('parseMilestoneCell accepts only whole numbers', () => {
  assert.equal(parseMilestoneCell(7), 7);
  assert.equal(parseMilestoneCell(' 14 '), 14);
  for (const bad of ['', null, undefined, '7 days', '-1', '1.5', 'x']) assert.equal(parseMilestoneCell(bad), null);
});

test('tone escalates with the milestone and never falls back', () => {
  assert.equal(toneFor(21), 'advance');
  assert.equal(toneFor(15), 'advance');
  assert.equal(toneFor(14), 'reminder');
  assert.equal(toneFor(8), 'reminder');
  assert.equal(toneFor(7), 'urgent');
  assert.equal(toneFor(4), 'urgent');
  assert.equal(toneFor(3), 'final');
  assert.equal(toneFor(1), 'final');
  let prev = -1;
  for (let m = 366; m >= 1; m -= 1) {
    const r = toneRank(toneFor(m));
    assert.ok(r >= prev, `tone got softer at ${m}`);
    prev = r;
  }
  assert.equal(toneFor(NaN), 'reminder');
});

test('normaliseSubmitted maps sheet words to four states and rejects the rest', () => {
  for (const [input, expected] of [
    ['', 'pending'], ['  ', 'pending'], [undefined, 'pending'], [null, 'pending'], ['No', 'pending'], ['n', 'pending'],
    ['FALSE', 'pending'], ['Not yet', 'pending'], ['Pending', 'pending'],
    ['Yes', 'submitted'], ['YES', 'submitted'], ['y', 'submitted'], ['Submitted', 'submitted'], ['filed', 'submitted'],
    ['done', 'submitted'], ['TRUE', 'submitted'], [' yes ', 'submitted'],
    ['Not required', 'not required'], ['n/a', 'not required'], ['Deregistered', 'not required'], ['Cancelled', 'not required'],
    ['On Hold', 'on hold'], ['paused', 'on hold'],
    ['maybe', null], ['yess', null], ['1', null], [0, null],
  ]) {
    assert.equal(normaliseSubmitted(input), expected, JSON.stringify(input));
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
