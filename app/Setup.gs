/**
 * Setup.gs
 * Run setupSheets() ONCE, from the Apps Script editor (select it in the
 * function dropdown, click Run), right after pasting all the script files
 * in. It creates every tab this app needs, with headers, light data
 * validation, and registers whoever ran it as the first admin. Safe to
 * run again later — it won't duplicate headers or wipe existing data.
 */

function setupSheets() {
  const ss = getSS_();

  Object.keys(SHEETS).forEach(function (key) {
    const sheetName = SHEETS[key];
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    ensureHeader_(sheet, COLUMNS[sheetName]);
  });

  // Remove the default "Sheet1" if it's still sitting there empty.
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() === 0) ss.deleteSheet(defaultSheet);

  applyValidation_();
  seedConfigAndFirstAdmin_();

  // Everything above this point has already been written to the sheet by
  // now — SpreadsheetApp writes commit immediately, they don't roll back if
  // something later in the function throws. This alert is just a nice
  // confirmation, and getUi() only works when setupSheets() is triggered
  // from the spreadsheet's own UI (the "Chitty Kampany" menu, or a click in
  // an open Sheet) — not when run directly from the Apps Script editor's Run
  // button, which is how the setup guide actually tells people to run it the
  // first time. So this is wrapped rather than left to throw: no UI context
  // just means log the confirmation instead of popping an alert.
  const summary = 'Setup complete. Tabs created, and ' + Session.getEffectiveUser().getEmail() +
    ' was added to Users as an ADMIN. Next: deploy this project as a web app ' +
    '(Deploy > New deployment > Web app), and add your agents to the Users tab.';
  try {
    SpreadsheetApp.getUi().alert(summary);
  } catch (e) {
    Logger.log(summary);
  }
}

function ensureHeader_(sheet, headers) {
  // Guarantee the sheet's grid is actually wide enough before touching it.
  // If someone tidied the spreadsheet by manually deleting unused trailing
  // columns (a normal thing to do), the sheet can end up narrower than the
  // header list — and every getRange(row, col, numRows, headers.length) call
  // in DataAccess.gs throws once the header list grows past that width.
  // General robustness, not tied to any specific past incident.
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some(function (h, i) { return existing[i] !== h; });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function applyValidation_() {
  setColumnDropdown_(SHEETS.USERS, 'Role', [ROLE.ADMIN, ROLE.AGENT]);
  setColumnDropdown_(SHEETS.USERS, 'Active', [true, false]);
  setColumnDropdown_(SHEETS.CHITS, 'FrequencyType', Object.values(FREQUENCY_TYPE));
  setColumnDropdown_(SHEETS.CHITS, 'CommissionType', Object.values(COMMISSION_TYPE));
  setColumnDropdown_(SHEETS.CHITS, 'Status', Object.values(CHIT_STATUS));
  setColumnDropdown_(SHEETS.ENROLLMENTS, 'JoinType', Object.values(JOIN_TYPE));
  setColumnDropdown_(SHEETS.ENROLLMENTS, 'Status', Object.values(ENROLLMENT_STATUS));
  setColumnDropdown_(SHEETS.COLLECTIONS, 'Mode', Object.values(MODE));
  setColumnDropdown_(SHEETS.COLLECTIONS, 'EntryType', Object.values(ENTRY_TYPE));
  setColumnDropdown_(SHEETS.DRAW_ATTEMPTS, 'Outcome', Object.values(DRAW_ATTEMPT_STATUS));
}

function setColumnDropdown_(sheetName, columnName, allowedValues) {
  const sheet = getSheet_(sheetName);
  const colIdx = COLUMNS[sheetName].indexOf(columnName) + 1;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(allowedValues, true).setAllowInvalid(false).build();
  // Applies to a generous number of future rows (1000), not just existing data.
  sheet.getRange(2, colIdx, 1000, 1).setDataValidation(rule);
}

function seedConfigAndFirstAdmin_() {
  const configRows = readAll_(SHEETS.CONFIG);
  if (!configRows.some(function (r) { return r.Key === 'CommitteeName'; })) {
    appendRow_(SHEETS.CONFIG, { Key: 'CommitteeName', Value: 'Chitty Kampany' });
  }

  const email = Session.getEffectiveUser().getEmail();
  if (!email) return; // shouldn't happen when run manually from the editor
  const users = readAll_(SHEETS.USERS);
  const alreadyThere = users.some(function (u) { return String(u.Email).toLowerCase() === email.toLowerCase(); });
  if (!alreadyThere) {
    appendRow_(SHEETS.USERS, { Email: email, Name: email.split('@')[0], Role: ROLE.ADMIN, Active: true });
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Chitty Kampany')
    .addItem('Run setup (create tabs)', 'setupSheets')
    .addToUi();
}
