#!/usr/bin/env node
/**
 * Static checks over n8n workflow files.
 *
 * Every rule here exists because the defect it detects was found in a shipped
 * kit and would not have been caught by reading the JSON, by a JSON-schema
 * check, or by the workflow appearing to run successfully. Each failure mode
 * is silent: the workflow goes green and does nothing, or does the wrong thing.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KITS = join(ROOT, 'kits', 'uk-accountancy');

// Node defaults that bite. These are the values n8n applies when a parameter is
// absent, which is not visible in the exported JSON.
const SHEETS_DEFAULT_OPERATION = 'read';

// Nodes whose output is NOT their input. Reading $json straight after one of
// these gives the service's response, not the row you were working on.
const OUTPUT_REPLACING_NODES = new Set([
  'n8n-nodes-base.emailSend',   // outputs the SMTP transport result
  'n8n-nodes-base.wait',        // outputs whatever entered it, not the current row
]);

/**
 * A Sheets node replaces its input only when it writes: an append or update
 * outputs the rows the API echoed back, not the item it was given. After a
 * read, $json is legitimately the row, so reading it there is correct.
 */
function replacesOutput(node) {
  if (OUTPUT_REPLACING_NODES.has(node.type)) return true;
  return node.type === 'n8n-nodes-base.googleSheets'
    && ['append', 'update', 'appendOrUpdate'].includes(node.parameters?.operation);
}

const rules = [];
const rule = (id, severity, check) => rules.push({ id, severity, check });

rule('sheets-missing-operation', 'error', (wf, add) => {
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.googleSheets') continue;
    if (n.parameters?.operation === undefined) {
      add(n.name, `Google Sheets node has no "operation", so n8n uses its default "${SHEETS_DEFAULT_OPERATION}". If this node is meant to write, it silently reads instead and the run still goes green.`);
    }
  }
});

rule('sheets-multi-column-match', 'error', (wf, add) => {
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.googleSheets') continue;
    const cols = n.parameters?.columns?.matchingColumns;
    if (Array.isArray(cols) && cols.length > 1) {
      add(n.name, `matches on ${cols.length} columns (${cols.join(', ')}), but the Sheets update operation uses only the first. Rows are matched on "${cols[0]}" alone, so the wrong row can be updated. Match on row_number instead.`);
    }
  }
});

rule('json-after-output-replacing-node', 'error', (wf, add) => {
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  for (const [src, outs] of Object.entries(wf.connections || {})) {
    const srcNode = byName[src];
    if (!srcNode || !replacesOutput(srcNode)) continue;
    for (const branch of outs.main || []) {
      for (const conn of branch || []) {
        const target = byName[conn.node];
        if (!target) continue;
        const text = JSON.stringify(target.parameters || {});
        // $json is the previous node's output. After an email send that is the
        // SMTP result; after a Wait it is whatever entered the Wait.
        const bare = text.match(/\$json(?!\s*\.\s*(messageId|accepted|rejected|response|envelope))/);
        if (bare && !/\$\('/.test(text)) {
          add(target.name, `reads $json directly after "${src}", whose output is not the row it received. Reference the source node explicitly, e.g. $('Node Name').item.json. This is why the shipped kits never recorded that a reminder had been sent.`);
        }
      }
    }
  }
});

rule('splitinbatches-wiring', 'error', (wf, add) => {
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.splitInBatches') continue;
    const outs = wf.connections?.[n.name]?.main || [];
    const loopBranch = outs[1] || [];
    if (loopBranch.length === 0) {
      add(n.name, 'nothing is wired to output 1 ("loop"). On a v3 Loop node output 0 is "done" and output 1 is "loop", so work hung off output 0 never sees any item and the run finishes green having processed nothing.');
      continue;
    }
    const returns = Object.entries(wf.connections || {}).some(([, o]) =>
      (o.main || []).some((b) => (b || []).some((c) => c.node === n.name)));
    if (!returns) {
      add(n.name, 'no node loops back into it, so only the first batch is ever processed.');
    }
  }
});

rule('code-node-cardinality', 'error', (wf, add) => {
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.code') continue;
    const mode = n.parameters?.mode || 'runOnceForAllItems';
    const code = n.parameters?.jsCode || '';
    if (mode === 'runOnceForAllItems' && /\$input\s*\.\s*first\s*\(/.test(code)
        && !/\$input\s*\.\s*all\s*\(/.test(code)) {
      add(n.name, 'runs once for all items but reads only $input.first(), so every item after the first is dropped without trace.');
    }
  }
});

rule('email-attribution', 'error', (wf, add) => {
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.emailSend') continue;
    if (n.typeVersion >= 2.1 && n.parameters?.options?.appendAttribution !== false) {
      add(n.name, 'will append "This email was sent automatically with n8n" to a client-facing message, because appendAttribution defaults to true from node version 2.1. Set options.appendAttribution to false.');
    }
  }
});

rule('workflow-settings', 'warning', (wf, add) => {
  const s = wf.settings || {};
  if (s.executionOrder !== 'v1') {
    add('(workflow)', 'settings.executionOrder is not "v1", so branches run in legacy creation order rather than by position on the canvas. Multi-branch workflows can run their steps in an order nobody intended.');
  }
  if (!s.timezone) {
    add('(workflow)', 'no timezone is set, so schedules follow the instance default. A UK kit should pin Europe/London.');
  }
});

rule('no-retry-on-network-nodes', 'warning', (wf, add) => {
  const networked = new Set([
    'n8n-nodes-base.googleSheets', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.emailSend',
  ]);
  for (const n of wf.nodes) {
    if (!networked.has(n.type)) continue;
    if (n.retryOnFail !== true) {
      add(n.name, 'has no retry configured, so one transient API error aborts the whole run.');
    }
  }
});

rule('env-contract', 'warning', (wf, add, ctx) => {
  if (!ctx.envExample) return;
  const declared = [...ctx.envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const text = JSON.stringify(wf);
  // A key counts as read if a node interpolates it directly, or if a Code node
  // that touches $env names it as a string literal, which is how a config node
  // reading through a helper such as env('FIRM_NAME', default) refers to it.
  const codeTouchingEnv = wf.nodes
    .filter((n) => n.type === 'n8n-nodes-base.code' && /\$env/.test(n.parameters?.jsCode || ''))
    .map((n) => n.parameters.jsCode)
    .join('\n');
  for (const key of declared) {
    const referenced = text.includes(`$env.${key}`)
      || text.includes(`$env['${key}']`)
      || new RegExp(`['"\`]${key}['"\`]`).test(codeTouchingEnv);
    if (!referenced) {
      add('(.env.example)', `declares ${key}, but no node reads it. Changing it in .env has no effect, which reads as a working setting that silently does nothing.`);
    }
  }
});

rule('unreferenced-nodes', 'warning', (wf, add) => {
  const targets = new Set();
  for (const o of Object.values(wf.connections || {})) {
    for (const b of o.main || []) for (const c of b || []) targets.add(c.node);
  }
  const triggerish = /Trigger$|trigger$|webhook$|stickyNote$/;
  for (const n of wf.nodes) {
    if (targets.has(n.name)) continue;
    if (wf.connections?.[n.name]) continue;
    if (triggerish.test(n.type)) continue;
    add(n.name, 'is not connected to anything, so it never runs.');
  }
});

function lintFile(path, envExample) {
  const wf = JSON.parse(readFileSync(path, 'utf8'));
  const findings = [];
  for (const r of rules) {
    r.check(wf, (node, message) => findings.push({ ...r, node, message }), { envExample });
  }
  return findings;
}

const only = process.argv.find((a) => a.startsWith('--kit='))?.split('=')[1];
const kits = readdirSync(KITS).filter((d) => existsSync(join(KITS, d, 'workflow.json')))
  .filter((d) => !only || d.includes(only));

let errors = 0;
let warnings = 0;
const lines = [];

for (const kit of kits) {
  const envPath = join(KITS, kit, '.env.example');
  const findings = lintFile(
    join(KITS, kit, 'workflow.json'),
    existsSync(envPath) ? readFileSync(envPath, 'utf8') : null,
  );
  const e = findings.filter((f) => f.severity === 'error').length;
  const w = findings.length - e;
  errors += e; warnings += w;
  lines.push(`\n${e === 0 ? (w === 0 ? 'PASS' : 'WARN') : 'FAIL'}  ${kit}  (${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'})`);
  for (const f of findings) {
    lines.push(`      ${f.severity === 'error' ? 'error  ' : 'warning'} [${f.id}] ${f.node}`);
    lines.push(`              ${f.message}`);
  }
}

console.log(lines.join('\n'));
console.log(`\n${kits.length} workflow${kits.length === 1 ? '' : 's'} checked: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`);

// Only kit 04 is expected to be clean at this point; the others are reported
// for information until they are rebuilt the same way.
if (only && errors > 0) process.exit(1);
if (!only) {
  const kit04 = lintFile(join(KITS, '04-invoice-payment-chasing', 'workflow.json'),
    readFileSync(join(KITS, '04-invoice-payment-chasing', '.env.example'), 'utf8'));
  if (kit04.some((f) => f.severity === 'error')) {
    console.error('\nkit 04 has errors and is the kit under test.');
    process.exit(1);
  }
}
