import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../../src/core/plan.js';
import { addDays, daysBetween, sendableDay } from '../../src/core/dates.js';
import { withDefaults } from '../../src/core/config.js';
import { normaliseStatus, isValidEmail } from '../../src/core/rules.js';
import { rng, pick, int } from '../helpers/prng.js';
import { fakeSheet, fakeMailer } from '../helpers/fakes.js';
import { runRange } from '../helpers/runner.js';

/**
 * Properties that must hold for every input, checked against generated data
 * including deliberately broken rows. Seeded, so a failure is reproducible and
 * CI never flakes.
 */

const STATUSES = ['Pending', 'pending', 'Filed', 'Cancelled', 'On Hold', 'In progress', '', '  ', 'Maybe', 'DONE'];
const TYPES = ['VAT return', 'Corporation Tax payment', 'Self Assessment tax return', 'Confirmation statement'];
const CLIENTS = ['Acme Ltd', 'Borough Cafe', 'Jo Bloggs', 'Delta Design'];
const EMAILS = ['a@b.co.uk', 'x@y.com', 'A@B.co.uk', 'q@z.org'];
const BAD_TEXT = ['', '  '];
const BAD_EMAILS = ['', 'not-an-email', '   ', 'a@b'];
const DATES = ['2026-08-01', '05/09/2026', '31/02/2026', '2026-13-01', '', 'soon', 46280, '2026-09-15', '2026-09-22', '2026-10-15', '2026-12-25'];
const MARKERS = ['', '1', '7', '14', '30', 'abc', 3, '-1'];

// Mostly well-formed rows with a steady trickle of broken ones, and due dates
// clustered around the run date so that reminders actually fire. A generator
// that is all junk would prove nothing about the send path.
function makeRows(r, n, today) {
  const good = (a, b) => (r() < 0.85 ? pick(r, a) : pick(r, b));
  return Array.from({ length: n }, (_, i) => {
    const due = r() < 0.8 ? addDays(today, int(r, -3, 45)) : pick(r, DATES);
    return {
      row_number: i + 2,
      'Client Name': good(CLIENTS, BAD_TEXT),
      'Deadline Type': good(TYPES, BAD_TEXT),
      'Due Date': due,
      'Contact Email': good(EMAILS, BAD_EMAILS),
      Status: r() < 0.7 ? 'Pending' : pick(r, STATUSES),
      'Last Reminder Sent': pick(r, MARKERS),
      // Often the very date the marker was written for, which is the case that matters.
      'Reminded For Due Date': r() < 0.4 ? due : r() < 0.5 ? pick(r, DATES) : '',
      'Last Reminded On': r() < 0.3 ? pick(r, DATES) : '',
    };
  });
}

const config = { dryRun: false, firmName: 'Test Co', maxEmailsPerRun: 10000 };
const runs = (fn, n = 400) => {
  for (let seed = 1; seed <= n; seed += 1) {
    const r = rng(seed);
    const today = addDays('2026-01-01', int(r, 0, 900));
    const rows = makeRows(r, int(r, 0, 40), today);
    fn({ seed, r, rows, today, result: plan({ rows, today, config }) });
  }
};

test('PROPERTY: never throws, on 500 random sheets of messy data', () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const r = rng(seed);
    const today = addDays('2026-01-01', int(r, 0, 900));
    const rows = makeRows(r, int(r, 0, 40), today);
    assert.doesNotThrow(() => plan({ rows, today, config }), `seed ${seed} threw`);
  }
});

test('PROPERTY: never throws on arbitrary junk in any cell, any config', () => {
  const junk = [null, undefined, NaN, Infinity, {}, [], [1], () => 1, 'x'.repeat(5000), '\u0000', -1e300, true, Symbol.iterator.toString()];
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const rows = Array.from({ length: int(r, 0, 10) }, (_, i) => ({
      row_number: pick(r, [i + 2, null, 'x', NaN]),
      'Client Name': pick(r, [...junk, 'Acme']), 'Deadline Type': pick(r, [...junk, 'VAT']),
      'Due Date': pick(r, [...junk, '2026-09-22']), 'Contact Email': pick(r, [...junk, 'a@b.co.uk']),
      Status: pick(r, junk), 'Last Reminder Sent': pick(r, junk), 'Reminded For Due Date': pick(r, junk),
    }));
    const cfg = { dryRun: pick(r, [true, false, 'yes', null]), milestones: pick(r, [...junk, '30,7']), maxEmailsPerRun: pick(r, [...junk, 5]), bankHolidayDivision: pick(r, junk) };
    assert.doesNotThrow(() => plan({ rows, today: pick(r, [...junk, '2026-09-22']), config: cfg, sentKeys: pick(r, [junk, 'abc', undefined]) }), `seed ${seed}`);
  }
});

test('PROPERTY: every row is either reminded or explained, never dropped', () => {
  runs(({ seed, result }) => {
    const remindedRows = result.actions.reduce((n, a) => n + a.deadlines.length, 0);
    assert.equal(remindedRows + result.skipped.length, result.summary.rowsRead, `seed ${seed}`);
    assert.equal(result.summary.emails, result.actions.length);
  });
});

test('PROPERTY: an email is never addressed to an invalid recipient', () => {
  runs(({ seed, result }) => {
    for (const a of result.actions) {
      assert.ok(isValidEmail(a.realRecipient), `seed ${seed}: ${a.realRecipient}`);
      assert.ok(isValidEmail(a.to));
    }
  });
});

test('PROPERTY: a filed, cancelled, on-hold or unrecognised deadline is never reminded', () => {
  runs(({ seed, rows, result }) => {
    const byRow = new Map(rows.map((r) => [r.row_number, r]));
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        assert.equal(normaliseStatus(byRow.get(d.rowNumber).Status), 'active', `seed ${seed} row ${d.rowNumber}`);
      }
    }
  });
});

test('PROPERTY: a reminder is only ever about a deadline that is still ahead', () => {
  runs(({ seed, today, result }) => {
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        assert.ok(d.daysUntilDue >= 0, `seed ${seed}: ${d.daysUntilDue} days`);
        assert.equal(daysBetween(today, d.dueDate), d.daysUntilDue);
      }
    }
  });
});

test('PROPERTY: nothing is planned on a day that is not a sending day', () => {
  runs(({ seed, today, result }) => {
    if (!sendableDay(today, withDefaults(config)).sendable) {
      assert.equal(result.actions.length, 0, `seed ${seed}`);
      assert.equal(result.writeBacks.length, 0);
    }
  });
});

test('PROPERTY: a milestone the sheet already records for that due date is never re-sent', () => {
  let checked = 0;
  runs(({ seed, rows, result }) => {
    const byRow = new Map(rows.map((r) => [r.row_number, r]));
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        const row = byRow.get(d.rowNumber);
        const marker = Number(String(row['Last Reminder Sent']).trim());
        const forDate = String(row['Reminded For Due Date']).trim();
        const same = forDate === d.dueDate || forDate === d.dueDate.split('-').reverse().join('/');
        if (same && /^\d+$/.test(String(row['Last Reminder Sent']).trim())) {
          checked += 1;
          assert.ok(d.milestone < marker, `seed ${seed}: sent ${d.milestone} after ${marker}`);
        }
      }
    }
  });
  assert.ok(checked > 0, 'the generator never produced a case that exercises this property');
});

test('PROPERTY: one email per contact per run, and idempotency keys are unique', () => {
  runs(({ seed, result }) => {
    const recipients = result.actions.map((a) => a.realRecipient.toLowerCase());
    assert.equal(new Set(recipients).size, recipients.length, `seed ${seed}`);
    const keys = result.actions.flatMap((a) => a.idempotencyKeys);
    assert.equal(new Set(keys).size, keys.length, `seed ${seed}`);
  });
});

test('PROPERTY: every write-back corresponds to a reminder that was actually produced', () => {
  runs(({ seed, result }) => {
    const keys = new Set(result.actions.flatMap((a) => a.idempotencyKeys));
    assert.equal(result.writeBacks.length, keys.size, `seed ${seed}`);
    for (const wb of result.writeBacks) assert.ok(keys.has(wb.idempotencyKey));
  });
});

test('PROPERTY: the send ceiling is never exceeded', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const r = rng(seed);
    const today = addDays('2026-08-01', int(r, 0, 120));
    const rows = makeRows(r, int(r, 0, 40), today);
    const cap = int(r, 0, 5);
    const result = plan({ rows, today, config: { ...config, maxEmailsPerRun: cap } });
    assert.ok(result.actions.length <= cap, `seed ${seed}`);
    if (result.summary.halted) assert.equal(result.writeBacks.length, 0);
  }
});

test('PROPERTY: while dry run is on, nothing is ever addressed to a client', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const today = addDays('2026-08-01', int(r, 0, 120));
    const rows = makeRows(r, int(r, 0, 30), today);
    const result = plan({ rows, today, config: { ...config, dryRun: true, dryRunRecipient: 'owner@firm.co.uk' } });
    for (const a of result.actions) assert.equal(a.to, 'owner@firm.co.uk', `seed ${seed}`);
  }
});

test('PROPERTY: plan is pure: same input, same output, input untouched', () => {
  runs(({ seed, rows, today, result }) => {
    const before = JSON.stringify(rows);
    const again = plan({ rows, today, config });
    assert.deepEqual(again, result, `seed ${seed}`);
    assert.equal(JSON.stringify(rows), before);
  }, 150);
});

test('PROPERTY: over a simulated year, no deadline and milestone is ever emailed twice', () => {
  let total = 0;
  for (let seed = 1; seed <= 25; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 3, 15), '2026-09-15').map((row) => ({
      ...row, 'Last Reminder Sent': '', 'Reminded For Due Date': '', 'Last Reminded On': '',
    }));
    const sheet = fakeSheet(rows);
    const mailer = fakeMailer();
    runRange({ sheet, mailer, from: '2026-08-01', to: '2027-01-31', config });
    const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
    assert.equal(keys.length, new Set(keys).size, `seed ${seed}`);
    total += keys.length;
    // Each deadline can earn at most one reminder per milestone: four by default.
    const perDeadline = {};
    for (const k of keys) {
      const id = k.split('|').slice(0, 3).join('|');
      perDeadline[id] = (perDeadline[id] || 0) + 1;
    }
    for (const [id, n] of Object.entries(perDeadline)) assert.ok(n <= 4, `seed ${seed}: ${id} got ${n}`);
  }
  assert.ok(total > 50, `only ${total} emails were simulated, so the property was barely exercised`);
});

test('PROPERTY: over a year, reminders for one deadline only ever get more urgent', () => {
  const order = { advance: 0, reminder: 1, urgent: 2, final: 3 };
  for (let seed = 1; seed <= 20; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 3, 12), '2026-09-15').map((row) => ({ ...row, 'Last Reminder Sent': '', 'Reminded For Due Date': '' }));
    const sheet = fakeSheet(rows);
    const seen = new Map();
    const days = runRange({ sheet, mailer: fakeMailer(), from: '2026-08-01', to: '2027-01-31', config });
    for (const d of days) {
      for (const a of d.delivered) {
        for (const dl of a.deadlines) {
          const id = `${dl.rowNumber}|${dl.dueDate}`;
          const key = a.deadlines.length === 1 ? a.tone : null;
          if (key === null) continue;
          assert.ok(order[key] >= (seen.get(id) ?? -1), `seed ${seed}: ${id} softened`);
          seen.set(id, order[key]);
        }
      }
    }
  }
});

test('PROPERTY: a dry run never produces a write-back or a recordable action', () => {
  runs(({ seed, rows, today }) => {
    const r = plan({ rows, today, config: { ...config, dryRun: true, dryRunRecipient: 'owner@firm.co.uk' } });
    assert.equal(r.writeBacks.length, 0, `seed ${seed}`);
    for (const a of r.actions) assert.equal(a.record, false, `seed ${seed}`);
  }, 200);
});

test('PROPERTY: a row with no row_number is never reminded about', () => {
  runs(({ seed, rows, today }) => {
    const stripped = rows.map(({ row_number, ...rest }) => rest);
    const r = plan({ rows: stripped, today, config });
    assert.equal(r.actions.length, 0, `seed ${seed}`);
  }, 100);
});
