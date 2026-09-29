# Runbook

What to do when something looks wrong. Each entry starts from what you would
actually notice, not from an error message you may never see.

## The Run Log is the first place to look

Every run appends one row to the `Run Log` tab, including runs that did nothing.
That is deliberate: a day with no row at all is itself the signal.

| Column | What it tells you |
|---|---|
| Run Date | The day the run was for, in UK time |
| Mode | `preview` for the 08:30 run, `send` for 09:00 |
| Rows Read | How many invoice rows it saw. A sudden drop means a sheet problem |
| Overdue | How many were past their due date and unpaid |
| Emails Planned | How many emails that run intended to send |
| Skipped | Rows not chased, for any reason |
| Dry Run | `true` means nothing reached a client |
| Note | `ok`, or the reason the run sent nothing |

---

## No Run Log row at all for today

The workflow did not run. In order of likelihood:

1. **The workflow is not active.** Open n8n, check the toggle on the workflow.
   This is the most common cause by a long way.
2. **n8n is not running.** Check the instance is up.
3. **The schedule is wrong.** The triggers are set to weekdays only. Weekends
   and bank holidays are expected to be silent.

## Note says "not a sending day"

Working as intended. Weekends, England and Wales bank holidays, and 24 December
to 1 January are all silent by design. Change with `SEND_ON_WEEKENDS`,
`SEND_ON_BANK_HOLIDAYS`, or the quiet period in the Build Config node.

## Rows Read is 0, but the sheet has invoices in it

The workflow cannot read the sheet the way it expects.

1. **A column header was renamed or has a trailing space.** The headers must be
   exactly: `Invoice Number`, `Client`, `Client Email`, `Client Type`,
   `Amount GBP`, `Due Date`, `Status`, `Last Chase Stage`, `Last Chased On`,
   `Activation Date`. Compare against `templates/Invoices.csv`.
2. **The tab was renamed.** It must be `Invoices`.
3. **The Google credential lost access.** Re-authorise it in n8n. If you used a
   personal OAuth client left in "Testing" status, Google revokes the token
   every seven days: use a service account instead, and share the sheet with it.

## Rows Read looks right, but Emails Planned is 0

Open the 08:30 preview email. It lists, at the bottom, every row it did not
chase and why. Common and correct reasons: not yet overdue, already at that
stage, status is Paid, or chased too recently.

## The preview lists rows that "need your attention"

These are rows the kit could not use. The reason is stated per row. Usually one
of: no invoice number, an amount that is not a number, a due date it cannot
read, a missing or malformed email address, or a `Client Type` that is not
`Business` or `Individual`. Fix the cell and it will be picked up on the next run.

## Note says "above the limit"

A run wanted to send more emails than `MAX_EMAILS_PER_RUN`. **Nothing was sent.**
This almost always means the sheet changed unexpectedly, for example a paste
that cleared the `Status` column. Check the sheet first. If the run is genuinely
correct, raise the limit.

## Note says "held by the practice"

Someone clicked the hold link in the 08:30 preview. The hold applies to that day
only. Clear the `Hold Until` cell in the `Run Control` tab to undo it.

## A client says they were chased after paying

1. Check the `Status` cell for that invoice. The kit stops the moment it reads
   `Paid`, but it can only read what is in the sheet at 09:00.
2. Check `Sent Log` for when the email actually went. If it was sent before the
   sheet was updated, the kit behaved correctly and the sheet was behind.

This is the failure mode with the highest cost to a client relationship, and the
only real defence is keeping the sheet current. The 08:30 preview exists so a
person can catch it on the day.

## A client says they were chased twice for the same thing

This should be impossible, and is worth investigating rather than dismissing.
Check `Sent Log` for two rows with the same `Idempotency Key`. If you find a
genuine duplicate, that is a defect: capture the two rows and the Run Log
entries for those days before changing anything.

## An email bounced

Nothing automatic happens yet. Correct the address in the sheet. The invoice
will be picked up on the next run, at the same stage, because a failed send is
never recorded as sent.

## Turning it off in a hurry

Switch the workflow off in n8n. That is immediate and total. To stop only
client contact while keeping the daily preview, set `DRY_RUN=true`.
