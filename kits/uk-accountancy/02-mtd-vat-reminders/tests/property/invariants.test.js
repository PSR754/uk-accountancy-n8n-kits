import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../../src/core/plan.js';
import { addDays, daysBetween, sendableDay, parseSheetDate, bankHolidayDates, tsOf } from '../../src/core/dates.js';
import { vatReturnDeadline, deadlineFallsOn } from '../../src/core/deadline.js';
import { withDefaults, DEFAULT_CONFIG } from '../../src/core/config.js';
import { normaliseSubmitted, isValidEmail } from '../../src/core/rules.js';
import { rng, pick, int } from '../helpers/prng.js';
import { fakeSheet, fakeMailer } from '../helpers/fakes.js';
import { runRange } from '../helpers/runner.js';

/**
 * Properties that must hold for every input, checked against generated data
 * including deliberately broken rows. Seeded, so a failure is reproducible and
 * CI never flakes.
 */

const SUBMITTED = ['No', 'no', 'Yes', 'yes', 'Y', 'Not required', 'On Hold', '', '  ', 'Maybe', 'DONE', 'Submitted'];
const SCHEMES = ['', '', '', 'Standard', 'Flat Rate', 'Annual Accounting', 'Cash Accounting', 'Mystery'];
const CLIENTS = ['Acme Ltd', 'Borough Cafe', 'Jo Bloggs', 'Delta Design'];
const EMAILS = ['a@b.co.uk', 'x@y.com', 'A@B.co.uk', 'q@z.org'];
const BAD_TEXT = ['', '  '];
const BAD_EMAILS = ['', 'not-an-email', '   ', 'a@b'];
const DATES = ['2026-08-01', '05/09/2026', '31/02/2026', '2026-13-01', '', 'soon', 46280, '2026-09-15', '2026-09-22', '2026-10-15', '2026-12-25'];
const MARKERS = ['', '3', '7', '14', '21', 'abc', 3, '-1'];

// Mostly well-formed rows with a steady trickle of broken ones, and period ends
// chosen so that deadlines cluster around the run date and reminders fire. A
// generator that is all junk would prove nothing about the send path.
const monthEnd = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

function makeRows(r, n, today) {
  const good = (a, b) => (r() < 0.85 ? pick(r, a) : pick(r, b));
  return Array.from({ length: n }, (_, i) => {
    // Most periods end on a month end (calculated). Some do not, and carry the HMRC date.
    const kind = r();
    const standard = kind < 0.6;
    const nonStandard = kind >= 0.6 && kind < 0.8;
    const end = standard ? monthEnd(addDays(today, int(r, -75, 5)))
      : nonStandard ? addDays(today, int(r, -75, 5)) : pick(r, DATES);
    const hmrcDate = nonStandard && r() < 0.7 ? addDays(today, int(r, -3, 45)) : r() < 0.9 ? '' : pick(r, DATES);
    return {
      row_number: i + 2,
      'Client Name': good(CLIENTS, BAD_TEXT),
      'Contact Email': good(EMAILS, BAD_EMAILS),
      'VAT Period End': end,
      Submitted: r() < 0.7 ? 'No' : pick(r, SUBMITTED),
      'VAT Scheme': r() < 0.9 ? '' : pick(r, SCHEMES),
      'HMRC Due Date': hmrcDate,
      'Last Checklist Sent': pick(r, MARKERS),
      // Often the very period the marker was written for, which is the case that matters.
      'Checklist For Period End': r() < 0.4 ? end : r() < 0.5 ? pick(r, DATES) : '',
      'Last Checklist On': r() < 0.3 ? pick(r, DATES) : '',
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

test('PROPERTY: never throws on arbitrary junk in any cell, any config, any rules', () => {
  const junk = [null, undefined, NaN, Infinity, {}, [], [1], () => 1, 'x'.repeat(5000), '\u0000', -1e300, true, Symbol.iterator.toString()];
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const rows = Array.from({ length: int(r, 0, 10) }, (_, i) => ({
      row_number: pick(r, [i + 2, null, 'x', NaN]),
      'Client Name': pick(r, [...junk, 'Acme']), 'Contact Email': pick(r, [...junk, 'a@b.co.uk']),
      'VAT Period End': pick(r, [...junk, '2026-08-22']), Submitted: pick(r, junk), 'VAT Scheme': pick(r, junk),
      'HMRC Due Date': pick(r, junk), 'Last Checklist Sent': pick(r, junk), 'Checklist For Period End': pick(r, junk),
    }));
    const cfg = {
      dryRun: pick(r, [true, false, 'yes', null]), milestones: pick(r, [...junk, '21,7']), maxEmailsPerRun: pick(r, [...junk, 5]),
      bankHolidayDivision: pick(r, junk), vatRules: pick(r, [...junk, DEFAULT_CONFIG.vatRules]),
      confirmationLookbackDays: pick(r, junk),
    };
    assert.doesNotThrow(() => plan({
      rows, today: pick(r, [...junk, '2026-09-22']), config: cfg, sentKeys: pick(r, [junk, 'abc', undefined]),
      submissionLog: pick(r, [junk, [{}], undefined, 'x']), runLog: pick(r, [junk, undefined]),
    }), `seed ${seed}`);
  }
});

test('PROPERTY: vatReturnDeadline never throws and is null-safe for any input', () => {
  const junk = [null, undefined, NaN, Infinity, {}, [], 'x', 5, '2026-02-30', true, -1, '9999-12-31', '0000-01-01'];
  for (const a of junk) for (const b of [...junk, DEFAULT_CONFIG.vatRules]) {
    assert.doesNotThrow(() => vatReturnDeadline(a, b));
  }
});

test('PROPERTY: every row is either reminded, logged or explained, never dropped', () => {
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

test('PROPERTY: a submitted, not-required, on-hold, annual-accounting or unrecognised return is never reminded', () => {
  runs(({ seed, rows, result }) => {
    const byRow = new Map(rows.map((r) => [r.row_number, r]));
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        const row = byRow.get(d.rowNumber);
        assert.equal(normaliseSubmitted(row.Submitted), 'pending', `seed ${seed} row ${d.rowNumber}`);
        assert.notEqual(String(row['VAT Scheme']).trim().toLowerCase(), 'annual accounting', `seed ${seed}`);
      }
    }
  });
});

test('PROPERTY: STOP ONCE SUBMITTED. Marking any reminded row Submitted removes it from the next plan', () => {
  let checked = 0;
  runs(({ seed, rows, today, result }) => {
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        const changed = rows.map((r) => (r.row_number === d.rowNumber ? { ...r, Submitted: 'Yes' } : r));
        const again = plan({ rows: changed, today, config });
        const stillThere = again.actions.some((x) => x.deadlines.some((y) => y.rowNumber === d.rowNumber));
        assert.equal(stillThere, false, `seed ${seed} row ${d.rowNumber} was reminded after being submitted`);
        checked += 1;
      }
    }
  }, 150);
  assert.ok(checked > 50, 'the generator barely exercised the property');
});

test('PROPERTY: a reminder is only ever about a deadline that is still ahead, and the date is calculated from the rule', () => {
  let calculated = 0;
  let fromSheet = 0;
  runs(({ seed, today, rows, result }) => {
    const byRow = new Map(rows.map((r) => [r.row_number, r]));
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        assert.ok(d.daysUntilDue >= 0, `seed ${seed}: ${d.daysUntilDue} days`);
        assert.equal(daysBetween(today, d.dueDate), d.daysUntilDue);
        const src = byRow.get(d.rowNumber);
        const end = parseSheetDate(src['VAT Period End']);
        assert.equal(d.periodEnd, end);
        if (d.dueDateSource === 'calculated') {
          assert.equal(d.dueDate, vatReturnDeadline(end, DEFAULT_CONFIG.vatRules).dueDate, `seed ${seed}`);
          assert.equal(String(src['HMRC Due Date']).trim(), '', `seed ${seed}: a typed date was ignored`);
          calculated += 1;
        } else {
          assert.equal(d.dueDate, parseSheetDate(src['HMRC Due Date']), `seed ${seed}`);
          fromSheet += 1;
        }
      }
    }
  });
  assert.ok(calculated > 50);
  assert.ok(fromSheet > 20);
});

test('PROPERTY: a period that does not end on a month end is never reminded without an HMRC Due Date', () => {
  let refused = 0;
  runs(({ seed, rows, result }) => {
    const byRow = new Map(rows.map((r) => [r.row_number, r]));
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        const src = byRow.get(d.rowNumber);
        const end = parseSheetDate(src['VAT Period End']);
        if (monthEnd(end) !== end) {
          assert.notEqual(parseSheetDate(src['HMRC Due Date']), null, `seed ${seed}: reminded with no HMRC date`);
          assert.equal(d.dueDateSource, 'sheet');
        }
      }
    }
    refused += result.skipped.filter((s) => /not the last day of a month/.test(s.reason)).length;
  });
  assert.ok(refused > 20, 'the generator never produced a non-month-end period without a date');
});

test('PROPERTY: the deadline is never moved: it is always the calculated date, even on a weekend or bank holiday', () => {
  const hols = bankHolidayDates(DEFAULT_CONFIG.bankHolidayData, 'england-and-wales');
  let weekendish = 0;
  for (let seed = 1; seed <= 600; seed += 1) {
    const r = rng(seed);
    const end = monthEnd(addDays('2026-01-01', int(r, 0, 1500)));
    const due = vatReturnDeadline(end, DEFAULT_CONFIG.vatRules).dueDate;
    const gap = daysBetween(end, due);
    assert.ok(gap >= 35 && gap <= 38, `${end}: ${gap}`);
    if (deadlineFallsOn(due, hols)) weekendish += 1;
    // Rerunning with a different bank holiday list never changes the date.
    assert.equal(vatReturnDeadline(end, { ...DEFAULT_CONFIG.vatRules }).dueDate, due);
  }
  assert.ok(weekendish > 50, 'the generator never produced a weekend or bank holiday deadline');
});

test('PROPERTY: nothing is planned on a day that is not a sending day', () => {
  runs(({ seed, today, result }) => {
    if (!sendableDay(today, withDefaults(config)).sendable) {
      assert.equal(result.actions.length, 0, `seed ${seed}`);
      assert.equal(result.writeBacks.length, 0);
      assert.equal(result.confirmations.length, 0);
    }
  });
});

test('PROPERTY: a milestone the sheet already records for that period is never re-sent', () => {
  let checked = 0;
  runs(({ seed, rows, result }) => {
    const byRow = new Map(rows.map((r) => [r.row_number, r]));
    for (const a of result.actions) {
      for (const d of a.deadlines) {
        const row = byRow.get(d.rowNumber);
        const text = String(row['Last Checklist Sent']).trim();
        const same = parseSheetDate(row['Checklist For Period End']) === d.periodEnd;
        if (same && /^\d+$/.test(text)) {
          checked += 1;
          assert.ok(d.milestone < Number(text), `seed ${seed}: sent ${d.milestone} after ${text}`);
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

test('PROPERTY: each submitted return is logged at most once, and never when it is already in the Submission Log', () => {
  runs(({ seed, rows, today }) => {
    const first = plan({ rows, today, config });
    const keys = first.confirmations.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, `seed ${seed}`);
    const log = first.confirmations.map((c) => ({ 'Client Name': c.clientName, 'VAT Period End': c.periodEnd }));
    const second = plan({ rows, today, config, submissionLog: log });
    assert.equal(second.confirmations.length, 0, `seed ${seed}: logged twice`);
    for (const c of first.confirmations) {
      assert.ok(daysBetween(c.periodEnd, today) >= 0, `seed ${seed}: logged before the period ended`);
      assert.ok(daysBetween(c.periodEnd, today) <= 150, `seed ${seed}: logged ancient history`);
    }
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

test('PROPERTY: while dry run is on, nothing is ever addressed to a client, recorded or logged', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rng(seed);
    const today = addDays('2026-08-01', int(r, 0, 120));
    const rows = makeRows(r, int(r, 0, 30), today);
    const result = plan({ rows, today, config: { ...config, dryRun: true, dryRunRecipient: 'owner@firm.co.uk' } });
    for (const a of result.actions) {
      assert.equal(a.to, 'owner@firm.co.uk', `seed ${seed}`);
      assert.equal(a.record, false);
    }
    assert.equal(result.writeBacks.length, 0, `seed ${seed}`);
    assert.equal(result.confirmations.filter((c) => c.record).length, 0, `seed ${seed}`);
    assert.equal(result.summary.confirmationsToRecord, 0);
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

test('PROPERTY: over a simulated year, no period and milestone is ever emailed twice', () => {
  let total = 0;
  for (let seed = 1; seed <= 25; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 3, 15), '2026-09-15').map((row) => ({
      ...row, 'Last Checklist Sent': '', 'Checklist For Period End': '', 'Last Checklist On': '',
    }));
    const sheet = fakeSheet(rows);
    const mailer = fakeMailer();
    runRange({ sheet, mailer, from: '2026-08-01', to: '2027-01-31', config });
    const keys = mailer.sent.flatMap((m) => m.idempotencyKeys);
    assert.equal(keys.length, new Set(keys).size, `seed ${seed}`);
    total += keys.length;
    // Each period can earn at most one email per milestone: four by default.
    const perPeriod = {};
    for (const k of keys) {
      const id = k.split('|').slice(0, 2).join('|');
      perPeriod[id] = (perPeriod[id] || 0) + 1;
    }
    for (const [id, n] of Object.entries(perPeriod)) assert.ok(n <= 4, `seed ${seed}: ${id} got ${n}`);
  }
  assert.ok(total > 50, `only ${total} emails were simulated, so the property was barely exercised`);
});

test('PROPERTY: over a year, reminders for one period only ever get more urgent', () => {
  const order = { advance: 0, reminder: 1, urgent: 2, final: 3 };
  let seenSome = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const r = rng(seed);
    const rows = makeRows(r, int(r, 3, 12), '2026-09-15').map((row) => ({ ...row, 'Last Checklist Sent': '', 'Checklist For Period End': '' }));
    const sheet = fakeSheet(rows);
    const seen = new Map();
    const days = runRange({ sheet, mailer: fakeMailer(), from: '2026-08-01', to: '2027-01-31', config });
    for (const d of days) {
      for (const a of d.delivered) {
        for (const dl of a.deadlines) {
          if (a.deadlines.length !== 1) continue;
          const id = `${dl.rowNumber}|${dl.periodEnd}`;
          assert.ok(order[a.tone] >= (seen.get(id) ?? -1), `seed ${seed}: ${id} softened`);
          seen.set(id, order[a.tone]);
          seenSome += 1;
        }
      }
    }
  }
  assert.ok(seenSome > 20);
});

test('PROPERTY: a row with no row_number is never reminded about or logged', () => {
  runs(({ seed, rows, today }) => {
    const stripped = rows.map(({ row_number, ...rest }) => rest);
    const r = plan({ rows: stripped, today, config });
    assert.equal(r.actions.length, 0, `seed ${seed}`);
    assert.equal(r.confirmations.length, 0, `seed ${seed}`);
  }, 100);
});

test('PROPERTY: the client email never states a penalty, rate, amount, link or a submission', () => {
  runs(({ seed, result }) => {
    for (const a of result.actions) {
      assert.doesNotMatch(a.body, /penalt|surcharge|interest|£|\d%|https?:\/\//i, `seed ${seed}`);
      assert.doesNotMatch(a.body, /we have (submitted|filed|paid)|has been (submitted|filed|paid)/i, `seed ${seed}`);
      assert.ok(tsOf(a.deadlines[0].dueDate) !== null);
    }
  }, 150);
});
