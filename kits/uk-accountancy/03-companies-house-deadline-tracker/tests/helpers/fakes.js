/** In-memory stand-ins for the services the workflow touches. They record every call. */

export function fakeLog(initial = []) {
  const rows = initial.map((r) => ({ ...r }));
  let failRead = false;
  let failAppend = false;
  return {
    rows,
    failReadOnce() { failRead = true; },
    failAppendOnce() { failAppend = true; },
    read() {
      if (failRead) { failRead = false; throw new Error('Google Sheets 503'); }
      return rows.map((r) => ({ ...r }));
    },
    append(row) {
      if (failAppend) { failAppend = false; throw new Error('Google Sheets 429'); }
      rows.push({ ...row });
    },
  };
}

export function fakeMailer() {
  const sent = [];
  let failNext = false;
  return {
    sent,
    failOnce() { failNext = true; },
    send(msg) {
      if (failNext) { failNext = false; throw new Error('SMTP timeout'); }
      sent.push(msg);
      return { messageId: `msg-${sent.length}` };
    },
  };
}

/** A Companies House company profile as the API returns it. */
export function profile(over = {}) {
  return {
    company_number: over.number ?? '01111111',
    company_name: over.name ?? 'Example Ltd',
    company_status: over.status ?? 'active',
    type: over.type ?? 'ltd',
    date_of_creation: over.created ?? '2019-03-14',
    accounts: {
      next_due: over.accountsDue ?? '2027-09-30',
      next_made_up_to: over.accountsMadeUpTo ?? '2026-12-31',
      overdue: over.accountsOverdue ?? false,
      last_accounts: { made_up_to: over.lastAccounts ?? '2025-12-31' },
    },
    confirmation_statement: {
      next_due: over.csDue ?? '2027-03-30',
      next_made_up_to: over.csMadeUpTo ?? '2027-03-16',
      last_made_up_to: over.lastCs ?? '2026-03-16',
      overdue: over.csOverdue ?? false,
    },
  };
}
