# Missing Information Tracker

## What this kit does

Tracks any open query or piece of missing information blocking completion of a client job — not just documents, but things like "confirm treatment of X expense" or "need explanation for unusual transaction." It computes how long each query has been open, escalates internally (to the assigned staff member, then the practice manager) when queries stall, and separately reminds the client when a query needs their input.

## Who it's for

UK accountancy practices with a shared "queries" log used across accounts prep, tax, and audit work, where queries can silently go stale because nobody is chasing them systematically. Useful for firms wanting visibility into which jobs are blocked and why.

## How it works

1. **Daily Check** — `scheduleTrigger`, runs once a day.
2. **Read Outstanding Queries** — `googleSheets`, reads the "Outstanding Queries" sheet with columns: Client, Client Email, Job, Query, Raised Date, Status, Assigned To, Assigned To Email, Needs Client Input.
3. **Filter Open Queries** — `filter`, keeps rows where `Status` is not `Resolved`.
4. **Compute Days Open & Escalation** — `code`, calculates `daysOpen` from `Raised Date` and assigns an `escalation` level (`none` / `staff` / `manager`) based on configurable thresholds.
5. **Route By Escalation Level** — `switch`, branches queries into "Notify Assigned Staff" or "Escalate to Manager" paths based on the computed level.
6. **Notify Assigned Staff** — `emailSend`, reminds the assigned team member of the open query.
7. **Escalate to Manager** — `emailSend`, alerts the practice manager once a query has been open beyond the manager threshold.
8. **Needs Client Input?** — `if`, checks the `Needs Client Input` flag in parallel.
9. **Send Client Reminder** — `emailSend`, reminds the client directly when their input is what's blocking the query.
10. **Update Sheet** — `googleSheets`, writes back `Days Open` and `Last Escalated` for reporting.

## Setup

1. Import `workflow.json` into n8n.
2. Create a Google Sheet "Outstanding Queries" with columns: `Client`, `Client Email`, `Job`, `Query`, `Raised Date`, `Status`, `Assigned To`, `Assigned To Email`, `Needs Client Input`, `Days Open`, `Last Escalated`.
3. Add Google Sheets and SMTP/Email credentials in n8n's credential store and attach them to the relevant nodes.
4. Configure the values in `.env.example` (sheet ID, escalation thresholds, manager email).
5. Activate the workflow.

## Customization ideas

- Post escalations to a Slack/Teams channel instead of (or as well as) email.
- Add a weekly digest of all open queries grouped by assigned staff member.
- Add a "reopened" counter to flag queries that keep bouncing back and forth.
- Tie escalation thresholds to job deadline proximity rather than a flat day count.

## Disclaimer

This is a workflow template provided for general automation purposes only. It is not legal, tax, or professional advice. Verify your internal query-management and escalation process against your firm's own procedures and current guidance from HMRC and your professional body before relying on it in practice.
