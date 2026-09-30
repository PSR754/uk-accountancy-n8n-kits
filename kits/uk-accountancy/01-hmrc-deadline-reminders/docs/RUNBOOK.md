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
| Rows Read | How many deadline rows it saw. A sudden drop means a sheet problem |
| Upcoming | How many open deadlines had not yet passed |
| Emails Planned | How many emails that run intended to send |
| Emails Sent | How many went to clients and were recorded |
| Dry Run Sends | How many went to you instead, in dry run. Not recorded |
| Sent Not Recorded | Emails that went but could not be recorded. Check the Sent Log |
| Emails Failed | How many sends failed. You are also emailed |
| Skipped | Rows not reminded about, for any reason |
| Dry Run | `true` means nothing reached a client |
| Note | `ok`, or the reason the run sent nothing |
| Failures | Client, address and error for each failed send |

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

## Rows Read is 0, but the sheet has deadlines in it

The workflow cannot read the sheet the way it expects.

1. **The tab was renamed.** It must be `Deadlines`.
2. **The sheet id is wrong or unset.** Check `HMRC_CLIENT_LIST_SHEET_ID`.
3. **The Google credential lost access.** Re-authorise it in n8n. If you used a
   personal OAuth client left in "Testing" status, Google revokes the token
   every seven days: use a service account instead, and share the sheet with it.

## Every row is listed as needing attention

A column header was renamed or has a trailing space. The headers must be exactly:
`Client Name`, `Deadline Type`, `Due Date`, `Contact Email`, `Status`,
`Last Reminder Sent`, `Reminded For Due Date`, `Last Reminded On`. Compare against
`templates/Deadlines.csv`.

## Rows Read looks right, but Emails Planned is 0

Open the 08:30 preview email. It lists, at the bottom, every row it did not
remind about and why. Common and correct reasons: more than 30 days to go,
status is Filed, or that reminder has already been sent.

## The preview lists rows that "need your attention"

These are rows the kit could not use, or should not stay as they are. The reason
is stated per row:

- **No client name, no deadline type, a due date it cannot read, a missing or
  malformed email, an unrecognised status.** Fix the cell and it will be picked up
  on the next run.
- **"Due date passed N days ago and the status is not Filed".** The kit will not
  email a client about a missed deadline, so this needs a person. Deal with it,
  then mark the row `Filed` or `Cancelled`, or correct the date.
- **"Duplicate of another row".** Two rows have the same client, deadline type and
  due date. One of them is redundant.

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
you. Either the preview run failed (check n8n's executions and your mail
credential) or it did not run. Fix the cause, then run the preview and the send
again in that order.

## Sent Not Recorded is above 0, or the alert says "SENT, NOT RECORDED"

The email reached the client, but writing the `Sent Log` or the `Deadlines` tab
failed (usually a Google Sheets quota or permission error). Check both tabs. If
the `Sent Log` row is missing, add it by hand (the alert names the client), or the
same reminder may be planned again tomorrow. Later clients were still emailed.

## Note says "settings to fix before going live"

With `DRY_RUN=false`, `SENDER_EMAIL` or `PRACTICE_EMAIL` is empty or still an example
address. Nothing is sent. Set both to real addresses. If `PRACTICE_EMAIL` is the one
that is empty, the alert cannot be delivered either, so the run ends red in n8n:
this is the case an Error Workflow exists for.

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
are emailed. Nothing is recorded for a failed send, so it is planned again on the
next working day. Failed sends are not retried automatically, because a timeout can
happen after the mail server accepted the message. Check with your mail provider
if you need to know whether it went.

## The preview says "Setting to check"

`REMINDER_MILESTONE_DAYS` was empty or had something in it that is not a whole
number of days between 1 and 366. Unusable entries are ignored, or the default
`30,14,7,1` is used if nothing usable is left. Correct the setting.

## A client says they were reminded after they had sent everything

The reminder says to ignore it if they have already sent everything, but the
kit cannot know that. Only the `Status` cell tells it. Mark the deadline `Filed`
when the work is done, or `On Hold` if you are waiting for something and want
reminders paused. The 08:30 preview exists so a person can catch this on the day.

## A client says they were reminded twice for the same thing

This should be impossible, and is worth investigating rather than dismissing.
Check `Sent Log` for two rows with the same `Idempotency Key`. If you find a
genuine duplicate, that is a defect: capture the two rows and the Run Log
entries for those days before changing anything.

One thing that can look like a duplicate: two rows for the same client whose
contact emails differ (a typo, or a different person). They are treated as two
contacts and each gets one email.

## A deadline was extended, or has moved to next period

Change `Due Date` in the sheet and set `Status` to `Pending`. The kit compares
the date it last reminded about with the current one, so a new date starts a new
set of reminders without you having to clear anything.

## An email bounced

Nothing automatic happens. Correct the address in the sheet. The deadline will
be picked up on the next run, at the tightest reminder it has then earned,
because a failed send is never recorded as sent.

## The bank holiday list has run out

The list in `rules/bank-holidays.json` ends at Boxing Day 2028. After that the
kit treats every weekday as a sending day, so it could send on a bank holiday.
Refresh it from gov.uk following `rules/RULES.md`.

## Migrating from the earlier version of this kit

The earlier version wrote the number of days to go into `Last Reminder Sent`
and had no `Reminded For Due Date` column. Add the two new columns
(`Reminded For Due Date`, `Last Reminded On`) to your `Deadlines` tab, and the
new columns to `Run Log` (see `templates/`). Because the old marker has no due
date beside it, the kit does not trust it, so each open deadline may get one
reminder that the earlier version had already sent, on your first live run.

A dry run does not show you that in advance as a record, because a dry run records
nothing: each day's preview simply shows what would be sent that day. Compare the
preview with what your clients have already received, and mark anything you do not
want repeated as `On Hold` before you switch `DRY_RUN` off.

## Turning it off in a hurry

Switch the workflow off in n8n. That is immediate and total. To stop only
client contact while keeping the daily preview, set `DRY_RUN=true`.
