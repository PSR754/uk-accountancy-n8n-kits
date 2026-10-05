// Wording. Plain text, UK English, no emoji. Everything addressed to the
// practice is a digest; anything addressed to a client is a draft that a person
// reads and sends from their own mailbox. This kit sends no client email.

import { formatUKDate } from './dates.js';
import { KIND_LABEL } from './rules.js';

const REGISTER_URL = 'https://find-and-update.company-information.service.gov.uk/company/';

function dueWords(days) {
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} OVERDUE`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

export function sourceLabel(source) {
  if (source === 'companies-house') return 'Companies House';
  if (source === 'sheet') return 'typed into your sheet';
  if (source === 'calculated') return 'calculated from your sheet';
  return 'unknown';
}

/** A draft message for a person to review and send. Never sent by the workflow. */
export function buildClientDraft(item, config) {
  const plural = item.kind === 'accounts';
  const what = plural ? 'annual accounts' : 'confirmation statement';
  const was = plural ? 'were' : 'was';
  const is = plural ? 'are' : 'is';
  const lines = [
    `Subject: ${item.companyName || 'Your company'}: ${what} due ${formatUKDate(item.dueDate)}`,
    '',
    ...(item.needsConfirmation ? ['[STAFF: this date has not been confirmed against the Companies House register. Confirm it, then delete this line, before sending.]', ''] : []),
    'Dear client,',
    '',
    item.days < 0
      ? `Our records show that the ${what} for ${item.companyName || 'your company'} (company number ${item.companyNumber}) ${was} due on ${formatUKDate(item.dueDate)} and may now be overdue.`
      : `Our records show that the ${what} for ${item.companyName || 'your company'} (company number ${item.companyNumber}) ${is} due at Companies House on ${formatUKDate(item.dueDate)}.`,
    '',
    item.days < 0
      ? 'Please get in touch as soon as you can so that we can arrange what is needed.'
      : 'Please get in touch as soon as you can so that we can arrange what is needed before the deadline.',
    '',
    'Kind regards,',
    config.firmName || 'Your Firm',
  ];
  return lines.join('\n');
}

export function buildDigest({ reminders, attention, runDate, config, summary }) {
  const prefix = config.dryRun ? '[DRY RUN] ' : '';
  const needCheck = reminders.filter((r) => r.needsConfirmation).length;
  const subject = `${prefix}Companies House deadlines: ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}`
    + `${attention.length ? `, ${attention.length} to check` : ''} (${formatUKDate(runDate)})`;

  const out = [];
  if (config.dryRun) {
    out.push('DRY RUN. This is a preview. Nothing has been recorded, so the same reminders will appear again until dry run is switched off.');
  }
  out.push('Nothing has been filed with Companies House and nothing has been sent to any client. This is a list for your team to act on.');
  out.push('');

  out.push(`REMINDERS (${reminders.length})`);
  if (reminders.length === 0) out.push('None today.');
  for (const r of reminders) {
    out.push('');
    out.push(`${r.companyName || '(no name)'} (${r.companyNumber}) - ${KIND_LABEL[r.kind]}`);
    out.push(`  Deadline: ${formatUKDate(r.dueDate)}, ${dueWords(r.days)}`);
    out.push(`  Date from: ${sourceLabel(r.source)}`);
    out.push(`  Check on the register: ${REGISTER_URL}${r.companyNumber}`);
    if (r.needsConfirmation) {
      for (const f of r.flags) out.push(`  NEEDS HUMAN CONFIRMATION: ${f}`);
    }
    if (r.draft) {
      out.push('  Draft client message (not sent, edit before use):');
      out.push(`  To: ${r.draftTo || '(no valid contact email in the sheet)'}`);
      for (const line of r.draft.split('\n')) out.push(`  | ${line}`);
    }
  }

  if (attention.length) {
    out.push('');
    out.push(`NEEDS YOUR ATTENTION (${attention.length})`);
    for (const a of attention) {
      out.push(`- ${a.companyName || '(no name)'}${a.companyNumber ? ` (${a.companyNumber})` : ''}: ${a.reason}`);
    }
  }

  out.push('');
  out.push(`Checked ${summary.rowsRead} row${summary.rowsRead === 1 ? '' : 's'}; ${summary.skipped} not reminded (paused, not yet in a reminder window, already reminded or no longer on the register).`);
  if (needCheck) out.push(`${needCheck} reminder${needCheck === 1 ? '' : 's'} above need${needCheck === 1 ? 's' : ''} human confirmation before anyone relies on the date.`);
  if (config.configWarnings && config.configWarnings.length) {
    out.push('');
    for (const w of config.configWarnings) out.push(`Configuration note: ${w}`);
  }
  out.push('');
  out.push('Deadlines are worked out from published GOV.UK guidance and the Companies House record. They are not legal advice. Confirm on the register before relying on any date.');
  return { subject, body: out.join('\n') };
}
