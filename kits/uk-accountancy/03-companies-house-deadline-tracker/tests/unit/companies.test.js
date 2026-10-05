import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normaliseCompanyNumber, normaliseCompanyType, typeFromApi, isValidEmail,
  readCompanyRow, readApiProfile, isEmptyRow,
} from '../../src/core/companies.js';
import { profile } from '../helpers/fakes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(readFileSync(join(HERE, '..', '..', 'rules', 'deadline-rules.json'), 'utf8'));

test('company numbers: valid shapes, padding and rejection', () => {
  assert.deepEqual(normaliseCompanyNumber('01234567'), { number: '01234567', valid: true, padded: false, reason: null });
  assert.equal(normaliseCompanyNumber(' sc 123456 ').number, 'SC123456');
  assert.equal(normaliseCompanyNumber(1234567).number, '01234567');
  assert.equal(normaliseCompanyNumber(1234567).padded, true);
  assert.equal(normaliseCompanyNumber('NI012345').valid, true);
  for (const bad of ['', null, undefined, 'ABC', '123456789', 'S-234567', '12-345678', {}]) {
    assert.equal(normaliseCompanyNumber(bad).valid, false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('company type: private and public synonyms, unknown stays unknown', () => {
  assert.equal(normaliseCompanyType('Private', rules), 'private');
  assert.equal(normaliseCompanyType(' LTD ', rules), 'private');
  assert.equal(normaliseCompanyType('Public Limited', rules), 'public');
  assert.equal(normaliseCompanyType('PLC', rules), 'public');
  assert.equal(normaliseCompanyType('LLP', rules), null);
  assert.equal(normaliseCompanyType('', rules), null);
  assert.equal(normaliseCompanyType('ltd', null), null);
  assert.equal(typeFromApi('ltd'), 'private');
  assert.equal(typeFromApi('plc'), 'public');
  assert.equal(typeFromApi('llp'), null);
});

test('email check is conservative', () => {
  assert.equal(isValidEmail('a@example.co.uk'), true);
  for (const bad of ['', 'x', 'a@b', 'a b@example.com', null, 'a@.com']) assert.equal(isValidEmail(bad), false);
});

test('readCompanyRow reports unreadable dates and unknown types instead of dropping them', () => {
  const c = readCompanyRow({
    'Company Number': '01234567', 'Company Type': 'Cooperative',
    'Last Accounts Made Up To': 'next week', 'Incorporation Date': '14/03/2019',
  }, rules);
  assert.equal(c.incorporated, '2019-03-14');
  assert.equal(c.lastAccounts, null);
  assert.equal(c.type, null);
  assert.equal(c.problems.length, 2);
  assert.match(c.problems.join(' '), /next week/);
});

test('readCompanyRow survives non-objects', () => {
  for (const v of [null, undefined, 5, 'x', []]) assert.doesNotThrow(() => readCompanyRow(v, rules));
});

test('paused flag', () => {
  assert.equal(readCompanyRow({ Paused: 'Yes' }, rules).paused, true);
  assert.equal(readCompanyRow({ Paused: 'no' }, rules).paused, false);
  assert.equal(readCompanyRow({}, rules).paused, false);
});

test('isEmptyRow ignores row_number and helper columns', () => {
  assert.equal(isEmptyRow({ row_number: 5, _companyNumber: '', 'Company Name': ' ' }), true);
  assert.equal(isEmptyRow({ row_number: 5, 'Company Name': 'A' }), false);
  assert.equal(isEmptyRow(null), true);
});

test('readApiProfile: a good response', () => {
  const p = readApiProfile(profile({ number: 'sc123456', status: 'Active' }));
  assert.equal(p.ok, true);
  assert.equal(p.number, 'SC123456');
  assert.equal(p.status, 'active');
  assert.equal(p.type, 'private');
  assert.equal(p.accounts.nextDue, '2027-09-30');
  assert.equal(p.confirmationStatement.nextDue, '2027-03-30');
});

test('readApiProfile: failures of every shape become ok:false with a reason', () => {
  const cases = [null, undefined, 'oops', 5, [], {}, { error: 'timeout' }, { error: { message: 'ETIMEDOUT' } },
    { errors: [{ error: 'company-profile-not-found' }] }, { message: 'Too Many Requests' }];
  for (const c of cases) {
    const p = readApiProfile(c);
    assert.equal(p.ok, false, JSON.stringify(c));
    assert.ok(p.reason);
  }
});

test('readApiProfile: unreadable dates in a response become null, not garbage', () => {
  const body = profile({ accountsDue: 'tomorrow' });
  assert.equal(readApiProfile(body).accounts.nextDue, null);
});
