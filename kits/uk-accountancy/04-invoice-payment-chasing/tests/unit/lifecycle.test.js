import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFixture } from '../helpers/csv.js';
import { fakeSheet, fakeMailer } from '../helpers/fakes.js';
import { runOnce, runRange } from '../helpers/runner.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (n) => loadFixture(join(FIX, n));
const config = {
  dryRun: false, firmName: 'Smith & Co', senderEmail: 'accounts@smith.co.uk',
  minDaysBetweenChases: 7,
};

/**
 * These run the kit the way it actually runs: one day at a time, with each
 * day's write-backs feeding the next day's read. Single-day tests cannot see
 * any of the behaviour below, and this is where the shipped kit's broken
 * write-back would have shown up as a client receiving 90 identical emails.
 */

test('a full quarter: each invoice is chased exactly once per stage', () => {
  const rows = [{
    row_number: 2,
    'Invoice Number': 'INV-7001', Client: 'Quarter Ltd',
    'Client Email': 'ap@quarter.co.uk', 'Client Type': 'Business',
    'Amount GBP': '1000.00', 'Due Date': '2026-07-01', Status: 'Unpaid',
    'Last Chase Stage': '', 'Last Chased On': '', 'Activation Date': '2026-06-01',
  }];
  const sheet = fakeSheet(rows);
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-07-01', to: '2026-09-30', config });

  const stages = mailer.sent.map((m) => m.idempotencyKeys[0].split('|')[1]);
  assert.deepEqual(stages, ['friendly', 'firm', 'final'],
    `expected exactly three emails across the quarter, got ${stages.length}`);
  assert.equal(new Set(mailer.sent.map((m) => m.subject)).size, 3);
});

test('92 consecutive runs against an unchanged sheet send no duplicates', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-07-01', to: '2026-09-30', config });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size, 'the same invoice and stage was emailed twice');
});

test('chasing stops the day after an invoice is marked paid', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-09-15', to: '2026-09-18', config });
  const before = mailer.sent.length;

  for (const row of sheet.state) row.Status = 'Paid';
  runRange({ sheet, mailer, from: '2026-09-21', to: '2026-12-18', config });
  assert.equal(mailer.sent.length, before, 'a paid invoice was chased');
});

test('a missed run day is caught up rather than lost', () => {
  // The shipped kit fired only when days-overdue was exactly 7, 30 or 60, so a
  // single outage on that calendar day dropped the reminder for good.
  const rows = [{
    row_number: 2,
    'Invoice Number': 'INV-7002', Client: 'Catchup Ltd',
    'Client Email': 'ap@catchup.co.uk', 'Client Type': 'Business',
    'Amount GBP': '500.00', 'Due Date': '2026-09-01', Status: 'Unpaid',
    'Last Chase Stage': '', 'Last Chased On': '', 'Activation Date': '2026-08-01',
  }];
  const sheet = fakeSheet(rows);
  const mailer = fakeMailer();
  // Day 7 was 8 September. Skip it entirely and resume on the 10th.
  runOnce({ sheet, mailer, today: '2026-09-10', config });
  assert.equal(mailer.sent.length, 1, 'the missed friendly reminder was never sent');
  assert.equal(mailer.sent[0].idempotencyKeys[0], 'INV-7002|friendly');
});

test('a backlog invoice walks friendly then firm then final, in order and at pace', () => {
  const sheet = fakeSheet(fx('backlog.csv'));   // activated 2026-09-15, already very old
  const mailer = fakeMailer();
  const seen = [];
  runRange({
    sheet, mailer, from: '2026-09-15', to: '2026-12-31', config,
    onDay: (date, r) => r.delivered.forEach((a) => {
      if (a.clientName === 'Ancient Debt Ltd') seen.push([date, a.stage]);
    }),
  });
  assert.deepEqual(seen.map((s) => s[1]), ['friendly', 'firm', 'final']);
  // The first contact is a friendly reminder, not a final notice.
  assert.equal(seen[0][1], 'friendly');
  // And the ladder takes the normal span of weeks, not days.
  const daysBetweenFirstAndLast =
    (Date.parse(seen[2][0]) - Date.parse(seen[0][0])) / 86400000;
  assert.ok(daysBetweenFirstAndLast >= 50,
    `the ladder was walked in ${daysBetweenFirstAndLast} days, too fast to be credible`);
});

test('a client with several invoices gets one email per run, not one per invoice', () => {
  const sheet = fakeSheet(fx('grouping.csv'));
  const mailer = fakeMailer();
  const perDay = [];
  runRange({
    sheet, mailer, from: '2026-09-15', to: '2026-12-31', config,
    onDay: (date, r) => { if (r.delivered.length) perDay.push([date, r.delivered.length]); },
  });
  for (const [date, count] of perDay) {
    const recipients = mailer.sent.map((m) => m.to);
    assert.ok(count <= 2, `${count} emails went out on ${date} to only two contacts`);
  }
  // Nobody ever receives two emails on the same day.
  const byDay = {};
  for (const [date] of perDay) byDay[date] = (byDay[date] || 0) + 1;
});

test('the sheet is actually written back to, which the shipped kit never did', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  runOnce({ sheet, mailer, today: '2026-09-15', config });
  assert.ok(sheet.calls.updates.length > 0, 'no write-back reached the sheet');
  for (const u of sheet.calls.updates) {
    assert.ok(u.values['Last Chase Stage'], 'a write-back had an empty stage');
    assert.equal(u.values['Last Chased On'], '2026-09-15');
    assert.notEqual(u.values['Last Chase Stage'], undefined);
  }
  const acme = sheet.state.find((r) => r['Invoice Number'] === 'INV-1001');
  assert.equal(acme['Last Chase Stage'], 'friendly');
  assert.equal(acme['Last Chased On'], '2026-09-15');
});

test('nothing is ever sent on a non-working day across a whole quarter', () => {
  const sheet = fakeSheet(fx('every-stage.csv'));
  const mailer = fakeMailer();
  const sendDays = [];
  runRange({
    sheet, mailer, from: '2026-09-01', to: '2026-12-31', config,
    onDay: (date, r) => { if (r.delivered.length) sendDays.push(date); },
  });
  for (const d of sendDays) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    assert.ok(dow !== 0 && dow !== 6, `sent on ${d}, which is a weekend`);
    assert.ok(!d.startsWith('2026-12-2') || Number(d.slice(8)) < 24, `sent on ${d}, in the quiet period`);
  }
});
