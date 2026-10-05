import deadlineRules from '../../rules/deadline-rules.json' with { type: 'json' };

/**
 * Defaults for the tracker. Everything a practice would reasonably want to
 * change lives here, is passed in from the workflow's Build Config node, and is
 * covered by tests. Nothing behavioural is read from the environment directly.
 * The statutory numbers are not here: they are in rules/deadline-rules.json.
 */
export const DEFAULT_CONFIG = {
  // Days before a deadline at which a reminder is raised.
  milestones: [30, 14, 7, 1],

  // Once a deadline has passed, remind again every this many days.
  overdueRepeatDays: 7,

  // Day of the week (0 = Sunday, 1 = Monday) on which a digest is sent even if
  // no reminder is due, so rows that need checking are not left for ever.
  // null switches this off.
  attentionDigestWeekday: 1,

  firmName: 'Your Firm',

  // The reminder digest goes to the practice, never to a client.
  practiceEmail: '',
  senderEmail: 'accounts@example.co.uk',

  // Add a draft client message under each reminder, for the practice to read
  // and send itself. The kit never sends it.
  includeClientDrafts: true,

  // Safety. While true, the digest is labelled as a preview, goes to
  // dryRunRecipient (or the practice mailbox) and nothing is recorded in the
  // Sent Log, so switching it off later does not lose a single reminder.
  dryRun: true,
  dryRunRecipient: '',

  rules: deadlineRules,
};

function sanitiseMilestones(value, warnings) {
  const ok = Array.isArray(value)
    && value.length > 0
    && value.every((n) => Number.isInteger(n) && n >= 1 && n <= 366);
  if (!ok) {
    warnings.push('Reminder milestones were not a list of whole numbers of days, so the defaults were used.');
    return [...DEFAULT_CONFIG.milestones];
  }
  return [...new Set(value)].sort((a, b) => b - a);
}

export function withDefaults(config) {
  const given = config && typeof config === 'object' ? config : {};
  const warnings = [];
  const merged = { ...DEFAULT_CONFIG, ...given };
  merged.milestones = sanitiseMilestones(given.milestones === undefined ? DEFAULT_CONFIG.milestones : given.milestones, warnings);
  if (!Number.isInteger(merged.overdueRepeatDays) || merged.overdueRepeatDays < 1) {
    warnings.push('overdueRepeatDays was not a positive whole number, so 7 was used.');
    merged.overdueRepeatDays = 7;
  }
  const wd = merged.attentionDigestWeekday;
  if (wd !== null && !(Number.isInteger(wd) && wd >= 0 && wd <= 6)) {
    warnings.push('attentionDigestWeekday must be 0 to 6 or null, so Monday was used.');
    merged.attentionDigestWeekday = 1;
  }
  // Only the exact boolean false turns the safety off.
  merged.dryRun = merged.dryRun !== false;
  merged.includeClientDrafts = merged.includeClientDrafts !== false;
  merged.rules = given.rules && typeof given.rules === 'object' ? given.rules : DEFAULT_CONFIG.rules;
  merged.configWarnings = warnings;
  return merged;
}
