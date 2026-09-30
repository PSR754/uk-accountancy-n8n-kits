import bankHolidayData from '../../rules/bank-holidays.json' with { type: 'json' };
import { bankHolidayDates } from './dates.js';
import { DEFAULT_MILESTONES, normaliseMilestones } from './rules.js';

/**
 * Defaults for the reminder engine. Everything a practice would reasonably want
 * to change lives here, is passed in from the workflow's Build Config node, and
 * is covered by tests. Nothing behavioural is read from the environment directly.
 */
export const DEFAULT_CONFIG = {
  // Days before the due date at which a reminder is sent.
  milestones: DEFAULT_MILESTONES,

  // Hard ceiling. A breach halts the run rather than sending, because the
  // usual cause is a bad edit to the sheet rather than a genuine surge.
  maxEmailsPerRun: 50,

  // Sending calendar.
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
  const { milestones, valid } = normaliseMilestones(merged.milestones);
  merged.milestones = milestones;
  merged.milestonesValid = valid;
  if (!Array.isArray(c.bankHolidays)) {
    merged.bankHolidays = bankHolidayDates(merged.bankHolidayData, merged.bankHolidayDivision);
  }
  return merged;
}
