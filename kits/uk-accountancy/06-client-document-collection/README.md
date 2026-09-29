# Client Document Collection Tracker

## What this kit does

Automates the repetitive job of chasing clients for the documents needed to complete their year-end accounts, tax return, or other job (bank statements, receipts, payroll records, dividend vouchers, etc.), and lets a simple "sent" reply mark the item as received without the accountant manually updating a spreadsheet.

The workflow has two independent triggers sharing one Google Sheet:

1. **Chase Schedule** — runs every few days, reads the checklist, filters to outstanding (not-yet-received) items, groups them by client, and sends one consolidated email per client listing everything still needed.
2. **Webhook: Mark Received** — a lightweight inbound endpoint (wire it to a form, a portal button, or a mail-parsing rule) that flips a checklist row to "Received" when a client confirms they've sent something.

## Who it's for

UK accountancy practices running year-end accounts, self-assessment, or payroll onboarding jobs where each client needs to supply a defined bundle of documents before work can start. Useful for practices of any size that currently chase documents manually by email or phone.

## How it works

1. **Chase Schedule (every 3 days)** — `scheduleTrigger`, fires on an interval (default every 3 days; adjust to your chase cadence).
2. **Read Document Checklist** — `googleSheets`, reads the "Checklist" sheet containing columns: Client, Client Email, Job Type, Document Name, Received (Y/N), Date Requested, Date Received.
3. **Filter Outstanding Items** — `filter`, keeps only rows where `Received` is not `Y`.
4. **Group By Client** — `code`, groups the outstanding rows so each client gets a single record listing all their missing documents.
5. **Send Consolidated Chase Email** — `emailSend`, sends one email per client listing every outstanding document.
6. **Webhook: Mark Received** — `webhook`, a POST endpoint a client-facing form or portal can call with `{ Client, "Document Name" }` when a document has been supplied.
7. **Update Sheet: Mark Received** — `googleSheets`, updates the matching row's `Received` column to `Y` and stamps `Date Received`.

## Setup

1. Import `workflow.json` into n8n (Workflows → Import from File).
2. Create a Google Sheet named e.g. "Client Document Checklist" with a `Checklist` tab and columns: `Client`, `Client Email`, `Job Type`, `Document Name`, `Received`, `Date Requested`, `Date Received`.
3. Add a **Google Sheets** credential in n8n's credential store and attach it to both Google Sheets nodes.
4. Add an **SMTP / Email** credential and attach it to the Send Consolidated Chase Email node.
5. Set the environment/config values in `.env.example` (Sheet ID, sender address, chase interval).
6. Activate the workflow. Point your client-facing "mark as sent" form or portal button at the webhook URL produced by the Webhook node.

## Customization ideas

- Add a Slack notification summarising how many documents are still outstanding across all clients each run.
- Escalate to a "final reminder" tone (or CC the client's main contact) after N chases with no response.
- Replace the webhook with an IMAP trigger that parses "sent" replies automatically using keyword matching.
- Add a per-document-type default checklist template so new jobs auto-populate the sheet.

## Disclaimer

This is a workflow template provided for general automation purposes only. It is not legal, tax, or professional advice. Always verify your document-collection process against your firm's engagement letters, data-protection obligations (GDPR/UK DPA), and current guidance from HMRC and your professional body (e.g. ICAEW, ACCA, AAT) before relying on it in practice.
