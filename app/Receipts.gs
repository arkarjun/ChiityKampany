/**
 * Receipts.gs
 * Makes a payment receipt independently verifiable, in a way that survives
 * an agent having direct edit access to the Collections sheet (they need
 * that access for logPayment()/logCatchupPayment() to work at all — see
 * README for why). A CollectionID alone proves nothing: anyone with edit
 * access to the sheet can type a convincing-looking one into a fake row by
 * hand. So every row logPayment()/logCatchupPayment() genuinely creates
 * also gets a "Seal" — a value computed from that row's own details plus a
 * secret that lives only in this script's own private settings, never in
 * any sheet cell and never in this open-source code. verifyReceipt()
 * recomputes what the seal *should* be from a row's stored details and
 * checks it against what's actually stored. A hand-typed row can copy the
 * general shape of a seal, but can't produce a matching one without the
 * secret — so it fails the check.
 *
 * This only holds if the secret genuinely stays private. If this script is
 * still pasted into the Sheet's own Extensions > Apps Script (container-
 * bound), anyone with Editor access to the Sheet can also open and read
 * this whole project, secret included — see the standalone setup path in
 * README, which is what actually makes this protection real.
 */

/** Gets this deployment's own seal secret, generating and saving one on first use. Never returned to the client, never written to any sheet. */
function getSealSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SEAL_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SEAL_SECRET', secret);
  }
  return secret;
}

/** Converts a byte array (as returned by Utilities.computeHmacSha256Signature) into a lowercase hex string. */
function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/** Scrambles a list of field values, plus the deployment's own secret, into a fixed-length hex stamp. Same fields in, same stamp out — always. */
function computeSeal_(fields) {
  const payload = fields.join('|');
  const bytes = Utilities.computeHmacSha256Signature(payload, getSealSecret_());
  return bytesToHex_(bytes).substring(0, 24); // 96 bits — plenty, and keeps the stored value short
}

/**
 * The seal for a Collections row, built from exactly the fields that
 * describe the transaction (not who logged it, not when it was touched) —
 * CollectionID, ChitID, MemberID, the date (day only), the amount, and
 * whether it's an installment or a catch-up payment. Call this with the
 * same field values both when the row is first created and later when
 * re-checking it — formatDate_() collapses time-of-day so a row read back
 * from the sheet still recomputes the same seal it was given at write time.
 */
function buildCollectionSeal_(row) {
  return computeSeal_([
    row.CollectionID, row.ChitID, row.MemberID,
    formatDate_(row.Date), String(row.Amount), row.EntryType
  ]);
}

/**
 * Public, unauthenticated receipt check — deliberately does NOT call
 * requireRole_(). Anyone holding a receipt (a member checking their own, or
 * an admin checking on someone's behalf) can look up a CollectionID and
 * learn whether it was genuinely produced by logPayment()/
 * logCatchupPayment(), without needing a Chitty Kampany account. Reveals
 * only what a genuine receipt already says — amount, date, chit, mode —
 * never the member's contact details or who collected it, since this is
 * reachable by anyone, not just people the committee has vetted.
 */
function verifyReceipt(collectionId) {
  const id = String(collectionId || '').trim();
  if (!id) return { valid: false };

  const row = readAll_(SHEETS.COLLECTIONS).find(function (c) { return c.CollectionID === id; });
  if (!row || row.Deleted) return { valid: false };

  const expectedSeal = buildCollectionSeal_(row);
  if (!row.Seal || row.Seal !== expectedSeal) return { valid: false };

  const chit = getChitById_(row.ChitID);
  return {
    valid: true,
    amount: row.Amount,
    mode: row.Mode,
    entryType: row.EntryType,
    date: formatDate_(row.Date),
    chitName: chit ? chit.Name : '(chit)'
  };
}
