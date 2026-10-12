import bankHolidayData from '../../rules/bank-holidays.json' with { type: 'json' };
import vatRules from '../../rules/vat-rules.json' with { type: 'json' };
import { bankHolidayDates } from './dates.js';
import { normaliseMilestones } from './rules.js';

/**
 * Defaults for the reminder engine. Everything a practice would reasonably want
 * to change lives here, is passed in from the workflow's Build Config node, and
 * is covered by tests. Nothing behavioural is read from the environment directly.
 * The VAT deadline rule and the default reminder days come from rules/vat-rules.json.
 */
export const DEFAULT_CONFIG = {
  // Days before the VAT deadline at which a reminder is sent.
  milestones: vatRules.practiceDefaults.reminderDays,

  // Hard ceiling. A breach halts the run rather than sending, because the
  // usual cause is a bad edit to the sheet rather than a genuine surge.
  maxEmailsPerRun: vatRules.practiceDefaults.maxEmailsPerRun,

  // How far back a period end may be for a "Submitted" row to be logged. Stops
  // the first run from logging every old return in the sheet's history.
  confirmationLookbackDays: vatRules.practiceDefaults.confirmationLookbackDays,

  // The VAT rules file. Tests pass their own to prove the deadline is data.
  vatRules,

  // Sending calendar. This governs when email goes out, not the VAT deadline.
  sendOnWeekends: false,
  sendOnBankHolidays: false,
  quietPeriods: [{ from: '12-24', to: '01-01' }],
  // Which gov.uk bank holiday list applies: england-and-wales, scotland or
  // northern-ireland. Used only when `bankHolidays` is not supplied directly.
  bankHolidayDivision: 'england-and-wales',
  bankHolidayData,

  // Identity and copy.
  firmName: 'Your Firm',
  senderName: 'Accounts',
  senderEmail: 'accounts@example.co.uk',
  replyToEmail: 'accounts@example.co.uk',
  firmPhone: '',
  signOffName: '',
  // Receives the 08:30 preview and every alert.
  practiceEmail: '',

  // Safety. While true, every client email is redirected to dryRunRecipient.
  dryRun: true,
  dryRunRecipient: '',
};

export function withDefaults(config = {}) {
  const c = config && typeof config === 'object' ? config : {};
  const merged = { ...DEFAULT_CONFIG, ...c };
  const fallbackDays = (merged.vatRules && merged.vatRules.practiceDefaults
    && merged.vatRules.practiceDefaults.reminderDays) || DEFAULT_CONFIG.milestones;
  const { milestones, valid } = normaliseMilestones(merged.milestones, fallbackDays);
  merged.milestones = milestones.length ? milestones : [...DEFAULT_CONFIG.milestones];
  merged.milestonesValid = valid;
  if (!Array.isArray(c.bankHolidays)) {
    merged.bankHolidays = bankHolidayDates(merged.bankHolidayData, merged.bankHolidayDivision);
  }
  const lookback = Number(merged.confirmationLookbackDays);
  merged.confirmationLookbackDays = Number.isFinite(lookback) && lookback >= 0 ? lookback : DEFAULT_CONFIG.confirmationLookbackDays;
  return merged;
}
