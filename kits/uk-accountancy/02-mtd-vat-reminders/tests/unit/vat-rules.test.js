import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tsOf } from '../../src/core/dates.js';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = JSON.parse(readFileSync(join(KIT, 'rules', 'vat-rules.json'), 'utf8'));
const register = readFileSync(join(KIT, 'rules', 'RULES.md'), 'utf8');

// The register and the data file must say the same thing, and every rule must
// say where it came from. These tests cannot check gov.uk; they check that
// nothing in the file is uncited, undated or out of step with the register.

test('the rules file records when it was last checked, as a real date', () => {
  assert.notEqual(tsOf(rules.validAsOf), null);
  assert.ok(Number.isInteger(rules.reviewWithinDays) && rules.reviewWithinDays > 0);
  assert.match(register, new RegExp(`Valid as of ${rules.validAsOf}`));
});

test('every source is a gov.uk address with a check date, and is cited in the register', () => {
  assert.ok(rules.sources.length >= 5);
  const ids = new Set();
  for (const s of rules.sources) {
    assert.match(s.url, /^https:\/\/www\.(gov|legislation\.gov)\.uk\//, s.id);
    assert.notEqual(tsOf(s.lastChecked), null, `${s.id} has no check date`);
    assert.ok(s.lastChecked <= rules.validAsOf, `${s.id} was checked after the rules were declared valid`);
    assert.ok(s.title && s.title.length > 5);
    assert.ok(!ids.has(s.id), `duplicate source ${s.id}`);
    ids.add(s.id);
    assert.ok(register.includes(s.url), `${s.url} is not cited in RULES.md`);
  }
});

test('every rule in the data file points at a source that exists', () => {
  const ids = new Set(rules.sources.map((s) => s.id));
  for (const section of [rules.returnDeadline, rules.schemes]) {
    assert.ok(Array.isArray(section.sourceIds) && section.sourceIds.length > 0);
    for (const id of section.sourceIds) assert.ok(ids.has(id), id);
  }
});

test('the rule values are exactly those the register states', () => {
  const r = rules.returnDeadline;
  assert.equal(r.calendarMonthsAfterPeriodEnd, 1);
  assert.equal(r.daysAfterThat, 7);
  assert.match(register, /one calendar month and 7 days/);
  assert.deepEqual(rules.practiceDefaults.reminderDays, [21, 14, 7, 3]);
  assert.match(register, /21, 14, 7 and 3/);
  assert.match(register, /Annual Accounting/);
  assert.deepEqual(rules.schemes.unsupported, ['annual accounting']);
});

test('inferred rules stay flagged UNVERIFIED in the register until a person confirms them', () => {
  const rowFor = (needle) => register.split('\n').find((l) => l.startsWith('|') && l.includes(needle));
  for (const needle of [
    'Period ends on the last day of a month',
    'Schemes with the same return deadline',
    'The pre-submission checklist in the client email',
  ]) {
    const row = rowFor(needle);
    assert.ok(row, `register row missing: ${needle}`);
    assert.match(row, /UNVERIFIED/, `${needle} lost its UNVERIFIED flag`);
  }
  // A period end that is not a month end is deliberately not calculated.
  assert.match(rowFor('A period end that is not the last day of a month'), /Not calculated/);
  assert.match(rowFor('A period end that is not the last day of a month'), /no reminder is sent/);
  assert.equal(rules.returnDeadline.onlyMonthEndPeriodsCalculated, true);
  // And the ones that are stated on gov.uk are not mislabelled.
  assert.doesNotMatch(rowFor('| VAT return deadline |'), /UNVERIFIED/);
  assert.match(rowFor('| Weekends and bank holidays |'), /even if it's on a weekend or bank holiday/);
});

test('the deadline rule is data: no number from it is hardcoded in the core', () => {
  // Comments may quote the rule; only the code may not hardcode it.
  const deadline = readFileSync(join(KIT, 'src', 'core', 'deadline.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // The rule numbers must come from the rules object, never from this file.
  assert.doesNotMatch(deadline, /calendarMonthsAfterPeriodEnd\s*[:=]\s*\d/);
  assert.doesNotMatch(deadline, /\+\s*7\b|\b7\s*\*/, 'a literal 7 is in the deadline logic');
  assert.doesNotMatch(deadline, /addCalendarMonths\([^)]*,\s*1[,)]/, 'a literal 1 month is in the deadline logic');
});

test('nothing in the public files mentions private tooling, pricing or research', () => {
  const files = ['rules/RULES.md', 'rules/vat-rules.json', 'src/core/copy.js', 'src/core/plan.js'];
  for (const f of files) {
    const text = readFileSync(join(KIT, f), 'utf8');
    assert.doesNotMatch(text, /roadmap|pricing|£\s?\d+\s*(per|\/)\s*(month|mo)|icp-researcher|kit-builder|autopilot/i, f);
  }
});
