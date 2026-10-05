import { plan } from '../../src/core/plan.js';

/**
 * Runs the kit the way the workflow does, against fakes: look up each company,
 * plan, email the digest, then record in the Sent Log. The Sent Log feeds the
 * next day's plan, which is what makes de-duplication and catch-up testable.
 *
 * `lookup(number)` may return a profile or throw. A throw becomes the same error
 * object the workflow passes on after a failed HTTP request.
 */
export function runOnce({ rows, lookup, mailer, log, today, config }) {
  const companies = rows.map((row) => {
    let api;
    try { api = lookup(String(row._companyNumber ?? row['Company Number'] ?? '')); }
    catch (err) { api = { error: { message: err.message } }; }
    return { row, api };
  });

  const result = plan({
    companies, today, config, sentKeys: log.read().map((r) => r['Idempotency Key']),
  });

  let sent = false;
  let sendError = null;
  if (result.summary.sendDigest) {
    try {
      mailer.send({ to: result.summary.digestTo, subject: result.digest.subject, body: result.digest.body });
      sent = true;
    } catch (err) {
      sendError = err;
    }
  }
  // The sent-log step only runs after a successful send.
  if (sent) for (const row of result.sentLogRows) log.append(row);
  return { ...result, sent, sendError };
}
