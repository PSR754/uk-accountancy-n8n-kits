# Making Tax Digital (MTD) VAT Reminder & Checklist

## What this kit does
Calculates each VAT-registered client's MTD submission deadline (1 month + 7 days after their VAT quarter end) and emails a pre-submission checklist at 21, 14, 7 and 3 days before that deadline, covering the digital record-keeping checks MTD requires. Once a client is marked as submitted, it logs a confirmation entry and stops sending checklists for that period.

## Who it's for
UK accountancy practices managing VAT-registered clients under Making Tax Digital, who need a consistent, repeatable nudge process to make sure digital records are current and bridging/MTD software is reconciled before each quarterly (or monthly/annual) VAT return is submitted.

## How it works
1. **Daily Trigger 08:00** (`scheduleTrigger`) — runs once a day.
2. **Read VAT Client List (Google Sheets)** — reads Client Name, Contact Email, VAT Quarter End, Submitted, Last Checklist Sent from the "VAT Clients" tab.
3. **Calculate Submission Deadline** (`code`) — adds 1 month + 7 days to each client's VAT quarter end to derive `submissionDeadline`, and computes `daysUntilDeadline`.
4. Two parallel branches:
   - **Filter: Checklist Due** → keeps rows not yet submitted and at a 21/14/7/3-day milestone → **Build Checklist Email** (`code`, drafts the checklist copy) → **Send Checklist Email** (`emailSend`) → **Log Checklist Sent** (`googleSheets`, records which milestone was last emailed to avoid duplicates).
   - **Filter: Newly Submitted** → keeps rows where `Submitted` = "Yes" → **Log Submission Confirmation** (`googleSheets`, appends a confirmation row to the "Submission Log" tab with today's date).

## Setup
1. Import `workflow.json` into n8n.
2. Create a Google Sheet with:
   - Tab `VAT Clients`: Client Name, Contact Email, VAT Quarter End (`YYYY-MM-DD`), Submitted (Yes/No), Last Checklist Sent.
   - Tab `Submission Log`: Client Name, VAT Quarter End, Confirmed Submitted On.
3. Add a Google Sheets credential in n8n and attach it to all Google Sheets nodes.
4. Add an Email Send / SMTP (or Gmail) credential and attach it to "Send Checklist Email".
5. Fill in `.env` from `.env.example` — set `MTD_VAT_CLIENTS_SHEET_ID` and `SENDER_EMAIL`.
6. Have your team (or the client, if self-service) flip `Submitted` to `Yes` once the VAT return has actually gone to HMRC.
7. Activate the workflow.

## Customization ideas
- Add branch logic for clients on the Annual Accounting or Flat Rate Scheme, whose submission cadence differs.
- Add a second reminder path that nudges the internal team (not the client) if `Submitted` is still "No" after the deadline has passed.
- Auto-populate `VAT Quarter End` for the next period once a submission is confirmed, so the sheet self-maintains.
- Add an HTTP Request node to an MTD-compatible bridging software API to pull real submission status instead of a manual column.

## Disclaimer
This is a workflow template, not tax or legal advice. MTD rules, VAT return deadlines and digital record-keeping requirements can change — always verify current requirements against official HMRC Making Tax Digital guidance (gov.uk) before relying on this system operationally.
