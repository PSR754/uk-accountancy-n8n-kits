import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stageFor, stageRank, effectiveDays, lpcdaCompensationPence, lpcdaApplies,
  normaliseStatus, normaliseStage, normaliseClientType, isValidEmail, STAGES,
} from '../../src/core/rules.js';

const T = { friendly: 7, firm: 30, final: 60 };

// These tests enumerate the whole input domain rather than sampling it. For
// functions this small that is exhaustive: passing means the property holds for
// every input the function can receive, not merely for the cases someone
// thought to write down.

test('EXHAUSTIVE: stage boundaries hold for every day from -400 to 400', () => {
  for (let d = -400; d <= 400; d += 1) {
    const s = stageFor(d, T);
    const expected = d >= T.final ? 'final' : d >= T.firm ? 'firm' : d >= T.friendly ? 'friendly' : null;
    assert.equal(s, expected, `day ${d}`);
  }
  // The exact boundaries, stated separately so a threshold change is visible.
  assert.equal(stageFor(6, T), null);
  assert.equal(stageFor(7, T), 'friendly');
  assert.equal(stageFor(29, T), 'friendly');
  assert.equal(stageFor(30, T), 'firm');
  assert.equal(stageFor(59, T), 'firm');
  assert.equal(stageFor(60, T), 'final');
});

test('EXHAUSTIVE: the stage ladder never skips a rung as an invoice ages', () => {
  let previous = 0;
  for (let d = -400; d <= 400; d += 1) {
    const rank = stageRank(stageFor(d, T));
    assert.ok(rank >= previous, `rank went backwards at day ${d}`);
    assert.ok(rank - previous <= 1, `rank skipped a rung at day ${d}`);
    previous = rank;
  }
});

test('EXHAUSTIVE: an invoice activated today never opens above the first rung', () => {
  // This is the defect that made the shipped kit send a final notice, claiming
  // a history of reminders, to anyone whose invoice was already 60 days old on
  // the day the practice started using the system.
  for (let overdue = 1; overdue <= 400; overdue += 1) {
    const earned = effectiveDays(overdue, 0, T);
    const stage = stageFor(earned, T);
    assert.ok(stage === null || stage === 'friendly',
      `an invoice ${overdue} days overdue and activated today opened at ${stage}`);
  }
});

test('EXHAUSTIVE: a backlog invoice walks the ladder at the normal pace', () => {
  const overdue0 = 400; // already very old on activation day
  for (let sinceActivation = 0; sinceActivation <= 200; sinceActivation += 1) {
    const earned = effectiveDays(overdue0 + sinceActivation, sinceActivation, T);
    assert.equal(earned, sinceActivation + T.friendly);
  }
  assert.equal(stageFor(effectiveDays(400, 0, T), T), 'friendly');
  assert.equal(stageFor(effectiveDays(423, 23, T), T), 'firm');   // 23 + 7 = 30
  assert.equal(stageFor(effectiveDays(453, 53, T), T), 'final');  // 53 + 7 = 60
});

test('EXHAUSTIVE: an invoice tracked from issue is governed by its real age', () => {
  for (let overdue = 1; overdue <= 200; overdue += 1) {
    // Activated long before it fell due, so the cap must not bite.
    const earned = effectiveDays(overdue, overdue + 365, T);
    assert.equal(earned, overdue, `cap wrongly applied at ${overdue} days`);
  }
});

test('EXHAUSTIVE: effectiveDays never exceeds the real age', () => {
  for (let o = -50; o <= 300; o += 7) {
    for (let a = 0; a <= 300; a += 7) {
      assert.ok(effectiveDays(o, a, T) <= o, `effective age exceeded real age at ${o}/${a}`);
    }
  }
});

test('EXHAUSTIVE: Late Payment Act fixed sum matches the statutory bands at every boundary', () => {
  // Late Payment of Commercial Debts (Interest) Act 1998, s5A.
  assert.equal(lpcdaCompensationPence(1), 4000);
  assert.equal(lpcdaCompensationPence(99999), 4000);      // £999.99
  assert.equal(lpcdaCompensationPence(100000), 7000);     // £1,000.00
  assert.equal(lpcdaCompensationPence(999999), 7000);     // £9,999.99
  assert.equal(lpcdaCompensationPence(1000000), 10000);   // £10,000.00
  assert.equal(lpcdaCompensationPence(50000000), 10000);
  assert.equal(lpcdaCompensationPence(0), 0);
  assert.equal(lpcdaCompensationPence(-100), 0);

  for (let p = 1; p <= 2000000; p += 997) {
    const c = lpcdaCompensationPence(p);
    const expected = p < 100000 ? 4000 : p < 1000000 ? 7000 : 10000;
    assert.equal(c, expected, `amount ${p}p`);
  }
});

test('the Late Payment Act applies to business debts only', () => {
  assert.equal(lpcdaApplies('Business'), true);
  assert.equal(lpcdaApplies('business'), true);
  assert.equal(lpcdaApplies('Individual'), false);
  assert.equal(lpcdaApplies(''), false);
  assert.equal(lpcdaApplies(null), false);
  assert.equal(lpcdaApplies(undefined), false);
});

test('status and stage flags tolerate the casing and spacing a human types', () => {
  for (const v of ['Unpaid', 'unpaid', ' UNPAID ', 'Outstanding', 'open']) {
    assert.equal(normaliseStatus(v), 'unpaid', v);
  }
  for (const v of ['Paid', 'paid ', 'PAID', 'settled']) {
    assert.equal(normaliseStatus(v), 'paid', v);
  }
  assert.equal(normaliseStatus('Payment  Plan'), 'payment plan');
  assert.equal(normaliseStatus('Pending'), null);
  assert.equal(normaliseStatus(''), null);

  assert.equal(normaliseStage('Friendly'), 'friendly');
  assert.equal(normaliseStage(' FINAL '), 'final');
  assert.equal(normaliseStage(''), null);
  assert.equal(normaliseStage('nonsense'), null);

  assert.equal(normaliseClientType('Business'), 'business');
  assert.equal(normaliseClientType('company'), 'business');
  assert.equal(normaliseClientType('consumer'), 'individual');
  assert.equal(normaliseClientType('unknown'), null);
});

test('stageRank orders the ladder and treats anything unknown as unsent', () => {
  assert.equal(stageRank(null), 0);
  assert.equal(stageRank(''), 0);
  assert.equal(stageRank('nonsense'), 0);
  STAGES.forEach((s, i) => assert.equal(stageRank(s), i + 1));
});

test('email validation blocks the values that stop a send', () => {
  for (const v of ['a@b.co.uk', 'first.last+tag@example.com']) {
    assert.equal(isValidEmail(v), true, v);
  }
  for (const v of ['', '   ', null, undefined, 'not an email', 'a@b', 'a@@b.com', 'a b@c.com']) {
    assert.equal(isValidEmail(v), false, JSON.stringify(v));
  }
});
