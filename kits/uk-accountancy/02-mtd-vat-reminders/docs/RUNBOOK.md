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
| Rows Read | How many client rows it saw. A sudden drop means a sheet problem |
| Upcoming | How many open VAT returns had not yet passed their deadline |
| Emails Planned | How many emails that run intended to send |
| Submissions Logged | How many returns marked `Submitted` were added to the `Submission Log` that day |
| Emails Sent | How many went to clients and were recorded |
| Dry Run Sends | How many went to you instead, in dry run. Not recorded |
| Sent Not Recorded | Emails that went but could not be recorded. Check the Sent Log |
| Emails Failed | How many sends failed. You are also emailed |
| Skipped | Rows not reminded about, for any reason |
| Dry Run | `true` means nothing reached a client |
| Note | `ok`, or the reason the run sent nothing |
| Failures | Client, address and error for each send that could not be confirmed, or was sent but not recorded |

---

## No Run Log row at all for today

The workflow did not run. In order of likelihood:

1. **The workflow is not active.** Open n8n, check the toggle on the workflow.
   This is the most common cause by a long way.
2. **n8n is not running.** Check the instance is up.
3. **The schedule is wrong.** The triggers are set to weekdays only. Weekends
   are expected to be silent. On a bank holiday the run happens but does nothing.

## Note says "not a sending day"

Working as intended. Weekends, bank holidays in your chosen division, and
24 December to 1 January are all silent by design. Change with `SEND_ON_WEEKENDS`,
`SEND_ON_BANK_HOLIDAYS`, or the quiet period in `src/core/config.js`. A reminder
that would have fallen on a silent day is sent on the last sending day before it.

## Rows Read is 0, but the sheet has clients in it

The workflow cannot read the sheet the way it expects.

1. **The tab was renamed.** It must be `VAT Clients`.
2. **The sheet id is wrong or unset.** Check `MTD_VAT_CLIENTS_SHEET_ID`.
3. **The Google credential lost access.** Re-authorise it in n8n. If you used a
   personal OAuth client left in "Testing" status, Google revokes the token
   every seven days: use a service account instead, and share the sheet with it.

## Every row is listed as needing attention

A column header was renamed or has a trailing space. The headers must be exactly:
`Client Name`, `Contact Email`, `VAT Period End`, `Submitted`, `VAT Scheme`,
`HMRC Due Date`, `Last Checklist Sent`, `Checklist For Period End`, `Last Checklist On`.
Compare against `templates/VAT Clients.csv`. (`VAT Quarter End`, the older name for
`VAT Period End`, is still understood.)

## Rows Read looks right, but Emails Planned is 0

Open the 08:30 preview email. It lists, at the bottom, every row it did not
remind about and why. Common and correct reasons: more than 21 days to go,
the return is marked Submitted, or that reminder has already been sent.

## The preview lists rows that "need your attention"

These are rows the kit could not use, or should not stay as they are. The reason
is stated per row:

- **No client name, a VAT period end it cannot read, a missing or malformed email,
  an unrecognised `Submitted` word, an unrecognised `VAT Scheme`, an unusable
  `HMRC Due Date`.** Fix the cell and it will be picked up on the next run.
- **"VAT deadline ... passed N days ago and the return is not marked Submitted".**
  The kit will not email a client about a missed deadline, so this needs a person.
  Check with the client and with HMRC, then mark the row `Submitted`, or correct the dates.
- **"Marked Submitted, but the VAT period has not ended yet".** The period end or the
  `Submitted` cell is wrong. Nothing is logged for it until that is fixed.
- **"VAT scheme \"annual accounting\" has a different deadline that this kit does not
  calculate".** The kit never gives such a client a calculated date. Remind them by hand.
- **"Duplicate of another row".** Two rows have the same client and VAT period end.
  One of them is redundant.

## Note says "above the limit"

A run wanted to send more emails than `MAX_EMAILS_PER_RUN`. **Nothing was sent.**
This almost always means the sheet changed unexpectedly, for example a paste
that cleared the `Status` column. Check the sheet first. If the run is genuinely
correct, raise the limit.

## Note says "held by the practice"

The `Hold Until` cell in row 2 of the `Run Control` tab holds today's date. To hold
a day, type that date there before 09:00 (`YYYY-MM-DD`; other date formats are
understood too). The hold applies to that day only. Clear the cell to undo it.

## Note says "no preview email was delivered"

The 09:00 run refuses to send unless the 08:30 run logged that the preview reached
you. Either the preview run failed (the `Run Log` shows Mode `preview failed` and
you are emailed, if your mail is working; check your mail credential) or it did not run. Fix the cause, then run the preview and the send
again in that order.

## Sent Not Recorded is above 0, or the alert says "SENT, NOT RECORDED"

The email reached the client, but writing the `Sent Log` or the `VAT Clients` tab
failed (usually a Google Sheets quota or permission error). Both writes are always
attempted, so if only one failed the other still protects against a repeat. Check
both tabs. If the `VAT Clients` row was not updated **and** the `Sent Log` row is
missing, fix one by hand (the alert names the client), or the same reminder may be
planned again tomorrow. Later clients were still emailed.

## Note says "settings to fix before going live"

With `DRY_RUN=false`, `SENDER_EMAIL` or `PRACTICE_EMAIL` is empty or still an example
address. Nothing is sent. Set both to real addresses. If `PRACTICE_EMAIL` is the one
that is empty, the alert cannot be delivered either, so the run ends red in n8n:
this is the case an Error Workflow exists for.

## An alert says the Run Log row could not be written

The `Run Log` write failed (usually Google Sheets or its credential). It does not
stop the run, and you are alerted instead. If this alert also fails to send, the
run ends red in n8n. **Set an Error Workflow** (workflow settings) that emails you:
it is the safety net for this and for a failed read of the sheet.

## The alert says the 09:00 run "sent nothing"

You are emailed when a send run halts for a reason other than your own hold: no
preview delivered, a bad setting, the send ceiling, or an unusable run date.
Weekends, bank holidays and the Christmas quiet period are silent by design.

## 09:00 sent something different from the preview

The 09:00 run plans again from the live sheet, not from the preview you approved.
An edit between 08:30 and 09:00 changes what goes out. To stop a day, use the hold
cell rather than racing the clock.

## An email failed to send

The `Run Log` row shows `Emails Failed` and the error under `Failures`, and you
are emailed. The send is **unconfirmed**, not necessarily undelivered: a timeout
after the mail server accepted the message may still mean it went, so check your
sent mail. Nothing is recorded for it, so it is planned again on the next working day. Failed sends are not retried automatically, because a timeout can
happen after the mail server accepted the message. Check with your mail provider
if you need to know whether it went.

## The preview says "Setting to check"

`CHECKLIST_MILESTONE_DAYS` was empty or had something in it that is not a whole
number of days between 1 and 366. Unusable entries are ignored, or the default
`21,14,7,3` is used if nothing usable is left. Correct the setting.

## A client says they were reminded after they had sent everything

The email says to ignore it if they have already told you everything is ready, but
the kit cannot know that. Only the `Submitted` cell tells it. Mark the return `Yes`
once it has gone to HMRC, or `On Hold` if you are waiting for something and want
reminders paused. The 08:30 preview exists so a person can catch this on the day.

## A client says they were reminded twice for the same thing

This should be impossible, and is worth investigating rather than dismissing.
Check `Sent Log` for two rows with the same `Idempotency Key`. If you find a
genuine duplicate, that is a defect: capture the two rows and the Run Log
entries for those days before changing anything.

One thing that can look like a duplicate: two rows for the same client whose
contact emails differ (a typo, or a different person). They are treated as two
contacts and each gets one email.

## A client's quarter has rolled on

Change `VAT Period End` to the new period end and set `Submitted` back to `No`
(and clear `HMRC Due Date` if you had typed one). The kit compares the period it
last reminded about (`Checklist For Period End`) with the current one, so a new
period starts a new set of reminders without you having to clear anything.
Alternatively add a new row for the new period and leave the old one as `Yes`.

## An email bounced

Nothing automatic happens. Correct the address in the sheet. The deadline will
be picked up on the next run, at the tightest reminder it has then earned,
because a failed send is never recorded as sent.

## The bank holiday list has run out

The list in `rules/bank-holidays.json` ends at Boxing Day 2028. After that the
kit treats every weekday as a sending day, so it could send on a bank holiday.
Refresh it from gov.uk following `rules/RULES.md`.

## Migrating from the earlier version of this kit

The earlier version used a `VAT Quarter End` column, a `Submitted` column and
`Last Checklist Sent`. Rename `VAT Quarter End` to `VAT Period End` (the old name is
still read, but the new tab headers are the supported ones), add the columns in
`templates/VAT Clients.csv` that are missing, and create the `Sent Log`, `Run Log`,
`Run Control` and `Submission Log` tabs from `templates/`. Because an old
`Last Checklist Sent` value has no `Checklist For Period End` beside it, the kit
does not trust it, so each open return may get one reminder that the earlier
version had already sent, on your first live run.

A dry run does not show you that in advance as a record, because a dry run records
nothing: each day's preview simply shows what would be sent that day. Compare the
preview with what your clients have already received, and mark anything you do not
want repeated as `On Hold` before you switch `DRY_RUN` off.

## Turning it off in a hurry

Switch the workflow off in n8n. That is immediate and total. To stop only
client contact while keeping the daily preview, set `DRY_RUN=true`.

## The email gives a deadline that differs from the client's VAT online account

The kit calculates the date only for a period ending on the last day of a month (one
calendar month and 7 days, so the 7th of the month after next), and HMRC's VAT online
account is the authority (see `rules/RULES.md`: how the month and the 7 days combine is
marked UNVERIFIED). Type the date from the account
into the `HMRC Due Date` column. It overrides the calculation, and the 08:30
preview says when it differs. Then tell whoever maintains the kit, so the rule can
be checked.

## A deadline fell on a weekend or bank holiday and a client asked why it was not moved

HMRC does not move the VAT return or payment deadline for weekends or bank
holidays (gov.uk, Submit a VAT Return). The email says so when it applies. The kit
also never sends a reminder on those days, so the reminder comes forward to the
last working day before the mark.

## A client is on the VAT Annual Accounting Scheme

Their return deadline is not one month and 7 days, so the kit refuses to calculate
it and lists the row as needing attention every day. Set the `VAT Scheme` cell to
`Annual Accounting` so it is explained, and remind them by hand. (If you would
rather it stopped appearing, set `Submitted` to `Not required` for that row.)

## Submitted returns are not appearing in the Submission Log

Only returns marked `Submitted` with a period end in the last 150 days are logged,
once per client and period, and only by the live 09:00 run (a dry run and the 08:30
preview record nothing). If the alert says the `Submission Log` could not be updated,
the tab or the Google credential is the cause. Reminders have already stopped for
those returns, and the next run tries the logging again.

## Note says "the VAT deadline rule in rules/vat-rules.json is missing or unusable"

The rules file was edited or damaged. Nothing is sent, because every date would be
wrong. Restore `rules/vat-rules.json` from the repository, run `npm run build`, and
re-import the workflow.

## The preview says the VAT deadline rules were last checked more than a year ago

Nothing is wrong yet, but a rule that nobody has re-read for a year is a risk. Follow
"How to refresh the VAT rules" in `rules/RULES.md`: re-read the gov.uk pages, update
`validAsOf`, rebuild and re-import.

## A row says the period end is not the last day of a month, and no reminder is sent

The kit does not calculate a deadline for a VAT period that ends part-way through a
month, because the rule for those is not one it can support. Open the client's VAT
online account, and type the due date it shows into the `HMRC Due Date` column. The
next run reminds them from that date. Until then the row is listed in the 08:30
preview every day as needing attention, and nothing is sent. If the period end itself
is a typing mistake, correct `VAT Period End` instead.
