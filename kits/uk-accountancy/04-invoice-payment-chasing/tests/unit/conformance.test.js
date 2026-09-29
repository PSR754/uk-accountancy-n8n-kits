import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plan } from '../../src/core/plan.js';
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
function runCodeNode(jsCode, { nodeOutputs = {}, env = {}, json = {} } = {}) {
  const $ = (name) => {
    if (!(name in nodeOutputs)) throw new Error(`no output stubbed for node "${name}"`);
    const items = nodeOutputs[name].map((j) => ({ json: j }));
    return { all: () => items, first: () => items[0], item: items[0] };
  };
  const fn = new Function('$', '$env', '$json', '$now', `${jsCode}`);
  return fn($, env, json, { toISO: () => '2026-09-15T09:00:00.000Z' });
}

test('the bundled core is syntactically valid JavaScript', () => {
  for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(
      () => new Function(node.parameters.jsCode),
      `${node.name} does not parse`,
    );
  }
});

test('CONFORMANCE: the bundled planner produces exactly what the source produces', () => {
  const rows = fx('every-stage.csv');
  const today = '2026-09-15';
  const config = {
    dryRun: false, firmName: 'Smith & Co', senderEmail: 'accounts@smith.co.uk',
    senderName: 'Accounts', replyToEmail: 'accounts@smith.co.uk', firmPhone: '01234 567890',
    signOffName: 'Ravi', paymentInstructions: '', mentionLpcda: true,
    thresholds: { friendly: 7, firm: 30, final: 60 },
    minDaysBetweenChases: 7, maxEmailsPerRun: 50,
    sendOnWeekends: false, sendOnBankHolidays: false, dryRunRecipient: '',
  };

  const fromSource = plan({ rows, today, config, sentKeys: [] });

  const out = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{ today, config, mode: 'send' }],
      'Read Invoices': rows,
      'Read Sent Log': [],
    },
  });

  assert.equal(out.length, fromSource.actions.length, 'action counts differ');
  out.forEach((item, i) => {
    const expected = fromSource.actions[i];
    assert.equal(item.json.to, expected.to, `recipient differs at ${i}`);
    assert.equal(item.json.subject, expected.subject, `subject differs at ${i}`);
    assert.equal(item.json.body, expected.body, `body differs at ${i}`);
    assert.equal(item.json.stage, expected.stage, `stage differs at ${i}`);
  });
});

test('CONFORMANCE: the bundled planner agrees with the source across many days', () => {
  const rows = fx('messy-data.csv');
  const config = {
    dryRun: false, firmName: 'Smith & Co', senderEmail: 'a@b.co.uk', senderName: 'Accounts',
    replyToEmail: 'a@b.co.uk', firmPhone: '', signOffName: '', paymentInstructions: '',
    mentionLpcda: true, thresholds: { friendly: 7, firm: 30, final: 60 },
    minDaysBetweenChases: 7, maxEmailsPerRun: 50,
    sendOnWeekends: false, sendOnBankHolidays: false, dryRunRecipient: '',
  };
  for (const today of ['2026-08-10', '2026-09-15', '2026-10-01', '2026-11-30', '2027-01-05']) {
    const fromSource = plan({ rows, today, config, sentKeys: [] });
    const out = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
      nodeOutputs: {
        'Build Config': [{ today, config, mode: 'send' }],
        'Read Invoices': rows,
        'Read Sent Log': [],
      },
    });
    assert.equal(out.length, fromSource.actions.length, `counts differ on ${today}`);
    out.forEach((item, i) => {
      assert.equal(item.json.body, fromSource.actions[i].body, `body differs on ${today}`);
    });
  }
});

test('CONFORMANCE: the bundled sent-key ledger suppresses a resend', () => {
  const rows = fx('every-stage.csv');
  const config = {
    dryRun: false, firmName: 'X', senderEmail: 'a@b.co.uk', senderName: 'A', replyToEmail: 'a@b.co.uk',
    firmPhone: '', signOffName: '', paymentInstructions: '', mentionLpcda: true,
    thresholds: { friendly: 7, firm: 30, final: 60 }, minDaysBetweenChases: 7,
    maxEmailsPerRun: 50, sendOnWeekends: false, sendOnBankHolidays: false, dryRunRecipient: '',
  };
  const stub = {
    'Build Config': [{ today: '2026-09-15', config, mode: 'send' }],
    'Read Invoices': rows,
    'Read Sent Log': [],
  };
  const first = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, { nodeOutputs: stub });
  assert.ok(first.length > 0);

  const keys = first.flatMap((i) => i.json.writeBacks.map((w) => ({ 'Idempotency Key': w.key })));
  const second = runCodeNode(nodeNamed('Prepare Actions').parameters.jsCode, {
    nodeOutputs: { ...stub, 'Read Sent Log': keys },
  });
  assert.equal(second.length, 0, 'the bundled ledger did not suppress a resend');
});

test('the Plan Run node produces a usable preview and summary', () => {
  const rows = fx('every-stage.csv');
  const config = {
    dryRun: true, dryRunRecipient: 'owner@smith.co.uk', firmName: 'Smith & Co',
    senderEmail: 'a@b.co.uk', senderName: 'Accounts', replyToEmail: 'a@b.co.uk',
    firmPhone: '', signOffName: '', paymentInstructions: '', mentionLpcda: true,
    thresholds: { friendly: 7, firm: 30, final: 60 }, minDaysBetweenChases: 7,
    maxEmailsPerRun: 50, sendOnWeekends: false, sendOnBankHolidays: false,
  };
  const out = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{ today: '2026-09-15', config, mode: 'preview', holdUrl: 'https://example/hold' }],
      'Read Invoices': rows,
      'Read Sent Log': [],
      'Read Run Control': [],
    },
  });
  const j = out[0].json;
  assert.equal(j.mode, 'preview');
  assert.equal(j.sendable, true);
  assert.ok(j.actionCount > 0);
  assert.match(j.digestSubject, /Chase preview/);
  assert.match(j.digestBody, /DRY RUN IS ON/);
  assert.match(j.digestBody, /https:\/\/example\/hold/);
  assert.equal(j.summary.dryRun, true);
});

test('a hold placed from the preview email stops that day\'s run', () => {
  const rows = fx('every-stage.csv');
  const config = {
    dryRun: false, dryRunRecipient: '', firmName: 'X', senderEmail: 'a@b.co.uk',
    senderName: 'A', replyToEmail: 'a@b.co.uk', firmPhone: '', signOffName: '',
    paymentInstructions: '', mentionLpcda: true,
    thresholds: { friendly: 7, firm: 30, final: 60 }, minDaysBetweenChases: 7,
    maxEmailsPerRun: 50, sendOnWeekends: false, sendOnBankHolidays: false,
  };
  const out = runCodeNode(nodeNamed('Plan Run').parameters.jsCode, {
    nodeOutputs: {
      'Build Config': [{ today: '2026-09-15', config, mode: 'send', holdUrl: '' }],
      'Read Invoices': rows,
      'Read Sent Log': [],
      'Read Run Control': [{ 'Hold Until': '2026-09-15' }],
    },
  });
  assert.equal(out[0].json.sendable, false);
  assert.equal(out[0].json.actionCount, 0);
  assert.match(out[0].json.summary.haltReason, /held by the practice/);
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

// --- Workflow wiring -------------------------------------------------------
// These assert the structural properties that make the send path safe. Each
// corresponds to a defect found in a shipped kit, or to one found in this kit
// while reviewing the generated workflow.

const conns = workflow.connections;

test('the loop feeds work from output 1 and has a return edge', () => {
  const loop = nodeNamed('One Client At A Time');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1, 'the batch must be one client for per-client atomicity');
  const [done, loopOut] = conns[loop.name].main;
  assert.equal(loopOut[0].node, 'Send Chase Email', 'work must hang off output 1, not output 0');
  assert.equal(done[0].node, 'Append Run Log', 'output 0 is "done" and should close out the run');
  const returns = Object.entries(conns).filter(([, o]) =>
    o.main.some((b) => (b || []).some((c) => c.node === loop.name)));
  assert.ok(returns.length >= 1, 'nothing loops back, so only the first client is processed');
});

test('each client is recorded before the loop moves on', () => {
  // send -> record the key -> mark the row -> next client. If this ever becomes
  // send-everyone-then-record-everyone, a crash mid-batch loses every record.
  assert.equal(conns['Send Chase Email'].main[0][0].node, 'Rows To Record');
  assert.equal(conns['Rows To Record'].main[0][0].node, 'Append To Sent Log');
  assert.equal(conns['Append To Sent Log'].main[0][0].node, 'Carry Rows');
  assert.equal(conns['Carry Rows'].main[0][0].node, 'Mark Invoice Chased');
  assert.equal(conns['Mark Invoice Chased'].main[0][0].node, 'One Client At A Time');
});

test('a failed send skips that client and continues with the rest', () => {
  const send = nodeNamed('Send Chase Email');
  assert.equal(send.onError, 'continueErrorOutput');
  // The error branch returns to the loop without passing through the recording
  // steps, so a failed send is never marked as sent and is retried tomorrow.
  assert.equal(conns['Send Chase Email'].main[1][0].node, 'One Client At A Time');
});

test('no node reads $json straight after a node that replaces its output', () => {
  const replacing = new Set(['n8n-nodes-base.emailSend', 'n8n-nodes-base.wait', 'n8n-nodes-base.googleSheets']);
  const byName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));
  for (const [src, outs] of Object.entries(conns)) {
    if (!replacing.has(byName[src]?.type)) continue;
    for (const branch of outs.main) {
      for (const c of branch || []) {
        const code = byName[c.node]?.parameters?.jsCode;
        if (!code) continue;
        assert.doesNotMatch(code, /(^|[^'"\w])\$json\b/,
          `${c.node} reads $json after ${src}, whose output is a service response`);
      }
    }
  }
});

test('the sheet update matches on row_number only', () => {
  const update = nodeNamed('Mark Invoice Chased');
  assert.equal(update.parameters.operation, 'update');
  assert.deepEqual(update.parameters.columns.matchingColumns, ['row_number'],
    'matching on a business column silently uses only the first of several');
});

test('every Google Sheets node declares its operation explicitly', () => {
  for (const n of workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) {
    assert.ok(n.parameters.operation, `${n.name} has no operation and would default to read`);
  }
});

test('no client-facing email carries the n8n attribution footer', () => {
  for (const n of workflow.nodes.filter((x) => x.type === 'n8n-nodes-base.emailSend')) {
    assert.equal(n.parameters.options.appendAttribution, false, n.name);
  }
});

test('the public hold endpoint is authenticated', () => {
  const hook = nodeNamed('Hold Today Webhook');
  assert.equal(hook.parameters.authentication, 'headerAuth',
    'an unauthenticated URL can stop the practice chasing anyone');
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

test('the write-back node builds one row per invoice from the loop item', () => {
  const rows = runCodeNode(nodeNamed('Rows To Record').parameters.jsCode, {
    nodeOutputs: {
      'One Client At A Time': [{
        realRecipient: 'ap@acme.co.uk', sentOn: '2026-09-15',
        writeBacks: [
          { rowNumber: 2, invoiceNumber: 'INV-1', stage: 'friendly', key: 'INV-1|friendly' },
          { rowNumber: 3, invoiceNumber: 'INV-2', stage: 'firm', key: 'INV-2|firm' },
        ],
      }],
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].json.rowNumber, 2);
  assert.equal(rows[0].json['Last Chase Stage'], 'friendly');
  assert.equal(rows[0].json['Last Chased On'], '2026-09-15');
  assert.equal(rows[0].json['Idempotency Key'], 'INV-1|friendly');
  assert.equal(rows[1].json['Idempotency Key'], 'INV-2|firm');
});
