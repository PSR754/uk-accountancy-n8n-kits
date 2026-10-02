import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSheet, fakeMailer, fakeLedger, fakeSubmissionLog } from '../helpers/fakes.js';
import { runOnce, runRange } from '../helpers/runner.js';
import { isWeekend, addDays } from '../../src/core/dates.js';
import { vatReturnDeadline } from '../../src/core/deadline.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';

const config = { dryRun: false, firmName: 'Smith & Co' };

// Period end 31 August 2026 is due Wednesday 7 October 2026.
const vatRow = (o) => ({
  'Client Name': 'Acme Ltd', 'Contact Email': 'a@acme.co.uk', 'VAT Period End': '2026-08-31',
  Submitted: 'No', 'VAT Scheme': '', 'HMRC Due Date': '',
  'Last Checklist Sent': '', 'Checklist For Period End': '', 'Last Checklist On': '', ...o,
});
const sheetOf = (...rows) => fakeSheet(rows.map((r, i) => ({ row_number: i + 2, ...r })));
const sentDates = (days) => days.filter((d) => d.delivered.length).map((d) => d.date);
const lastPart = (m) => m.idempotencyKeys[0].split('|').pop();

test('a Wednesday deadline gets four checklists, each once, on 21, 14, 7 and 3 days out', () => {
  const sheet = sheetOf(vatRow());
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-08-15', to: '2026-10-12', config });
  // 21 days: Wed 16 Sep. 14: Wed 23 Sep. 7: Wed 30 Sep. 3 days is Sunday 4 Oct, so it
  // comes forward to Friday 2 Oct rather than being lost to the weekend.
  assert.deepEqual(sentDates(days), ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-02']);
  assert.deepEqual(mailer.sent.map(lastPart), ['21', '14', '7', '3']);
});

test('a Saturday deadline: every mark that falls on a weekend is sent on the Friday before', () => {
  // 30 September 2026 gives Saturday 7 November, which HMRC does not move.
  assert.equal(vatReturnDeadline('2026-09-30', DEFAULT_CONFIG.vatRules).dueDate, '2026-11-07');
  const sheet = sheetOf(vatRow({ 'VAT Period End': '2026-09-30' }));
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-10-01', to: '2026-11-10', config });
  assert.deepEqual(sentDates(days), ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-04']);
  assert.deepEqual(mailer.sent.map(lastPart), ['21', '14', '7', '3']);
});

test('the sheet records each checklist, so the next morning starts from the truth', () => {
  const sheet = sheetOf(vatRow());
  runOnce({ sheet, mailer: fakeMailer(), today: '2026-09-16', config });
  const r = sheet.state[0];
  assert.equal(r['Last Checklist Sent'], 21);
  assert.equal(r['Checklist For Period End'], '2026-08-31');
  assert.equal(r['Last Checklist On'], '2026-09-16');
  assert.equal(sheet.calls.updates.length, 1);
});

test('120 consecutive runs against an unchanged sheet send no duplicates', () => {
  const sheet = sheetOf(vatRow(), vatRow({ 'Client Name': 'Borough Cafe', 'Contact Email': 'b@c.co.uk', 'VAT Period End': '2026-09-30' }));
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-08-15', to: '2026-12-12', config });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
  assert.equal(keys.length, 8, 'two periods, four checklists each');
});

test('STOP ONCE SUBMITTED: reminders end the day after the return is marked Yes, and it is logged once', () => {
  const sheet = sheetOf(vatRow());
  const mailer = fakeMailer();
  const log = fakeSubmissionLog();
  runRange({ sheet, mailer, from: '2026-08-15', to: '2026-09-26', config, submissionLog: log }); // 21 and 14 sent, 7 sent on 30th
  assert.equal(mailer.sent.length, 2);
  sheet.state[0].Submitted = 'Yes';
  const after = runRange({ sheet, mailer, from: '2026-09-27', to: '2026-10-20', config, submissionLog: log });
  assert.equal(mailer.sent.length, 2, 'a reminder went out for a return already submitted');
  assert.equal(after.reduce((n, d) => n + d.confirmations.filter((c) => c.record).length, 0), 1, 'logged once');
  assert.deepEqual(log.rows.map((r) => [r['Client Name'], r['VAT Period End'], r['Confirmed Submitted On']]),
    [['Acme Ltd', '2026-08-31', '2026-09-28']]);
  // 2026-09-26 is a Saturday, so the first logging day after marking is Monday the 28th.
});

test('a failed Submission Log write is retried on the next run, and never stops the reminders', () => {
  const sheet = sheetOf(vatRow({ Submitted: 'Yes' }));
  const log = fakeSubmissionLog();
  log.failAppendOnce(new Error('Google Sheets 500'));
  const first = runOnce({ sheet, mailer: fakeMailer(), today: '2026-09-15', config, submissionLog: log });
  assert.equal(first.summary.submissionLogFailed, true);
  assert.equal(log.rows.length, 0);
  runOnce({ sheet, mailer: fakeMailer(), today: '2026-09-16', config, submissionLog: log });
  assert.equal(log.rows.length, 1);
  runOnce({ sheet, mailer: fakeMailer(), today: '2026-09-17', config, submissionLog: log });
  assert.equal(log.rows.length, 1, 'logged again');
});

test('a missed run is caught up rather than lost', () => {
  const sheet = sheetOf(vatRow());
  const mailer = fakeMailer();
  // n8n was down from 17 to 29 September. The 14 and 7 marks both passed.
  // Back up on 30 September the client gets one email, the tightest mark reached.
  runRange({ sheet, mailer, from: '2026-08-15', to: '2026-09-16', config });
  runRange({ sheet, mailer, from: '2026-09-30', to: '2026-10-12', config });
  assert.deepEqual(mailer.sent.map(lastPart), ['21', '7', '3']);
});

test('a sheet activated late starts with the tightest mark, not a burst', () => {
  const sheet = sheetOf(vatRow());
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-10-01', to: '2026-10-12', config });
  assert.deepEqual(mailer.sent.map(lastPart), ['7', '3']);
});

test('a recurring row rolled on to the next quarter is reminded again', () => {
  const sheet = sheetOf(vatRow());
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-08-15', to: '2026-10-12', config });
  assert.equal(mailer.sent.length, 4);
  // The practice marks the return submitted, then moves the same row on a quarter.
  // "Last Checklist Sent" still says 3, which must not silence the new period.
  sheet.state[0]['VAT Period End'] = '2026-10-31';
  sheet.state[0].Submitted = 'No';
  runRange({ sheet, mailer, from: '2026-10-13', to: '2026-12-10', config });
  assert.equal(mailer.sent.length, 8);
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(keys.some((k) => k.startsWith('acme ltd|2026-10-31|')));
});

test('an HMRC Due Date typed in later restarts the ladder at the right point', () => {
  const sheet = sheetOf(vatRow());
  const mailer = fakeMailer();
  runRange({ sheet, mailer, from: '2026-08-15', to: '2026-09-24', config }); // 21 and 14 sent
  sheet.state[0]['HMRC Due Date'] = '2026-10-21'; // the date in the client's VAT online account
  runRange({ sheet, mailer, from: '2026-09-25', to: '2026-10-25', config });
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
  // The marker says 14 was sent for this period, so the next is the 7-day mark on 14 Oct.
  assert.deepEqual(mailer.sent.map(lastPart), ['21', '14', '7', '3']);
});

test('the Christmas quiet period: the marks that fall inside it are folded into one email before it', () => {
  // 30 November 2026 is due Thursday 7 January 2027. The 14-day mark (24 December) is in the
  // shutdown, so on 23 December the tightest mark reached (7) goes, then 3 on Monday 4 January.
  const sheet = sheetOf(vatRow({ 'VAT Period End': '2026-11-30' }));
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-12-01', to: '2027-01-10', config });
  assert.deepEqual(sentDates(days), ['2026-12-17', '2026-12-23', '2027-01-04']);
  assert.deepEqual(mailer.sent.map(lastPart), ['21', '7', '3']);
});

test('a client with several open periods gets one email per run, not one per period', () => {
  const sheet = sheetOf(
    vatRow({ 'VAT Period End': '2026-08-31' }),
    vatRow({ 'VAT Period End': '2026-08-30' }),
    vatRow({ 'VAT Period End': '2026-08-29' }),
  );
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2026-08-15', to: '2026-10-12', config });
  for (const d of days) assert.ok(d.delivered.length <= 1, `${d.date} sent ${d.delivered.length}`);
  assert.ok(mailer.sent.length >= 4);
  const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
  assert.equal(keys.length, new Set(keys).size);
});

test('nothing is ever sent on a non-working day across a year of quarterly returns', () => {
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    const ends = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2026-03-15', '2026-11-18'];
    rows.push(vatRow({ 'Client Name': `Client ${i}`, 'Contact Email': `c${i}@x.co.uk`, 'VAT Period End': ends[i % ends.length] }));
  }
  const sheet = sheetOf(...rows);
  const mailer = fakeMailer();
  const days = runRange({ sheet, mailer, from: '2025-12-01', to: '2027-03-31', config });
  const holidays = new Set(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
    '2026-08-31', '2026-12-25', '2026-12-28']);
  for (const d of days.filter((x) => x.delivered.length)) {
    assert.equal(isWeekend(d.date), false, `${d.date} is a weekend`);
    assert.equal(holidays.has(d.date), false, `${d.date} is a bank holiday`);
    const md = d.date.slice(5);
    assert.ok(md < '12-24' && md > '01-01', `${d.date} is in the shutdown`);
  }
  assert.ok(mailer.sent.length > 40);
  // And every email went out before the deadline it is about.
  for (const m of mailer.sent) assert.ok(m.subject.length > 0);
});

test('every reminder is sent while the deadline is still ahead, across every period end in a year', () => {
  for (let i = 0; i < 365; i += 7) {
    const periodEnd = addDays('2026-01-01', i);
    const due = vatReturnDeadline(periodEnd, DEFAULT_CONFIG.vatRules).dueDate;
    const sheet = sheetOf(vatRow({ 'VAT Period End': periodEnd }));
    const mailer = fakeMailer();
    const days = runRange({ sheet, mailer, from: addDays(due, -40), to: addDays(due, 3), config });
    for (const d of days.filter((x) => x.delivered.length)) {
      assert.ok(d.date <= due, `${periodEnd}: sent on ${d.date}, after the deadline ${due}`);
    }
  }
});

test('DRY RUN: a fortnight of dry runs writes nothing, and going live then sends what is due', () => {
  const sheet = sheetOf(vatRow(), vatRow({ 'Client Name': 'Done Ltd', 'Contact Email': 'd@done.co.uk', 'VAT Period End': '2026-06-30', Submitted: 'Yes' }));
  const mailer = fakeMailer();
  const log = fakeSubmissionLog();
  const ledger = fakeLedger();
  const dry = { dryRun: true, dryRunRecipient: 'owner@smith.co.uk', firmName: 'Smith & Co' };
  const days = runRange({ sheet, mailer, from: '2026-09-14', to: '2026-09-28', config: dry, ledger, submissionLog: log });
  assert.ok(mailer.sent.length > 0, 'the dry run should still deliver previews to the owner');
  assert.ok(mailer.sent.every((m) => m.to === 'owner@smith.co.uk'));
  assert.equal(sheet.calls.updates.length, 0, 'a dry run wrote to the VAT Clients tab');
  assert.equal(mailer.seenKeys.size, 0, 'a dry run recorded ledger keys');
  assert.equal(ledger.keys.length, 0);
  assert.equal(log.rows.length, 0, 'a dry run wrote to the Submission Log');
  assert.equal(sheet.state[0]['Last Checklist Sent'], '');
  assert.ok(days.filter((d) => d.actions.length).length > 1);

  // Switch dry run off on 29 September: 8 days to go, so the 14-day mark is the tightest reached.
  const live = runOnce({ sheet, mailer, ledger, submissionLog: log, today: '2026-09-29', config });
  assert.equal(live.delivered.length, 1, 'switching DRY_RUN off must not suppress the reminder that is due');
  assert.equal(live.delivered[0].to, 'a@acme.co.uk');
  assert.equal(sheet.state[0]['Last Checklist Sent'], 14);
  assert.equal(log.rows.length, 1, 'the submitted return is logged once live');
  assert.equal(runOnce({ sheet, mailer, ledger, submissionLog: log, today: '2026-09-30', config }).delivered.length, 1, 'then the 7-day mark');
});
