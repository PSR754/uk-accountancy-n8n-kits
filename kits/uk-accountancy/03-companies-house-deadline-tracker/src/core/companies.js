// Reading a client row and a Companies House response into clean values.
// Nothing here throws. Anything unusable is returned as null with a reason,
// so the planner can flag it instead of guessing.

import { parseSheetDate } from './dates.js';

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const COMPANY_NUMBER_RE = /^[A-Z0-9]{2}\d{6}$/;

export function isValidEmail(value) {
  const s = String(value ?? '').trim();
  return s.length > 0 && s.length <= 254 && EMAIL_RE.test(s);
}

/**
 * Companies House numbers are eight characters: two letters or digits then six
 * digits (SC123456, 01234567). A spreadsheet often drops leading zeros from an
 * all-digit number, so those are padded back to eight and reported as padded.
 */
export function normaliseCompanyNumber(value) {
  const raw = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (raw === '') return { number: '', valid: false, padded: false, reason: 'no company number' };
  if (/^\d{1,7}$/.test(raw)) {
    return { number: raw.padStart(8, '0'), valid: true, padded: true, reason: null };
  }
  if (COMPANY_NUMBER_RE.test(raw)) return { number: raw, valid: true, padded: false, reason: null };
  return { number: raw, valid: false, padded: false, reason: `"${raw}" is not a Companies House number` };
}

/** 'private' | 'public' | null, using the synonym lists held in the rules file. */
export function normaliseCompanyType(value, rules) {
  const s = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return null;
  const lists = (rules && rules.companyType) || {};
  if (Array.isArray(lists.private) && lists.private.includes(s)) return 'private';
  if (Array.isArray(lists.public) && lists.public.includes(s)) return 'public';
  return null;
}

/** Companies House API company type, narrower than the sheet: unknown types are not guessed. */
export function typeFromApi(apiType) {
  const s = String(apiType ?? '').trim().toLowerCase();
  if (s === 'ltd') return 'private';
  if (s === 'plc') return 'public';
  return null;
}

function truthy(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1' || s === 'paused';
}

const COLUMNS = {
  name: 'Company Name',
  number: 'Company Number',
  type: 'Company Type',
  incorporated: 'Incorporation Date',
  lastAccounts: 'Last Accounts Made Up To',
  periodEnd: 'Next Accounts Period End',
  lastCs: 'Last Confirmation Statement Made Up To',
  csDue: 'Confirmation Statement Due',
  accountsDue: 'Accounts Due',
  email: 'Client Contact Email',
  paused: 'Paused',
};

export const COMPANY_COLUMNS = COLUMNS;

export function isEmptyRow(row) {
  if (!row || typeof row !== 'object') return true;
  return Object.entries(row).every(([k, v]) =>
    k === 'row_number' || k.startsWith('_') || String(v ?? '').trim() === '');
}

/**
 * One sheet row as typed values. `problems` lists every date cell that has text
 * in it but cannot be read, because a date that silently becomes "missing" is
 * how a deadline gets lost.
 */
export function readCompanyRow(row, rules) {
  const r = row && typeof row === 'object' ? row : {};
  const problems = [];
  const date = (key) => {
    const raw = r[COLUMNS[key]];
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const parsed = parseSheetDate(raw);
    if (parsed === null) problems.push(`${COLUMNS[key]} "${String(raw).trim()}" is not a readable date`);
    return parsed;
  };
  const num = normaliseCompanyNumber(r._companyNumber !== undefined ? r._companyNumber : r[COLUMNS.number]);
  const typeRaw = String(r[COLUMNS.type] ?? '').trim();
  const type = normaliseCompanyType(typeRaw, rules);
  if (typeRaw !== '' && type === null) problems.push(`Company Type "${typeRaw}" is not recognised (use Private or Public)`);

  return {
    rowNumber: Number.isFinite(r.row_number) ? r.row_number : null,
    name: String(r[COLUMNS.name] ?? '').trim(),
    number: num,
    type,
    incorporated: date('incorporated'),
    lastAccounts: date('lastAccounts'),
    periodEnd: date('periodEnd'),
    lastCs: date('lastCs'),
    csDueOverride: date('csDue'),
    accountsDueOverride: date('accountsDue'),
    email: String(r[COLUMNS.email] ?? '').trim(),
    paused: truthy(r[COLUMNS.paused]),
    problems,
  };
}

function apiDate(v) {
  const s = parseSheetDate(typeof v === 'string' ? v : null);
  return s;
}

/**
 * The parts of a Companies House company profile this kit uses.
 * `ok` is false for a failed lookup (an error object, a 404 body, nothing at
 * all), in which case the sheet is the only source and the planner says so.
 */
export function readApiProfile(api) {
  const none = { ok: false, reason: 'no response from Companies House' };
  if (!api || typeof api !== 'object') return none;
  if (api.error || api.errors || api.message) {
    const why = api.error?.message || api.message || (typeof api.error === 'string' ? api.error : 'lookup failed');
    return { ok: false, reason: `Companies House lookup failed: ${String(why).slice(0, 120)}` };
  }
  if (typeof api.company_number !== 'string' && typeof api.company_status !== 'string') {
    return { ok: false, reason: 'Companies House returned an unexpected response' };
  }
  const acc = api.accounts && typeof api.accounts === 'object' ? api.accounts : {};
  const cs = api.confirmation_statement && typeof api.confirmation_statement === 'object'
    ? api.confirmation_statement : {};
  return {
    ok: true,
    reason: null,
    number: typeof api.company_number === 'string' ? api.company_number.toUpperCase() : '',
    name: typeof api.company_name === 'string' ? api.company_name : '',
    status: typeof api.company_status === 'string' ? api.company_status.toLowerCase() : '',
    type: typeFromApi(api.type),
    rawType: typeof api.type === 'string' ? api.type : '',
    incorporated: apiDate(api.date_of_creation),
    accounts: {
      nextDue: apiDate(acc.next_due),
      nextMadeUpTo: apiDate(acc.next_made_up_to),
      lastMadeUpTo: apiDate(acc.last_accounts && acc.last_accounts.made_up_to),
      overdue: acc.overdue === true,
    },
    confirmationStatement: {
      nextDue: apiDate(cs.next_due),
      nextMadeUpTo: apiDate(cs.next_made_up_to),
      lastMadeUpTo: apiDate(cs.last_made_up_to),
      overdue: cs.overdue === true,
    },
  };
}
