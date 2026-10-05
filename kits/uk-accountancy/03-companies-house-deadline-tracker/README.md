# Companies House deadline tracker

**Never miss a confirmation statement or accounts deadline for a client company again.**

- **Who it is for:** UK practices that look after limited companies and keep
  their client list in a Google Sheet.
- **What it does:** checks each company's accounts and confirmation statement
  deadlines against the Companies House register, and emails **your practice**
  one daily digest of what is approaching or overdue.
- **What it does not do:** it drafts for review; it never files or submits
  anything, and never emails a client.

**It never files anything, never writes to Companies House, and never emails a
client.** Where a client message would help, the digest includes a draft for a
person to read, edit and send from their own mailbox.

Rules last checked against GOV.UK on **5 October 2026** (see `rules/RULES.md`).

---

## See it work in 5 minutes

1. Open `templates/Companies.csv`. It holds three made-up companies
   (all on `example.co.uk` addresses) that you can import into a Google Sheet to
   see the layout. `Sent Log.csv` and `Run Log.csv` are the header rows for the
   other two tabs.
2. Follow the setup steps below and leave `DRY_RUN=true`.
3. Run the workflow once by hand. You should get one digest at your dry-run
   address, subject starting `[DRY RUN]`. Each company with a deadline in the
   next 30 days, or overdue, appears with its date, where that date came from,
   a link to its Companies House page, and a draft client message for a person
   to read. Nothing is recorded and nothing goes to a client.

No screenshot is included yet. The digest wording is built in `src/core/copy.js`.

---

## What it does, in order

1. **07:00 every day** (UK time). Reads your `Companies` tab and your `Sent Log`.
2. For each company, one at a time, asks the Companies House public API for the
   company profile. This is a read-only request. If it fails, the run carries on
   with the sheet alone and says so.
3. Works out both deadlines and where each date came from (Companies House, a
   date you typed, or a calculation from your sheet).
4. Emails the practice one digest: reminders, anything needing a person to
   check, and a draft client message under each reminder.
5. Records each reminder in the `Sent Log` so it is not repeated, and appends a
   row to the `Run Log` on every run that gets as far as planning, including days it did nothing. A run that fails earlier (the Sent Log or Companies tab cannot be read, or the Sent Log header is wrong) fails visibly in n8n and writes no Run Log row. A digest that sent but whose Sent Log write failed also writes no Run Log row; see the runbook.

Reminders are raised at 30, 14, 7 and 1 days before a deadline, then weekly
once it is overdue. If a run is missed (n8n down, a holiday) the next run raises
the reminder it missed rather than skipping it.

## What it will not do

Each of these is enforced by a test.

- **It will not file or submit anything.** The only request it makes to
  Companies House is a `GET`. There is no inbound webhook.
- **It will not email a client.** The one email goes to your practice address.
- **It will not guess a deadline.** A date it cannot work out is reported with
  the reason. A date it calculated, or that you typed and Companies House did not
  confirm, is marked **Needs human confirmation**.
- **It will not move a deadline for a weekend or bank holiday.** GOV.UK states
  that an accounts deadline stands; the kit applies the same to confirmation
  statements as an inference (see R-11).
- **It will not remind about a dissolved company**, and it reports companies in
  liquidation, administration and similar for a person to decide.
- **It will not record a reminder as sent unless the digest email sent.**
- **It will not lose reminders while you are in dry run.** Dry run records
  nothing, so switching it off later raises everything still outstanding.

---

## Setting it up

About an hour, plus a week of dry run.

### 1. Make the sheet

Create one Google Sheet with three tabs, copying the headers exactly from
`templates/`. The header names are how the workflow finds the columns, so a
renamed header or a trailing space stops it working.

| Tab | Purpose |
|---|---|
| `Companies` | Your client companies. The only tab you type into |
| `Sent Log` | Append-only record of reminders raised. Do not edit |
| `Run Log` | One row per run. Your daily proof it worked. Do not edit |

Columns on `Companies`:

| Column | Required | Notes |
|---|---|---|
| `Company Name` | yes | For the digest |
| `Company Number` | yes | Eight characters, e.g. `01234567` or `SC123456`. Format the column as plain text so leading zeros survive; the kit repairs them but tells you |
| `Company Type` | yes | `Private` or `Public`. Companies House overrides it when it knows |
| `Incorporation Date` | recommended | `YYYY-MM-DD`. Needed for first accounts and the first confirmation statement |
| `Last Accounts Made Up To` | recommended | Period end of the last accounts filed. Leave blank only if no accounts have been filed yet |
| `Next Accounts Period End` | optional | Use if the accounting reference date has been changed |
| `Last Confirmation Statement Made Up To` | recommended | The **confirmation date** (the "made up to" date) on the last statement filed. Not its due date and not the day you filed it: if a statement was filed early, the next review period starts the day after the date on that statement |
| `Confirmation Statement Due` | optional | A date copied from the register. Cross-checked against Companies House |
| `Accounts Due` | optional | As above |
| `Client Contact Email` | optional | Used only to address the draft message in your digest |
| `Paused` | optional | `Yes` stops all reminders for that row |

### 2. Get a Companies House API key

Register at https://developer.company-information.service.gov.uk/ and create a
**REST** key. The API allows 600 requests per five minutes, which is far more
than a practice needs; see the runbook if you track several hundred companies.

### 3. Import the workflow

In n8n, Workflows, Import from File, and choose `workflow.json`.

Do not edit the `Plan Run`, `Prepare Companies`, `Collect Result` or
`Build Config` nodes in the n8n editor. They are generated from tested source.
If you need a change, change the source and rebuild, or CI will flag the drift.

### 4. Attach the credentials

- An **HTTP Basic Auth** credential on `Companies House Lookup`: the API key as
  the username and an empty password.
- A **Google Sheets** credential on the five Google Sheets nodes. A service
  account is preferred; share the sheet with its email address.
- An **SMTP** or **Gmail** credential on `Email Digest To Practice`.

### 5. Configure it

Fill in `.env` from `.env.example`, or edit the defaults at the top of the
`Build Config` node on n8n Cloud, where Code nodes cannot read `$env`.

```
DRY_RUN=true
DRY_RUN_RECIPIENT=you@yourfirm.co.uk
PRACTICE_EMAIL=you@yourfirm.co.uk
FIRM_NAME=Your Firm Ltd
SENDER_EMAIL=accounts@yourfirm.co.uk
COMPANIES_HOUSE_TRACKER_SHEET_ID=...
```

**On n8n Cloud** `$env` is not available, so none of the above is read. Open the
`Build Config` node, the one node meant to be edited, and change the defaults in
the quoted strings at the top. The Google Sheet id goes in the last line of
that node: `sheetId: env('COMPANIES_HOUSE_TRACKER_SHEET_ID', '')`. Put the id
(from the sheet URL, between `/d/` and `/edit`) as the second argument. All five
Google Sheets nodes read the id from there, so it is set in one place only.

### 6. Run it in dry run for a week

Activate the workflow and leave `DRY_RUN=true`. Each day you get the digest,
marked `[DRY RUN]`, at the dry-run address. For every date in it, open the
Companies House link in the digest and compare. Fix the sheet as you go.

This is the step no test can do for you: only you know whether the dates match
what the register says for your clients.

### 7. Go live

Set `DRY_RUN=false`. From then on the digest goes to `PRACTICE_EMAIL` and each
reminder is recorded. Nothing changes about clients: they still receive nothing
from this workflow.

---

## UK rules used

Rules last checked against GOV.UK and legislation.gov.uk on **5 October 2026**.

- [Filing your company's confirmation statement](https://www.gov.uk/guidance/confirmation-statement-guidance)
- [Prepare annual accounts for a private limited company](https://www.gov.uk/prepare-file-annual-accounts-for-limited-company)
- [Preparing and filing Companies House accounts](https://www.gov.uk/government/publications/filing-your-companies-house-accounts/life-of-a-company-part-1-accounts)
- [Companies Act 2006 s442, period for filing accounts](https://www.legislation.gov.uk/ukpga/2006/46/section/442)
- [Companies Act 2006 s853A, confirmation statement review period](https://www.legislation.gov.uk/ukpga/2006/46/section/853A)

Each rule, its source and whether it is documented or still unverified is
listed in `rules/RULES.md`.

## Verification

138 automated tests cover this kit (115 unit, 9 property-based, 14 fault tests),
and run with no credentials. The whole repository runs 386 tests in CI.
They prove, among other things, that the workflow only ever makes a read request
to Companies House, that the only email goes to your practice, that a reminder
is recorded only after the digest sent, that dry run records nothing, and that
an uncertain date is flagged instead of guessed. They cannot prove your sheet
matches the register, which is why you run a week of dry run first.

---

## Before you rely on it

Read `rules/RULES.md`. Several rules are marked **UNVERIFIED**, for example how a month-end clamp or a 29 February date is treated, and those dates carry **Needs human confirmation** in every digest. The kit also judges company type (private or public) as it is now, not as at the end of the accounting period (s442(6)), so check a company that has changed type. Subscribe your companies to
Companies House's own email reminders as a second source; this kit is a
convenience, not the system of record.

## Files

```
src/core/       the decision logic: dates, rules, companies, deadlines, copy, config, plan
rules/          deadline-rules.json (the numbers) and RULES.md (sources and status)
templates/      the three sheet tabs
docs/RUNBOOK.md what to do when something looks wrong
tests/          unit, property and fault tests; no credentials needed
workflow.json   generated from src/core by `npm run build`; never edit by hand
```

## Disclaimer

This is a workflow template, not legal advice. Deadlines, penalties and API
terms can change. Always confirm against the Companies House register and
current GOV.UK guidance before relying on a date.

---

**Want a hand?** [Book a free 20-minute call](https://www.parambir.com/call),
[take the free Practice Value Diagnostic](https://www.parambir.com/scorecard)
or [email me](mailto:office@parambir.com).
More ways to get help: see [Work with me](../../../README.md#work-with-me).
<!-- CTA: free done-for-you install (TODO link) -->
