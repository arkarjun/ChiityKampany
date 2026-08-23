# Chitty Kampany — v1 setup guide

This is the full source for the Google Sheets + Apps Script version described in `ChittyKampany-Brief.md`. Setting it up is a one-time, roughly 10-15 minute task — the same steps anyone else forking this project would follow.

## 1. Create the Sheet and open the script editor

Go to `sheets.new` to create a blank Google Sheet, name it (e.g. "Chitty Kampany"), then open **Extensions → Apps Script**.

## 2. Paste in the source files

The Apps Script editor starts with one empty `Code.gs`. You need these files in the project — for each `.gs` file below, use the **+** next to "Files" → **Script**, name it (without `.gs` — Apps Script adds that itself), and paste the matching content. For `Index.html`, use **+** → **HTML** and name it `Index`.

- `Constants.gs`
- `DataAccess.gs`
- `Auth.gs`
- `ScheduleEngine.gs`
- `ChitEngine.gs`
- `Notifications.gs`
- `Setup.gs`
- `Code.gs` (replace the default empty one)
- `Index.html`

Then open **Project Settings** (gear icon) and enable "Show `appsscript.json` manifest file in editor," open that file, and replace its contents with the provided `appsscript.json`.

File paste order doesn't matter — Apps Script loads them all into one shared script regardless of order.

## 3. Run setup once

In the toolbar, pick `setupSheets` from the function dropdown and click **Run**. The first time, Google will show an "unverified app" warning — this is expected for a script you just wrote yourself; click **Advanced → Go to (your project name) (unsafe) → Allow**. This creates all eight tabs with headers and dropdowns, and registers your own Google account as the first admin.

Open the **Config** tab and set the `CommitteeName` value to your committee's actual name.

## 4. Deploy as a web app

**Deploy → New deployment → gear icon → Web app.** Set "Execute as" to **User accessing the web app**, and "Who has access" to **Anyone with a Google account** (or "Anyone within [your organization]" if you're on Google Workspace, not a personal Gmail). Click **Deploy**, authorize again if prompted, and copy the **Web app URL** — that's the link everyone will use.

Whenever you edit the script later, you need to make a **new deployment version** (Deploy → Manage deployments → edit (pencil) → New version → Deploy) for changes to actually reach that URL — just saving the script isn't enough.

## 5. Share the Sheet with every agent and admin

This step is easy to miss and the app won't work without it: because the web app runs as *whoever opens it*, each agent and admin needs direct access to the underlying spreadsheet. Click **Share** on the Sheet itself (not the web app) and add every agent's and admin's Google account as an **Editor**.

## 6. Register your team

You're already in the **Users** tab as an admin from step 3. Add the rest of your committee either directly on that tab (Email, Name, Role = `ADMIN` or `AGENT`, Active = checked) or from inside the app once deployed, under **Admin → Users**. Only people listed here, with an active row, can use the app at all.

## 7. Day-to-day use

Open the Web app URL on a phone browser and use **Add to Home Screen** (Chrome, Android) so it behaves like an installed app icon. Agents land on **Collect**: pick a chit, pick a member, log the payment. Admins additionally see an **Admin** tab: create and enroll chits, activate them, record draws, handle the rare late-joiner case, and check the dashboard.

Add any known festival/bank holidays under **Admin → Holidays** before they matter for a working-days chit — the schedule engine reads that list live.

Under **Admin → Settings**, an admin can set the app's title and pick from four colour themes (Classic, Ocean, Sunrise, Forest) — both apply for everyone on their next page load. The same screen lets you customize the wording of payment-receipt and draw-result messages (WhatsApp and email); a payment receipt's `{{ref}}` placeholder prints the real Collection ID, so a member can quote it back to the committee to confirm a receipt is genuine, rather than one an agent typed by hand without ever logging the payment.

## Updating an existing deployment

If you already have Chitty Kampany set up and are pulling in a newer version of the script (adding fields like deletion, duplicate warnings, custom collection days, or a MemberName lookup on Enrollments), two extra steps are needed beyond just replacing the file contents:

1. **Re-run `setupSheets`** from the function dropdown once, the same way you did in step 3. It's safe to run again — it never touches existing data — but it will add any new columns (like `Deleted`, `CustomDays`, or `MemberName`) to the end of a sheet's header row if they're missing.
2. **Deploy a new version** (Deploy → Manage deployments → edit (pencil) → New version → Deploy). Editing the script alone doesn't reach the live web app URL — a new deployment version does.

Note on `MemberName`: it's a live lookup formula, not a stored value, and only gets written into new Enrollments rows going forward — existing rows will show it blank until you delete and re-add that enrollment, if you want it backfilled.

## Known limitation: deleted catch-up payments

Deleting a late-joiner's catch-up payment record removes it from ledgers and totals immediately, but the running "catch-up amount paid" total stored on their enrollment isn't automatically re-adjusted. Late joiners are already the rare exception, so this is flagged rather than built out — if it comes up, correct that figure by hand on the Enrollments tab.

## What's deliberately not in v1

Matches the brief: no member self-service lookup, no automatic WhatsApp sending (tap-to-send links only — see Admin → Settings for the message templates and the receipt Ref code, which is the closest this app gets to fraud-proofing that flow without standing up a WhatsApp Business API integration), no exports, single committee per deployment, no custom logo/image upload (app title and colour theme are configurable, under Admin → Settings), and no explicit flow for a member dropping out of a chit before ever winning — handle that manually for now.

## If something looks wrong

The `Config`, `Users`, `Chits`, `Enrollments`, `Collections`, `Draws`, `Holidays`, and `Members` tabs are all plain data — you can always open the Sheet directly to see exactly what the app has recorded, which is the point of building it this way. Deleting a member, chit, or payment record from inside the app never removes its row from the Sheet — it only hides it from dropdowns, lists, and totals going forward, so that history stays intact.
