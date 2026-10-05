import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, sentLogKeys } from '../../src/core/plan.js';
import { bandFor, statusAction } from '../../src/core/rules.js';
import { withDefaults } from '../../src/core/config.js';
import { profile } from '../helpers/fakes.js';

const TODAY = '2026-10-05'; // a Monday
const config = { practiceEmail: 'practice@example.co.uk', dryRun: false, firmName: 'Smith & Co' };

const entry = (row, api) => ({ row: { 'Company Number': '01234567', 'Company Name': 'Acme Ltd', ...row }, api });
const withCs = (daysAway, extra = {}) => entry({}, profile({ number: '01234567', csDue: addDaysISO(TODAY, daysAway), accountsDue: '2030-01-01', ...extra }));

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test('bandFor: smallest milestone at or above the days left', () => {
  const m = [30, 14, 7, 1];
  assert.deepEqual(bandFor(31, m, 7), null);
  assert.deepEqual(bandFor(30, m, 7), { band: '30', overdue: false });
  assert.deepEqual(bandFor(15, m, 7), { band: '30', overdue: false });
  assert.deepEqual(bandFor(14, m, 7), { band: '14', overdue: false });
  assert.deepEqual(bandFor(8, m, 7), { band: '14', overdue: false });
  assert.deepEqual(bandFor(2, m, 7), { band: '7', overdue: false });
  assert.deepEqual(bandFor(1, m, 7), { band: '1', overdue: false });
  assert.deepEqual(bandFor(0, m, 7), { band: '1', overdue: false });
  assert.deepEqual(bandFor(-1, m, 7), { band: 'overdue-1', overdue: true });
  assert.deepEqual(bandFor(-7, m, 7), { band: 'overdue-1', overdue: true });
  assert.deepEqual(bandFor(-8, m, 7), { band: 'overdue-2', overdue: true });
  assert.equal(bandFor(NaN, m, 7), null);
  assert.equal(bandFor(5, 'x', 7), null);
});

test('statusAction', () => {
  const rules = withDefaults({}).rules;
  assert.equal(statusAction('active', rules), 'remind');
  assert.equal(statusAction('Dissolved', rules), 'suppress');
  assert.equal(statusAction('liquidation', rules), 'review');
  assert.equal(statusAction('', rules), 'review');
});

test('a reminder is raised inside the window and not outside it', () => {
  for (const [days, expected] of [[45, 0], [31, 0], [30, 1], [14, 1], [7, 1], [1, 1], [0, 1], [-3, 1]]) {
    const r = plan({ companies: [withCs(days)], today: TODAY, config });
    assert.equal(r.reminders.length, expected, `${days} days away`);
  }
});

test('a missed run is caught up: 10 days away still raises the 14-day reminder', () => {
  const r = plan({ companies: [withCs(10)], today: TODAY, config });
  assert.equal(r.reminders[0].band, '14');
  assert.equal(r.reminders[0].days, 10);
});

test('a reminder already logged is not raised again, but the next band is', () => {
  const dueDate = addDaysISO(TODAY, 10);
  const key = `01234567|confirmationStatement|${dueDate}|14`;
  const r1 = plan({ companies: [withCs(10)], today: TODAY, config, sentKeys: [key] });
  assert.equal(r1.reminders.length, 0);
  const r2 = plan({ companies: [withCs(6)], today: TODAY, config, sentKeys: [`01234567|confirmationStatement|${addDaysISO(TODAY, 6)}|14`] });
  assert.equal(r2.reminders[0].band, '7');
});

test('overdue reminders repeat weekly, not daily', () => {
  const due = addDaysISO(TODAY, -3);
  const key1 = `01234567|confirmationStatement|${due}|overdue-1`;
  const same = plan({ companies: [withCs(-3)], today: TODAY, config, sentKeys: [key1] });
  assert.equal(same.reminders.length, 0);
  const later = plan({ companies: [withCs(-3)], today: addDaysISO(TODAY, 7), config, sentKeys: [key1] });
  assert.equal(later.reminders[0].band, 'overdue-2');
});

test('the idempotency key identifies company, filing, due date and band', () => {
  const r = plan({ companies: [withCs(5)], today: TODAY, config });
  assert.equal(r.reminders[0].idempotencyKey, `01234567|confirmationStatement|${addDaysISO(TODAY, 5)}|7`);
});

test('a filing that moves its due date after being filed starts a fresh set of keys', () => {
  const old = `01234567|confirmationStatement|${addDaysISO(TODAY, -300)}|overdue-9`;
  const r = plan({ companies: [withCs(5)], today: TODAY, config, sentKeys: [old] });
  assert.equal(r.reminders.length, 1);
});

test('live run records one Sent Log row per reminder; dry run records none', () => {
  const live = plan({ companies: [withCs(5)], today: TODAY, config });
  assert.equal(live.sentLogRows.length, 1);
  assert.equal(live.sentLogRows[0]['Idempotency Key'], live.reminders[0].idempotencyKey);
  const dry = plan({ companies: [withCs(5)], today: TODAY, config: { ...config, dryRun: true } });
  assert.equal(dry.reminders.length, 1);
  assert.deepEqual(dry.sentLogRows, []);
  assert.match(dry.digest.subject, /^\[DRY RUN\]/);
  assert.match(dry.digest.body, /DRY RUN/);
});

test('dry run is the default, and only the exact boolean false turns it off', () => {
  for (const v of [undefined, true, 'false', 0, null, '']) {
    const r = plan({ companies: [withCs(5)], today: TODAY, config: { practiceEmail: 'p@example.co.uk', dryRun: v } });
    assert.equal(r.summary.dryRun, true, `dryRun: ${JSON.stringify(v)}`);
    assert.deepEqual(r.sentLogRows, []);
  }
  assert.equal(withDefaults({ dryRun: false }).dryRun, false);
});

test('dry run goes to the dry-run recipient when set', () => {
  const r = plan({ companies: [withCs(5)], today: TODAY, config: { practiceEmail: 'p@example.co.uk', dryRunRecipient: 'me@example.co.uk' } });
  assert.equal(r.summary.digestTo, 'me@example.co.uk');
  const live = plan({ companies: [withCs(5)], today: TODAY, config: { ...config, dryRunRecipient: 'me@example.co.uk' } });
  assert.equal(live.summary.digestTo, 'practice@example.co.uk');
});

test('the digest is never addressed to a client, whatever the sheet contains', () => {
  const r = plan({
    companies: [entry({ 'Client Contact Email': 'client@example.com' }, profile({ csDue: addDaysISO(TODAY, 5), accountsDue: '2030-01-01' }))],
    today: TODAY, config,
  });
  assert.equal(r.summary.digestTo, 'practice@example.co.uk');
  assert.notEqual(r.summary.digestTo, 'client@example.com');
});

test('client drafts appear in the digest, labelled as not sent, and can be switched off', () => {
  const row = { 'Client Contact Email': 'client@example.com' };
  const api = profile({ number: '01234567', csDue: addDaysISO(TODAY, 5), accountsDue: '2030-01-01' });
  const r = plan({ companies: [entry(row, api)], today: TODAY, config });
  assert.equal(r.reminders[0].draftTo, 'client@example.com');
  assert.match(r.digest.body, /Draft client message \(not sent/);
  assert.match(r.digest.body, /Nothing has been filed with Companies House and nothing has been sent to any client/);
  const off = plan({ companies: [entry(row, api)], today: TODAY, config: { ...config, includeClientDrafts: false } });
  assert.equal(off.reminders[0].draft, '');
  assert.doesNotMatch(off.digest.body, /Draft client message/);
});

test('a draft with no valid contact email says so', () => {
  const r = plan({ companies: [withCs(5)], today: TODAY, config });
  assert.match(r.digest.body, /no valid contact email/);
});

test('dissolved companies are skipped; unusual statuses are reported, not reminded', () => {
  const gone = plan({ companies: [withCs(5, { status: 'dissolved' })], today: TODAY, config });
  assert.equal(gone.reminders.length, 0);
  assert.equal(gone.attention.length, 0);
  const odd = plan({ companies: [withCs(5, { status: 'liquidation' })], today: TODAY, config });
  assert.equal(odd.reminders.length, 0);
  assert.match(odd.attention[0].reason, /liquidation/);
  assert.match(odd.attention[0].reason, /Needs human confirmation/);
});

test('a paused row is skipped silently', () => {
  const r = plan({ companies: [entry({ Paused: 'yes' }, profile({ csDue: addDaysISO(TODAY, 5) }))], today: TODAY, config });
  assert.equal(r.reminders.length, 0);
  assert.equal(r.skipped[0].reason, 'paused in the sheet');
});

test('a failed Companies House lookup falls back to the sheet and says so', () => {
  const row = { 'Company Type': 'Private', 'Incorporation Date': '2019-03-14', 'Last Confirmation Statement Made Up To': '2026-09-20', 'Last Accounts Made Up To': '2025-12-31' };
  // Review period ends 2027-09-20, due 2027-10-04: outside the window. Use an explicit due date instead.
  const r = plan({ companies: [entry({ ...row, 'Confirmation Statement Due': addDaysISO(TODAY, 5) }, { error: { message: 'ETIMEDOUT' } })], today: TODAY, config });
  assert.equal(r.summary.lookupFailures, 1);
  assert.equal(r.reminders.length, 1);
  assert.equal(r.reminders[0].source, 'sheet');
  assert.equal(r.reminders[0].needsConfirmation, true);
  assert.ok(r.attention.some((a) => /lookup failed/.test(a.reason)));
});

test('a sheet/API disagreement is reported even when no reminder is due yet', () => {
  const api = profile({ number: '01234567', csDue: '2030-01-01', accountsDue: '2030-02-01' });
  const r = plan({ companies: [entry({ 'Confirmation Statement Due': '2031-01-01' }, api)], today: TODAY, config });
  assert.equal(r.reminders.length, 0);
  assert.ok(r.attention.some((a) => /Companies House says/.test(a.reason)));
});

test('sheet type disagreeing with Companies House is reported and Companies House is used', () => {
  const r = plan({ companies: [entry({ 'Company Type': 'Public' }, profile({ number: '01234567', csDue: addDaysISO(TODAY, 5) }))], today: TODAY, config });
  assert.ok(r.attention.some((a) => /sheet says public but Companies House says private/.test(a.reason)));
});

test('bad rows are reported with a reason, and good rows around them still work', () => {
  const r = plan({
    companies: [
      entry({ 'Company Number': 'XYZ' }, null),
      withCs(5),
      entry({ 'Company Number': '02222222', 'Last Accounts Made Up To': 'whenever' }, null),
      { row: {}, api: null },
      null,
      { row: 'junk' },
    ],
    today: TODAY, config,
  });
  assert.equal(r.reminders.length, 1);
  assert.ok(r.attention.some((a) => /not a Companies House number/.test(a.reason)));
  assert.ok(r.attention.some((a) => /whenever/.test(a.reason)));
  assert.equal(r.summary.emptyRows, 3);
});

test('a duplicate company number is used once', () => {
  const r = plan({ companies: [withCs(5), withCs(5)], today: TODAY, config });
  assert.equal(r.reminders.length, 1);
  assert.ok(r.attention.some((a) => /more than once/.test(a.reason)));
});

test('a number with its leading zeros stripped by the spreadsheet is repaired and reported', () => {
  const r = plan({ companies: [entry({ 'Company Number': 1234567 }, profile({ number: '01234567', csDue: addDaysISO(TODAY, 5) }))], today: TODAY, config });
  assert.equal(r.reminders[0].companyNumber, '01234567');
  assert.ok(r.attention.some((a) => /padded/.test(a.reason)));
});

test('reminders are ordered most urgent first', () => {
  const a = entry({ 'Company Number': '01111111' }, profile({ number: '01111111', csDue: addDaysISO(TODAY, 20), accountsDue: '2030-01-01' }));
  const b = entry({ 'Company Number': '02222222' }, profile({ number: '02222222', csDue: addDaysISO(TODAY, -2), accountsDue: '2030-01-01' }));
  const c = entry({ 'Company Number': '03333333' }, profile({ number: '03333333', csDue: addDaysISO(TODAY, 3), accountsDue: '2030-01-01' }));
  const r = plan({ companies: [a, b, c], today: TODAY, config });
  assert.deepEqual(r.reminders.map((x) => x.days), [-2, 3, 20]);
});

test('no digest when there is nothing to say, except the weekly attention digest', () => {
  const quiet = plan({ companies: [withCs(100)], today: TODAY, config });
  assert.equal(quiet.summary.sendDigest, false);
  const messy = [entry({ 'Company Number': 'bad' }, null)];
  const monday = plan({ companies: messy, today: '2026-10-05', config });
  assert.equal(monday.summary.sendDigest, true);
  const tuesday = plan({ companies: messy, today: '2026-10-06', config });
  assert.equal(tuesday.summary.sendDigest, false);
  const off = plan({ companies: messy, today: '2026-10-05', config: { ...config, attentionDigestWeekday: null } });
  assert.equal(off.summary.sendDigest, false);
});

test('something to report but no address halts visibly instead of vanishing', () => {
  const r = plan({ companies: [withCs(5)], today: TODAY, config: { dryRun: false } });
  assert.equal(r.summary.sendDigest, false);
  assert.equal(r.summary.halted, true);
  assert.match(r.summary.haltReason, /email address/);
  assert.deepEqual(r.sentLogRows, []);
});

test('an invalid run date halts and returns a well-formed result', () => {
  for (const bad of ['', 'today', undefined, '2026-02-30']) {
    const r = plan({ companies: [withCs(5)], today: bad, config });
    assert.equal(r.summary.halted, true);
    assert.deepEqual(r.reminders, []);
    assert.deepEqual(r.sentLogRows, []);
  }
});

test('damaged rules halt the run rather than producing wrong dates', () => {
  const r = plan({ companies: [withCs(5)], today: TODAY, config: { ...config, rules: { accounts: {} } } });
  assert.equal(r.summary.halted, true);
  assert.match(r.summary.haltReason, /rules file/);
});

test('invalid milestones fall back to the defaults with a visible note', () => {
  const r = plan({ companies: [withCs(5)], today: TODAY, config: { ...config, milestones: ['x', -1] } });
  assert.equal(r.reminders.length, 1);
  assert.match(r.digest.body, /Configuration note/);
});

test('custom milestones are respected', () => {
  const r = plan({ companies: [withCs(60)], today: TODAY, config: { ...config, milestones: [90, 60] } });
  assert.equal(r.reminders[0].band, '60');
});

test('the digest names the register for each company and carries the disclaimer', () => {
  const r = plan({ companies: [withCs(5)], today: TODAY, config });
  assert.match(r.digest.body, /find-and-update\.company-information\.service\.gov\.uk\/company\/01234567/);
  assert.match(r.digest.body, /not legal advice/);
});

test('a response for a different company is discarded, never applied', () => {
  const wrong = profile({ number: '09999999', csDue: '2026-10-07', accountsDue: '2030-01-01' });
  const r = plan({ companies: [entry({}, wrong)], today: TODAY, config });
  assert.equal(r.reminders.length, 0, 'the other company dates must not be used');
  assert.equal(r.summary.lookupFailures, 1);
  assert.ok(r.attention.some((a) => /09999999.*discarded/.test(a.reason)));
});

test('a response with no company number is discarded too', () => {
  const noNumber = profile({ csDue: '2026-10-07' });
  delete noNumber.company_number;
  const r = plan({ companies: [entry({}, noNumber)], today: TODAY, config });
  assert.equal(r.reminders.length, 0);
  assert.ok(r.attention.some((a) => /no company number/.test(a.reason)));
});

test('sentLogKeys: keys are read, an empty log is fine, a renamed header is a problem', () => {
  assert.deepEqual(sentLogKeys([{ 'Idempotency Key': ' a ' }, { 'Idempotency Key': '' }]), { keys: ['a'], problem: '' });
  assert.deepEqual(sentLogKeys([{}]), { keys: [], problem: '' });
  assert.deepEqual(sentLogKeys([]), { keys: [], problem: '' });
  assert.deepEqual(sentLogKeys(null), { keys: [], problem: '' });
  assert.deepEqual(sentLogKeys([{ row_number: 2 }]), { keys: [], problem: '' });
  assert.match(sentLogKeys([{ Key: 'a|b' }]).problem, /Idempotency Key/);
  assert.match(sentLogKeys([{ 'Idempotency Key': '', 'Company Number': '1' }]).problem, /Idempotency Key/);
  assert.doesNotThrow(() => sentLogKeys([null, 5, 'x']));
});

test('failRun is set when the run halts, and when every lookup failed, but not otherwise', () => {
  const bad = plan({ companies: [withCs(5)], today: 'nope', config });
  assert.equal(bad.summary.failRun, true);
  assert.ok(bad.summary.failReason);
  const noAddress = plan({ companies: [withCs(5)], today: TODAY, config: { dryRun: false } });
  assert.equal(noAddress.summary.failRun, true);
  const allFail = plan({ companies: [entry({}, { error: { message: '401 Unauthorized' } }), entry({ 'Company Number': '02222222' }, { error: 'x' })], today: TODAY, config });
  assert.equal(allFail.summary.lookupsAllFailed, true);
  assert.equal(allFail.summary.failRun, true);
  assert.match(allFail.summary.failReason, /API key/);
  const ok = plan({ companies: [withCs(5)], today: TODAY, config });
  assert.equal(ok.summary.failRun, false);
  const partial = plan({ companies: [withCs(5), entry({ 'Company Number': '02222222' }, { error: 'x' })], today: TODAY, config });
  assert.equal(partial.summary.failRun, false);
  // Rows that never needed a lookup do not count as failures.
  const skipped = plan({ companies: [entry({ Paused: 'yes' }, null)], today: TODAY, config });
  assert.equal(skipped.summary.failRun, false);
});

test('no company rows read (empty or wrong tab, wrong sheet id) is not a quiet day: it fails the run and says why', () => {
  for (const companies of [[], [{ row: {}, api: null }], [{ row: { row_number: 2 } }], null]) {
    const r = plan({ companies, today: TODAY, config });
    assert.equal(r.summary.rowsRead, 0);
    assert.equal(r.summary.failRun, true);
    assert.match(r.summary.failReason, /no company rows/);
    assert.ok(r.attention.some((a) => /no company rows were read/.test(a.reason)));
  }
  assert.equal(plan({ companies: [withCs(5)], today: TODAY, config }).summary.failRun, false);
});

test('a client draft built on an unconfirmed date carries a staff-only confirmation line; a Companies House date does not', () => {
  const unconfirmed = plan({ companies: [entry({ 'Confirmation Statement Due': addDaysISO(TODAY, 5) }, null)], today: TODAY, config });
  assert.equal(unconfirmed.reminders[0].needsConfirmation, true);
  assert.match(unconfirmed.reminders[0].draft, /\[STAFF: this date has not been confirmed/);
  const confirmed = plan({ companies: [withCs(5)], today: TODAY, config });
  assert.equal(confirmed.reminders[0].needsConfirmation, false);
  assert.doesNotMatch(confirmed.reminders[0].draft, /STAFF/);
});
