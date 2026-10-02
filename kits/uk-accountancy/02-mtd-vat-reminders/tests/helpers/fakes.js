/**
 * In-memory stand-ins for the two services the workflow touches.
 * They record every call, so a test can assert that a write-back actually
 * happened, which is the defect that made the shipped kit unsafe.
 */

export function fakeSheet(rows) {
  const state = rows.map((r) => ({ ...r }));
  const calls = { reads: 0, updates: [] };
  let failNextRead = null;
  let failNextUpdate = null;

  return {
    state,
    calls,
    failReadOnce(err) { failNextRead = err; },
    failUpdateOnce(err) { failNextUpdate = err; },
    read() {
      if (failNextRead) { const e = failNextRead; failNextRead = null; throw e; }
      calls.reads += 1;
      return state.map((r) => ({ ...r }));
    },
    update({ rowNumber, values }) {
      if (failNextUpdate) { const e = failNextUpdate; failNextUpdate = null; throw e; }
      const row = state.find((r) => r.row_number === rowNumber);
      if (!row) throw new Error(`no row ${rowNumber}`);
      Object.assign(row, values);
      calls.updates.push({ rowNumber, values: { ...values } });
      return row;
    },
  };
}

export function fakeMailer() {
  const sent = [];
  const seenKeys = new Set();
  let failOn = null;

  return {
    sent,
    seenKeys,
    failOnNthSend(n, err) { failOn = { n, err }; },
    /** Mirrors the workflow's send step, including the idempotency guard. */
    send({ to, subject, body, idempotencyKeys = [] }) {
      const already = idempotencyKeys.filter((k) => seenKeys.has(k));
      if (already.length) return { skipped: true, duplicateKeys: already };
      if (failOn && sent.length + 1 === failOn.n) { const e = failOn.err; failOn = null; throw e; }
      idempotencyKeys.forEach((k) => seenKeys.add(k));
      sent.push({ to, subject, body, idempotencyKeys });
      return { skipped: false, messageId: `msg-${sent.length}` };
    },
  };
}

/** The Sent Log tab: an append-only list of idempotency keys. */
export function fakeLedger(keys = []) {
  const stored = [...keys];
  let failNext = null;
  return {
    get keys() { return [...stored]; },
    failAppendOnce(err) { failNext = err; },
    append(newKeys) {
      if (failNext) { const e = failNext; failNext = null; throw e; }
      stored.push(...newKeys);
    },
  };
}

/** The Submission Log tab: rows of { 'Client Name', 'VAT Period End', ... }. */
export function fakeSubmissionLog(rows = []) {
  const stored = rows.map((r) => ({ ...r }));
  let failNext = null;
  return {
    get rows() { return stored.map((r) => ({ ...r })); },
    failAppendOnce(err) { failNext = err; },
    append(confirmations) {
      if (failNext) { const e = failNext; failNext = null; throw e; }
      for (const c of confirmations) {
        stored.push({
          'Client Name': c.clientName, 'VAT Period End': c.periodEnd, 'Confirmed Submitted On': c.confirmedOn,
        });
      }
    },
  };
}
