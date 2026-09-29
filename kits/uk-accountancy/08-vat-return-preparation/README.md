# VAT Return Preparation Workflow

## What this kit does

Pulls sales and purchase transaction data for a VAT period from a bookkeeping/accounting system's API, calculates a draft VAT return (Box 1–7 style figures: output VAT, input VAT, net VAT due, total sales/purchases ex VAT), flags transactions that look like they need a human look (unusually large amounts, negative VAT, purchases above the VAT-registration threshold missing a supplier VAT number), and emails a draft summary to the reviewing accountant.

**This workflow does NOT submit anything to HMRC.** It is a preparation and review aid only — the actual submission must still be done manually through your firm's MTD-compatible bookkeeping/filing software after a qualified accountant has reviewed the draft.

## Who it's for

UK accountancy practices and in-house bookkeeping teams who prepare VAT returns from client transaction data and want a first-pass draft plus an anomaly checklist before doing the real review and MTD submission — distinct from a "reminder" kit that just nags about the deadline.

## How it works

1. **Quarterly VAT Prep Schedule** / **Manual Trigger** — either a `scheduleTrigger` (default: 6am on the 1st of every 3rd month) or a manual trigger to run the prep for a specific client/period on demand.
2. **Fetch Sales Transactions** — `httpRequest`, GETs sales transactions for the VAT period from a generic accounting API (placeholder base URL — point this at whatever bookkeeping system's REST API your practice uses, e.g. Xero, QuickBooks, FreeAgent, or an in-house system).
3. **Fetch Purchase Transactions** — `httpRequest`, GETs purchase transactions for the same period.
4. **Merge Sales & Purchases** — `merge`, combines both responses into a single item for downstream processing.
5. **Compute Draft VAT Figures** — `code`, calculates Box 1 (VAT due on sales), Box 3 (total VAT due), Box 4 (VAT reclaimed on purchases), Box 5 (net VAT due), Box 6 (total sales ex VAT), Box 7 (total purchases ex VAT).
6. **Flag Anomalies** — `code`, checks for large transactions above a threshold, negative VAT amounts, and purchases above the VAT-number-required threshold with no supplier VAT number recorded.
7. **Format Draft Summary** — `set`, builds a plain-text draft summary clearly labelled "FOR REVIEW ONLY, NOT SUBMITTED."
8. **Email Draft to Reviewing Accountant** — `emailSend`, sends the draft summary to the accountant responsible for sign-off.

**Note on API data shape:** this template assumes the accounting API returns transaction objects with fields like `amountExVat`, `vatAmount`, `vatRate`, `supplierVatNumber`, and that your integration node adapts the raw API response into the `{ sales: [...], purchases: [...] }` shape the Code node expects. Adjust the HTTP Request and Code nodes to match your actual accounting system's API response format.

## Setup

1. Import `workflow.json` into n8n.
2. Set `ACCOUNTING_API_BASE_URL` and obtain an API token for your bookkeeping system (see `.env.example`); store the token itself as an n8n credential/header auth rather than hardcoding it, if your accounting system supports it.
3. Add an SMTP/Email credential in n8n's credential store and attach it to the Email node.
4. Configure `VAT_PERIOD_START`, `VAT_PERIOD_END`, `REVIEWING_ACCOUNTANT_EMAIL`, `PRACTICE_SENDER_EMAIL`, `CLIENT_NAME`, and the anomaly thresholds.
5. Test with the Manual Trigger against a known period before relying on the schedule.
6. Activate the workflow once the API integration and figures have been validated against a manual calculation.

## Customization ideas

- Add a per-client loop (`splitInBatches`) to run this across every VAT-registered client automatically.
- Store draft summaries in a Google Sheet or database for an audit trail of what was reviewed and when.
- Add EU/import VAT handling (Box 2/Box 9) if the practice has clients trading with the EU or importing goods.
- Add a second review/approval step (e.g. a form the accountant fills in to confirm sign-off) before treating the period as "ready for submission."

## Disclaimer

This is a workflow template provided for general automation purposes only. **It does not submit VAT returns to HMRC and must never be configured to do so without a qualified reviewer's sign-off.** It is not legal, tax, or professional advice. VAT rules, thresholds, and MTD requirements change — always verify figures and process against current HMRC guidance and your professional body (e.g. ICAEW, ACCA, AAT) before submission.
