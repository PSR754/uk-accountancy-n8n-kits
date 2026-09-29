import { plan } from '../../src/core/plan.js';
import { addDays } from '../../src/core/dates.js';

/**
 * Run the kit the way the workflow does, against fakes: plan, send, write back.
 * Write-backs feed the next day's read, which is what makes multi-day behaviour
 * such as de-duplication and catch-up testable at all.
 */
export function runOnce({ sheet, mailer, today, config }) {
  const result = plan({ rows: sheet.read(), today, config });
  const delivered = [];
  for (const action of result.actions) {
    let outcome;
    try {
      outcome = mailer.send(action);
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
    for (const wb of result.writeBacks.filter((w) => action.idempotencyKeys.includes(w.idempotencyKey))) {
      sheet.update({
        rowNumber: wb.rowNumber,
        values: { 'Last Chase Stage': wb.lastChaseStage, 'Last Chased On': wb.lastChasedOn },
      });
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
