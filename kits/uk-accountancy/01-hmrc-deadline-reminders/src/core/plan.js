import { parseSheetDate, daysBetween, sendableDay, nextSendableDay } from './dates.js';
import {
  milestoneFor, parseMilestoneCell, normaliseStatus, isValidEmail, ACTIVE_STATUS, addressProblems,
} from './rules.js';
import { buildEmail } from './copy.js';
import { withDefaults } from './config.js';

/**
 * Decide everything this kit will do on a given day.
 *
 * This is the whole of the decision-making. It is a pure function: the same
 * rows and the same date always produce the same result, it performs no input
 * or output, and it never throws on bad data. The n8n workflow around it only
 * reads rows, delivers what this returns, and writes back what this says to write.
 * Nothing it returns is a filing or a payment: the only outputs are reminder
 * emails, and a preview of them.
 *
 * `checkAddresses` (true in the workflow) makes a live run refuse to go with an
 * empty or placeholder sender or practice address.
 * `holdUntil` is the practice's manual hold cell. `requirePreview` is true for
 * the 09:00 send run: it refuses to send unless `runLog` shows that today's
 * preview email was delivered to the practice. In dry run nothing is recorded
 * (`writeBacks` is empty and each action has `record: false`), because a dry
 * run must leave no trace that could suppress the real reminder later.
 *
 * @returns {{actions: Array, skipped: Array, writeBacks: Array, summary: Object}}
 */
export function plan({
  rows, today, config: rawConfig, sentKeys = [], holdUntil = null, requirePreview = false, runLog = [],
  checkAddresses = false,
}) {
  const alreadySent = new Set(
    (Array.isArray(sentKeys) ? sentKeys : []).map((k) => String(k).trim()).filter(Boolean),
  );
  const config = withDefaults(rawConfig);
  const list = Array.isArray(rows) ? rows : [];
  const skipped = [];
  const summary = {
    runDate: today,
    rowsRead: 0,
    valid: 0,
    upcoming: 0,
    due: 0,
    grouped: 0,
    emails: 0,
    skipped: 0,
    halted: false,
    haltReason: null,
    // hold, preview, config or ceiling. A hold is the practice's own decision;
    // the rest are faults the practice should hear about.
    haltKind: null,
    alertable: false,
    sendableDay: true,
    notSendableReason: null,
    dryRun: config.dryRun === true,
    milestones: config.milestones,
    configWarning: config.milestonesValid
      ? null
      : 'the reminder days setting was empty or contained something that is not a whole number of days, so unusable entries were ignored (or the defaults used)',
  };

  // A row with nothing in it (for example the empty item n8n emits when a tab
  // has no data) is not a row of the practice's.
  const isBlank = (r) => !r || typeof r !== 'object'
    || Object.entries(r).every(([k, v]) => k === 'row_number' || String(v ?? '').trim() === '');
  const entries = list.map((raw, i) => ({ raw, i })).filter(({ raw }) => !isBlank(raw));
  summary.rowsRead = entries.length;

  const day = sendableDay(today, config);
  if (!day.sendable) {
    summary.sendableDay = false;
    summary.notSendableReason = day.reason;
    // A weekend, bank holiday or quiet period is by design. An unusable run date is a fault.
    summary.alertable = day.reason === 'invalid run date';
    summary.skipped = summary.rowsRead;
    return {
      actions: [],
      writeBacks: [],
      skipped: entries.map(({ raw, i }) => ({
        rowNumber: rowNumberOf(raw),
        label: labelOf(raw),
        reason: `not a sending day: ${day.reason}`,
        needsAttention: false,
      })),
      summary,
    };
  }

  if (isHeldToday(holdUntil, today)) {
    summary.halted = true;
    summary.haltKind = 'hold';
    summary.haltReason = 'run held by the practice (Hold Until in the Run Control tab is today)';
    return { actions: [], writeBacks: [], skipped: [], summary };
  }

  if (checkAddresses === true && config.dryRun !== true) {
    const problems = addressProblems(config);
    if (problems.length) {
      summary.halted = true;
      summary.haltKind = 'config';
      summary.alertable = true;
      summary.haltReason = `settings to fix before going live: ${problems.join('; ')}`;
      return { actions: [], writeBacks: [], skipped: [], summary };
    }
  }

  if (requirePreview === true && !previewDelivered(runLog, today)) {
    summary.halted = true;
    summary.haltKind = 'preview';
    summary.alertable = true;
    summary.haltReason = 'no preview email was delivered to the practice today, so nothing has been sent';
    return { actions: [], writeBacks: [], skipped: [], summary };
  }

  if (config.dryRun === true && !isValidEmail(config.dryRunRecipient)) {
    summary.halted = true;
    summary.haltKind = 'config';
    summary.alertable = true;
    summary.haltReason = 'dry run is on but no valid dryRunRecipient is configured';
    return { actions: [], writeBacks: [], skipped: [], summary };
  }

  // If tomorrow is not a sending day, a reminder that would land in the gap is
  // brought forward to today. This is what stops a Monday deadline never
  // getting its final reminder because the day before was a Sunday.
  const next = nextSendableDay(today, config);
  const gapDays = next === null ? 1 : Math.max(1, daysBetween(today, next) ?? 1);
  const furthest = Math.max(...config.milestones);

  // 1. Validate and classify every row. Nothing is ever dropped silently.
  const candidates = [];
  const seenKeys = new Set();
  for (const { raw, i } of entries) {
    const row = raw;
    const rowNumber = rowNumberOf(row);
    const label = labelOf(row);
    const add = (reason, needsAttention) => skipped.push({ rowNumber, label, reason, needsAttention });

    if (rowNumber === null) {
      add('the sheet read did not return a row number for this row, so it cannot be written back to safely', true);
      continue;
    }

    const clientName = cell(row['Client Name']);
    const deadlineType = cell(row['Deadline Type']);
    if (clientName === '') { add('no client name', true); continue; }
    if (deadlineType === '') { add('no deadline type', true); continue; }

    const status = normaliseStatus(row['Status']);
    if (status === null) {
      add(`unrecognised status "${cell(row['Status'])}"`, true);
      continue;
    }

    const dueDate = parseSheetDate(row['Due Date']);
    if (dueDate === null) {
      add(`due date is not a usable date "${cell(row['Due Date'])}"`, true);
      continue;
    }

    summary.valid += 1;

    if (status !== ACTIVE_STATUS) { add(`status is ${status}`, false); continue; }

    const email = cell(row['Contact Email']);
    if (!isValidEmail(email)) {
      add(`contact email is missing or invalid "${email}"`, true);
      continue;
    }

    const daysUntilDue = daysBetween(today, dueDate);
    if (daysUntilDue === null) { add('due date could not be compared with today', true); continue; }
    if (daysUntilDue < 0) {
      const ago = -daysUntilDue;
      add(`due date passed ${ago} day${ago === 1 ? '' : 's'} ago and the status is not Filed: check with the client`, true);
      continue;
    }
    summary.upcoming += 1;

    const milestone = milestoneFor(daysUntilDue, config.milestones, gapDays);
    if (milestone === null) {
      add(`${daysUntilDue} days to go, before the first reminder at ${furthest} days`, false);
      continue;
    }

    // The sheet's own record is only trusted for the due date it was written
    // for. When a recurring deadline rolls to next year's date, last year's
    // "1" must not silence this year's reminders.
    const lastForThisDate = parseSheetDate(row['Reminded For Due Date']) === dueDate
      ? parseMilestoneCell(row['Last Reminder Sent'])
      : null;
    if (lastForThisDate !== null && lastForThisDate <= milestone) {
      add(`the ${lastForThisDate}-day reminder has already been sent`, false);
      continue;
    }

    // Belt and braces over the sheet: an append-only ledger of keys already
    // sent. The sheet write can fail; this is what makes a crash between
    // sending and writing back unable to produce a second copy.
    const key = keyFor(clientName, deadlineType, dueDate, milestone);
    if (alreadySent.has(key)) { add(`the ${milestone}-day reminder is already recorded as sent`, false); continue; }
    if (seenKeys.has(key)) { add('duplicate of another row for the same client, deadline and date', true); continue; }
    seenKeys.add(key);

    summary.due += 1;
    candidates.push({
      rowNumber, clientName, deadlineType, email, dueDate, daysUntilDue, milestone, key,
    });
  }

  // 2. One email per client contact, however many deadlines they have.
  const groups = new Map();
  for (const c of candidates) {
    const gk = c.email.toLowerCase();
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(c);
  }
  summary.grouped = groups.size;

  // 3. Build the emails, in a stable order so runs are reproducible.
  const actions = [];
  for (const [groupKey, deadlines] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    deadlines.sort((a, b) =>
      (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)
      || (a.deadlineType < b.deadlineType ? -1 : a.deadlineType > b.deadlineType ? 1 : 0)
      || a.rowNumber - b.rowNumber);
    const first = deadlines[0];
    const { subject, body, tone } = buildEmail({ clientName: first.clientName, deadlines, config });
    const realRecipient = first.email;
    actions.push({
      clientName: first.clientName,
      realRecipient,
      to: config.dryRun ? config.dryRunRecipient : realRecipient,
      subject: config.dryRun ? `[DRY RUN → ${realRecipient}] ${subject}` : subject,
      body,
      tone,
      deadlines,
      // One reminder per deadline per milestone, for all time. The send step
      // records this key so a crash between sending and writing back can never
      // produce a second copy.
      idempotencyKeys: deadlines.map((d) => d.key),
      groupKey,
      record: config.dryRun !== true,
    });
  }

  // 4. Hard ceiling. A breach is nearly always a bad sheet edit, so halt rather
  //    than send a partial batch that is hard to reason about afterwards.
  if (actions.length > config.maxEmailsPerRun) {
    summary.halted = true;
    summary.haltKind = 'ceiling';
    summary.alertable = true;
    summary.haltReason =
      `${actions.length} emails would be sent, which is above the limit of ${config.maxEmailsPerRun}. Nothing has been sent. Check the sheet, then raise the limit if the run is genuinely correct.`;
    summary.emails = 0;
    summary.skipped = skipped.length;
    return { actions: [], writeBacks: [], skipped, summary };
  }

  // A dry run records nothing. Writing to the Sent Log or the sheet would make
  // the real run, after DRY_RUN is switched off, believe these had been sent.
  const writeBacks = config.dryRun === true ? [] : actions.flatMap((a) =>
    a.deadlines.map((d) => ({
      rowNumber: d.rowNumber,
      clientName: d.clientName,
      deadlineType: d.deadlineType,
      lastReminderSent: d.milestone,
      remindedForDueDate: d.dueDate,
      lastRemindedOn: today,
      idempotencyKey: d.key,
    })),
  );

  summary.emails = actions.length;
  summary.skipped = skipped.length;
  return { actions, writeBacks, skipped, summary };
}

function cell(value) {
  return String(value ?? '').trim();
}

function norm(value) {
  return cell(value).toLowerCase().replace(/\s+/g, ' ');
}

function keyFor(clientName, deadlineType, dueDate, milestone) {
  return `${norm(clientName)}|${norm(deadlineType)}|${dueDate}|${milestone}`;
}

function labelOf(row) {
  const client = cell(row && row['Client Name']);
  const type = cell(row && row['Deadline Type']);
  return [client, type].filter(Boolean).join(' — ');
}

// Google Sheets reports row_number for every row it reads. If it is missing, the
// write-back would have nowhere safe to go, so the row is refused rather than
// guessed at from its position.
function rowNumberOf(row) {
  const n = row && row.row_number;
  return Number.isInteger(n) && n >= 2 ? n : null;
}

/** Is the manual hold cell set to today? Any date format the sheet uses is accepted. */
export function isHeldToday(holdUntil, today) {
  const held = parseSheetDate(holdUntil);
  return held !== null && held === today;
}

/** Did an earlier run today record that the preview email reached the practice? */
export function previewDelivered(runLog, today) {
  if (!Array.isArray(runLog)) return false;
  return runLog.some((r) => r && typeof r === 'object'
    && cell(r['Mode']).toLowerCase() === 'preview'
    && parseSheetDate(r['Run Date']) === today);
}
