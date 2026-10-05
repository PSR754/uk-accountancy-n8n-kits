import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeLog, fakeMailer, profile } from '../helpers/fakes.js';
import { runOnce } from '../helpers/runner.js';

const config = { practiceEmail: 'practice@example.co.uk', dryRun: false, attentionDigestWeekday: null };
const TODAY = '2026-10-05';

const rows = [
  { 'Company Number': '01111111', 'Company Name': 'One Ltd', 'Company Type': 'Private', 'Confirmation Statement Due': '2026-10-09', 'Accounts Due': '2030-01-01' },
  { 'Company Number': '02222222', 'Company Name': 'Two Ltd', 'Company Type': 'Private', 'Confirmation Statement Due': '2026-10-12', 'Accounts Due': '2030-01-01' },
  { 'Company Number': '03333333', 'Company Name': 'Three Ltd', 'Company Type': 'Private', 'Confirmation Statement Due': '2026-10-20', 'Accounts Due': '2030-01-01' },
];
const okLookup = (n) => profile({ number: n, csDue: rows.find((r) => r['Company Number'] === n)['Confirmation Statement Due'], accountsDue: '2030-01-01' });

/**
 * The environment cannot be proven correct, so it is tested under failure.
 * Each case asserts the two things that matter: no reminder is silently lost,
 * and nothing reaches a client or Companies House.
 */

test('Companies House failing for one company does not stop the others', () => {
  const lookup = (n) => { if (n === '02222222') throw new Error('socket hang up'); return okLookup(n); };
  const res = runOnce({ rows, lookup, mailer: fakeMailer(), log: fakeLog(), today: TODAY, config });
  assert.equal(res.summary.lookupFailures, 1);
  assert.equal(res.reminders.length, 3, 'Two Ltd still reminded from its sheet date');
  const two = res.reminders.find((x) => x.companyNumber === '02222222');
  assert.equal(two.source, 'sheet');
  assert.equal(two.needsConfirmation, true);
  assert.ok(res.attention.some((a) => a.companyNumber === '02222222' && /lookup failed/.test(a.reason)));
});

test('Companies House down entirely: reminders still come from the sheet, flagged, and the run completes', () => {
  const lookup = () => { throw new Error('503 Service Unavailable'); };
  const res = runOnce({ rows, lookup, mailer: fakeMailer(), log: fakeLog(), today: TODAY, config });
  assert.equal(res.summary.lookupFailures, 3);
  assert.equal(res.reminders.length, 3);
  assert.ok(res.reminders.every((x) => x.needsConfirmation));
  assert.equal(res.sent, true);
});

test('rate limited (429) and not-found bodies are reported, not trusted', () => {
  const lookup = (n) => (n === '01111111' ? { statusCode: 429, message: 'Too Many Requests' } : { errors: [{ error: 'company-profile-not-found' }] });
  const res = runOnce({ rows, lookup, mailer: fakeMailer(), log: fakeLog(), today: TODAY, config });
  assert.equal(res.summary.lookupFailures, 3);
  assert.equal(res.reminders.length, 3);
});

test('a malformed API payload cannot crash the run', () => {
  for (const bad of ['<html>gateway</html>', 42, [], [{}], { accounts: 'x', confirmation_statement: 7, company_status: 'active' }, { company_status: 5 }]) {
    assert.doesNotThrow(() => runOnce({ rows, lookup: () => bad, mailer: fakeMailer(), log: fakeLog(), today: TODAY, config }));
  }
});

test('a failed digest email records nothing, so every reminder is raised again next run', () => {
  const log = fakeLog();
  const mailer = fakeMailer();
  mailer.failOnce();
  const first = runOnce({ rows, lookup: okLookup, mailer, log, today: TODAY, config });
  assert.equal(first.sent, false);
  assert.ok(first.sendError);
  assert.equal(log.rows.length, 0, 'a reminder was marked sent although the email failed');

  const second = runOnce({ rows, lookup: okLookup, mailer, log, today: '2026-10-06', config });
  assert.equal(second.sent, true);
  assert.equal(second.reminders.length, 3, 'nothing was lost');
  assert.equal(log.rows.length, 3);

  const third = runOnce({ rows, lookup: okLookup, mailer, log, today: '2026-10-06', config });
  assert.equal(third.reminders.length, 0, 'and nothing is repeated once recorded');
  assert.equal(mailer.sent.length, 1);
});

test('a failed Sent Log write after the email lets the reminders be raised again, never lost', () => {
  const log = fakeLog();
  const mailer = fakeMailer();
  log.failAppendOnce();
  assert.throws(() => runOnce({ rows, lookup: okLookup, mailer, log, today: TODAY, config }));
  assert.equal(mailer.sent.length, 1, 'the practice did get the digest');

  const next = runOnce({ rows, lookup: okLookup, mailer, log, today: '2026-10-06', config });
  // The row that failed was the first append, so none were recorded: all three come round again.
  assert.equal(next.reminders.length, 3);
  // Only the practice is ever emailed.
  assert.ok(mailer.sent.every((m) => m.to === 'practice@example.co.uk'));
});

test('an unreadable Sent Log stops the run: nothing is sent, recorded or re-sent', () => {
  const log = fakeLog();
  const mailer = fakeMailer();
  runOnce({ rows, lookup: okLookup, mailer, log, today: TODAY, config });
  const before = { sent: mailer.sent.length, logged: log.rows.length };
  log.failReadOnce();
  // The workflow has no error handling on this read, so the failure propagates.
  assert.throws(() => runOnce({ rows, lookup: okLookup, mailer, log, today: TODAY, config }), /503/);
  assert.equal(mailer.sent.length, before.sent, 'a digest was sent without knowing what was already reported');
  assert.equal(log.rows.length, before.logged, 'rows were appended twice');
  // Once the Sent Log is readable again nothing is repeated.
  const again = runOnce({ rows, lookup: okLookup, mailer, log, today: TODAY, config });
  assert.equal(again.reminders.length, 0);
});

test('a lookup response that belongs to another company is never applied', () => {
  // Models lost pairing: the response for one company arrives against another's row.
  const lookup = () => profile({ number: '03333333', csDue: '2026-10-06', accountsDue: '2030-01-01' });
  const res = runOnce({ rows: [rows[0]], lookup, mailer: fakeMailer(), log: fakeLog(), today: TODAY, config });
  assert.equal(res.summary.lookupFailures, 1);
  assert.equal(res.reminders[0].dueDate, '2026-10-09', 'the sheet date for the right company was used');
  assert.equal(res.reminders[0].source, 'sheet');
});

test('an empty companies sheet produces a quiet, well-formed run', () => {
  const res = runOnce({ rows: [], lookup: okLookup, mailer: fakeMailer(), log: fakeLog(), today: TODAY, config });
  assert.equal(res.summary.rowsRead, 0);
  assert.equal(res.sent, false);
  assert.equal(res.summary.halted, false);
});

test('dry run end to end: nothing is ever recorded, and going live later loses no reminder', () => {
  const log = fakeLog();
  const mailer = fakeMailer();
  for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
    const res = runOnce({ rows, lookup: okLookup, mailer, log, today: day, config: { ...config, dryRun: true, dryRunRecipient: 'me@example.co.uk' } });
    assert.equal(res.reminders.length, 3, 'dry run keeps showing everything');
  }
  assert.equal(log.rows.length, 0);
  assert.ok(mailer.sent.every((m) => m.to === 'me@example.co.uk' && /^\[DRY RUN\]/.test(m.subject)));

  const live = runOnce({ rows, lookup: okLookup, mailer, log, today: '2026-10-08', config });
  assert.equal(live.reminders.length, 3);
  assert.equal(log.rows.length, 3);
  assert.equal(mailer.sent.at(-1).to, 'practice@example.co.uk');
});

test('a filing that completes (due date moves on) stops the old reminders', () => {
  const log = fakeLog();
  const mailer = fakeMailer();
  const before = () => profile({ number: '01111111', csDue: '2026-10-09', accountsDue: '2030-01-01' });
  const after = () => profile({ number: '01111111', csDue: '2027-10-09', accountsDue: '2030-01-01' });
  const one = [{ 'Company Number': '01111111', 'Company Name': 'One Ltd' }];
  assert.equal(runOnce({ rows: one, lookup: before, mailer, log, today: '2026-10-05', config }).reminders.length, 1);
  assert.equal(runOnce({ rows: one, lookup: after, mailer, log, today: '2026-10-08', config }).reminders.length, 0);
});

test('a stale date left in the sheet after filing keeps reminding, and says why', () => {
  // Safer to nag than to go quiet: the earlier of the two dates is used and the row is flagged.
  const after = () => profile({ number: '01111111', csDue: '2027-10-09', accountsDue: '2030-01-01' });
  const res = runOnce({ rows: [rows[0]], lookup: after, mailer: fakeMailer(), log: fakeLog(), today: '2026-10-08', config });
  assert.equal(res.reminders.length, 1);
  assert.ok(res.attention.some((a) => /Companies House says 2027-10-09 but the sheet says 2026-10-09/.test(a.reason)));
});

test('a company that turns out to be dissolved stops being reminded', () => {
  const lookup = () => profile({ number: '01111111', status: 'dissolved', csDue: '2026-10-09' });
  const res = runOnce({ rows: [rows[0]], lookup, mailer: fakeMailer(), log: fakeLog(), today: TODAY, config });
  assert.equal(res.reminders.length, 0);
});

test('no digest address configured: the run is flagged, nothing is sent, nothing is recorded', () => {
  const log = fakeLog();
  const mailer = fakeMailer();
  const res = runOnce({ rows, lookup: okLookup, mailer, log, today: TODAY, config: { dryRun: false } });
  assert.equal(res.summary.halted, true);
  assert.equal(mailer.sent.length, 0);
  assert.equal(log.rows.length, 0);
});
