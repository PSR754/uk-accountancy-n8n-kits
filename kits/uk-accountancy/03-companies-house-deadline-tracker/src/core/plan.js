// The one decision function. Given the sheet rows with whatever Companies House
// returned for each, the run date, the config and the keys of reminders already
// logged, it returns everything the workflow needs: the digest, the rows to log
// and a summary. It performs no I/O, reads no n8n globals and never throws.
// Anything it cannot handle comes back in `attention`, not as an exception.

import { daysBetween, dayOfWeek, tsOf } from './dates.js';
import { isEmptyRow, isValidEmail, readApiProfile, readCompanyRow } from './companies.js';
import { accountsDeadline, confirmationDeadline } from './deadlines.js';
import { bandFor, rulesProblems, statusAction } from './rules.js';
import { buildClientDraft, buildDigest } from './copy.js';
import { withDefaults } from './config.js';

function emptySummary(runDate, cfg) {
  return {
    runDate: runDate || null,
    rowsRead: 0,
    emptyRows: 0,
    reminders: 0,
    attention: 0,
    skipped: 0,
    lookupFailures: 0,
    lookupsAttempted: 0,
    lookupsAllFailed: false,
    failRun: false,
    failReason: '',
    dryRun: cfg.dryRun,
    halted: false,
    haltReason: '',
    digestTo: '',
    sendDigest: false,
  };
}

function halted(runDate, cfg, reason) {
  const summary = emptySummary(runDate, cfg);
  summary.halted = true;
  summary.haltReason = reason;
  summary.failRun = true;
  summary.failReason = reason;
  return { summary, reminders: [], attention: [], skipped: [], sentLogRows: [], digest: { subject: '', body: '' } };
}

function keyFor(number, kind, dueDate, band) {
  return `${number}|${kind}|${dueDate}|${band}`;
}

function evaluateCompany(entry, ctx) {
  const { today, cfg, sentSet, seenNumbers, out } = ctx;
  const rowObj = entry && typeof entry === 'object' && entry.row && typeof entry.row === 'object' ? entry.row : null;

  if (!rowObj || isEmptyRow(rowObj)) { out.summary.emptyRows += 1; return; }
  out.summary.rowsRead += 1;

  const rules = cfg.rules;
  const company = readCompanyRow(rowObj, rules);
  const who = { companyName: company.name, companyNumber: company.number.number };
  const attend = (reason) => out.attention.push({ ...who, reason });
  const skip = (reason) => out.skipped.push({ ...who, reason });

  if (company.paused) { skip('paused in the sheet'); return; }
  for (const p of company.problems) attend(p);

  if (!company.number.valid) {
    attend(`${company.number.reason}. Needs human confirmation.`);
    skip('no usable company number');
    return;
  }
  if (seenNumbers.has(company.number.number)) {
    attend('appears more than once in the sheet; only the first row is used');
    skip('duplicate company number');
    return;
  }
  seenNumbers.add(company.number.number);
  if (company.number.padded) {
    attend(`company number was padded with leading zeros to ${company.number.number}; fix the column format in the sheet so it is stored as text`);
  }

  if (entry.api !== null && entry.api !== undefined) out.summary.lookupsAttempted += 1;
  let profile = readApiProfile(entry.api);
  if (profile.ok && profile.number !== company.number.number) {
    // A response for a different company (or with no number) must never be applied.
    profile = { ok: false, reason: `Companies House returned ${profile.number ? `number ${profile.number}` : 'no company number'}, not ${company.number.number}, so the response was discarded` };
  }
  if (!profile.ok) {
    out.summary.lookupFailures += 1;
    attend(`${profile.reason}. Using the sheet only; deadlines are not cross-checked.`);
  } else {
    const action = statusAction(profile.status, rules);
    if (action === 'suppress') { skip(`company status is ${profile.status}`); return; }
    if (action === 'review') {
      attend(`company status is "${profile.status || 'unknown'}", so no reminders are raised. Needs human confirmation.`);
      skip('company status needs review');
      return;
    }
  }

  let type = company.type;
  if (profile.ok && profile.type) {
    if (company.type && company.type !== profile.type) {
      attend(`sheet says ${company.type} but Companies House says ${profile.type}; Companies House is used. Needs human confirmation.`);
    }
    type = profile.type;
  } else if (profile.ok && !company.type) {
    attend(`Companies House company type "${profile.rawType || 'unknown'}" is not one this kit applies accounts rules to. Needs human confirmation.`);
  }

  const name = company.name || (profile.ok ? profile.name : '');
  const deadlines = [
    accountsDeadline(company, profile, type, rules),
    confirmationDeadline(company, profile, rules),
  ];

  let reminded = 0;
  for (const d of deadlines) {
    if (!d.dueDate) {
      attend(`${d.kind === 'accounts' ? 'Accounts' : 'Confirmation statement'} deadline could not be worked out: ${d.flags.join(' ')}`);
      continue;
    }
    if (d.discrepancy) attend(`${d.kind === 'accounts' ? 'Accounts' : 'Confirmation statement'}: ${d.flags[0]}`);
    const days = daysBetween(today, d.dueDate);
    const band = bandFor(days, cfg.milestones, cfg.overdueRepeatDays);
    if (!band) continue;
    const key = keyFor(company.number.number, d.kind, d.dueDate, band.band);
    if (sentSet.has(key)) continue;
    const item = {
      companyName: name,
      companyNumber: company.number.number,
      kind: d.kind,
      dueDate: d.dueDate,
      days,
      band: band.band,
      overdue: band.overdue,
      source: d.source,
      flags: d.flags,
      needsConfirmation: d.needsConfirmation,
      idempotencyKey: key,
      draft: '',
      draftTo: '',
    };
    if (cfg.includeClientDrafts) {
      item.draft = buildClientDraft(item, cfg);
      item.draftTo = isValidEmail(company.email) ? company.email : '';
    }
    out.reminders.push(item);
    reminded += 1;
  }
  if (reminded === 0) skip('no deadline is in a reminder window, or already reminded');
}

/**
 * Reads the idempotency keys out of Sent Log rows. If the log has content but no
 * key can be found (a renamed header, say) it reports a problem instead of
 * returning an empty list, which would repeat every reminder every day.
 * Returns { keys, problem }; problem is '' when the log is fine or truly empty.
 */
export function sentLogKeys(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const keys = list
    .map((r) => String(r && typeof r === 'object' ? (r['Idempotency Key'] ?? '') : '').trim())
    .filter(Boolean);
  const hasContent = list.some((r) => r && typeof r === 'object'
    && Object.entries(r).some(([k, v]) => k !== 'row_number' && String(v ?? '').trim() !== ''));
  if (hasContent && keys.length === 0) {
    return { keys, problem: 'the Sent Log has data but no "Idempotency Key" column was found. Check the header spelling against templates/Sent Log.csv' };
  }
  return { keys, problem: '' };
}

/**
 * @param {object} input
 * @param {Array<{row: object, api: object|null}>} input.companies
 * @param {string} input.today  'YYYY-MM-DD' in Europe/London
 * @param {object} input.config
 * @param {string[]} input.sentKeys  idempotency keys already in the Sent Log
 */
export function plan(input) {
  let cfg = withDefaults(null);
  try {
    const { companies, today, config, sentKeys } = input && typeof input === 'object' ? input : {};
    cfg = withDefaults(config);

    if (tsOf(today) === null) return halted(today, cfg, `the run date "${String(today)}" is not a valid date`);
    const problems = rulesProblems(cfg.rules);
    if (problems.length) return halted(today, cfg, problems.join('; '));

    const out = {
      summary: emptySummary(today, cfg),
      reminders: [],
      attention: [],
      skipped: [],
      sentLogRows: [],
      digest: { subject: '', body: '' },
    };
    const sentSet = new Set((Array.isArray(sentKeys) ? sentKeys : []).map((k) => String(k ?? '').trim()).filter(Boolean));
    const seenNumbers = new Set();
    const list = Array.isArray(companies) ? companies : [];

    for (const entry of list) {
      try {
        evaluateCompany(entry, { today, cfg, sentSet, seenNumbers, out });
      } catch (err) {
        out.attention.push({
          companyName: '',
          companyNumber: '',
          reason: 'a row could not be processed and was skipped. Needs human confirmation.',
        });
      }
    }

    out.reminders.sort((a, b) => a.days - b.days
      || a.companyNumber.localeCompare(b.companyNumber)
      || a.kind.localeCompare(b.kind));
    out.skipped.sort((a, b) => a.companyNumber.localeCompare(b.companyNumber));

    const s = out.summary;
    if (s.lookupsAttempted > 0 && s.lookupFailures >= s.lookupsAttempted) {
      s.lookupsAllFailed = true;
      s.failRun = true;
      s.failReason = 'every Companies House lookup failed (check the API key and credential); dates came from the sheet only';
    }
    if (s.rowsRead === 0) {
      // An empty or wrong Companies tab, or a wrong sheet id, must not look like a quiet day.
      out.attention.push({ companyName: '', companyNumber: '', reason: 'no company rows were read. Check the Companies tab name, its headers and the sheet id.' });
      s.failRun = true;
      s.failReason = s.failReason || 'no company rows were read (check the Companies tab, its headers and the sheet id)';
    }
    s.reminders = out.reminders.length;
    s.attention = out.attention.length;
    s.skipped = out.skipped.length;

    const to = cfg.dryRun ? (cfg.dryRunRecipient || cfg.practiceEmail) : cfg.practiceEmail;
    s.digestTo = isValidEmail(to) ? String(to).trim() : '';
    const weekdayHit = cfg.attentionDigestWeekday !== null && dayOfWeek(today) === cfg.attentionDigestWeekday;
    const worthSending = out.reminders.length > 0 || (out.attention.length > 0 && weekdayHit);
    if (worthSending && !s.digestTo) {
      s.halted = true;
      s.haltReason = 'there is something to report but no valid practice email address is configured';
      s.failRun = true;
      s.failReason = s.haltReason;
    }
    s.sendDigest = worthSending && s.digestTo !== '';

    if (s.sendDigest) {
      out.digest = buildDigest({
        reminders: out.reminders, attention: out.attention, runDate: today, config: cfg, summary: s,
      });
      // Dry run records nothing, so that going live later loses no reminder.
      if (!cfg.dryRun) {
        out.sentLogRows = out.reminders.map((r) => ({
          'Idempotency Key': r.idempotencyKey,
          'Company Number': r.companyNumber,
          'Company Name': r.companyName,
          'Deadline Type': r.kind,
          'Due Date': r.dueDate,
          Band: r.band,
          'Reported On': today,
        }));
      }
    }
    return out;
  } catch (err) {
    return halted(input && input.today, cfg, 'unexpected error while planning; nothing was sent');
  }
}
