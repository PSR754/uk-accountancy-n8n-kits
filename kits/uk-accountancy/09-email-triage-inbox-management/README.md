# Email Triage & Inbox Management

## What this kit does

Watches a shared practice inbox, classifies each new email using simple rule-based matching (statutory notices, billing, known client queries, or uncategorised), logs every email to a central sheet so nothing gets lost, and immediately alerts the practice manager when an email contains urgent keywords (e.g. "urgent", "deadline", "HMRC investigation").

## Who it's for

UK accountancy practices whose main inbox receives a mix of client queries, HMRC/Companies House notices, supplier invoices, and spam, and who want a lightweight first-pass triage layer without adopting a full helpdesk system.

## How it works

1. **New Inbox Email (IMAP)** — `emailReadImap`, triggers on new mail arriving in the practice inbox (swap for `gmailTrigger` if using Gmail/Google Workspace).
2. **Extract Sender, Subject, Snippet** — `code`, pulls out the sender address, subject line, and a short text snippet from the raw email.
3. **Classify Email** — `code`, rule-based classification:
   - Subject contains "HMRC" or "Companies House" → **Statutory**
   - Subject contains "invoice" or "payment" → **Billing**
   - Sender's domain matches a configured list of known client domains → **Client Query**
   - Otherwise → **Uncategorised**
   Also flags the email as urgent if the subject or snippet contains any configured urgent keyword.
4. **Log to Inbox Log Sheet** — `googleSheets`, appends a row to "Inbox Log" with Category, Sender, Subject, Received Date, Status (defaults to "Unread"), and Urgent flag.
5. **Urgent Keyword Detected?** — `if`, branches in parallel to the logging step.
6. **Alert Practice Manager** — `emailSend`, sends an immediate alert with the sender, subject, category, and snippet when urgency is detected.

## Setup

1. Import `workflow.json` into n8n.
2. Add an **IMAP** (or Gmail) credential in n8n's credential store for the practice inbox and attach it to the trigger node.
3. Create a Google Sheet "Inbox Log" with columns: `Category`, `Sender`, `Subject`, `Received Date`, `Status`, `Urgent`. Add a Google Sheets credential and attach it to the Log node.
4. Add an SMTP/Email credential for outbound alerts and attach it to the Alert node.
5. Configure `KNOWN_CLIENT_DOMAINS` and `URGENT_KEYWORDS` in `.env.example` to match your client base and escalation priorities.
6. Activate the workflow.

## Customization ideas

- Replace the sheet log with actually moving/labelling the email in the mailbox (e.g. via IMAP move actions or Gmail labels) once classified.
- Add a "Spam/Newsletter" category with a keyword or sender-pattern rule to reduce inbox noise further.
- Send category-specific emails to different team distribution lists (e.g. Statutory → compliance team, Billing → bookkeeping team) using a `switch` node instead of a single log step.
- Track response times by adding a "First Response Sent" timestamp updated from a separate workflow.

## Disclaimer

This is a workflow template provided for general automation purposes only. Rule-based classification is approximate and can misclassify or miss messages — it should supplement, not replace, someone actually reading the inbox, especially for anything time-sensitive or statutory. It is not legal, tax, or professional advice. Verify your inbox-management process against your firm's own procedures and current HMRC/professional body guidance before relying on it in practice.
