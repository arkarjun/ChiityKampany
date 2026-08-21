/**
 * DataAccess.gs
 * Thin read/write layer over the spreadsheet. Every other file goes through
 * these functions rather than calling SpreadsheetApp directly, so locking
 * and row<->object conversion only need to be correct in one place.
 */

function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet();
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
