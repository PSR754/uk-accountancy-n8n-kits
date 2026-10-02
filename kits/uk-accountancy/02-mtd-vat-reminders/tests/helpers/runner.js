import { plan } from '../../src/core/plan.js';
import { addDays } from '../../src/core/dates.js';

/**
 * Run the kit the way the workflow does, against fakes: plan, send, write back.
 * Write-backs feed the next day's read, which is what makes multi-day behaviour
 * such as de-duplication and catch-up testable at all.
 */
export function runOnce({
  sheet, mailer, today, config, ledger = null, holdUntil = null, runLog = [], submissionLog = null,
}) {
  const result = plan({
    rows: sheet.read(),
    today,
    config,
    sentKeys: ledger ? ledger.keys : [],
    holdUntil,
    requirePreview: false,
    runLog,
    submissionLog: submissionLog ? submissionLog.rows : [],
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
    // Mirrors the workflow: the ledger append, then the sheet update, both
    // always attempted. A failure in either is reported (once per client) and the
    // loop moves on. The email has already gone, so it is not undone.
    let writeFailed = false;
    try {
      if (ledger && mine.length) ledger.append(mine.map((w) => w.idempotencyKey));
    } catch (err) {
      writeFailed = true;
    }
    for (const wb of mine) {
      try {
        sheet.update({
          rowNumber: wb.rowNumber,
          values: {
            'Last Checklist Sent': wb.lastChecklistSent,
            'Checklist For Period End': wb.checklistForPeriodEnd,
            'Last Checklist On': wb.lastChecklistOn,
          },
        });
      } catch (err) {
        writeFailed = true;
      }
    }
    if (writeFailed) result.summary.writeFailed = (result.summary.writeFailed || 0) + 1;
  }

  // The Submission Log append, mirrored: attempted once, a failure is reported.
  const toLog = result.confirmations.filter((c) => c.record);
  if (submissionLog && toLog.length) {
    try {
      submissionLog.append(toLog);
    } catch (err) {
      result.summary.submissionLogFailed = true;
    }
  }
  return { ...result, delivered };
}

/** Run every day from `from` to `to` inclusive, carrying state forward. */
export function runRange({ sheet, mailer, from, to, config, ledger = null, submissionLog = null, onDay }) {
  const days = [];
  let d = from;
  for (let guard = 0; guard < 2000; guard += 1) {
    const r = runOnce({ sheet, mailer, today: d, config, ledger, submissionLog });
    days.push({ date: d, ...r });
    if (onDay) onDay(d, r, sheet);
    if (d === to) break;
    d = addDays(d, 1);
  }
  return days;
}
