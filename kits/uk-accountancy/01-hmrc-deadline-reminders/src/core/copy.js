import { formatUKDate } from './dates.js';
import { toneFor, toneRank } from './rules.js';

/**
 * Build the client-facing reminder for one contact and all their deadlines.
 *
 * Rules this copy obeys:
 *  - It reminds and asks for information. It does not state penalty amounts,
 *    rates or legal consequences, because those change and are not this kit's
 *    to assert. The practice adds its own engagement wording if it wants it.
 *  - The due date and the number of days go in the first lines, one ask only.
 *  - It never says the practice has filed, submitted or paid anything.
 *  - Every email says how to reach a person, and carries the fraud warning that
 *    makes a spoofed payment-details email easier for a client to spot.
 */
const LABELS = {
  advance: 'Advance notice',
  reminder: 'Reminder',
  urgent: 'Urgent reminder',
  final: 'Final reminder',
};

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
    .map((d) => `  ${d.deadlineType} — ${formatUKDate(d.dueDate)} (${whenPhrase(d.daysUntilDue)})`)
    .join('\n');

  const subject = multiple
    ? `${label}: ${deadlines.length} deadlines, the first ${formatUKDate(nearest.dueDate)}`
    : `${label}: ${nearest.deadlineType} deadline ${formatUKDate(nearest.dueDate)}`;

  let opening;
  let ask;
  if (tone === 'advance') {
    opening = multiple ? 'This is an early reminder of these upcoming deadlines:' : 'This is an early reminder of an upcoming deadline:';
    ask = 'Please start gathering any records or information we still need from you, and send them over when you can.';
  } else if (tone === 'reminder') {
    opening = multiple ? 'This is a reminder of these upcoming deadlines:' : 'This is a reminder of an upcoming deadline:';
    ask = 'If we are still waiting on anything from you, please send it to us as soon as you can so that there is time to deal with it before the date.';
  } else if (tone === 'urgent') {
    opening = multiple ? 'These deadlines are now close:' : 'This deadline is now close:';
    ask = 'If we are still waiting on anything from you, please send it to us within the next few days.';
  } else {
    opening = multiple ? 'These deadlines are imminent:' : 'This deadline is imminent:';
    ask = 'If we are still waiting on anything from you, please contact us today.';
  }

  const parts = [
    `Dear ${clientName},`, '',
    opening, '',
    schedule, '',
    ask, '',
    'If you have already sent us everything we need, thank you, and please ignore this message.',
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
export function buildDigest({ actions, skipped, runDate, config, haltReason, configWarning }) {
  const count = actions.length;

  const lines = actions.map((a) => {
    const refs = a.deadlines
      .map((d) => `${d.deadlineType} ${formatUKDate(d.dueDate)}`)
      .join('; ');
    return `  ${a.tone.toUpperCase().padEnd(8)} ${a.clientName} (${refs}) → ${a.realRecipient}`;
  });

  const body = [
    `Reminder run for ${formatUKDate(runDate)}.`,
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

  body.push('', 'This kit only sends reminders. It never files or pays anything with HMRC or Companies House.');

  return {
    subject: `Reminder preview: ${count} email${count === 1 ? '' : 's'} at 09:00${config.dryRun ? ' (dry run)' : ''}`,
    body: body.join('\n'),
  };
}
