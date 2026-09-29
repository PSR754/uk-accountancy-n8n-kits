import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFixture } from '../helpers/csv.js';
import { fakeSheet, fakeMailer } from '../helpers/fakes.js';
import { runOnce, runRange } from '../helpers/runner.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (n) => loadFixture(join(FIX, n));
const config = { dryRun: false, firmName: 'Smith & Co', minDaysBetweenChases: 7 };

/**
 * The environment cannot be proven correct, so it is tested under failure.
 * Each case asserts the two things that actually matter to a client
 * relationship: no duplicate email, and no silent loss.
 */

test('an SMTP failure part-way through a batch does not stop the other recipients', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  mailer.failOnNthSend(2, new Error('SMTP timeout'));
  const r = runOnce({ sheet, mailer, today: '2026-09-15', config });
  assert.ok(r.actions.length >= 3, 'test needs several recipients to be meaningful');
  assert.equal(r.summary.sendErrors, 1);
  assert.equal(mailer.sent.length, r.actions.length - 1, 'other recipients were not served');
});

test('an invoice whose email failed is not marked as chased, and is retried tomorrow', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  mailer.failOnNthSend(1, new Error('SMTP timeout'));
  runOnce({ sheet, mailer, today: '2026-09-15', config });

  const failedFirst = sheet.state.filter((row) => !row['Last Chase Stage']);
  assert.ok(failedFirst.length > 0, 'a failed send was wrongly marked as chased');

  // Next working day, the failed one goes out and nothing else is repeated.
  const before = mailer.sent.length;
  runOnce({ sheet, mailer, today: '2026-09-16', config });
  assert.ok(mailer.sent.length > before, 'the failed invoice was never retried');
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size, 'the retry duplicated an earlier email');
});

test('a crash between sending and writing back cannot produce a second email', () => {
  // This is the worst realistic failure: the client has the email, but the
  // sheet does not know it. The idempotency guard is the only thing standing
  // between that and a second copy the next morning.
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  const first = runOnce({ sheet, mailer, today: '2026-09-15', config });
  const sentFirst = mailer.sent.length;
  assert.ok(sentFirst > 0);

  // Simulate the write-back never landing: roll the sheet back.
  for (const row of sheet.state) { row['Last Chase Stage'] = ''; row['Last Chased On'] = ''; }

  const second = runOnce({ sheet, mailer, today: '2026-09-15', config });
  assert.equal(mailer.sent.length, sentFirst, 'a duplicate email reached a client after a crash');
  assert.ok(second.summary.duplicatesPrevented > 0, 'the idempotency guard did not fire');
});

test('a failing sheet write does not send the same email again the next day', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  sheet.failUpdateOnce(new Error('Google Sheets 429'));
  assert.throws(() => runOnce({ sheet, mailer, today: '2026-09-15', config }));

  // The run aborted after at least one send. Tomorrow must not repeat it.
  const sentSoFar = mailer.sent.length;
  runOnce({ sheet, mailer, today: '2026-09-16', config });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size, 'a failed write-back caused a duplicate send');
  assert.ok(mailer.sent.length >= sentSoFar);
});

test('a sheet read failure sends nothing at all', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  sheet.failReadOnce(new Error('Google Sheets 500'));
  assert.throws(() => runOnce({ sheet, mailer, today: '2026-09-15', config }));
  assert.equal(mailer.sent.length, 0, 'emails went out despite the sheet read failing');
});

test('an empty sheet is a quiet, successful run rather than an error', () => {
  const sheet = fakeSheet([]);
  const mailer = fakeMailer();
  const r = runOnce({ sheet, mailer, today: '2026-09-15', config });
  assert.equal(r.actions.length, 0);
  assert.equal(r.summary.rowsRead, 0);
  assert.equal(r.summary.halted, false);
  assert.equal(mailer.sent.length, 0);
});

test('a sheet whose columns were renamed sends nothing and says every row needs attention', () => {
  // The most common silent failure: someone edits a header.
  const rows = fx('every-stage.csv').map((r) => {
    const { 'Due Date': due, ...rest } = r;
    return { ...rest, 'Due date': due };
  });
  const sheet = fakeSheet(rows);
  const mailer = fakeMailer();
  const r = runOnce({ sheet, mailer, today: '2026-09-15', config });
  assert.equal(mailer.sent.length, 0, 'emailed clients from a sheet it could not read properly');
  assert.equal(r.skipped.length, rows.length);
  assert.ok(r.skipped.every((s) => s.needsAttention), 'the broken header was not flagged');
});

test('every run is reproducible: the same day replayed gives the same decisions', () => {
  const a = runOnce({ sheet: fakeSheet(fx('every-stage.csv')), mailer: fakeMailer(), today: '2026-09-15', config });
  const b = runOnce({ sheet: fakeSheet(fx('every-stage.csv')), mailer: fakeMailer(), today: '2026-09-15', config });
  assert.deepEqual(
    a.actions.map((x) => [x.realRecipient, x.stage, x.subject]),
    b.actions.map((x) => [x.realRecipient, x.stage, x.subject]),
  );
});

test('repeated SMTP failures over a fortnight never produce a duplicate', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  runRange({
    sheet, mailer, from: '2026-09-15', to: '2026-09-30', config,
    onDay: () => mailer.failOnNthSend(mailer.sent.length + 1, new Error('flaky SMTP')),
  });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
});
