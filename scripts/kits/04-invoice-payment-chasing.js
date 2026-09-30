// Kit 04 (invoice payment chasing): the nodes, wiring and Code-node entry points.
// The decision logic itself is bundled from the kit's src/core by lib/bundle.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KITS_ROOT, bundleCore } from '../lib/bundle.js';

export const dir = '04-invoice-payment-chasing';

export function build() {
const KIT = join(KITS_ROOT, dir);
const MODULES = ['dates.js', 'money.js', 'rules.js', 'copy.js', 'config.js', 'plan.js'];
const CORE_BUNDLE = bundleCore({
  kitDir: KIT,
  modules: MODULES,
  post(name, src) {
    if (name !== 'config.js') return src;
    const holidays = readFileSync(join(KIT, 'rules', 'bank-holidays.json'), 'utf8').trim();
    return src.replace(/bankHolidays,/, `bankHolidays: ${holidays},`);
  },
});

const BANNER = [
  '// GENERATED FILE. Do not edit this node in the n8n editor.',
  '// Source: kits/uk-accountancy/04-invoice-payment-chasing/src/core/',
  '// Rebuild with `npm run build`. CI fails if this drifts from the source.',
].join('\n');

const planNode = `${BANNER}

${CORE_BUNDLE}

// ---- n8n entry point ----
const cfgItem = $('Build Config').first().json;
const config = { ...cfgItem.config };
const mode = cfgItem.mode;
const today = cfgItem.today;

const rows = $('Read Invoices').all().map((i) => i.json);
let sentKeys = [];
try {
  sentKeys = $('Read Sent Log').all()
    .map((i) => String(i.json['Idempotency Key'] ?? '').trim())
    .filter(Boolean);
} catch (e) {
  sentKeys = [];
}

let hold = null;
try {
  const control = $('Read Run Control').all().map((i) => i.json);
  hold = control.length ? String(control[0]['Hold Until'] ?? '').trim() : null;
} catch (e) {
  hold = null;
}

const result = plan({ rows, today, config, sentKeys });

if (hold && hold === today) {
  result.summary.halted = true;
  result.summary.haltReason = 'run held by the practice from the preview email';
  result.actions = [];
  result.writeBacks = [];
}

const digest = buildDigest({
  actions: result.actions,
  skipped: result.skipped,
  runDate: today,
  config,
  holdUrl: cfgItem.holdUrl,
});

return [{
  json: {
    mode,
    today,
    summary: result.summary,
    skipped: result.skipped,
    digestSubject: digest.subject,
    digestBody: digest.body,
    actionCount: result.actions.length,
    sendable: result.summary.sendableDay && !result.summary.halted,
  },
  pairedItem: { item: 0 },
}];`;

const configNode = `${BANNER}

// Everything behavioural lives here, in one visible place, rather than being
// read from the environment inside individual nodes. n8n Cloud does not expose
// $env to Code nodes, so a kit that depends on it cannot run there at all.
// Change a value here, or override it from the workflow's own settings.

const env = (k, fallback) => {
  try { return $env[k] !== undefined && $env[k] !== '' ? $env[k] : fallback; }
  catch (e) { return fallback; }
};

const config = {
  firmName: env('FIRM_NAME', 'Your Firm'),
  senderName: env('SENDER_NAME', 'Accounts'),
  senderEmail: env('SENDER_EMAIL', 'accounts@example.co.uk'),
  replyToEmail: env('REPLY_TO_EMAIL', env('SENDER_EMAIL', 'accounts@example.co.uk')),
  firmPhone: env('FIRM_PHONE', ''),
  signOffName: env('SIGN_OFF_NAME', ''),
  paymentInstructions: env('PAYMENT_INSTRUCTIONS', ''),

  thresholds: {
    friendly: Number(env('CHASE_FRIENDLY_DAYS', 7)),
    firm: Number(env('CHASE_FIRM_DAYS', 30)),
    final: Number(env('CHASE_FINAL_DAYS', 60)),
  },
  minDaysBetweenChases: Number(env('MIN_DAYS_BETWEEN_CHASES', 7)),
  maxEmailsPerRun: Number(env('MAX_EMAILS_PER_RUN', 50)),

  sendOnWeekends: env('SEND_ON_WEEKENDS', 'false') === 'true',
  sendOnBankHolidays: env('SEND_ON_BANK_HOLIDAYS', 'false') === 'true',
  mentionLpcda: env('MENTION_LATE_PAYMENT_ACT', 'true') === 'true',

  // SAFETY. While this is true, no client can receive anything: every email is
  // delivered to dryRunRecipient instead. Leave it on until a full week of
  // previews has been read and judged correct.
  dryRun: env('DRY_RUN', 'true') !== 'false',
  dryRunRecipient: env('DRY_RUN_RECIPIENT', env('PRACTICE_EMAIL', '')),
};

// The run date is taken in Europe/London, so a run just after midnight UTC in
// summer is not attributed to the previous day.
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

const mode = $json.mode || 'send';

return [{ json: {
  mode,
  today,
  config,
  practiceEmail: env('PRACTICE_EMAIL', ''),
  holdUrl: env('HOLD_URL', ''),
} }];`;

const actionsNode = `${BANNER}

${CORE_BUNDLE}

// Re-planning here keeps the send path and the preview path in exact agreement:
// both are produced by the same function from the same inputs.
const cfgItem = $('Build Config').first().json;
const rows = $('Read Invoices').all().map((i) => i.json);
let sentKeys = [];
try {
  sentKeys = $('Read Sent Log').all()
    .map((i) => String(i.json['Idempotency Key'] ?? '').trim())
    .filter(Boolean);
} catch (e) { sentKeys = []; }

const result = plan({ rows, today: cfgItem.today, config: cfgItem.config, sentKeys });

return result.actions.map((a, index) => ({
  json: {
    to: a.to,
    realRecipient: a.realRecipient,
    subject: a.subject,
    body: a.body,
    stage: a.stage,
    clientName: a.clientName,
    idempotencyKey: a.idempotencyKeys[0],
    writeBacks: a.invoices.map((i) => ({
      rowNumber: i.rowNumber,
      invoiceNumber: i.invoiceNumber,
      stage: i.stage,
      key: \`\${i.invoiceNumber}|\${i.stage}\`,
    })),
    sentOn: cfgItem.today,
  },
  pairedItem: { item: index },
}));`;

const writeBackNode = `${BANNER}

// One row per invoice in the email that was just sent. Emitted after the send
// so that a send failure leaves the sheet untouched and the invoice is retried.
// The loop runs one client per iteration, so the loop node's output is this
// client's action. Deliberately not $('Prepare Actions').item: that needs
// paired-item information to survive the email node, which replaces its output
// with the SMTP result, and resolving it is not guaranteed.
const action = $('One Client At A Time').first().json;
return action.writeBacks.map((w, index) => ({
  json: {
    rowNumber: w.rowNumber,
    'Invoice Number': w.invoiceNumber,
    'Last Chase Stage': w.stage,
    'Last Chased On': action.sentOn,
    'Idempotency Key': w.key,
    'Sent To': action.realRecipient,
    'Sent At': new Date().toISOString(),
  },
  pairedItem: { item: index },
}));`;

const sheet = (name) => ({ __rl: true, mode: 'name', value: name });
const doc = () => ({ __rl: true, mode: 'id', value: '={{ $env.INVOICE_TRACKER_SHEET_ID }}' });

const nodes = [
  {
    id: 'trigger-preview', name: 'Preview Schedule 08:30', type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2, position: [-460, -160],
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 8 * * 1-5' }] } },
  },
  {
    id: 'set-preview', name: 'Mode Preview', type: 'n8n-nodes-base.set', typeVersion: 3.4,
    position: [-260, -160],
    parameters: { assignments: { assignments: [{ id: 'm', name: 'mode', value: 'preview', type: 'string' }] }, options: {} },
  },
  {
    id: 'trigger-send', name: 'Send Schedule 09:00', type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2, position: [-460, 40],
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * 1-5' }] } },
  },
  {
    id: 'set-send', name: 'Mode Send', type: 'n8n-nodes-base.set', typeVersion: 3.4,
    position: [-260, 40],
    parameters: { assignments: { assignments: [{ id: 'm', name: 'mode', value: 'send', type: 'string' }] }, options: {} },
  },
  {
    id: 'build-config', name: 'Build Config', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [-40, -60], parameters: { mode: 'runOnceForAllItems', jsCode: configNode },
  },
  {
    id: 'read-invoices', name: 'Read Invoices', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [180, -60],
    parameters: {
      operation: 'read', documentId: doc(), sheetName: sheet('Invoices'),
      options: { returnFirstMatch: false },
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  },
  {
    id: 'read-sent-log', name: 'Read Sent Log', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [180, 120],
    parameters: { operation: 'read', documentId: doc(), sheetName: sheet('Sent Log'), options: {} },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    onError: 'continueRegularOutput', alwaysOutputData: true,
  },
  {
    id: 'read-control', name: 'Read Run Control', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [180, 300],
    parameters: { operation: 'read', documentId: doc(), sheetName: sheet('Run Control'), options: {} },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    onError: 'continueRegularOutput', alwaysOutputData: true,
  },
  {
    id: 'plan', name: 'Plan Run', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [420, -60], parameters: { mode: 'runOnceForAllItems', jsCode: planNode },
    alwaysOutputData: true,
  },
  {
    id: 'route', name: 'Preview or Send', type: 'n8n-nodes-base.switch', typeVersion: 3.2,
    position: [640, -60],
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, version: 2 },
              conditions: [{
                id: 'c1', operator: { type: 'string', operation: 'equals' },
                leftValue: '={{ $json.mode }}', rightValue: 'preview',
              }],
              combinator: 'and',
            },
            renameOutput: true, outputKey: 'preview',
          },
          {
            conditions: {
              options: { caseSensitive: true, version: 2 },
              conditions: [
                {
                  id: 'c2', operator: { type: 'string', operation: 'equals' },
                  leftValue: '={{ $json.mode }}', rightValue: 'send',
                },
                {
                  id: 'c3', operator: { type: 'boolean', operation: 'true', singleValue: true },
                  leftValue: '={{ $json.sendable }}', rightValue: '',
                },
              ],
              combinator: 'and',
            },
            renameOutput: true, outputKey: 'send',
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'nothing to do' },
    },
  },
  {
    id: 'send-digest', name: 'Email Preview To Practice', type: 'n8n-nodes-base.emailSend',
    typeVersion: 2.1, position: [900, -240],
    parameters: {
      fromEmail: '={{ $(\'Build Config\').first().json.config.senderEmail }}',
      toEmail: '={{ $(\'Build Config\').first().json.practiceEmail }}',
      subject: '={{ $json.digestSubject }}',
      text: '={{ $json.digestBody }}',
      options: { appendAttribution: false },
    },
    retryOnFail: true, maxTries: 2, onError: 'continueRegularOutput',
  },
  {
    id: 'prepare', name: 'Prepare Actions', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [900, -20], parameters: { mode: 'runOnceForAllItems', jsCode: actionsNode },
    alwaysOutputData: true,
  },
  {
    id: 'loop', name: 'One Client At A Time', type: 'n8n-nodes-base.splitInBatches',
    typeVersion: 3, position: [1120, -20], parameters: { batchSize: 1, options: {} },
  },
  {
    id: 'send-chase', name: 'Send Chase Email', type: 'n8n-nodes-base.emailSend',
    typeVersion: 2.1, position: [1340, 100],
    parameters: {
      fromEmail: '={{ $(\'Build Config\').first().json.config.senderEmail }}',
      toEmail: '={{ $json.to }}',
      subject: '={{ $json.subject }}',
      text: '={{ $json.body }}',
      options: {
        appendAttribution: false,
        replyTo: '={{ $(\'Build Config\').first().json.config.replyToEmail }}',
      },
    },
    retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    onError: 'continueErrorOutput',
  },
  {
    id: 'rows-to-write', name: 'Rows To Record', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1560, 100], parameters: { mode: 'runOnceForAllItems', jsCode: writeBackNode },
  },
  {
    id: 'append-sent', name: 'Append To Sent Log', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [1780, 100],
    parameters: {
      operation: 'append', documentId: doc(), sheetName: sheet('Sent Log'),
      columns: {
        mappingMode: 'defineBelow',
        value: {
          'Idempotency Key': '={{ $json["Idempotency Key"] }}',
          'Invoice Number': '={{ $json["Invoice Number"] }}',
          Stage: '={{ $json["Last Chase Stage"] }}',
          'Sent To': '={{ $json["Sent To"] }}',
          'Sent At': '={{ $json["Sent At"] }}',
        },
      },
      options: {},
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  },
  {
    id: 'carry-rows', name: 'Carry Rows', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1890, 100],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: [
        BANNER,
        '',
        '// The Sheets append above outputs the rows it appended, not the rows it',
        '// was given. Re-reading them here keeps the update that follows working',
        '// from the real data rather than from whatever the API echoed back.',
        "return $('Rows To Record').all().map((item, index) => ({",
        '  json: item.json,',
        '  pairedItem: { item: index },',
        '}));',
      ].join('\n'),
    },
  },
  {
    id: 'write-back', name: 'Mark Invoice Chased', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [2110, 100],
    parameters: {
      operation: 'update', documentId: doc(), sheetName: sheet('Invoices'),
      columns: {
        mappingMode: 'defineBelow',
        // Matched on row_number, the one key the node handles reliably. Matching
        // on a business column silently uses only the first of several columns.
        matchingColumns: ['row_number'],
        value: {
          row_number: '={{ $json.rowNumber }}',
          'Last Chase Stage': '={{ $json["Last Chase Stage"] }}',
          'Last Chased On': '={{ $json["Last Chased On"] }}',
        },
      },
      options: {},
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  },
  {
    id: 'log-run', name: 'Append Run Log', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [1340, -240],
    parameters: {
      operation: 'append', documentId: doc(), sheetName: sheet('Run Log'),
      columns: {
        mappingMode: 'defineBelow',
        value: {
          'Run At': '={{ $now.toISO() }}',
          'Run Date': '={{ $(\'Plan Run\').first().json.today }}',
          Mode: '={{ $(\'Plan Run\').first().json.mode }}',
          'Rows Read': '={{ $(\'Plan Run\').first().json.summary.rowsRead }}',
          Overdue: '={{ $(\'Plan Run\').first().json.summary.overdue }}',
          'Emails Planned': '={{ $(\'Plan Run\').first().json.summary.emails }}',
          Skipped: '={{ $(\'Plan Run\').first().json.summary.skipped }}',
          'Dry Run': '={{ $(\'Plan Run\').first().json.summary.dryRun }}',
          Note: '={{ $(\'Plan Run\').first().json.summary.haltReason || $(\'Plan Run\').first().json.summary.notSendableReason || "ok" }}',
        },
      },
      options: {},
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  },
  {
    id: 'hold-webhook', name: 'Hold Today Webhook', type: 'n8n-nodes-base.webhook',
    typeVersion: 2, position: [-460, 420], webhookId: 'k04-hold-today',
    parameters: {
      httpMethod: 'GET', path: 'kit04-hold-today', responseMode: 'lastNode',
      // Header auth, because anything on a public URL that can change what the
      // practice sends is worth authenticating even when the blast radius is
      // only "today's chase run does not go out".
      authentication: 'headerAuth',
      options: {},
    },
  },
  {
    id: 'hold-write', name: 'Record Hold', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [-200, 420],
    parameters: {
      operation: 'appendOrUpdate', documentId: doc(), sheetName: sheet('Run Control'),
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['row_number'],
        value: {
          row_number: '2',
          'Hold Until': "={{ $now.setZone('Europe/London').toISODate() }}",
          'Set By': '={{ $json.query.by || "preview link" }}',
          'Set At': '={{ $now.toISO() }}',
        },
      },
      options: {},
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
  },
  {
    id: 'hold-reply', name: 'Confirm Hold', type: 'n8n-nodes-base.set', typeVersion: 3.4,
    position: [40, 420],
    parameters: {
      assignments: { assignments: [{
        id: 'msg', name: 'message', type: 'string',
        value: "=Today's chase run is on hold. No invoice emails will be sent today. Clear the Hold Until cell in the Run Control tab to undo this.",
      }] },
      options: {},
    },
  },
  {
    id: 'sticky-1', name: 'How this works', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-500, -420], parameters: {
      width: 900, height: 220,
      content: [
        '## Invoice chasing',
        '',
        '**08:30** sends you a preview of what will go out. **09:00** sends it.',
        '',
        'Every decision is made by the `Plan Run` node, which is generated from',
        'the tested source in `src/core/`. Do not edit it here: run `npm run build`',
        'and re-import, or the nightly drift check will flag this workflow.',
        '',
        '**DRY_RUN is on by default.** Nothing reaches a client until you set it to `false`.',
      ].join('\\n'),
    },
  },
];

const connections = {
  'Preview Schedule 08:30': { main: [[{ node: 'Mode Preview', type: 'main', index: 0 }]] },
  'Mode Preview': { main: [[{ node: 'Build Config', type: 'main', index: 0 }]] },
  'Send Schedule 09:00': { main: [[{ node: 'Mode Send', type: 'main', index: 0 }]] },
  'Mode Send': { main: [[{ node: 'Build Config', type: 'main', index: 0 }]] },
  'Build Config': { main: [[{ node: 'Read Invoices', type: 'main', index: 0 }]] },
  'Read Invoices': { main: [[{ node: 'Read Sent Log', type: 'main', index: 0 }]] },
  'Read Sent Log': { main: [[{ node: 'Read Run Control', type: 'main', index: 0 }]] },
  'Read Run Control': { main: [[{ node: 'Plan Run', type: 'main', index: 0 }]] },
  'Plan Run': { main: [[{ node: 'Preview or Send', type: 'main', index: 0 }]] },
  'Preview or Send': {
    main: [
      [{ node: 'Email Preview To Practice', type: 'main', index: 0 }],
      [{ node: 'Prepare Actions', type: 'main', index: 0 }],
      [{ node: 'Append Run Log', type: 'main', index: 0 }],
    ],
  },
  'Email Preview To Practice': { main: [[{ node: 'Append Run Log', type: 'main', index: 0 }]] },
  'Prepare Actions': { main: [[{ node: 'One Client At A Time', type: 'main', index: 0 }]] },
  // Output 0 is "done", output 1 is "loop". Wiring the API call to output 0 and
  // forgetting the return edge is why kit 03 never contacted Companies House.
  'One Client At A Time': {
    main: [
      [{ node: 'Append Run Log', type: 'main', index: 0 }],
      [{ node: 'Send Chase Email', type: 'main', index: 0 }],
    ],
  },
  'Send Chase Email': {
    main: [
      [{ node: 'Rows To Record', type: 'main', index: 0 }],
      [{ node: 'One Client At A Time', type: 'main', index: 0 }],
    ],
  },
  'Rows To Record': { main: [[{ node: 'Append To Sent Log', type: 'main', index: 0 }]] },
  'Append To Sent Log': { main: [[{ node: 'Carry Rows', type: 'main', index: 0 }]] },
  'Carry Rows': { main: [[{ node: 'Mark Invoice Chased', type: 'main', index: 0 }]] },
  'Mark Invoice Chased': { main: [[{ node: 'One Client At A Time', type: 'main', index: 0 }]] },
  'Hold Today Webhook': { main: [[{ node: 'Record Hold', type: 'main', index: 0 }]] },
  'Record Hold': { main: [[{ node: 'Confirm Hold', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'UK Invoice Payment Chasing (GBP)',
  nodes,
  connections,
  active: false,
  settings: {
    executionOrder: 'v1',
    timezone: 'Europe/London',
    saveDataSuccessExecution: 'none',
    saveDataErrorExecution: 'all',
    saveManualExecutions: true,
    saveExecutionProgress: true,
    executionTimeout: 900,
  },
  tags: ['uk-accountancy', 'credit-control'],
  meta: { generatedBy: 'scripts/build-workflow.js', builtFrom: 'src/core' },
};

return { workflow, nodeCount: nodes.length, coreBytes: CORE_BUNDLE.length };
}
