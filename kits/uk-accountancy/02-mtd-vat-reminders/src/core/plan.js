import { parseSheetDate, daysBetween, sendableDay, nextSendableDay } from './dates.js';
import {
  milestoneFor, parseMilestoneCell, normaliseSubmitted, isValidEmail, ACTIVE_STATUS, addressProblems,
} from './rules.js';
import { vatReturnDeadline, classifyScheme, deadlineFallsOn, rulesAge } from './deadline.js';
import { buildEmail } from './copy.js';
import { withDefaults } from './config.js';

/**
 * Decide everything this kit will do on a given day.
 *
 * This is the whole of the decision-making. It is a pure function: the same
 * rows and the same date always produce the same result, it performs no input
 * or output, and it never throws on bad data. The n8n workflow around it only
 * reads rows, delivers what this returns, and writes back what this says to write.
 * Nothing it returns is a submission or a payment: the only outputs are reminder
 * emails, a preview of them, and a log of returns the practice has marked as
 * submitted. The kit never submits a VAT return to HMRC.
 *
 * The VAT return deadline is calculated from the period end using the rule in
 * `config.vatRules` (rules/vat-rules.json), for periods ending on the last day of
 * a month only. The sheet's "HMRC Due Date", taken from the client's VAT online
 * account, always wins, and is required for any other period end: without it
 * the row is flagged for manual handling and no reminder is sent.
 *
 * `checkAddresses` (true in the workflow) makes a live run refuse to go with an
 * empty or placeholder sender or practice address.
 * `holdUntil` is the practice's manual hold cell. `requirePreview` is true for
 * the 09:00 send run: it refuses to send unless `runLog` shows that today's
 * preview email was delivered to the practice. `submissionLog` holds the rows
 * of the Submission Log tab, so a return is logged once. In dry run nothing is
 * recorded (`writeBacks` and recordable `confirmations` are empty and each
 * action has `record: false`), because a dry run must leave no trace that could
 * suppress the real reminder later.
 *
 * @returns {{actions: Array, skipped: Array, writeBacks: Array, confirmations: Array, notices: Array, summary: Object}}
 */
export function plan({
  rows, today, config: rawConfig, sentKeys = [], holdUntil = null, requirePreview = false, runLog = [],
  submissionLog = [], checkAddresses = false,
}) {
  const alreadySent = new Set(
    (Array.isArray(sentKeys) ? sentKeys : []).map((k) => String(k).trim()).filter(Boolean),
  );
  const config = withDefaults(rawConfig);
  const rules = config.vatRules;
  const list = Array.isArray(rows) ? rows : [];
  const skipped = [];
  const notices = [];
  const age = rulesAge(today, rules);
  const summary = {
    runDate: today,
    rowsRead: 0,
    valid: 0,
    upcoming: 0,
    due: 0,
    grouped: 0,
    emails: 0,
    skipped: 0,
    submitted: 0,
    confirmations: 0,
    confirmationsToRecord: 0,
    halted: false,
    haltReason: null,
    // hold, preview, config, rules or ceiling. A hold is the practice's own
    // decision; the rest are faults the practice should hear about.
    haltKind: null,
    alertable: false,
    sendableDay: true,
    notSendableReason: null,
    dryRun: config.dryRun === true,
    milestones: config.milestones,
    rulesValidAsOf: age.validAsOf,
    rulesNote: age.stale
      ? `the VAT deadline rules in rules/vat-rules.json were last checked against gov.uk on ${age.validAsOf || '(no date recorded)'}. Re-check them and update the date`
      : null,
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

  const empty = (extra = {}) => ({
    actions: [], writeBacks: [], confirmations: [], skipped: [], notices: [], summary, ...extra,
  });

  const day = sendableDay(today, config);
  if (!day.sendable) {
    summary.sendableDay = false;
    summary.notSendableReason = day.reason;
    // A weekend, bank holiday or quiet period is by design. An unusable run date is a fault.
    summary.alertable = day.reason === 'invalid run date';
    summary.skipped = summary.rowsRead;
    return empty({
      skipped: entries.map(({ raw }) => ({
        rowNumber: rowNumberOf(raw),
        label: labelOf(raw),
        reason: `not a sending day: ${day.reason}`,
        needsAttention: false,
      })),
    });
  }

  if (isHeldToday(holdUntil, today)) {
    summary.halted = true;
    summary.haltKind = 'hold';
    summary.haltReason = 'run held by the practice (Hold Until in the Run Control tab is today)';
    return empty();
  }

  if (checkAddresses === true && config.dryRun !== true) {
    const problems = addressProblems(config);
    if (problems.length) {
      summary.halted = true;
      summary.haltKind = 'config';
      summary.alertable = true;
      summary.haltReason = `settings to fix before going live: ${problems.join('; ')}`;
      return empty();
    }
  }

  if (requirePreview === true && !previewDelivered(runLog, today)) {
    summary.halted = true;
    summary.haltKind = 'preview';
    summary.alertable = true;
    summary.haltReason = 'no preview email was delivered to the practice today, so nothing has been sent';
    return empty();
  }

  if (config.dryRun === true && !isValidEmail(config.dryRunRecipient)) {
    summary.halted = true;
    summary.haltKind = 'config';
    summary.alertable = true;
    summary.haltReason = 'dry run is on but no valid dryRunRecipient is configured';
    return empty();
  }

  // The deadline rule is data. If the file is damaged, every deadline would be
  // wrong or missing, so the run stops and says so instead of guessing.
  const probe = vatReturnDeadline('2026-01-31', rules);
  if (!probe.ok) {
    summary.halted = true;
    summary.haltKind = 'rules';
    summary.alertable = true;
    summary.haltReason = probe.reason;
    return empty();
  }

  // If tomorrow is not a sending day, a reminder that would land in the gap is
  // brought forward to today. This is what stops a Monday deadline never
  // getting its final reminder because the day before was a Sunday.
  const next = nextSendableDay(today, config);
  const gapDays = next === null ? 1 : Math.max(1, daysBetween(today, next) ?? 1);
  const furthest = Math.max(...config.milestones);

  const logged = new Set();
  for (const r of Array.isArray(submissionLog) ? submissionLog : []) {
    if (!r || typeof r !== 'object') continue;
    const p = parseSheetDate(r['VAT Period End'] ?? r['VAT Quarter End']);
    if (cell(r['Client Name']) !== '' && p !== null) logged.add(confirmationKey(r['Client Name'], p));
  }

  // 1. Validate and classify every row. Nothing is ever dropped silently.
  const candidates = [];
  const confirmations = [];
  const seenKeys = new Set();
  const seenConfirmations = new Set();
  for (const { raw } of entries) {
    const row = raw;
    const rowNumber = rowNumberOf(row);
    const label = labelOf(row);
    const add = (reason, needsAttention) => skipped.push({ rowNumber, label, reason, needsAttention });

    if (rowNumber === null) {
      add('the sheet read did not return a row number for this row, so it cannot be written back to safely', true);
      continue;
    }

    const clientName = cell(row['Client Name']);
    if (clientName === '') { add('no client name', true); continue; }

    const rawPeriod = periodCell(row);
    const periodEnd = parseSheetDate(rawPeriod);
    if (periodEnd === null) {
      add(`VAT period end is not a usable date "${cell(rawPeriod)}"`, true);
      continue;
    }

    const status = normaliseSubmitted(row['Submitted']);
    if (status === null) {
      add(`unrecognised Submitted value "${cell(row['Submitted'])}"`, true);
      continue;
    }

    summary.valid += 1;

    if (status === 'submitted') {
      summary.submitted += 1;
      const sinceEnd = daysBetween(periodEnd, today);
      if (sinceEnd === null) { add('period end could not be compared with today', true); continue; }
      if (sinceEnd < 0) {
        add('marked Submitted, but the VAT period has not ended yet: check the period end and the Submitted cell', true);
        continue;
      }
      add('already submitted: reminders stopped', false);
      const ckey = confirmationKey(clientName, periodEnd);
      if (sinceEnd <= config.confirmationLookbackDays && !logged.has(ckey) && !seenConfirmations.has(ckey)) {
        seenConfirmations.add(ckey);
        confirmations.push({
          rowNumber, clientName, periodEnd, confirmedOn: today, key: ckey, record: config.dryRun !== true,
        });
      }
      continue;
    }
    if (status !== ACTIVE_STATUS) { add(`status is ${status}`, false); continue; }

    const scheme = classifyScheme(row['VAT Scheme'], rules);
    if (scheme.kind === 'unsupported') {
      add(`VAT scheme "${scheme.label}" has a different deadline that this kit does not calculate: remind this client by hand`, true);
      continue;
    }
    if (scheme.kind === 'unknown') {
      add(`unrecognised VAT scheme "${scheme.label}": leave the cell blank for a standard return`, true);
      continue;
    }

    const email = cell(row['Contact Email']);
    if (!isValidEmail(email)) {
      add(`contact email is missing or invalid "${email}"`, true);
      continue;
    }

    const calculated = vatReturnDeadline(periodEnd, rules);
    let dueDate = calculated.ok ? calculated.dueDate : null;
    let dueDateSource = 'calculated';
    const rawOverride = cell(row['HMRC Due Date']);
    if (rawOverride === '' && !calculated.ok) {
      if (calculated.manual) {
        add(`VAT period end ${periodEnd} is not the last day of a month, so the kit does not calculate its deadline: type the due date from the client's VAT online account into HMRC Due Date. No reminder is sent until you do`, true);
      } else {
        add(calculated.reason, true);
      }
      continue;
    }
    if (rawOverride !== '') {
      const override = parseSheetDate(rawOverride);
      if (override === null) { add(`HMRC Due Date is not a usable date "${rawOverride}"`, true); continue; }
      const overrideGap = daysBetween(periodEnd, override);
      if (overrideGap === null || overrideGap < 1 || overrideGap > 400) {
        add(`HMRC Due Date ${override} is not after the VAT period end ${periodEnd}: check both dates`, true);
        continue;
      }
      dueDate = override;
      dueDateSource = 'sheet';
      if (calculated.ok && override !== calculated.dueDate) {
        notices.push({
          rowNumber, label,
          message: `HMRC Due Date ${override} differs from the calculated ${calculated.dueDate}; the sheet's date is being used`,
        });
      }
    }

    const daysUntilDue = daysBetween(today, dueDate);
    if (daysUntilDue === null) { add('due date could not be compared with today', true); continue; }
    if (daysUntilDue < 0) {
      const ago = -daysUntilDue;
      add(`VAT deadline ${dueDate} passed ${ago} day${ago === 1 ? '' : 's'} ago and the return is not marked Submitted: check with the client and HMRC`, true);
      continue;
    }
    summary.upcoming += 1;

    const milestone = milestoneFor(daysUntilDue, config.milestones, gapDays);
    if (milestone === null) {
      add(`${daysUntilDue} days to go, before the first reminder at ${furthest} days`, false);
      continue;
    }

    // The sheet's own record is only trusted for the period it was written
    // for. When the row rolls on to the next quarter, last quarter's "3" must
    // not silence this quarter's reminders.
    const lastForThisPeriod = parseSheetDate(row['Checklist For Period End']) === periodEnd
      ? parseMilestoneCell(row['Last Checklist Sent'])
      : null;
    if (lastForThisPeriod !== null && lastForThisPeriod <= milestone) {
      add(`the ${lastForThisPeriod}-day reminder has already been sent`, false);
      continue;
    }

    // Belt and braces over the sheet: an append-only ledger of keys already
    // sent. The sheet write can fail; this is what makes a crash between
    // sending and writing back unable to produce a second copy.
    const key = keyFor(clientName, periodEnd, milestone);
    if (alreadySent.has(key)) { add(`the ${milestone}-day reminder is already recorded as sent`, false); continue; }
    if (seenKeys.has(key)) { add('duplicate of another row for the same client and VAT period', true); continue; }
    seenKeys.add(key);

    summary.due += 1;
    candidates.push({
      rowNumber,
      clientName,
      periodEnd,
      email,
      dueDate,
      dueDateSource,
      deadlineFallsOn: deadlineFallsOn(dueDate, config.bankHolidays),
      daysUntilDue,
      milestone,
      key,
    });
  }

  summary.confirmations = confirmations.length;
  summary.confirmationsToRecord = confirmations.filter((c) => c.record).length;

  // 2. One email per client contact, however many VAT periods they have open.
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
      || (a.clientName < b.clientName ? -1 : a.clientName > b.clientName ? 1 : 0)
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
      // One reminder per client, period and milestone, for all time. The send
      // step records this key so a crash between sending and writing back can
      // never produce a second copy.
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
    return empty({ skipped, notices, confirmations: confirmations.filter((c) => c.record) });
  }

  // A dry run records nothing. Writing to the Sent Log or the sheet would make
  // the real run, after DRY_RUN is switched off, believe these had been sent.
  const writeBacks = config.dryRun === true ? [] : actions.flatMap((a) =>
    a.deadlines.map((d) => ({
      rowNumber: d.rowNumber,
      clientName: d.clientName,
      periodEnd: d.periodEnd,
      dueDate: d.dueDate,
      lastChecklistSent: d.milestone,
      checklistForPeriodEnd: d.periodEnd,
      lastChecklistOn: today,
      idempotencyKey: d.key,
    })));

  summary.emails = actions.length;
  summary.skipped = skipped.length;
  return { actions, writeBacks, confirmations, skipped, notices, summary };
}

function cell(value) {
  return String(value ?? '').trim();
}

function norm(value) {
  return cell(value).toLowerCase().replace(/\s+/g, ' ');
}

function keyFor(clientName, periodEnd, milestone) {
  return `${norm(clientName)}|${periodEnd}|${milestone}`;
}

/** The key under which a submitted return is logged: once per client and VAT period. */
export function confirmationKey(clientName, periodEnd) {
  return `${norm(clientName)}|${periodEnd}`;
}

// "VAT Quarter End" was this column's name in earlier versions of the kit.
function periodCell(row) {
  const v = row && row['VAT Period End'];
  return cell(v) !== '' ? v : row && row['VAT Quarter End'];
}

function labelOf(row) {
  const client = cell(row && row['Client Name']);
  const period = cell(periodCell(row));
  return [client, period ? `period end ${period}` : ''].filter(Boolean).join(' — ');
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
