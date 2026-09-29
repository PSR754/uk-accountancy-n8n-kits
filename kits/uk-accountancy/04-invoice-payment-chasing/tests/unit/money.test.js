import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGBP, formatGBP } from '../../src/core/money.js';

test('parses the amount formats a spreadsheet actually produces', () => {
  assert.equal(parseGBP('1250.00'), 125000);
  assert.equal(parseGBP('£1,250.00'), 125000);   // shipped kit produced NaN here
  assert.equal(parseGBP('1,250'), 125000);
  assert.equal(parseGBP(1250), 125000);
  assert.equal(parseGBP(1250.5), 125050);
  assert.equal(parseGBP(' £ 99.99 '), 9999);
  assert.equal(parseGBP('0.01'), 1);
});

test('reads accounting-style negatives', () => {
  assert.equal(parseGBP('(500.00)'), -50000);
  assert.equal(parseGBP('-500.00'), -50000);
});

test('rejects values that are not amounts', () => {
  for (const v of ['', '  ', 'not a number', null, undefined, 'N/A', '1.234', Infinity, NaN]) {
    assert.equal(parseGBP(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test('formats pence as a UK client expects', () => {
  assert.equal(formatGBP(125000), '£1,250.00');
  assert.equal(formatGBP(1234567), '£12,345.67');
  assert.equal(formatGBP(5), '£0.05');
  assert.equal(formatGBP(0), '£0.00');
  assert.equal(formatGBP(-50000), '-£500.00');
});

test('round trips without floating point drift', () => {
  for (let p = 0; p < 200000; p += 137) {
    assert.equal(parseGBP(formatGBP(p)), p);
  }
});
