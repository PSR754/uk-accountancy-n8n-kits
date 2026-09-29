import bankHolidays from '../../rules/bank-holidays.json' with { type: 'json' };

/**
 * Defaults for the chasing engine. Everything a practice would reasonably want
 * to change lives here, is passed in from the workflow's Config node, and is
 * covered by tests. Nothing behavioural is read from the environment directly.
 */
export const DEFAULT_CONFIG = {
  // Days overdue at which each stage becomes due.
  thresholds: { friendly: 7, firm: 30, final: 60 },

  // Never send two chase emails to the same client closer together than this.
  minDaysBetweenChases: 7,

  // Hard ceilings. A breach halts the run rather than sending, because the
  // usual cause is a bad edit to the sheet rather than a genuine surge.
  maxEmailsPerRun: 50,

  // Sending calendar.
  sendOnWeekends: false,
  sendOnBankHolidays: false,
  quietPeriods: [{ from: '12-24', to: '01-01' }],
  bankHolidays,

  // Identity and copy.
  firmName: 'Your Firm',
  senderName: 'Accounts',
  senderEmail: 'accounts@example.co.uk',
  replyToEmail: 'accounts@example.co.uk',
  firmPhone: '',
  signOffName: '',
  paymentInstructions: '',

  // State the statutory entitlement in firm and final emails to business clients.
  mentionLpcda: true,

  // Safety. While true, every client email is redirected to dryRunRecipient.
  dryRun: true,
  dryRunRecipient: '',
};

export function withDefaults(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(config.thresholds || {}) },
  };
}
