import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../../src/core/plan.js';
import { addDays, addMonths, daysBetween, tsOf } from '../../src/core/dates.js';
import { bandFor } from '../../src/core/rules.js';
import { withDefaults } from '../../src/core/config.js';
import { rng, pick, int } from '../helpers/prng.js';
import { fakeLog, fakeMailer, profile } from '../helpers/fakes.js';
import { runOnce } from '../helpers/runner.js';

/**
 * Properties that must hold for every input, checked against generated data
 * including deliberately broken rows. Seeded, so a failure is reproducible and
 * CI never flakes.
 */

const DATES = ['2026-10-05', '2026-12-31', '05/11/2026', '31/02/2026', '2026-13-01', '', 'soon', 46300, null, '2019-03-14', '2025-02-28', '2024-02-29'];
const NUMBERS = ['01234567', 'SC123456', '1234567', 'NI000123', '', 'bad', 12345678, 'oc123456', ' 02222222 '];
const TYPES = ['Private', 'Public', 'ltd', 'plc', 'LLP', '', 'x'];
const STATUSES = ['active', 'dissolved', 'liquidation', '', 'Active', 'administration'];
const EMAILS = ['a@example.co.uk', '', 'nope', null];

function iso(r) {
  const base = Date.UTC(2025, 0, 1) + int(r, 0, 1500) * 86400000;
  return new Date(base).toISOString().slice(0, 10);
}

function randomRow(r) {
  return {
    row_number: int(r, 2, 500),
    'Company Name': pick(r, ['Acme Ltd', '', 'Borough Cafe plc', 'O\'Neil & Sons']),
    'Company Number': pick(r, NUMBERS),
    'Company Type': pick(r, TYPES),
    'Incorporation Date': r() < 0.7 ? pick(r, DATES) : iso(r),
    'Last Accounts Made Up To': r() < 0.5 ? pick(r, DATES) : '',
    'Next Accounts Period End': r() < 0.2 ? pick(r, DATES) : '',
    'Last Confirmation Statement Made Up To': r() < 0.5 ? pick(r, DATES) : '',
    'Confirmation Statement Due': r() < 0.2 ? pick(r, DATES) : '',
    'Accounts Due': r() < 0.2 ? pick(r, DATES) : '',
    'Client Contact Email': pick(r, EMAILS),
    Paused: r() < 0.1 ? 'yes' : '',
  };
}

function randomApi(r) {
  const k = r();
  if (k < 0.2) return null;
  if (k < 0.3) return { error: { message: 'ETIMEDOUT' } };
  if (k < 0.35) return { errors: [{ error: 'company-profile-not-found' }] };
  if (k < 0.4) return pick(r, ['oops', 5, [], [1, 2], true]);
  const p = profile({
    number: pick(r, NUMBERS), status: pick(r, STATUSES), type: pick(r, ['ltd', 'plc', 'llp']),
    accountsDue: r() < 0.8 ? iso(r) : 'bad', csDue: r() < 0.8 ? iso(r) : undefined,
  });
  if (r() < 0.2) delete p.accounts;
  if (r() < 0.2) p.confirmation_statement = 'garbage';
  return p;
}

const randomCompanies = (r, n) => Array.from({ length: n }, () => (
  r() < 0.03 ? pick(r, [null, undefined, 'x', 3, {}, { row: null }]) : { row: randomRow(r), api: randomApi(r) }));

function randomConfig(r) {
  return {
    practiceEmail: pick(r, ['p@example.co.uk', '', 'bad']),
    dryRun: pick(r, [true, false, undefined, 'false']),
    milestones: pick(r, [undefined, [30, 14, 7, 1], [5], [], 'x', [0, -1], [90, 60, 30]]),
    overdueRepeatDays: pick(r, [undefined, 7, 0, -3, 'x', 1]),
    attentionDigestWeekday: pick(r, [undefined, 1, null, 9, 'x']),
    includeClientDrafts: pick(r, [true, false, undefined]),
  };
}

test('PROPERTY: never throws, on 500 random inputs including junk everywhere', () => {
  const r = rng(11);
  for (let i = 0; i < 500; i += 1) {
    const input = {
      companies: r() < 0.05 ? pick(r, [null, 'x', 5, {}]) : randomCompanies(r, int(r, 0, 25)),
      today: r() < 0.1 ? pick(r, ['', 'x', null, undefined, '2026-02-30']) : iso(r),
      config: r() < 0.1 ? pick(r, [null, 'x', 5]) : randomConfig(r),
      sentKeys: r() < 0.1 ? pick(r, [null, 'x', [null, 5, {}]]) : [],
    };
    assert.doesNotThrow(() => plan(input), `iteration ${i}`);
    const out = plan(input);
    assert.ok(Array.isArray(out.reminders) && Array.isArray(out.attention) && Array.isArray(out.skipped));
    assert.ok(out.summary && typeof out.summary.halted === 'boolean');
  }
  for (const x of [undefined, null, 5, 'x', [], {}]) assert.doesNotThrow(() => plan(x));
});

test('PROPERTY: every reminder is internally consistent', () => {
  const r = rng(12);
  for (let i = 0; i < 300; i += 1) {
    const today = iso(r);
    const config = { ...randomConfig(r), practiceEmail: 'p@example.co.uk' };
    const out = plan({ companies: randomCompanies(r, 20), today, config });
    const keys = new Set();
    for (const rem of out.reminders) {
      assert.ok(tsOf(rem.dueDate) !== null, 'due date is a real date');
      assert.equal(rem.days, daysBetween(today, rem.dueDate));
      const eff = withDefaults(config);
      const band = bandFor(rem.days, eff.milestones, eff.overdueRepeatDays);
      assert.equal(rem.band, band.band);
      assert.equal(rem.idempotencyKey, `${rem.companyNumber}|${rem.kind}|${rem.dueDate}|${rem.band}`);
      assert.ok(!keys.has(rem.idempotencyKey), 'duplicate key');
      keys.add(rem.idempotencyKey);
      assert.ok(['accounts', 'confirmationStatement'].includes(rem.kind));
      assert.ok(['companies-house', 'sheet', 'calculated'].includes(rem.source));
      if (rem.source !== 'companies-house') assert.equal(rem.needsConfirmation, true, 'unconfirmed dates are flagged');
    }
  }
});

test('PROPERTY: dry run never records anything; live run records exactly the reminders when it sends', () => {
  const r = rng(13);
  for (let i = 0; i < 300; i += 1) {
    const today = iso(r);
    const companies = randomCompanies(r, 15);
    const dry = plan({ companies, today, config: { ...randomConfig(r), practiceEmail: 'p@example.co.uk', dryRun: true } });
    assert.deepEqual(dry.sentLogRows, []);
    const live = plan({ companies, today, config: { practiceEmail: 'p@example.co.uk', dryRun: false } });
    assert.equal(live.sentLogRows.length, live.summary.sendDigest ? live.reminders.length : 0);
  }
});

test('PROPERTY: re-running with the keys already logged raises nothing new (idempotent)', () => {
  const r = rng(14);
  for (let i = 0; i < 300; i += 1) {
    const today = iso(r);
    const companies = randomCompanies(r, 15);
    const config = { practiceEmail: 'p@example.co.uk', dryRun: false };
    const first = plan({ companies, today, config });
    const again = plan({ companies, today, config, sentKeys: first.reminders.map((x) => x.idempotencyKey) });
    assert.equal(again.reminders.length, 0);
  }
});

test('PROPERTY: deterministic, and the input is never modified', () => {
  const r = rng(15);
  for (let i = 0; i < 100; i += 1) {
    const input = { companies: randomCompanies(r, 10), today: iso(r), config: { practiceEmail: 'p@example.co.uk' }, sentKeys: ['a|b|c|1'] };
    const snapshot = JSON.stringify(input);
    const a = plan(input);
    const b = plan(input);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(input), snapshot, 'input was mutated');
  }
});

test('PROPERTY: the order of the rows does not change what is reminded', () => {
  const r = rng(16);
  for (let i = 0; i < 100; i += 1) {
    const companies = randomCompanies(r, 12);
    const today = iso(r);
    const config = { practiceEmail: 'p@example.co.uk', dryRun: false };
    const keysOf = (list) => plan({ companies: list, today, config }).reminders.map((x) => x.idempotencyKey).sort();
    const shuffled = [...companies].sort(() => r() - 0.5);
    // Duplicate company numbers are resolved by "first row wins", so only compare when numbers are unique.
    const numbers = companies.map((c) => c && c.row && String(c.row['Company Number']).trim().toUpperCase().padStart(8, '0'));
    if (new Set(numbers).size !== numbers.length) continue;
    assert.deepEqual(keysOf(shuffled), keysOf(companies));
  }
});

test('PROPERTY: the digest only ever goes to the configured practice address', () => {
  const r = rng(17);
  for (let i = 0; i < 200; i += 1) {
    const companies = randomCompanies(r, 15);
    const out = plan({ companies, today: iso(r), config: { practiceEmail: 'practice@example.co.uk', dryRunRecipient: '', dryRun: pick(r, [true, false]) } });
    if (out.summary.sendDigest) assert.equal(out.summary.digestTo, 'practice@example.co.uk');
    else assert.equal(out.summary.digestTo === '' || out.summary.digestTo === 'practice@example.co.uk', true);
  }
});

test('PROPERTY: addMonths is monotonic and a calculated accounts deadline is always after the period end', () => {
  const r = rng(18);
  for (let i = 0; i < 1000; i += 1) {
    const a = iso(r);
    const b = addDays(a, int(r, 0, 400));
    const n = int(r, 0, 24);
    for (const sticky of [true, false]) {
      assert.ok(addMonths(a, n, sticky).date <= addMonths(b, n, sticky).date, `${a} ${b} ${n} ${sticky}`);
    }
    const m = addMonths(a, 9, true).date;
    assert.ok(daysBetween(a, m) >= 273 && daysBetween(a, m) <= 276, `${a} + 9 months = ${m}`);
  }
});

test('PROPERTY: a daily run gives every deadline at least one reminder before it falls due, and never repeats a key', () => {
  const r = rng(19);
  for (let i = 0; i < 40; i += 1) {
    const due = '2026-12-15';
    const log = fakeLog();
    const mailer = fakeMailer();
    const rows = [{ 'Company Number': '01234567', 'Company Name': 'Acme Ltd' }];
    const lookup = () => profile({ number: '01234567', csDue: due, accountsDue: '2032-01-01' });
    let day = addDays(due, -60);
    const seen = [];
    for (let d = 0; d < 90; d += 1) {
      // A realistic outage: some days the workflow simply does not run.
      if (r() < 0.25) { day = addDays(day, 1); continue; }
      const res = runOnce({ rows, lookup, mailer, log, today: day, config: { practiceEmail: 'p@example.co.uk', dryRun: false, attentionDigestWeekday: null } });
      seen.push(...res.reminders.map((x) => x.idempotencyKey));
      day = addDays(day, 1);
    }
    assert.equal(new Set(seen).size, seen.length, 'a key was raised twice');
    assert.ok(seen.some((k) => /\|(30|14|7|1)$/.test(k)), 'no reminder before the deadline');
  }
});
