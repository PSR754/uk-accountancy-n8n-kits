import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSheet, fakeMailer } from '../helpers/fakes.js';
import { runOnce, runRange } from '../helpers/runner.js';
import { isWeekend } from '../../src/core/dates.js';

const config = { dryRun: false, firmName: 'Smith & Co' };

const deadline = (o) => ({
  'Client Name': 'Acme Ltd', 'Deadline Type': 'VAT return', 'Due Date': '2026-10-15',
  'Contact Email': 'a@acme.co.uk', Status: 'Pending', 'Last Reminder Sent': '',
  'Reminded For Due Date': '', 'Last Reminded On': '', ...o,
});
const sheetOf = (...rows) => fakeSheet(rows.map((r, i) => ({ row_number: i + 2, ...r })));
const sentDates = (days) => days.filter((d) => d.delivered.length).map((d) => d.date);

test('a deadline on a Thursday gets four reminders, each once, on the milestone days', () => {
  const sheet = sheetOf(deadline());
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-09-01', to: '2026-10-20', config });
  // 30 days out, 14, 7, and the day before. 15 Oct 2026 is a Thursday.
  assert.deepEqual(sentDates(days), ['2026-09-15', '2026-10-01', '2026-10-08', '2026-10-14']);
  assert.deepEqual(mailer.sent.map((m) => m.idempotencyKeys[0].split('|').pop()), ['30', '14', '7', '1']);
});

test('a deadline on a Monday is not left without its final reminder by the weekend', () => {
  const sheet = sheetOf(deadline({ 'Due Date': '2026-10-19' }));
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-09-01', to: '2026-10-23', config });
  // 30-day mark is Saturday 19 Sep, so it goes Friday 18. Final goes Friday 16.
  assert.deepEqual(sentDates(days), ['2026-09-18', '2026-10-05', '2026-10-12', '2026-10-16']);
});

test('the sheet records each reminder, so the next morning starts from the truth', () => {
  const sheet = sheetOf(deadline());
  runOnce({ sheet, mailer: fakeMailer(), today: '2026-09-15', config });
  const r = sheet.state[0];
  assert.equal(r['Last Reminder Sent'], 30);
  assert.equal(r['Reminded For Due Date'], '2026-10-15');
  assert.equal(r['Last Reminded On'], '2026-09-15');
  assert.equal(sheet.calls.updates.length, 1);
});

test('92 consecutive runs against an unchanged sheet send no duplicates', () => {
  const sheet = sheetOf(deadline(), deadline({ 'Client Name': 'Borough Cafe', 'Contact Email': 'b@c.co.uk', 'Due Date': '2026-11-06' }));
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-09-01', to: '2026-12-01', config });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
  assert.equal(keys.length, 8, 'two deadlines, four reminders each');
});

test('reminders stop the day after a deadline is marked Filed', () => {
  const sheet = sheetOf(deadline());
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-09-01', to: '2026-10-03', config }); // 30 and 14 sent
  assert.equal(mailer.sent.length, 2);
  sheet.state[0].Status = 'Filed';
  runRange({ sheet, mailer, from: '2026-10-04', to: '2026-10-20', config });
  assert.equal(mailer.sent.length, 2, 'a reminder went out for a filed deadline');
});

test('a missed run day is caught up rather than lost', () => {
  const sheet = sheetOf(deadline());
  const mailer = fakeMailer();
  // n8n was down for the whole of 30 Sep to 7 Oct. The 14 and 7 milestones both
  // passed. Back up on 8 Oct, the client gets one reminder, the tightest reached.
  runRange({ sheet, mailer, from: '2026-09-01', to: '2026-09-29', config });
  runRange({ sheet, mailer, from: '2026-10-08', to: '2026-10-13', config });
  assert.deepEqual(mailer.sent.map((m) => m.idempotencyKeys[0].split('|').pop()), ['30', '7']);
});

test('a sheet activated late starts with the tightest milestone, not a burst', () => {
  const sheet = sheetOf(deadline({ 'Due Date': '2026-09-20' }));
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-09-15', to: '2026-09-25', config });
  assert.deepEqual(mailer.sent.map((m) => m.idempotencyKeys[0].split('|').pop()), ['7', '1']);
});

test('a recurring deadline rolled to next year is reminded again', () => {
  const sheet = sheetOf(deadline());
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-09-01', to: '2026-10-20', config });
  assert.equal(mailer.sent.length, 4);
  // The practice files, then moves the same row on to the next period. The
  // "Last Reminder Sent" cell still says 1, which must not silence the new date.
  sheet.state[0]['Due Date'] = '2027-10-15';
  sheet.state[0].Status = 'Pending';
  runRange({ sheet, mailer, from: '2026-10-21', to: '2027-10-20', config });
  assert.equal(mailer.sent.length, 8);
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
});

test('a due date moved later restarts the ladder at the right point', () => {
  const sheet = sheetOf(deadline());
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-09-01', to: '2026-10-09', config }); // 30, 14, 7 sent
  sheet.state[0]['Due Date'] = '2026-11-20'; // HMRC extension agreed, say
  runRange({ sheet, mailer, from: '2026-10-10', to: '2026-11-25', config });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(keys.some((k) => k.startsWith('acme ltd|vat return|2026-11-20|30')));
  assert.ok(keys.some((k) => k.endsWith('|1') && k.includes('2026-11-20')));
});

test('a client with several deadlines gets one email per run, not one per deadline', () => {
  const sheet = sheetOf(
    deadline({ 'Due Date': '2026-10-15' }),
    deadline({ 'Deadline Type': 'Corporation Tax payment', 'Due Date': '2026-10-15' }),
    deadline({ 'Deadline Type': 'Confirmation statement', 'Due Date': '2026-10-15' }),
  );
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-09-01', to: '2026-10-20', config });
  for (const d of days) assert.ok(d.delivered.length <= 1, `${d.date} sent ${d.delivered.length}`);
  assert.equal(mailer.sent.length, 4);
  assert.equal(sheet.calls.updates.length, 12, 'three rows updated at each of four reminders');
});

test('nothing is ever sent on a non-working day across a year of rolling deadlines', () => {
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    const month = String(1 + (i % 12)).padStart(2, '0');
    rows.push(deadline({
      'Client Name': `Client ${i}`, 'Contact Email': `c${i}@x.co.uk`,
      'Due Date': `2026-${month}-${day}`,
    }));
  }
  const sheet = sheetOf(...rows);
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-01-01', to: '2026-12-31', config });
  const holidays = new Set(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
    '2026-08-31', '2026-12-25', '2026-12-28']);
  for (const d of days.filter((x) => x.delivered.length)) {
    assert.equal(isWeekend(d.date), false, `${d.date} is a weekend`);
    assert.equal(holidays.has(d.date), false, `${d.date} is a bank holiday`);
    assert.ok(d.date < '2026-12-24' || d.date > '2027-01-01', `${d.date} is in the shutdown`);
  }
  assert.ok(mailer.sent.length > 40);
});

test('DRY RUN: a fortnight of dry runs writes nothing, and going live then sends what is due', () => {
  const sheet = sheetOf(deadline());
  const mailer = fakeMailer();
  const dry = { dryRun: true, dryRunRecipient: 'owner@smith.co.uk', firmName: 'Smith & Co' };
  const days = runRange({ sheet, mailer, from: '2026-09-15', to: '2026-09-28', config: dry });
  assert.ok(mailer.sent.length > 0, 'the dry run should still deliver previews to the owner');
  assert.ok(mailer.sent.every((m) => m.to === 'owner@smith.co.uk'));
  assert.equal(sheet.calls.updates.length, 0, 'a dry run wrote to the Deadlines tab');
  assert.equal(mailer.seenKeys.size, 0, 'a dry run recorded ledger keys');
  assert.equal(sheet.state[0]['Last Reminder Sent'], '');
  // The same reminder is planned again each day the milestone is still the tightest reached.
  assert.ok(days.filter((d) => d.actions.length).length > 1);

  // Switch dry run off. The deadline is 15 Oct; on 29 Sep it has 16 days to go.
  const live = runOnce({ sheet, mailer, today: '2026-09-29', config });
  assert.equal(live.delivered.length, 1, 'switching DRY_RUN off must not suppress the reminder that is due');
  assert.equal(live.delivered[0].to, 'a@acme.co.uk');
  assert.equal(sheet.state[0]['Last Reminder Sent'], 30); // 16 days out: the 30-day reminder
  assert.equal(runOnce({ sheet, mailer, today: '2026-09-30', config }).delivered.length, 0);
});
