# Changelog

Notable changes to the kits. Anything under **Rules updated** changes a UK
deadline, threshold or rate a kit relies on, so check it applies to you.

## [Unreleased]

- Kit 01 (HMRC deadline reminders) rebuilt around a tested core, to the same standard as kit 04. It now previews before sending (and the 09:00 send refuses to run unless the preview was delivered), records no reminder as sent in dry run, is built to send each reminder once per deadline (failed sends are logged and you are alerted, and are not retried automatically), brings a reminder forward when its day is a weekend or bank holiday, and no longer sends the n8n footer to clients. It does not calculate any deadline: due dates come from your sheet. **Rules updated:** the bank holiday calendar now comes unmodified from gov.uk; see the kit's `rules/RULES.md`. The `Deadlines` tab has two new columns, listed in the kit's runbook.
- MIT licence, clearer README, and a "Coming soon" list.
- Releases now publish every kit as an importable zip, and new issues get forms for rule reports, bugs and questions.
