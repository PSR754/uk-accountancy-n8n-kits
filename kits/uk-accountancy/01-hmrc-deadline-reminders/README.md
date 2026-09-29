# HMRC Filing Deadline Reminder System

## What this kit does
Monitors a client-by-client list of HMRC filing and payment deadlines (VAT, Self Assessment, Corporation Tax) and automatically emails staged reminders at 30, 14, 7 and 1 days before each due date. It updates the tracking sheet after each reminder so the same milestone is never emailed twice, and skips anything already marked as filed.

## Who it's for
UK accountancy practices and bookkeepers managing recurring statutory deadlines for multiple clients, where missed HMRC deadlines mean penalties for the client and reputational risk for the firm. Designed to sit alongside (not replace) practice management software — the sheet is the source of truth for due dates.

## How it works
1. **Daily Trigger 07:00** (`scheduleTrigger`) — runs once a day in the morning.
2. **Read Client Deadlines (Google Sheets)** — reads every row from the "Deadlines" sheet: Client Name, Deadline Type, Due Date, Contact Email, Status, Last Reminder Sent.
3. **Compute Days Until Due** (`code`) — calculates `daysUntilDue` for each row, flags whether today matches a reminder milestone (30/14/7/1 days out), and whether a reminder for that exact milestone has already been sent (using the `Last Reminder Sent` column as a de-duplication marker).
4. **Filter: Due For Reminder** (`filter`) — keeps only rows where `shouldSendReminder` is true (on a milestone, not already sent, not Filed/Cancelled).
5. **Draft Reminder Content** (`code`) — builds a subject line and email body whose tone escalates with urgency (Advance Notice → Reminder → Urgent Reminder → Final Reminder).
6. **Send Reminder Email** (`emailSend`) — sends the email to the client's contact address.
7. **Update Sheet Status** (`googleSheets`, update) — writes the milestone just sent back into `Last Reminder Sent` so the same reminder isn't repeated.

## Setup
1. Import `workflow.json` into n8n (Workflows > Import from File).
2. Create a Google Sheet named e.g. "HMRC Deadlines" with a tab called `Deadlines` and columns: `Client Name`, `Deadline Type`, `Due Date` (ISO format `YYYY-MM-DD` recommended), `Contact Email`, `Status`, `Last Reminder Sent`.
3. In n8n, add a **Google Sheets credential** (OAuth2 or service account) and attach it to both Google Sheets nodes.
4. Add an **Email Send / SMTP credential** (or swap the Email Send node for a Gmail node) and attach it to "Send Reminder Email".
5. Copy `.env.example` to `.env` (or set the equivalent n8n environment variables) and fill in `HMRC_CLIENT_LIST_SHEET_ID` and `SENDER_EMAIL`.
6. Populate the sheet with real deadlines per client. `Status` should start as e.g. `Pending`; set it to `Filed` once HMRC confirms receipt so reminders stop.
7. Activate the workflow.

## Customization ideas
- Add a Slack/Teams notification node so the practice's team also sees which reminders went out each day.
- Split "Deadline Type" into separate branches (VAT / SA / CT) with tailored email copy and CC to the responsible team member.
- Add an escalation path: if a deadline passes with Status still `Pending`, notify a manager rather than the client.
- Pull due dates automatically instead of manual entry, e.g. calculate VAT quarter-end + 1 month 7 days directly from a client's VAT stagger group.

## Disclaimer
This is a workflow template, not tax or legal advice. HMRC deadlines, penalty regimes and filing rules can change — always verify current dates and requirements against official HMRC guidance (gov.uk) before relying on this system for client-facing deadline management.
