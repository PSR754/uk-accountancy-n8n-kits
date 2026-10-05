// Interpreting the rules file and the reminder calendar. The numbers themselves
// (months, days, status lists) live in ../../rules/deadline-rules.json and are
// cited in ../../rules/RULES.md. Nothing here throws.

/** Returns a list of problems with a rules object. Empty means usable. */
export function rulesProblems(rules) {
  const out = [];
  const isNum = (v) => Number.isInteger(v) && v >= 0;
  if (!rules || typeof rules !== 'object') return ['rules are missing'];
  const a = rules.accounts || {};
  const f = a.firstAccounts || {};
  const c = rules.confirmationStatement || {};
  if (!isNum(a.privateMonthsAfterPeriodEnd)) out.push('accounts.privateMonthsAfterPeriodEnd');
  if (!isNum(a.publicMonthsAfterPeriodEnd)) out.push('accounts.publicMonthsAfterPeriodEnd');
  if (!isNum(a.standardPeriodMonths)) out.push('accounts.standardPeriodMonths');
  if (!isNum(f.privateMonthsAfterIncorporation)) out.push('accounts.firstAccounts.privateMonthsAfterIncorporation');
  if (!isNum(f.publicMonthsAfterIncorporation)) out.push('accounts.firstAccounts.publicMonthsAfterIncorporation');
  if (!isNum(f.minimumMonthsAfterPeriodEnd)) out.push('accounts.firstAccounts.minimumMonthsAfterPeriodEnd');
  if (!isNum(c.reviewPeriodMonths)) out.push('confirmationStatement.reviewPeriodMonths');
  if (!isNum(c.filingDaysAfterReviewPeriodEnd)) out.push('confirmationStatement.filingDaysAfterReviewPeriodEnd');
  if (!rules.companyStatus || !Array.isArray(rules.companyStatus.remindFor)
    || !Array.isArray(rules.companyStatus.suppress)) out.push('companyStatus');
  return out.map((p) => `rules file is missing or invalid: ${p}`);
}

/**
 * Which reminder band a deadline is in.
 * Milestones are days before the deadline, e.g. [30, 14, 7, 1]. The band is the
 * smallest milestone that is still at or above the days remaining, so a run that
 * was missed (n8n down, a weekend off) still produces the reminder the next time
 * it runs, instead of skipping a milestone for ever. Returns null when the
 * deadline is further away than the first milestone.
 *
 * A deadline already passed is `overdue-N`, where N steps up every
 * `overdueRepeatDays` so a late filing keeps surfacing without a daily flood.
 */
export function bandFor(daysRemaining, milestones, overdueRepeatDays) {
  if (!Number.isFinite(daysRemaining) || !Array.isArray(milestones)) return null;
  if (daysRemaining < 0) {
    const repeat = Number.isInteger(overdueRepeatDays) && overdueRepeatDays > 0 ? overdueRepeatDays : 7;
    const n = Math.floor((-daysRemaining - 1) / repeat) + 1;
    return { band: `overdue-${n}`, overdue: true };
  }
  const ascending = [...milestones].sort((x, y) => x - y);
  const m = ascending.find((x) => x >= daysRemaining);
  if (m === undefined) return null;
  return { band: String(m), overdue: false };
}

/** 'remind' | 'suppress' | 'review' for a Companies House company status. */
export function statusAction(status, rules) {
  const s = String(status ?? '').trim().toLowerCase();
  const st = (rules && rules.companyStatus) || {};
  if ((st.remindFor || []).includes(s)) return 'remind';
  if ((st.suppress || []).includes(s)) return 'suppress';
  return 'review';
}

export const KIND_LABEL = {
  accounts: 'Annual accounts',
  confirmationStatement: 'Confirmation statement',
};
