# Companies House Deadline Tracker

## What this kit does
Tracks each client company's Confirmation Statement and Annual Accounts deadlines, cross-checks live data from the Companies House public API where available, and sends a compliance-team reminder email when either deadline is 30, 14, 7 or 1 day(s) away.

## Who it's for
UK accountancy practices acting as company secretary or compliance point of contact for limited company clients, who need to keep on top of statutory filing deadlines (Confirmation Statement every 12 months, Annual Accounts 9 months after the accounting reference date) across a portfolio of companies.

## How it works
1. **Daily Trigger 07:00** (`scheduleTrigger`) — runs once a day.
2. **Read Client Company List (Google Sheets)** — reads Company Name, Company Number, Confirmation Statement Due, Accounts Due, Contact Email from the "Companies" tab.
3. **Split In Batches (per company)** — processes companies one at a time so each gets its own API lookup.
4. **Verify Company (Companies House API)** (`httpRequest`) — calls `GET https://api.company-information.service.gov.uk/company/{Company Number}` using HTTP Basic Auth (API key as username) to pull the live company status and next-due dates when available.
5. **Merge & Compute Days Remaining** (`code`) — prefers the API's `confirmation_statement.next_due` / `accounts.next_due` values when present, otherwise falls back to the sheet's manually-entered dates, then computes days remaining for each.
6. **Filter: Deadline Approaching** (`filter`) — keeps companies where either deadline sits at a 30/14/7/1-day milestone.
7. **Draft Reminder Content** (`code`) — builds a summary email listing which deadline(s) are approaching and the company's current status.
8. **Send Reminder Email** (`emailSend`) — sends the reminder to the internal compliance team mailbox (easy to repoint to the client directly).

## Setup
1. Import `workflow.json` into n8n.
2. Create a Google Sheet with a `Companies` tab: Company Name, Company Number, Confirmation Statement Due (`YYYY-MM-DD`), Accounts Due (`YYYY-MM-DD`), Contact Email.
3. Register for a Companies House API key at https://developer.company-information.service.gov.uk/ (free, for the public data API).
4. In n8n, create an **HTTP Basic Auth credential** with the API key as the username and an empty password, and attach it to "Verify Company (Companies House API)".
5. Add a **Google Sheets credential** and attach it to "Read Client Company List".
6. Add an **Email Send / SMTP (or Gmail) credential** and attach it to "Send Reminder Email".
7. Fill in `.env` from `.env.example`.
8. Activate the workflow.

## Customization ideas
- Route the reminder to the client's own contact email instead of (or as well as) the internal compliance mailbox once the deadline is inside 14 days.
- Add a branch that automatically drafts the Confirmation Statement filing task in your practice management tool via its API.
- Cache API responses per company (e.g. weekly) rather than calling Companies House daily, to stay comfortably within rate limits on larger client banks.
- Add handling for dormant/dissolved company statuses to auto-flag companies that no longer need chasing.

## Disclaimer
This is a workflow template, not legal advice. Companies House filing deadlines, penalty rules and API terms can change — always verify current requirements against official Companies House guidance (gov.uk) and the Companies House Developer Hub before relying on this system operationally.
