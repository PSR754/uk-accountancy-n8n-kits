import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan } from '../../src/core/plan.js';
import { bankHolidayDates } from '../../src/core/dates.js';
import { loadFixture } from '../helpers/csv.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', '..');
const workflow = JSON.parse(readFileSync(join(KIT, 'workflow.json'), 'utf8'));
const fx = (n) => loadFixture(join(HERE, '..', 'fixtures', n));
const nodeNamed = (name) => workflow.nodes.find((n) => n.name === name);

/**
 * The tests verify src/core. Production runs the copy of that source bundled
 * into the workflow's Code nodes. These tests close that gap by executing the
 * bundled code and asserting it agrees with the source, so "tested" and
 * "shipped" cannot quietly diverge.
 */

/** Run a generated Code node's jsCode with n8n's globals stubbed out. */
function runCodeNode(jsCode, { nodeOutputs = {}, env = {}, json = {}, inputItems = [] } = {}) {
  const $ = (name) => {
    // n8n throws when an expression reads a node that has not executed on this path.
    if (!(name in nodeOutputs)) throw new Error(`Referenced node is unexecuted: "${name}"`);
    const items = nodeOutputs[name].map((j) => ({ json: j }));
    return { all: () => items, first: () => items[0], item: items[0] };
  };
  const $input = { all: () => inputItems.map((j) => ({ json: j })), first: () => ({ json: inputItems[0] }) };
  const fn = new Function('$', '$env', '$json', '$now', '$input', `${jsCode}`);
  return fn($, env, json, { toISO: () => '2026-09-15T09:00:00.000Z' }, $input);
}

const config = {
  dryRun: false, firmName: 'Smith & Co', senderEmail: 'accounts@smith.co.uk',
  senderName: 'Accounts', replyToEmail: 'accounts@smith.co.uk', firmPhone: '01234 567890',
  signOffName: 'Ravi', practiceEmail: 'owner@smith.co.uk', milestones: '30,14,7,1', maxEmailsPerRun: 50,
  sendOnWeekends: false, sendOnBankHolidays: false, dryRunRecipient: '',
};
// By default today's preview is in the Run Log, as it is when the 08:30 run has worked.
const readers = (rows, extra = {}, today = '2026-09-15') => ({
  'Read Deadlines': rows, 'Read Sent Log': [], 'Read Run Control': [],
  'Read Run Log': [{ 'Run Date': today, Mode: 'preview' }], ...extra,
});

test('the bundled core is syntactically valid JavaScript', () => {
  for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new Function(node.parameters.jsCode), `${node.name} does not parse`);
  }
});

test('CONFORMANCE: the bundled planner produces exactly what the source produces', () => {
  const rows = fx('every-milestone.csv');
  const today = '2026-09-15';
  const fromSource = plan({ rows, today, config, sentKeys: [] });
  const out = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today, config, mode: 'send' }], ...readers(rows) },
  });
  assert.ok(fromSource.actions.length > 0);
  assert.equal(out.length, fromSource.actions.length, 'action counts differ');
  out.forEach((item, i) => {
    const expected = fromSource.actions[i];
    assert.equal(item.json.to, expected.to, `recipient differs at ${i}`);
    assert.equal(item.json.subject, expected.subject, `subject differs at ${i}`);
    assert.equal(item.json.body, expected.body, `body differs at ${i}`);
    assert.equal(item.json.tone, expected.tone, `tone differs at ${i}`);
    assert.equal(item.json.writeBacks.length, expected.deadlines.length);
  });
});

test('CONFORMANCE: the bundled planner agrees with the source across many days and messy data', () => {
  const rows = fx('messy-data.csv');
  const days = ['2026-08-10', '2026-09-15', '2026-09-18', '2026-10-01', '2026-11-30', '2026-12-30', '2027-01-05'];
  for (const today of days) {
    const fromSource = plan({ rows, today, config, sentKeys: [] });
    const out = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
      nodeOutputs: { 'Build Config': [{ today, config, mode: 'send' }], ...readers(rows, {}, today) },
    });
    assert.equal(out.length, fromSource.actions.length, `counts differ on ${today}`);
    out.forEach((item, i) => assert.equal(item.json.body, fromSource.actions[i].body, `body differs on ${today}`));
  }
});

test('CONFORMANCE: the bundled bank holiday data is the rules file, so a real holiday is silent', () => {
  const rows = fx('every-milestone.csv');
  // Good Friday 2026 is not in any list written in the code: it can only come from rules/bank-holidays.json.
  const out = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-04-03', config, mode: 'send' }], ...readers(rows, {}, '2026-04-03') },
  });
  assert.equal(out.length, 0);
  const plannerOut = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-04-03', config, mode: 'send' }], ...readers(rows, {}, '2026-04-03') },
  });
  assert.equal(plannerOut[0].json.summary.notSendableReason, 'bank holiday');

  const file = JSON.parse(readFileSync(join(KIT, 'rules', 'bank-holidays.json'), 'utf8'));
  const bundled = nodeNamed('Plan Run').parameters.jsCode;
  for (const date of bankHolidayDates(file, 'england-and-wales')) {
    assert.ok(bundled.includes(`"date":"${date}"`), `${date} missing from the bundle`);
  }
});

test('CONFORMANCE: the bundled sent-key ledger suppresses a resend', () => {
  const rows = fx('every-milestone.csv');
  const stub = { 'Build Config': [{ today: '2026-09-15', config, mode: 'send' }], ...readers(rows) };
  const first = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, { nodeOutputs: stub });
  assert.ok(first.length > 0);
  const keys = first.flatMap((i) => i.json.writeBacks.map((w) => ({ 'Idempotency Key': w.key })));
  const second = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
    nodeOutputs: { ...stub, 'Read Sent Log': keys },
  });
  assert.equal(second.length, 0, 'the bundled ledger did not suppress a resend');
});

test('the Plan Run node produces a usable preview and summary', () => {
  const rows = fx('every-milestone.csv');
  const out = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{
        today: '2026-09-15', mode: 'preview',         config: { ...config, dryRun: true, dryRunRecipient: 'owner@smith.co.uk' },
      }],
      ...readers(rows),
    },
  });
  const j = out[0].json;
  assert.equal(j.mode, 'preview');
  assert.equal(j.sendable, true);
  assert.ok(j.actionCount > 0);
  assert.match(j.digestSubject, /Reminder preview/);
  assert.match(j.digestBody, /DRY RUN IS ON/);
  assert.match(j.digestBody, /Hold Until cell/);
  assert.equal(j.summary.dryRun, true);
});

test('a hold typed in the Run Control tab stops that day\'s run', () => {
  const rows = fx('every-milestone.csv');
  const out = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{ today: '2026-09-15', config, mode: 'send' }],
      ...readers(rows, { 'Read Run Control': [{ 'Hold Until': '15/09/2026' }] }),
    },
  });
  assert.equal(out[0].json.sendable, false);
  assert.equal(out[0].json.actionCount, 0);
  assert.match(out[0].json.summary.haltReason, /held by the practice/);
  // A hold for a different day does nothing.
  const other = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{ today: '2026-09-15', config, mode: 'send' }],
      ...readers(rows, { 'Read Run Control': [{ 'Hold Until': '2026-09-14' }] }),
    },
  });
  assert.equal(other[0].json.sendable, true);
});

test('the config node defaults to dry run when nothing is configured', () => {
  const out = runCodeNode(nodeNamed('Build Config').parameters.jsCode, { env: {}, json: {} });
  assert.equal(out[0].json.config.dryRun, true,
    'a fresh install must not be able to email clients before anyone has configured it');
  assert.equal(out[0].json.mode, 'send');
  assert.match(out[0].json.today, /^\d{4}-\d{2}-\d{2}$/);
});

test('dry run is only switched off by an explicit false', () => {
  for (const [value, expected] of [['true', true], ['', true], ['yes', true], ['FALSE', true], ['false', false]]) {
    const out = runCodeNode(nodeNamed('Build Config').parameters.jsCode, { env: { DRY_RUN: value } });
    assert.equal(out[0].json.config.dryRun, expected, `DRY_RUN="${value}"`);
  }
});

test('REMINDER_MILESTONE_DAYS is read by the workflow and changes what is sent', () => {
  const cfg = (env) => runCodeNode(nodeNamed('Build Config').parameters.jsCode, { env })[0].json.config;
  assert.equal(cfg({}).milestones, '30,14,7,1');
  assert.equal(cfg({ REMINDER_MILESTONE_DAYS: '21,3' }).milestones, '21,3');

  // The value that leaves Build Config drives the bundled planner end to end.
  const rows = [{
    row_number: 2, 'Client Name': 'Acme Ltd', 'Deadline Type': 'VAT return', 'Due Date': '2026-10-06',
    'Contact Email': 'a@acme.co.uk', Status: 'Pending',
  }];
  const withEnv = (milestones) => runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{ today: '2026-09-15', mode: 'send', config: { ...config, milestones } }],
      ...readers(rows),
    },
  });
  assert.equal(withEnv('30,14,7,1').length, 1); // 21 days out: the 30-day reminder is earned
  assert.equal(withEnv('7,1').length, 0);        // not until 7 days out
});

test('the bank holiday division and calendar switches come from the environment', () => {
  const cfg = (env) => runCodeNode(nodeNamed('Build Config').parameters.jsCode, { env })[0].json.config;
  assert.equal(cfg({}).bankHolidayDivision, 'england-and-wales');
  assert.equal(cfg({ BANK_HOLIDAY_DIVISION: 'scotland' }).bankHolidayDivision, 'scotland');
  assert.equal(cfg({}).sendOnWeekends, false);
  assert.equal(cfg({ SEND_ON_WEEKENDS: 'true' }).sendOnWeekends, true);
});

// --- Workflow wiring -------------------------------------------------------
// These assert the structural properties that make the send path safe. Each
// corresponds to a defect found in a shipped kit.

const conns = workflow.connections;

test('the loop feeds work from output 1 and has a return edge', () => {
  const loop = nodeNamed('One Client At A Time');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1, 'the batch must be one client for per-client atomicity');
  const [done, loopOut] = conns[loop.name].main;
  assert.equal(loopOut[0].node, 'Send Reminder Email', 'work must hang off output 1, not output 0');
  assert.equal(done[0].node, 'Summarise Run', 'output 0 is "done" and should close out the run');
  const returns = Object.entries(conns).filter(([, o]) =>
    o.main.some((b) => (b || []).some((c) => c.node === loop.name)));
  assert.ok(returns.length >= 1, 'nothing loops back, so only the first client is processed');
});

test('each client is recorded before the loop moves on, and every path returns to the loop', () => {
  assert.equal(conns['Send Reminder Email'].main[0][0].node, 'Record This Send');
  assert.equal(conns['Record This Send'].main[0][0].node, 'Rows To Record');
  assert.equal(conns['Rows To Record'].main[0][0].node, 'Append To Sent Log');
  assert.equal(conns['Append To Sent Log'].main[0][0].node, 'Carry Rows');
  // Both writes are always attempted: a failed Sent Log append must not skip
  // the Deadlines update, or neither dedupe layer is written.
  assert.equal(conns['Carry Rows'].main[0].length, 1);
  assert.equal(conns['Carry Rows'].main[0][0].node, 'Update Sheet Status');
  assert.equal(workflow.nodes.some((n) => n.name === 'Sent Log Write Failed'), false);
  assert.equal(conns['Update Sheet Status'].main[0][0].node, 'Mark Sent');
  assert.equal(conns['Mark Sent'].main[0][0].node, 'One Client At A Time');
  assert.equal(conns['Record Failure'].main[0][0].node, 'One Client At A Time');
});

test('a client with several deadline rows re-enters the loop exactly once, whether the writes work or not', () => {
  // Only two nodes may feed the loop, and each has one output, so a client
  // cannot come back twice or be counted twice.
  const feeders = Object.entries(conns).filter(([name, o]) =>
    name !== 'Prepare Actions' && o.main.some((b) => (b || []).some((c) => c.node === 'One Client At A Time')));
  assert.deepEqual(feeders.map(([n]) => n).sort(), ['Mark Sent', 'Record Failure']);
  for (const [, o] of feeders) assert.equal(o.main.length, 1);
  // The Sheets writes never branch on error: a failure is an item, not a second path.
  for (const name of ['Append To Sent Log', 'Update Sheet Status']) {
    assert.equal(nodeNamed(name).onError, 'continueRegularOutput', name);
    assert.equal(conns[name].main.length, 1, `${name} has more than one output`);
  }
  // Mixed results (some rows written, one failed) collapse to ONE item.
  const run = (arrived, record = true, carried = [{ rowNumber: 2, ledgerFailed: false }]) => runCodeNode(nodeNamed('Mark Sent').parameters.jsCode, {
    nodeOutputs: {
      'One Client At A Time': [{ clientName: 'Acme Ltd', realRecipient: 'a@acme.co.uk', record }],
      // null models the dry-run path, where Carry Rows has not executed.
      ...(carried === null ? {} : { 'Carry Rows': carried }),
    },
    inputItems: arrived,
  });
  const mixed = run([{ updatedRows: 1 }, { error: 'Quota exceeded' }, { updatedRows: 1 }]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].json.status, 'write_failed');
  assert.equal(mixed[0].json.error, 'Quota exceeded');
  // The Sent Log append failed but the Deadlines update went through: still reported, once.
  const ledger = run([{ updatedRows: 1 }, { updatedRows: 1 }], true, [
    { rowNumber: 2, ledgerFailed: true, ledgerError: 'Sent Log 500' }, { rowNumber: 3, ledgerFailed: true, ledgerError: 'Sent Log 500' },
  ]);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].json.status, 'write_failed');
  assert.equal(ledger[0].json.error, 'Sent Log 500');
  assert.equal(run([{ updatedRows: 1 }, { updatedRows: 1 }]).length, 1);
  assert.equal(run([{ updatedRows: 1 }])[0].json.status, 'sent');
  assert.equal(run([{ x: 1 }], false)[0].json.status, 'sent (dry run)');
  assert.equal(run([{ x: 1 }], false, null)[0].json.status, 'sent (dry run)', 'dry run must not read Carry Rows, which has not executed');
  assert.throws(() => run([{ x: 1 }], true, null), /unexecuted/, 'the harness must model n8n throwing for an unexecuted node');
  // Carry Rows reports a failed ledger append on every row, once.
  const carried = runCodeNode(nodeNamed('Carry Rows').parameters.jsCode, {
    nodeOutputs: { 'Rows To Record': [{ rowNumber: 2 }, { rowNumber: 3 }] },
    inputItems: [{ ok: 1 }, { error: { message: 'boom' } }],
  });
  assert.equal(carried.length, 2);
  assert.ok(carried.every((c) => c.json.ledgerFailed === true && c.json.ledgerError === 'boom'));
  const clean = runCodeNode(nodeNamed('Carry Rows').parameters.jsCode, {
    nodeOutputs: { 'Rows To Record': [{ rowNumber: 2 }] }, inputItems: [{ ok: 1 }],
  });
  assert.equal(clean[0].json.ledgerFailed, false);
});

test('DRY RUN: the ledger append and the sheet write-back are bypassed when the item is not to be recorded', () => {
  const gate = nodeNamed('Record This Send');
  assert.equal(gate.type, 'n8n-nodes-base.if');
  assert.match(JSON.stringify(gate.parameters), /One Client At A Time.*\.record/);
  // true -> record; false -> straight to Mark Sent, skipping both writes.
  assert.equal(conns['Record This Send'].main[0][0].node, 'Rows To Record');
  assert.equal(conns['Record This Send'].main[1][0].node, 'Mark Sent');
  // The item the gate reads carries record:false in dry run and true when live.
  const item = (dryRun) => runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{ today: '2026-09-15', mode: 'send', config: { ...config, dryRun, dryRunRecipient: 'o@s.co.uk' } }],
      ...readers(fx('every-milestone.csv')),
    },
  });
  for (const out of item(true)) {
    assert.equal(out.json.record, false);
    assert.equal(out.json.writeBacks.length, 0, 'dry run must carry nothing to record');
  }
  for (const out of item(false)) {
    assert.equal(out.json.record, true);
    assert.ok(out.json.writeBacks.length > 0);
  }
});

test('a failed send is recorded, counted and alerted, and the loop continues', () => {
  const send = nodeNamed('Send Reminder Email');
  assert.equal(send.onError, 'continueErrorOutput');
  assert.equal(conns['Send Reminder Email'].main[1][0].node, 'Record Failure');
  // Retrying an SMTP send can duplicate a message the server already accepted.
  assert.equal(send.maxTries, 1);

  const failure = runCodeNode(nodeNamed('Record Failure').parameters.jsCode, {
    nodeOutputs: { 'One Client At A Time': [{ clientName: 'Acme Ltd', realRecipient: 'a@acme.co.uk' }] },
    inputItems: [{ error: { message: 'Connection timed out' } }],
  });
  assert.deepEqual({ ...failure[0].json }, {
    status: 'failed', clientName: 'Acme Ltd', recipient: 'a@acme.co.uk', error: 'Connection timed out',
  });

  const summarise = (items, mode = 'send') => runCodeNode(nodeNamed('Summarise Run').parameters.jsCode, {
    nodeOutputs: {
      'Plan Run': [{ today: '2026-09-15', mode, summary: { rowsRead: 5, upcoming: 4, emails: 3, skipped: 1, dryRun: false, haltReason: null, notSendableReason: null } }],
    },
    inputItems: items,
  })[0].json;
  const s = summarise([
    { status: 'sent', clientName: 'A' }, { status: 'sent (dry run)', clientName: 'B' },
    { status: 'failed', clientName: 'Acme Ltd', recipient: 'a@acme.co.uk', error: 'timeout' },
  ]);
  assert.equal(s['Emails Sent'], 1);
  assert.equal(s['Dry Run Sends'], 1, 'dry run sends are counted apart from real ones');
  assert.equal(s['Emails Failed'], 1);
  assert.match(s.Failures, /NOT CONFIRMED SENT Acme Ltd \(a@acme\.co\.uk\): timeout/);
  assert.match(s.alertBody, /could NOT be confirmed[\s\S]*may still have been delivered/);
  assert.doesNotMatch(s.alertBody, /were NOT sent/);
  assert.match(s.Note, /1 send\(s\) could not be confirmed/);
  assert.match(s.alertBody, /Acme Ltd/);
  assert.equal(s.failedCount, 1);
  // Runs that never reach the loop still produce one well-formed row.
  const quiet = summarise([{ messageId: 'x' }], 'preview');
  assert.equal(quiet['Emails Sent'], 0);
  assert.equal(quiet['Emails Failed'], 0);
  assert.equal(quiet.Note, 'ok');
  // The alert goes to the practice when there is a failure, and only then.
  assert.equal(conns['Append Run Log'].main[0][0].node, 'Prepare Alert');
  assert.equal(conns['Prepare Alert'].main[0][0].node, 'Any Failures');
  assert.equal(conns['Any Failures'].main[0][0].node, 'Alert Practice Of Failures');
  assert.match(JSON.stringify(nodeNamed('Any Failures').parameters), /json\.alert/);
  assert.equal(s.alert, true);
});

test('every run path ends in one Summarise Run and one Run Log row', () => {
  for (const src of ['Email Preview To Practice']) assert.equal(conns[src].main[0][0].node, 'Summarise Run');
  assert.equal(conns['Preview or Send'].main[2][0].node, 'Summarise Run');
  assert.equal(conns['Any Emails To Send'].main[1][0].node, 'Summarise Run');
  assert.equal(conns['Summarise Run'].main.length, 1);
  assert.equal(conns['Summarise Run'].main[0].length, 1);
  assert.equal(conns['Summarise Run'].main[0][0].node, 'Append Run Log');
  assert.equal(nodeNamed('Append Run Log').executeOnce, true, 'the loop\'s done output carries every client; one row per run only');
  const cols = Object.keys(nodeNamed('Append Run Log').parameters.columns.value);
  for (const c of ['Emails Sent', 'Dry Run Sends', 'Emails Failed', 'Sent Not Recorded', 'Failures']) assert.ok(cols.includes(c), c);
});

test('an empty day never feeds an empty item to the send node', () => {
  const prepare = nodeNamed('Prepare Actions');
  assert.notEqual(prepare.alwaysOutputData, true, 'an empty item would reach Send Reminder Email');
  const gate = nodeNamed('Any Emails To Send');
  assert.equal(gate.type, 'n8n-nodes-base.if');
  assert.equal(conns['Preview or Send'].main[1][0].node, 'Any Emails To Send');
  assert.equal(conns['Any Emails To Send'].main[0][0].node, 'Prepare Actions');
  assert.match(JSON.stringify(gate.parameters), /actionCount/);
  // And the planner really does produce zero actions on a quiet day.
  const out = runCodeNode(prepare.parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-09-15', config, mode: 'send' }], ...readers([]) },
  });
  assert.equal(out.length, 0);
});

test('the Sheets reads run once each, so they cannot multiply N x M', () => {
  const order = ['Read Deadlines', 'Read Sent Log', 'Read Run Control', 'Read Run Log'];
  for (const name of order) assert.equal(nodeNamed(name).executeOnce, true, `${name} runs once per input item`);
  for (let i = 0; i < order.length - 1; i += 1) assert.equal(conns[order[i]].main[0][0].node, order[i + 1]);
  assert.equal(conns['Read Run Log'].main[0][0].node, 'Plan Run');
  assert.equal(nodeNamed('Plan Run').type, 'n8n-nodes-base.code');
  assert.equal(nodeNamed('Plan Run').parameters.mode, 'runOnceForAllItems');
});

test('a failed ledger, hold or run-log read, or a failed preview, stops the run instead of being swallowed', () => {
  for (const name of ['Read Deadlines', 'Read Sent Log', 'Read Run Control', 'Read Run Log']) {
    const n = nodeNamed(name);
    assert.ok(!n.onError || n.onError === 'stopWorkflow', `${name} swallows errors (${n.onError})`);
  }
  // The send run cannot proceed without a delivered preview: the gate lives in the planner.
  const out = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-09-15', config, mode: 'send' }], ...readers(fx('every-milestone.csv'), { 'Read Run Log': [] }) },
  });
  assert.equal(out[0].json.sendable, false);
  assert.match(out[0].json.summary.haltReason, /no preview email was delivered/);
  // The preview writes its Run Log row only after the email succeeded.
  const preview = nodeNamed('Email Preview To Practice');
  assert.equal(preview.onError, 'continueErrorOutput');
  assert.deepEqual(conns['Email Preview To Practice'].main.map((b) => b[0].node), ['Summarise Run', 'Summarise Run']);
});

test('there is no webhook and no state-changing link anywhere in the workflow or the emails', () => {
  assert.equal(workflow.nodes.some((n) => n.type === 'n8n-nodes-base.webhook'), false);
  assert.doesNotMatch(JSON.stringify(workflow), /HOLD_URL|holdUrl|hold-today/);
  const rows = fx('every-milestone.csv');
  const out = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-09-15', config, mode: 'preview' }], ...readers(rows) },
  });
  assert.doesNotMatch(out[0].json.digestBody, /https?:\/\//);
});

test('no node reads $json straight after a node that replaces its output', () => {
  const replacing = new Set(['n8n-nodes-base.emailSend', 'n8n-nodes-base.wait', 'n8n-nodes-base.googleSheets']);
  const byName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));
  for (const [src, outs] of Object.entries(conns)) {
    if (!replacing.has(byName[src]?.type)) continue;
    for (const branch of outs.main) {
      for (const c of branch || []) {
        const target = byName[c.node];
        const code = target?.parameters?.jsCode;
        if (code) {
          assert.doesNotMatch(code, /(^|[^'"\w])\$json\b/, `${c.node} reads $json after ${src}`);
        }
        const text = JSON.stringify(target?.parameters ?? {});
        if (/\$json/.test(text)) {
          assert.match(text, /\$\('/, `${c.node} reads $json after ${src} without naming a source node`);
        }
      }
    }
  }
});

test('the write-back after the reminder email takes its data from an earlier node, by name', () => {
  assert.match(nodeNamed('Rows To Record').parameters.jsCode, /\$\('One Client At A Time'\)/);
  assert.match(nodeNamed('Carry Rows').parameters.jsCode, /\$\('Rows To Record'\)/);
  assert.match(nodeNamed('Mark Sent').parameters.jsCode, /\$\('One Client At A Time'\)/);
  assert.match(nodeNamed('Record Failure').parameters.jsCode, /\$\('One Client At A Time'\)/);
});

test('the sheet update matches on row_number only', () => {
  const update = nodeNamed('Update Sheet Status');
  assert.equal(update.parameters.operation, 'update');
  assert.deepEqual(update.parameters.columns.matchingColumns, ['row_number'],
    'matching on business columns silently uses only the first of several');
  assert.ok(update.parameters.columns.value.row_number);
});

test('every Google Sheets node declares its operation explicitly', () => {
  for (const n of workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) {
    assert.ok(n.parameters.operation, `${n.name} has no operation and would default to read`);
  }
});

test('no client-facing email carries the n8n attribution footer', () => {
  const emails = workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.emailSend');
  assert.ok(emails.length >= 2);
  for (const n of emails) assert.equal(n.parameters.options.appendAttribution, false, n.name);
});

test('workflow settings pin the things that silently change behaviour', () => {
  assert.equal(workflow.settings.executionOrder, 'v1');
  assert.equal(workflow.settings.timezone, 'Europe/London');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none',
    'successful runs should not copy the client book into the n8n database');
  assert.equal(workflow.settings.saveDataErrorExecution, 'all');
  assert.equal(workflow.active, false, 'a kit must never ship active');
});

test('every networked node retries', () => {
  const networked = new Set([
    'n8n-nodes-base.googleSheets', 'n8n-nodes-base.emailSend', 'n8n-nodes-base.httpRequest',
  ]);
  for (const n of workflow.nodes.filter((x) => networked.has(x.type))) {
    assert.equal(n.retryOnFail, true, `${n.name} has no retry`);
  }
});

test('nothing in the workflow can file, submit or pay: no HMRC or Companies House calls', () => {
  assert.equal(workflow.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest'), false);
  const text = JSON.stringify(workflow);
  assert.doesNotMatch(text, /api\.service\.hmrc\.gov\.uk|api\.company-information\.service\.gov\.uk|oauth\.hmrc/i);
});

test('the write-back node builds one row per deadline from the loop item', () => {
  const rows = runCodeNode(nodeNamed('Rows To Record').parameters.jsCode, {
    nodeOutputs: {
      'One Client At A Time': [{
        realRecipient: 'ap@acme.co.uk', sentOn: '2026-09-15',
        writeBacks: [
          { rowNumber: 2, clientName: 'Acme', deadlineType: 'VAT return', milestone: 30, dueDate: '2026-10-15', key: 'acme|vat return|2026-10-15|30' },
          { rowNumber: 3, clientName: 'Acme', deadlineType: 'CT payment', milestone: 14, dueDate: '2026-09-29', key: 'acme|ct payment|2026-09-29|14' },
        ],
      }],
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].json.rowNumber, 2);
  assert.equal(rows[0].json['Last Reminder Sent'], 30);
  assert.equal(rows[0].json['Reminded For Due Date'], '2026-10-15');
  assert.equal(rows[0].json['Last Reminded On'], '2026-09-15');
  assert.equal(rows[0].json['Idempotency Key'], 'acme|vat return|2026-10-15|30');
  assert.equal(rows[1].json['Idempotency Key'], 'acme|ct payment|2026-09-29|14');
});

test('the sheet columns the workflow writes exist in the templates', () => {
  const header = (f) => readFileSync(join(KIT, 'templates', f), 'utf8').split('\n')[0].split(',');
  const deadlines = header('Deadlines.csv');
  const update = nodeNamed('Update Sheet Status').parameters.columns.value;
  for (const col of Object.keys(update).filter((c) => c !== 'row_number')) {
    assert.ok(deadlines.includes(col), `Deadlines.csv lacks "${col}"`);
  }
  const sent = header('Sent Log.csv');
  for (const col of Object.keys(nodeNamed('Append To Sent Log').parameters.columns.value)) {
    assert.ok(sent.includes(col), `Sent Log.csv lacks "${col}"`);
  }
  const runLog = header('Run Log.csv');
  for (const col of runLog) assert.ok(col !== '', 'empty header');
  for (const col of Object.keys(nodeNamed('Append Run Log').parameters.columns.value)) {
    assert.ok(runLog.includes(col), `Run Log.csv lacks "${col}"`);
  }
  assert.ok(header('Run Control.csv').includes('Hold Until'));
  for (const col of ['Run Date', 'Mode']) assert.ok(runLog.includes(col), `Run Log.csv lacks "${col}", which the send run reads`);
  // Every column the planner reads is in the Deadlines template.
  for (const col of ['Client Name', 'Deadline Type', 'Due Date', 'Contact Email', 'Status',
    'Last Reminder Sent', 'Reminded For Due Date', 'Last Reminded On']) {
    assert.ok(deadlines.includes(col), `Deadlines.csv lacks "${col}"`);
  }
});

test('the example dates in the Deadlines template are weekdays', () => {
  const lines = readFileSync(join(KIT, 'templates', 'Deadlines.csv'), 'utf8').trim().split('\n').slice(1);
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    const due = line.split(',')[2];
    const day = new Date(`${due}T00:00:00Z`).getUTCDay();
    assert.ok(day >= 1 && day <= 5, `${due} is a weekend`);
  }
});

// --- Failures after the email has gone, and halts ----------------------------------

const summariseWith = (items, { mode = 'send', summary = {} } = {}) => runCodeNode(nodeNamed('Summarise Run').parameters.jsCode, {
  nodeOutputs: {
    'Plan Run': [{ today: '2026-09-15', mode, summary: {
      rowsRead: 5, upcoming: 4, emails: 3, skipped: 1, dryRun: false, haltReason: null,
      notSendableReason: null, alertable: false, ...summary,
    } }],
  },
  inputItems: items,
})[0].json;

test('Summarise Run counts write failures, says the email DID go, and raises the alert', () => {
  const s = summariseWith([
    { status: 'sent', clientName: 'A' },
    { status: 'write_failed', clientName: 'Acme Ltd', recipient: 'a@acme.co.uk', error: 'Quota exceeded' },
  ]);
  assert.equal(s['Emails Sent'], 1);
  assert.equal(s['Sent Not Recorded'], 1);
  assert.equal(s['Emails Failed'], 0);
  assert.equal(s.alert, true);
  assert.match(s.Failures, /SENT, NOT RECORDED Acme Ltd/);
  assert.match(s.alertBody, /WERE sent, but recording them failed/);
  assert.match(s.Note, /sent but could not be recorded/);
});

test('a clean run does not raise the alert', () => {
  assert.equal(summariseWith([{ status: 'sent', clientName: 'A' }]).alert, false);
  assert.equal(summariseWith([{ status: 'sent (dry run)', clientName: 'A' }]).alert, false);
});

test('a send run that halts for a fault alerts the practice, but the practice\'s own hold does not', () => {
  const fault = summariseWith([{}], { summary: { haltReason: 'no preview email was delivered to the practice today, so nothing has been sent', alertable: true } });
  assert.equal(fault.alert, true);
  assert.match(fault.alertBody, /The 09:00 run sent nothing: no preview email/);
  assert.match(fault.alertSubject, /sent nothing/);
  const hold = summariseWith([{}], { summary: { haltReason: 'run held by the practice', alertable: false } });
  assert.equal(hold.alert, false);
  const weekend = summariseWith([{}], { summary: { notSendableReason: 'weekend', alertable: false } });
  assert.equal(weekend.alert, false);
  // The preview run shows its own halt in the preview email, so it is not double-alerted.
  assert.equal(summariseWith([{}], { mode: 'preview', summary: { haltReason: 'x', alertable: true } }).alert, false);
});

test('the planner marks which halts are faults', () => {
  const run = (o) => runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-09-15', config, mode: 'send' }], ...readers(fx('every-milestone.csv'), o) },
  })[0].json.summary;
  assert.equal(run({ 'Read Run Log': [] }).alertable, true, 'no preview is a fault');
  assert.equal(run({ 'Read Run Control': [{ 'Hold Until': '2026-09-15' }] }).alertable, false, 'a hold is deliberate');
  assert.equal(run({}).alertable, false);
});

test('the alert email is only reached from Any Failures, and goes to the practice', () => {
  assert.equal(conns['Any Failures'].main[0][0].node, 'Alert Practice Of Failures');
  const alertNode = nodeNamed('Alert Practice Of Failures');
  assert.equal(alertNode.onError, undefined, 'a failed alert must turn the run red, not be swallowed');
  assert.ok(!alertNode.alwaysOutputData);
  assert.match(alertNode.parameters.toEmail, /practiceEmail/);
  for (const f of ['subject', 'text']) assert.match(alertNode.parameters[f], /\$\('Prepare Alert'\)/, 'the alert must read its content by node name');
  assert.equal(alertNode.parameters.options.appendAttribution, false);
});

test('the client send is never retried automatically, so a timeout after SMTP accept cannot duplicate', () => {
  const send = nodeNamed('Send Reminder Email');
  assert.ok(send.retryOnFail !== true || send.maxTries === 1, 'automatic retry of a client email is on');
  assert.equal(send.maxTries, 1);
});

test('LIVE settings: an empty or example sender or practice address halts and alerts, in the bundled planner too', () => {
  const run = (cfg, mode = 'send') => runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-09-15', mode, config: { ...config, ...cfg } }], ...readers(fx('every-milestone.csv')) },
  })[0].json;
  const bad = [
    [{ practiceEmail: '' }, /PRACTICE_EMAIL is empty/],
    [{ practiceEmail: 'you@yourfirm.co.uk' }, /PRACTICE_EMAIL is still the example placeholder/],
    [{ senderEmail: 'accounts@example.co.uk' }, /SENDER_EMAIL is still the example placeholder/],
    [{ senderEmail: '' }, /SENDER_EMAIL is empty/],
  ];
  for (const [cfg, re] of bad) {
    for (const mode of ['send', 'preview']) {
      const j = run(cfg, mode);
      assert.equal(j.sendable, false, JSON.stringify(cfg));
      assert.equal(j.actionCount, 0);
      assert.match(j.summary.haltReason, re);
      assert.equal(j.summary.alertable, true);
      assert.match(j.digestBody, /NOTHING WILL BE SENT: settings to fix before going live/, 'the preview must say so');
    }
  }
  assert.equal(run({}).sendable, true);
  // Dry run does not need real addresses to preview.
  assert.equal(run({ dryRun: true, dryRunRecipient: 'o@s.co.uk', practiceEmail: '', senderEmail: 'accounts@example.co.uk' }).actionCount > 0, true);
});

test('Build Config passes PRACTICE_EMAIL into the config the planner checks', () => {
  const out = runCodeNode(nodeNamed('Build Config').parameters.jsCode, { env: { PRACTICE_EMAIL: 'owner@smith.co.uk' } })[0].json;
  assert.equal(out.config.practiceEmail, 'owner@smith.co.uk');
  assert.equal(out.practiceEmail, 'owner@smith.co.uk');
  assert.equal(runCodeNode(nodeNamed('Build Config').parameters.jsCode, { env: {} })[0].json.config.practiceEmail, '');
});

test('the alert does not depend on the Run Log write: a failed Run Log row is itself alerted', () => {
  assert.equal(nodeNamed('Append Run Log').onError, 'continueRegularOutput', 'a Sheets outage would silence the alert');
  const prep = (summary, logItem) => runCodeNode(nodeNamed('Prepare Alert').parameters.jsCode, {
    nodeOutputs: { 'Summarise Run': [{ 'Run Date': '2026-09-15', ...summary }] },
    inputItems: [logItem],
  })[0].json;
  // Log written, nothing wrong: no alert.
  assert.equal(prep({ alert: false }, { 'Run At': 'x' }).alert, false);
  // Log written, send problems: the summary's alert is used as is.
  const problems = prep({ alert: true, alertSubject: 'S', alertBody: 'B' }, { 'Run At': 'x' });
  assert.deepEqual([problems.alert, problems.alertSubject, problems.alertBody], [true, 'S', 'B']);
  // Log write failed on a clean run: alert about the log alone.
  const logOnly = prep({ alert: false }, { error: 'Sheets 503' });
  assert.equal(logOnly.alert, true);
  assert.match(logOnly.alertSubject, /could not write its Run Log row/);
  assert.match(logOnly.alertBody, /Sheets 503/);
  // Both: one email covers both.
  const both = prep({ alert: true, alertSubject: 'S', alertBody: 'B' }, { error: { message: 'Sheets 503' } });
  assert.equal(both.alertSubject, 'S');
  assert.match(both.alertBody, /^B\n\n.*Sheets 503/s);
  // The alert send itself stays loud, and Any Failures reads Prepare Alert's item.
  assert.equal(nodeNamed('Alert Practice Of Failures').onError, undefined);
  assert.equal(conns['Any Failures'].main[0][0].node, 'Alert Practice Of Failures');
});

test('a failed 08:30 preview is logged and alerted, and cannot satisfy the 09:00 preview gate', () => {
  const summarise = (items) => runCodeNode(nodeNamed('Summarise Run').parameters.jsCode, {
    nodeOutputs: { 'Plan Run': [{ today: '2026-09-15', mode: 'preview', summary: {
      rowsRead: 5, upcoming: 4, emails: 3, skipped: 1, dryRun: false, haltReason: null, notSendableReason: null, alertable: false } }] },
    inputItems: items,
  })[0].json;
  const failed = summarise([{ error: { message: 'SMTP 550' } }]);
  assert.equal(failed.alert, true);
  assert.equal(failed.Mode, 'preview failed');
  assert.match(failed.Note, /preview email could not be sent \(SMTP 550\)/);
  assert.match(failed.alertSubject, /preview for 2026-09-15 could not be sent/);
  assert.match(failed.alertBody, /will send nothing today/);
  const ok = summarise([{ accepted: ['a@b.co.uk'] }]);
  assert.equal(ok.alert, false);
  assert.equal(ok.Mode, 'preview');
  // The 09:00 gate needs a row whose Mode is exactly "preview".
  const out = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: { 'Build Config': [{ today: '2026-09-15', config, mode: 'send' }],
      ...readers(fx('every-milestone.csv'), { 'Read Run Log': [{ 'Run Date': '2026-09-15', Mode: failed.Mode }] }) },
  });
  assert.equal(out[0].json.sendable, false);
  assert.match(out[0].json.summary.haltReason, /no preview email was delivered/);
});

// --- Expressions must only read nodes that ran on every path to them -----------------

test('AUDIT: every $(\'Node\') read in the workflow names a node that always executes before the reader', () => {
  const nodes = workflow.nodes;
  const names = new Set(nodes.map((n) => n.name));
  const targets = (n) => Object.values(conns[n]?.main ?? []).flat().filter(Boolean).map((c) => c.node);
  const triggers = nodes.filter((n) => /Trigger$/.test(n.type)).map((n) => n.name);
  assert.ok(triggers.length >= 2);
  const reachableAvoiding = (avoid) => {
    const seen = new Set();
    const stack = triggers.filter((t) => t !== avoid);
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur) || cur === avoid) continue;
      seen.add(cur);
      stack.push(...targets(cur));
    }
    return seen;
  };
  // A read is safe if the referenced node lies on EVERY path from a trigger to the reader.
  const alwaysBefore = (ref, reader) => ref !== reader && !reachableAvoiding(ref).has(reader);
  // Guarded reads: allowed only when the code reads the node after checking it ran.
  const GUARDED = { 'Mark Sent': { 'Carry Rows': /record === false[\s\S]*else[\s\S]*\$\('Carry Rows'\)/ } };
  let checked = 0;
  for (const n of nodes) {
    const text = JSON.stringify(n.parameters ?? {}).replace(/\\"/g, '"');
    const code = n.parameters?.jsCode ?? '';
    const refs = new Set([...text.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
    for (const ref of refs) {
      assert.ok(names.has(ref), `${n.name} reads $('${ref}'), which does not exist`);
      checked += 1;
      if (alwaysBefore(ref, n.name)) continue;
      const guard = GUARDED[n.name]?.[ref];
      assert.ok(guard && guard.test(code), `${n.name} reads $('${ref}'), which does not run on every path to it, and the read is not guarded`);
    }
  }
  assert.ok(checked > 15, 'the audit found suspiciously few references');
});
