# n8n-automation-kits
Free, tested n8n automation kits for UK accountancy and bookkeeping practices:
deadline reminders, client chasing and admin, built to UK rules. Every kit
drafts for your review and never files or submits anything on your behalf.

Want help putting these to work in your practice? See [Work with me](#work-with-me).

## Catalog

### UK Accountancy

| Kit | Description |
| --- | --- |
| [01-hmrc-deadline-reminders](kits/uk-accountancy/01-hmrc-deadline-reminders) | Staged email reminders for VAT, Self Assessment and Corporation Tax deadlines, driven by a Google Sheet client tracker. |
| [02-mtd-vat-reminders](kits/uk-accountancy/02-mtd-vat-reminders) | Calculates MTD VAT submission deadlines and sends a pre-submission digital records checklist to clients. |
| [03-companies-house-deadline-tracker](kits/uk-accountancy/03-companies-house-deadline-tracker) | Tracks Confirmation Statement and Annual Accounts deadlines, cross-checked against the Companies House public API. |
| [04-invoice-payment-chasing](kits/uk-accountancy/04-invoice-payment-chasing) | **Tested core; statutory rules awaiting sign-off (see its RULES.md).** Escalating GBP invoice chase emails with a preview before anything sends, one email per client, and statutory wording only where it applies. |
| [05-client-onboarding](kits/uk-accountancy/05-client-onboarding) | Form-triggered new client onboarding: AML/ID checklist, draft engagement letter, welcome email and HMRC 64-8 follow-up. |
| [06-client-document-collection](kits/uk-accountancy/06-client-document-collection) | Chases clients for outstanding year-end/tax documents and tracks receipt against a per-job checklist. |
| [07-missing-information-tracking](kits/uk-accountancy/07-missing-information-tracking) | Tracks open queries blocking job completion and escalates to staff/manager based on how long they've been outstanding. |
| [08-vat-return-preparation](kits/uk-accountancy/08-vat-return-preparation) | Pulls transaction data and drafts VAT return figures with anomaly flags for accountant review (no auto-submission to HMRC). |
| [09-email-triage-inbox-management](kits/uk-accountancy/09-email-triage-inbox-management) | Classifies inbound practice emails (client query / statutory / billing / uncategorised) and alerts on urgent items. |
| [10-client-query-handling](kits/uk-accountancy/10-client-query-handling) | Logs client queries from a form, auto-assigns staff, tracks SLA due dates and sends acknowledgement emails. |


### Coming soon

- **VAT registration threshold monitor**: rolling 12-month and 30-day
  forward checks against the VAT registration threshold.
- **Directors' loan account watchdog**: monthly early warning before a
  balance becomes an s455 problem.
- **Personalised client compliance calendar**: a per-client deadline
  calendar as a PDF and calendar file.
- **Companies House filing-history monitor**: alerts on unexpected filings,
  strike-off notices and possible company hijacks.
- **Duplicate and sequence-gap detector**: catches duplicate bills, duplicate
  bank lines and invoice-numbering gaps.
- **ECCTA identity verification tracker**: per-director and per-PSC ID
  verification deadlines from Companies House data.
- **MTD for Income Tax readiness**: sorts your Self Assessment clients by
  mandation date and tracks quarterly updates.

## Status

Kit 04 has been rebuilt around a tested core and is the reference for how the
rest will follow. The other nine are as first written and have known defects.

| | Kit 04 | Kits 01-03, 05-10 |
|---|---|---|
| Decision logic | One pure function, no I/O, never throws | Spread across Code nodes and expressions |
| Tests | 91, no credentials needed | None |
| `workflow.json` | Generated from the tested source; CI fails on drift | Hand-written |
| Static checks | Passes | 38 errors, 52 warnings between them |

Run `npm run lint` for the current report on all ten.

### Why kit 04 was rebuilt first

A multi-lens audit of all ten kits found defects that are invisible from reading
the JSON and that leave a run looking successful. Among them: Google Sheets
nodes with no `operation`, which default to reading rather than writing, so four
kits never record anything; a Loop node wired to its "done" output, so kit 03
has never contacted Companies House; write-back nodes reading `$json` straight
after an email node, whose output is the SMTP result rather than the row, so
"already chased" is never recorded and reminders repeat; and VAT deadline
arithmetic that is wrong for ten of the twelve period ends.

The linter in `scripts/lint-workflow.js` encodes each of those classes, so the
same mistakes cannot return quietly as the remaining kits are rebuilt.

## Working on this repository

```
npm test          # build check, lint, and 91 tests
npm run build     # regenerate kit 04's workflow.json from src/core
npm run lint      # static checks across every kit
npm run drift     # compare a live n8n workflow against this repo
```

## Work with me

Pick whatever suits you, from a free tool to a full hand-over:

<!-- CTA: free done-for-you install (TODO link) -->
- **Use the free MTD Fee Gap Calculator:** [see in two minutes](https://www.parambir.com/mtd-check) how much Making Tax Digital work your current fees are not paying for
- **Take the free Practice Value Diagnostic:** [see in pounds](https://www.parambir.com/scorecard) where your practice loses profit, cash and time, in about 8 minutes
- **Join the monthly newsletter:** [one email a month](https://www.parambir.com/newsletter) with new projects and notes on small-company automation, nothing else
- **Book a free 20-minute call:** [pick a time that suits you](https://www.parambir.com/call), no hard sell, just practical ideas for your practice
- **Email me:** [office@parambir.com](mailto:office@parambir.com)
- **More about me:** [parambir.com](https://www.parambir.com) and [LinkedIn](https://www.linkedin.com/in/parambir-randhawa)

## Licence

[MIT](LICENSE). Use the kits, adapt them, and share them. The kits send
reminders and draft figures for review. They are not tax advice.
