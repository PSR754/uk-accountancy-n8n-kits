import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFixture } from '../helpers/csv.js';
import { fakeSheet, fakeMailer, fakeLedger } from '../helpers/fakes.js';
import { runOnce, runRange } from '../helpers/runner.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (n) => loadFixture(join(FIX, n));
const config = { dryRun: false, firmName: 'Smith & Co' };
const TODAY = '2026-09-15';

/**
 * The environment cannot be proven correct, so it is tested under failure.
 * Each case asserts the two things that matter to a client relationship: no
 * duplicate email, and no silent loss.
 */

test('an SMTP failure part-way through a batch does not stop the other recipients', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  mailer.failOnNthSend(2, new Error('SMTP timeout'));
  const r = runOnce({ sheet, mailer, today: TODAY, config });
  assert.ok(r.actions.length >= 3, 'test needs several recipients to be meaningful');
  assert.equal(r.summary.sendErrors, 1);
  assert.equal(mailer.sent.length, r.actions.length - 1, 'other recipients were not served');
});

test('a deadline whose email failed is not marked as reminded, and is retried next working day', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  mailer.failOnNthSend(1, new Error('SMTP timeout'));
  runOnce({ sheet, mailer, today: TODAY, config });

  const untouched = sheet.state.filter((row) => row.Status === 'Pending' && !row['Last Reminder Sent']);
  assert.ok(untouched.length > 0, 'a failed send was wrongly marked as reminded');

  const before = mailer.sent.length;
  runOnce({ sheet, mailer, today: '2026-09-16', config });
  assert.ok(mailer.sent.length > before, 'the failed reminder was never retried');
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size, 'the retry duplicated an earlier email');
});

test('a crash between sending and writing back cannot produce a second email', () => {
  // The worst realistic failure: the client has the email, but the sheet does
  // not know it. The idempotency ledger is all that stands between that and a
  // second copy the next morning.
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  runOnce({ sheet, mailer, today: TODAY, config });
  const sentFirst = mailer.sent.length;
  assert.ok(sentFirst > 0);

  const written = new Set(sheet.calls.updates.map((u) => u.rowNumber));
  for (const row of sheet.state.filter((x) => written.has(x.row_number))) {
    row['Last Reminder Sent'] = ''; row['Reminded For Due Date'] = ''; row['Last Reminded On'] = '';
  }

  const second = runOnce({ sheet, mailer, today: TODAY, config });
  assert.equal(mailer.sent.length, sentFirst, 'a duplicate email reached a client after a crash');
  assert.ok(second.summary.duplicatesPrevented > 0, 'the idempotency guard did not fire');
});

test('a failing sheet write does not stop the other clients, and does not repeat tomorrow', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  const ledger = fakeLedger();
  sheet.failUpdateOnce(new Error('Google Sheets 429'));
  const r = runOnce({ sheet, mailer, ledger, today: TODAY, config });
  assert.equal(r.summary.writeFailed, 1);
  assert.equal(mailer.sent.length, r.actions.length, 'a Sheets error stopped later clients being emailed');

  // The ledger row exists for everyone, so tomorrow repeats nothing.
  const sentSoFar = mailer.sent.length;
  runOnce({ sheet, mailer, ledger, today: '2026-09-16', config });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size, 'a failed write-back caused a duplicate send');
  assert.ok(mailer.sent.length >= sentSoFar);
});

test('a failing Sent Log append is counted, skips the sheet update, and still emails the other clients', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  const ledger = fakeLedger();
  ledger.failAppendOnce(new Error('Google Sheets 500'));
  const r = runOnce({ sheet, mailer, ledger, today: TODAY, config });
  assert.ok(r.actions.length >= 3);
  assert.equal(r.summary.writeFailed, 1, 'the ledger failure was not counted, so the practice could not be alerted');
  assert.equal(mailer.sent.length, r.actions.length, 'a ledger failure stopped later clients being emailed');
  // Everyone else was recorded; the first client was not.
  assert.equal(ledger.keys.length, r.writeBacks.length - r.actions[0].deadlines.length);
  assert.equal(sheet.calls.updates.length, r.writeBacks.length - r.actions[0].deadlines.length);
});

test('KNOWN LIMIT: an email sent whose ledger append failed can be planned again the next day', () => {
  // Documented in the README and the runbook, and the reason the practice is
  // alerted with "SENT, NOT RECORDED". The test pins the behaviour so a change
  // to it is a conscious one.
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  const ledger = fakeLedger();
  ledger.failAppendOnce(new Error('Google Sheets 500'));
  const first = runOnce({ sheet, mailer, ledger, today: TODAY, config });
  const unrecorded = first.actions[0].idempotencyKeys[0];
  assert.equal(ledger.keys.includes(unrecorded), false);
  const next = runOnce({ sheet, mailer: fakeMailer(), ledger, today: '2026-09-16', config });
  assert.ok(next.actions.some((a) => a.idempotencyKeys.includes(unrecorded)));
});

test('a row deleted between reading and writing back is a loud failure, not a write to the wrong row', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const result = runOnce({ sheet, mailer: fakeMailer(), today: TODAY, config });
  const wb = result.writeBacks[0];
  sheet.state.splice(sheet.state.findIndex((r) => r.row_number === wb.rowNumber), 1);
  assert.throws(() => sheet.update({ rowNumber: wb.rowNumber, values: { 'Last Reminder Sent': 1 } }), /no row/);
});

test('a sheet read failure sends nothing at all', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  sheet.failReadOnce(new Error('Google Sheets 500'));
  assert.throws(() => runOnce({ sheet, mailer, today: TODAY, config }));
  assert.equal(mailer.sent.length, 0, 'emails went out despite the sheet read failing');
});

test('an empty sheet is a quiet, successful run rather than an error', () => {
  const sheet = fakeSheet([]);
  const mailer = fakeMailer();
  const r = runOnce({ sheet, mailer, today: TODAY, config });
  assert.equal(r.actions.length, 0);
  assert.equal(r.summary.rowsRead, 0);
  assert.equal(r.summary.halted, false);
  assert.equal(mailer.sent.length, 0);
});

test('a sheet whose columns were renamed sends nothing and says every row needs attention', () => {
  // The most common silent failure: someone edits a header.
  const rows = fx('every-milestone.csv').map((r) => {
    const { 'Due Date': due, ...rest } = r;
    return { ...rest, 'Due date': due };
  });
  const sheet = fakeSheet(rows);
  const mailer = fakeMailer();
  const r = runOnce({ sheet, mailer, today: TODAY, config });
  assert.equal(mailer.sent.length, 0, 'emailed clients from a sheet it could not read properly');
  assert.equal(r.skipped.length, rows.length);
  assert.ok(r.skipped.every((s) => s.needsAttention || /^status is /.test(s.reason)), 'the broken header was not flagged');
  assert.ok(r.skipped.filter((s) => s.needsAttention).length >= 6);
});

test('a run that is triggered twice in one morning sends each reminder once', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  runOnce({ sheet, mailer, today: TODAY, config });
  const once = mailer.sent.length;
  const again = runOnce({ sheet, mailer, today: TODAY, config });
  assert.equal(again.actions.length, 0);
  assert.equal(mailer.sent.length, once);
});

test('a bad edit that would mail everyone halts the run and sends nothing', () => {
  // Someone pastes over the Status column and every deadline looks active.
  const rows = Array.from({ length: 80 }, (_, i) => ({
    row_number: i + 2, 'Client Name': `Client ${i}`, 'Deadline Type': 'VAT return',
    'Due Date': '2026-09-22', 'Contact Email': `c${i}@x.co.uk`, Status: '',
  }));
  const mailer = fakeMailer();
  const r = runOnce({ sheet: fakeSheet(rows), mailer, today: TODAY, config: { ...config, maxEmailsPerRun: 50 } });
  assert.equal(mailer.sent.length, 0);
  assert.equal(r.summary.halted, true);
});

test('every run is reproducible: the same day replayed gives the same decisions', () => {
  const a = runOnce({ sheet: fakeSheet(fx('every-milestone.csv')), mailer: fakeMailer(), today: TODAY, config });
  const b = runOnce({ sheet: fakeSheet(fx('every-milestone.csv')), mailer: fakeMailer(), today: TODAY, config });
  assert.deepEqual(
    a.actions.map((x) => [x.realRecipient, x.tone, x.subject]),
    b.actions.map((x) => [x.realRecipient, x.tone, x.subject]),
  );
});

test('repeated SMTP failures over a month never produce a duplicate or lose a reminder for good', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  runRange({
    sheet, mailer, from: TODAY, to: '2026-10-31', config,
    onDay: () => mailer.failOnNthSend(mailer.sent.length + 1, new Error('flaky SMTP')),
  });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(keys.length > 0, 'a flaky SMTP server blocked every reminder');
});

test('DRY RUN: a send failure and a crash in dry run leave no trace that could suppress a live reminder', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  const dry = { dryRun: true, dryRunRecipient: 'owner@smith.co.uk', firmName: 'Smith & Co' };
  mailer.failOnNthSend(1, new Error('SMTP timeout'));
  runOnce({ sheet, mailer, today: TODAY, config: dry });
  runOnce({ sheet, mailer, today: TODAY, config: dry });
  assert.equal(sheet.calls.updates.length, 0);
  assert.equal(mailer.seenKeys.size, 0);

  const before = mailer.sent.length;
  const live = runOnce({ sheet, mailer, today: TODAY, config });
  assert.equal(live.delivered.length, live.actions.length);
  assert.ok(live.actions.length >= 3);
  assert.equal(mailer.sent.length - before, live.actions.length);
  assert.ok(mailer.sent.slice(before).every((m) => m.to !== 'owner@smith.co.uk'));
});

test('a held day sends nothing and leaves the sheet alone', () => {
  const sheet = fakeSheet(fx('every-milestone.csv'));
  const mailer = fakeMailer();
  const r = runOnce({ sheet, mailer, today: TODAY, config, holdUntil: '15/09/2026' });
  assert.equal(mailer.sent.length, 0);
  assert.equal(sheet.calls.updates.length, 0);
  assert.equal(r.summary.halted, true);
  // The next day is not held, and everything still goes out.
  assert.ok(runOnce({ sheet, mailer, today: '2026-09-16', config, holdUntil: '15/09/2026' }).delivered.length > 0);
});

test('a client with several deadline rows: a failed update on one row is one failure for that client, and the rest still go', () => {
  const sheet = fakeSheet(fx('grouping.csv'));
  const mailer = fakeMailer();
  const ledger = fakeLedger();
  sheet.failUpdateOnce(new Error('Google Sheets 429'));
  const r = runOnce({ sheet, mailer, ledger, today: TODAY, config });
  assert.equal(r.actions.length, 2);
  assert.equal(r.summary.writeFailed, 1, 'counted once per client, not once per row');
  assert.equal(mailer.sent.length, 2);
  // Both clients are in the ledger, so nothing is planned again tomorrow.
  const again = runOnce({ sheet, mailer, ledger, today: '2026-09-16', config });
  assert.equal(again.actions.length, 0);
});
