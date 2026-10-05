import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan } from '../../src/core/plan.js';
import { profile } from '../helpers/fakes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', '..');
const workflow = JSON.parse(readFileSync(join(KIT, 'workflow.json'), 'utf8'));
const node = (name) => workflow.nodes.find((n) => n.name === name);
const codeNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code');

/**
 * The tests verify src/core. Production runs the copy of that source bundled
 * into the workflow's Code nodes. These tests execute the bundled code and
 * assert it agrees with the source, so "tested" and "shipped" cannot diverge.
 */
function run(name, { outputs = {}, env = {}, json = {}, input = [], mode } = {}) {
  const wrap = (arr) => arr.map((j) => ({ json: j }));
  const $ = (n) => {
    if (!(n in outputs)) throw new Error(`no output stubbed for "${n}"`);
    const items = wrap(outputs[n]);
    return { all: () => items, first: () => items[0], item: items[0] };
  };
  const $input = { all: () => wrap(input), first: () => wrap(input)[0] };
  const fn = new Function('$', '$env', '$json', '$input', '$now', node(name).parameters.jsCode);
  return fn($, env, json, $input, { toISO: () => '2026-10-05T07:00:00.000Z' });
}

test('every Code node is generated, parses, and carries the do-not-edit banner', () => {
  assert.ok(codeNodes.length >= 5);
  for (const n of codeNodes) {
    assert.match(n.parameters.jsCode, /^\/\/ GENERATED FILE/, n.name);
    assert.doesNotThrow(() => new Function(n.parameters.jsCode), n.name);
  }
});

test('Plan Run, as shipped, gives the same answer as the tested core', () => {
  const config = { practiceEmail: 'p@example.co.uk', dryRun: false, milestones: [30, 14, 7, 1], overdueRepeatDays: 7, attentionDigestWeekday: 1 };
  const companies = [
    { row: { 'Company Number': '01234567', 'Company Name': 'Acme Ltd' }, api: profile({ csDue: '2026-10-09', accountsDue: '2030-01-01' }) },
    { row: { 'Company Number': 'bad' }, api: { error: 'x' } },
  ];
  const sentLog = [{ 'Idempotency Key': 'x|y|z|1' }];
  const [out] = run('Plan Run', {
    input: companies,
    outputs: { 'Build Config': [{ today: '2026-10-05', config }], 'Read Sent Log': sentLog },
  });
  const expected = plan({ companies, today: '2026-10-05', config, sentKeys: ['x|y|z|1'] });
  assert.deepEqual(out.json.summary, expected.summary);
  assert.equal(out.json.digestBody, expected.digest.body);
  assert.equal(out.json.digestSubject, expected.digest.subject);
  assert.deepEqual(out.json.sentLogRows, expected.sentLogRows);
  assert.equal(out.json.sendDigest, true);
});

test('Plan Run fails loudly when the Sent Log cannot be read, instead of treating it as empty', () => {
  assert.throws(() => run('Plan Run', {
    input: [],
    outputs: { 'Build Config': [{ today: '2026-10-05', config: { practiceEmail: 'p@example.co.uk' } }] },
  }), /no output stubbed for "Read Sent Log"/);
});

test('Read Sent Log has no error handling that would turn a failure into an empty log', () => {
  assert.equal(node('Read Sent Log').onError, undefined);
  assert.equal(node('Read Sent Log').retryOnFail, true);
});

test('Build Config defaults to dry run, and only the exact string "false" turns it off', () => {
  const dflt = run('Build Config', { env: {} })[0].json;
  assert.equal(dflt.config.dryRun, true);
  assert.match(dflt.today, /^\d{4}-\d{2}-\d{2}$/);
  for (const v of ['False', 'no', '0', 'true', '']) {
    assert.equal(run('Build Config', { env: { DRY_RUN: v } })[0].json.config.dryRun, true, v);
  }
  assert.equal(run('Build Config', { env: { DRY_RUN: 'false' } })[0].json.config.dryRun, false);
  const c = run('Build Config', { env: { REMINDER_MILESTONES: '60, 30,7', ATTENTION_DIGEST_WEEKDAY: 'off' } })[0].json.config;
  assert.deepEqual(c.milestones, [60, 30, 7]);
  assert.equal(c.attentionDigestWeekday, null);
});

test('Prepare Companies keeps every row and adds a normalised number', () => {
  const rows = [{ 'Company Number': 1234567 }, { 'Company Number': 'sc123456' }, {}];
  const out = run('Prepare Companies', { input: rows });
  assert.equal(out.length, 3);
  assert.equal(out[0].json._companyNumber, '01234567');
  assert.equal(out[1].json._companyNumber, 'SC123456');
  assert.equal(out[2].json._companyNumber, '');
  assert.deepEqual(out.map((o) => o.pairedItem.item), [0, 1, 2]);
});

test('Collect Result pairs the sheet row with the API result, or the error object', () => {
  const row = { 'Company Number': '01234567' };
  const good = run('Collect Result', { json: { company_number: '01234567' }, outputs: { 'Per Company': [row] } });
  assert.deepEqual(good.json.row, row);
  const bad = run('Collect Result', { json: { error: { message: 'ETIMEDOUT' } }, outputs: { 'Per Company': [row] } });
  assert.equal(bad.json.api.error.message, 'ETIMEDOUT');
});

test('Collect Result fails if pairing with the loop item is lost, and has no fallback', () => {
  assert.doesNotMatch(node('Collect Result').parameters.jsCode, /\.first\(\)|catch/);
  // A stub where .item is unavailable, as when n8n cannot resolve the pairing.
  const fn = new Function('$', '$json', node('Collect Result').parameters.jsCode);
  const $ = () => ({ get item() { throw new Error('Cannot find the paired item'); }, first: () => ({ json: { 'Company Number': 'WRONG' } }) });
  assert.throws(() => fn($, { company_number: '01234567' }), /paired item/);
});

test('Prepare Companies marks paused and unusable rows as not needing a lookup', () => {
  const out = run('Prepare Companies', { input: [
    { 'Company Number': '01234567' }, { 'Company Number': '01234567', Paused: 'Yes' }, { 'Company Number': 'bad' }, {},
  ] });
  assert.deepEqual(out.map((o) => o.json._needsLookup), [true, false, false, false]);
});

test('Skip Lookup passes the row on with no API data', () => {
  const out = run('Skip Lookup', { json: { 'Company Number': 'bad' } });
  assert.deepEqual(out.json, { row: { 'Company Number': 'bad' }, api: null });
});

test('the sheet id comes from Build Config, which is where Cloud users set it', () => {
  for (const n of workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) {
    assert.match(n.parameters.documentId.value, /Build Config.*sheetId/, n.name);
  }
  assert.equal(run('Build Config', { env: { COMPANIES_HOUSE_TRACKER_SHEET_ID: 'abc' } })[0].json.sheetId, 'abc');
});

test('lookups are paced under the API limit and skipped for rows that do not need one', () => {
  const c = workflow.connections;
  assert.equal(c['Needs Lookup'].main[0][0].node, 'Companies House Lookup');
  assert.equal(c['Needs Lookup'].main[1][0].node, 'Skip Lookup');
  assert.equal(c['Skip Lookup'].main[0][0].node, 'Per Company');
  assert.equal(c['Companies House Lookup'].main[0][0].node, 'Rate Limit Pause');
  assert.equal(c['Rate Limit Pause'].main[0][0].node, 'Collect Result');
  const w = node('Rate Limit Pause').parameters;
  assert.equal(w.unit, 'seconds');
  // 600 requests per 5 minutes is one per 0.5 seconds; the pause plus request time must exceed that.
  assert.ok(w.amount >= 0.5);
});

test('the digest email is attempted once, so a timeout cannot cause a duplicate send', () => {
  assert.equal(node('Email Digest To Practice').maxTries, 1);
});

test('Rows For Sent Log writes only what the plan holds, so dry run writes nothing', () => {
  const dry = run('Rows For Sent Log', { outputs: { 'Plan Run': [{ sentLogRows: [] }] } });
  assert.equal(dry.length, 1);
  assert.equal(dry[0].json.hasRows, false, 'a marker only, so the run still reaches the Run Log');
  const live = run('Rows For Sent Log', { outputs: { 'Plan Run': [{ sentLogRows: [{ 'Idempotency Key': 'k' }, { 'Idempotency Key': 'l' }] }] } });
  assert.equal(live.length, 2);
  assert.ok(live[0].json['Reported At']);
});

// ---- Structure ----------------------------------------------------------

test('the lookup is wired to the loop output and returns to the loop', () => {
  const c = workflow.connections;
  assert.equal(c['Per Company'].main[1][0].node, 'Needs Lookup', 'output 1 is "loop"');
  assert.equal(c['Per Company'].main[0][0].node, 'Plan Run', 'output 0 is "done"');
  assert.equal(c['Collect Result'].main[0][0].node, 'Per Company');
});

test('nothing writes to Companies House: every HTTP request is a GET to the read API', () => {
  const http = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.ok(http.length >= 1);
  for (const n of http) {
    assert.equal(n.parameters.method, 'GET', n.name);
    assert.match(n.parameters.url, /^=https:\/\/api\.company-information\.service\.gov\.uk\/company\//, n.name);
  }
  assert.ok(!workflow.nodes.some((n) => n.type === 'n8n-nodes-base.webhook'), 'no inbound endpoint exists');
});

test('the only email goes to the practice, never to a client field', () => {
  const mails = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.emailSend');
  assert.equal(mails.length, 1);
  const p = mails[0].parameters;
  assert.match(p.toEmail, /digestTo/);
  assert.doesNotMatch(JSON.stringify(p), /Client Contact Email|draftTo/);
  assert.equal(p.options.appendAttribution, false);
});

test('the digest is only emailed when the plan says so, and the log is only written after the send', () => {
  const c = workflow.connections;
  assert.equal(c['Plan Run'].main[0].some((l) => l.node === 'Digest Needed'), true);
  assert.equal(c['Digest Needed'].main[0][0].node, 'Email Digest To Practice');
  assert.equal(c['Digest Needed'].main[1][0].node, 'Append Run Log', 'no digest still writes a Run Log row');
  assert.equal(c['Email Digest To Practice'].main[0][0].node, 'Rows For Sent Log');
  assert.equal(c['Rows For Sent Log'].main[0][0].node, 'Has Rows To Record');
  assert.equal(c['Has Rows To Record'].main[0][0].node, 'Append To Sent Log');
  const incoming = Object.entries(c).filter(([, o]) => o.main.some((b) => b.some((l) => l.node === 'Append To Sent Log')));
  assert.deepEqual(incoming.map(([n]) => n), ['Has Rows To Record']);
});

test('every Google Sheets node sets its operation, and the reads that must run once do', () => {
  const sheets = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets');
  assert.equal(sheets.length, 5);
  for (const n of sheets) assert.ok(['read', 'append'].includes(n.parameters.operation), n.name);
  assert.equal(node('Read Sent Log').executeOnce, true);
  assert.equal(node('Read Companies').executeOnce, true);
});

test('workflow settings: v1 execution order, Europe/London, retries on every network node', () => {
  assert.equal(workflow.settings.executionOrder, 'v1');
  assert.equal(workflow.settings.timezone, 'Europe/London');
  assert.equal(workflow.active, false);
  for (const n of workflow.nodes.filter((x) => /googleSheets|httpRequest|emailSend/.test(x.type))) {
    assert.equal(n.retryOnFail, true, n.name);
  }
});

test('Companies House lookup failures do not stop the run', () => {
  assert.equal(node('Companies House Lookup').onError, 'continueRegularOutput');
});

test('no secrets or real identifiers in the workflow', () => {
  const text = JSON.stringify(workflow);
  assert.doesNotMatch(text, /(api[_-]?key|secret|password)\s*[:=]\s*"?[A-Za-z0-9_-]{16,}/i);
});

test('a halted run, or one where every lookup failed, fails visibly rather than finishing green', () => {
  const c = workflow.connections;
  assert.equal(c['Append Run Log'].main[0][0].node, 'Run Needs Attention');
  assert.equal(c['Append Run Log After Send'].main[0][0].node, 'Run Needs Attention');
  assert.equal(c['Run Needs Attention'].main[0][0].node, 'Stop And Report');
  assert.equal(node('Stop And Report').type, 'n8n-nodes-base.stopAndError');
  assert.match(node('Run Needs Attention').parameters.conditions.conditions[0].leftValue, /summary\.failRun/);
});

test('the Run Log row for a sent digest is written only after the send, and says so', () => {
  const c = workflow.connections;
  assert.ok(paths('Email Digest To Practice', 'Append Run Log After Send').length >= 1);
  assert.equal(c['Email Digest To Practice'].main[0].some((l) => l.node === 'Append Run Log After Send'), false, 'not directly after the email');
  assert.equal(c['Plan Run'].main[0].some((l) => /Run Log/.test(l.node)), false, 'no log row is written before the send');
  assert.equal(node('Append Run Log After Send').parameters.columns.value['Digest Sent'], 'true');
  assert.equal(node('Append Run Log').parameters.columns.value['Digest Sent'], 'false');
});

test('Plan Run throws if the Sent Log has data but no Idempotency Key column', () => {
  const base = { 'Build Config': [{ today: '2026-10-05', config: { practiceEmail: 'p@example.co.uk' } }] };
  assert.throws(() => run('Plan Run', { input: [], outputs: { ...base, 'Read Sent Log': [{ 'Idempotency Key ': 'a|b|c|1', 'Company Number': '01234567' }] } }), /Idempotency Key/);
  assert.doesNotThrow(() => run('Plan Run', { input: [], outputs: { ...base, 'Read Sent Log': [{}] } }), 'an empty tab is fine');
});

/** Every path from `from` to `to` through the main connections, as lists of "node" or "node#output". */
function paths(from, to, seen = []) {
  if (from === to) return [[...seen, to]];
  if (seen.includes(from)) return [];
  const outs = workflow.connections[from]?.main || [];
  return outs.flatMap((branch, idx) => (branch || []).flatMap((l) => paths(l.node, to, [...seen, `${from}#${idx}`])));
}

test('on every path from the email to Stop And Report the Sent Log is written first, or there was nothing to write', () => {
  const all = paths('Email Digest To Practice', 'Stop And Report');
  assert.ok(all.length >= 1);
  for (const p of all) {
    const wrote = p.some((n) => n.startsWith('Append To Sent Log'));
    const nothing = p.includes('Has Rows To Record#1');
    assert.ok(wrote || nothing, `unsafe path: ${p.join(' > ')}`);
  }
  // And the Run Log after a send is never reached without passing the Sent Log decision.
  for (const p of paths('Email Digest To Practice', 'Append Run Log After Send')) {
    assert.ok(p.includes('Has Rows To Record#0') ? p.some((n) => n.startsWith('Append To Sent Log')) : p.includes('Has Rows To Record#1'), p.join(' > '));
  }
});

test('a Sent Log write that fails after the send is explicit and stops the run', () => {
  const c = workflow.connections;
  assert.equal(node('Append To Sent Log').onError, 'continueErrorOutput');
  assert.equal(c['Append To Sent Log'].main[1][0].node, 'Sent Log Write Failed');
  const msg = node('Sent Log Write Failed').parameters.errorMessage;
  assert.match(msg, /digest sent but Sent Log not written - next run will re-send/);
  assert.equal(node('Append Run Log After Send').executeOnce, true, 'one Run Log row however many reminders');
});
