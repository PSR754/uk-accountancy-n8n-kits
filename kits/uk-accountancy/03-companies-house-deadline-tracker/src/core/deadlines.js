// The deadline arithmetic. Every rule it applies is a value in rules/deadline-rules.json
// and a row in rules/RULES.md. It returns a result for every input, including bad
// input: a deadline it cannot work out comes back with dueDate null and the reason
// in `flags`, never an exception and never a guess.

import { addDays, addMonths, lastDayOfMonthOf } from './dates.js';

const SHEET_ONLY_FLAG = 'Worked out from the sheet, not taken from Companies House. Needs human confirmation against the register.';

function finish(kind, dueDate, source, periodEnd, flags, notes, overdueAtRegister) {
  return {
    kind,
    dueDate: dueDate || null,
    source: dueDate ? source : 'none',
    periodEnd: periodEnd || null,
    flags,
    notes,
    overdueAtRegister: overdueAtRegister === true,
    discrepancy: false,
    needsConfirmation: flags.length > 0,
  };
}

/** Pick between the Companies House date, the date typed into the sheet, and the calculation. */
function choose(kind, apiDue, sheetDue, calc, periodEnd, overdueAtRegister) {
  const flags = [];
  const notes = [];
  if (apiDue && sheetDue && apiDue !== sheetDue) {
    flags.push(`Companies House says ${apiDue} but the sheet says ${sheetDue}. The earlier date is used. Needs human confirmation.`);
    const result = finish(kind, apiDue < sheetDue ? apiDue : sheetDue, 'companies-house', periodEnd, flags, notes, overdueAtRegister);
    result.discrepancy = true;
    return result;
  }
  if (apiDue) return finish(kind, apiDue, 'companies-house', periodEnd, flags, notes, overdueAtRegister);
  if (sheetDue) {
    flags.push('Date typed into the sheet and not cross-checked with Companies House. Needs human confirmation.');
    return finish(kind, sheetDue, 'sheet', periodEnd, flags, notes, overdueAtRegister);
  }
  if (calc && calc.date) {
    flags.push(SHEET_ONLY_FLAG, ...calc.flags);
    notes.push(...calc.notes);
    return finish(kind, calc.date, 'calculated', calc.periodEnd || periodEnd, flags, notes, overdueAtRegister);
  }
  flags.push(...((calc && calc.flags) || ['Not enough information to work out this deadline. Needs human confirmation.']));
  return finish(kind, null, 'none', periodEnd, flags, notes, overdueAtRegister);
}

/**
 * Accounts deadline.
 * @param {object} company  readCompanyRow() output
 * @param {object} profile  readApiProfile() output (ok false when the lookup failed)
 * @param {string|null} type 'private' | 'public' | null, already resolved by the planner
 * @param {object} rules    rules/deadline-rules.json
 */
export function accountsDeadline(company, profile, type, rules) {
  const acc = (profile.ok && profile.accounts) || {};
  const r = rules.accounts;
  const fa = r.firstAccounts;
  const flags = [];
  const notes = [];
  let calc = null;

  const lastAccounts = company.lastAccounts || acc.lastMadeUpTo || null;
  const incorporated = company.incorporated || (profile.ok ? profile.incorporated : null) || null;
  const needCalc = !acc.nextDue && !company.accountsDueOverride;

  if (needCalc) {
    let periodEnd = acc.nextMadeUpTo || company.periodEnd || null;
    if (!periodEnd && lastAccounts) {
      const next = addMonths(lastAccounts, r.standardPeriodMonths, true);
      periodEnd = next.date;
      flags.push(`Next accounting period end assumed to be ${r.standardPeriodMonths} months after the last accounts (${lastAccounts}). A changed accounting reference date would make this wrong. Needs human confirmation.`);
    }
    const first = !lastAccounts;
    if (!periodEnd && first && incorporated) {
      // The first accounting reference date is the last day of the month in which
      // the first anniversary of incorporation falls.
      const anniversary = addMonths(incorporated, 12, false);
      if (anniversary.clamped) flags.push('Incorporated on 29 February: the first anniversary is taken as 28 February. Needs human confirmation.');
      periodEnd = anniversary.date ? lastDayOfMonthOf(anniversary.date) : null;
      notes.push('First accounting reference date taken as the last day of the month of the first anniversary of incorporation.');
    }

    if (!type) {
      flags.push('Company type (private or public) is not known, so the accounts period cannot be applied. Needs human confirmation.');
    } else if (!periodEnd) {
      flags.push('No accounting period end, last accounts date or incorporation date to work from. Needs human confirmation.');
    } else if (first && !incorporated) {
      flags.push('First accounts: the incorporation date is needed to apply the first-accounts rule. Needs human confirmation.');
    } else {
      const normalMonths = type === 'public' ? r.publicMonthsAfterPeriodEnd : r.privateMonthsAfterPeriodEnd;
      let due = addMonths(periodEnd, normalMonths, true);
      if (first) {
        if (/-02-29$/.test(incorporated)) {
          flags.push('Incorporated on 29 February: the first-accounts deadline depends on how the first anniversary (28 February or 1 March) is treated, and the kit works from the incorporation date. Needs human confirmation.');
        }
        const anniversary = addMonths(incorporated, r.standardPeriodMonths, false).date;
        const periodOverTwelveMonths = anniversary !== null && periodEnd >= anniversary;
        if (periodOverTwelveMonths) {
          const fromInc = addMonths(incorporated, type === 'public' ? fa.publicMonthsAfterIncorporation : fa.privateMonthsAfterIncorporation, false);
          const fromEnd = addMonths(periodEnd, fa.minimumMonthsAfterPeriodEnd, true);
          if (fromInc.date && fromEnd.date) {
            const useInc = fromInc.date >= fromEnd.date;
            due = useInc ? fromInc : fromEnd;
            notes.push('First accounts covering more than 12 months: the longer of the months after incorporation and 3 months after the period end.');
          }
        }
      }
      if (due.clamped) flags.push('The corresponding date does not exist in the deadline month, so the last day of that month was used. The guidance does not cover this case. Needs human confirmation.');
      calc = { date: due.date, periodEnd, flags, notes };
    }
    if (!calc) calc = { date: null, periodEnd, flags, notes };
  }

  return choose('accounts', acc.nextDue || null, company.accountsDueOverride, calc,
    acc.nextMadeUpTo || company.periodEnd || (calc && calc.periodEnd) || null, acc.overdue);
}

/**
 * Confirmation statement deadline. The first review period is the 12 months
 * beginning with the day of incorporation, so it ends the day before the first
 * anniversary; later ones start the day after the previous confirmation date and
 * last 12 months. The statement can be filed up to 14 days after the period ends.
 */
export function confirmationDeadline(company, profile, rules) {
  const cs = (profile.ok && profile.confirmationStatement) || {};
  const r = rules.confirmationStatement;
  let calc = null;
  const needCalc = !cs.nextDue && !company.csDueOverride;

  if (needCalc) {
    const flags = [];
    const notes = [];
    let reviewEnd = cs.nextMadeUpTo || null;
    if (!reviewEnd) {
      const last = company.lastCs || cs.lastMadeUpTo || null;
      const incorporated = company.incorporated || (profile.ok ? profile.incorporated : null) || null;
      if (last) {
        // Later statements (s853A(5)(b) and (6)): the next review period starts the day
        // after the last confirmation date and lasts 12 months, so it ends on the day
        // before that start's anniversary. `last` must be the confirmation date on the
        // last statement, not its due date or filing date.
        const start = addDays(last, 1);
        const anniversary = start ? addMonths(start, r.reviewPeriodMonths, false) : { date: null };
        if (anniversary.clamped) {
          // A period beginning on 29 February: the statute does not say how it ends.
          // It is taken to end on 28 February, as for a first period (see R-14).
          flags.push('The review period begins on 29 February, so its end was taken as 28 February. Needs human confirmation.');
          reviewEnd = anniversary.date;
        } else {
          reviewEnd = anniversary.date ? addDays(anniversary.date, -1) : null;
        }
      } else if (incorporated) {
        // First statement: the 12 months begin on the day of incorporation (s853A(5)(a)),
        // so the period ends the day before the first anniversary.
        const anniversary = addMonths(incorporated, r.reviewPeriodMonths, false);
        if (anniversary.clamped) {
          flags.push('Incorporated on 29 February: the review period end was taken as 28 February. Needs human confirmation.');
          reviewEnd = anniversary.date;
        } else {
          reviewEnd = anniversary.date ? addDays(anniversary.date, -1) : null;
        }
      } else {
        flags.push('No last confirmation date or incorporation date to work from. Needs human confirmation.');
      }
    }
    if (reviewEnd) {
      const due = addDays(reviewEnd, r.filingDaysAfterReviewPeriodEnd);
      calc = { date: due, periodEnd: reviewEnd, flags, notes };
    } else {
      calc = { date: null, periodEnd: null, flags, notes };
    }
  }

  return choose('confirmationStatement', cs.nextDue || null, company.csDueOverride, calc,
    cs.nextMadeUpTo || (calc && calc.periodEnd) || null, cs.overdue);
}
