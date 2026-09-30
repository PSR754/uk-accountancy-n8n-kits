# HMRC deadline reminders

Emails your clients staged reminders before each filing or payment deadline you
track for them (VAT, Self Assessment, Corporation Tax, or anything else you put
in the sheet), and stops the moment you mark the deadline `Filed`. Built for a
UK practice that keeps its client deadlines in a spreadsheet.

**It sends you a preview at 08:30 of exactly what will go out at 09:00.** Nothing
reaches a client until you have watched it for a week and switched dry run off.

**It only sends reminders.** It never files, submits or pays anything with HMRC
or Companies House, and it does not connect to either.

---

## What it does, in order

1. **08:30, weekdays.** Reads the sheet, works out which reminders are due, and
   emails you the list: who, which deadline, how urgent, and why anything was
   skipped. If it looks wrong, put today's date in the `Hold Until` cell of the
   `Run Control` tab and nothing goes out.
2. **09:00, weekdays.** Does the same work again and sends the emails, but only
   if today's preview was delivered to you. If the preview failed, nothing is sent.
   **Note that 09:00 plans again from the live sheet, not from the preview you
   approved.** If you edit the sheet between 08:30 and 09:00, the 09:00 run follows
   the edit. Use the hold cell if you want a day stopped.
3. For each client, in turn: sends one email covering every deadline they have
   coming up, records it, then marks those rows in the sheet.
4. Appends a row to the `Run Log` tab every day, including days it did nothing.

Four reminders per deadline by default, at 30, 14, 7 and 1 days before the due
date, with the tone escalating from an advance notice to a final reminder. Each is
sent once per deadline. The days are a setting, not a rule.

## What it will not do

These are deliberate, and each one is enforced by a test.

- **It will not work out your deadlines.** The due date is whatever you type in
  the `Due Date` column. The kit contains no HMRC or Companies House deadline
  rules, so it cannot be out of date about them, and it also cannot correct a
  wrong date. See `rules/RULES.md`.
- **It will not remind about a deadline marked** `Filed`, `Cancelled` or `On Hold`.
- **It will not send the same client two emails in one morning.** Every deadline
  that is due a reminder goes in one message, at the tone the nearest one warrants.
- **It is built to send each reminder once, and says so honestly when it cannot.**
  Each send is recorded in a separate `Sent Log` before the `Deadlines` tab is
  updated, so a failed `Deadlines` update does not cause a repeat. Two cases are
  outside its control, and in both you are emailed:
  - If a send fails in a way that leaves it unclear whether the mail server
    accepted it, it is not retried automatically. Nothing is recorded and it is
    planned again on the next working day.
  - If the email goes but the `Sent Log` append fails, the reminder is not
    recorded and can be planned again tomorrow. The alert says which client to check.
- **It will not record a dry run.** While `DRY_RUN=true` no reminder is written to
  the `Sent Log` or the `Deadlines` tab (the `Run Log` still gets its row), so
  switching dry run off never makes the kit believe a reminder has already gone.
- **It will not hide a problem.** A failed send, a send that went but could not
  be recorded, and a run that halts for any reason other than your own hold
  (no preview delivered, a bad setting, the send ceiling) are counted in the
  `Run Log`, described there, and emailed to `PRACTICE_EMAIL`. Later clients are
  still emailed after one client's failure. If the alert email itself cannot be
  sent, the run ends red in n8n, which is what the Error Workflow is for.
- **It will not miss a reminder because of a weekend.** If a reminder would fall
  on a day nothing is sent (a weekend or bank holiday), it goes on the last
  sending day before it. A Monday deadline gets its final reminder on the Friday.
- **It will not send a burst.** A deadline added late, or one that passed several
  reminder points while n8n was off, gets one reminder: the tightest it has earned.
- **It will not email about a deadline that has already passed.** It lists it in
  your preview as needing attention, every day, until you deal with it.
- **It will not state a penalty, a rate or an amount to a client,** and never says
  anything has been filed or paid.
- **It will not send at a weekend, on a bank holiday, or between 24 December and
  1 January.**
- **It will not send a surprise flood.** If a run would send more than the limit,
  it sends nothing and tells you instead.

---

## Setting it up

Roughly an afternoon. Steps 1 to 6 are the install; steps 7 and 8 are the week you
must not skip.

### 1. Make the sheet

Create one Google Sheet with four tabs, copying the headers exactly from
`templates/`. The header names are how the workflow finds the columns, so a
renamed header or a trailing space stops it working.

| Tab | Purpose |
|---|---|
| `Deadlines` | Your client deadlines. The only tab you type into |
| `Sent Log` | Append-only record of every email sent. Do not edit |
| `Run Log` | One row per run. Your daily proof it worked. The 09:00 run reads it to confirm the preview was delivered. Do not edit |
| `Run Control` | You type today's date in cell A2 (`Hold Until`) to hold that day's run |

On the `Deadlines` tab you type into the first five columns:

| Column | What to put |
|---|---|
| `Client Name` | How the email addresses them: "Dear Acme Ltd," |
| `Deadline Type` | Free text, shown to the client: `VAT return`, `Corporation Tax payment` |
| `Due Date` | The date you have checked. `YYYY-MM-DD` is safest; `dd/mm/yyyy` is understood |
| `Contact Email` | Who gets the reminder |
| `Status` | Blank or `Pending` while open. `Filed`, `Cancelled` or `On Hold` stops reminders |

The last three columns (`Last Reminder Sent`, `Reminded For Due Date`,
`Last Reminded On`) are written by the workflow. Leave them blank.

One row is one deadline. A client with a VAT return and a Corporation Tax
payment has two rows. When a recurring deadline rolls on to next period, change
`Due Date` and set `Status` back to `Pending`: the kit notices the date has
changed and starts that deadline's reminders afresh.

The two example rows in `templates/Deadlines.csv` are obvious placeholders (`Example filing`, dated 2099). Replace them.

Format the date columns (`Due Date`, `Reminded For Due Date`, `Last Reminded On`,
and `Run Date` and `Hold Until` on the other tabs) as **plain text**, so Google
Sheets keeps them as `YYYY-MM-DD` rather than reinterpreting them in a locale.

These are service messages about a client's own deadlines. Keep them that way:
do not add promotional content, which would change the rules that apply to
sending them (check PECR and your data-protection policy).

### 2. Import the workflow

In n8n, Workflows, Import from File, and choose `workflow.json`.

Do not edit the `Plan Run`, `Prepare Actions` or `Build Config` nodes in the n8n
editor. They are generated from tested source. If you need a change, change the
source and rebuild, or the drift check will flag the workflow.

### 3. Attach the credentials

- A **Google Sheets** credential on all seven Google Sheets nodes. A service
  account is strongly preferred: a personal OAuth client left in "Testing" status
  has its token revoked by Google every seven days, and the workflow silently
  stops. Share the sheet with the service account's email address.
- An **SMTP** or **Gmail** credential on the three email nodes.
- **Set an Error Workflow** (workflow settings, Error Workflow) that emails you.
  This is a recommended setup step, not an optional extra. A failed read of the
  sheet or a failed preview stops the run on purpose, and without an error workflow
  the only sign is n8n's executions list.

### 4. Configure it

Fill in `.env` from `.env.example`, or edit the defaults at the top of the
`Build Config` node if you are on n8n Cloud, where Code nodes cannot read `$env`.
The sheet id (`HMRC_CLIENT_LIST_SHEET_ID`) is read by the Google Sheets nodes,
not by `Build Config`. On self-hosted n8n set it in the environment (and allow env
access with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). On n8n Cloud, paste the id
into each Google Sheets node in place of the expression.

The ones that matter on day one:

```
DRY_RUN=true
DRY_RUN_RECIPIENT=you@yourfirm.co.uk
PRACTICE_EMAIL=you@yourfirm.co.uk
FIRM_NAME=Your Firm Ltd
SENDER_EMAIL=reminders@yourfirm.co.uk
FIRM_PHONE=01234 567890
HMRC_CLIENT_LIST_SHEET_ID=...
```

`REMINDER_MILESTONE_DAYS` (default `30,14,7,1`) sets the days before a due date
at which a reminder goes out. `BANK_HOLIDAY_DIVISION` chooses the gov.uk bank
holiday list: `england-and-wales` (default), `scotland` or `northern-ireland`.

### 5. Check your email domain before you send anything

If your SPF, DKIM and DMARC records are not right, reminders land in spam and you
will conclude the kit does not work. Send yourself a test from the address in
`SENDER_EMAIL` and confirm it arrives in the inbox, not the junk folder.

### 6. Read every email it can send

`docs/EMAILS.md` is a rendered gallery of every message this kit will ever
produce, at every stage, plus the 08:30 preview. Read it before you activate
anything. It is generated from the same code that sends, so it cannot drift from
reality.

### 7. Run it in dry run for a week

Activate the workflow and leave `DRY_RUN=true`.

Every weekday you will get the 08:30 preview and, at 09:00, the emails themselves,
all delivered to you with the real recipient in the subject line.

A dry run records no reminder as sent. That is deliberate, so that going live is clean, but it
means the same reminders will be planned again each day, and on the first live run
the kit sends whatever is due that day, at the tightest reminder each deadline has
earned. It does not replay the reminders you saw in dry run.

Read them. This is the step that catches what no test can: a wrong due date, a
deadline you had already dealt with, a client you would rather phone. Fix the
sheet as you go.

### 8. Go live

Set `DRY_RUN=false`, and make sure `SENDER_EMAIL` and `PRACTICE_EMAIL` are your real
addresses: with an empty or example address the run stops and tells you why (in the
preview, the `Run Log` and, on the 09:00 run, an alert). Consider starting with one client's deadlines only for the
first few days, by marking the rest `On Hold` temporarily.

---

## Running it, day to day

There are only two things to do.

**Mark deadlines `Filed`.** Put it in the `Status` cell once the work is done.
Reminders stop on the next run. This is the one habit the whole thing depends on:
the kit can only act on what the sheet says at 09:00.

**Read the 08:30 preview.** Ten seconds most days. It is also where rows that need
fixing are listed, including any deadline that has passed without being marked `Filed`.

If something looks wrong, see `docs/RUNBOOK.md`.

---

## For whoever maintains this

```
npm test                          # build check, lint, unit, property and fault tests
npm run build                     # regenerate workflow.json from src/core
npm run lint                      # n8n-specific static checks
node scripts/render-emails-01.js  # regenerate docs/EMAILS.md after a copy change
```

The logic lives in `src/core/` as one pure function, `plan({ rows, today, config, sentKeys })`.
It performs no input or output and never throws, so it can be tested exhaustively
without credentials. `workflow.json` is generated from it, and `npm run build:check`
fails if the two have diverged.

`rules/RULES.md` lists every rule the kit relies on and its source. The bank
holiday file `rules/bank-holidays.json` is the gov.uk feed, unmodified, and ends
at Boxing Day 2028: refresh it before then, following the steps in `RULES.md`.

## Disclaimer

A workflow template, not tax or legal advice. The kit reminds clients about the
dates you enter; it does not check them. HMRC and Companies House deadlines,
penalty regimes and filing rules can change, so verify every date against
gov.uk before relying on this for client-facing deadline management.
