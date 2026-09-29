// Business rules with real-world consequences. Every constant here is cited in
// ../../rules/RULES.md. Change a value there and in this file together, and
// re-run the tests, which assert the cited values.

export const STAGES = ['friendly', 'firm', 'final'];

/** Rank of a chase stage. Unsent is 0, friendly 1, firm 2, final 3. */
export function stageRank(stage) {
  if (!stage) return 0;
  const i = STAGES.indexOf(String(stage).trim().toLowerCase());
  return i === -1 ? 0 : i + 1;
}

/** Canonical stage name from a sheet cell, or null if it is not a known stage. */
export function normaliseStage(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  return STAGES.includes(s) ? s : null;
}

/**
 * The stage an invoice has reached, given how many days of chasing it has earned.
 * Returns null below the first threshold.
 */
export function stageFor(effectiveDays, thresholds) {
  if (!Number.isFinite(effectiveDays)) return null;
  if (effectiveDays >= thresholds.final) return 'final';
  if (effectiveDays >= thresholds.firm) return 'firm';
  if (effectiveDays >= thresholds.friendly) return 'friendly';
  return null;
}

/**
 * Days of chasing an invoice has earned.
 *
 * An invoice already long overdue when it first entered the system has not been
 * chased by us, so it must walk the ladder from the first rung rather than
 * arriving at a final notice that claims a history of reminders that never happened.
 * Capping the effective age at (days since activation + the first threshold) makes
 * an activation-day invoice start at `friendly` and reach each later stage at the
 * normal pace, while an invoice tracked from issue is governed by its real age.
 */
export function effectiveDays(daysOverdue, daysSinceActivation, thresholds) {
  if (!Number.isFinite(daysOverdue)) return null;
  if (!Number.isFinite(daysSinceActivation)) return daysOverdue;
  const capped = daysSinceActivation + thresholds.friendly;
  return Math.min(daysOverdue, capped);
}

/**
 * Fixed sum recoverable under the Late Payment of Commercial Debts (Interest)
 * Act 1998 s5A. Business-to-business debts only. Amount in integer pence.
 * Bands: under £1,000 => £40; £1,000 to £9,999.99 => £70; £10,000 and over => £100.
 */
export function lpcdaCompensationPence(amountPence) {
  if (!Number.isFinite(amountPence) || amountPence <= 0) return 0;
  if (amountPence < 100000) return 4000;
  if (amountPence < 1000000) return 7000;
  return 10000;
}

/** The Act applies to business-to-business contracts only. */
export function lpcdaApplies(clientType) {
  return String(clientType ?? '').trim().toLowerCase() === 'business';
}

export const CLIENT_TYPES = ['business', 'individual'];

export function normaliseClientType(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'business' || s === 'b2b' || s === 'company') return 'business';
  if (s === 'individual' || s === 'consumer' || s === 'person') return 'individual';
  return null;
}

// Status values. Only `unpaid` is ever chased; the rest each stop chasing for
// a different reason and are reported separately so nothing disappears silently.
export const CHASEABLE_STATUS = 'unpaid';
export const KNOWN_STATUSES = ['unpaid', 'paid', 'disputed', 'payment plan', 'written off'];

export function normaliseStatus(value) {
  const s = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return null;
  if (s === 'outstanding' || s === 'open') return 'unpaid';
  if (s === 'settled') return 'paid';
  return KNOWN_STATUSES.includes(s) ? s : null;
}

// Deliberately conservative: enough to catch the blank and obviously broken
// addresses that stop a send, without rejecting unusual but valid ones.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value) {
  const s = String(value ?? '').trim();
  return s.length > 0 && s.length <= 254 && EMAIL_RE.test(s);
}
