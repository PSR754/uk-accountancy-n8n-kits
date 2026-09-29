import { parseSheetDate, daysBetween, sendableDay } from './dates.js';
import { parseGBP } from './money.js';
import {
  stageFor, stageRank, effectiveDays, normaliseStage, normaliseStatus,
  normaliseClientType, isValidEmail, CHASEABLE_STATUS,
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
 *
 * @returns {{actions: Array, skipped: Array, writeBacks: Array, summary: Object}}
 */
export function plan({ rows, today, config: rawConfig, sentKeys = [] }) {
  const alreadySent = new Set(
    (Array.isArray(sentKeys) ? sentKeys : []).map((k) => String(k).trim()).filter(Boolean),
  );
  const config = withDefaults(rawConfig);
  const skipped = [];
  const summary = {
    runDate: today,
    rowsRead: Array.isArray(rows) ? rows.length : 0,
    valid: 0,
    overdue: 0,
    due: 0,
    grouped: 0,
    emails: 0,
    skipped: 0,
    halted: false,
    haltReason: null,
    sendableDay: true,
    notSendableReason: null,
    dryRun: config.dryRun === true,
  };

  const day = sendableDay(today, config);
  if (!day.sendable) {
    summary.sendableDay = false;
    summary.notSendableReason = day.reason;
    summary.skipped = summary.rowsRead;
    return {
      actions: [],
      writeBacks: [],
      skipped: (rows || []).map((r, i) => ({
        rowNumber: rowNumberOf(r, i),
        invoiceNumber: String(r?.['Invoice Number'] ?? '').trim(),
        reason: `not a sending day: ${day.reason}`,
        needsAttention: false,
      })),
      summary,
    };
  }

  if (config.dryRun === true && !isValidEmail(config.dryRunRecipient)) {
    summary.halted = true;
    summary.haltReason = 'dry run is on but no valid dryRunRecipient is configured';
    return { actions: [], writeBacks: [], skipped: [], summary };
  }

  // 1. Validate and classify every row. Nothing is ever dropped silently.
  const candidates = [];
  for (const [i, raw] of (rows || []).entries()) {
    const row = raw && typeof raw === 'object' ? raw : {};
    const rowNumber = rowNumberOf(row, i);
    const invoiceNumber = String(row['Invoice Number'] ?? '').trim();
    const add = (reason, needsAttention) =>
      skipped.push({ rowNumber, invoiceNumber, reason, needsAttention });

    if (invoiceNumber === '') { add('no invoice number', true); continue; }

    const status = normaliseStatus(row['Status']);
    if (status === null) {
      add(`unrecognised status "${String(row['Status'] ?? '').trim()}"`, true);
      continue;
    }

    const amountPence = parseGBP(row['Amount GBP']);
    if (amountPence === null) {
      add(`amount is not a usable number "${String(row['Amount GBP'] ?? '').trim()}"`, true);
      continue;
    }

    const dueDate = parseSheetDate(row['Due Date']);
    if (dueDate === null) {
      add(`due date is not a usable date "${String(row['Due Date'] ?? '').trim()}"`, true);
      continue;
    }

    const clientType = normaliseClientType(row['Client Type']);
    if (clientType === null) {
      add(`client type must be Business or Individual, found "${String(row['Client Type'] ?? '').trim()}"`, true);
      continue;
    }

    summary.valid += 1;

    if (status !== CHASEABLE_STATUS) { add(`status is ${status}`, false); continue; }
    if (amountPence <= 0) { add('amount is zero or negative', true); continue; }

    const email = String(row['Client Email'] ?? '').trim();
    if (!isValidEmail(email)) {
      add(`client email is missing or invalid "${email}"`, true);
      continue;
    }

    const daysOverdue = daysBetween(dueDate, today);
    if (daysOverdue === null || daysOverdue <= 0) { add('not yet overdue', false); continue; }
    summary.overdue += 1;

    // An invoice with no activation date is treated as having entered the system
    // today, which is the cautious reading: it starts at the first rung.
    const activationDate = parseSheetDate(row['Activation Date']) ?? today;
    const daysSinceActivation = Math.max(0, daysBetween(activationDate, today) ?? 0);

    const earned = effectiveDays(daysOverdue, daysSinceActivation, config.thresholds);
    const stage = stageFor(earned, config.thresholds);
    if (stage === null) { add(`overdue ${daysOverdue} day(s), below the first chase threshold`, false); continue; }

    const lastStage = normaliseStage(row['Last Chase Stage']);
    if (stageRank(stage) <= stageRank(lastStage)) {
      add(`${stage} already sent`, false);
      continue;
    }

    const lastChasedOn = parseSheetDate(row['Last Chased On']);
    if (lastChasedOn) {
      const since = daysBetween(lastChasedOn, today);
      if (since !== null && since < config.minDaysBetweenChases) {
        add(`chased ${since} day(s) ago, minimum gap is ${config.minDaysBetweenChases}`, false);
        continue;
      }
    }

    // Belt and braces over the sheet's own Last Chase Stage: an append-only
    // ledger of keys already sent. The sheet write can fail; this is what makes
    // a crash between sending and writing back unable to produce a second copy.
    const key = `${invoiceNumber}|${stage}`;
    if (alreadySent.has(key)) { add(`${stage} already recorded as sent`, false); continue; }

    summary.due += 1;
    candidates.push({
      rowNumber, invoiceNumber, email, clientType, amountPence, dueDate,
      daysOverdue, stage, hasPriorChase: stageRank(lastStage) > 0,
      clientName: String(row['Client'] ?? '').trim() || invoiceNumber,
    });
  }

  // 2. One email per client contact, however many invoices they owe on.
  const groups = new Map();
  for (const c of candidates) {
    const key = c.email.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  summary.grouped = groups.size;

  // 3. Build the emails, in a stable order so runs are reproducible.
  const actions = [];
  for (const [key, invoices] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    invoices.sort((a, b) => b.daysOverdue - a.daysOverdue || (a.invoiceNumber < b.invoiceNumber ? -1 : 1));
    const stage = invoices.reduce(
      (best, i) => (stageRank(i.stage) > stageRank(best) ? i.stage : best), null,
    );
    const hasPriorChase = invoices.some((i) => i.hasPriorChase);
    const first = invoices[0];
    const { subject, body } = buildEmail({
      clientName: first.clientName,
      clientType: first.clientType,
      invoices, stage, hasPriorChase, config,
    });

    const realRecipient = first.email;
    actions.push({
      clientName: first.clientName,
      clientType: first.clientType,
      realRecipient,
      to: config.dryRun ? config.dryRunRecipient : realRecipient,
      subject: config.dryRun ? `[DRY RUN → ${realRecipient}] ${subject}` : subject,
      body,
      stage,
      invoices,
      // One email per invoice per stage, for all time. The send step records
      // this key and refuses a key it has already recorded, so a crash between
      // sending and writing back can never produce a second copy.
      idempotencyKeys: invoices.map((i) => `${i.invoiceNumber}|${i.stage}`),
      groupKey: key,
    });
  }

  // 4. Hard ceiling. A breach is nearly always a bad sheet edit, so halt rather
  //    than send a partial batch that is hard to reason about afterwards.
  if (actions.length > config.maxEmailsPerRun) {
    summary.halted = true;
    summary.haltReason =
      `${actions.length} emails would be sent, which is above the limit of ${config.maxEmailsPerRun}. Nothing has been sent. Check the sheet, then raise the limit if the run is genuinely correct.`;
    summary.emails = 0;
    summary.skipped = skipped.length;
    return { actions: [], writeBacks: [], skipped, summary };
  }

  const writeBacks = actions.flatMap((a) =>
    a.invoices.map((i) => ({
      rowNumber: i.rowNumber,
      invoiceNumber: i.invoiceNumber,
      lastChaseStage: i.stage,
      lastChasedOn: today,
      idempotencyKey: `${i.invoiceNumber}|${i.stage}`,
    })),
  );

  summary.emails = actions.length;
  summary.skipped = skipped.length;
  return { actions, writeBacks, skipped, summary };
}

function rowNumberOf(row, index) {
  const n = row && row.row_number;
  return Number.isFinite(n) ? n : index + 2; // +2: header row, then 1-based
}
