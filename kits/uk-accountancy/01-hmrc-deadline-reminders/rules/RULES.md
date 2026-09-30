# Rules register

Every rule, date and threshold this kit relies on, where it comes from, and how
sure we are of it. A proof that the code follows a rule is worth nothing if the
rule is wrong, so this file is the part that needs a person to check, not the code.

## What this kit deliberately does not encode

**It does not calculate any HMRC or Companies House deadline.** The due date of
every return, payment or filing comes from the `Due Date` column of your own
sheet, entered by someone who has checked it. There is no deadline arithmetic in
the code: no "VAT quarter end plus one month and seven days", no Self Assessment
or Corporation Tax dates, no extension rules. Those rules change and depend on
the client's circumstances, so they are not this kit's to assert.

The client emails also state no penalty, interest rate, surcharge or amount.
They remind, and they ask the client to send anything outstanding. Adding your
own engagement-letter wording is left to you.

The only external rule the kit reads is the bank holiday calendar below. It
never files, submits or pays anything with HMRC or Companies House; its only
outputs are reminder emails and a preview of them.

## Register

| Rule | Value used | Source | Last checked | Status |
|---|---|---|---|---|
| Bank holidays, England and Wales, Scotland and Northern Ireland, 2019 to 2028 | `bank-holidays.json`, the gov.uk feed stored unmodified | https://www.gov.uk/bank-holidays.json | 2026-09-30, downloaded from the URL and stored byte for byte | Copied from the primary source. A person has not yet confirmed the division that applies to your practice |
| Which bank holiday list applies | `england-and-wales` by default; set `BANK_HOLIDAY_DIVISION` to `scotland` or `northern-ireland` | The three divisions in the gov.uk feed above | 2026-09-30 | Choice belongs to the practice |
| Reminder days before a due date | 30, 14, 7 and 1 | Not a rule. A practice convention, and configuration (`REMINDER_MILESTONE_DAYS`) | n/a | Default only. Set it to match your own service standards |
| No email at weekends or on bank holidays | Off-switches `SEND_ON_WEEKENDS`, `SEND_ON_BANK_HOLIDAYS` | Not a rule. A practice convention | n/a | Default only |
| No email from 24 December to 1 January | Quiet period in `src/core/config.js` | Not a rule. A practice convention | n/a | Default only |

Nothing in the register is marked `UNVERIFIED`, because nothing in it is a
statutory value taken on trust. The one external data set is copied from the
primary source, and everything else is a setting you own.

## The bank holiday file

`rules/bank-holidays.json` must stay exactly as gov.uk publishes it. The kit
reads only the `date` of each event in the division you choose.

- SHA-256 of the file as downloaded on 2026-09-30:
  `538b3482c28b85ecd2db606a0d5ae6ad17248900b6498700ce0a48d26a3ecde6`
- A test compares the file with the checksum above, so a hand edit fails the build.
- **Coverage ends at the last date in the file (Boxing Day 2028).** After that,
  the kit treats every weekday as a sending day. Refresh the file well before then.

### How to refresh it

1. Download https://www.gov.uk/bank-holidays.json and save it over `rules/bank-holidays.json` without changing it.
2. Replace the checksum above with `sha256sum rules/bank-holidays.json`.
3. Run `npm run build` (the file is bundled into the workflow) and `npm test`.

## Before go-live

Two checks need a person, and neither is something the tests can do:

1. Confirm the division in `BANK_HOLIDAY_DIVISION` is the right one for your practice.
2. Confirm the due dates in your sheet against gov.uk and HMRC's own guidance.
   The kit reminds about whatever date you give it, correct or not.

The tests check that every date in the bank holiday file is real, falls on a
weekday, and is in order. That catches corruption, not a wrong date.
