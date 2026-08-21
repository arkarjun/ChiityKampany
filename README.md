# Chitty Kampany

A small, open-source, low-tech tool for digitizing how a chit fund committee runs its daily collections and draws.

Chitty Kampany replaces the paper registers a field agent currently carries with a phone-based collection screen, and gives the committee a live, auditable ledger instead of reconciling notebooks by hand. It runs entirely on Google Sheets and Google Apps Script — no server, no hosting bill, and no IT team required to keep it alive.

## Why it's built this way

A chit fund committee runs several chits at once, each with its own members, installment amount, and schedule. Collection agents go door to door daily, taking cash or UPI payments, and at some interval a draw decides who receives that round's pot. Chitty Kampany's goal, in order, is digital, easy, and transparent — not a feature-rich fintech product. See [`docs/ChittyKampany-Brief.md`](docs/ChittyKampany-Brief.md) for the full product and architecture brief this project is built from.

## How it works

Every chit is its own configuration rather than a hardcoded formula: installment amount, collection frequency (daily, working-days-only, alternate days, weekly, or monthly), a configurable holiday calendar, a draw interval, and a commission rule are all set per chit. Round pools, draw eligibility, catch-up amounts for the rare late joiner, and defaulter tracking are all computed from that configuration.

## Getting started

The whole app lives in [`app/`](app) — plain Apps Script files and one HTML file, meant to be pasted into a Google Sheet's script editor. **[`app/README.md`](app/README.md) has the full step-by-step setup guide** (create the Sheet, paste in the files, run setup, deploy, share access). It takes about 10–15 minutes and needs nothing installed locally.

## Project layout

- `app/` — the Apps Script source: data model constants, the schedule/chit calculation engine, notifications, access control, and the agent/admin web app UI.
- `docs/` — the product and architecture brief this build follows.

## Status

v1: agent collection, chit onboarding, draws, a committee dashboard, role-based access, and email + tap-to-send WhatsApp notifications. Not yet handled: member self-service lookup, automatic WhatsApp sending, exportable reports, multi-committee deployments, and a member exiting a chit before winning.

## Contributing

This project is open source under the MIT license — issues and pull requests are welcome. If you're running your own chit fund and adapt this, a copy of your Sheet template plus the `app/` script is all you need; no shared infrastructure to coordinate with anyone else.

## License

MIT — see [`LICENSE`](LICENSE).
