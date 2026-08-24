# Chitty Kampany

A small, open-source, low-tech tool for digitizing how a chit fund committee runs its daily collections and draws.

Chitty Kampany replaces the paper registers a field agent currently carries with a phone-based collection screen, and gives the committee a live, auditable ledger instead of reconciling notebooks by hand. It runs entirely on Google Sheets and Google Apps Script — no server, no hosting bill, and no IT team required to keep it alive. Current version: **v1.0.2** — see [`CHANGELOG.md`](CHANGELOG.md) for release history.

## Why it's built this way

A chit fund committee runs several chits at once, each with its own members, installment amount, and schedule. Collection agents go door to door daily, taking cash or UPI payments, and at some interval a draw decides who receives that round's pot. Chitty Kampany's goal, in order, is digital, easy, and transparent — not a feature-rich fintech product. See [`docs/ChittyKampany-Brief.md`](docs/ChittyKampany-Brief.md) for the full product and architecture brief this project is built from.

## Features

### Chit lifecycle and scheduling

Every chit is its own configuration rather than a hardcoded formula — installment amount, collection frequency, a draw interval, and a commission rule are all set per chit, and a chit moves through Enrolling → Active → Closed as its participants fill up and its rounds complete. Six collection frequencies are supported: Daily, Working days only (Mon–Sat, minus a configurable holiday calendar), Alternate days, Weekly, Monthly, and a committee-chosen Custom set of weekdays. Three commission models are supported — one extra installment per member over the chit's life, a flat amount deducted per round, or a percentage of each round's pool — and round pools, catch-up amounts for a late joiner, and defaulter tracking are all computed from that same configuration rather than hand-maintained.

### Collections

Agents get one deliberately narrow screen: pick a chit, pick a member (searchable, not a long dropdown), enter an amount, log it. A pre-submit check flags an apparent duplicate (same chit, member, and amount already logged today) before it's saved. Late joiners can be enrolled mid-chit with a one-time catch-up payment covering what they missed. Every logged payment automatically sends a receipt — email and a tap-to-send WhatsApp link — carrying a Ref code the member can later check (see Receipt verification, below).

### Draws

Draws run through an on-screen spin wheel, but the wheel is a *reveal*, not the source of randomness — the winner is picked on the server before the wheel visually spins, so the animation can't be gamed or re-rolled into a different outcome after the fact. Every spin is logged to an audit trail (kept or redrawn), and a one-time token ties a spin to its confirm/redraw action so a stale or replayed request can't record a winner that was never actually shown.

### Dashboard and reporting

An admin picks a date range and, optionally, a single chit (across any status, including closed ones, for historical reporting). Collected-in-period and by-agent totals are scoped to that range; the per-chit table (expected vs. collected, defaulters) is a point-in-time snapshot as of the range's end date — the two are genuinely different questions, and the app keeps them from being conflated.

### Receipt verification

A hidden cryptographic seal is stamped on every genuinely logged payment, computed from that payment's own details plus a secret that never leaves the script's own private settings — not the spreadsheet, not the open-source code. A member can paste their receipt's Ref code into a plain, public, no-login page and get back "genuine" or "not verified"; an admin can check the same code from inside the app. This exists because agents necessarily have direct edit access to the Collections sheet for the app to work at all — so "does a row with this ID exist" was never a safe check on its own, and a hand-typed fake row can't reproduce a matching seal without the secret. The recommended setup path (a standalone Apps Script project, not one pasted into the Sheet's own Extensions menu) is what actually keeps that secret private — see [`app/README.md`](app/README.md).

### Branding and messaging

An admin can set the app's own title and pick from four colour themes (Classic, Ocean, Sunrise, Forest), applied for everyone on their next page load. Payment-receipt and draw-result message wording (WhatsApp and email, separately) is editable from the same screen rather than fixed in code.

### Access control

Two roles — Admin and Agent — enforced server-side on every function that reads or changes data, driven by a Users sheet keyed to Google accounts (never anything the client claims about itself). Members, chits, and payment records are soft-deleted: hidden from lists and totals immediately, but never actually erased, so history stays intact and mistakes stay recoverable.

### Try it without your own committee

[`demo-data/ChittyKampany-DemoData.xlsx`](demo-data/ChittyKampany-DemoData.xlsx) / [`.ods`](demo-data/ChittyKampany-DemoData.ods) is a realistic, fully fictional dataset — 25 members and 7 chits spanning every frequency type, a mix of Enrolling, Active, and fully-wound-down Closed chits, with matching collections and draw history — for exploring the app's screens and reports before wiring up a real committee.

## Getting started

The whole app lives in [`app/`](app) — plain Apps Script files and two HTML files, meant to be pasted into a Google Sheet's script editor (or, for the recommended setup, a standalone Apps Script project — see below). **[`app/README.md`](app/README.md) has the full step-by-step setup guide** (create the Sheet, choose a script project type, paste in the files, run setup, deploy, share access). It takes about 15–20 minutes and needs nothing installed locally.

## Project layout

- `app/` — the Apps Script source: data model constants, the schedule/chit calculation engine, receipt verification, notifications, access control, and the agent/admin/verify web app UI.
- `demo-data/` — a fictional sample dataset (`.xlsx` and `.ods`) for trying the app out.
- `docs/` — the product and architecture brief this build follows.
- `CHANGELOG.md` — version history.

## Status

v1.0.2 — the app's feature set is considered complete for a v1 chit-fund committee: chit onboarding and lifecycle across all six frequency types, agent collection with duplicate warnings, provably-fair spin-wheel draws with an audit trail, a date-range dashboard, configurable branding and message templates, verifiable receipts, and role-based access control. See `CHANGELOG.md` for what changed to get here. Not yet handled: broader member self-service beyond checking one receipt, automatic (non-tap-to-send) WhatsApp sending, exportable reports, multi-committee deployments, and a member exiting a chit before winning.

## Contributing

This project is open source under the MIT license — issues and pull requests are welcome. If you're running your own chit fund and adapt this, a copy of your Sheet template plus the `app/` script is all you need; no shared infrastructure to coordinate with anyone else.

## Built with AI

The code, the setup guide, and this page were built with Claude (Anthropic) working alongside the project owner — every change reviewed, tested, and verified before it shipped, the same rigor as any other change to this repo. Mentioned here for transparency, not as a disclaimer.

## License

MIT — see [`LICENSE`](LICENSE).
