# Changelog

All notable changes to Chitty Kampany are recorded here. Versions follow `<major>.<minor>.<patch>`:
major for changes that need a setup/deployment change beyond just replacing files, minor for new features, patch for fixes only.

## v1.1.0 — new: "My Day" agent dashboard

- **New "My Day" tab, visible to every agent and admin.** Shows one day's collection totals (overall, Cash, UPI) plus a chitwise breakdown across every currently Active chit — including ones with nothing collected that day, shown as ₹0. Date picker offers Today / Yesterday / a custom date, defaulting to Today. An agent only ever sees their own day; an admin gets an agent picker (defaulting to themselves) so they can check any active user's day too — enforced server-side in `getAgentDashboardSummary()`, the same "identity comes from the signed-in account, never from what the client sends" rule as everywhere else in this app. Totals include both regular installments and late-joiner catch-up payments, matching how the Admin Dashboard's own totals already work. There's no agent-to-chit assignment anywhere in this app (any agent can collect for any active chit), so "every chit" here means every chit currently open for collection, not a fixed personal roster.

## v1.0.3 — fix: draw crashes right after spinning

- **Fixed `spinDraw()`/`confirmSpinWinner()`/`discardSpin()` throwing `Cannot read properties of null (reading 'setProperty')` on a standalone Apps Script project.** Same root cause as the v1.0.1 lock fix, different service this time: `PropertiesService.getDocumentProperties()` only works for a script bound to the document it's storing against, and a standalone project never is — so it returned `null` and broke the whole spin-draw flow. Switched to `PropertiesService.getScriptProperties()`, which works the same way for both a standalone and a container-bound project. Just replace `Code.gs` (and `Constants.gs` for the version bump) and redeploy — no setup change needed.

## v1.0.2 — fix: slow page loads

- **Fixed the Admin Dashboard and a chit's ledger view triggering dozens of redundant full-sheet reads on a single load.** `getMemberArrears_()` re-read the entire Collections sheet from scratch for every active member, and it was called once per member per chit — on the demo dataset (7 chits, 25 members), one dashboard load could trigger 70+ full-sheet reads. `getDashboardSummary()`, `getChitCollectionSummary_()`, `getDefaultersForChit_()`, and `getChitLedger()` now read each sheet once per request and share that data across every chit/member instead of each helper re-reading it independently. Verified the refactored functions return byte-identical results to the originals before and after, in addition to the existing 18-test suite passing unchanged.
- **Fixed every sheet read/write re-opening the spreadsheet from scratch.** `getSS_()`/`getSheet_()` in `DataAccess.gs` now cache the Spreadsheet and Sheet objects for the lifetime of the current request, instead of calling `SpreadsheetApp.openById()` (or resolving a sheet by name) again on every single call — a cost every screen was paying, standalone projects most of all.
- **Cut the initial page load from three sequential server round trips to one.** Loading the Collect screen used to await `whoAmI()`, then `listChitsForCollection()`, then `listActiveMembersForChit()` in sequence — each a separate network round trip. A new `bootstrapCollectScreen()` combines all three into one call; every other screen is unaffected.

## v1.0.1 — fix: setup fails on a standalone script project

- **Fixed `setupSheets()` (and every write) throwing `Cannot read properties of null (reading 'waitLock')` on a standalone Apps Script project.** The write-locking in `DataAccess.gs` used `LockService.getDocumentLock()`, which only works for a script bound to the document it's locking — a standalone project (the setup guide's recommended path, for keeping the receipt-verification secret private from agents) is never bound, even after `setSheetId_()`, so it returned `null` and broke `appendRow_`, `updateRow_`, and `setCellFormula_`. Switched to `LockService.getScriptLock()`, which works the same way for both a standalone and a container-bound project. No setup or deployment change needed — just replace `DataAccess.gs` (and `Constants.gs` for the version bump) and redeploy.

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
