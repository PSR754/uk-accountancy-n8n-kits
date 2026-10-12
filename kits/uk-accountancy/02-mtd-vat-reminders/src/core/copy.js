import { formatUKDate, formatUKDateShort } from './dates.js';
import { toneFor, toneRank } from './rules.js';

/**
 * Build the client-facing reminder for one contact and all their VAT periods.
 *
 * Rules this copy obeys:
 *  - It reminds and asks for information. It does not state penalty amounts,
 *    rates or legal consequences, because those change and are not this kit's
 *    to assert. The practice adds its own engagement wording if it wants it.
 *  - The due date and the number of days go in the first lines.
 *  - It never says the practice has submitted, filed or paid anything, and it
 *    never submits anything itself.
 *  - The checklist asks about records and reconciliations. It is a prompt, not
 *    advice on what MTD requires of a particular business.
 *  - Every email says how to reach a person, and carries the fraud warning that
 *    makes a spoofed payment-details email easier for a client to spot.
 */
const LABELS = {
  advance: 'Advance notice',
  reminder: 'Reminder',
  urgent: 'Urgent reminder',
  final: 'Final reminder',
};

export const CHECKLIST = [
  'Every sales and purchase invoice for the period, and any credit notes, is recorded in your accounting software.',
  'Your bank, card and cash accounts are reconciled up to the end of the period.',
  'Any adjustments, such as corrections to earlier returns, are recorded.',
  'If you use more than one program or spreadsheet, figures pass between them digitally and are not retyped by hand.',
  'Anything we have asked you for, such as missing invoices or receipts, has been sent to us.',
];

function whenPhrase(days) {
  if (days <= 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `${days} days to go`;
}

/** The tone of an email is set by its most urgent deadline. */
export function toneOfGroup(deadlines) {
  return deadlines.reduce((best, d) => {
    const t = toneFor(d.milestone);
    return toneRank(t) > toneRank(best) ? t : best;
  }, 'advance');
}

export function buildEmail({ clientName, deadlines, config }) {
  const tone = toneOfGroup(deadlines);
  const label = LABELS[tone];
  const multiple = deadlines.length > 1;
  const nearest = deadlines.reduce((a, b) => (a.daysUntilDue <= b.daysUntilDue ? a : b));

  const schedule = deadlines
    .map((d) => `  Period ended ${formatUKDateShort(d.periodEnd)}: return due ${formatUKDate(d.dueDate)} (${whenPhrase(d.daysUntilDue)})`)
    .join('\n');

  const subject = multiple
    ? `${label}: ${deadlines.length} VAT returns due, the first ${formatUKDate(nearest.dueDate)}`
    : `${label}: VAT return due ${formatUKDate(nearest.dueDate)}`;

  let opening;
  let ask;
  if (tone === 'advance') {
    opening = multiple ? 'This is an early reminder of these upcoming VAT return deadlines:' : 'This is an early reminder of your upcoming VAT return deadline:';
    ask = 'Please work through the checklist, and send us anything that is still outstanding when you can.';
  } else if (tone === 'reminder') {
    opening = multiple ? 'This is a reminder of these VAT return deadlines:' : 'This is a reminder of your VAT return deadline:';
    ask = 'If we are still waiting on anything from you, please send it as soon as you can so that there is time to deal with it before the date.';
  } else if (tone === 'urgent') {
    opening = multiple ? 'These VAT return deadlines are now close:' : 'Your VAT return deadline is now close:';
    ask = 'If we are still waiting on anything from you, please send it to us within the next few days.';
  } else {
    opening = multiple ? 'These VAT return deadlines are imminent:' : 'Your VAT return deadline is imminent:';
    ask = 'If we are still waiting on anything from you, please contact us today.';
  }

  const notes = [
    'Any VAT payment is due by the same date, so please allow time for it to reach HMRC. If you pay by Direct Debit, HMRC collects it 3 working days after the deadline, but the return itself must still be in by the date above.',
  ];
  for (const d of deadlines) {
    if (d.deadlineFallsOn === 'weekend' || d.deadlineFallsOn === 'bank holiday') {
      notes.push(`${formatUKDate(d.dueDate)} is a ${d.deadlineFallsOn === 'weekend' ? 'weekend' : 'bank holiday'}. HMRC does not move the deadline for weekends or bank holidays, so please do not leave it until then.`);
    }
  }

  const parts = [
    `Dear ${clientName},`, '',
    opening, '',
    schedule, '',
    ...notes, '',
    `To get ${multiple ? 'these returns' : 'your return'} ready in time, please check that:`,
    ...CHECKLIST.map((c) => `  - ${c}`), '',
    ask, '',
    'Once everything is in place, let us know and we will prepare the return for your approval.',
    'If you have already told us everything is ready, thank you, and please ignore this message.',
    '', 'Kind regards,', config.signOffName || config.senderName, config.firmName,
    '', '—', footer(config),
  ];

  return { subject, body: parts.join('\n'), tone };
}

function footer(config) {
  const contact = config.firmPhone
    ? `If anything here looks wrong, please call us on ${config.firmPhone} before replying.`
    : 'If anything here looks wrong, please contact us before replying.';
  return [
    `${config.firmName}`,
    contact,
    'We will never ask you to change the bank details you pay us into by email. If you receive such a request, telephone us on a number you already hold before acting on it.',
  ].join('\n');
}

/** The internal pre-send digest: what will go out, and how to stop it. */
export function buildDigest({
  actions, skipped, runDate, config, haltReason, configWarning, rulesNote, confirmations = [], notices = [],
}) {
  const count = actions.length;

  const lines = actions.map((a) => {
    const refs = a.deadlines
      .map((d) => `period ended ${formatUKDateShort(d.periodEnd)}, due ${formatUKDate(d.dueDate)}`)
      .join('; ');
    return `  ${a.tone.toUpperCase().padEnd(8)} ${a.clientName} (${refs}) → ${a.realRecipient}`;
  });

  const body = [
    `VAT reminder run for ${formatUKDate(runDate)}.`,
    '',
    haltReason
      ? `NOTHING WILL BE SENT: ${haltReason}.`
      : count === 0
        ? 'No reminders are due today. No emails will be sent.'
        : `${count} email${count === 1 ? '' : 's'} will be sent at 09:00:`,
    '',
    ...lines,
    '',
    config.dryRun
      ? `DRY RUN IS ON. Nothing will reach a client. Every email above will be delivered to ${config.dryRunRecipient} instead. A dry run records no reminder as sent, so the same reminders will be planned again tomorrow, and the first live run will send whatever is due then.`
      : 'These will go to the real recipients above.',
  ];

  if (configWarning) body.push('', `Setting to check: ${configWarning}`);
  if (rulesNote) body.push('', `Rules to check: ${rulesNote}`);

  if (confirmations.length) {
    body.push('', config.dryRun
      ? `${confirmations.length} submitted return${confirmations.length === 1 ? '' : 's'} would be added to the Submission Log (not in a dry run).`
      : `${confirmations.length} submitted return${confirmations.length === 1 ? '' : 's'} will be added to the Submission Log, and reminders for ${confirmations.length === 1 ? 'it' : 'them'} stop.`);
  }

  if (count > 0) {
    body.push('', "To stop today's run, type today's date (YYYY-MM-DD) in the Hold Until cell of the Run Control tab (row 2) before 09:00.");
  }

  if (skipped.length) {
    const grouped = {};
    for (const s of skipped) grouped[s.reason] = (grouped[s.reason] || 0) + 1;
    body.push('', 'Not reminded today:');
    for (const [reason, n] of Object.entries(grouped).sort()) {
      body.push(`  ${n} × ${reason}`);
    }
  }

  const needsAttention = skipped.filter((s) => s.needsAttention);
  if (needsAttention.length) {
    body.push('', 'Rows that need your attention in the sheet:');
    for (const s of needsAttention) {
      body.push(`  row ${s.rowNumber}: ${s.label || '(no client)'} — ${s.reason}`);
    }
  }

  if (notices.length) {
    body.push('', 'For your information:');
    for (const n of notices) body.push(`  row ${n.rowNumber}: ${n.label || '(no client)'} — ${n.message}`);
  }

  body.push('', 'This kit only sends reminders. It never submits a VAT return, and never pays anything to HMRC.');

  return {
    subject: `VAT reminder preview: ${count} email${count === 1 ? '' : 's'} at 09:00${config.dryRun ? ' (dry run)' : ''}`,
    body: body.join('\n'),
  };
}
