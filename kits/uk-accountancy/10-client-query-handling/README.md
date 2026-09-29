# Client Query Handling & SLA Tracker

## What this kit does

Gives clients a simple form to submit a query, automatically logs it, assigns it to a staff member on a rotation, computes a due-by date based on an urgency-driven SLA (Service Level Agreement), and sends the client an acknowledgement with the expected response time. A separate scheduled check then watches for queries approaching or breaching their SLA and alerts the assigned staff member (or manager) so nothing slips through.

## Who it's for

UK accountancy practices that want a lightweight, consistent way to receive and track client queries with a promised response time, rather than relying on ad-hoc email threads that are easy to lose track of.

## How it works

1. **Client Query Form** — `formTrigger`, a client-facing form capturing Client Name, Query Type (Tax Question / Document Request / Invoice Query / General), Description, Urgency (Urgent / Normal), and Client Email.
2. **Compute SLA & Assign Staff** — `code`, generates a Query ID, computes the `Due By` date using business-day arithmetic (Urgent = 1 business day, Normal = 3 business days by default), and assigns the query to a staff member from a configured rotation list.
3. **Log Query to Sheet** — `googleSheets`, appends the query to the "Client Queries" sheet (Query ID, Client, Client Email, Type, Description, Urgency, Received Date, Assigned To, Status, Due By).
4. **Send Acknowledgement Email** — `emailSend`, confirms receipt to the client and states the expected response time.
5. **SLA Check Schedule** — `scheduleTrigger`, runs every few hours (default: every 4 hours) to check the log for SLA risk.
6. **Read Client Queries** — `googleSheets`, reads the full "Client Queries" sheet.
7. **Filter Open Queries** — `filter`, keeps only queries not yet marked `Closed`.
8. **Check SLA Breach/Warning** — `code`, compares each open query's `Due By` to now, tagging it `approaching` (within a configurable warning window) or `breached`.
9. **Alert Assigned Staff & Manager** — `emailSend`, sends an alert naming the query, client, assigned staff member, and due date whenever a query is approaching or has breached its SLA.

## Setup

1. Import `workflow.json` into n8n.
2. Publish the Form Trigger node (n8n generates a public form URL) and share/embed it wherever clients submit queries.
3. Create a Google Sheet "Client Queries" with columns: `Query ID`, `Client`, `Client Email`, `Type`, `Description`, `Urgency`, `Received Date`, `Assigned To`, `Status`, `Due By`. Add a Google Sheets credential in n8n and attach it to both Sheets nodes.
4. Add an SMTP/Email credential and attach it to both email nodes.
5. Configure `STAFF_ROTATION`, `SLA_URGENT_DAYS`, `SLA_NORMAL_DAYS`, `SLA_WARNING_HOURS`, sender/manager emails in `.env.example`.
6. Activate the workflow.

## Customization ideas

- Replace the stateless round-robin (based on current minute) with a persisted counter in a sheet/database for a true fair rotation, or route by Query Type to specialist staff instead of round robin.
- Add a client-facing status page or reply-to-close mechanism so clients can see progress without emailing in.
- Add a "Status" update step so staff can mark a query "In Progress" or "Closed" via a simple form, feeding back into the same sheet.
- Track average response time per staff member for performance reporting.

## Disclaimer

This is a workflow template provided for general automation purposes only. SLA timings shown here are illustrative defaults — set them to match your firm's actual service commitments and engagement letters. It is not legal, tax, or professional advice. Verify your client-query and response-time processes against your firm's own policies and current professional body guidance before relying on it in practice.
