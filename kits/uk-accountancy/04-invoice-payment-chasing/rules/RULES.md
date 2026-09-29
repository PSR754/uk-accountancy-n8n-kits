# Rules register

Every statutory fact and business rule this kit relies on, with its source and
the date it was last checked. A proof that the code follows these rules is worth
nothing if a rule here is wrong, so this file is the part that needs a qualified
human to sign off, not the code.

Each value is asserted by a test. Change a value here and in `src/core/rules.js`
together, then run `npm test`.

| Rule | Value used | Source | Last verified | Verified by |
|---|---|---|---|---|
| Fixed sum recoverable on a late commercial debt, debt under £1,000 | £40 | Late Payment of Commercial Debts (Interest) Act 1998, s5A | **not yet verified** | — |
| Fixed sum, debt £1,000 to £9,999.99 | £70 | Late Payment of Commercial Debts (Interest) Act 1998, s5A | **not yet verified** | — |
| Fixed sum, debt £10,000 and over | £100 | Late Payment of Commercial Debts (Interest) Act 1998, s5A | **not yet verified** | — |
| The Act applies to business-to-business contracts only | Wording is suppressed for clients marked `Individual` | Late Payment of Commercial Debts (Interest) Act 1998, s2(1) | **not yet verified** | — |
| England and Wales bank holidays, 2026 to 2028 | `bank-holidays.json` | https://www.gov.uk/bank-holidays | **not yet verified** | — |

## What is not encoded here, deliberately

- **Statutory interest.** The rate is 8% above the Bank of England base rate,
  which moves. The emails state the entitlement rather than computing a figure,
  so there is no stale number to be wrong. If you want the calculation, the base
  rate and its effective date must become configuration with a review date.
- **Contractual interest.** Many engagement letters set their own rate, which
  displaces the statutory one. This kit does not know your engagement terms.

## Before go-live

Two checks need a person, and neither is something the tests can do:

1. Have someone qualified confirm the five rows above against the current
   legislation and gov.uk, and fill in the last two columns.
2. Confirm the bank holiday table against gov.uk. The tests check that every
   date in it is real and that none falls on a weekend, which catches a typo but
   not a wrong date. The table covers England and Wales only; Scotland and
   Northern Ireland differ.

## How the chase ladder was chosen

The 7, 30 and 60 day thresholds are a convention, not a legal requirement.
They are configuration, and a practice should set them to match its own
engagement terms and credit control policy.
