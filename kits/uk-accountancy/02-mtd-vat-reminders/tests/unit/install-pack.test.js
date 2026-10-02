import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = join(KIT, '..', '..', '..');
const read = (f) => readFileSync(join(KIT, f), 'utf8');
const workflow = JSON.parse(read('workflow.json'));

test('the install pack is complete', () => {
  for (const f of ['README.md', '.env.example', 'docs/RUNBOOK.md', 'docs/EMAILS.md', 'rules/RULES.md',
    'rules/vat-rules.json', 'rules/bank-holidays.json', 'workflow.json']) {
    assert.ok(existsSync(join(KIT, f)), `${f} is missing`);
  }
  const templates = readdirSync(join(KIT, 'templates')).sort();
  assert.deepEqual(templates, ['Run Control.csv', 'Run Log.csv', 'Sent Log.csv', 'Submission Log.csv', 'VAT Clients.csv']);
  // Every tab the workflow reads or writes has a template, and the README names it.
  const tabs = new Set(JSON.stringify(workflow).match(/"value":"(VAT Clients|Submission Log|Sent Log|Run Log|Run Control)"/g)
    .map((m) => m.split('"')[3]));
  assert.equal(tabs.size, 5);
  for (const t of tabs) {
    assert.ok(templates.includes(`${t}.csv`), t);
    assert.ok(read('README.md').includes(`\`${t}\``), `README does not mention ${t}`);
  }
});

test('.env.example names every setting Build Config reads, with no secrets in it', () => {
  const env = read('.env.example');
  const declared = [...env.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)].map((m) => m[1]);
  const buildConfig = workflow.nodes.find((n) => n.name === 'Build Config').parameters.jsCode;
  const read_ = [...buildConfig.matchAll(/env\('([A-Z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(read_.length >= 12);
  for (const key of new Set(read_)) assert.ok(declared.includes(key), `${key} is read but not in .env.example`);
  for (const key of declared.filter((k) => k !== 'MTD_VAT_CLIENTS_SHEET_ID')) {
    assert.ok(read_.includes(key), `${key} is declared but Build Config does not read it`);
  }
  assert.match(env, /^MTD_VAT_CLIENTS_SHEET_ID=$/m, 'the sheet id must be left blank');
  assert.match(env, /^DRY_RUN=true$/m, 'the example must ship in dry run');
  assert.doesNotMatch(env, /(api[_-]?key|secret|password|token)\s*=\s*\S/i);
});

test('README, RUNBOOK and templates use the column names the planner reads', () => {
  const header = read('templates/VAT Clients.csv').split('\n')[0].split(',');
  for (const col of header) {
    assert.ok(read('README.md').includes(`\`${col}\``), `README does not document ${col}`);
    assert.ok(read('docs/RUNBOOK.md').includes(col), `RUNBOOK does not mention ${col}`);
  }
  assert.doesNotMatch(read('README.md'), /HMRC_CLIENT_LIST_SHEET_ID|REMINDER_MILESTONE_DAYS/);
});

test('docs/EMAILS.md is exactly what the current copy renders', () => {
  const before = read('docs/EMAILS.md');
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'render-emails-02.js')], { stdio: 'pipe' });
  assert.equal(read('docs/EMAILS.md'), before, 'docs/EMAILS.md is stale: run `npm run emails:kit02`');
});

test('the generated Code nodes carry the do-not-edit banner and come from src/core', () => {
  const coded = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
  assert.ok(coded.length >= 9);
  for (const n of coded) assert.match(n.parameters.jsCode, /^\/\/ GENERATED FILE\. Do not edit this node/, n.name);
  assert.deepEqual(workflow.meta, { generatedBy: 'scripts/build-workflow.js', builtFrom: 'src/core' });
});

test('every email node and schedule is Europe/London, v1, retried and never auto-attributed', () => {
  assert.equal(workflow.settings.timezone, 'Europe/London');
  assert.equal(workflow.settings.executionOrder, 'v1');
  for (const n of workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.emailSend')) {
    assert.equal(n.parameters.options.appendAttribution, false, n.name);
    assert.equal(n.retryOnFail, true, n.name);
  }
  for (const n of workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.scheduleTrigger')) {
    assert.match(JSON.stringify(n.parameters), /1-5/, `${n.name} should be weekdays only`);
  }
});

test('the public files never mention private tooling', () => {
  for (const f of ['README.md', 'docs/RUNBOOK.md', 'rules/RULES.md', '.env.example']) {
    assert.doesNotMatch(read(f), /roadmap|pricing|agent team|research brief|icp|autopilot/i, f);
  }
});
