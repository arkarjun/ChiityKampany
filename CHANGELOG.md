# Changelog

All notable changes to Chitty Kampany are recorded here. Versions follow `<major>.<minor>.<patch>`:
major for changes that need a setup/deployment change beyond just replacing files, minor for new features, patch for fixes only.

## v1.0.0 — first stable release

The app's feature set is now considered complete for a v1 chit-fund committee: chit lifecycle (Enrolling → Active → Closed) across all six brief-specified frequencies plus Daily, member and collection management with soft-delete, provably-fair spin-wheel draws with a full audit trail, a date-range dashboard, configurable branding and message templates, and a cryptographically verifiable receipt system. Also the first version to carry a number at all — see "Updating an existing deployment" in `README.md` if you're coming from an earlier, unversioned checkout.

- **Receipt verification.** Every logged payment is stamped with a hidden seal, computed from the payment's own details plus a secret that never leaves the script's private settings. A public, no-login page lets a member check their own receipt's Ref code and get back "genuine" or "not verified" — closing a gap where an agent with the Sheet access they need to log payments could otherwise hand-type a convincing fake row. See `Receipts.gs` and the "Verifying a receipt" section of `README.md`.
- **Standalone deployment path (recommended).** The setup guide now recommends a standalone Apps Script project instead of one pasted into the Sheet's own Extensions menu, so the code and the receipt-verification secret stay private from agents even though they still need direct Sheet access to log payments. The older container-bound path still works, documented as the simpler-but-less-private option.
- Theme swatches on the Settings page always preview their own colour, independent of the currently active theme.
- The signed-in user's name/role/email moved to the top-right of the header.
- The dashboard takes a date range and an optional chit filter: period totals (collected, by agent) are scoped to the range; the per-chit table is a point-in-time snapshot as of the range's end date.
- Draws are run through a spin wheel: the winner is picked server-side before the wheel visually spins, every spin (kept or redrawn) is logged to an audit-only sheet, and a one-time token ties the spin to its confirm/redraw action.
- A demo dataset (`demo-data/ChittyKampany-DemoData.xlsx` / `.ods`) — 25 members, 7 chits across every frequency, a mix of Enrolling/Active/Closed — for trying the app out before wiring up a real committee.

## Earlier (unversioned)

Everything before v1.0.0 shipped without version numbers. In rough order: chit/member/collection core, soft-delete, duplicate-entry warnings, custom collection days, a live MemberName lookup on Enrollments, a searchable member picker, tab highlighting fixes, checkbox-based chit enrollment, admin-only WhatsApp sending with a verifiable receipt Ref code, customizable message templates, and configurable app branding (title + colour theme).
