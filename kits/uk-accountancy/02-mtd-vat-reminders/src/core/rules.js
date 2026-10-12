// Reminder rules. Nothing here is a statutory date. The VAT deadline itself is
// calculated in deadline.js from rules/vat-rules.json; this file only decides
// which reminder a given number of days-to-go earns, and reads sheet cells.
// See ../../rules/RULES.md.

const MAX_MILESTONE_DAYS = 366;

/**
 * Turn a configured list (array, or comma-separated string such as "21,14,7,3")
 * into a clean descending list of distinct whole numbers of days.
 * Anything unusable is dropped. If nothing usable is left `defaults` is
 * returned and `valid` is false, so the caller can report it rather than
 * silently running on a setting nobody chose.
 */
export function normaliseMilestones(value, defaults) {
  let items;
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') items = value.split(',');
  else if (typeof value === 'number') items = [value];
  else items = [];

  const seen = new Set();
  let dropped = false;
  for (const raw of items) {
    const text = String(raw ?? '').trim();
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_MILESTONE_DAYS) seen.add(n);
    else if (text !== '') dropped = true;
  }
  const list = [...seen].sort((a, b) => b - a);
  if (list.length === 0) {
    const fallback = Array.isArray(defaults) ? defaults.filter((n) => Number.isInteger(n) && n >= 1) : [];
    return { milestones: fallback, valid: false };
  }
  return { milestones: list, valid: !dropped };
}

/**
 * The reminder a deadline has earned, or null if it is still too far away.
 *
 * `daysUntilDue` is whole days from the run date to the due date. `gapDays` is
 * how many days pass before the next day on which email can go out (1 on an
 * ordinary weekday, 3 on a Friday before a bank-holiday-free weekend). A reminder
 * that would fall inside that gap is brought forward to today, because tomorrow's
 * run will not exist. The tightest milestone reached is returned, so a deadline
 * that has slipped past several milestones gets one reminder, not a burst.
 */
export function milestoneFor(daysUntilDue, milestones, gapDays = 1) {
  if (!Number.isFinite(daysUntilDue) || !Array.isArray(milestones) || milestones.length === 0) {
    return null;
  }
  const gap = Number.isFinite(gapDays) && gapDays >= 1 ? gapDays : 1;
  const horizon = daysUntilDue - (gap - 1);
  const reached = milestones.filter((m) => m >= horizon);
  if (reached.length === 0) return null;
  return Math.min(...reached);
}

/** Read the "Last Checklist Sent" cell: a whole number of days, or null. */
export function parseMilestoneCell(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** How urgent the wording should be for a milestone. */
export function toneFor(milestone) {
  if (!Number.isFinite(milestone)) return 'reminder';
  if (milestone <= 3) return 'final';
  if (milestone <= 7) return 'urgent';
  if (milestone <= 14) return 'reminder';
  return 'advance';
}

const TONE_RANK = { advance: 0, reminder: 1, urgent: 2, final: 3 };
export function toneRank(tone) {
  return TONE_RANK[tone] ?? 0;
}

// Status values. Only `pending` rows are ever reminded about; the others each
// stop reminders for a different reason and are reported so nothing disappears.
export const ACTIVE_STATUS = 'pending';

/**
 * Canonical state from the "Submitted" cell. A blank cell means the return has
 * not been submitted yet, so it is pending. 'submitted' stops reminders and is
 * logged once. Returns null for an unrecognised word, which the planner reports
 * instead of guessing.
 */
export function normaliseSubmitted(value) {
  const s = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '' || s === 'no' || s === 'n' || s === 'false' || s === 'pending' || s === 'not yet' || s === 'open') return 'pending';
  if (s === 'yes' || s === 'y' || s === 'true' || s === 'submitted' || s === 'filed' || s === 'done' || s === 'complete' || s === 'completed') return 'submitted';
  if (s === 'not required' || s === 'n/a' || s === 'na' || s === 'deregistered' || s === 'cancelled' || s === 'canceled') return 'not required';
  if (s === 'on hold' || s === 'paused') return 'on hold';
  return null;
}

// Deliberately conservative: enough to catch the blank and obviously broken
// addresses that stop a send, without rejecting unusual but valid ones.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value) {
  const s = String(value ?? '').trim();
  return s.length > 0 && s.length <= 254 && EMAIL_RE.test(s);
}

// Addresses that ship in the examples. A live run using one of these would send
// client email from, or raise alerts to, an address nobody reads.
export const PLACEHOLDER_DOMAINS = ['example.co.uk', 'example.com', 'yourfirm.co.uk', 'youraccountancyfirm.co.uk'];

export function isPlaceholderEmail(value) {
  const s = String(value ?? '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  return at !== -1 && PLACEHOLDER_DOMAINS.includes(s.slice(at + 1));
}

/**
 * Problems with the two addresses a live run depends on: the sender, and the
 * practice address that receives the preview and every alert. Empty list when
 * both are real. Only enforced when dry run is off.
 */
export function addressProblems(config) {
  const problems = [];
  for (const [label, value] of [['SENDER_EMAIL', config.senderEmail], ['PRACTICE_EMAIL', config.practiceEmail]]) {
    if (!isValidEmail(value)) problems.push(`${label} is empty or not a valid address`);
    else if (isPlaceholderEmail(value)) problems.push(`${label} is still the example placeholder (${String(value).trim()})`);
  }
  return problems;
}
