# MTD VAT deadline reminders

**Never chase a client for VAT records at the last minute again.**

- **Who it is for:** a UK practice that keeps its VAT clients in a Google Sheet and files through Making Tax Digital compatible software.
- **What it does:** works out each client's VAT return deadline and emails them a records checklist at 21, 14, 7 and 3 days before it, after a preview to you.
- **What it does not do:** it drafts and sends reminders only. It never files or submits a return, never pays HMRC and has no HMRC connection.

## See it work in 5 minutes

1. Open `templates/` and copy the five CSV files into a Google Sheet as five tabs (`VAT Clients` has two placeholder rows dated 2099).
2. Import `workflow.json` into n8n and leave `DRY_RUN=true` (full steps in "Setting it up" below).
3. Run it by hand. Expected output: the 08:30 preview listing each client, period, how urgent it is and why anything was skipped, then the reminder emails delivered to you only.
4. To see every email without installing anything, read `docs/EMAILS.md`. It is rendered from the same code that sends.

Calculates each VAT-registered client's return deadline (one calendar month and 7
days after the end of the VAT period, for periods that end on a month end; others use
the date you type in), and emails them a pre-submission checklist
at 21, 14, 7 and 3 days before it. It stops the moment you mark the return
`Submitted`, and logs that once. Built for a UK practice that keeps its VAT
clients in a spreadsheet and files through Making Tax Digital compatible software.

**It sends you a preview at 08:30 of exactly what will go out at 09:00.** Nothing
reaches a client until you have watched it for a week and switched dry run off.

**It only sends reminders.** It never submits a VAT return, never pays HMRC, and
does not connect to HMRC at all. The return is prepared and approved by you, in
your own MTD software, as before.

---

## What it does, in order

1. **08:30, weekdays.** Reads the sheet, works out each client's deadline and
   which reminders are due, and emails you the list: who, which period, how urgent,
   and why anything was skipped. If it looks wrong, put today's date in the
   `Hold Until` cell of the `Run Control` tab and nothing goes out.
2. **09:00, weekdays.** Does the same work again and sends the emails, but only
   if today's preview was delivered to you. If the preview failed, nothing is sent.
   **09:00 plans again from the live sheet, not from the preview you approved.**
   If you edit the sheet between 08:30 and 09:00, the 09:00 run follows the edit.
   Use the hold cell if you want a day stopped.
3. Adds any return you have marked `Submitted` to the `Submission Log` tab, once.
4. For each client, in turn: sends one email covering every VAT period they have
   coming up, records it, then marks those rows in the sheet.
5. Appends a row to the `Run Log` tab every day, including days it did nothing.

Each email gives the deadline, the number of days to go, and a short checklist of
the digital record-keeping checks to finish first (invoices recorded, accounts
reconciled, adjustments recorded, figures moved between programs digitally and not
retyped, anything outstanding sent to you). The tone escalates from an advance
notice to a final reminder. See `docs/EMAILS.md` for every email, word for word.

## How the deadline is worked out

`rules/vat-rules.json` holds the rule: **one calendar month and 7 days after the end
of the accounting period** (<https://www.gov.uk/submit-vat-return>). For a period that
ends on the last day of a month, regulation 25(1) of the VAT Regulations 1995 makes the
month part the last day of the next month, so the deadline is the 7th of the month after
next: a quarter ending 30 June is due 7 August.

- **Only month-end periods are calculated.** If a client's VAT period does not end on the
  last day of a month, the kit does **not** guess: the row is listed as needing attention
  and **no reminder is sent** until you type the due date from the client's VAT online
  account into the `HMRC Due Date` column.

- **Weekends and bank holidays do not move it.** gov.uk says the return must be in
  and the payment must reach HMRC on or before the deadline "even if it's on a
  weekend or bank holiday". The kit never moves a deadline, and tells the client when
  one falls on a weekend or bank holiday.
- **The payment is due the same day,** and the email says so, and that a Direct Debit is
  collected 3 working days after the deadline (<https://www.gov.uk/pay-vat>).
- **You can override the date.** If a client's VAT online account shows a different
  due date, type it into the `HMRC Due Date` column. It always wins over the calculation.
- **VAT Annual Accounting Scheme clients are not calculated.** gov.uk gives them a
  different deadline, so the kit refuses to guess: set their `VAT Scheme` cell and
  they are listed as needing attention.

**Before you rely on it, read `rules/RULES.md`.** How the month and the 7 days combine for
month-end periods is not stated in one place and is marked **UNVERIFIED**. Compare the kit's dates with a few clients' VAT online accounts first;
the register lists exactly what to check.

## What it will not do

These are deliberate, and each one is enforced by a test.

- **It will not submit anything to HMRC, or pay anything.** There is no HMRC
  connection in the workflow. Its only outputs are emails to clients, the preview and
  alerts to you, and rows in your own sheet.
- **It will not remind about a return marked** `Submitted`, `Not required` or `On Hold`.
- **It will not send the same client two emails in one morning.** Every period that
  is due a reminder goes in one message, at the tone the nearest one warrants.
- **It is built to send each reminder once, and says so honestly when it cannot.**
  Each send is recorded in two places, the `Sent Log` and the `VAT Clients` tab, and
  both are always attempted, so one failing does not cause a repeat. Two cases are
  outside its control, and in both you are emailed:
  - If a send fails or times out, it is reported as **unconfirmed**: a timeout
    after the mail server accepted the message may still mean it was delivered.
    It is not retried automatically, nothing is recorded, and it is planned again
    on the next working day, so check your sent mail if you need to be sure.
  - If the email goes but **both** recording writes fail, the reminder can be
    planned again tomorrow. The alert says which client to check and fix.
- **It will not record a dry run.** While `DRY_RUN=true` nothing is written to the
  `Sent Log`, the `VAT Clients` tab or the `Submission Log` (the `Run Log` still gets
  its row), so switching dry run off never makes the kit believe a reminder has gone.
- **It will not hide a problem.** A failed send, a send that went but could not be
  recorded, a `Submission Log` that could not be written, and a run that halts for
  any reason other than your own hold are counted in the `Run Log` and emailed to
  `PRACTICE_EMAIL`. Later clients are still emailed after one client's failure. If the
  alert email cannot be sent, the run ends red in n8n, so set the Error Workflow below.
- **It will not miss a reminder because of a weekend.** If a reminder would fall on a
  day nothing is sent, it goes on the last sending day before it.
- **It will not send a burst.** A client added late, or one that passed several
  reminder points while n8n was off, gets one reminder: the tightest it has earned.
- **It will not email about a deadline that has already passed.** It lists it in your
  preview as needing attention, every day, until you deal with it.
- **It will not state a penalty, a rate or an amount to a client,** and never says
  anything has been submitted or paid.
- **It will not send at a weekend, on a bank holiday, or between 24 December and
  1 January.** (These are your sending days. They do not move the VAT deadline.)
- **It will not send a surprise flood.** If a run would send more than the limit,
  it sends nothing and tells you instead.
- **It will not run on a damaged rules file.** If `rules/vat-rules.json` is unusable,
  nothing is sent and you are told why.

---

## Setting it up

Roughly an afternoon. Steps 1 to 6 are the install; steps 7 and 8 are the week you
must not skip.

### 1. Make the sheet

Create one Google Sheet with five tabs, copying the headers exactly from
`templates/`. The header names are how the workflow finds the columns, so a
renamed header or a trailing space stops it working.

| Tab | Purpose |
|---|---|
| `VAT Clients` | Your VAT clients. The only tab you type into |
| `Submission Log` | One row for each return marked `Submitted`, written by the kit. Do not edit |
| `Sent Log` | Append-only record of every email sent. Do not edit |
| `Run Log` | One row per run. Your daily proof it worked. The 09:00 run reads it to confirm the preview was delivered. Do not edit |
| `Run Control` | You type today's date in cell A2 (`Hold Until`) to hold that day's run |

On the `VAT Clients` tab you type into these columns:

| Column | What to put |
|---|---|
| `Client Name` | How the email addresses them: "Dear Acme Ltd," |
| `Contact Email` | Who gets the reminder |
| `VAT Period End` | The last day of the VAT period. `YYYY-MM-DD` is safest; `dd/mm/yyyy` is understood. If it is not the last day of a month, `HMRC Due Date` is required |
| `Submitted` | Blank or `No` while open. `Yes` once the return has gone to HMRC. `Not required` or `On Hold` also stop reminders |
| `VAT Scheme` | Leave blank for a standard return. `Annual Accounting` is listed as needing attention, not calculated |
| `HMRC Due Date` | The date from the client's VAT online account. Optional for month-end periods (it overrides the calculation); **required** for any other period end, or no reminder is sent |

The last three columns (`Last Checklist Sent`, `Checklist For Period End`,
`Last Checklist On`) are written by the workflow. Leave them blank.

One row is one VAT period. When a client's quarter rolls on, change `VAT Period End`
and set `Submitted` back to `No`: the kit notices the period has changed and starts
its reminders afresh. Or add a new row, and leave the old one as `Yes`.

The two example rows in `templates/VAT Clients.csv` are obvious placeholders (dated
2099). Replace them.

Format the date columns (`VAT Period End`, `HMRC Due Date`, `Checklist For Period End`,
`Last Checklist On`, and `Run Date`, `Hold Until` and `Confirmed Submitted On` on the
other tabs) as **plain text**, so Google Sheets keeps them as `YYYY-MM-DD` rather
than reinterpreting them in a locale.

These are service messages about a client's own VAT return. Keep them that way: do
not add promotional content, which would change the rules that apply to sending them
(check PECR and your data-protection policy).

### 2. Import the workflow

In n8n, Workflows, Import from File, and choose `workflow.json`.

Do not edit the `Plan Run`, `Prepare Actions` or `Build Config` nodes in the n8n
editor. They are generated from tested source. If you need a change, change the
source and rebuild, or the drift check will flag the workflow.

The workflow is set to the `Europe/London` timezone and the `v1` execution order.
Check both are kept when you import it.

### 3. Attach the credentials

- A **Google Sheets** credential on all nine Google Sheets nodes. A service
  account is strongly preferred: a personal OAuth client left in "Testing" status
  has its token revoked by Google every seven days, and the workflow silently
  stops. Share the sheet with the service account's email address.
- An **SMTP** or **Gmail** credential on the three email nodes.
- **Set an Error Workflow** (workflow settings, Error Workflow) that emails you.
  This is a recommended setup step, not an optional extra. A failed read of the
  sheet or a failed preview stops the run on purpose, and without an error workflow
  the only sign is n8n's executions list.

Network nodes retry on a transient error (the client email deliberately does not:
see "What it will not do").

### 4. Configure it

Fill in `.env` from `.env.example`, or edit the defaults at the top of the
`Build Config` node if you are on n8n Cloud, where Code nodes cannot read `$env`.
The sheet id (`MTD_VAT_CLIENTS_SHEET_ID`) is read by the Google Sheets nodes, not by
`Build Config`. On self-hosted n8n set it in the environment (and allow env access
with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). On n8n Cloud, paste the id into each
Google Sheets node in place of the expression.

The ones that matter on day one:

```
DRY_RUN=true
DRY_RUN_RECIPIENT=you@yourfirm.co.uk
PRACTICE_EMAIL=you@yourfirm.co.uk
FIRM_NAME=Your Firm Ltd
SENDER_EMAIL=reminders@yourfirm.co.uk
FIRM_PHONE=01234 567890
MTD_VAT_CLIENTS_SHEET_ID=...
```

`CHECKLIST_MILESTONE_DAYS` (default `21,14,7,3`) sets the days before the deadline at
which a checklist goes out. `BANK_HOLIDAY_DIVISION` chooses the gov.uk bank holiday
list used for your sending days: `england-and-wales` (default), `scotland` or
`northern-ireland`.

### 5. Check your email domain before you send anything

If your SPF, DKIM and DMARC records are not right, reminders land in spam and you
will conclude the kit does not work. Send yourself a test from the address in
`SENDER_EMAIL` and confirm it arrives in the inbox, not the junk folder.

### 6. Read every email it can send, and check the dates

`docs/EMAILS.md` is a rendered gallery of every message this kit will ever produce,
plus the 08:30 preview. Read it, and approve the checklist wording: it is a prompt,
not advice on what MTD requires of a particular client. It is generated from the
same code that sends, so it cannot drift from reality.

Then do the date check in `rules/RULES.md` ("The UNVERIFIED items, in one place"):
compare the calculated deadline with the VAT online account for several clients,
including 30 April and 30 November quarter ends, and fill in `HMRC Due Date` for every
client whose period does not end on a month end.

### 7. Run it in dry run for a week

Activate the workflow and leave `DRY_RUN=true`.

Every weekday you will get the 08:30 preview and, at 09:00, the emails themselves,
all delivered to you with the real recipient in the subject line.

A dry run records nothing. That is deliberate, so that going live is clean, but it
means the same reminders are planned again each day, and on the first live run the
kit sends whatever is due that day, at the tightest reminder each return has earned.
It does not replay the reminders you saw in dry run.

Read them. This is the step that catches what no test can: a wrong date, a return you
had already submitted, a client you would rather phone. Fix the sheet as you go.

### 8. Go live

Set `DRY_RUN=false`, and make sure `SENDER_EMAIL` and `PRACTICE_EMAIL` are your real
addresses: with an empty or example address the run stops and tells you why (in the
preview, the `Run Log` and, on the 09:00 run, an alert). Consider starting with a few
clients only, by marking the rest `On Hold` temporarily.

---

## Running it, day to day

There are only two things to do.

**Mark returns `Submitted`.** Put `Yes` in the `Submitted` cell once the return has
gone to HMRC. Reminders stop on the next run and it is logged. This is the one habit
the whole thing depends on: the kit can only act on what the sheet says at 09:00.

**Read the 08:30 preview.** Ten seconds most days. It is also where rows that need
fixing are listed, including any deadline that has passed without the return being
marked `Submitted`.

If something looks wrong, see `docs/RUNBOOK.md`.

---

## For whoever maintains this

```
npm test                          # build check, lint, unit, property and fault tests
npm run test:kit02                # this kit's tests only
npm run build                     # regenerate workflow.json from src/core
npm run lint:kit02                # n8n-specific static checks for this workflow
npm run emails:kit02              # regenerate docs/EMAILS.md after a copy change
```

The logic lives in `src/core/` as one pure function,
`plan({ rows, today, config, sentKeys, submissionLog })`. It performs no input or
output and never throws, so it can be tested exhaustively without credentials. The
deadline calculation is in `src/core/deadline.js` and reads its numbers from
`rules/vat-rules.json`, not from code. `workflow.json` is generated from the core,
and `npm run build:check` fails if the two have diverged.

`rules/RULES.md` lists every rule the kit relies on, its gov.uk source, when it was
checked, and which ones are still **UNVERIFIED**. The bank holiday file
`rules/bank-holidays.json` is the gov.uk feed, unmodified, and ends at Boxing Day
2028: refresh it before then, following the steps in `RULES.md`.

## UK rules used

Rules valid as of 2 October 2026 (full register with sources in `rules/RULES.md`):

- VAT return due one calendar month and 7 days after the period end: <https://www.gov.uk/submit-vat-return>
- Payment due the same day; Direct Debit collected 3 working days later: <https://www.gov.uk/pay-vat>
- Month-end periods: Regulation 25(1), VAT Regulations 1995: <https://www.legislation.gov.uk/uksi/1995/2518/regulation/25>
- Digital records checklist: <https://www.gov.uk/charge-reclaim-record-vat>
- Bank holidays (sending days only): <https://www.gov.uk/bank-holidays>

**Still to confirm with your practice:** how the month and the 7 days combine for month-end periods, the treatment of Flat Rate, Cash Accounting and Retail schemes, and the checklist wording are marked UNVERIFIED in `rules/RULES.md`. Compare the kit's dates with a few clients' VAT online accounts before relying on it.

## Verification

215 tests (`npm run test:kit02`), no credentials needed, and the static workflow lint passes with 0 errors and 0 warnings. They prove: the deadline calculation against the rules file, including every month end; that no reminder goes for a return marked `Submitted`, `Not required` or `On Hold`; one email per client per day; no repeats after a failed or partial write; dry run records nothing; no email states a penalty, rate or amount; and `workflow.json` matches the tested source.

## Get help

Free [MTD Fee Gap Calculator](https://www.parambir.com/mtd-check) | [Book a free 20-minute call](https://www.parambir.com/call) | [Email me](mailto:office@parambir.com) | [More ways to get help](../../../README.md#work-with-me)

<!-- CTA: free done-for-you install (TODO link) -->

## Disclaimer

A workflow template, not tax or legal advice. VAT return deadlines, Making Tax
Digital requirements and HMRC's penalty regime can change, and the kit's calculated
date is only as good as the rule in `rules/vat-rules.json`. Verify dates against the
client's VAT online account and gov.uk before relying on this for client-facing
deadline management.
