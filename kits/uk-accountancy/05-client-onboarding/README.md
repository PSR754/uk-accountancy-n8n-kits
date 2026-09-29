# New Client Onboarding (UK Accountancy Practice)

## What this kit does
Triggers when a prospective client submits a sign-up form, then automatically structures their details, generates an AML/ID-verification checklist tailored to their business type, drafts placeholder engagement letter content, emails them a welcome message with a document request list, follows up a few days later about HMRC agent authorisation (form 64-8), and logs the new client to a Google Sheet client register.

## Who it's for
UK accountancy practices who want a consistent, compliant first touch with every new client — covering AML obligations, engagement letter issuance and HMRC agent authorisation — without a partner having to manually kick off each step.

## How it works
1. **New Client Form** (`formTrigger`) — a public n8n form capturing Client/Business Name, Business Type (Sole Trader / Partnership / Limited Company / LLP), Contact Email, UTR or Company Number, and Services Required.
2. **Structure Client Data** (`set`) — maps the raw form fields into clean field names (`clientName`, `businessType`, `contactEmail`, `utrOrCompanyNumber`, `servicesRequired`, `onboardedDate`).
3. **Generate AML/ID Checklist** (`code`) — builds an AML/ID verification checklist, adding director/PSC or partner-specific ID requirements depending on business type, plus sanctions/PEP screening and risk assessment steps.
4. **Draft Engagement Letter** (`code`) — generates placeholder engagement letter text (scope of services, responsibilities, fees, liability, data protection) structured along the lines of common ICAEW/ACCA engagement letter guidance, clearly marked as a draft requiring review.
5. Two parallel actions:
   - **Send Welcome Email** (`emailSend`) — sends the client a welcome message listing the AML/ID documents needed and flagging that an engagement letter and HMRC authorisation request will follow.
   - **Log New Client to Register (Google Sheets)** — appends the client's details to a "Client Register" sheet, with `64-8 Submitted` and `Engagement Letter Signed` tracking columns defaulted to "No".
6. **Wait 3 Days** (`wait`) — pauses before following up.
7. **Send 64-8 Follow-Up Reminder** (`emailSend`) — reminds the client to complete HMRC agent authorisation (form 64-8 or a digital equivalent) if they haven't already, noting HMRC processing can take a few weeks.

## Setup
1. Import `workflow.json` into n8n.
2. Create a Google Sheet with a `Client Register` tab: Client Name, Business Type, Contact Email, UTR / Company Number, Services Required, Onboarded Date, 64-8 Submitted, Engagement Letter Signed.
3. Add a **Google Sheets credential** in n8n and attach it to "Log New Client to Register".
4. Add an **Email Send / SMTP (or Gmail) credential** and attach it to both email nodes.
5. Fill in `.env` from `.env.example` (`FIRM_NAME`, `SENDER_EMAIL`, `CLIENT_REGISTER_SHEET_ID`).
6. Activate the workflow — n8n will generate a public form URL from the Form Trigger node; share this link (e.g. on your website or in a sign-up email) for prospective clients to complete.
7. Have a qualified member of the practice review and finalise the draft engagement letter content and AML checklist against your firm's actual policies before it is used to generate real client-facing documents.

## Customization ideas
- Add a branch that generates an actual PDF engagement letter (e.g. via an HTTP Request to a document-generation API) instead of plain text.
- Add a task in your practice management tool to track outstanding AML documents per client.
- Add conditional logic so Limited Company / LLP clients also get a reminder to authorise you at Companies House (as well as HMRC) where relevant.
- Extend the follow-up sequence with a second reminder if `64-8 Submitted` is still "No" after 10 days.

## Disclaimer
This is a workflow template, not legal, tax or AML advice. AML/ID verification requirements, engagement letter standards (ICAEW/ACCA) and HMRC agent authorisation processes can change — always verify current requirements against your firm's AML policy, relevant professional body guidance, and official HMRC guidance (gov.uk) before relying on this system operationally, and have all client-facing engagement letters reviewed by a qualified professional before issue.
