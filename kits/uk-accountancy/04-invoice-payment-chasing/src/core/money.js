// Money is handled as integer pence throughout. Floating point never touches a total.

/**
 * Parse a spreadsheet amount into integer pence.
 * Accepts numbers, and strings with currency symbols, thousands separators and spaces.
 * Returns null when the value is not a usable amount.
 */
export function parseGBP(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  let s = String(value).trim();
  if (s === '') return null;

  let negative = false;
  // Accounting notation: (1,250.00) means negative.
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }

  s = s.replace(/[£\s,]/g, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;

  const pence = Math.round(Number(s) * 100);
  if (!Number.isFinite(pence)) return null;
  return negative ? -pence : pence;
}

/** '£1,250.00' */
export function formatGBP(pence) {
  const neg = pence < 0;
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  const withSeparators = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}£${withSeparators}.${rem}`;
}
