import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan } from '../../src/core/plan.js';
import { buildDigest } from '../../src/core/copy.js';
import { withDefaults } from '../../src/core/config.js';
import { loadFixture } from '../helpers/csv.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (n) => loadFixture(join(FIX, n));
const live = { dryRun: false, firmName: 'Smith & Co', firmPhone: '01234 567890' };
// A fixed calendar, so these tests do not depend on today's real bank holidays.
const cal = { ...live, bankHolidays: ['2026-12-25', '2026-12-28'] };

const row = (o) => ({
  row_number: 2, 'Client Name': 'Acme Ltd', 'Deadline Type': 'VAT return', 'Due Date': '2026-09-22',
  'Contact Email': 'a@acme.co.uk', Status: 'Pending', 'Last Reminder Sent': '',
  'Reminded For Due Date': '', 'Last Reminded On': '', ...o,
});

const reasons = (r) => r.skipped.map((s) => s.reason);

test('each milestone produces exactly one email at the right tone (Tuesday 15 Sep 2026)', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: cal });
  const by = Object.fromEntries(r.actions.map((a) => [a.clientName, a]));
  assert.equal(r.actions.length, 4);
  assert.equal(by['Acme Ltd'].tone, 'advance');           // 30 days
  assert.equal(by['Borough Cafe'].tone, 'reminder');      // 14 days
  assert.equal(by['Castle Motors'].tone, 'urgent');       // 7 days
  assert.equal(by['Delta Design'].tone, 'final');         // 1 day
  assert.match(by['Delta Design'].subject, /^Final reminder: /);
  assert.equal(by['Acme Ltd'].idempotencyKeys[0], 'acme ltd|vat return|2026-10-15|30');
});

test('filed, cancelled and on-hold deadlines are reported, not reminded', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: cal });
  assert.ok(reasons(r).includes('status is filed'));
  assert.ok(reasons(r).includes('status is cancelled'));
  assert.ok(reasons(r).includes('status is on hold'));
  assert.equal(r.actions.some((a) => ['Foxtrot Ltd', 'Golf Ltd', 'Hotel Ltd'].includes(a.clientName)), false);
});

test('a milestone already recorded for that due date is not sent again', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: cal });
  assert.equal(r.actions.some((a) => a.clientName === 'India Ltd'), false);
  assert.ok(reasons(r).includes('the 7-day reminder has already been sent'));
});

test('a tighter milestone is still sent after a looser one', () => {
  const rows = [row({ 'Last Reminder Sent': '14', 'Reminded For Due Date': '2026-09-22' })];
  const r = plan({ rows, today: '2026-09-15', config: cal }); // 7 days to go
  assert.equal(r.actions.length, 1);
  assert.equal(r.writeBacks[0].lastReminderSent, 7);
});

test('a marker written for last year\'s due date does not silence this year\'s reminders', () => {
  const rows = [row({ 'Last Reminder Sent': '1', 'Reminded For Due Date': '2025-09-22' })];
  assert.equal(plan({ rows, today: '2026-09-15', config: cal }).actions.length, 1);
  // A marker with no due date beside it is not trusted either. The ledger guards instead.
  const bare = [row({ 'Last Reminder Sent': '1' })];
  assert.equal(plan({ rows: bare, today: '2026-09-15', config: cal }).actions.length, 1);
});

test('the sent-key ledger suppresses a resend even when the sheet marker is missing', () => {
  const rows = [row()];
  const first = plan({ rows, today: '2026-09-15', config: cal });
  const second = plan({ rows, today: '2026-09-15', config: cal, sentKeys: first.actions[0].idempotencyKeys });
  assert.equal(second.actions.length, 0);
  assert.match(reasons(second)[0], /already recorded as sent/);
});

test('a deadline that has slipped past several milestones gets one reminder, not a burst', () => {
  const r = plan({ rows: [row({ 'Due Date': '2026-09-17' })], today: '2026-09-15', config: cal });
  assert.equal(r.actions.length, 1);
  assert.equal(r.writeBacks[0].lastReminderSent, 7);
});

test('a deadline further out than the first milestone is quietly waited on', () => {
  const r = plan({ rows: [row({ 'Due Date': '2026-12-01' })], today: '2026-09-15', config: cal });
  assert.equal(r.actions.length, 0);
  assert.match(reasons(r)[0], /before the first reminder at 30 days/);
  assert.equal(r.skipped[0].needsAttention, false);
});

test('due today still gets the final reminder, once', () => {
  const r = plan({ rows: [row({ 'Due Date': '2026-09-15' })], today: '2026-09-15', config: cal });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].tone, 'final');
  assert.match(r.actions[0].body, /due today/);
});

test('a deadline in the past is flagged for attention, never mailed', () => {
  const r = plan({ rows: [row({ 'Due Date': '2026-09-10' })], today: '2026-09-15', config: cal });
  assert.equal(r.actions.length, 0);
  assert.equal(r.skipped[0].needsAttention, true);
  assert.match(r.skipped[0].reason, /passed 5 days ago and the status is not Filed/);
  const filed = plan({ rows: [row({ 'Due Date': '2026-09-10', Status: 'Filed' })], today: '2026-09-15', config: cal });
  assert.equal(filed.skipped[0].needsAttention, false);
});

test('a Friday reminder is brought forward when the deadline is on the Monday', () => {
  // Friday 18 Sep 2026, deadline Monday 21 Sep: 3 days to go. Without the
  // lookahead this would be the 7-day reminder, and the final one would fall on
  // Sunday, when nothing is sent.
  const r = plan({ rows: [row({ 'Due Date': '2026-09-21' })], today: '2026-09-18', config: cal });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].tone, 'final');
  assert.equal(r.writeBacks[0].lastReminderSent, 1);
});

test('no lookahead effect on an ordinary weekday', () => {
  const r = plan({ rows: [row({ 'Due Date': '2026-09-21' })], today: '2026-09-16', config: cal }); // Wed, 5 days
  assert.equal(r.writeBacks[0].lastReminderSent, 7);
});

test('weekends, bank holidays and the Christmas shutdown send nothing and say why', () => {
  const rows = fx('every-milestone.csv');
  for (const [today, why] of [['2026-09-19', 'weekend'], ['2026-12-28', 'bank holiday'], ['2026-12-30', 'quiet period']]) {
    const r = plan({ rows, today, config: cal });
    assert.equal(r.actions.length, 0);
    assert.equal(r.summary.sendableDay, false);
    assert.equal(r.summary.notSendableReason, why);
    assert.equal(r.skipped.length, rows.length, 'every row is accounted for');
  }
});

test('the bank holiday list comes from the rules file, so a real holiday is silent', () => {
  // No calendar override: Good Friday 2026 must come from rules/bank-holidays.json.
  const r = plan({ rows: [row()], today: '2026-04-03', config: live });
  assert.equal(r.summary.notSendableReason, 'bank holiday');
});

test('one email per contact, listing every deadline, at the most urgent tone', () => {
  const r = plan({ rows: fx('grouping.csv'), today: '2026-09-15', config: cal });
  assert.equal(r.actions.length, 2);
  const multi = r.actions.find((a) => a.clientName === 'Multi Ltd');
  assert.equal(multi.deadlines.length, 2, 'the 30-day-out confirmation statement is not yet due');
  assert.match(multi.body, /VAT return/);
  assert.match(multi.body, /Corporation Tax payment/);
  assert.equal(multi.tone, 'urgent');
  assert.match(multi.subject, /^Urgent reminder: 2 deadlines, the first Tuesday 22 September 2026$/);
  assert.equal(multi.idempotencyKeys.length, 2);
  // Email address case does not split a client into two emails.
  assert.equal(r.summary.grouped, 2);
});

test('every messy row is reported with a reason, and none is silently dropped', () => {
  const rows = fx('messy-data.csv');
  const r = plan({ rows, today: '2026-09-15', config: cal });
  assert.equal(r.actions.length + r.skipped.length >= rows.length - 1, true);
  const bad = (needle) => r.skipped.find((s) => s.reason.includes(needle));
  assert.ok(bad('no client name'));
  assert.ok(bad('no deadline type'));
  assert.ok(bad('due date is not a usable date "31/02/2026"'));
  assert.ok(bad('due date is not a usable date "soon"'));
  assert.ok(bad('contact email is missing or invalid ""'));
  assert.ok(bad('contact email is missing or invalid "not-an-email"'));
  assert.ok(bad('unrecognised status "Maybe"'));
  assert.ok(bad('passed 14 days ago'));
  assert.ok(bad('duplicate of another row'));
  for (const s of r.skipped.filter((x) => x.needsAttention)) assert.ok(Number.isInteger(s.rowNumber));
  // The UK-format date, the blank status and the stale marker are all understood and reminded.
  const names = r.actions.map((a) => a.clientName);
  for (const n of ['UK Date Ltd', 'Blank Status Ltd', 'Stale Marker Ltd']) assert.ok(names.includes(n), n);
  assert.equal(names.filter((n) => n === 'Dup Ltd').length, 1);
});

test('empty and non-row inputs never throw', () => {
  for (const rows of [undefined, null, [], [{}], [null], [undefined, 5, 'x'], 'nope', { length: 3 }]) {
    assert.doesNotThrow(() => plan({ rows, today: '2026-09-15', config: cal }));
  }
  const empty = plan({ rows: [{}], today: '2026-09-15', config: cal });
  assert.equal(empty.summary.rowsRead, 0, 'the empty item n8n emits for an empty tab is not a row');
  assert.doesNotThrow(() => plan({ rows: [row()], today: 'garbage', config: cal }));
  assert.equal(plan({ rows: [row()], today: 'garbage', config: cal }).actions.length, 0);
  assert.doesNotThrow(() => plan({}));
  assert.doesNotThrow(() => plan({ rows: [row()], today: '2026-09-15', config: null }));
});

test('dry run redirects every email and marks the real recipient in the subject', () => {
  const config = { ...cal, dryRun: true, dryRunRecipient: 'owner@smith.co.uk' };
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config });
  for (const a of r.actions) {
    assert.equal(a.to, 'owner@smith.co.uk');
    assert.notEqual(a.realRecipient, 'owner@smith.co.uk');
    assert.ok(a.subject.startsWith(`[DRY RUN → ${a.realRecipient}]`));
  }
});

test('dry run without a valid recipient halts rather than risk a real send', () => {
  for (const dryRunRecipient of [undefined, '', 'nope']) {
    const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: { ...cal, dryRun: true, dryRunRecipient } });
    assert.equal(r.actions.length, 0);
    assert.equal(r.summary.halted, true);
    assert.match(r.summary.haltReason, /dryRunRecipient/);
  }
  // The default config is dry run, so a bare install cannot email a client.
  assert.equal(withDefaults({}).dryRun, true);
  assert.equal(plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: {} }).actions.length, 0);
});

test('the send ceiling halts the whole run instead of sending a partial batch', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: { ...cal, maxEmailsPerRun: 3 } });
  assert.equal(r.actions.length, 0);
  assert.equal(r.writeBacks.length, 0);
  assert.equal(r.summary.halted, true);
  assert.match(r.summary.haltReason, /4 emails would be sent, which is above the limit of 3/);
});

test('custom reminder days drive the ladder', () => {
  const config = { ...cal, milestones: '21,3' };
  const at = (due) => plan({ rows: [row({ 'Due Date': due })], today: '2026-09-15', config });
  assert.equal(at('2026-10-06').writeBacks[0].lastReminderSent, 21); // 21 days
  assert.equal(at('2026-10-06').actions[0].tone, 'advance');
  assert.equal(at('2026-09-18').writeBacks[0].lastReminderSent, 3);  // 3 days
  assert.equal(at('2026-09-18').actions[0].tone, 'urgent');
  assert.equal(at('2026-09-25').writeBacks[0].lastReminderSent, 21); // 10 days: the 21-day one was never sent
  assert.equal(at('2026-10-16').actions.length, 0);                  // 31 days: nothing yet
});

test('an unusable reminder-days setting falls back and is reported in the preview', () => {
  const r = plan({ rows: [row()], today: '2026-09-15', config: { ...cal, milestones: 'weekly' } });
  assert.deepEqual(r.summary.milestones, [30, 14, 7, 1]);
  assert.ok(r.summary.configWarning);
  const digest = buildDigest({ actions: r.actions, skipped: r.skipped, runDate: '2026-09-15', config: withDefaults(cal), configWarning: r.summary.configWarning });
  assert.match(digest.body, /Setting to check/);
});

test('the same input always gives the same output', () => {
  const a = plan({ rows: fx('messy-data.csv'), today: '2026-09-15', config: cal });
  const b = plan({ rows: fx('messy-data.csv'), today: '2026-09-15', config: cal });
  assert.deepEqual(a, b);
});

test('plan does not modify the rows it is given', () => {
  const rows = fx('messy-data.csv');
  const before = JSON.stringify(rows);
  plan({ rows, today: '2026-09-15', config: cal });
  assert.equal(JSON.stringify(rows), before);
});

// --- Copy ------------------------------------------------------------------

test('client copy reminds and asks, and asserts no penalty, rate or filing claim', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: cal });
  for (const a of r.actions) {
    assert.doesNotMatch(a.body, /£|\d+\s?%|penalt|interest|fine\b|surcharge|fined/i, `${a.clientName}: states a figure or consequence`);
    assert.doesNotMatch(a.body, /we (have|'ve) (filed|submitted|paid)|has been (filed|submitted|paid)/i);
    assert.match(a.body, /^Dear /);
    assert.match(a.body, /will never ask you to change the bank details/);
    assert.match(a.body, /01234 567890/);
    assert.match(a.body, /already sent us everything we need/);
    assert.match(a.body, /Kind regards,\nAccounts\nSmith & Co/);
  }
});

test('the due date and the days to go are in the first lines', () => {
  const r = plan({ rows: [row({ 'Due Date': '2026-09-29' })], today: '2026-09-15', config: cal });
  const firstLines = r.actions[0].body.split('\n').slice(0, 6).join('\n');
  assert.match(firstLines, /Tuesday 29 September 2026 \(14 days to go\)/);
});

test('the preview lists what will send, the hold link, skipped reasons and rows needing attention', () => {
  const r = plan({ rows: fx('messy-data.csv'), today: '2026-09-15', config: { ...cal, dryRun: true, dryRunRecipient: 'o@s.co.uk' } });
  const d = buildDigest({ actions: r.actions, skipped: r.skipped, runDate: '2026-09-15', config: withDefaults({ ...cal, dryRun: true, dryRunRecipient: 'o@s.co.uk' }) });
  assert.match(d.subject, /^Reminder preview: \d+ emails? at 09:00 \(dry run\)$/);
  assert.match(d.body, /DRY RUN IS ON/);
  assert.match(d.body, /Hold Until cell of the Run Control tab/);
  assert.doesNotMatch(d.body, /https?:\/\//, 'the preview must not advertise a link that changes state');
  assert.match(d.body, /records no reminder as sent/);
  assert.match(d.body, /Rows that need your attention/);
  assert.match(d.body, /row 2: (\(no client\)|.*) — no client name/);
  assert.match(d.body, /never files or pays anything with HMRC or Companies House/);
});

test('an empty day says so plainly', () => {
  const d = buildDigest({ actions: [], skipped: [], runDate: '2026-09-15', config: withDefaults(cal) });
  assert.match(d.body, /No reminders are due today/);
  assert.equal(d.subject, 'Reminder preview: 0 emails at 09:00');
});

// --- Dry run, hold, preview gate, row numbers -----------------------------------

const drySpec = { ...cal, dryRun: true, dryRunRecipient: 'owner@smith.co.uk' };

test('dry run plans emails but records nothing: no write-backs, and record is false', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: drySpec });
  assert.ok(r.actions.length > 0);
  assert.equal(r.writeBacks.length, 0);
  for (const a of r.actions) assert.equal(a.record, false);
  const live = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: cal });
  for (const a of live.actions) assert.equal(a.record, true);
  assert.equal(live.writeBacks.length, live.actions.reduce((n, a) => n + a.deadlines.length, 0));
});

test('a hold cell set to today halts the run, in any date format the sheet might use', () => {
  for (const held of ['2026-09-15', '15/09/2026', ' 2026-09-15 ', 46280]) {
    const r = plan({ rows: [row()], today: '2026-09-15', config: cal, holdUntil: held });
    assert.equal(r.summary.halted, true, String(held));
    assert.match(r.summary.haltReason, /held by the practice/);
    assert.equal(r.actions.length, 0);
  }
  for (const notHeld of ['2026-09-14', '', null, undefined, 'tomorrow', '09/15/2026']) {
    assert.equal(plan({ rows: [row()], today: '2026-09-15', config: cal, holdUntil: notHeld }).summary.halted, false, String(notHeld));
  }
});

test('the send run refuses to send unless today\'s preview was delivered', () => {
  const gate = (runLog) => plan({ rows: [row()], today: '2026-09-15', config: cal, requirePreview: true, runLog });
  assert.equal(gate([]).actions.length, 0);
  assert.match(gate([]).summary.haltReason, /no preview email was delivered/);
  assert.equal(gate(undefined).actions.length, 0);
  assert.equal(gate([{ 'Run Date': '2026-09-14', Mode: 'preview' }]).actions.length, 0, 'yesterday\'s preview does not count');
  assert.equal(gate([{ 'Run Date': '2026-09-15', Mode: 'send' }]).actions.length, 0, 'a send row is not a preview');
  assert.equal(gate([{ 'Run Date': '2026-09-15', Mode: 'preview' }]).actions.length, 1);
  assert.equal(gate([{ 'Run Date': '15/09/2026', Mode: ' Preview ' }]).actions.length, 1);
  // The preview run itself does not need one.
  assert.equal(plan({ rows: [row()], today: '2026-09-15', config: cal, requirePreview: false }).actions.length, 1);
});

test('a halted preview says why, instead of a misleading "no reminders due"', () => {
  const r = plan({ rows: fx('every-milestone.csv'), today: '2026-09-15', config: { ...cal, maxEmailsPerRun: 1 } });
  const d = buildDigest({ actions: r.actions, skipped: r.skipped, runDate: '2026-09-15', config: withDefaults(cal), haltReason: r.summary.haltReason });
  assert.match(d.body, /NOTHING WILL BE SENT: 4 emails would be sent/);
  assert.doesNotMatch(d.body, /No reminders are due today/);
});

test('a row without a Sheets row_number is refused and flagged, never guessed at', () => {
  for (const bad of [undefined, null, 'x', 0, 1, 2.5, NaN]) {
    const r = plan({ rows: [row({ row_number: bad })], today: '2026-09-15', config: cal });
    assert.equal(r.actions.length, 0, String(bad));
    assert.equal(r.skipped[0].needsAttention, true);
    assert.equal(r.skipped[0].rowNumber, null);
    assert.match(r.skipped[0].reason, /did not return a row number/);
  }
});

test('checkAddresses halts a live run on a placeholder or empty address, and never a dry run', () => {
  const live = { ...cal, senderEmail: 'a@smith.co.uk', practiceEmail: 'o@smith.co.uk' };
  const go = (cfg) => plan({ rows: [row()], today: '2026-09-15', config: cfg, checkAddresses: true });
  assert.equal(go(live).actions.length, 1);
  for (const cfg of [{ ...live, practiceEmail: '' }, { ...live, senderEmail: 'accounts@example.co.uk' }]) {
    const r = go(cfg);
    assert.equal(r.actions.length, 0);
    assert.equal(r.summary.haltKind, 'config');
    assert.equal(r.summary.alertable, true);
    assert.match(r.summary.haltReason, /settings to fix before going live/);
  }
  assert.equal(go({ ...live, dryRun: true, dryRunRecipient: 'o@smith.co.uk', practiceEmail: '' }).actions.length, 1);
  // Off by default, so callers that do not ask are unaffected.
  assert.equal(plan({ rows: [row()], today: '2026-09-15', config: cal }).actions.length, 1);
});
