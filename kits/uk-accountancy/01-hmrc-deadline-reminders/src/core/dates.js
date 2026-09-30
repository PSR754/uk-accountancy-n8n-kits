// Date handling. All dates are date-only ISO strings 'YYYY-MM-DD'.
// All arithmetic is done in UTC so the host timezone can never shift a day.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UK_RE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;
const MS_PER_DAY = 86400000;

/** Build a UTC timestamp from y/m/d, or null if the calendar date is not real. */
export function utcFromParts(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
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
 * Parse a value that came out of a spreadsheet cell into 'YYYY-MM-DD'.
 * Accepts ISO strings, UK dd/mm/yyyy, JS Dates and Google Sheets serial numbers.
 * Returns null rather than guessing when the value is ambiguous or invalid.
 * Never uses `new Date(string)`, whose parsing of '05/09/2026' is locale-dependent.
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
  if (ts === null) return null;
  return toISO(ts + n * MS_PER_DAY);
}

/** 0 = Sunday .. 6 = Saturday */
export function dayOfWeek(isoDate) {
  const ts = tsOf(isoDate);
  return ts === null ? null : new Date(ts).getUTCDay();
}

export function isWeekend(isoDate) {
  const d = dayOfWeek(isoDate);
  return d === 0 || d === 6;
}

export function isBankHoliday(isoDate, holidays) {
  return Array.isArray(holidays) && holidays.includes(isoDate);
}

/**
 * The list of bank holiday dates for one division, from the gov.uk feed shape
 * ({ "england-and-wales": { events: [{ date: 'YYYY-MM-DD', ... }] }, ... }).
 * Returns [] for an unknown division or malformed data, never throws.
 */
export function bankHolidayDates(data, division) {
  const events = data && data[division] && data[division].events;
  if (!Array.isArray(events)) return [];
  return events
    .map((e) => (e && typeof e.date === 'string' ? e.date : null))
    .filter((d) => d !== null && tsOf(d) !== null);
}

/** Is this date inside a configured quiet period such as the Christmas shutdown? */
export function inQuietPeriod(isoDate, quietPeriods) {
  if (!Array.isArray(quietPeriods)) return false;
  const m = ISO_RE.exec(String(isoDate));
  if (!m) return false;
  const md = `${m[2]}-${m[3]}`;
  return quietPeriods.some((p) => {
    // A period may wrap the year end, e.g. 12-24 to 01-02.
    if (p.from <= p.to) return md >= p.from && md <= p.to;
    return md >= p.from || md <= p.to;
  });
}

/**
 * A day on which client email may be sent.
 * Returns { sendable: boolean, reason: string|null }.
 */
export function sendableDay(isoDate, config) {
  if (tsOf(isoDate) === null) return { sendable: false, reason: 'invalid run date' };
  if (config.sendOnWeekends !== true && isWeekend(isoDate)) {
    return { sendable: false, reason: 'weekend' };
  }
  if (config.sendOnBankHolidays !== true && isBankHoliday(isoDate, config.bankHolidays)) {
    return { sendable: false, reason: 'bank holiday' };
  }
  if (inQuietPeriod(isoDate, config.quietPeriods)) {
    return { sendable: false, reason: 'quiet period' };
  }
  return { sendable: true, reason: null };
}

/**
 * The first day after `isoDate` on which email may be sent, or null if none is
 * found within `lookahead` days (for example an invalid config that forbids
 * every day). Used to bring a reminder forward when its date falls in a gap.
 */
export function nextSendableDay(isoDate, config, lookahead = 21) {
  for (let i = 1; i <= lookahead; i += 1) {
    const d = addDays(isoDate, i);
    if (d === null) return null;
    if (sendableDay(d, config).sendable) return d;
  }
  return null;
}

/** 'Wednesday 14 October 2026' — how a UK client reads a date. */
export function formatUKDate(isoDate) {
  const ts = tsOf(isoDate);
  if (ts === null) return String(isoDate ?? '');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const d = new Date(ts);
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
