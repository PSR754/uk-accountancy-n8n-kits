# Rules register

Every rule, date and threshold this kit relies on, where it comes from, and how
sure we are of it. A proof that the code follows a rule is worth nothing if the
rule is wrong, so this file is the part that needs a person to check, not the code.

**Valid as of 2026-10-02.** Every gov.uk page below was read on that date (the
pages themselves showed "last updated" 2026-09-30). The same date is recorded in
`vat-rules.json` as `validAsOf`; the 08:30 preview warns when it is more than a
year old.

## What this kit encodes, and what it does not

It calculates one thing: the date a VAT return is due, from the end of the VAT
accounting period. It does so with the rule in `vat-rules.json`, not in code, so a
change to the rule is a change to that file and to this register.

It does **not**:

- submit a VAT return, or pay anything, to HMRC. It has no HMRC connection of any kind.
- state any penalty, surcharge, interest rate or amount in a client email.
- calculate the deadline for the VAT Annual Accounting Scheme (see below), for a
  period that does not end on the last day of a month, or for anything other than
  a standard VAT return. Those need `HMRC Due Date`, and without it no reminder is sent.
- move the deadline for a weekend or bank holiday. gov.uk says it is not moved.

## Register

Status values: **Verified** means the rule is stated on the gov.uk page named.
**UNVERIFIED** means it is not stated there, is inferred or taken from general
practice, and a person must confirm it before the kit is relied on.

| Rule | Value used | Source | Last checked | Status |
|---|---|---|---|---|
| VAT return deadline | One calendar month and 7 days after the end of the accounting period (`returnDeadline` in `vat-rules.json`) | https://www.gov.uk/submit-vat-return, "When to do a VAT Return", Deadlines: "The deadline for submitting your return online is usually one calendar month and 7 days after the end of an accounting period." | 2026-10-02 | Verified. The word "usually" means HMRC can set a different date for a particular business: see the due date override below |
| Payment deadline | The same date as the return. The client emails say a payment is due by then, and that a Direct Debit is collected 3 working days after the deadline (see the Direct Debit row) | https://www.gov.uk/submit-vat-return, Deadlines: "This is also the deadline for paying HMRC. You need to allow time for the payment to reach HMRC's account." | 2026-10-02 | Verified |
| Weekends and bank holidays | The deadline is **not** moved. The kit never rolls it forward or back, and the client email says so when a deadline falls on one | https://www.gov.uk/submit-vat-return, Deadlines: "You must submit your return and make sure your payment reaches HMRC on or before the deadline, even if it's on a weekend or bank holiday." | 2026-10-02 | Verified |
| Where the exact date comes from | A practice may type the date from the client's VAT online account in the `HMRC Due Date` column; it then overrides the calculation | https://www.gov.uk/submit-vat-return: "Use your VAT online account to: find out when your VAT Returns are due" | 2026-10-02 | Verified that the account is the authority. The override is a safety valve, not a rule |
| Period ends on the last day of a month | Calculated: the last day of the next month, then 7 days, so 31 March gives 7 May, 30 June gives 7 August, 30 September gives 7 November and 31 December gives 7 February (`onlyMonthEndPeriodsCalculated`) | Regulation 25(1), Value Added Tax Regulations 1995 (SI 1995/2518), https://www.legislation.gov.uk/uksi/1995/2518/regulation/25: a return is due "not later than the last day of the month next following the end of the period to which it relates" (read 2026-10-02). The extra 7 days for online returns are from the gov.uk page above | 2026-10-02 | The month part is verified in the Regulations and the 7 days on gov.uk, but **no single source states the combined result**, and the Regulation's text is for quarterly periods. **UNVERIFIED** as a combination: compare against the due dates in a few clients' VAT online accounts, including 30 April and 30 November quarter ends |
| A period end that is not the last day of a month | **Not calculated.** The row is listed as needing attention and **no reminder is sent** until the due date from the client's VAT online account is typed into `HMRC Due Date`. A calendar-month rule would be wrong here: regulation 25(1) gives the last day of the next month, not the same day | https://www.legislation.gov.uk/uksi/1995/2518/regulation/25; gov.uk does not state a rule for these periods | 2026-10-02 | Deliberately not encoded, so a client is never given a date the kit cannot support |
| Schemes with the same return deadline | Standard, Flat Rate, Cash Accounting, Retail schemes and staggered quarters or monthly returns are treated as having the standard return deadline (`schemes.sameReturnDeadline`) | https://www.gov.uk/submit-vat-return describes the VAT Return deadline without a scheme exception, but the Flat Rate, Cash Accounting and Retail pages were not read | 2026-10-02 | **UNVERIFIED** for the three named schemes |
| VAT Annual Accounting Scheme | **Not calculated.** A row with `VAT Scheme` set to "Annual Accounting" is skipped and listed as needing attention. For reference gov.uk gives a different rule: return due 2 months after the end of the accounting period if it is 4 to 12 months long, 1 month if shorter | https://www.gov.uk/vat-annual-accounting-scheme, Return and payment deadlines | 2026-10-02 | Verified as stated. Deliberately not encoded, so the client is never given the wrong date |
| Direct Debit timing | Wording only (`src/core/copy.js`): the client email says a Direct Debit is collected 3 working days after the deadline and the return is still due on the date. The practice may also note that a Direct Debit must be set up at least 3 working days before the return is submitted | https://www.gov.uk/pay-vat, Pay by Direct Debit | 2026-10-02 | Verified as stated. Not used in any calculation |
| Making Tax Digital for VAT | Not encoded. gov.uk: VAT-registered businesses must keep digital records and submit returns using Making Tax Digital compatible software. A client with an exemption sends returns another way; the reminder still applies | https://www.gov.uk/submit-vat-return, How to send your VAT Return; https://www.gov.uk/charge-reclaim-record-vat, Keeping VAT records | 2026-10-02 | Verified as stated. The kit does not submit anything, so does not depend on it |
| The pre-submission checklist in the client email | Five prompts: invoices recorded, accounts reconciled, adjustments recorded, figures moved between programs digitally rather than retyped, anything outstanding sent to the practice (`CHECKLIST` in `src/core/copy.js`) | Paraphrases the digital records list at https://www.gov.uk/charge-reclaim-record-vat, Keeping VAT records (supplies made and received, time and value of supply, adjustments to a return) and the digital links requirement in https://www.gov.uk/government/publications/vat-notice-70022-making-tax-digital-for-vat | 2026-10-02 | **UNVERIFIED** as to the precise wording of the digital links rule. The checklist is a prompt, not advice on what MTD requires of a particular business. A person at the practice must read and approve the wording |
| Penalties for a late return | Not stated in any email and not encoded. gov.uk describes a points-based system for accounting periods starting on or after 1 January 2023 | https://www.gov.uk/submit-vat-return, Late returns and payment | 2026-10-02 | Verified as read. Left out on purpose because the figures change |
| Bank holidays, England and Wales, Scotland and Northern Ireland, 2019 to 2028 | `bank-holidays.json`, the gov.uk feed stored unmodified. Used **only** for the practice's sending calendar and to tell a client a deadline falls on a bank holiday. Never to move a deadline | https://www.gov.uk/bank-holidays.json | 2026-10-02, downloaded from the URL and compared byte for byte | Copied from the primary source. A person has not yet confirmed the division that applies to your practice |
| Which bank holiday list applies | `england-and-wales` by default; set `BANK_HOLIDAY_DIVISION` to `scotland` or `northern-ireland` | The three divisions in the gov.uk feed above | 2026-10-02 | Choice belongs to the practice |
| Reminder days before the deadline | 21, 14, 7 and 3 (`practiceDefaults.reminderDays`; `CHECKLIST_MILESTONE_DAYS`) | Not a rule. A practice convention | n/a | Default only. Set it to match your own service standards |
| No email at weekends or on bank holidays | Off-switches `SEND_ON_WEEKENDS`, `SEND_ON_BANK_HOLIDAYS` | Not a rule. A practice convention | n/a | Default only |
| No email from 24 December to 1 January | Quiet period in `src/core/config.js` | Not a rule. A practice convention | n/a | Default only |
| Send ceiling of 50 emails a run | `practiceDefaults.maxEmailsPerRun`; `MAX_EMAILS_PER_RUN` | Not a rule. A safety limit | n/a | Default only |
| Submitted returns are logged only for period ends in the last 150 days | `practiceDefaults.confirmationLookbackDays` | Not a rule. Stops the first run logging the sheet's whole history | n/a | Default only |

## The UNVERIFIED items, in one place

Do not rely on the calculated date for a real client until a person has done this:

1. Take five or more clients with different VAT quarter ends. Open each client's
   VAT online account and compare the due date it shows with the date the kit
   calculates (the 08:30 preview lists them, and `docs/EMAILS.md` shows the
   wording). Include a 30 April and a 30 November quarter end.
2. Any client whose date differs gets the date from their VAT online account typed
   into `HMRC Due Date`. So does every client whose VAT period does not end on the
   last day of a month: the kit sends them nothing until that cell is filled in.
3. Confirm the Flat Rate, Cash Accounting and Retail scheme clients have the
   standard return deadline, or enter their dates in `HMRC Due Date` too.
4. Read and approve the checklist wording in `src/core/copy.js`.

## The bank holiday file

`rules/bank-holidays.json` must stay exactly as gov.uk publishes it. The kit
reads only the `date` of each event in the division you choose.

- SHA-256 of the file as downloaded on 2026-10-02:
  `538b3482c28b85ecd2db606a0d5ae6ad17248900b6498700ce0a48d26a3ecde6`
- A test compares the file with the checksum above, so a hand edit fails the build.
- **Coverage ends at the last date in the file (Boxing Day 2028).** After that,
  the kit treats every weekday as a sending day. Refresh the file well before then.

### How to refresh it

1. Download https://www.gov.uk/bank-holidays.json and save it over `rules/bank-holidays.json` without changing it.
2. Replace the checksum above with `sha256sum rules/bank-holidays.json`.
3. Run `npm run build` (the file is bundled into the workflow) and `npm test`.

## How to refresh the VAT rules

1. Re-read the pages listed under `sources` in `vat-rules.json`.
2. If a rule changed, edit `returnDeadline` (or `schemes`), update the table above, and
   change the worked examples in `tests/unit/deadline.test.js` to match. The tests should fail first, to show they notice.
3. Set `validAsOf` and each source's `lastChecked` to today.
4. Run `npm run build` (the file is bundled into the workflow) and `npm test`.

A rule change that affects deadlines already in your sheet, or this register, goes
to a person at the practice before it is released.
