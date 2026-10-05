import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCompanyRow, readApiProfile } from '../../src/core/companies.js';
import { accountsDeadline, confirmationDeadline } from '../../src/core/deadlines.js';
import { profile } from '../helpers/fakes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(readFileSync(join(HERE, '..', '..', 'rules', 'deadline-rules.json'), 'utf8'));

const NO_API = readApiProfile(null);
const co = (over) => readCompanyRow({ 'Company Number': '01234567', ...over }, rules);
const acc = (over, type = 'private', api = NO_API) => accountsDeadline(co(over), api, type, rules);
const cs = (over, api = NO_API) => confirmationDeadline(co(over), api, rules);

// Worked examples from the accounts guidance, section 5.
test('accounts, private: 9 months after the period end', () => {
  const r = acc({ 'Last Accounts Made Up To': '2025-03-31' });
  assert.equal(r.periodEnd, '2026-03-31');
  assert.equal(r.dueDate, '2026-12-31');
});

test('accounts, public: 6 months after the period end', () => {
  const r = acc({ 'Last Accounts Made Up To': '2025-03-31' }, 'public');
  assert.equal(r.dueDate, '2026-09-30');
});

test('accounts: ARD 4 April gives 4 January, ARD 30 April gives 31 January', () => {
  const later = { 'Last Accounts Made Up To': '2025-01-01' };
  assert.equal(acc({ ...later, 'Next Accounts Period End': '2026-04-04' }).dueDate, '2027-01-04');
  assert.equal(acc({ ...later, 'Next Accounts Period End': '2026-04-30' }).dueDate, '2027-01-31');
});

test('accounts, first accounts: guidance example (1 January 2025, ARD 31 January) gives 1 October 2026', () => {
  const r = acc({ 'Incorporation Date': '2025-01-01' });
  assert.equal(r.periodEnd, '2026-01-31', 'first ARD is the last day of the month of the first anniversary');
  assert.equal(r.dueDate, '2026-10-01');
});

test('accounts, first accounts: 6 April 2025 incorporation has first ARD 30 April 2026', () => {
  const r = acc({ 'Incorporation Date': '2025-04-06' });
  assert.equal(r.periodEnd, '2026-04-30');
  assert.equal(r.dueDate, '2027-01-06'); // 21 months after incorporation
});

test('accounts, first accounts, public: 18 months after incorporation', () => {
  const r = acc({ 'Incorporation Date': '2025-01-01' }, 'public');
  assert.equal(r.dueDate, '2026-07-01');
});

test('accounts, first accounts: 3 months after the period end wins when it is later', () => {
  // A first period end chosen far out by the company: 2027-02-28 + 3 months is later than 21 months from incorporation.
  const r = acc({ 'Incorporation Date': '2025-01-01', 'Next Accounts Period End': '2027-02-28' });
  assert.equal(r.dueDate, '2027-05-31');
});

test('accounts, first accounts of 12 months or less use the normal 9 months', () => {
  const r = acc({ 'Incorporation Date': '2025-01-01', 'Next Accounts Period End': '2025-12-31' });
  assert.equal(r.dueDate, '2026-09-30');
});

test('accounts: the date from Companies House wins, and is not flagged on its own', () => {
  const api = readApiProfile(profile({ accountsDue: '2026-12-31' }));
  const r = acc({ 'Last Accounts Made Up To': '2020-01-01' }, 'private', api);
  assert.equal(r.dueDate, '2026-12-31');
  assert.equal(r.source, 'companies-house');
  assert.equal(r.needsConfirmation, false);
});

test('accounts: sheet and Companies House disagreeing is flagged and the earlier date is used', () => {
  const api = readApiProfile(profile({ accountsDue: '2026-12-31' }));
  const r = acc({ 'Accounts Due': '2026-11-30' }, 'private', api);
  assert.equal(r.dueDate, '2026-11-30');
  assert.equal(r.discrepancy, true);
  assert.equal(r.needsConfirmation, true);
  assert.match(r.flags[0], /Needs human confirmation/);
});

test('accounts: a date typed into the sheet is flagged as unconfirmed', () => {
  const r = acc({ 'Accounts Due': '2026-11-30' });
  assert.equal(r.source, 'sheet');
  assert.equal(r.needsConfirmation, true);
});

test('accounts: every calculated deadline needs human confirmation', () => {
  const r = acc({ 'Last Accounts Made Up To': '2025-03-31' });
  assert.equal(r.source, 'calculated');
  assert.equal(r.needsConfirmation, true);
});

test('accounts: not enough information gives a null date and a reason, never a guess', () => {
  const r1 = acc({});
  assert.equal(r1.dueDate, null);
  assert.equal(r1.source, 'none');
  assert.ok(r1.flags.length > 0);
  const r2 = acc({ 'Last Accounts Made Up To': '2025-03-31' }, null);
  assert.equal(r2.dueDate, null);
  assert.match(r2.flags.join(' '), /type/i);
});

test('accounts: a month-end clamp is flagged', () => {
  const r = acc({ 'Incorporation Date': '2025-05-31' });
  assert.equal(r.needsConfirmation, true);
  assert.ok(r.flags.some((f) => /last day of that month/.test(f)));
});

test('accounts: the deadline is never rolled to a working day', () => {
  // 4 October 2026 is a Sunday. The guidance says the deadline stays on the Sunday.
  const r = acc({ 'Last Accounts Made Up To': '2025-01-04', 'Next Accounts Period End': '2026-01-04' });
  assert.equal(r.dueDate, '2026-10-04');
  assert.equal(new Date(`${r.dueDate}T00:00:00Z`).getUTCDay(), 0);
});

test('accounts: a period end with no last accounts and no incorporation date cannot be placed', () => {
  assert.equal(acc({ 'Next Accounts Period End': '2026-03-31' }).dueDate, null);
});

test('confirmation statement: review period of 12 months, then 14 days', () => {
  const r = cs({ 'Last Confirmation Statement Made Up To': '2026-03-13' });
  assert.equal(r.periodEnd, '2027-03-13');
  assert.equal(r.dueDate, '2027-03-27');
});

test('confirmation statement: the first one is 12 months after incorporation', () => {
  const r = cs({ 'Incorporation Date': '2025-11-03' });
  assert.equal(r.periodEnd, '2026-11-02', 'the 12 months begin on the day of incorporation, so end the day before the anniversary');
  assert.equal(r.dueDate, '2026-11-16');
});

test('confirmation statement: first-statement arithmetic (s853A(5)(a)) from the compliance review', () => {
  assert.equal(cs({ 'Incorporation Date': '2025-01-01' }).periodEnd, '2025-12-31');
  assert.equal(cs({ 'Incorporation Date': '2025-01-01' }).dueDate, '2026-01-14');
  assert.equal(cs({ 'Incorporation Date': '2025-03-31' }).dueDate, '2026-04-13');
});

test('confirmation statement: a later period starts the day after the last confirmation date (s853A(5)(b), (6))', () => {
  const end = (d) => cs({ 'Last Confirmation Statement Made Up To': d });
  assert.equal(end('2025-12-31').periodEnd, '2026-12-31');
  assert.equal(end('2025-12-31').dueDate, '2027-01-14');
  assert.equal(end('2026-03-13').periodEnd, '2027-03-13');
  // Leap-year and month-end cases.
  assert.equal(end('2027-02-28').periodEnd, '2028-02-29');
  assert.equal(end('2027-02-28').dueDate, '2028-03-14');
  assert.equal(end('2027-12-31').periodEnd, '2028-12-31');
  assert.equal(end('2024-02-29').periodEnd, '2025-02-28');
  assert.equal(end('2024-02-29').dueDate, '2025-03-14');
  // Last confirmation 28 Feb in a leap year: the next period begins 29 Feb, flagged.
  const leap = end('2028-02-28');
  assert.equal(leap.periodEnd, '2029-02-28');
  assert.equal(leap.dueDate, '2029-03-14');
  assert.ok(leap.flags.some((f) => /begins on 29 February/.test(f)));
  assert.equal(end('2028-02-29').periodEnd, '2029-02-28');
  assert.equal(end('2028-02-29').dueDate, '2029-03-14');
  assert.ok(!end('2027-02-28').flags.some((f) => /29 February/.test(f)));
  assert.equal(end('2023-02-28').periodEnd, '2024-02-29');
  assert.equal(end('2025-02-28').periodEnd, '2026-02-28');
});

test('accounts, first accounts: incorporation on 29 February is flagged', () => {
  const r = acc({ 'Incorporation Date': '2024-02-29' });
  assert.ok(r.flags.some((f) => /Incorporated on 29 February/.test(f)));
  assert.equal(r.needsConfirmation, true);
});

test('confirmation statement: 29 February incorporation is flagged and ends 28 February', () => {
  const r = cs({ 'Incorporation Date': '2024-02-29' });
  assert.equal(r.periodEnd, '2025-02-28');
  assert.equal(r.dueDate, '2025-03-14');
  assert.ok(r.flags.some((f) => /29 February/.test(f)));
});

test('confirmation statement: calculated dates are always flagged for human confirmation', () => {
  const r = cs({ 'Incorporation Date': '2025-11-03' });
  assert.equal(r.needsConfirmation, true);
  assert.equal(r.source, 'calculated');
  assert.ok(r.flags.some((f) => /Needs human confirmation/.test(f)));
});

test('confirmation statement: Companies House next_due wins and is not flagged', () => {
  const r = cs({ 'Incorporation Date': '2025-11-03' }, readApiProfile(profile({ csDue: '2026-12-01' })));
  assert.equal(r.dueDate, '2026-12-01');
  assert.equal(r.needsConfirmation, false);
});

test('confirmation statement: next_made_up_to without next_due adds 14 days and is flagged', () => {
  const p = profile({});
  delete p.confirmation_statement.next_due;
  p.confirmation_statement.next_made_up_to = '2026-12-01';
  const r = cs({}, readApiProfile(p));
  assert.equal(r.dueDate, '2026-12-15');
  assert.equal(r.needsConfirmation, true);
});

test('confirmation statement: nothing to work from gives null and a reason', () => {
  const r = cs({});
  assert.equal(r.dueDate, null);
  assert.ok(r.flags.length > 0);
});

test('Companies House overdue marker is carried through', () => {
  const r = cs({}, readApiProfile(profile({ csDue: '2026-01-01', csOverdue: true })));
  assert.equal(r.overdueAtRegister, true);
});
