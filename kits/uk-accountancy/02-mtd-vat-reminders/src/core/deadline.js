// The one place a VAT return deadline is calculated. The numbers come from
// rules/vat-rules.json (passed in as `rules`), never from this file, so a change
// to the rule is a data change that the register and the tests can see.
// Nothing here performs input or output, and nothing here throws.
import { addCalendarMonths, addDays, tsOf, daysBetween, isWeekend, isBankHoliday, isMonthEnd } from './dates.js';

function wholeNonNegative(n) {
  return Number.isInteger(n) && n >= 0 && n <= 120;
}

/**
 * The date a VAT return (and its payment) is due, from the end of the VAT
 * accounting period: a number of calendar months, then a number of days.
 *
 * The result is NOT moved for weekends or bank holidays. gov.uk states the
 * return and payment must be in "even if it's on a weekend or bank holiday".
 *
 * Only a period ending on the last day of a month is calculated (when
 * `onlyMonthEndPeriodsCalculated` is true, as shipped). Regulation 25(1) of the
 * VAT Regulations 1995 gives the last day of the month next following the end of
 * the period, which gov.uk's "one calendar month and 7 days" then extends by 7
 * days. For any other period end the rule is not written down in a form this kit
 * can rely on, so no date is calculated: the result is `manual: true` and the
 * date must come from the client's VAT online account.
 *
 * @returns {{ok: true, dueDate: string} | {ok: false, manual?: boolean, reason: string}}
 */
export function vatReturnDeadline(periodEnd, rules) {
  if (tsOf(periodEnd) === null) return { ok: false, reason: 'the VAT period end is not a real date' };
  const r = rules && rules.returnDeadline;
  if (!r || !wholeNonNegative(r.calendarMonthsAfterPeriodEnd) || !wholeNonNegative(r.daysAfterThat)) {
    return { ok: false, reason: 'the VAT deadline rule in rules/vat-rules.json is missing or unusable' };
  }
  const monthEndOnly = r.onlyMonthEndPeriodsCalculated === true;
  if (monthEndOnly && !isMonthEnd(periodEnd)) {
    return { ok: false, manual: true, reason: 'the VAT period end is not the last day of a month, so its deadline is not calculated' };
  }
  const monthsLater = addCalendarMonths(periodEnd, r.calendarMonthsAfterPeriodEnd, monthEndOnly);
  const dueDate = monthsLater === null ? null : addDays(monthsLater, r.daysAfterThat);
  if (dueDate === null) return { ok: false, reason: 'the VAT deadline could not be calculated' };
  return { ok: true, dueDate };
}

/**
 * Which kind of VAT scheme a sheet cell describes.
 *  - 'standard': the ordinary return deadline applies.
 *  - 'unsupported': a scheme with a different deadline, which this kit does not calculate.
 *  - 'unknown': a word the kit does not recognise; the planner reports it.
 */
export function classifyScheme(value, rules) {
  const s = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const schemes = (rules && rules.schemes) || {};
  const same = Array.isArray(schemes.sameReturnDeadline) ? schemes.sameReturnDeadline : [''];
  const unsupported = Array.isArray(schemes.unsupported) ? schemes.unsupported : [];
  if (same.includes(s)) return { kind: 'standard', label: s };
  if (unsupported.includes(s)) return { kind: 'unsupported', label: s };
  return { kind: 'unknown', label: s };
}

/** Is the deadline on a weekend or a bank holiday? Used only to tell the client the date is not moved. */
export function deadlineFallsOn(dueDate, holidays) {
  if (tsOf(dueDate) === null) return null;
  if (isWeekend(dueDate)) return 'weekend';
  if (isBankHoliday(dueDate, holidays)) return 'bank holiday';
  return null;
}

/**
 * How old the rules file is. A rule that nobody has re-read for a year is a
 * risk in its own right, so the preview says so.
 * @returns {{validAsOf: string|null, ageDays: number|null, stale: boolean}}
 */
export function rulesAge(today, rules) {
  const validAsOf = rules && typeof rules.validAsOf === 'string' ? rules.validAsOf : null;
  const ageDays = validAsOf === null ? null : daysBetween(validAsOf, today);
  const limit = rules && Number.isInteger(rules.reviewWithinDays) ? rules.reviewWithinDays : 365;
  return { validAsOf, ageDays, stale: ageDays === null || ageDays > limit };
}
