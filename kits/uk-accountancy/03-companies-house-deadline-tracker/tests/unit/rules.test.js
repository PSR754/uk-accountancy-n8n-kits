import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rulesProblems } from '../../src/core/rules.js';
import { DEFAULT_CONFIG } from '../../src/core/config.js';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = JSON.parse(readFileSync(join(KIT, 'rules', 'deadline-rules.json'), 'utf8'));
const register = readFileSync(join(KIT, 'rules', 'RULES.md'), 'utf8');

test('the rules file asserts the values the cited gov.uk pages state', () => {
  assert.equal(rules.accounts.privateMonthsAfterPeriodEnd, 9);
  assert.equal(rules.accounts.publicMonthsAfterPeriodEnd, 6);
  assert.equal(rules.accounts.firstAccounts.privateMonthsAfterIncorporation, 21);
  assert.equal(rules.accounts.firstAccounts.publicMonthsAfterIncorporation, 18);
  assert.equal(rules.accounts.firstAccounts.minimumMonthsAfterPeriodEnd, 3);
  assert.equal(rules.confirmationStatement.reviewPeriodMonths, 12);
  assert.equal(rules.confirmationStatement.filingDaysAfterReviewPeriodEnd, 14);
  assert.equal(rules.api.requestsPerFiveMinutes, 600);
});

test('the rules file is well formed and is what the core uses', () => {
  assert.deepEqual(rulesProblems(rules), []);
  assert.deepEqual(DEFAULT_CONFIG.rules, rules);
  assert.ok(rulesProblems(null).length > 0);
  assert.ok(rulesProblems({}).length > 0);
});

test('every source is a primary gov.uk address', () => {
  for (const url of Object.values(rules.sources)) assert.match(url, /^https:\/\/www\.gov\.uk\//);
  assert.match(rules.api.baseUrl, /^https:\/\/api\.company-information\.service\.gov\.uk$/);
});

test('"valid as of" is present, is a real date, and is stated in RULES.md', () => {
  assert.match(rules.validAsOf, /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date(`${rules.validAsOf}T00:00:00Z`);
  assert.equal(d.toISOString().slice(0, 10), rules.validAsOf);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const human = `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  assert.ok(register.includes(`**Valid as of: ${human}.**`), `RULES.md must say "Valid as of: ${human}"`);
});

test('every source URL in the rules file appears in the register', () => {
  for (const url of Object.values(rules.sources)) assert.ok(register.includes(url), url);
});

test('each rule row carries a status, and the unverifiable ones are marked UNVERIFIED', () => {
  const rows = [...register.matchAll(/^\| (R-\d{2}) \|.*\| (Documented[^|]*|\*\*UNVERIFIED\*\*[^|]*) \|$/gm)];
  assert.ok(rows.length >= 19, `found ${rows.length} rule rows`);
  const status = Object.fromEntries(rows.map((m) => [m[1], m[2].startsWith('**UNVERIFIED') ? 'UNVERIFIED' : 'Documented']));
  for (const id of ['R-04', 'R-08', 'R-10', 'R-14', 'R-15', 'R-16', 'R-17']) {
    assert.equal(status[id], 'UNVERIFIED', `${id} must stay flagged UNVERIFIED`);
  }
  for (const id of ['R-01', 'R-02', 'R-03', 'R-05', 'R-06', 'R-09', 'R-11', 'R-12', 'R-13', 'R-18', 'R-19']) {
    assert.equal(status[id], 'Documented', id);
  }
});

test('no statutory number is hardcoded in the decision logic', () => {
  const core = join(KIT, 'src', 'core');
  for (const f of ['deadlines.js', 'plan.js', 'rules.js']) {
    const src = readFileSync(join(core, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/\b21\b/, /\b18\b/, /\b14\b/, /\b9\b/, /\b600\b/]) {
      assert.doesNotMatch(src, forbidden, `${f} contains ${forbidden}`);
    }
  }
});

test('the core performs no I/O and reads no n8n globals', () => {
  const core = join(KIT, 'src', 'core');
  for (const f of readdirSync(core)) {
    const src = readFileSync(join(core, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\$env|\$json|\$\(|\bfetch\b|require\(|node:fs|node:http|process\.env|Date\.now|new Date\(\)|Math\.random/, f);
  }
});

test('nothing in the kit refers to material that does not belong in a public repo', () => {
  const banned = /(agent team|subagent|n8n-automation-ops|roadmap|pricing|\bscore\b)/i;
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  for (const f of walk(KIT).filter((p) => /\.(md|js|json|csv|example)$/.test(p) && !p.endsWith('rules.test.js'))) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), banned, f);
  }
});
