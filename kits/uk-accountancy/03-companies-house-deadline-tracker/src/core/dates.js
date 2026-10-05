// Date handling. All dates are date-only ISO strings 'YYYY-MM-DD'.
// All arithmetic is done in UTC so the host timezone can never shift a day.
// Nothing here throws: bad input gives null.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UK_RE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
const MS_PER_DAY = 86400000;

/** Build a UTC timestamp from y/m/d, or null if the calendar date is not real. */
export function utcFromParts(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ts = Date.UTC(y, m - 1, d);
  const dt = new Date(ts);
  // Rejects 31 February style overflow, which JS would otherwise roll forward.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return ts;
}

/** Format a UTC timestamp as 'YYYY-MM-DD'. */
export function toISO(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Parse a spreadsheet cell or API value into 'YYYY-MM-DD'.
 * Accepts ISO strings, UK dd/mm/yyyy, JS Dates and Google Sheets serial numbers.
 * Returns null rather than guessing when the value is ambiguous or invalid.
 * Never uses `new Date(string)`, whose parsing is locale-dependent.
 */
export function parseSheetDate(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toISO(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  // Google Sheets serial: days since 1899-12-30.
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 100000) return null;
    return toISO(Date.UTC(1899, 11, 30) + Math.floor(value) * MS_PER_DAY);
  }

  const s = String(value).trim();
  if (s === '') return null;

  const iso = ISO_RE.exec(s);
  if (iso) {
    const ts = utcFromParts(+iso[1], +iso[2], +iso[3]);
    return ts === null ? null : toISO(ts);
  }

  const uk = UK_RE.exec(s);
  if (uk) {
    const ts = utcFromParts(+uk[3], +uk[2], +uk[1]);
    return ts === null ? null : toISO(ts);
  }

  return null;
}

/** Timestamp for an ISO date string, or null. */
export function tsOf(isoDate) {
  const m = ISO_RE.exec(String(isoDate ?? '').trim());
  if (!m) return null;
  return utcFromParts(+m[1], +m[2], +m[3]);
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(fromISO, toISOdate) {
  const a = tsOf(fromISO);
  const b = tsOf(toISOdate);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

export function addDays(isoDate, n) {
  const ts = tsOf(isoDate);
  if (ts === null || !Number.isFinite(n)) return null;
  return toISO(ts + n * MS_PER_DAY);
}

/** 0 = Sunday .. 6 = Saturday */
export function dayOfWeek(isoDate) {
  const ts = tsOf(isoDate);
  return ts === null ? null : new Date(ts).getUTCDay();
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isLastDayOfMonth(isoDate) {
  const ts = tsOf(isoDate);
  if (ts === null) return false;
  const d = new Date(ts);
  return d.getUTCDate() === daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

export function lastDayOfMonthOf(isoDate) {
  const ts = tsOf(isoDate);
  if (ts === null) return null;
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return toISO(Date.UTC(y, m - 1, daysInMonth(y, m)));
}

/**
 * Add whole calendar months the way Companies House describes them: a period of
 * months after a date ends on the corresponding date in the appropriate month
 * (4 April + 9 months is 4 January). When `monthEndSticky` is true, a date that
 * is the last day of its month ends on the last day of the appropriate month
 * (30 April + 9 months is 31 January). The guidance states that second rule for
 * accounting reference dates only, so callers pass true for those and nothing else.
 *
 * Returns { date, clamped }. `clamped` is true when the corresponding date does
 * not exist in the target month (31 May + 9 months) and the last day of that
 * month was used instead. That case is not covered by the guidance, so callers
 * flag it for a person to confirm. Returns { date: null, clamped: false } for
 * bad input.
 */
export function addMonths(isoDate, months, monthEndSticky = false) {
  const ts = tsOf(isoDate);
  if (ts === null || !Number.isInteger(months)) return { date: null, clamped: false };
  const src = new Date(ts);
  const y = src.getUTCFullYear();
  const m0 = src.getUTCMonth();
  const d = src.getUTCDate();
  const total = y * 12 + m0 + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12 + 12) % 12 + 1;
  const dim = daysInMonth(ty, tm);
  if (ty < 1000 || ty > 9999) return { date: null, clamped: false };
  if (monthEndSticky === true && isLastDayOfMonth(isoDate)) {
    return { date: toISO(Date.UTC(ty, tm - 1, dim)), clamped: false };
  }
  if (d > dim) return { date: toISO(Date.UTC(ty, tm - 1, dim)), clamped: true };
  return { date: toISO(Date.UTC(ty, tm - 1, d)), clamped: false };
}

/** 'Wednesday 14 October 2026', how a UK practice reads a date. */
export function formatUKDate(isoDate) {
  const ts = tsOf(isoDate);
  if (ts === null) return String(isoDate ?? '');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const d = new Date(ts);
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
