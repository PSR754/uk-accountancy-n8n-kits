#!/usr/bin/env node
/**
 * Generates each rebuilt kit's workflow.json from its tested core.
 *
 * The workflow is a build artefact, never hand-edited. The JavaScript inside
 * its Code nodes is the same source the test suite exercises, concatenated
 * rather than rewritten, so there is no gap between what was verified and what
 * runs in production. `--check` fails if a committed file has drifted, which
 * is what stops an edit made in the n8n editor from quietly becoming the truth.
 *
 *   node scripts/build-workflow.js            build every rebuilt kit
 *   node scripts/build-workflow.js --check    fail if any is out of date
 *   node scripts/build-workflow.js --kit=01   only kits whose folder name contains "01"
 *
 * Each kit's nodes and wiring live in scripts/kits/<kit-folder>.js.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KITS_ROOT } from './lib/bundle.js';
import * as kit01 from './kits/01-hmrc-deadline-reminders.js';
import * as kit02 from './kits/02-mtd-vat-reminders.js';
import * as kit04 from './kits/04-invoice-payment-chasing.js';

const BUILDERS = [kit01, kit02, kit04];

const only = process.argv.find((a) => a.startsWith('--kit='))?.split('=')[1];
const check = process.argv.includes('--check');
let stale = 0;

for (const builder of BUILDERS.filter((b) => !only || b.dir.includes(only))) {
  const { workflow, nodeCount, coreBytes } = builder.build();
  const out = join(KITS_ROOT, builder.dir, 'workflow.json');
  const json = `${JSON.stringify(workflow, null, 2)}\n`;

  if (check) {
    let current = null;
    try { current = readFileSync(out, 'utf8'); } catch { current = null; }
    if (current !== json) {
      stale += 1;
      console.error(`${builder.dir}: workflow.json is out of date with src/core.`);
    } else {
      console.log(`${builder.dir}: workflow.json matches src/core`);
    }
  } else {
    writeFileSync(out, json);
    console.log(`built ${out} (${nodeCount} nodes, core bundle ${coreBytes} bytes)`);
  }
}

if (stale > 0) {
  console.error('The committed workflow no longer matches the code the tests verify.');
  console.error('Run `npm run build` and commit the result.');
  process.exit(1);
}
