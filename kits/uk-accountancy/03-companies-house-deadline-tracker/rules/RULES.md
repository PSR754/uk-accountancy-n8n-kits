# Rules register

Every statutory fact this kit relies on, with its primary source. The numbers
themselves are data in [`deadline-rules.json`](deadline-rules.json), not code.

**Valid as of: 5 October 2026.** On that date the text of the first four pages
below was retrieved and the values in this file were checked against it, and a
separate compliance review read sections 442 and 853A of the Companies Act 2006
on legislation.gov.uk and confirmed them as up to date at 5 October 2026. The
Companies House API reference could not be read (it renders in JavaScript).
Re-read every source before relying on this file after that date, and update
`validAsOf` in `deadline-rules.json` when you do.

Each value is asserted by a test. Change a value here and in
`deadline-rules.json` together, then run `npm test`.

## Sources

| Short name | Page | Last updated on the page |
|---|---|---|
| ACCOUNTS | Preparing and filing Companies House accounts, https://www.gov.uk/government/publications/filing-your-companies-house-accounts/life-of-a-company-part-1-accounts | 25 September 2026 |
| OVERVIEW | Prepare annual accounts for a private limited company, https://www.gov.uk/prepare-file-annual-accounts-for-limited-company | not shown |
| CS | Filing your company's confirmation statement, https://www.gov.uk/guidance/confirmation-statement-guidance | 21 April 2026 |
| API-LIMITS | Companies House API rate limiting, https://developer-specs.company-information.service.gov.uk/guides/rateLimiting | not shown |
| LEGISLATION | Companies Act 2006 section 442 (accounts: period for filing) https://www.legislation.gov.uk/ukpga/2006/46/section/442 and section 853A (confirmation statements: review period) https://www.legislation.gov.uk/ukpga/2006/46/section/853A | read by the compliance review, up to date at 5 October 2026 |

## The register

"Documented" means the cited page states it. "UNVERIFIED" means it is an
assumption or an inference that no page confirms. Every UNVERIFIED rule is
labelled **Needs human confirmation** wherever it affects a date in the digest,
and the person reading the digest is told to check the register.

| ID | Rule | Value in `deadline-rules.json` | Source | Status |
|---|---|---|---|---|
| R-01 | Private company annual accounts are due this many months after the end of the accounting reference period | `accounts.privateMonthsAfterPeriodEnd` = 9 | ACCOUNTS section 5; OVERVIEW | Documented |
| R-02 | Public company annual accounts are due this many months after the end of the accounting reference period | `accounts.publicMonthsAfterPeriodEnd` = 6 | ACCOUNTS section 5 | Documented |
| R-03 | A period of months ends on the corresponding date (4 April + 9 months = 4 January). If the accounting reference date is the last day of a month, it ends on the last day of the target month (30 April + 9 months = 31 January) | `addMonths` in `dates.js`, `monthEndSticky` | ACCOUNTS section 5.1 | Documented |
| R-04 | When the corresponding date does not exist in the target month (for example 31 May + 21 months) the last day of that month is used | none (flagged in the digest) | none | **UNVERIFIED** |
| R-05 | First accounts that cover more than 12 months, private company: the longer of 21 months after incorporation and 3 months after the accounting reference date | `accounts.firstAccounts.privateMonthsAfterIncorporation` = 21, `minimumMonthsAfterPeriodEnd` = 3 | ACCOUNTS section 5.2 (worked example: incorporated 1 January 2025, deadline 1 October 2026); OVERVIEW. The "whichever is longer" combination is R-19; Companies Act 2006 s442(3) | Documented |
| R-06 | First accounts that cover more than 12 months, public company: the longer of 18 months after incorporation and 3 months after the accounting reference date | `accounts.firstAccounts.publicMonthsAfterIncorporation` = 18 | ACCOUNTS section 5.2; Companies Act 2006 s442(3) | Documented |
| R-07 | First accounts covering 12 months or less use the normal 9 or 6 month period | R-01, R-02 | ACCOUNTS section 5.2; Companies Act 2006 s442(3) | Documented |
| R-08 | A first period counts as "more than 12 months" when its end is on or after the first anniversary of incorporation. This decides whether the first-accounts rule (R-05, R-06, R-19) applies at all, so a wrong boundary changes the deadline by months | `periodEnd >= anniversary` in `deadlines.js` | inferred from ACCOUNTS sections 1.1 and 5.2 | **UNVERIFIED** |
| R-09 | A company's first accounting reference date is the last day of the month in which the first anniversary of incorporation falls | `deadlines.js` | ACCOUNTS section 1.2 (worked example: 6 April 2025 gives 30 April 2026) | Documented |
| R-10 | Later accounting periods are taken to end 12 months after the previous period end, when neither Companies House nor the sheet supplies the date | `accounts.standardPeriodMonths` = 12 | ACCOUNTS section 1.2 says later dates fall on the same date each year, but a changed accounting reference date, or a period made up to 7 days either side (section 1.1), breaks this | **UNVERIFIED** (applies to any company without a Companies House date) |
| R-11 | A deadline that falls on a Sunday or bank holiday does not move. The kit never rolls a deadline forward | none (no weekend or bank holiday logic exists, on purpose) | ACCOUNTS section 5, which states this for accounts. Applying it to confirmation statements is an inference; the kit moves no date either way | Documented (accounts); inference (confirmation statements) |
| R-12 | A confirmation statement is filed at least every 12 months, and can be filed up to 14 days after the review period ends. The first review period is the 12 months beginning with the day of incorporation, so it ends the day before the first anniversary (incorporated 1 January 2025: ends 31 December 2025, due 14 January 2026). A later review period starts the day after the previous confirmation date and lasts 12 months (last confirmation 28 February 2027: next period ends 29 February 2028, due 14 March 2028). If a statement is filed early, the next period starts the day after the confirmation date on that statement, so the sheet must hold the last confirmation date, not the due date or the filing date | `confirmationStatement.reviewPeriodMonths` = 12, `filingDaysAfterReviewPeriodEnd` = 14 | CS "When to file your confirmation statement"; Companies Act 2006 s853A(5)(a), (5)(b) and (6) | Documented |
| R-13 | First review period ends the day before the first anniversary of incorporation; later periods start the day after the previous confirmation date and last 12 months, so end on the day before the anniversary of that start | `confirmationDeadline` in `deadlines.js` | Companies Act 2006 s853A(5)(a) and (5)(b), as cited by the compliance review | Documented |
| R-14 | Incorporation on 29 February, or a later review period beginning on 29 February (last confirmation date 28 February in a leap year): the review period is taken as ending 28 February, and the first-accounts deadline is flagged because the statute works from the first anniversary (28 February or 1 March) and the kit uses the incorporation date | none (flagged) | none | **UNVERIFIED** |
| R-15 | Reminders are raised only for companies whose status is `active`; `dissolved`, `closed`, `converted-closed` and `removed` are skipped silently; any other status is reported for a person to decide | `companyStatus` | Companies House API company profile `company_status` values. The reference page renders in JavaScript and could not be read when this file was written | **UNVERIFIED** |
| R-16 | Companies House API: `accounts.next_due`, `accounts.next_made_up_to`, `accounts.last_accounts.made_up_to`, `accounts.overdue`, `confirmation_statement.next_due`, `next_made_up_to`, `last_made_up_to`, `overdue`, `company_status`, `type`, `date_of_creation` are the fields read, and `next_due` is the filing deadline | `readApiProfile` in `companies.js` | Companies House API company profile reference (not machine-readable when checked) | **UNVERIFIED** |
| R-17 | Only API company types `ltd` (private) and `plc` (public) are mapped to an accounts period. LLPs, unlimited companies, guarantee companies and others are reported, not guessed | `typeFromApi` in `companies.js` | none | **UNVERIFIED** |
| R-19 | "Whichever is longer" in the first-accounts rule: the kit takes the later of (incorporation + 21 or 18 months) and (period end + 3 months) | `deadlines.js`, `firstAccounts` rules | ACCOUNTS section 5.2; Companies Act 2006 s442(3), as read by the compliance review. The guidance's worked example only exercises the incorporation limb, but the statute states both | Documented |
| R-18 | The API allows 600 requests in a five-minute window, per application, and answers 429 beyond that | `api.requestsPerFiveMinutes` = 600 (documentation only) | API-LIMITS | Documented |

## How a date is chosen

For each company and each of the two filings, in this order:

1. The Companies House API `next_due`, when the lookup worked.
2. A date typed into the sheet (`Accounts Due`, `Confirmation Statement Due`).
3. A calculation from the sheet (R-01 to R-14).

If 1 and 2 are both present and differ, the earlier is used and the row is
flagged. Anything from 2 or 3 carries **Needs human confirmation** in the digest
because it has not been read from the register.

## What is not encoded, deliberately

- **Late filing penalties and the confirmation statement fine.** They change and
  nothing here needs them. The digest does not quote an amount.
- **Filing extensions** (granted by Companies House on application) and
  **shortened accounting periods** (ACCOUNTS section 5.3). Both move a
  deadline. The Companies House date reflects them; a calculation from the sheet
  does not. Enter the date from the register in the sheet if either applies.
- **Dormant companies, filing exemptions and accounts types.** They do not change
  the deadline.
- **Fees.** Not used.
- **Reforms in progress.** The ACCOUNTS page refers to planned changes to
  accounts filing and to shortening an accounting reference period. Their
  timing and content were not confirmed here. Any of them could change what a
  deadline is: **Needs human confirmation**, so re-read the pages above on each
  review date.
- **Company type at the right date (limitation).** Whether a company counts as
  private or public for the accounts period is judged at the end of the
  accounting reference period (Companies Act 2006 s442(6)). The kit uses the
  type held now, from Companies House or the sheet. A company that changed type
  since that period end needs a person to check its deadline.

## Before go-live

1. Have someone qualified read the Documented rows against the live pages and
   confirm each UNVERIFIED row is acceptable for your practice.
2. Run a week in dry run and compare every date in the digest with the
   Companies House register.
3. Subscribe each company to Companies House's own email reminders as a second
   source. This kit is a convenience, not the system of record.
