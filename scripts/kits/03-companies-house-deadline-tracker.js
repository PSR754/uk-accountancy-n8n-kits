// Kit 03 (Companies House deadline tracker): the nodes, wiring and Code-node entry points.
// The decision logic itself is bundled from the kit's src/core by lib/bundle.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KITS_ROOT, bundleCore } from '../lib/bundle.js';

export const dir = '03-companies-house-deadline-tracker';

export function build() {
const KIT = join(KITS_ROOT, dir);

// The rules file is injected into the bundled config so the Code node carries
// exactly the values the tests and RULES.md describe.
const withRules = (name, src) => {
  if (name !== 'config.js') return src;
  const rules = readFileSync(join(KIT, 'rules', 'deadline-rules.json'), 'utf8').trim();
  return src.replace(/rules: deadlineRules,/, `rules: ${rules},`);
};

const CORE_BUNDLE = bundleCore({
  kitDir: KIT,
  modules: ['dates.js', 'rules.js', 'companies.js', 'deadlines.js', 'copy.js', 'config.js', 'plan.js'],
  post: withRules,
});
const PREP_BUNDLE = bundleCore({ kitDir: KIT, modules: ['dates.js', 'companies.js'] });

const BANNER = [
  '// GENERATED FILE. Do not edit this node in the n8n editor.',
  '// Source: kits/uk-accountancy/03-companies-house-deadline-tracker/src/core/',
  '// Rebuild with `npm run build`. CI fails if this drifts from the source.',
].join('\n');

const configNode = `${BANNER}

// Everything behavioural is set here, in one visible place. n8n Cloud does not
// expose $env to Code nodes, so every value has a working default: edit it here
// instead. Nothing in this workflow files anything with Companies House or
// emails a client. It emails a digest to the practice.

const env = (k, fallback) => {
  try { return $env[k] !== undefined && $env[k] !== '' ? $env[k] : fallback; }
  catch (e) { return fallback; }
};

const milestones = String(env('REMINDER_MILESTONES', '30,14,7,1'))
  .split(',').map((s) => Number(s.trim()));

const weekday = String(env('ATTENTION_DIGEST_WEEKDAY', '1')).trim().toLowerCase();

const config = {
  firmName: env('FIRM_NAME', 'Your Firm'),
  senderEmail: env('SENDER_EMAIL', 'accounts@example.co.uk'),
  practiceEmail: env('PRACTICE_EMAIL', ''),
  milestones,
  overdueRepeatDays: Number(env('OVERDUE_REPEAT_DAYS', 7)),
  attentionDigestWeekday: weekday === 'off' ? null : Number(weekday),
  includeClientDrafts: env('INCLUDE_CLIENT_DRAFTS', 'true') !== 'false',

  // SAFETY. While this is anything other than the exact string "false", the
  // digest is labelled as a preview and nothing is recorded in the Sent Log.
  dryRun: env('DRY_RUN', 'true') !== 'false',
  dryRunRecipient: env('DRY_RUN_RECIPIENT', env('PRACTICE_EMAIL', '')),
};

// The run date is taken in Europe/London, so a run just after midnight UTC in
// summer is not attributed to the previous day.
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

return [{ json: { today, config, sheetId: env('COMPANIES_HOUSE_TRACKER_SHEET_ID', '') } }];`;

const prepareNode = `${BANNER}

${PREP_BUNDLE}

// ---- n8n entry point ----
// Adds a cleaned company number to each row so the lookup URL is built from the
// same normalisation the planner uses. Every row is kept, including bad ones,
// so the planner can report them.
// Paused and unusable rows skip the lookup.
return $input.all().map((item, index) => {
  const num = normaliseCompanyNumber(item.json['Company Number']);
  const paused = readCompanyRow(item.json, null).paused;
  return {
    json: { ...item.json, _companyNumber: num.number, _needsLookup: num.valid && !paused },
    pairedItem: { item: index },
  };
});`;

const collectNode = `${BANNER}

// Runs once per company. Pairs the sheet row with whatever Companies House
// returned, or with the error object if the lookup failed, so the planner can
// say so instead of the run stopping.
// No fallback: if n8n cannot pair this response with its company the run fails,
// rather than attaching one company's data to another. The planner also checks
// that the response's company number matches the row's.
const row = $('Per Company').item.json;
return { json: { row, api: $json } };`;

const planNode = `${BANNER}

${CORE_BUNDLE}

// ---- n8n entry point ----
const cfgItem = $('Build Config').first().json;

// Each input item is one company: { row, api }. Companies House failures arrive
// as an error object in \`api\`, never as a stopped run.
const companies = $input.all().map((i) => i.json);

// No try/catch: a Sent Log that cannot be read must stop the run, not look empty.
const logCheck = sentLogKeys($('Read Sent Log').all().map((i) => i.json));
if (logCheck.problem) throw new Error(logCheck.problem);
const sentKeys = logCheck.keys;

const result = plan({ companies, today: cfgItem.today, config: cfgItem.config, sentKeys });

return [{
  json: {
    summary: result.summary,
    digestTo: result.summary.digestTo,
    digestSubject: result.digest.subject,
    digestBody: result.digest.body,
    sendDigest: result.summary.sendDigest,
    sentLogRows: result.sentLogRows,
  },
  pairedItem: { item: 0 },
}];`;

const sentRowsNode = `${BANNER}

// Runs only after the digest email has been sent. A failed send therefore
// records nothing, and the same reminders are raised again on the next run.
// In dry run the plan holds no rows, so nothing is written.
// With nothing to record (dry run, or an attention-only digest) it emits one
// marker item so the run still reaches the Run Log; the next node routes it past
// the Sent Log append.
const rows = $('Plan Run').first().json.sentLogRows || [];
if (rows.length === 0) return [{ json: { hasRows: false }, pairedItem: { item: 0 } }];
return rows.map((row) => ({
  json: { ...row, hasRows: true, 'Reported At': new Date().toISOString() },
  pairedItem: { item: 0 },
}));`;

const skipNode = `${BANNER}

// Paused or unusable row: no request is made. The planner reports the row.
return { json: { row: $json, api: null } };`;

const sheet = (name) => ({ __rl: true, mode: 'name', value: name });
// The sheet id is set in Build Config, the one node meant to be edited on n8n Cloud.
const doc = () => ({ __rl: true, mode: 'id', value: "={{ $('Build Config').first().json.sheetId }}" });
const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };

const nodes = [
  {
    id: 'trigger-daily', name: 'Daily Schedule 07:00', type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2, position: [-460, 0],
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 7 }] } },
  },
  {
    id: 'build-config', name: 'Build Config', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [-240, 0], parameters: { mode: 'runOnceForAllItems', jsCode: configNode },
  },
  {
    // executeOnce: this read must run a single time, not once per item it receives.
    id: 'read-sent-log', name: 'Read Sent Log', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [-20, 0],
    parameters: { operation: 'read', documentId: doc(), sheetName: sheet('Sent Log'), options: {} },
    // No onError: if the Sent Log cannot be read the run must fail visibly. Treating it
    // as empty would raise and record every reminder again.
    ...retry, alwaysOutputData: true, executeOnce: true,
  },
  {
    id: 'read-companies', name: 'Read Companies', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [200, 0],
    parameters: { operation: 'read', documentId: doc(), sheetName: sheet('Companies'), options: {} },
    ...retry, alwaysOutputData: true, executeOnce: true,
  },
  {
    id: 'prepare', name: 'Prepare Companies', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [420, 0], parameters: { mode: 'runOnceForAllItems', jsCode: prepareNode },
    alwaysOutputData: true,
  },
  {
    id: 'loop', name: 'Per Company', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3,
    position: [640, 0], parameters: { batchSize: 1, options: {} },
  },
  {
    id: 'if-lookup', name: 'Needs Lookup', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [880, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2 },
        conditions: [{
          id: 'l1', operator: { type: 'boolean', operation: 'true', singleValue: true },
          leftValue: '={{ $json._needsLookup }}', rightValue: '',
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'skip-lookup', name: 'Skip Lookup', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1100, 0], parameters: { mode: 'runOnceForEachItem', jsCode: skipNode },
  },
  {
    // Keeps the run under the 600 requests per five minutes limit (about 100 a minute).
    id: 'rate-wait', name: 'Rate Limit Pause', type: 'n8n-nodes-base.wait', typeVersion: 1.1,
    position: [1100, 240], webhookId: 'k03-rate-pause',
    parameters: { resume: 'timeInterval', amount: 0.6, unit: 'seconds' },
  },
  {
    // A read-only GET. This workflow never writes to Companies House.
    id: 'lookup', name: 'Companies House Lookup', type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2, position: [880, 240],
    parameters: {
      method: 'GET',
      url: "=https://api.company-information.service.gov.uk/company/{{ encodeURIComponent($json._companyNumber || 'invalid') }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBasicAuth',
      options: { timeout: 10000 },
    },
    retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueRegularOutput',
  },
  {
    id: 'collect', name: 'Collect Result', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1320, 240], parameters: { mode: 'runOnceForEachItem', jsCode: collectNode },
  },
  {
    id: 'plan', name: 'Plan Run', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [880, -120], parameters: { mode: 'runOnceForAllItems', jsCode: planNode },
    alwaysOutputData: true,
  },
  {
    id: 'if-digest', name: 'Digest Needed', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1100, -120],
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2 },
        conditions: [{
          id: 'd1', operator: { type: 'boolean', operation: 'true', singleValue: true },
          leftValue: '={{ $json.sendDigest }}', rightValue: '',
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'send-digest', name: 'Email Digest To Practice', type: 'n8n-nodes-base.emailSend',
    typeVersion: 2.1, position: [1320, -200],
    parameters: {
      fromEmail: "={{ $('Build Config').first().json.config.senderEmail }}",
      toEmail: "={{ $('Plan Run').first().json.digestTo }}",
      subject: "={{ $('Plan Run').first().json.digestSubject }}",
      text: "={{ $('Plan Run').first().json.digestBody }}",
      options: { appendAttribution: false },
    },
    // One attempt only: a retry after a timeout that actually delivered would send a duplicate.
    retryOnFail: true, maxTries: 1,
  },
  {
    id: 'rows-to-write', name: 'Rows For Sent Log', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [1540, -200], parameters: { mode: 'runOnceForAllItems', jsCode: sentRowsNode },
  },
  {
    id: 'append-sent', name: 'Append To Sent Log', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [1860, -200],
    parameters: {
      operation: 'append', documentId: doc(), sheetName: sheet('Sent Log'),
      columns: {
        mappingMode: 'defineBelow',
        value: {
          'Idempotency Key': '={{ $json["Idempotency Key"] }}',
          'Company Number': '={{ $json["Company Number"] }}',
          'Company Name': '={{ $json["Company Name"] }}',
          'Deadline Type': '={{ $json["Deadline Type"] }}',
          'Due Date': '={{ $json["Due Date"] }}',
          Band: '={{ $json.Band }}',
          'Reported On': '={{ $json["Reported On"] }}',
          'Reported At': '={{ $json["Reported At"] }}',
        },
      },
      options: {},
    },
    ...retry,
    // If the write still fails after retries the digest has already gone out.
    onError: 'continueErrorOutput',
  },
  {
    id: 'if-rows', name: 'Has Rows To Record', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1640, -200],
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2 },
        conditions: [{
          id: 'h1', operator: { type: 'boolean', operation: 'true', singleValue: true },
          leftValue: '={{ $json.hasRows }}', rightValue: '',
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'stop-sentlog', name: 'Sent Log Write Failed', type: 'n8n-nodes-base.stopAndError', typeVersion: 1,
    position: [2000, -60],
    parameters: { errorType: 'errorMessage', errorMessage: 'Companies House tracker: digest sent but Sent Log not written - next run will re-send the same reminders to the practice. No Run Log row was written. Add the missing Sent Log rows by hand to prevent the repeat.' },
  },
  {
    id: 'log-run', name: 'Append Run Log', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [1320, 40],
    parameters: {
      operation: 'append', documentId: doc(), sheetName: sheet('Run Log'),
      columns: {
        mappingMode: 'defineBelow',
        value: {
          'Run At': '={{ $now.toISO() }}',
          'Run Date': "={{ $('Plan Run').first().json.summary.runDate }}",
          'Rows Read': "={{ $('Plan Run').first().json.summary.rowsRead }}",
          Reminders: "={{ $('Plan Run').first().json.summary.reminders }}",
          'Needs Attention': "={{ $('Plan Run').first().json.summary.attention }}",
          Skipped: "={{ $('Plan Run').first().json.summary.skipped }}",
          'Lookup Failures': "={{ $('Plan Run').first().json.summary.lookupFailures }}",
          'Dry Run': "={{ $('Plan Run').first().json.summary.dryRun }}",
          'Digest Sent': 'false',
          'Digest Planned': "={{ $('Plan Run').first().json.summary.sendDigest }}",
          Note: "={{ $('Plan Run').first().json.summary.failReason || 'ok' }}",
        },
      },
      options: {},
    },
    ...retry,
  },
  {
    id: 'log-run-sent', name: 'Append Run Log After Send', type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5, position: [2100, -300], executeOnce: true,
    parameters: {
      operation: 'append', documentId: doc(), sheetName: sheet('Run Log'),
      columns: {
        mappingMode: 'defineBelow',
        value: {
          'Run At': '={{ $now.toISO() }}',
          'Run Date': "={{ $('Plan Run').first().json.summary.runDate }}",
          'Rows Read': "={{ $('Plan Run').first().json.summary.rowsRead }}",
          Reminders: "={{ $('Plan Run').first().json.summary.reminders }}",
          'Needs Attention': "={{ $('Plan Run').first().json.summary.attention }}",
          Skipped: "={{ $('Plan Run').first().json.summary.skipped }}",
          'Lookup Failures': "={{ $('Plan Run').first().json.summary.lookupFailures }}",
          'Dry Run': "={{ $('Plan Run').first().json.summary.dryRun }}",
          'Digest Sent': 'true',
          'Digest Planned': "={{ $('Plan Run').first().json.summary.sendDigest }}",
          Note: "={{ $('Plan Run').first().json.summary.failReason || 'ok' }}",
        },
      },
      options: {},
    },
    ...retry,
  },
  {
    id: 'if-fail', name: 'Run Needs Attention', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [1760, 40],
    parameters: {
      conditions: {
        options: { caseSensitive: true, version: 2 },
        conditions: [{
          id: 'f1', operator: { type: 'boolean', operation: 'true', singleValue: true },
          leftValue: "={{ $('Plan Run').first().json.summary.failRun }}", rightValue: '',
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    // Makes a halted run, or a run where every Companies House lookup failed, fail
    // visibly in n8n's execution list instead of finishing green.
    id: 'stop-fail', name: 'Stop And Report', type: 'n8n-nodes-base.stopAndError', typeVersion: 1,
    position: [1980, 40],
    parameters: { errorType: 'errorMessage', errorMessage: "={{ 'Companies House tracker: ' + $('Plan Run').first().json.summary.failReason }}" },
  },
  {
    id: 'sticky-1', name: 'How this works', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [-500, -340], parameters: {
      width: 900, height: 220,
      content: [
        '## Companies House deadline tracker',
        '',
        'Once a day this checks each company in your sheet against Companies House',
        '(read only) and emails **your practice** a digest of deadlines that are',
        'approaching or overdue. It never files anything and never emails a client:',
        'any client wording is a draft inside the digest for a person to review.',
        '',
        'Every decision is made by `Plan Run`, generated from the tested source in',
        '`src/core/`. Do not edit it here: run `npm run build` and re-import.',
        '',
        '**DRY_RUN is on by default.** The digest is marked as a preview and nothing is recorded.',
      ].join('\\n'),
    },
  },
];

const link = (node) => ({ node, type: 'main', index: 0 });

const connections = {
  'Daily Schedule 07:00': { main: [[link('Build Config')]] },
  'Build Config': { main: [[link('Read Sent Log')]] },
  'Read Sent Log': { main: [[link('Read Companies')]] },
  'Read Companies': { main: [[link('Prepare Companies')]] },
  'Prepare Companies': { main: [[link('Per Company')]] },
  // Output 0 is "done", output 1 is "loop". The lookup is wired to output 1 and
  // returns to the loop; the planner runs once, from output 0, when every
  // company has been looked up. Wiring the lookup to output 0 is why the
  // previous version of this kit never contacted Companies House.
  'Per Company': { main: [[link('Plan Run')], [link('Needs Lookup')]] },
  'Needs Lookup': { main: [[link('Companies House Lookup')], [link('Skip Lookup')]] },
  'Skip Lookup': { main: [[link('Per Company')]] },
  'Companies House Lookup': { main: [[link('Rate Limit Pause')]] },
  'Rate Limit Pause': { main: [[link('Collect Result')]] },
  'Collect Result': { main: [[link('Per Company')]] },
  'Plan Run': { main: [[link('Digest Needed')]] },
  'Digest Needed': { main: [[link('Email Digest To Practice')], [link('Append Run Log')]] },
  // The Run Log row for a run that sent is written only after the send succeeds,
  // so a planned-but-failed send leaves no row and a failed execution.
  // Structural order, not canvas position: the Sent Log is written before the Run
  // Log and before anything that can stop the run, so a run that fails after a
  // successful send (for example every lookup failed) still records its reminders.
  'Email Digest To Practice': { main: [[link('Rows For Sent Log')]] },
  'Rows For Sent Log': { main: [[link('Has Rows To Record')]] },
  'Has Rows To Record': { main: [[link('Append To Sent Log')], [link('Append Run Log After Send')]] },
  'Append To Sent Log': { main: [[link('Append Run Log After Send')], [link('Sent Log Write Failed')]] },
  'Append Run Log': { main: [[link('Run Needs Attention')]] },
  'Append Run Log After Send': { main: [[link('Run Needs Attention')]] },
  'Run Needs Attention': { main: [[link('Stop And Report')], []] },
};

const workflow = {
  name: 'UK Companies House Deadline Tracker',
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
  tags: ['uk-accountancy', 'companies-house'],
  meta: { generatedBy: 'scripts/build-workflow.js', builtFrom: 'src/core' },
};

return { workflow, nodeCount: nodes.length, coreBytes: CORE_BUNDLE.length };
}
