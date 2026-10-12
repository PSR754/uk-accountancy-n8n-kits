import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan, isHeldToday, previewDelivered, confirmationKey } from '../../src/core/plan.js';
import { buildEmail, buildDigest, CHECKLIST } from '../../src/core/copy.js';
import { withDefaults } from '../../src/core/config.js';
import { loadFixture } from '../helpers/csv.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (n) => loadFixture(join(FIX, n));
const TODAY = '2026-09-15'; // a Tuesday
const config = {
  dryRun: false, firmName: 'Smith & Co', senderEmail: 'accounts@smith.co.uk', replyToEmail: 'accounts@smith.co.uk',
  practiceEmail: 'owner@smith.co.uk', firmPhone: '01234 567890', signOffName: 'Ravi',
};
const row = (over = {}) => ({
  row_number: 2, 'Client Name': 'Acme Ltd', 'Contact Email': 'ap@acme.co.uk',
  // A non-standard period end, so the due date must come from the HMRC Due Date column.
  'VAT Period End': '2026-08-29', 'HMRC Due Date': '2026-10-06', Submitted: 'No', ...over,
});
// A standard quarter: the period ends on the last day of a month, so the kit calculates the date.
const std = (over = {}) => row({ 'VAT Period End': '2026-06-30', 'HMRC Due Date': '', ...over });
const reasons = (r) => r.skipped.map((s) => s.reason);

test('each milestone: 21, 14, 7 and 3 days before the calculated deadline', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: TODAY, config });
  assert.ok(r.skipped.some((s) => /Hotel Harbour/.test(s.label) && /not the last day of a month/.test(s.reason)));
  const byClient = Object.fromEntries(r.actions.map((a) => [a.clientName, a]));
  const expect = {
    'Acme Ltd': [21, 21, 'advance', '2026-10-06'],
    'Borough Cafe': [14, 14, 'reminder', '2026-09-29'],
    'Castle Motors Ltd': [7, 7, 'urgent', '2026-09-22'],
    'Delta Design Ltd': [3, 3, 'final', '2026-09-18'],
  };
  assert.deepEqual(Object.keys(byClient).sort(), Object.keys(expect).sort());
  for (const [name, [days, milestone, tone, due]] of Object.entries(expect)) {
    const d = byClient[name].deadlines[0];
    assert.equal(d.daysUntilDue, days, name);
    assert.equal(d.milestone, milestone, name);
    assert.equal(byClient[name].tone, tone, name);
    assert.equal(d.dueDate, due, name);
    assert.equal(d.dueDateSource, 'sheet');
  }
  assert.equal(r.summary.emails, 4);
});

test('a month-end period is calculated: last day of next month + 7 days, in the email too', () => {
  const r = plan({ rows: [std()], today: '2026-07-17', config });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].deadlines[0].dueDateSource, 'calculated');
  assert.equal(r.actions[0].deadlines[0].dueDate, '2026-08-07');
  assert.match(r.actions[0].body, /Period ended 30 June 2026: return due Friday 7 August 2026 \(21 days to go\)/);
  assert.match(r.actions[0].subject, /^Advance notice: VAT return due Friday 7 August 2026$/);
});

test('a period that does not end on a month end sends NOTHING without the HMRC Due Date, and is flagged', () => {
  for (const end of ['2026-08-22', '2026-08-29', '2026-07-15', '2026-01-30']) {
    const r = plan({ rows: [row({ 'VAT Period End': end, 'HMRC Due Date': '' })], today: '2026-09-25', config });
    assert.equal(r.actions.length, 0, end);
    assert.equal(r.writeBacks.length, 0, end);
    assert.equal(r.skipped[0].needsAttention, true, end);
    assert.match(r.skipped[0].reason, /is not the last day of a month, so the kit does not calculate its deadline: type the due date from the client's VAT online account into HMRC Due Date\. No reminder is sent until you do/);
  }
  // With the date typed in, the same row is reminded, and no "differs" notice is raised.
  const ok = plan({ rows: [row({ 'VAT Period End': '2026-08-22', 'HMRC Due Date': '2026-09-29' })], today: TODAY, config });
  assert.equal(ok.actions.length, 1);
  assert.equal(ok.actions[0].deadlines[0].dueDateSource, 'sheet');
  assert.equal(ok.notices.length, 0);
  // The blocking reason also reaches the preview.
  const digest = buildDigest({ actions: [], skipped: plan({ rows: [row({ 'HMRC Due Date': '' })], today: TODAY, config }).skipped, runDate: TODAY, config: withDefaults(config) });
  assert.match(digest.body, /Rows that need your attention[\s\S]*HMRC Due Date/);
});

test('stops once submitted: a Submitted row is never reminded, whatever its dates', () => {
  for (const word of ['Yes', 'yes', 'Y', 'Submitted', 'filed', 'TRUE']) {
    const r = plan({ rows: [row({ Submitted: word })], today: TODAY, config });
    assert.equal(r.actions.length, 0, word);
    assert.equal(r.writeBacks.length, 0, word);
    assert.deepEqual(reasons(r), ['already submitted: reminders stopped'], word);
  }
});

test('once marked Submitted mid-ladder, the reminders stop on the next run', () => {
  const pending = plan({ rows: [row()], today: '2026-09-15', config });
  assert.equal(pending.actions.length, 1);
  const done = plan({ rows: [row({ Submitted: 'Yes' })], today: '2026-09-22', config });
  assert.equal(done.actions.length, 0);
});

test('a submitted return is logged once, per client and period', () => {
  const rows = [row({ Submitted: 'Yes', 'VAT Period End': '2026-06-30' })];
  const first = plan({ rows, today: TODAY, config });
  assert.deepEqual(first.confirmations, [{
    rowNumber: 2, clientName: 'Acme Ltd', periodEnd: '2026-06-30', confirmedOn: TODAY,
    key: 'acme ltd|2026-06-30', record: true,
  }]);
  assert.equal(first.summary.confirmationsToRecord, 1);
  // Once it is in the Submission Log (in either the new or the old column name) nothing more is logged.
  for (const header of ['VAT Period End', 'VAT Quarter End']) {
    const again = plan({
      rows, today: TODAY, config, submissionLog: [{ 'Client Name': '  ACME   Ltd ', [header]: '30/06/2026', 'Confirmed Submitted On': '2026-07-20' }],
    });
    assert.equal(again.confirmations.length, 0, header);
  }
  // A different period for the same client is still logged.
  const other = plan({
    rows, today: TODAY, config, submissionLog: [{ 'Client Name': 'Acme Ltd', 'VAT Period End': '2026-03-31' }],
  });
  assert.equal(other.confirmations.length, 1);
});

test('the same return on two rows is logged once', () => {
  const rows = [row({ Submitted: 'Yes', 'VAT Period End': '2026-06-30' }), row({ row_number: 3, Submitted: 'Yes', 'VAT Period End': '30/06/2026' })];
  assert.equal(plan({ rows, today: TODAY, config }).confirmations.length, 1);
});

test('old history is not logged on the first run, and a return "submitted" before its period ends is flagged', () => {
  const old = plan({ rows: [row({ Submitted: 'Yes', 'VAT Period End': '2025-03-31' })], today: TODAY, config });
  assert.equal(old.confirmations.length, 0);
  assert.equal(old.actions.length, 0);
  const early = plan({ rows: [row({ Submitted: 'Yes', 'VAT Period End': '2027-03-31' })], today: TODAY, config });
  assert.equal(early.confirmations.length, 0);
  assert.equal(early.skipped[0].needsAttention, true);
  assert.match(early.skipped[0].reason, /period has not ended yet/);
  // The lookback is configuration.
  const wide = plan({ rows: [row({ Submitted: 'Yes', 'VAT Period End': '2025-03-31' })], today: TODAY, config: { ...config, confirmationLookbackDays: 800 } });
  assert.equal(wide.confirmations.length, 1);
});

test('a dry run logs nothing: confirmations are planned but not recordable', () => {
  const dry = { ...config, dryRun: true, dryRunRecipient: 'owner@smith.co.uk' };
  const r = plan({ rows: [row({ Submitted: 'Yes', 'VAT Period End': '2026-06-30' })], today: TODAY, config: dry });
  assert.equal(r.confirmations.length, 1);
  assert.equal(r.confirmations[0].record, false);
  assert.equal(r.summary.confirmationsToRecord, 0);
});

test('a deadline already passed is flagged for a person, not emailed', () => {
  const r = plan({ rows: [std({ 'VAT Period End': '2026-05-31' })], today: TODAY, config });
  assert.equal(r.actions.length, 0);
  assert.equal(r.skipped[0].needsAttention, true);
  assert.match(r.skipped[0].reason, /VAT deadline 2026-07-07 passed 70 days ago and the return is not marked Submitted/);
});

test('the deadline day itself still gets the final reminder', () => {
  const r = plan({ rows: [std()], today: '2026-08-07', config });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].tone, 'final');
  assert.match(r.actions[0].body, /due today/);
});

test('too early: before the first reminder nothing is sent, and the reason says how far away', () => {
  const r = plan({ rows: [std({ 'VAT Period End': '2026-09-30' })], today: TODAY, config });
  assert.equal(r.actions.length, 0);
  assert.deepEqual(reasons(r), ['53 days to go, before the first reminder at 21 days']);
});

test('a deadline on a weekend is not moved, and the email tells the client so', () => {
  // 30 September 2026 gives Saturday 7 November 2026.
  const r = plan({ rows: [std({ 'VAT Period End': '2026-09-30' })], today: '2026-10-20', config });
  assert.equal(r.actions.length, 1);
  const d = r.actions[0].deadlines[0];
  assert.equal(d.dueDate, '2026-11-07');
  assert.equal(d.deadlineFallsOn, 'weekend');
  assert.match(r.actions[0].body, /Saturday 7 November 2026 is a weekend\. HMRC does not move the deadline for weekends or bank holidays/);
});

test('a deadline on a bank holiday is not moved either', () => {
  const r = plan({ rows: [row({ 'VAT Period End': '2026-11-18', 'HMRC Due Date': '2026-12-25' })], today: '2026-12-04', config: { ...config, quietPeriods: [] } });
  assert.equal(r.actions[0].deadlines[0].dueDate, '2026-12-25');
  assert.equal(r.actions[0].deadlines[0].deadlineFallsOn, 'bank holiday');
  assert.match(r.actions[0].body, /Friday 25 December 2026 is a bank holiday/);
  // An ordinary weekday deadline carries no such note.
  const plain = plan({ rows: [std()], today: '2026-07-17', config });
  assert.doesNotMatch(plain.actions[0].body, /does not move the deadline/);
});

test('a reminder that would fall on a weekend is brought forward to Friday', () => {
  // Deadline Tuesday 22 September 2026. Friday 18th is 4 days out, Monday 21st is 1. The 7-day
  // reminder is earned on Tuesday 15th. Run on Friday 18th: gap to Monday is 3, so the 3-day
  // reminder comes forward rather than waiting for a Sunday that never runs.
  const rows = [row({ 'VAT Period End': '2026-08-15', 'HMRC Due Date': '2026-09-22' })];
  const fri = plan({ rows, today: '2026-09-18', config });
  assert.equal(fri.actions[0].deadlines[0].milestone, 3);
  assert.equal(fri.actions[0].deadlines[0].daysUntilDue, 4);
  const sat = plan({ rows, today: '2026-09-19', config });
  assert.equal(sat.actions.length, 0);
  assert.equal(sat.summary.notSendableReason, 'weekend');
});

test('the HMRC Due Date column overrides the calculation, and a difference is shown to the practice', () => {
  // 30 June is a month end, so the calculated date is 7 August. The sheet says 12 August.
  const r = plan({ rows: [std({ 'HMRC Due Date': '2026-08-12' })], today: '2026-07-22', config });
  assert.equal(r.actions[0].deadlines[0].dueDate, '2026-08-12');
  assert.equal(r.actions[0].deadlines[0].dueDateSource, 'sheet');
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0].message, /differs from the calculated 2026-08-07/);
  const d = buildDigest({ actions: r.actions, skipped: r.skipped, runDate: TODAY, config: withDefaults(config), notices: r.notices });
  assert.match(d.body, /For your information:\n  row 2: .*differs from the calculated/);
  // The same date as the calculation raises no notice.
  assert.equal(plan({ rows: [std({ 'HMRC Due Date': '07/08/2026' })], today: '2026-07-22', config }).notices.length, 0);
});

test('an unusable HMRC Due Date is flagged and nothing is sent', () => {
  for (const bad of ['soon', '31/02/2026', '2026-08-01', '2026-08-29', '2031-01-01']) {
    const r = plan({ rows: [row({ 'HMRC Due Date': bad })], today: TODAY, config });
    assert.equal(r.actions.length, 0, bad);
    assert.equal(r.skipped[0].needsAttention, true, bad);
    assert.match(r.skipped[0].reason, /HMRC Due Date/, bad);
  }
});

test('VAT Annual Accounting rows are never given a calculated date', () => {
  const r = plan({ rows: [row({ 'VAT Scheme': 'Annual Accounting' })], today: TODAY, config });
  assert.equal(r.actions.length, 0);
  assert.equal(r.skipped[0].needsAttention, true);
  assert.match(r.skipped[0].reason, /different deadline that this kit does not calculate/);
  // Unless the practice supplies the HMRC date? No: the scheme is refused outright.
  const withDate = plan({ rows: [row({ 'VAT Scheme': 'annual accounting', 'HMRC Due Date': '2026-10-06' })], today: TODAY, config });
  assert.equal(withDate.actions.length, 0);
  assert.equal(plan({ rows: [row({ 'VAT Scheme': 'Mystery' })], today: TODAY, config }).skipped[0].needsAttention, true);
  assert.equal(plan({ rows: [row({ 'VAT Scheme': 'Flat Rate' })], today: TODAY, config }).actions.length, 1);
});

test('the earlier column name VAT Quarter End still works', () => {
  const { 'VAT Period End': p, ...rest } = row();
  const r = plan({ rows: [{ ...rest, 'VAT Quarter End': p }], today: TODAY, config });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].deadlines[0].periodEnd, '2026-08-29');
});

test('messy data: every bad row is explained, none is emailed', () => {
  const r = plan({ rows: fx('messy-data.csv'), today: TODAY, config });
  const byLabel = Object.fromEntries(r.skipped.map((s) => [s.label.split(' — ')[0], s]));
  assert.ok(r.skipped.some((x) => /no client name/.test(x.reason) && x.needsAttention));
  assert.match(byLabel['No Date Ltd'].reason, /VAT period end is not a usable date/);
  assert.match(byLabel['Bad Date Ltd'].reason, /VAT period end is not a usable date "31\/02\/2026"/);
  assert.match(byLabel['Bad Email Ltd'].reason, /contact email is missing or invalid/);
  assert.match(byLabel['Bad Status Ltd'].reason, /unrecognised Submitted value "Maybe"/);
  assert.match(byLabel['Annual Ltd'].reason, /does not calculate/);
  assert.match(byLabel['Odd Scheme Ltd'].reason, /unrecognised VAT scheme/);
  assert.match(byLabel['Bad Override Ltd'].reason, /HMRC Due Date is not a usable date/);
  assert.match(byLabel['Early Override Ltd'].reason, /not after the VAT period end/);
  assert.equal(byLabel['On Hold Ltd'].reason, 'status is on hold');
  assert.equal(byLabel['Not Required Ltd'].reason, 'status is not required');
  assert.match(byLabel['Future Done Ltd'].reason, /period has not ended yet/);
  assert.equal(byLabel['Already Sent Ltd'].reason, 'the 14-day reminder has already been sent');
  assert.match(byLabel['Past Due Ltd'].reason, /passed/);
  assert.equal(r.skipped.length + r.actions.reduce((n, a) => n + a.deadlines.length, 0), r.summary.rowsRead);
  // The two that are fine: an override two days later than calculated, and last quarter's marker.
  const emailed = r.actions.map((a) => a.clientName).sort();
  assert.deepEqual(emailed, ['Override Ltd', 'Rolled Over Ltd']);
});

test("last quarter's record never silences this quarter's reminders", () => {
  const rows = [row({ 'Last Checklist Sent': '3', 'Checklist For Period End': '2026-05-29' })];
  const r = plan({ rows, today: TODAY, config });
  assert.equal(r.actions.length, 1);
  // But the same period's record does.
  const same = plan({ rows: [row({ 'Last Checklist Sent': '21', 'Checklist For Period End': '2026-08-29' })], today: TODAY, config });
  assert.equal(same.actions.length, 0);
  // A tighter reminder is still due after a looser one was sent for this period.
  const tighter = plan({ rows: [row({ 'Last Checklist Sent': '21', 'Checklist For Period End': '2026-08-29' })], today: '2026-09-29', config });
  assert.equal(tighter.actions[0].deadlines[0].milestone, 7);
});

test('the sent-key ledger suppresses a reminder the sheet forgot', () => {
  const first = plan({ rows: [row()], today: TODAY, config });
  assert.equal(first.actions[0].idempotencyKeys[0], 'acme ltd|2026-08-29|21');
  const second = plan({ rows: [row()], today: TODAY, config, sentKeys: ['  acme ltd|2026-08-29|21 '] });
  assert.equal(second.actions.length, 0);
  assert.deepEqual(reasons(second), ['the 21-day reminder is already recorded as sent']);
});

test('two rows for one client and period are a duplicate, flagged', () => {
  const r = plan({ rows: [row(), row({ row_number: 3 })], today: TODAY, config });
  assert.equal(r.actions.length, 1);
  assert.match(r.skipped[0].reason, /duplicate of another row/);
});

test('one email per contact, listing every open VAT period', () => {
  const r = plan({ rows: fx('grouping.csv'), today: TODAY, config });
  assert.equal(r.actions.length, 2);
  const multi = r.actions.find((a) => a.clientName === 'Multi Ltd');
  assert.equal(multi.deadlines.length, 2);
  assert.match(multi.subject, /^Reminder: 2 VAT returns due, the first Tuesday 29 September 2026$/);
  assert.match(multi.body, /Period ended 22 August 2026: return due Tuesday 29 September 2026 \(14 days to go\)/);
  assert.match(multi.body, /Period ended 29 August 2026: return due Tuesday 6 October 2026 \(21 days to go\)/);
  assert.equal(r.writeBacks.length, 3);
});

test('weekends, bank holidays and the quiet period are not sending days, and plan says why', () => {
  const rows = fx('every-milestone.csv');
  for (const [day, reason] of [['2026-09-19', 'weekend'], ['2026-04-03', 'bank holiday'], ['2026-12-29', 'quiet period']]) {
    const r = plan({ rows, today: day, config });
    assert.equal(r.actions.length, 0, day);
    assert.equal(r.summary.notSendableReason, reason, day);
    assert.equal(r.summary.alertable, false, day);
    assert.ok(r.skipped.every((s) => s.reason === `not a sending day: ${reason}`));
  }
  assert.equal(plan({ rows, today: 'junk', config }).summary.alertable, true);
});

test('hold, preview gate, addresses, dry-run recipient and ceiling halt the run', () => {
  const rows = fx('every-milestone.csv');
  const held = plan({ rows, today: TODAY, config, holdUntil: '15/09/2026' });
  assert.equal(held.summary.haltKind, 'hold');
  assert.equal(held.summary.alertable, false);
  const noPreview = plan({ rows, today: TODAY, config, requirePreview: true, runLog: [] });
  assert.equal(noPreview.summary.haltKind, 'preview');
  assert.equal(plan({ rows, today: TODAY, config, requirePreview: true, runLog: [{ 'Run Date': TODAY, Mode: 'preview' }] }).actions.length, 4);
  const bad = plan({ rows, today: TODAY, config: { ...config, practiceEmail: '' }, checkAddresses: true });
  assert.equal(bad.summary.haltKind, 'config');
  const dry = plan({ rows, today: TODAY, config: { ...config, dryRun: true } });
  assert.match(dry.summary.haltReason, /no valid dryRunRecipient/);
  const capped = plan({ rows, today: TODAY, config: { ...config, maxEmailsPerRun: 2 } });
  assert.equal(capped.summary.haltKind, 'ceiling');
  assert.equal(capped.actions.length, 0);
  assert.equal(capped.writeBacks.length, 0);
});

test('a damaged rules file halts the run and says so, instead of guessing deadlines', () => {
  for (const vatRules of [{}, { returnDeadline: { calendarMonthsAfterPeriodEnd: 'x', daysAfterThat: 7 } }, null, 5]) {
    const r = plan({ rows: fx('every-milestone.csv'), today: TODAY, config: { ...config, vatRules } });
    assert.equal(r.summary.halted, true, JSON.stringify(vatRules));
    assert.equal(r.summary.haltKind, 'rules');
    assert.equal(r.summary.alertable, true);
    assert.match(r.summary.haltReason, /rule in rules\/vat-rules\.json/);
    assert.equal(r.actions.length, 0);
  }
});

test('the rules file drives the answer: a changed rule changes the emails', () => {
  const vatRules = JSON.parse(JSON.stringify(withDefaults({}).vatRules));
  vatRules.returnDeadline.daysAfterThat = 0;
  const r = plan({ rows: [std()], today: '2026-07-10', config: { ...config, vatRules } });
  assert.equal(r.actions[0].deadlines[0].dueDate, '2026-07-31');
});

test('a stale rules file is reported in the preview but does not stop the run', () => {
  const stale = plan({ rows: fx('every-milestone.csv'), today: '2028-01-04', config });
  assert.match(stale.summary.rulesNote, /last checked against gov\.uk on 2026-10-02/);
  assert.equal(stale.summary.halted, false);
  const fresh = plan({ rows: fx('every-milestone.csv'), today: TODAY, config });
  assert.equal(fresh.summary.rulesNote, null);
  const digest = buildDigest({ actions: [], skipped: [], runDate: '2028-01-04', config: withDefaults(config), rulesNote: stale.summary.rulesNote });
  assert.match(digest.body, /Rules to check: the VAT deadline rules/);
});

test('dry run redirects every email, records nothing, and says so', () => {
  const dry = { ...config, dryRun: true, dryRunRecipient: 'owner@smith.co.uk' };
  const r = plan({ rows: fx('every-milestone.csv'), today: TODAY, config: dry });
  assert.equal(r.writeBacks.length, 0);
  for (const a of r.actions) {
    assert.equal(a.to, 'owner@smith.co.uk');
    assert.equal(a.record, false);
    assert.match(a.subject, /^\[DRY RUN → .+@.+\] /);
  }
});

test('the client email: checklist, deadline note, no penalties, no claim of submission, no links', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: TODAY, config });
  for (const a of r.actions) {
    for (const item of CHECKLIST) assert.ok(a.body.includes(`  - ${item}`));
    assert.match(a.body, /Any VAT payment is due by the same date, so please allow time for it to reach HMRC\. If you pay by Direct Debit, HMRC collects it 3 working days after the deadline, but the return itself must still be in by the date above\./);
    assert.match(a.body, /we will prepare the return for your approval/);
    assert.match(a.body, /We will never ask you to change the bank details/);
    assert.match(a.body, /01234 567890/);
    assert.doesNotMatch(a.body, /penalt|surcharge|interest|£|\d%/i, 'the email must state no penalty, rate or amount');
    assert.doesNotMatch(a.body, /we have (submitted|filed|paid)|has been (submitted|filed|paid)/i);
    assert.doesNotMatch(a.body, /https?:\/\//);
    assert.doesNotMatch(a.body, /n8n/i);
  }
});

test('the preview digest explains what will happen and how to stop it', () => {
  const rows = fx('every-milestone.csv');
  const r = plan({ rows, today: TODAY, config });
  const d = buildDigest({
    actions: r.actions, skipped: r.skipped, runDate: TODAY, config: withDefaults(config),
    confirmations: r.confirmations,
  });
  assert.match(d.subject, /^VAT reminder preview: 4 emails at 09:00$/);
  assert.match(d.body, /4 emails will be sent at 09:00/);
  assert.match(d.body, /Hold Until cell/);
  assert.match(d.body, /1 submitted return will be added to the Submission Log, and reminders for it stop/);
  assert.match(d.body, /Rows that need your attention in the sheet:\n  row 6: Echo Engineering/);
  assert.match(d.body, /It never submits a VAT return, and never pays anything to HMRC/);
  const halted = buildDigest({ actions: [], skipped: [], runDate: TODAY, config: withDefaults(config), haltReason: 'x' });
  assert.match(halted.body, /NOTHING WILL BE SENT: x\./);
});

test('plan never mutates its input', () => {
  const rows = fx('messy-data.csv');
  const before = JSON.stringify(rows);
  const cfg = { ...config };
  plan({ rows, today: TODAY, config: cfg });
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(cfg, config);
});

test('helpers: isHeldToday, previewDelivered, confirmationKey', () => {
  assert.equal(isHeldToday('2026-09-15', TODAY), true);
  assert.equal(isHeldToday('15/09/2026', TODAY), true);
  assert.equal(isHeldToday('2026-09-14', TODAY), false);
  assert.equal(isHeldToday('', TODAY), false);
  assert.equal(previewDelivered([{ Mode: ' Preview ', 'Run Date': '15/09/2026' }], TODAY), true);
  assert.equal(previewDelivered([{ Mode: 'preview failed', 'Run Date': TODAY }], TODAY), false);
  assert.equal(previewDelivered(null, TODAY), false);
  assert.equal(confirmationKey('  Acme   LTD ', '2026-06-30'), 'acme ltd|2026-06-30');
});

test('buildEmail copes with a single deadline and wording by tone', () => {
  const base = { clientName: 'Acme Ltd', config: withDefaults({ firmName: 'Smith & Co', senderName: 'Accounts' }) };
  const mk = (milestone, days) => buildEmail({ ...base, deadlines: [{ periodEnd: '2026-06-30', dueDate: '2026-08-07', daysUntilDue: days, milestone, deadlineFallsOn: null }] });
  assert.match(mk(21, 21).body, /early reminder/);
  assert.match(mk(14, 14).body, /as soon as you can/);
  assert.match(mk(7, 7).body, /within the next few days/);
  assert.match(mk(3, 1).body, /due tomorrow/);
  assert.match(mk(3, 3).body, /please contact us today/);
  assert.match(mk(3, 0).body, /due today/);
});
