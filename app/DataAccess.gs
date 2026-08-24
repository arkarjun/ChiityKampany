/**
 * DataAccess.gs
 * Thin read/write layer over the spreadsheet. Every other file goes through
 * these functions rather than calling SpreadsheetApp directly, so locking
 * and row<->object conversion only need to be correct in one place.
 */

/**
 * Opens the spreadsheet this app runs against. A STANDALONE script (its own
 * project at script.google.com, not pasted into the Sheet's own Extensions
 * menu) has no "active spreadsheet" of its own, so it needs to be told the
 * Sheet's ID explicitly — see setSheetId_() in Setup.gs, a one-time step in
 * that setup path. Falls back to the old container-bound behavior when no
 * ID has been set, so an existing container-bound deployment keeps working
 * unchanged after pulling in this file.
 */
function getSS_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(sheetName) {
  const ss = getSS_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet: ' + sheetName + '. Run setupSheets() from Setup.gs first.');
  return sheet;
}

/**
 * Reads every data row (below the header) from a sheet and returns an array
 * of plain objects keyed by the column names in Constants.COLUMNS.
 */
function readAll_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const cols = COLUMNS[sheetName];
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const obj = rowToObject_(cols, values[i]);
    obj._rowNumber = i + 2; // 1-based sheet row, header is row 1
    rows.push(obj);
  }
  return rows;
}

function rowToObject_(cols, values) {
  const obj = {};
  for (let i = 0; i < cols.length; i++) obj[cols[i]] = values[i];
  return obj;
}

function objectToRow_(cols, obj) {
  return cols.map(function (c) { return (obj[c] === undefined || obj[c] === null) ? '' : obj[c]; });
}

/**
 * Appends one row. Wrapped in a document lock so two simultaneous agent
 * submissions can't interleave and corrupt each other's row.
 * Returns the row number the data landed on.
 */
function appendRow_(sheetName, obj) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000); // up to 30s; a chit committee's write volume is tiny, this is generous
  try {
    const sheet = getSheet_(sheetName);
    const cols = COLUMNS[sheetName];
    const row = objectToRow_(cols, obj);
    sheet.appendRow(row);
    return sheet.getLastRow();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Updates specific fields on an existing row, found by matching idColumn/idValue.
 * Also lock-protected. Returns true if a row was found and updated.
 */
function updateRow_(sheetName, idColumn, idValue, patch) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(sheetName);
    const cols = COLUMNS[sheetName];
    const idIdx = cols.indexOf(idColumn);
    if (idIdx === -1) throw new Error('Unknown column ' + idColumn + ' on ' + sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return false;
    const values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][idIdx] === idValue) {
        const sheetRow = i + 2;
        Object.keys(patch).forEach(function (key) {
          const colIdx = cols.indexOf(key);
          if (colIdx === -1) throw new Error('Unknown column ' + key + ' on ' + sheetName);
          sheet.getRange(sheetRow, colIdx + 1).setValue(patch[key]);
        });
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

/** Simple id generator: PREFIX + timestamp + 3 random digits. Good enough at this scale. */
function newId_(prefix) {
  return prefix + '-' + new Date().getTime() + '-' + Math.floor(Math.random() * 900 + 100);
}

/** Converts a 0-based column index (e.g. COLUMNS.X.indexOf('Y')) into its A1-style letter(s): 0->A, 25->Z, 26->AA. */
function columnLetter_(index0) {
  let n = index0 + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Sets a live formula (not a value) into one cell of an existing row. Used
 * for the Enrollments.MemberName column, which is deliberately a lookup
 * formula rather than a stored value — see Constants.gs for why.
 */
function setCellFormula_(sheetName, rowNumber, columnName, formula) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(sheetName);
    const cols = COLUMNS[sheetName];
    const colIdx = cols.indexOf(columnName);
    if (colIdx === -1) throw new Error('Unknown column ' + columnName + ' on ' + sheetName);
    sheet.getRange(rowNumber, colIdx + 1).setFormula(formula);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Recursively converts every Date value in an object/array into a plain
 * 'yyyy-MM-dd' string (or '' if the Date is invalid). Use this ONLY at the
 * client-facing edge — wrapping what a Code.gs function actually returns to
 * google.script.run — never inside readAll_() itself.
 *
 * Why this exists: google.script.run serializes a function's return value
 * as a separate step AFTER your function has already finished running, so
 * that step isn't covered by your own try/catch and a failure there still
 * shows "Completed" (not "Failed") in the Apps Script Executions log — it
 * just silently hands the browser a null response instead of your data.
 * An Invalid Date object anywhere in the payload (e.g. a blank or malformed
 * date cell read back as `new Date(NaN)`) throws during that serialization
 * step. Converting Dates to plain strings before they leave the server
 * avoids that entirely, regardless of what ends up in a date cell.
 *
 * Internal code (ChitEngine.gs, ScheduleEngine.gs, etc.) still needs real
 * Date objects for comparisons like `enrollment.JoinDate > chit.StartDate`,
 * which is why this isn't baked into readAll_() itself — it would break
 * that date arithmetic everywhere else in the app.
 */
function sanitizeForClient_(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : formatDate_(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForClient_);
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (k) { out[k] = sanitizeForClient_(value[k]); });
    return out;
  }
  return value;
}
