import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../../src/core/plan.js';
import { addDays } from '../../src/core/dates.js';
import { rng, pick, int } from '../helpers/prng.js';
import { fakeSheet, fakeMailer } from '../helpers/fakes.js';
import { runRange } from '../helpers/runner.js';

/**
 * Properties that must hold for every input, checked against generated data
 * including deliberately broken rows. Seeded, so a failure is reproducible and
 * CI never flakes.
 */

const STATUSES = ['Unpaid', 'unpaid', 'Paid', 'Disputed', 'Payment Plan', 'Written Off', 'Pending', '', '  '];
const TYPES = ['Business', 'business', 'Individual', 'consumer', '', 'Ltd'];
const AMOUNTS = ['100.00', '£1,250.00', '1,000', '0', '-50', 'abc', '', '99.999', 12345, '(200.00)'];
const DATES = ['2026-08-01', '05/09/2026', '31/02/2026', '2026-13-01', '', 'soon', 46280, '2026-09-15'];
const EMAILS = ['a@b.co.uk', 'x@y.com', '', 'not-an-email', '   ', 'a@b'];
const STAGES = ['', 'friendly', 'firm', 'final', 'FRIENDLY', 'nonsense'];

function makeRows(r, n) {
  return Array.from({ length: n }, (_, i) => ({
    row_number: i + 2,
    'Invoice Number': r() < 0.05 ? '' : `INV-${8000 + i}`,
    Client: pick(r, ['Acme Ltd', 'Borough Cafe', 'Jo Bloggs', '']),
    'Client Email': pick(r, EMAILS),
    'Client Type': pick(r, TYPES),
    'Amount GBP': pick(r, AMOUNTS),
    'Due Date': pick(r, DATES),
    Status: pick(r, STATUSES),
    'Last Chase Stage': pick(r, STAGES),
    'Last Chased On': r() < 0.3 ? pick(r, DATES) : '',
    'Activation Date': r() < 0.7 ? pick(r, DATES) : '',
  }));
}

const config = { dryRun: false, firmName: 'Test Co', maxEmailsPerRun: 10000 };

test('PROPERTY: never throws, on 500 random sheets of messy data', () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 0, 40));
    const today = addDays('2026-01-01', int(r, 0, 900));
    assert.doesNotThrow(
      () => plan({ rows, today, config }),
      `seed ${seed} threw`,
    );
  }
});

test('PROPERTY: every row is either chased or explained, never dropped', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 1, 30));
    const today = addDays('2026-06-01', int(r, 0, 400));
    const res = plan({ rows, today, config });
    if (res.summary.halted || !res.summary.sendableDay) continue;
    const chased = new Set(res.actions.flatMap((a) => a.invoices.map((i) => i.rowNumber)));
    const explained = new Set(res.skipped.map((s) => s.rowNumber));
    for (const row of rows) {
      assert.ok(chased.has(row.row_number) || explained.has(row.row_number),
        `seed ${seed}: row ${row.row_number} vanished`);
    }
    assert.equal(chased.size + explained.size, rows.length, `seed ${seed}: row count mismatch`);
  }
});

test('PROPERTY: an email is never addressed to an invalid recipient', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const res = plan({ rows: makeRows(r, int(r, 1, 30)), today: addDays('2026-06-01', int(r, 0, 400)), config });
    for (const a of res.actions) {
      assert.match(a.to, /^[^\s@]+@[^\s@.]+\.[^\s@]+$/, `seed ${seed}: bad recipient ${JSON.stringify(a.to)}`);
      assert.ok(a.subject.length > 0 && a.body.length > 0, `seed ${seed}: empty email`);
    }
  }
});

test('PROPERTY: a non-business client is never sent the Late Payment Act claim', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const res = plan({ rows: makeRows(r, int(r, 1, 30)), today: addDays('2026-06-01', int(r, 0, 400)), config });
    for (const a of res.actions) {
      if (a.clientType !== 'business') {
        assert.doesNotMatch(a.body, /Late Payment of Commercial Debts/,
          `seed ${seed}: statutory wording sent to a ${a.clientType} client`);
      }
    }
  }
});

test('PROPERTY: a paid, disputed, written-off or planned invoice is never chased', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 1, 30));
    const res = plan({ rows, today: addDays('2026-06-01', int(r, 0, 400)), config });
    const byRow = Object.fromEntries(rows.map((x) => [x.row_number, x]));
    for (const a of res.actions) {
      for (const i of a.invoices) {
        const status = String(byRow[i.rowNumber].Status).trim().toLowerCase();
        assert.ok(status === 'unpaid', `seed ${seed}: chased an invoice with status "${status}"`);
      }
    }
  }
});

test('PROPERTY: a stage is never re-sent to an invoice that already had it', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 1, 30));
    const res = plan({ rows, today: addDays('2026-06-01', int(r, 0, 400)), config });
    const byRow = Object.fromEntries(rows.map((x) => [x.row_number, x]));
    const rank = (s) => ['', 'friendly', 'firm', 'final'].indexOf(String(s ?? '').trim().toLowerCase());
    for (const a of res.actions) {
      for (const i of a.invoices) {
        const prior = byRow[i.rowNumber]['Last Chase Stage'];
        const priorRank = rank(prior) === -1 ? 0 : rank(prior);
        assert.ok(rank(i.stage) > priorRank,
          `seed ${seed}: sent ${i.stage} to an invoice already at ${prior}`);
      }
    }
  }
});

test('PROPERTY: one email per contact per run, always', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const res = plan({ rows: makeRows(r, int(r, 1, 40)), today: addDays('2026-06-01', int(r, 0, 400)), config });
    const recipients = res.actions.map((a) => a.realRecipient.toLowerCase());
    assert.equal(recipients.length, new Set(recipients).size,
      `seed ${seed}: a contact received more than one email in one run`);
  }
});

test('PROPERTY: every write-back corresponds to an email that was actually produced', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const res = plan({ rows: makeRows(r, int(r, 1, 30)), today: addDays('2026-06-01', int(r, 0, 400)), config });
    const keys = new Set(res.actions.flatMap((a) => a.idempotencyKeys));
    for (const wb of res.writeBacks) {
      assert.ok(keys.has(wb.idempotencyKey), `seed ${seed}: orphan write-back ${wb.idempotencyKey}`);
    }
    assert.equal(res.writeBacks.length, keys.size);
  }
});

test('PROPERTY: over a simulated year, no invoice and stage is ever emailed twice', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 1, 15));
    const sheet = fakeSheet(rows);
    const mailer = fakeMailer();
    runRange({ sheet, mailer, from: '2026-01-05', to: '2026-12-31', config });
    const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
    assert.equal(keys.length, new Set(keys).size, `seed ${seed}: duplicate send over the year`);
    // And no invoice ever receives more than the three stages that exist.
    const perInvoice = {};
    for (const k of keys) {
      const id = k.split('|')[0];
      perInvoice[id] = (perInvoice[id] || 0) + 1;
      assert.ok(perInvoice[id] <= 3, `seed ${seed}: ${id} was emailed ${perInvoice[id]} times`);
    }
  }
});
