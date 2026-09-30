// Kit 01 (HMRC deadline reminders): the nodes, wiring and Code-node entry points.
// The decision logic itself is bundled from the kit's src/core by lib/bundle.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KITS_ROOT, bundleCore } from '../lib/bundle.js';

export const dir = '01-hmrc-deadline-reminders';

const MODULES = ['dates.js', 'rules.js', 'copy.js', 'config.js', 'plan.js'];

export function build() {
  const KIT = join(KITS_ROOT, dir);

  const CORE_BUNDLE = bundleCore({
    kitDir: KIT,
    modules: MODULES,
    // The gov.uk bank holiday feed is inlined verbatim, so the running workflow
    // uses exactly the file in rules/ and nothing else.
    pre(name, src) {
      if (name !== 'config.js') return src;
      const data = readFileSync(join(KIT, 'rules', 'bank-holidays.json'), 'utf8').trim();
      return src.replace(
        /^import bankHolidayData from [^;]*;\s*$/m,
        () => `const bankHolidayData = ${data};`,
      );
    },
  });

  const BANNER = [
    '// GENERATED FILE. Do not edit this node in the n8n editor.',
    `// Source: kits/uk-accountancy/${dir}/src/core/`,
    '// Rebuild with `npm run build`. CI fails if this drifts from the source.',
  ].join('\n');

  const planNode = `${BANNER}

${CORE_BUNDLE}

// ---- n8n entry point ----
const cfgItem = $('Build Config').first().json;
const config = { ...cfgItem.config };
const mode = cfgItem.mode;
const today = cfgItem.today;

const rows = $('Read Deadlines').all().map((i) => i.json);
// A failed read of the Sent Log or Run Control stops the workflow (those nodes
// do not swallow errors), so by here these are real reads, never a guess.
const sentKeys = $('Read Sent Log').all()
  .map((i) => String(i.json['Idempotency Key'] ?? '').trim())
  .filter(Boolean);
const control = $('Read Run Control').all().map((i) => i.json);
const holdUntil = control.length ? control[0]['Hold Until'] : null;
const runLog = $('Read Run Log').all().map((i) => i.json);

const result = plan({
  rows, today, config, sentKeys, holdUntil, runLog,
  requirePreview: mode === 'send',
  checkAddresses: true,
});

const digest = buildDigest({
  actions: result.actions,
  skipped: result.skipped,
  runDate: today,
  config: withDefaults(config),
  haltReason: result.summary.haltReason,
  configWarning: result.summary.configWarning,
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
// Change a value here, or set it in the environment on a self-hosted instance.

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
  practiceEmail: env('PRACTICE_EMAIL', ''),

  // Days before a due date at which a reminder goes out, e.g. "30,14,7,1".
  // The planner cleans this up and reports it in the preview if it is unusable.
  milestones: env('REMINDER_MILESTONE_DAYS', '30,14,7,1'),
  maxEmailsPerRun: Number(env('MAX_EMAILS_PER_RUN', 50)),

  sendOnWeekends: env('SEND_ON_WEEKENDS', 'false') === 'true',
  sendOnBankHolidays: env('SEND_ON_BANK_HOLIDAYS', 'false') === 'true',
  bankHolidayDivision: env('BANK_HOLIDAY_DIVISION', 'england-and-wales'),

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
} }];`;

  const actionsNode = `${BANNER}

${CORE_BUNDLE}

// Re-planning here keeps the send path and the preview path in exact agreement:
// both are produced by the same function from the same inputs, including the
// hold and the requirement that today's preview was delivered.
const cfgItem = $('Build Config').first().json;
const rows = $('Read Deadlines').all().map((i) => i.json);
const sentKeys = $('Read Sent Log').all()
  .map((i) => String(i.json['Idempotency Key'] ?? '').trim())
  .filter(Boolean);
const control = $('Read Run Control').all().map((i) => i.json);
const holdUntil = control.length ? control[0]['Hold Until'] : null;
const runLog = $('Read Run Log').all().map((i) => i.json);

const result = plan({
  rows, today: cfgItem.today, config: cfgItem.config, sentKeys, holdUntil, runLog,
  requirePreview: true,
  checkAddresses: true,
});

return result.actions.map((a, index) => ({
  json: {
    to: a.to,
    realRecipient: a.realRecipient,
    subject: a.subject,
    body: a.body,
    tone: a.tone,
    clientName: a.clientName,
    // False in dry run: nothing may be recorded, or the real run would think
    // these reminders had already gone.
    record: a.record,
    idempotencyKey: a.idempotencyKeys[0],
    writeBacks: result.writeBacks
      .filter((w) => a.idempotencyKeys.includes(w.idempotencyKey))
      .map((w) => ({
        rowNumber: w.rowNumber,
        clientName: w.clientName,
        deadlineType: w.deadlineType,
        milestone: w.lastReminderSent,
        dueDate: w.remindedForDueDate,
        key: w.idempotencyKey,
      })),
    sentOn: cfgItem.today,
  },
  pairedItem: { item: index },
}));`;

  const writeBackNode = `${BANNER}

// One row per deadline in the email that was just sent. Emitted after the send
// so that a send failure leaves the sheet untouched and the reminder is retried.
// The loop runs one client per iteration, so the loop node's output is this
// client's action. Deliberately not $('Prepare Actions').item: that needs
// paired-item information to survive the email node, which replaces its output
// with the SMTP result, and resolving it is not guaranteed.
const action = $('One Client At A Time').first().json;
return action.writeBacks.map((w, index) => ({
  json: {
    rowNumber: w.rowNumber,
    'Client Name': w.clientName,
    'Deadline Type': w.deadlineType,
    'Last Reminder Sent': w.milestone,
    'Reminded For Due Date': w.dueDate,
    'Last Reminded On': action.sentOn,
    'Idempotency Key': w.key,
    'Sent To': action.realRecipient,
    'Sent At': new Date().toISOString(),
  },
  pairedItem: { item: index },
}));`;

  const markSentNode = `${BANNER}

// The one way back into the loop after a send, whichever way the recording
// went, so a client with several deadline rows re-enters the loop exactly once
// and is counted exactly once. Reads the loop item by name, because the node
// before this is a Sheets write whose output is not the client's row. Sheets
// write nodes are set to continue on error, so a failure arrives here as an
// item carrying an error, not as a second path.
const action = $('One Client At A Time').first().json;
const arrived = $input.all().map((i) => i.json || {});
const bad = arrived.find((i) => i.error || i.ledgerFailed);
let status = 'sent';
let error = '';
if (action.record === false) {
  status = 'sent (dry run)';
} else if (bad) {
  status = 'write_failed';
  const e = bad.error || bad.ledgerError;
  error = String(typeof e === 'string' ? e : ((e && (e.message || e.description)) || 'write failed')).slice(0, 300);
}
return [{
  json: {
    status,
    clientName: action.clientName,
    recipient: action.realRecipient,
    error,
  },
  pairedItem: { item: 0 },
}];`;

  const recordFailureNode = `${BANNER}

// The send failed. Nothing has been recorded, so the reminder is planned again
// on the next working day. The failure is carried to the run summary and the
// practice is alerted, rather than the client silently missing a reminder.
const action = $('One Client At A Time').first().json;
const failed = $input.all()[0];
const err = failed && failed.json ? failed.json.error : null;
const message = typeof err === 'string' ? err : ((err && (err.message || err.description)) || 'send failed');
return [{
  json: {
    status: 'failed',
    clientName: action.clientName,
    recipient: action.realRecipient,
    error: String(message).slice(0, 300),
  },
  pairedItem: { item: 0 },
}];`;

  const summariseNode = `${BANNER}

// One item, one Run Log row, for every kind of run. Counts what the loop
// reports; runs that never reached the loop report zero for everything.
const planned = $('Plan Run').first().json;
const items = $input.all().map((i) => i.json);
const sent = items.filter((i) => i.status === 'sent').length;
const dryRunSends = items.filter((i) => i.status === 'sent (dry run)').length;
const failures = items.filter((i) => i.status === 'failed');
const writeFailures = items.filter((i) => i.status === 'write_failed');
const s = planned.summary;
// A halt is worth an email on the 09:00 run unless it is the practice's own hold.
const haltAlert = planned.mode === 'send' && (s.alertable === true);
const alert = failures.length > 0 || writeFailures.length > 0 || haltAlert;
const note = s.haltReason || s.notSendableReason
  || (failures.length ? failures.length + ' send(s) failed and will be retried on the next run'
    : writeFailures.length ? writeFailures.length + ' email(s) were sent but could not be recorded: check the Sent Log and Deadlines tabs'
      : 'ok');
const line = (f) => f.clientName + ' (' + f.recipient + '): ' + f.error;
const failureText = failures.map((f) => 'NOT SENT ' + line(f))
  .concat(writeFailures.map((f) => 'SENT, NOT RECORDED ' + line(f))).join('\\n');
const parts = [];
if (haltAlert) parts.push('The 09:00 run sent nothing: ' + (s.haltReason || s.notSendableReason) + '.');
if (failures.length) parts.push('These reminders were NOT sent and nothing was recorded for them, so they will be tried again on the next working day:\\n' + failures.map(line).join('\\n'));
if (writeFailures.length) parts.push('These emails WERE sent, but recording them failed. Check the Sent Log and Deadlines tabs before the next run, because a reminder that is not recorded can be planned again:\\n' + writeFailures.map(line).join('\\n'));
return [{
  json: {
    'Run Date': planned.today,
    Mode: planned.mode,
    'Rows Read': s.rowsRead,
    Upcoming: s.upcoming,
    'Emails Planned': s.emails,
    'Emails Sent': sent,
    'Dry Run Sends': dryRunSends,
    'Emails Failed': failures.length,
    'Sent Not Recorded': writeFailures.length,
    Skipped: s.skipped,
    'Dry Run': s.dryRun,
    Note: note,
    Failures: failureText,
    failedCount: failures.length + writeFailures.length,
    alert,
    alertSubject: haltAlert && !failures.length && !writeFailures.length
      ? 'Reminder run on ' + planned.today + ' sent nothing'
      : 'Reminder run on ' + planned.today + ': ' + (failures.length + writeFailures.length) + ' problem(s) with sends',
    alertBody: parts.join('\\n\\n'),
  },
  pairedItem: { item: 0 },
}];`;

  const sheet = (name) => ({ __rl: true, mode: 'name', value: name });
  const doc = () => ({ __rl: true, mode: 'id', value: '={{ $env.HMRC_CLIENT_LIST_SHEET_ID }}' });
  const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };
  // A Sheets read runs once per input item. Each read after the first would
  // otherwise run once per row of the one before it (N x M calls), so they run
  // once. They do not swallow errors: a failed ledger, hold or run-log read must
  // stop the run, never quietly remove the safety it provides.
  const readOnce = { executeOnce: true, alwaysOutputData: true };
  const bool = (left) => ({
    conditions: {
      options: { caseSensitive: true, version: 2 },
      conditions: [{
        id: 'c1', operator: { type: 'boolean', operation: 'true', singleValue: true },
        leftValue: left, rightValue: '',
      }],
      combinator: 'and',
    },
    options: {},
  });

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
      id: 'read-deadlines', name: 'Read Deadlines', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5, position: [180, -60],
      parameters: {
        operation: 'read', documentId: doc(), sheetName: sheet('Deadlines'),
        options: { returnFirstMatch: false },
      },
      ...retry, ...readOnce,
    },
    {
      id: 'read-sent-log', name: 'Read Sent Log', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5, position: [400, -60],
      parameters: { operation: 'read', documentId: doc(), sheetName: sheet('Sent Log'), options: {} },
      ...retry, ...readOnce,
    },
    {
      id: 'read-control', name: 'Read Run Control', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5, position: [620, -60],
      parameters: { operation: 'read', documentId: doc(), sheetName: sheet('Run Control'), options: {} },
      ...retry, ...readOnce,
    },
    {
      id: 'read-run-log', name: 'Read Run Log', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5, position: [840, -60],
      parameters: { operation: 'read', documentId: doc(), sheetName: sheet('Run Log'), options: {} },
      ...retry, ...readOnce,
    },
    {
      id: 'plan', name: 'Plan Run', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1060, -60], parameters: { mode: 'runOnceForAllItems', jsCode: planNode },
      alwaysOutputData: true,
    },
    {
      id: 'route', name: 'Preview or Send', type: 'n8n-nodes-base.switch', typeVersion: 3.2,
      position: [1280, -60],
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
      // No onError: if the preview cannot be delivered the run stops with an
      // error and no "preview" row reaches the Run Log, so the 09:00 send
      // (which requires that row) sends nothing.
      id: 'send-digest', name: 'Email Preview To Practice', type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1, position: [1500, -300],
      parameters: {
        fromEmail: '={{ $(\'Build Config\').first().json.config.senderEmail }}',
        toEmail: '={{ $(\'Build Config\').first().json.practiceEmail }}',
        subject: '={{ $json.digestSubject }}',
        emailFormat: 'text',
        text: '={{ $json.digestBody }}',
        options: { appendAttribution: false },
      },
      retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    },
    {
      id: 'any-emails', name: 'Any Emails To Send', type: 'n8n-nodes-base.if', typeVersion: 2.2,
      position: [1500, -60],
      parameters: {
        conditions: {
          options: { caseSensitive: true, version: 2 },
          conditions: [{
            id: 'c1', operator: { type: 'number', operation: 'gt' },
            leftValue: '={{ $json.actionCount }}', rightValue: 0,
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'prepare', name: 'Prepare Actions', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1720, -120], parameters: { mode: 'runOnceForAllItems', jsCode: actionsNode },
    },
    {
      id: 'loop', name: 'One Client At A Time', type: 'n8n-nodes-base.splitInBatches',
      typeVersion: 3, position: [1940, -120], parameters: { batchSize: 1, options: {} },
    },
    {
      // maxTries 1: an SMTP timeout can happen after the server has accepted
      // the message, so an automatic retry could send a client two copies. A
      // failed send is recorded, alerted, and retried on the next working day.
      id: 'send-reminder', name: 'Send Reminder Email', type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1, position: [2160, 0],
      parameters: {
        fromEmail: '={{ $(\'Build Config\').first().json.config.senderEmail }}',
        toEmail: '={{ $json.to }}',
        subject: '={{ $json.subject }}',
        emailFormat: 'text',
        text: '={{ $json.body }}',
        options: {
          appendAttribution: false,
          replyTo: '={{ $(\'Build Config\').first().json.config.replyToEmail }}',
        },
      },
      retryOnFail: true, maxTries: 1,
      onError: 'continueErrorOutput',
    },
    {
      id: 'record-failure', name: 'Record Failure', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2380, 240], parameters: { mode: 'runOnceForAllItems', jsCode: recordFailureNode },
    },
    {
      id: 'record-sends', name: 'Record This Send', type: 'n8n-nodes-base.if', typeVersion: 2.2,
      position: [2380, -80],
      parameters: bool('={{ $(\'One Client At A Time\').first().json.record }}'),
    },
    {
      id: 'rows-to-write', name: 'Rows To Record', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2600, -160], parameters: { mode: 'runOnceForAllItems', jsCode: writeBackNode },
    },
    {
      id: 'append-sent', name: 'Append To Sent Log', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5, position: [2820, -160],
      parameters: {
        operation: 'append', documentId: doc(), sheetName: sheet('Sent Log'),
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Idempotency Key': '={{ $json["Idempotency Key"] }}',
            'Client Name': '={{ $json["Client Name"] }}',
            'Deadline Type': '={{ $json["Deadline Type"] }}',
            'Reminder Days': '={{ $json["Last Reminder Sent"] }}',
            'Sent To': '={{ $json["Sent To"] }}',
            'Sent At': '={{ $json["Sent At"] }}',
          },
        },
        options: { cellFormat: 'RAW' },
      },
      ...retry, onError: 'continueRegularOutput',
    },
    {
      id: 'carry-rows', name: 'Carry Rows', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [3040, -160],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: [
          BANNER,
          '',
          '// The Sheets append above outputs the rows it appended, not the rows it',
          '// was given, and on failure an item carrying an error. Re-reading the rows',
          '// keeps the update that follows working from the real data, and the flag',
          '// tells the next step whether the Sent Log write worked.',
          "const rows = $('Rows To Record').all();",
          'const failed = $input.all().find((i) => i.json && i.json.error);',
          'const err = failed ? failed.json.error : null;',
          "const message = typeof err === 'string' ? err : ((err && (err.message || err.description)) || '');",
          'return rows.map((item, index) => ({',
          '  json: { ...item.json, ledgerFailed: Boolean(failed), ledgerError: message },',
          '  pairedItem: { item: index },',
          '}));',
        ].join('\n'),
      },
    },
    {
      id: 'ledger-ok', name: 'Sent Log Write Failed', type: 'n8n-nodes-base.if', typeVersion: 2.2,
      position: [3150, -160],
      parameters: bool('={{ $json.ledgerFailed }}'),
    },
    {
      id: 'write-back', name: 'Update Sheet Status', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5, position: [3370, -160],
      parameters: {
        operation: 'update', documentId: doc(), sheetName: sheet('Deadlines'),
        columns: {
          mappingMode: 'defineBelow',
          // Matched on row_number, the one key the node handles reliably. Matching
          // on business columns silently uses only the first of several columns.
          matchingColumns: ['row_number'],
          value: {
            row_number: '={{ $json.rowNumber }}',
            'Last Reminder Sent': '={{ $json["Last Reminder Sent"] }}',
            'Reminded For Due Date': '={{ $json["Reminded For Due Date"] }}',
            'Last Reminded On': '={{ $json["Last Reminded On"] }}',
          },
        },
        options: { cellFormat: 'RAW' },
      },
      ...retry, onError: 'continueRegularOutput',
    },
    {
      id: 'mark-sent', name: 'Mark Sent', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [3590, -80], parameters: { mode: 'runOnceForAllItems', jsCode: markSentNode },
    },
    {
      id: 'summarise', name: 'Summarise Run', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2160, -300], parameters: { mode: 'runOnceForAllItems', jsCode: summariseNode },
      alwaysOutputData: true,
    },
    {
      id: 'log-run', name: 'Append Run Log', type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5, position: [2380, -300],
      parameters: {
        operation: 'append', documentId: doc(), sheetName: sheet('Run Log'),
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Run At': '={{ $now.toISO() }}',
            'Run Date': '={{ $json["Run Date"] }}',
            Mode: '={{ $json.Mode }}',
            'Rows Read': '={{ $json["Rows Read"] }}',
            Upcoming: '={{ $json.Upcoming }}',
            'Emails Planned': '={{ $json["Emails Planned"] }}',
            'Emails Sent': '={{ $json["Emails Sent"] }}',
            'Dry Run Sends': '={{ $json["Dry Run Sends"] }}',
            'Emails Failed': '={{ $json["Emails Failed"] }}',
            'Sent Not Recorded': '={{ $json["Sent Not Recorded"] }}',
            Skipped: '={{ $json.Skipped }}',
            'Dry Run': '={{ $json["Dry Run"] }}',
            Note: '={{ $json.Note }}',
            Failures: '={{ $json.Failures }}',
          },
        },
        options: { cellFormat: 'RAW' },
      },
      executeOnce: true,
      ...retry,
    },
    {
      id: 'any-failures', name: 'Any Failures', type: 'n8n-nodes-base.if', typeVersion: 2.2,
      position: [2380, -480],
      parameters: {
        conditions: {
          options: { caseSensitive: true, version: 2 },
          conditions: [{
            id: 'c1', operator: { type: 'boolean', operation: 'true', singleValue: true },
            leftValue: '={{ $(\'Summarise Run\').first().json.alert }}', rightValue: '',
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'alert', name: 'Alert Practice Of Failures', type: 'n8n-nodes-base.emailSend',
      typeVersion: 2.1, position: [2600, -480],
      parameters: {
        fromEmail: '={{ $(\'Build Config\').first().json.config.senderEmail }}',
        toEmail: '={{ $(\'Build Config\').first().json.practiceEmail }}',
        subject: '={{ $(\'Summarise Run\').first().json.alertSubject }}',
        emailFormat: 'text',
        text: '={{ $(\'Summarise Run\').first().json.alertBody }}',
        options: { appendAttribution: false },
      },
      // No onError: if the alert cannot be delivered the run must end red, not
      // green. The Run Log row is written before this node runs.
      retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    },
    {
      id: 'sticky-1', name: 'How this works', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
      position: [-500, -480], parameters: {
        width: 900, height: 260,
        content: [
          '## HMRC deadline reminders',
          '',
          '**08:30** sends you a preview of what will go out. **09:00** sends it, and only if the preview was delivered.',
          'This kit only sends reminders. It never files or pays anything.',
          '',
          'To stop a day: type that date in the Hold Until cell of the Run Control tab.',
          '',
          'Every decision is made by the `Plan Run` node, which is generated from',
          'the tested source in `src/core/`. Do not edit it here: run `npm run build`',
          'and re-import, or the drift check will flag this workflow.',
          '',
          '**DRY_RUN is on by default.** Nothing reaches a client, and no reminder is recorded as sent, until you set it to `false`.',
        ].join('\n'),
      },
    },
  ];

  const to = (node) => [{ node, type: 'main', index: 0 }];
  const connections = {
    'Preview Schedule 08:30': { main: [to('Mode Preview')] },
    'Mode Preview': { main: [to('Build Config')] },
    'Send Schedule 09:00': { main: [to('Mode Send')] },
    'Mode Send': { main: [to('Build Config')] },
    'Build Config': { main: [to('Read Deadlines')] },
    'Read Deadlines': { main: [to('Read Sent Log')] },
    'Read Sent Log': { main: [to('Read Run Control')] },
    'Read Run Control': { main: [to('Read Run Log')] },
    'Read Run Log': { main: [to('Plan Run')] },
    'Plan Run': { main: [to('Preview or Send')] },
    'Preview or Send': {
      main: [to('Email Preview To Practice'), to('Any Emails To Send'), to('Summarise Run')],
    },
    'Email Preview To Practice': { main: [to('Summarise Run')] },
    'Any Emails To Send': { main: [to('Prepare Actions'), to('Summarise Run')] },
    'Prepare Actions': { main: [to('One Client At A Time')] },
    // Output 0 is "done", output 1 is "loop". Wiring the work to output 0 and
    // forgetting the return edge means only the first client is ever processed.
    'One Client At A Time': { main: [to('Summarise Run'), to('Send Reminder Email')] },
    'Send Reminder Email': { main: [to('Record This Send'), to('Record Failure')] },
    'Record Failure': { main: [to('One Client At A Time')] },
    // In dry run nothing is recorded: the sheet and the Sent Log are untouched.
    'Record This Send': { main: [to('Rows To Record'), to('Mark Sent')] },
    'Rows To Record': { main: [to('Append To Sent Log')] },
    'Append To Sent Log': { main: [to('Carry Rows')] },
    'Carry Rows': { main: [to('Sent Log Write Failed')] },
    // true: the Sent Log write failed, so the sheet update is skipped and the
    // failure is reported. false: carry on and update the Deadlines tab.
    'Sent Log Write Failed': { main: [to('Mark Sent'), to('Update Sheet Status')] },
    'Update Sheet Status': { main: [to('Mark Sent')] },
    'Mark Sent': { main: [to('One Client At A Time')] },
    // Strictly in sequence, so the Run Log row is always written before any
    // alert is attempted, whatever the workflow's execution order setting.
    'Summarise Run': { main: [to('Append Run Log')] },
    'Append Run Log': { main: [to('Any Failures')] },
    'Any Failures': { main: [to('Alert Practice Of Failures')] },
  };

  const workflow = {
    name: 'UK HMRC Deadline Reminders',
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
    tags: ['uk-accountancy', 'hmrc', 'deadlines'],
    meta: { generatedBy: 'scripts/build-workflow.js', builtFrom: 'src/core' },
  };

  return { workflow, nodeCount: nodes.length, coreBytes: CORE_BUNDLE.length };
}
