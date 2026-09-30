import { plan } from '../../src/core/plan.js';
import { addDays } from '../../src/core/dates.js';

/**
 * Run the kit the way the workflow does, against fakes: plan, send, write back.
 * Write-backs feed the next day's read, which is what makes multi-day behaviour
 * such as de-duplication and catch-up testable at all.
 */
export function runOnce({ sheet, mailer, today, config, ledger = null, holdUntil = null, runLog = [] }) {
  const result = plan({
    rows: sheet.read(), today, config, sentKeys: ledger ? ledger.keys : [], holdUntil, requirePreview: false, runLog,
  });
  const delivered = [];
  for (const action of result.actions) {
    let outcome;
    try {
      // In dry run the send step must not record a ledger key either.
      outcome = mailer.send({ ...action, idempotencyKeys: action.record ? action.idempotencyKeys : [] });
    } catch (err) {
      // The workflow continues to the next recipient; the row is not marked sent.
      result.summary.sendErrors = (result.summary.sendErrors || 0) + 1;
      continue;
    }
    if (outcome.skipped) {
      result.summary.duplicatesPrevented =
        (result.summary.duplicatesPrevented || 0) + outcome.duplicateKeys.length;
      continue;
    }
    delivered.push(action);
    const mine = result.writeBacks.filter((w) => action.idempotencyKeys.includes(w.idempotencyKey));
    // Mirrors the workflow: the ledger append, then the sheet update. A failure
    // in either is caught (the error output), counted, and the loop moves on to
    // the next client. The email has already gone, so it is not undone.
    try {
      if (ledger && mine.length) ledger.append(mine.map((w) => w.idempotencyKey));
    } catch (err) {
      result.summary.writeFailed = (result.summary.writeFailed || 0) + 1;
      continue; // no ledger row means the sheet update is skipped too
    }
    for (const wb of mine) {
      try {
        sheet.update({
          rowNumber: wb.rowNumber,
          values: {
            'Last Reminder Sent': wb.lastReminderSent,
            'Reminded For Due Date': wb.remindedForDueDate,
            'Last Reminded On': wb.lastRemindedOn,
          },
        });
      } catch (err) {
        result.summary.writeFailed = (result.summary.writeFailed || 0) + 1;
        break;
      }
    }
  }
  return { ...result, delivered };
}

/** Run every day from `from` to `to` inclusive, carrying state forward. */
export function runRange({ sheet, mailer, from, to, config, onDay }) {
  const days = [];
  let d = from;
  for (let guard = 0; guard < 2000; guard += 1) {
    const r = runOnce({ sheet, mailer, today: d, config });
    days.push({ date: d, ...r });
    if (onDay) onDay(d, r, sheet);
    if (d === to) break;
    d = addDays(d, 1);
  }
  return days;
}
