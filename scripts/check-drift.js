#!/usr/bin/env node
/**
 * Compares the workflow running in n8n against the one committed here.
 *
 * Tests verify the committed file. Production runs whatever is in n8n, and a
 * single well-meant edit in the editor silently replaces a verified build with
 * an untested one. This is the check that notices.
 *
 *   N8N_URL=https://n8n.example.com N8N_API_KEY=... node scripts/check-drift.js
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'kits', 'uk-accountancy', '04-invoice-payment-chasing');

const url = process.env.N8N_URL;
const key = process.env.N8N_API_KEY;
const name = process.env.N8N_WORKFLOW_NAME || 'UK Invoice Payment Chasing (GBP)';

if (!url || !key) {
  console.error('Set N8N_URL and N8N_API_KEY to compare the live workflow with this repo.');
  console.error('Create the key in n8n under Settings, n8n API.');
  process.exit(2);
}

const api = async (path) => {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': key, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
};

/** Compare what actually decides behaviour, not cosmetics like node position. */
const significant = (wf) => ({
  nodes: [...wf.nodes]
    .filter((n) => n.type !== 'n8n-nodes-base.stickyNote')
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((n) => ({
      name: n.name, type: n.type, typeVersion: n.typeVersion,
      parameters: n.parameters, retryOnFail: n.retryOnFail ?? false, onError: n.onError ?? null,
    })),
  connections: wf.connections,
  settings: wf.settings,
});

const committed = JSON.parse(readFileSync(join(KIT, 'workflow.json'), 'utf8'));

const { data } = await api('/workflows?limit=250');
const live = data.find((w) => w.name === name);
if (!live) {
  console.error(`No workflow named "${name}" found in n8n. Nothing to compare.`);
  process.exit(2);
}
const full = await api(`/workflows/${live.id}`);

const a = JSON.stringify(significant(committed), null, 1).split('\n');
const b = JSON.stringify(significant(full), null, 1).split('\n');

if (a.join('\n') === b.join('\n')) {
  console.log(`No drift. The workflow running in n8n matches this repository.`);
  console.log(`Active: ${full.active}`);
  process.exit(0);
}

console.error('DRIFT: the workflow running in n8n differs from the committed, tested one.');
console.error('Someone has edited it in the n8n editor. The version being tested is not the');
console.error('version being run. Re-import workflow.json, or bring the change back into');
console.error('src/core and rebuild.\n');

let shown = 0;
for (let i = 0; i < Math.max(a.length, b.length) && shown < 40; i += 1) {
  if (a[i] !== b[i]) {
    console.error(`  line ${i + 1}`);
    console.error(`    repo: ${(a[i] ?? '(absent)').trim().slice(0, 160)}`);
    console.error(`    live: ${(b[i] ?? '(absent)').trim().slice(0, 160)}`);
    shown += 1;
  }
}
process.exit(1);
