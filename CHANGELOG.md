# Changelog

Notable changes to the kits. Anything under **Rules updated** changes a UK
deadline, threshold or rate a kit relies on, so check it applies to you.

## [Unreleased]

## [0.1.0] - 2026-10-01

First public release. Two tested kits for UK accountancy practices, each importable into n8n as a zip. Eight more are in the repo as first written and are not part of this release.

### Added
- Kit 01 (HMRC deadline reminders) rebuilt around a tested core, to the same standard as kit 04. It now previews before sending (and the 09:00 send refuses to run unless the preview was delivered), records no reminder as sent in dry run, is built to send each reminder once per deadline (failed sends are logged and you are alerted, and are not retried automatically), brings a reminder forward when its day is a weekend or bank holiday, and no longer sends the n8n footer to clients. It does not calculate any deadline: due dates come from your sheet. The `Deadlines` tab has two new columns, listed in the kit's runbook.
- Kit 04 (invoice payment chasing) on a tested core: a preview before anything sends, one email per client, and statutory wording only where it applies. Its statutory rules are awaiting sign-off; see the kit's `rules/RULES.md` before relying on them.
- Kits 02, 03 and 05 to 10 are in the repo but not packaged. They have no tests and known defects, and will be rebuilt to the same standard.
- Releases publish each tested kit as an importable zip, and new issues get forms for rule reports, bugs and questions.
- MIT licence, clearer README, and a "Coming soon" list.

### Rules updated
- Kits 01 and 04: the bank holiday calendar now comes unmodified from gov.uk; see each kit's `rules/RULES.md`.
