# Chitty Kampany — setup guide

This is the full source for the Google Sheets + Apps Script version described in `ChittyKampany-Brief.md`. Setting it up is a one-time, roughly 15-20 minute task — the same steps anyone else forking this project would follow.

## 1. Create the Sheet

Go to `sheets.new` to create a blank Google Sheet, name it (e.g. "Chitty Kampany"), and note its **Sheet ID** — the long string in the URL between `/d/` and `/edit`. You'll need it in step 3 if you follow the recommended path below.

## 2. Create the script project

You have two options here, and they matter for more than just where the code lives — see "Why a standalone project" below.

**Recommended: a standalone project.** Go to [script.google.com](https://script.google.com) → **New project**. This keeps the code (and the secret behind the receipt-verification feature — see "Verifying a receipt" below and `Receipts.gs`) genuinely private, separate from the Sheet's own sharing.

**Simpler, but agents can see the code too: a container-bound script.** On the Sheet itself, open **Extensions → Apps Script**. Faster to set up, one fewer thing to configure — but Google ties a container-bound script's access to the container's own sharing list, so anyone you give Editor access to on the Sheet (every agent, per step 7) can also open and edit this code, and read anything stored in its Script Properties. Only choose this if you're comfortable with that, or you're just trying the app out.

### Why a standalone project

Agents need direct Editor access to the Sheet for the app to work at all (see step 7) — that's unavoidable with this architecture. If the script is container-bound, that same access also hands them the app's source code and any secrets it holds, meaning a corrupt agent could, in principle, rewrite the app's own rules (e.g. grant themselves admin) rather than just misuse the data-entry screens. A standalone project breaks that link: agents still get the Sheet access they need to log payments, but the code and its secrets live in a completely separate place you never share with them.

## 3. Paste in the source files

The Apps Script editor starts with one empty `Code.gs`. You need these files in the project — for each `.gs` file below, use the **+** next to "Files" → **Script**, name it (without `.gs` — Apps Script adds that itself), and paste the matching content. For each `.html` file, use **+** → **HTML** and name it without the extension.

- `Constants.gs`
- `DataAccess.gs`
- `Auth.gs`
- `ScheduleEngine.gs`
- `ChitEngine.gs`
- `Notifications.gs`
- `Receipts.gs`
- `Setup.gs`
- `Code.gs` (replace the default empty one)
- `Index.html`
- `Verify.html`

Then open **Project Settings** (gear icon) and enable "Show `appsscript.json` manifest file in editor," open that file, and replace its contents with the provided `appsscript.json`.

File paste order doesn't matter — Apps Script loads them all into one shared script regardless of order.

**If you chose the standalone path in step 2**, one more thing before moving on: a standalone script has no "active spreadsheet" of its own, so it needs to be told which Sheet to use. The Apps Script editor's Run button doesn't let you pass in an argument, so do this the usual way for a one-off call: at the very end of `Setup.gs`, temporarily add a new line `setSheetId_('YOUR_SHEET_ID_FROM_STEP_1');`, save, select that line's function from the dropdown (or just `setSheetId_`) and click **Run** once, then delete that line again (leaving the `setSheetId_` function itself in place — you won't need to call it again unless you ever move to a different Sheet). Do this before step 4.

## 4. Run setup once

In the toolbar, pick `setupSheets` from the function dropdown and click **Run**. The first time, Google will show an "unverified app" warning — this is expected for a script you just wrote yourself; click **Advanced → Go to (your project name) (unsafe) → Allow**. This creates all nine tabs with headers and dropdowns, registers your own Google account as the first admin, and generates the private secret behind the receipt-verification feature (see "Verifying a receipt" below and `Receipts.gs`) — a one-time random value stored only in this script's own Project Settings, never in the Sheet.

Open the **Config** tab and set the `CommitteeName` value to your committee's actual name.

### Optional: load the demo dataset

`demo-data/ChittyKampany-DemoData.xlsx` / `.ods` (in this repo) is a realistic, fully fictional dataset for trying the app out before wiring up your own committee: 25 members, 7 chits covering every frequency type (one extra Daily chit beyond the six in the brief) — 2 still Enrolling, 1 Closed with a complete collection and draw history, 4 Active and partway through — plus matching Enrollments, Collections, and Draws rows. `DrawAttempts` is included but left empty (it's an audit log the app fills in as spins happen, not seed data).

To load it: open each tab in the demo file, select all, copy, and paste over the matching tab in your Sheet (starting from row 2, under the header setup already created). Do this on a test copy of the Sheet, not your live committee's — it's for exploring the app's screens and reports, not something to merge with real data.

**Receipt verification will not work on the demo dataset.** A row's `Seal` is only ever computed by `logPayment()`/`logCatchupPayment()` at the moment a payment is actually logged through the app, using the private secret generated for *your* script in step 4 — a secret unique to every installation. The demo file's Collections rows are pasted straight into the sheet rather than created that way, so their `Seal` column is blank, and there's no way to pre-fill it that would work across every installation (each has a different secret). `Admin → Verify` and the public Verify link will correctly show "not verified" for every demo receipt code — that's expected, not a bug. To see a genuine "verified" result, log a real payment through the app yourself (demo data or not) and check that one instead.

## 5. Deploy as a web app — two deployments

Chitty Kampany uses **two separate deployments of the same project**: the main app (agents and admins, identity-checked) and a small public receipt-checker (no login, for members). They serve different purposes and need different settings, so create both.

**Deployment A — the main app.** Deploy → New deployment → gear icon → Web app. Set "Execute as" to **User accessing the web app**, and "Who has access" to **Anyone with a Google account** (or "Anyone within [your organization]" if you're on Google Workspace, not a personal Gmail). Click **Deploy**, authorize again if prompted, and copy the **Web app URL** — this is the link agents and admins use.

**Deployment B — the public Verify link.** Deploy → New deployment → gear icon → Web app again (a second, independent deployment of the same code). Set "Execute as" to **Me** (the account you're deployed as), and "Who has access" to **Anyone**. Copy this URL too, then append `?page=verify` to it — that full URL is the one you actually hand out to members. Because this deployment runs as you rather than as the visitor, anyone can open it without needing any Sheet access at all — but it can only ever do one thing: check a receipt (see `Receipts.gs`'s `verifyReceipt()`). Every other function in the app still requires a registered Chitty Kampany account, and fails safely for an anonymous visitor here since Apps Script doesn't reveal who they are to an owner-run script.

Whenever you edit the script later, you need to make a **new version of each deployment you want the change to reach** (Deploy → Manage deployments → edit the pencil next to that deployment → New version → Deploy) — just saving the script isn't enough, and updating one deployment doesn't update the other.

## 6. Share the Sheet with every agent and admin

This step is easy to miss and the app won't work without it: because the main app runs as *whoever opens it*, each agent and admin needs direct access to the underlying spreadsheet. Click **Share** on the Sheet itself (not either web app deployment) and add every agent's and admin's Google account as an **Editor**.

**If you're on the standalone path from step 2**, stop there — do not also share the script project with agents. Sharing the Sheet is what they need; sharing the script project is exactly what the standalone setup was meant to avoid.

## 7. Register your team

You're already in the **Users** tab as an admin from step 4. Add the rest of your committee either directly on that tab (Email, Name, Role = `ADMIN` or `AGENT`, Active = checked) or from inside the app once deployed, under **Admin → Users**. Only people listed here, with an active row, can use the app at all.

## 8. Day-to-day use

Open Deployment A's Web app URL on a phone browser and use **Add to Home Screen** (Chrome, Android) so it behaves like an installed app icon. Agents land on **Collect**: pick a chit, pick a member, log the payment. Admins additionally see an **Admin** tab: create and enroll chits, activate them, run draws from **Admin → Draw** (a spin wheel whose winner is actually decided on the server before it spins, so the animation is a reveal, not the source of randomness — every spin is logged either way), handle the rare late-joiner case, and check **Admin → Dashboard**, which takes a date range and an optional chit filter rather than showing only "today."

Every agent and admin also has a **My Day** tab: total collected, split by Cash/UPI, and a chitwise breakdown for one day (Today, Yesterday, or a custom date, defaulting to Today). An agent only ever sees their own day; an admin gets an agent picker so they can check anyone's day for reconciliation.

Add any known festival/bank holidays under **Admin → Holidays** before they matter for a working-days chit — the schedule engine reads that list live.

Under **Admin → Settings**, an admin can set the app's title and pick from four colour themes (Classic, Ocean, Sunrise, Forest) — both apply for everyone on their next page load. The same screen lets you customize the wording of payment-receipt and draw-result messages (WhatsApp and email).

### Verifying a receipt

Every payment receipt (WhatsApp or email) includes a Ref code — the CollectionID. Give members Deployment B's link (with `?page=verify`) and they can paste that code in themselves, any time, with no login, and get back a plain "genuine" or "not verified" — no other details are shown. Admins can check the same code from inside the app too, under **Admin → Verify**, for a quick answer without leaving the app.

This isn't just "does a matching row exist" — a hand-typed row in the Collections sheet can look just as plausible as a real one, since agents need direct edit access to that sheet for the app to work at all. Every row `logPayment()`/`logCatchupPayment()` actually creates gets a hidden `Seal` — a value computed from that row's own details plus the private secret from step 4, which never leaves this script's own settings. `verifyReceipt()` recomputes what the seal *should* be and compares it to what's stored; a hand-typed row, however convincing its CollectionID looks, won't have a matching one. See `Receipts.gs` for the full reasoning. (This also means the demo dataset's receipts never verify as genuine — see "Optional: load the demo dataset" above.)

## Known limitation: deleted catch-up payments

Deleting a late-joiner's catch-up payment record removes it from ledgers and totals immediately, but the running "catch-up amount paid" total stored on their enrollment isn't automatically re-adjusted. Late joiners are already the rare exception, so this is flagged rather than built out — if it comes up, correct that figure by hand on the Enrollments tab.

## What's deliberately out of scope

Matches the brief, with one narrow exception: members can check a specific receipt they already hold (see "Verifying a receipt" above), but there's still no broader member self-service — no login, no viewing their own chit history or balance beyond that one lookup. Also no automatic WhatsApp sending (tap-to-send links only — see Admin → Settings for the message templates), no exports, single committee per deployment, no custom logo/image upload (app title and colour theme are configurable, under Admin → Settings), and no explicit flow for a member dropping out of a chit before ever winning — handle that manually for now.

## If something looks wrong

The `Config`, `Users`, `Chits`, `Enrollments`, `Collections`, `Draws`, `Holidays`, and `Members` tabs are all plain data — you can always open the Sheet directly to see exactly what the app has recorded, which is the point of building it this way. Deleting a member, chit, or payment record from inside the app never removes its row from the Sheet — it only hides it from dropdowns, lists, and totals going forward, so that history stays intact.

A Collections row with a blank `Seal` column was entered directly into the sheet rather than through the app — it won't pass `Admin → Verify` or the public Verify link. That's expected, not a bug: only payments logged through the app get sealed.
