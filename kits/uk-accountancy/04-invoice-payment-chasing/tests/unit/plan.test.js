import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan } from '../../src/core/plan.js';
import { loadFixture } from '../helpers/csv.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (n) => loadFixture(join(FIX, n));
const base = { dryRun: false, firmName: 'Smith & Co', senderEmail: 'accounts@smith.co.uk' };
const run = (rows, today, config = {}) => plan({ rows, today, config: { ...base, ...config } });

test('each stage is selected on the right day', () => {
  const r = run(fx('every-stage.csv'), '2026-09-15');
  const byClient = Object.fromEntries(r.actions.map((a) => [a.clientName, a.stage]));
  assert.equal(byClient['Acme Ltd'], 'friendly');       // 10 days overdue
  assert.equal(byClient['Borough Cafe'], 'firm');       // 32 days, friendly already sent
  assert.equal(byClient['Castle Motors'], 'final');     // 67 days, firm already sent
  assert.equal(byClient['Jo Bloggs'], 'friendly');
  assert.equal(r.actions.find((a) => a.clientName === 'Delta Design'), undefined); // not yet due
});

test('a stage is never sent twice', () => {
  const rows = fx('every-stage.csv');
  const first = run(rows, '2026-09-15');
  // Apply the write-backs, then run the same day again.
  for (const wb of first.writeBacks) {
    const row = rows.find((x) => x['Invoice Number'] === wb.invoiceNumber);
    row['Last Chase Stage'] = wb.lastChaseStage;
    row['Last Chased On'] = wb.lastChasedOn;
  }
  const second = run(rows, '2026-09-15');
  assert.equal(second.actions.length, 0, 'a second run on the same day sent something');
});

test('the Late Payment Act paragraph reaches businesses only', () => {
  const r = run(fx('every-stage.csv'), '2026-09-15');
  const castle = r.actions.find((a) => a.clientName === 'Castle Motors'); // business, final
  const jo = r.actions.find((a) => a.clientName === 'Jo Bloggs');          // individual
  assert.match(castle.body, /Late Payment of Commercial Debts/);
  assert.doesNotMatch(jo.body, /Late Payment of Commercial Debts/);
});

test('a final notice does not invent a history of reminders', () => {
  // Castle Motors was genuinely chased before, so the phrase is honest there.
  const withHistory = run(fx('every-stage.csv'), '2026-09-15')
    .actions.find((a) => a.clientName === 'Castle Motors');
  assert.match(withHistory.body, /Despite our earlier reminders/);

  // A backlog invoice reaching final without this system ever chasing it must not.
  const rows = fx('backlog.csv');
  const r = run(rows, '2026-11-20', {}); // 66 days after activation
  const action = r.actions.find((a) => a.clientName === 'Ancient Debt Ltd');
  assert.equal(action.stage, 'final');
  assert.doesNotMatch(action.body, /Despite/);
});

test('long-overdue invoices loaded on day one open with a friendly reminder', () => {
  const r = run(fx('backlog.csv'), '2026-09-22'); // 7 days after activation
  assert.equal(r.actions.length, 2);
  for (const a of r.actions) {
    assert.equal(a.stage, 'friendly', `${a.clientName} opened at ${a.stage}`);
    assert.doesNotMatch(a.body, /Final notice/i);
  }
});

test('one email per client contact, however many invoices are owed', () => {
  const r = run(fx('grouping.csv'), '2026-09-15');
  assert.equal(r.actions.length, 2, 'expected one email per contact');
  const multi = r.actions.find((a) => a.clientName === 'Multi Ltd');
  assert.equal(multi.invoices.length, 3, 'all three invoices should be in one email');
  // INV-5003 is 72 days overdue, so the group is pitched at the worst case:
  // one letter about everything owed, in the tone the oldest debt warrants.
  assert.equal(multi.stage, 'final', 'the group takes the highest stage reached');
  // None of these three was ever chased before, so the notice must not claim it was.
  assert.doesNotMatch(multi.body, /Despite/);
  assert.match(multi.body, /INV-5001/);
  assert.match(multi.body, /INV-5002/);
  assert.match(multi.body, /INV-5003/);
  assert.match(multi.body, /Total outstanding: £600\.00/);
  // Each invoice is still written back at its own stage.
  const multiIds = ['INV-5001', 'INV-5002', 'INV-5003'];
  assert.equal(r.writeBacks.filter((w) => multiIds.includes(w.invoiceNumber)).length, 3);
  // The three invoices are written back at their own stages, not the group's.
  const stages = Object.fromEntries(
    r.writeBacks.filter((w) => multiIds.includes(w.invoiceNumber))
      .map((w) => [w.invoiceNumber, w.lastChaseStage]),
  );
  assert.deepEqual(stages, { 'INV-5001': 'friendly', 'INV-5002': 'firm', 'INV-5003': 'final' });
});

test('only unpaid invoices are chased, and every other status says why', () => {
  const r = run(fx('statuses.csv'), '2026-09-15');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].clientName, 'Unpaid Ltd');
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.invoiceNumber, s.reason]));
  assert.equal(reasons['INV-3001'], 'status is paid');
  assert.equal(reasons['INV-3002'], 'status is disputed');
  assert.equal(reasons['INV-3003'], 'status is payment plan');
  assert.equal(reasons['INV-3004'], 'status is written off');
});

test('messy real-world data is handled or reported, never silently dropped', () => {
  const rows = fx('messy-data.csv');
  const r = run(rows, '2026-09-15');
  assert.equal(r.summary.rowsRead, rows.length);
  assert.equal(
    r.actions.length + r.skipped.length > 0, true,
  );
  // Every row is accounted for: chased, or skipped with a reason.
  const chased = new Set(r.actions.flatMap((a) => a.invoices.map((i) => i.invoiceNumber)));
  const skippedIds = new Set(r.skipped.map((s) => s.invoiceNumber));
  for (const row of rows) {
    const id = String(row['Invoice Number']).trim();
    assert.ok(chased.has(id) || skippedIds.has(id) || id === '',
      `row ${id} vanished without explanation`);
  }
  // Values that a spreadsheet really produces are parsed, not rejected.
  assert.ok(chased.has('INV-2001'), 'currency-formatted amount was rejected');
  assert.ok(chased.has('INV-2002'), 'UK-format date was rejected');
  assert.ok(chased.has('INV-2009'), 'lower-case status was rejected');
  assert.ok(chased.has('INV-2010'), 'padded whitespace was rejected');
  // Values that are genuinely broken are flagged for a human.
  const attention = Object.fromEntries(
    r.skipped.filter((s) => s.needsAttention).map((s) => [s.invoiceNumber, s.reason]),
  );
  assert.match(attention['INV-2003'], /email/);
  assert.match(attention['INV-2004'], /amount/);
  assert.match(attention['INV-2005'], /due date/);
  assert.match(attention['INV-2007'], /status/);
  assert.match(attention['INV-2008'], /client type/i);
  assert.match(attention['INV-2011'], /zero or negative/);
  assert.match(attention['INV-2012'], /zero or negative/);
  assert.ok(r.skipped.some((s) => s.reason === 'no invoice number' && s.needsAttention));
});

test('nothing is sent on a weekend, bank holiday or during the quiet period', () => {
  for (const day of ['2026-09-19', '2026-12-25', '2026-12-29']) {
    const r = run(fx('every-stage.csv'), day);
    assert.equal(r.actions.length, 0, `sent on ${day}`);
    assert.equal(r.summary.sendableDay, false);
  }
});

test('dry run redirects every email and marks the subject', () => {
  const r = run(fx('every-stage.csv'), '2026-09-15',
    { dryRun: true, dryRunRecipient: 'owner@smith.co.uk' });
  assert.ok(r.actions.length > 0);
  for (const a of r.actions) {
    assert.equal(a.to, 'owner@smith.co.uk');
    assert.match(a.subject, /^\[DRY RUN → /);
    assert.notEqual(a.realRecipient, 'owner@smith.co.uk');
  }
});

test('dry run without a recipient halts rather than emailing clients', () => {
  const r = run(fx('every-stage.csv'), '2026-09-15', { dryRun: true, dryRunRecipient: '' });
  assert.equal(r.actions.length, 0);
  assert.equal(r.summary.halted, true);
  assert.match(r.summary.haltReason, /dryRunRecipient/);
});

test('a run above the email ceiling halts instead of sending a partial batch', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    row_number: i + 2,
    'Invoice Number': `INV-${9000 + i}`,
    Client: `Client ${i}`,
    'Client Email': `c${i}@example.com`,
    'Client Type': 'Business',
    'Amount GBP': '100.00',
    'Due Date': '2026-08-01',
    Status: 'Unpaid',
    'Activation Date': '2026-07-01',
  }));
  const ok = run(rows, '2026-09-15', { maxEmailsPerRun: 50 });
  assert.equal(ok.actions.length, 12);

  const halted = run(rows, '2026-09-15', { maxEmailsPerRun: 5 });
  assert.equal(halted.actions.length, 0);
  assert.equal(halted.summary.halted, true);
  assert.match(halted.summary.haltReason, /above the limit/);
});

test('the minimum gap between chases is respected', () => {
  const rows = fx('every-stage.csv');
  const borough = rows.find((r) => r['Invoice Number'] === 'INV-1002');
  borough['Last Chased On'] = '2026-09-12'; // 3 days ago
  const r = run(rows, '2026-09-15', { minDaysBetweenChases: 7 });
  assert.equal(r.actions.find((a) => a.clientName === 'Borough Cafe'), undefined);
  assert.ok(r.skipped.some((s) => s.invoiceNumber === 'INV-1002' && /minimum gap/.test(s.reason)));
});

test('the planner never throws, whatever is in the sheet', () => {
  const junk = [
    null, undefined, 42, 'a string', [],
    {}, { 'Invoice Number': {} }, { 'Invoice Number': 'X', 'Amount GBP': [] },
  ];
  assert.doesNotThrow(() => plan({ rows: junk, today: '2026-09-15', config: base }));
  assert.doesNotThrow(() => plan({ rows: null, today: '2026-09-15', config: base }));
  assert.doesNotThrow(() => plan({ rows: [], today: 'nonsense', config: base }));
  assert.doesNotThrow(() => plan({ rows: [], today: '2026-09-15', config: {} }));
});

test('results are stable: the same input always produces the same output', () => {
  const a = run(fx('grouping.csv'), '2026-09-15');
  const b = run(fx('grouping.csv'), '2026-09-15');
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test('the sent-key ledger prevents a resend even if the sheet lost the stage', () => {
  const rows = fx('every-stage.csv');
  const first = run(rows, '2026-09-15');
  const keys = first.actions.flatMap((a) => a.idempotencyKeys);
  assert.ok(keys.length > 0);

  // The sheet write-back never landed, so Last Chase Stage is still blank,
  // but the ledger recorded the sends. Nothing may go out a second time.
  const second = plan({ rows, today: '2026-09-15', config: base, sentKeys: keys });
  assert.equal(second.actions.length, 0, 'a duplicate escaped the ledger');
  assert.ok(second.skipped.some((s) => /already recorded as sent/.test(s.reason)));
});

test('a group whose invoices are all already in the ledger produces no email', () => {
  const rows = fx('grouping.csv');
  const first = run(rows, '2026-09-15');
  const multi = first.actions.find((a) => a.clientName === 'Multi Ltd');
  const second = plan({ rows, today: '2026-09-15', config: base, sentKeys: multi.idempotencyKeys });
  assert.equal(second.actions.find((a) => a.clientName === 'Multi Ltd'), undefined);
  assert.ok(second.actions.find((a) => a.clientName === 'Solo Ltd'), 'unrelated client was suppressed');
});
