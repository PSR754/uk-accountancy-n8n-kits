import { formatGBP } from './money.js';
import { formatUKDate } from './dates.js';
import { lpcdaApplies, lpcdaCompensationPence } from './rules.js';

/**
 * Build the client-facing email for one group of overdue invoices.
 *
 * Rules this copy obeys, each of which exists because getting it wrong has a
 * real cost to the practice:
 *  - The Late Payment of Commercial Debts (Interest) Act 1998 covers
 *    business-to-business debts only, so that paragraph never reaches an individual.
 *  - A final notice only refers to earlier reminders when earlier reminders were
 *    actually sent by this system. It never invents a history.
 *  - Every email says how to reach a person, and carries the fraud warning that
 *    makes a spoofed payment-details email easier for a client to spot.
 *  - One ask, stated plainly, with the amount and the date in the first lines.
 */
export function buildEmail({ clientName, clientType, invoices, stage, hasPriorChase, config }) {
  const totalPence = invoices.reduce((sum, i) => sum + i.amountPence, 0);
  const multiple = invoices.length > 1;
  const oldest = invoices.reduce((a, b) => (a.daysOverdue >= b.daysOverdue ? a : b));

  const lines = invoices.map(
    (i) => `  ${i.invoiceNumber} — ${formatGBP(i.amountPence)} — due ${formatUKDate(i.dueDate)} (${i.daysOverdue} day${i.daysOverdue === 1 ? '' : 's'} overdue)`,
  );
  const schedule = lines.join('\n');
  const total = formatGBP(totalPence);
  const greeting = `Dear ${clientName},`;

  let subject;
  let opening;
  let ask;

  if (stage === 'friendly') {
    subject = multiple
      ? `Reminder: ${invoices.length} invoices now overdue — ${total}`
      : `Reminder: invoice ${oldest.invoiceNumber} is now overdue — ${total}`;
    opening = multiple
      ? `Our records show the following invoices are now past their due date:`
      : `Our records show that this invoice is now past its due date:`;
    ask = `If payment is already on its way, thank you and please ignore this message. Otherwise, please arrange payment when you can.`;
  } else if (stage === 'firm') {
    subject = multiple
      ? `Action needed: ${invoices.length} overdue invoices — ${total}`
      : `Action needed: invoice ${oldest.invoiceNumber} — ${total} overdue`;
    opening = `The following ${multiple ? 'invoices remain' : 'invoice remains'} unpaid:`;
    ask = `Please arrange payment within the next 7 days, or contact us if there is a reason for the delay or you would like to discuss a payment plan.`;
  } else {
    subject = multiple
      ? `Final notice: ${invoices.length} overdue invoices — ${total}`
      : `Final notice: invoice ${oldest.invoiceNumber} — ${total} overdue`;
    opening = hasPriorChase
      ? `Despite our earlier reminders, the following ${multiple ? 'invoices remain' : 'invoice remains'} unpaid:`
      : `The following ${multiple ? 'invoices are' : 'invoice is'} significantly overdue:`;
    ask = `Please settle the full amount within 7 days of this notice. If you are unable to, please contact us straight away so we can agree a way forward.`;
  }

  const parts = [greeting, '', opening, '', schedule, '', `Total outstanding: ${total}`, '', ask];

  if (config.mentionLpcda && lpcdaApplies(clientType) && (stage === 'firm' || stage === 'final')) {
    const comp = formatGBP(lpcdaCompensationPence(oldest.amountPence));
    parts.push(
      '',
      `As these are business debts, we are entitled under the Late Payment of Commercial Debts (Interest) Act 1998 to claim statutory interest and a fixed sum of ${comp} per invoice. We would much rather resolve this without doing so.`,
    );
  }

  if (config.paymentInstructions) {
    parts.push('', 'How to pay:', config.paymentInstructions);
  }

  parts.push('', 'Kind regards,', config.signOffName || config.senderName, config.firmName);
  parts.push('', '—', footer(config));

  return { subject, body: parts.join('\n') };
}

function footer(config) {
  const contact = config.firmPhone
    ? `If anything here looks wrong, please call us on ${config.firmPhone} before replying.`
    : `If anything here looks wrong, please contact us before replying.`;
  return [
    `${config.firmName}`,
    contact,
    `We will never ask you to change the bank details you pay us into by email. If you receive such a request, telephone us on a number you already hold before acting on it.`,
  ].join('\n');
}

/** The internal pre-send digest: what will go out, and how to stop it. */
export function buildDigest({ actions, skipped, runDate, config, holdUrl }) {
  const count = actions.length;
  const totalPence = actions.reduce(
    (s, a) => s + a.invoices.reduce((t, i) => t + i.amountPence, 0), 0,
  );

  const lines = actions.map((a) => {
    const amount = formatGBP(a.invoices.reduce((t, i) => t + i.amountPence, 0));
    const refs = a.invoices.map((i) => i.invoiceNumber).join(', ');
    return `  ${a.stage.toUpperCase().padEnd(8)} ${a.clientName} — ${amount} (${refs}) → ${a.realRecipient}`;
  });

  const body = [
    `Chase run for ${formatUKDate(runDate)}.`,
    '',
    count === 0
      ? 'Nothing is due to be chased today. No emails will be sent.'
      : `${count} email${count === 1 ? '' : 's'} will be sent at 09:00, covering ${formatGBP(totalPence)}:`,
    count === 0 ? '' : '',
    ...lines,
    '',
    config.dryRun
      ? `DRY RUN IS ON. Nothing will reach a client. Every email above will be delivered to ${config.dryRunRecipient} instead.`
      : `These will go to the real recipients above.`,
  ];

  if (count > 0 && holdUrl) {
    body.push('', `To stop today's run, open this link before 09:00:`, holdUrl);
  }

  if (skipped.length) {
    const grouped = {};
    for (const s of skipped) grouped[s.reason] = (grouped[s.reason] || 0) + 1;
    body.push('', 'Not chased today:');
    for (const [reason, n] of Object.entries(grouped).sort()) {
      body.push(`  ${n} × ${reason}`);
    }
  }

  const needsAttention = skipped.filter((s) => s.needsAttention);
  if (needsAttention.length) {
    body.push('', 'Rows that need your attention in the sheet:');
    for (const s of needsAttention) {
      body.push(`  row ${s.rowNumber}: ${s.invoiceNumber || '(no invoice number)'} — ${s.reason}`);
    }
  }

  return {
    subject: `Chase preview: ${count} email${count === 1 ? '' : 's'} at 09:00${config.dryRun ? ' (dry run)' : ''}`,
    body: body.join('\n'),
  };
}
