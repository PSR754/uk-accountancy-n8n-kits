# Invoice payment chasing

Chases overdue invoices by email on a schedule, escalating in tone as an invoice
ages, and stops the moment you mark it paid. Built for a UK practice chasing its
own fees, or running credit control for a client.

**It sends you a preview at 08:30 of exactly what will go out at 09:00.** Nothing
reaches a client until you have watched it for a week and switched dry run off.

---

## What it does, in order

1. **08:30, weekdays.** Reads the sheet, works out what is due to be chased, and
   emails you the list. One screen: who, how much, which stage, and why anything
   was skipped. If it looks wrong, click the hold link and nothing goes out.
2. **09:00, weekdays.** Does the same work again and sends the emails.
3. For each client, in turn: sends one email covering every invoice they owe on,
   records it, then marks those rows in the sheet.
4. Appends a row to the `Run Log` tab, every day, including days it did nothing.

Three stages, by default at 7, 30 and 60 days overdue: a friendly reminder, a
firmer one, then a final notice. Each is sent once per invoice, ever.

## What it will not do

These are deliberate, and each one is enforced by a test.

- **It will not chase an invoice you have marked** `Paid`, `Disputed`,
  `Payment Plan` or `Written Off`.
- **It will not send the same client two emails in one morning.** Everything
  they owe goes in one message, pitched at the tone their oldest debt warrants.
- **It will not send a statutory-interest claim to an individual.** The Late
  Payment of Commercial Debts (Interest) Act covers business debts only, so that
  paragraph appears only for clients marked `Business`.
- **It will not claim to have chased before when it has not.** An invoice that
  was already months overdue on the day you started using this begins with a
  friendly reminder and works up, at the normal pace.
- **It will not send twice.** Even if the sheet write fails, or n8n crashes
  between sending and recording, a separate log of what was sent prevents it.
- **It will not send at a weekend, on an England and Wales bank holiday, or
  between 24 December and 1 January.**
- **It will not send a surprise flood.** If a run would send more than the limit,
  it sends nothing and tells you instead.

---

## Setting it up

Roughly an afternoon. Steps 1 to 6 are the install; step 7 is the week you must
not skip.

### 1. Make the sheet

Create one Google Sheet with four tabs, copying the headers exactly from
`templates/`. The header names are how the workflow finds the columns, so a
renamed header or a trailing space stops it working.

| Tab | Purpose |
|---|---|
| `Invoices` | Your invoice list. The only tab you type into |
| `Sent Log` | Append-only record of every email sent. Do not edit |
| `Run Log` | One row per run. Your daily proof it worked. Do not edit |
| `Run Control` | Holds a run when you click the hold link. Do not edit |

On the `Invoices` tab, set up data validation so the values stay clean:

- `Client Type`: dropdown, `Business` or `Individual`.
- `Status`: dropdown, `Unpaid`, `Paid`, `Disputed`, `Payment Plan`, `Written Off`.
- `Due Date` and `Activation Date`: date format `YYYY-MM-DD`.
- `Amount GBP`: plain number. A currency-formatted cell is handled, but plain is safer.

`Activation Date` is the day an invoice came under this system. For anything you
are loading in from an existing backlog, set it to today. That is what makes an
eight-month-old debt open with a friendly reminder instead of a final notice.

### 2. Load your invoices

Put your current unpaid invoices in the `Invoices` tab. Set `Activation Date` to
today for all of them. Leave `Last Chase Stage` and `Last Chased On` blank.

Take a moment over the backlog: anything written off, in dispute, or on an agreed
payment plan should be marked as such now, not chased on Monday.

### 3. Import the workflow

In n8n, Workflows, Import from File, and choose `workflow.json`.

Do not edit the `Plan Run`, `Prepare Actions` or `Build Config` nodes in the n8n
editor. They are generated from tested source. If you need a change, change the
source and rebuild, or the drift check will flag the workflow.

### 4. Attach the credentials

- A **Google Sheets** credential on all five Google Sheets nodes. A service
  account is strongly preferred: a personal OAuth client left in "Testing" status
  has its token revoked by Google every seven days, and the workflow silently
  stops. Share the sheet with the service account's email address.
- An **SMTP** or **Gmail** credential on the three email nodes.

### 5. Configure it

Fill in `.env` from `.env.example`, or edit the defaults at the top of the
`Build Config` node if you are on n8n Cloud, where Code nodes cannot read `$env`.

The ones that matter on day one:

```
DRY_RUN=true
DRY_RUN_RECIPIENT=you@yourfirm.co.uk
PRACTICE_EMAIL=you@yourfirm.co.uk
FIRM_NAME=Your Firm Ltd
SENDER_EMAIL=accounts@yourfirm.co.uk
FIRM_PHONE=01234 567890
INVOICE_TRACKER_SHEET_ID=...
```

### 6. Check your email domain before you send anything

If your SPF, DKIM and DMARC records are not right, chase emails land in spam and
you will conclude the kit does not work. Send yourself a test from the address in
`SENDER_EMAIL` and confirm it arrives in the inbox, not the junk folder.

### 7. Read every email it can send

`docs/EMAILS.md` is a rendered gallery of every message this kit will ever
produce, at every stage, for both business and individual clients, plus the
08:30 preview. Read it before you activate anything. It is generated from the
same code that sends, so it cannot drift from reality.

### 8. Run it in dry run for a week

Activate the workflow and leave `DRY_RUN=true`.

Every weekday you will get the 08:30 preview and, at 09:00, the emails
themselves, all delivered to you with the real recipient in the subject line.

Read them. This is the step that catches the things no test can: a client whose
tone is wrong for the relationship, an invoice you had forgotten was in dispute,
a name spelled oddly. Fix the sheet as you go.

### 9. Go live

Set `DRY_RUN=false`. Consider starting with one client's invoices only for the
first few days, by marking the rest `Payment Plan` temporarily.

---

## Running it, day to day

There are only two things to do.

**Mark invoices paid.** Put `Paid` in the `Status` cell. Chasing stops on the
next run. This is the one habit the whole thing depends on: the kit can only act
on what the sheet says at 09:00.

**Read the 08:30 preview.** Ten seconds most days. It is also where rows that
need fixing are listed.

If something looks wrong, see `docs/RUNBOOK.md`.

---

## For whoever maintains this

```
npm test          # 80 tests: build check, lint, unit, property, fault
npm run build     # regenerate workflow.json from src/core
npm run lint      # n8n-specific static checks
npm run drift     # compare the live workflow against the committed one
node scripts/render-emails.js   # regenerate docs/EMAILS.md after a copy change
```

The logic lives in `src/core/` as one pure function, `plan(rows, today, config)`.
It performs no input or output and never throws, so it can be tested exhaustively
without credentials. `workflow.json` is generated from it and `npm run build:check`
fails if the two have diverged.

`rules/RULES.md` lists every statutory value the kit relies on, with its source.
**Two rows in it still need a qualified person to sign off before go-live.**

## Disclaimer

A workflow template, not legal or debt-recovery advice. References to the Late
Payment of Commercial Debts (Interest) Act 1998 are general. Verify the current
statutory interest rate, the fixed sums, and your own contractual payment terms
before relying on this, and take advice before pursuing formal recovery.
