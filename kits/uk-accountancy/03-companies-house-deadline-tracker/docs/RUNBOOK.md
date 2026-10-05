# Runbook

What to do when something looks wrong. Each entry starts from what you would
actually notice, not from an error message you may never see.

## The run is marked as failed in n8n

The workflow stops with an error, after writing the Run Log, when the run halted (no valid practice email, damaged rules file, invalid run date) or when every Companies House lookup failed, which almost always means a wrong or missing API key (401). The Note column and the error message give the reason. A halted run sent nothing and recorded nothing.

## The run failed at "Plan Run" about the Sent Log header

The `Sent Log` tab has data but no column called exactly `Idempotency Key`. Without that column the kit cannot see what it has reported and would repeat everything daily, so it stops. Restore the header from `templates/Sent Log.csv`.

## Large client banks and the 900 second limit

Each company costs about one second (0.6 s pause plus the request), and the workflow's `executionTimeout` is 900 seconds, so the ceiling is roughly 600 to 900 companies per run. Beyond that the run times out part way. Either split the companies across two copies of the workflow on different tabs and schedules, or raise the execution timeout in the workflow settings (and the n8n instance's own maximum). The Companies House limit of 600 requests per five minutes is not the constraint at this pace.

## The Run Log is the first place to look

Every run that gets as far as planning appends one row to the `Run Log` tab,
including runs that did nothing. A run that fails earlier (Sent Log or Companies
tab unreadable, wrong Sent Log header) fails in n8n with no row. A day with no
row at all is itself the signal: look at the execution list.

| Column | What it tells you |
|---|---|
| Run Date | The day the run was for, in UK time |
| Rows Read | How many company rows it saw. A sudden drop means a sheet problem |
| Reminders | How many reminders the run raised |
| Needs Attention | Rows it could not fully use, listed in the digest |
| Skipped | Rows not reminded: paused, not yet in a window, already reminded, or no longer active |
| Lookup Failures | Companies the Companies House request failed for |
| Dry Run | `true` means the digest was a preview and nothing was recorded |
| Digest Planned | Whether a digest was due |
| Digest Sent | `true` only when the digest email was sent. A row is written after the send, so a planned-but-failed send leaves no row for that day and a failed execution in n8n |
| Note | `ok`, or the reason the run stopped short |

---

## No Run Log row at all for today

The workflow did not run.

1. **The workflow is not active.** Open n8n and check the toggle. Most common.
2. **n8n is not running.** Check the instance is up.
3. **The Google credential lost access.** A personal OAuth client left in
   "Testing" status has its token revoked every seven days. Use a service
   account and share the sheet with it.

## Rows Read is 0, but the sheet has companies in it

1. **A header was renamed or has a trailing space.** Compare against
   `templates/Companies.csv`.
2. **The tab was renamed.** It must be `Companies`.
3. **The sheet id is wrong.** Check `COMPANIES_HOUSE_TRACKER_SHEET_ID`.

## Lookup Failures is not 0

Companies House could not be reached or rejected the request for those
companies. The kit carried on with the sheet and marked those dates
**Needs human confirmation**.

- Every company failing: the API key is wrong or missing (check the HTTP Basic
  Auth credential: key as username, empty password), or Companies House is down.
- One company failing: usually a wrong company number. The digest names it.
- Many failing with `429` or "Too Many Requests": you have passed the 600
  requests per five minutes limit. The kit makes one request per company per
  day, one at a time. If you track more than about 500 companies, split them
  across two workflows scheduled apart.

## The digest says "Needs human confirmation"

Working as intended. It appears when a date was not read from the register:
typed into the sheet, calculated from your sheet, or in disagreement with
Companies House. Open the Companies House link under the reminder and check. To
stop the flag, let Companies House supply the date: make sure the company
number is right and the lookup succeeds.

## Human checks the kit cannot make

Check these on the register when they apply to a company:

- **February year end in a leap year (R-03, R-10).** For an accounting reference
  date of 28 February the kit treats it as a month end and gives 30 November
  for a 9-month deadline. If the company's date is really the 28th and not "the
  last day", the true deadline could be 28 November. The Companies House date is
  used whenever the lookup works; only sheet-calculated dates are at risk.
- **The 7-day tolerance (s390).** A company may choose to make its accounts up
  to a date up to 7 days either side of its accounting reference date, so its
  financial year, and the accounting period end the kit assumes, can differ from
  the sheet. The s442 filing deadline is counted from the end of the accounting
  reference period, so s390 does not move that deadline in itself. If the period
  end in your sheet is wrong, though, a date the kit calculates from it will be
  wrong. Enter the real period end in `Next Accounts Period End`, or rely on the
  Companies House date, which stands.
- **Company type** has changed since the period end (s442(6)).
- **Anything marked "Needs human confirmation"**, including 29 February dates.

## The digest shows a date that is wrong

A common cause is the `Last Confirmation Statement Made Up To` cell holding the
due date or the filing date. It must be the confirmation date shown on the last
statement (and on the register as "made up to").

1. Open the Companies House link in the digest and read the dates there.
2. If the register differs from the digest, note which line said where the date
   came from ("Date from"). A date "calculated from your sheet" depends on the
   sheet dates and on the UNVERIFIED rules in `rules/RULES.md`. Correct the sheet
   or enter the register date in `Accounts Due` or `Confirmation Statement Due`.
3. If the register and the digest agree but you believe both are wrong, that is
   a matter for Companies House, not this kit.

## A reminder keeps coming back

After the deadline passes, a reminder repeats every `OVERDUE_REPEAT_DAYS` (7).
It stops when Companies House shows the next due date moving forward, or when
you set `Paused` to `Yes`. If you typed a due date in the sheet and have since
filed, update or clear that cell: the kit uses the earlier of the sheet and
Companies House dates and flags the disagreement.

## The same reminder arrived twice

This can happen after a failure and is by design: the kit prefers a repeat to a
silent gap. If the digest email sent but the `Append To Sent Log` write then
failed, nothing was recorded, so the next run raises the same reminders again.
Check `Sent Log` for two rows with the same `Idempotency Key`. Two rows is a
defect worth investigating; capture both and the Run Log before changing
anything.

## The run failed at "Read Sent Log"

Deliberate. If the Sent Log cannot be read, the kit cannot know what it has
already reported, so it stops rather than repeating everything. Fix the cause
(credential, sheet id, tab name `Sent Log`) and the next run carries on. Nothing
was sent or recorded by the failed run.

## The digest email sent, but the run then failed at "Append To Sent Log"

The error reads "digest sent but Sent Log not written - next run will re-send".
The Run Log is written after the Sent Log, so this case has **no Run Log row**.
The digest itself did reach the practice.


The practice has the digest but nothing was recorded, so the next run raises the
same reminders again. This is intended: a repeat is safer than a gap. The digest
email is attempted once only (no automatic retry), because a retry after a
timeout that had in fact delivered would send a second copy. If you see this,
add the missing rows to `Sent Log` by hand, using the `Idempotency Key` format
`companyNumber|filing|dueDate|band`, if you do not want the repeat.

## Re-running a run by hand on the same day

Dry-run digests and attention-only digests record nothing in the `Sent Log`, so
running the workflow again the same day sends the digest again (to the practice
only, never to a client). A live digest with reminders is recorded, so a manual
re-run after it will not repeat those reminders.

## Run failed: "no company rows were read"

The `Companies` tab is empty, renamed, has wrong headers, or the sheet id in
`Build Config` is wrong. The run fails deliberately so an empty read is not
mistaken for a quiet day.

## No digest arrived, and the Run Log says Digest Planned = false

There was nothing to report. A digest is sent when a reminder is due, or on the
`ATTENTION_DIGEST_WEEKDAY` (Monday by default) if rows need checking.

## Note says "no valid practice email address"

There was something to report but `PRACTICE_EMAIL` (or `DRY_RUN_RECIPIENT` in
dry run) is empty or malformed. Nothing was sent or recorded. Fix it and the
reminders appear on the next run.

## Note says the rules file is missing or invalid

`deadline-rules.json` was edited and is damaged, so the run refused to produce
dates. Restore it from the repository and re-run `npm test`.

## Changing a rule

Deadlines are data in `rules/deadline-rules.json`, with sources in
`rules/RULES.md`. To change one: update the JSON and the register together,
update `validAsOf`, run `npm test` and `npm run build`, and re-import the
workflow. Never edit the number inside a Code node in n8n.

## Turning it off in a hurry

Switch the workflow off in n8n. That is immediate and total. To keep the daily
digest but stop recording reminders, set `DRY_RUN=true`.
