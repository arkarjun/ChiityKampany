/**
 * Code.gs
 * Web app entry point plus every server-side function the client calls
 * through google.script.run. Every function that reads or changes real
 * data starts with requireRole_() — the client-side role check in
 * Index.html is only there to pick which screen to show, not to enforce
 * anything.
 */

function doGet(e) {
  const appTitle = getConfigValue_('AppTitle', 'Chitty Kampany');
  const theme = getConfigValue_('Theme', 'classic');
  const page = (e && e.parameter && e.parameter.page) || '';

  // The open, no-login receipt checker — reachable from a deployment
  // running as the script owner (see README) so anyone holding a receipt
  // can use it without needing a Chitty Kampany account. It's a separate,
  // deliberately minimal template rather than a hidden view inside Index,
  // so it stays a clean single-purpose page. verifyReceipt() itself (in
  // Receipts.gs) is what's actually safe to expose here — everything else
  // callable from Index still requires requireRole_(), which fails closed
  // for a visitor an owner-executed script can't identify.
  if (page === 'verify') {
    const vTemplate = HtmlService.createTemplateFromFile('Verify');
    vTemplate.appTitle = appTitle;
    vTemplate.themeClass = 'theme-' + theme;
    vTemplate.appVersion = APP_VERSION;
    return vTemplate.evaluate()
      .setTitle(appTitle + ' — Verify a receipt')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = appTitle;
  template.themeClass = 'theme-' + theme;
  template.appVersion = APP_VERSION;
  return template.evaluate()
    .setTitle(appTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------- Shared lookups ----------

function listMembersById_() {
  const map = {};
  readAll_(SHEETS.MEMBERS).forEach(function (m) { map[m.MemberID] = m; });
  return map;
}

// ---------- Agent screen ----------

/**
 * Combines whoAmI() + listChitsForCollection() + (for the first chit)
 * listActiveMembersForChit() into a single google.script.run round trip.
 * Index.html's initial page load used to await all three of those in
 * sequence before the Collect screen was actually usable — each
 * google.script.run call pays a real network round trip on top of Apps
 * Script's own per-call overhead, so three in a row was a visible chunk of
 * "why is this taking so long to load." This calls the exact same
 * role-checked functions internally (no new access rule, just fewer trips
 * across the wire) and is used only by the initial page load — every other
 * screen still calls the individual functions as before.
 */
function bootstrapCollectScreen() {
  const user = whoAmI();
  if (!user.registered) return { user: user, chits: [], firstChitMembers: [] };
  const chits = listChitsForCollection();
  const firstChitMembers = chits.length ? listActiveMembersForChit(chits[0].chitId) : [];
  return { user: user, chits: chits, firstChitMembers: firstChitMembers };
}

function listChitsForCollection() {
  requireRole_([ROLE.AGENT, ROLE.ADMIN]);
  return readAll_(SHEETS.CHITS)
    .filter(function (c) { return c.Status === CHIT_STATUS.ACTIVE && !c.Deleted; })
    .map(function (c) { return { chitId: c.ChitID, name: c.Name, installmentAmount: c.InstallmentAmount }; });
}

function listActiveMembersForChit(chitId) {
  requireRole_([ROLE.AGENT, ROLE.ADMIN]);
  const membersById = listMembersById_();
  return getActiveEnrollments_(chitId)
    .filter(function (e) { const m = membersById[e.MemberID]; return m && !m.Deleted; })
    .map(function (e) {
      const m = membersById[e.MemberID] || {};
      return { memberId: e.MemberID, name: m.Name, phone: m.Phone };
    });
}

/** Duplicate check for the pre-submit warning: a payment already logged today for this exact chit+member+amount. */
function checkPaymentDuplicate(chitId, memberId, amount) {
  requireRole_([ROLE.AGENT, ROLE.ADMIN]);
  const todayStr = formatDate_(new Date());
  const match = readAll_(SHEETS.COLLECTIONS).find(function (c) {
    return c.ChitID === chitId && c.MemberID === memberId && Number(c.Amount) === Number(amount) &&
      c.EntryType === ENTRY_TYPE.INSTALLMENT && !c.Deleted && formatDate_(c.Date) === todayStr;
  });
  return { duplicate: !!match };
}

function logPayment(chitId, memberId, amount, mode) {
  const user = requireRole_([ROLE.AGENT, ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  const today = new Date();
  const collectionId = newId_('COL');

  const row = {
    CollectionID: collectionId,
    ChitID: chitId,
    MemberID: memberId,
    Date: today,
    Amount: Number(amount),
    Mode: mode,
    EntryType: ENTRY_TYPE.INSTALLMENT,
    AgentEmail: user.Email,
    Timestamp: today,
    Notes: ''
  };
  row.Seal = buildCollectionSeal_(row); // see Receipts.gs — makes the receipt Ref code independently verifiable
  appendRow_(SHEETS.COLLECTIONS, row);

  const member = listMembersById_()[memberId];
  // collectionId doubles as the receipt's Ref code — see Notifications.gs for why.
  sendPaymentReceiptEmail_(member, chit, amount, mode, today, collectionId);
  const waLink = buildPaymentReceiptWhatsAppLink_(member, chit, amount, mode, today, collectionId);
  return { ok: true, whatsAppLink: waLink };
}

// ---------- Admin: chit onboarding ----------

function listAllChits() {
  requireRole_([ROLE.ADMIN]);
  return sanitizeForClient_(readAll_(SHEETS.CHITS).filter(function (c) { return !c.Deleted; }));
}

/** Comma-joins an array of weekday numbers (0=Sun..6=Sat) for storage; passes through a string as-is. */
function encodeCustomDays_(customDays) {
  if (!customDays) return '';
  if (Array.isArray(customDays)) return customDays.map(Number).join(',');
  return String(customDays);
}

function createChit(params) {
  const user = requireRole_([ROLE.ADMIN]);
  const chitId = newId_('CHIT');
  appendRow_(SHEETS.CHITS, {
    ChitID: chitId,
    Name: params.name,
    InstallmentAmount: Number(params.installmentAmount),
    FrequencyType: params.frequencyType,
    RoundLengthInTicks: Number(params.roundLengthInTicks),
    PlannedParticipantCount: Number(params.plannedParticipantCount),
    CommissionType: params.commissionType,
    CommissionValue: Number(params.commissionValue || 0),
    StartDate: new Date(params.startDate),
    Status: CHIT_STATUS.ENROLLING,
    CreatedBy: user.Email,
    CreatedOn: new Date(),
    CustomDays: encodeCustomDays_(params.customDays),
    Deleted: false
  });
  return { chitId: chitId };
}

/**
 * Edits an existing chit's details. Once a chit has any enrollment at all,
 * the financial/schedule fields are locked (changing them after members have
 * joined would silently corrupt every pool and ledger figure already
 * computed against the old configuration) — only the display Name stays
 * editable. This is enforced here, not just hidden in the UI, since the
 * client can't be trusted to honor it.
 */
function updateChitDetails(chitId, patch) {
  requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  const hasEnrollments = getAllEnrollmentsForChit_(chitId).length > 0;

  const safePatch = { Name: patch.name };
  if (!hasEnrollments) {
    if (patch.installmentAmount !== undefined) safePatch.InstallmentAmount = Number(patch.installmentAmount);
    if (patch.frequencyType !== undefined) safePatch.FrequencyType = patch.frequencyType;
    if (patch.roundLengthInTicks !== undefined) safePatch.RoundLengthInTicks = Number(patch.roundLengthInTicks);
    if (patch.plannedParticipantCount !== undefined) safePatch.PlannedParticipantCount = Number(patch.plannedParticipantCount);
    if (patch.commissionType !== undefined) safePatch.CommissionType = patch.commissionType;
    if (patch.commissionValue !== undefined) safePatch.CommissionValue = Number(patch.commissionValue || 0);
    if (patch.startDate !== undefined) safePatch.StartDate = new Date(patch.startDate);
    if (patch.customDays !== undefined) safePatch.CustomDays = encodeCustomDays_(patch.customDays);
  }
  const updated = updateRow_(SHEETS.CHITS, 'ChitID', chitId, safePatch);
  if (!updated) throw new Error('Chit not found.');
  return { ok: true, fieldsLocked: hasEnrollments };
}

/** Soft-delete: the chit stops appearing in the app (dropdowns, lists), but its row and history stay in the Sheet untouched. */
function deleteChit(chitId) {
  requireRole_([ROLE.ADMIN]);
  const updated = updateRow_(SHEETS.CHITS, 'ChitID', chitId, { Deleted: true });
  if (!updated) throw new Error('Chit not found.');
  return { ok: true };
}

function listMembersNotInChit(chitId) {
  requireRole_([ROLE.ADMIN]);
  const enrolled = new Set(getAllEnrollmentsForChit_(chitId).map(function (e) { return e.MemberID; }));
  return sanitizeForClient_(readAll_(SHEETS.MEMBERS).filter(function (m) { return !enrolled.has(m.MemberID) && !m.Deleted; }));
}

/** All members for the admin Members list — used to pick who to delete. */
function listMembers() {
  requireRole_([ROLE.ADMIN]);
  return sanitizeForClient_(readAll_(SHEETS.MEMBERS).filter(function (m) { return !m.Deleted; }));
}

/** Duplicate check for the pre-submit warning: an existing (non-deleted) member with this exact phone number. */
function checkMemberDuplicate(phone) {
  requireRole_([ROLE.ADMIN, ROLE.AGENT]);
  const match = readAll_(SHEETS.MEMBERS).find(function (m) {
    return !m.Deleted && String(m.Phone).trim() === String(phone).trim() && String(phone).trim() !== '';
  });
  return { duplicate: !!match, existingName: match ? match.Name : null };
}

function createMember(params) {
  requireRole_([ROLE.ADMIN, ROLE.AGENT]);
  const memberId = newId_('MEM');
  appendRow_(SHEETS.MEMBERS, {
    MemberID: memberId,
    Name: params.name,
    Phone: params.phone,
    Email: params.email || '',
    JoinedOn: new Date(),
    Notes: params.notes || '',
    Deleted: false
  });
  // Optional: enroll straight into one or more still-Enrolling chits from the same form.
  const results = [];
  (params.chitIds || []).forEach(function (chitId) {
    try {
      enrollMemberInChit(chitId, memberId);
      results.push({ chitId: chitId, ok: true });
    } catch (e) {
      results.push({ chitId: chitId, ok: false, error: e.message || String(e) });
    }
  });
  return { memberId: memberId, enrollments: results };
}

/** Soft-delete: the member stops appearing in dropdowns/collection screens, but their row and payment history stay in the Sheet untouched. */
function deleteMember(memberId) {
  requireRole_([ROLE.ADMIN]);
  const updated = updateRow_(SHEETS.MEMBERS, 'MemberID', memberId, { Deleted: true });
  if (!updated) throw new Error('Member not found.');
  return { ok: true };
}

function enrollMemberInChit(chitId, memberId) {
  requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  if (chit.Status !== CHIT_STATUS.ENROLLING) {
    throw new Error('This chit has already started — use the late-join flow instead.');
  }
  const currentCount = getActiveEnrollments_(chitId).length;
  if (currentCount >= Number(chit.PlannedParticipantCount)) {
    throw new Error('This chit is already at its planned participant count.');
  }
  const rowNumber = appendRow_(SHEETS.ENROLLMENTS, {
    EnrollmentID: newId_('ENR'),
    ChitID: chitId,
    MemberID: memberId,
    JoinDate: chit.StartDate,
    JoinType: JOIN_TYPE.NORMAL,
    CatchUpAmountDue: 0,
    CatchUpAmountPaid: 0,
    Status: ENROLLMENT_STATUS.ACTIVE
  });
  setEnrollmentMemberNameFormula_(rowNumber);
  return { ok: true };
}

/**
 * After an Enrollments row is appended, drops a live VLOOKUP formula into its
 * MemberName column (=IFERROR(VLOOKUP(<MemberID cell>, Members!A:B, 2, FALSE), ""))
 * so the raw sheet always shows the member's current name for easy debugging,
 * without needing to cross-reference MemberID by hand. It's a formula rather
 * than a stored value on purpose — it stays live if a member's name is ever
 * corrected later. Relies on Enrollments/Members columns only ever being
 * appended to, never reordered — see the comments in Constants.gs.
 */
function setEnrollmentMemberNameFormula_(rowNumber) {
  const memberIdCol = columnLetter_(COLUMNS.Enrollments.indexOf('MemberID'));
  setCellFormula_(SHEETS.ENROLLMENTS, rowNumber, 'MemberName',
    '=IFERROR(VLOOKUP(' + memberIdCol + rowNumber + ',Members!$A:$B,2,FALSE),"")');
}

function activateChit(chitId) {
  requireRole_([ROLE.ADMIN]);
  const updated = updateRow_(SHEETS.CHITS, 'ChitID', chitId, { Status: CHIT_STATUS.ACTIVE });
  if (!updated) throw new Error('Chit not found.');
  return { ok: true };
}

// ---------- Admin: late joiners ----------

function previewCatchupAmount(chitId, joinDateStr) {
  requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  return computeCatchupAmountDue_(chit, new Date(joinDateStr));
}

function lateJoinMember(chitId, memberId, joinType, joinDateStr) {
  requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  if (chit.Status !== CHIT_STATUS.ACTIVE) throw new Error('Late-join only applies to a chit that has already started.');

  const joinDate = new Date(joinDateStr);
  const catchupDue = computeCatchupAmountDue_(chit, joinDate);

  const rowNumber = appendRow_(SHEETS.ENROLLMENTS, {
    EnrollmentID: newId_('ENR'),
    ChitID: chitId,
    MemberID: memberId,
    JoinDate: joinDate,
    JoinType: joinType, // VACANCY or EXTRA
    CatchUpAmountDue: catchupDue,
    CatchUpAmountPaid: 0,
    Status: ENROLLMENT_STATUS.ACTIVE
  });
  setEnrollmentMemberNameFormula_(rowNumber);
  return { ok: true, catchupDue: catchupDue };
}

function logCatchupPayment(chitId, memberId, amount, mode) {
  const user = requireRole_([ROLE.ADMIN, ROLE.AGENT]);
  const chit = getChitById_(chitId);
  const today = new Date();

  const row = {
    CollectionID: newId_('COL'),
    ChitID: chitId,
    MemberID: memberId,
    Date: today,
    Amount: Number(amount),
    Mode: mode,
    EntryType: ENTRY_TYPE.CATCHUP,
    AgentEmail: user.Email,
    Timestamp: today,
    Notes: 'Late-join catch-up payment'
  };
  row.Seal = buildCollectionSeal_(row); // see Receipts.gs
  appendRow_(SHEETS.COLLECTIONS, row);

  const enrollment = getAllEnrollmentsForChit_(chitId).find(function (e) { return e.MemberID === memberId; });
  if (enrollment) {
    const newPaid = Number(enrollment.CatchUpAmountPaid || 0) + Number(amount);
    updateRow_(SHEETS.ENROLLMENTS, 'EnrollmentID', enrollment.EnrollmentID, { CatchUpAmountPaid: newPaid });
  }
  return { ok: true };
}

// ---------- Admin: draws ----------

function getEligibleDrawMembers(chitId) {
  requireRole_([ROLE.ADMIN]);
  const membersById = listMembersById_();
  return getEligibleForDraw_(chitId).map(function (e) {
    const m = membersById[e.MemberID] || {};
    return { memberId: e.MemberID, name: m.Name };
  });
}

function previewNextRoundPool(chitId) {
  requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  const activeCount = getActiveEnrollments_(chitId).length;
  const pool = computeRoundPool_(chit, activeCount);
  const commission = computeRoundCommission_(chit, pool);
  return { pool: pool, commission: commission, netPayout: pool - commission };
}

/**
 * Draws go through spin -> confirm/redraw, not a direct "pick anyone
 * eligible and record them" call — see spinDraw/confirmSpinWinner/
 * discardSpin below. Nothing calls a bare "record this member as winner"
 * anymore: the whole point of the spin flow is that the winner is picked by
 * the server, not chosen freehand, so that path was removed rather than
 * left reachable alongside it.
 */

/**
 * Starts a draw: picks a random winner from the chit's real eligible list
 * (server-side, so the outcome can't be seen or influenced from the
 * browser), logs the attempt, and stashes it as this chit's pending draw.
 * Returns the full eligible list plus which index won, so the client can
 * draw its wheel from the exact list the server actually used and animate
 * to the real outcome rather than picking its own.
 *
 * The pending draw is stashed in Script Properties, not Document Properties
 * — getDocumentProperties() only works for a script bound to the document
 * it's storing against, same limitation as getDocumentLock() (see
 * DataAccess.gs). A standalone project isn't bound to anything, so it
 * returned null and broke every function here with "Cannot read properties
 * of null (reading 'setProperty')" right after a spin.
 */
function spinDraw(chitId) {
  requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  if (chit.Status !== CHIT_STATUS.ACTIVE) throw new Error('This chit is not active.');

  const eligible = getEligibleForDraw_(chitId);
  if (!eligible.length) throw new Error('No eligible members left to draw.');
  const membersById = listMembersById_();
  const eligibleList = eligible.map(function (e) {
    const m = membersById[e.MemberID] || {};
    return { memberId: e.MemberID, name: m.Name };
  });

  const winnerIndex = Math.floor(Math.random() * eligibleList.length);
  const winner = eligibleList[winnerIndex];
  const token = newId_('SPIN');

  appendRow_(SHEETS.DRAW_ATTEMPTS, {
    AttemptID: token,
    ChitID: chitId,
    MemberID: winner.memberId,
    Timestamp: new Date(),
    Outcome: DRAW_ATTEMPT_STATUS.PENDING
  });
  PropertiesService.getScriptProperties().setProperty('pendingDraw_' + chitId,
    JSON.stringify({ memberId: winner.memberId, token: token }));

  return { eligible: eligibleList, winnerIndex: winnerIndex, winnerMemberId: winner.memberId, winnerName: winner.name, token: token };
}

/** Admin accepted the spun winner: records the real draw and closes out the pending attempt. Rejects if the token doesn't match the last spin — e.g. a stale tab, or the chit was spun again elsewhere first. */
function confirmSpinWinner(chitId, token) {
  const user = requireRole_([ROLE.ADMIN]);
  const raw = PropertiesService.getScriptProperties().getProperty('pendingDraw_' + chitId);
  if (!raw) throw new Error('No pending draw found for this chit — spin again.');
  const pending = JSON.parse(raw);
  if (pending.token !== token) throw new Error('This draw result is stale — spin again.');

  const chit = getChitById_(chitId);
  const result = recordDraw_(chitId, pending.memberId, user.Email);
  updateRow_(SHEETS.DRAW_ATTEMPTS, 'AttemptID', token, { Outcome: DRAW_ATTEMPT_STATUS.RECORDED });
  PropertiesService.getScriptProperties().deleteProperty('pendingDraw_' + chitId);

  const member = listMembersById_()[pending.memberId];
  sendDrawResultEmail_(member, chit, result);
  const waLink = buildDrawResultWhatsAppLink_(member, chit, result);
  return Object.assign({ whatsAppLink: waLink, memberName: member.Name }, result);
}

/** Admin rejected the spun winner: marks the attempt REDRAWN (kept in DrawAttempts for the audit trail) and clears the pending state so a fresh spin can start. */
function discardSpin(chitId, token) {
  requireRole_([ROLE.ADMIN]);
  const raw = PropertiesService.getScriptProperties().getProperty('pendingDraw_' + chitId);
  if (raw) {
    const pending = JSON.parse(raw);
    if (pending.token === token) {
      updateRow_(SHEETS.DRAW_ATTEMPTS, 'AttemptID', token, { Outcome: DRAW_ATTEMPT_STATUS.REDRAWN });
      PropertiesService.getScriptProperties().deleteProperty('pendingDraw_' + chitId);
    }
  }
  return { ok: true };
}

// ---------- Admin: ledgers, defaulters, dashboard ----------

function getChitLedger(chitId) {
  requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  const membersById = listMembersById_();
  const today = new Date();
  const collections = readAll_(SHEETS.COLLECTIONS).filter(function (c) { return c.ChitID === chitId && !c.Deleted; });

  return getAllEnrollmentsForChit_(chitId).map(function (e) {
    const member = membersById[e.MemberID] || {};
    const memberCollections = collections.filter(function (c) { return c.MemberID === e.MemberID; });
    const installmentsPaid = memberCollections.filter(function (c) { return c.EntryType === ENTRY_TYPE.INSTALLMENT; }).length;
    const totalPaid = memberCollections.reduce(function (sum, c) { return sum + Number(c.Amount); }, 0);
    const arrears = e.Status === ENROLLMENT_STATUS.ACTIVE ? getMemberArrears_(chit, e, today, collections) : 0;
    return {
      memberId: e.MemberID,
      name: member.Name,
      status: e.Status,
      joinType: e.JoinType,
      installmentsPaid: installmentsPaid,
      totalPaid: totalPaid,
      arrearsCount: arrears,
      catchupDue: Number(e.CatchUpAmountDue || 0),
      catchupPaid: Number(e.CatchUpAmountPaid || 0)
    };
  });
}

function getDefaulters(chitId) {
  requireRole_([ROLE.ADMIN]);
  return getDefaultersForChit_(chitId);
}

/** Recent (non-deleted) payment log for one chit, newest first, capped at 100 — the surface the admin deletes a wrong entry from. */
function listCollectionsForChit(chitId) {
  requireRole_([ROLE.ADMIN]);
  const membersById = listMembersById_();
  return readAll_(SHEETS.COLLECTIONS)
    .filter(function (c) { return c.ChitID === chitId && !c.Deleted; })
    .sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); })
    .slice(0, 100)
    .map(function (c) {
      const m = membersById[c.MemberID] || {};
      return {
        collectionId: c.CollectionID, memberName: m.Name, date: formatDate_(c.Date),
        amount: c.Amount, mode: c.Mode, entryType: c.EntryType
      };
    });
}

/**
 * Soft-delete: marks the payment row Deleted so it drops out of ledgers,
 * dashboards, and arrears math from this point on. The row itself stays in
 * the Sheet, matching the committee's ask to keep a full paper trail there.
 * Known limitation: if the deleted row was a late-joiner catch-up payment,
 * the enrollment's stored CatchUpAmountPaid total isn't auto-adjusted —
 * rare enough (late joiners are already the rare exception) that it's
 * flagged here rather than built out, but worth knowing before relying on it.
 */
function deleteCollection(collectionId) {
  requireRole_([ROLE.ADMIN]);
  const updated = updateRow_(SHEETS.COLLECTIONS, 'CollectionID', collectionId, { Deleted: true });
  if (!updated) throw new Error('Payment record not found.');
  return { ok: true };
}

/**
 * fromDateStr/toDateStr: the selected date range (both default to today if
 * omitted). chitId: a specific chit, or falsy for all chits.
 *
 * The "collected in period" / "by agent" figures are scoped strictly to
 * payments dated inside [from, to] — a period report ("how much came in
 * during this window"). The per-chit table is a point-in-time snapshot as of
 * the END of the range ("as of this date, what's expected vs collected") —
 * a different question, which is why it uses the whole history up to `to`
 * rather than just what fell inside the range. Both readings share the same
 * date range control since asking for two separate pickers would be more
 * confusing than useful here.
 */
function getDashboardSummary(fromDateStr, toDateStr, chitId) {
  requireRole_([ROLE.ADMIN]);
  const fromDate = fromDateStr ? new Date(fromDateStr) : new Date();
  const toDate = toDateStr ? new Date(toDateStr) : new Date();
  const fromStr = formatDate_(fromDate);
  const toStr = formatDate_(toDate);

  let chits = readAll_(SHEETS.CHITS).filter(function (c) { return !c.Deleted; });
  if (chitId) chits = chits.filter(function (c) { return c.ChitID === chitId; });
  const chitIdSet = new Set(chits.map(function (c) { return c.ChitID; }));

  const allCollections = readAll_(SHEETS.COLLECTIONS).filter(function (c) { return !c.Deleted && chitIdSet.has(c.ChitID); });
  const periodCollections = allCollections.filter(function (c) {
    const d = formatDate_(c.Date);
    return d >= fromStr && d <= toStr;
  });
  const periodTotal = periodCollections.reduce(function (s, c) { return s + Number(c.Amount); }, 0);

  const byAgent = {};
  periodCollections.forEach(function (c) {
    byAgent[c.AgentEmail] = (byAgent[c.AgentEmail] || 0) + Number(c.Amount);
  });

  // Read Enrollments and Members ONCE here and hand them to every per-chit
  // helper below, instead of letting each one re-read the whole sheet for
  // every single chit (and, for arrears, every single member within it).
  // That N+1 pattern used to turn one dashboard load into 70+ full-sheet
  // reads on a modest committee — see CHANGELOG.md.
  const allEnrollments = readAll_(SHEETS.ENROLLMENTS);
  const members = readAll_(SHEETS.MEMBERS);
  const preloaded = { members: members, allEnrollments: allEnrollments, allCollections: allCollections };

  const perChit = chits.map(function (chit) {
    const summary = getChitCollectionSummary_(chit, toDate, preloaded);
    const defaulters = getDefaultersForChit_(chit.ChitID, toDate, Object.assign({ chit: chit }, preloaded));
    return {
      chitId: chit.ChitID,
      name: chit.Name,
      status: chit.Status,
      expectedToDate: summary.expected,
      collectedToDate: summary.collected,
      defaulterCount: defaulters.length
    };
  });

  return {
    fromDate: fromStr,
    toDate: toStr,
    periodTotal: periodTotal,
    byAgent: Object.keys(byAgent).map(function (email) { return { email: email, amount: byAgent[email] }; }),
    perChit: perChit
  };
}

/**
 * Expected-vs-collected as of a given date (defaults to today) — "as of"
 * bounds both sides, so a payment logged after asOfDate doesn't inflate a
 * past snapshot.
 *
 * preloaded: optional { allEnrollments, allCollections } to avoid re-reading
 * those sheets when the caller (the dashboard) already has them loaded for
 * every chit in the loop. Omit it and this reads them itself.
 */
function getChitCollectionSummary_(chit, asOfDate, preloaded) {
  const today = asOfDate || new Date();
  const allEnrollments = (preloaded && preloaded.allEnrollments) || readAll_(SHEETS.ENROLLMENTS);
  const enrollments = allEnrollments.filter(function (e) { return e.ChitID === chit.ChitID && e.Status === ENROLLMENT_STATUS.ACTIVE; });
  let expected = 0;
  enrollments.forEach(function (e) {
    const effectiveStart = e.JoinDate > chit.StartDate ? e.JoinDate : chit.StartDate;
    const ticks = generateTicks_(effectiveStart, chit.FrequencyType, null, today, chit.CustomDays).length;
    expected += ticks * Number(chit.InstallmentAmount);
  });
  const todayStr = formatDate_(today);
  const allCollections = (preloaded && preloaded.allCollections) || readAll_(SHEETS.COLLECTIONS);
  const collections = allCollections.filter(function (c) {
    return c.ChitID === chit.ChitID && !c.Deleted && formatDate_(c.Date) <= todayStr;
  });
  const collected = collections.reduce(function (s, c) { return s + Number(c.Amount); }, 0);
  return { expected: expected, collected: collected };
}

// ---------- Agent dashboard ("My Day") ----------

/**
 * One agent's collection summary for a single day: total collected, split
 * by Cash/UPI, and a chitwise breakdown. Used by the "My Day" tab, which
 * every agent and admin sees.
 *
 * agentEmail: which agent's day to show. An AGENT can only ever see their
 * OWN day — the client never gets to choose whose data comes back, even
 * though the UI only exposes a picker to admins; identity for that comes
 * from the signed-in account via requireRole_(), the same rule as
 * everywhere else in this file. An ADMIN may pass any active user's email,
 * or omit it to see their own (admins can log payments too).
 *
 * dateStr: a single day (not a range, unlike the Admin Dashboard) —
 * defaults to today when omitted.
 *
 * Includes both INSTALLMENT and CATCHUP entries in every total: "how much
 * did I collect today" naturally means everything logged, matching how the
 * Admin Dashboard's own totals already work.
 *
 * Chitwise lists every currently ACTIVE chit, including ones this agent
 * collected nothing for today (shown as ₹0) — there's no agent-to-chit
 * assignment anywhere in this app (any agent can collect for any active
 * chit), so "every chit this agent is active on" is read here as "every
 * chit currently open for collection," not a fixed personal roster.
 */
function getAgentDashboardSummary(agentEmail, dateStr) {
  const user = requireRole_([ROLE.AGENT, ROLE.ADMIN]);
  const targetEmail = (user.Role === ROLE.AGENT) ? user.Email : (agentEmail || user.Email);

  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const targetDateStr = formatDate_(targetDate);

  const collections = readAll_(SHEETS.COLLECTIONS).filter(function (c) {
    return !c.Deleted && String(c.AgentEmail).toLowerCase() === String(targetEmail).toLowerCase() &&
      formatDate_(c.Date) === targetDateStr;
  });

  const totalCollected = collections.reduce(function (s, c) { return s + Number(c.Amount); }, 0);
  const cashTotal = collections.filter(function (c) { return c.Mode === MODE.CASH; })
    .reduce(function (s, c) { return s + Number(c.Amount); }, 0);
  const upiTotal = collections.filter(function (c) { return c.Mode === MODE.UPI; })
    .reduce(function (s, c) { return s + Number(c.Amount); }, 0);

  const byChit = {};
  collections.forEach(function (c) {
    byChit[c.ChitID] = (byChit[c.ChitID] || 0) + Number(c.Amount);
  });
  const activeChits = readAll_(SHEETS.CHITS).filter(function (c) { return c.Status === CHIT_STATUS.ACTIVE && !c.Deleted; });
  const chitwise = activeChits.map(function (chit) {
    return { chitId: chit.ChitID, name: chit.Name, amount: byChit[chit.ChitID] || 0 };
  }).sort(function (a, b) { return b.amount - a.amount; });

  return {
    agentEmail: targetEmail,
    date: targetDateStr,
    totalCollected: totalCollected,
    cashTotal: cashTotal,
    upiTotal: upiTotal,
    chitwise: chitwise
  };
}

// ---------- Admin: users & holidays ----------

function listUsers() {
  requireRole_([ROLE.ADMIN]);
  return readAll_(SHEETS.USERS);
}

function addUser(email, name, role) {
  requireRole_([ROLE.ADMIN]);
  appendRow_(SHEETS.USERS, { Email: email, Name: name, Role: role, Active: true });
  return { ok: true };
}

function setUserActive(email, active) {
  requireRole_([ROLE.ADMIN]);
  if (active === false || active === 'false') assertNotLastAdmin_(email);
  updateRow_(SHEETS.USERS, 'Email', email, { Active: active === true || active === 'true' });
  return { ok: true };
}

function setUserRole(email, role) {
  requireRole_([ROLE.ADMIN]);
  if (role !== ROLE.ADMIN && role !== ROLE.AGENT) throw new Error('Unknown role: ' + role);
  if (role === ROLE.AGENT) assertNotLastAdmin_(email);
  updateRow_(SHEETS.USERS, 'Email', email, { Role: role });
  return { ok: true };
}

function listHolidays() {
  requireRole_([ROLE.ADMIN]);
  return sanitizeForClient_(readAll_(SHEETS.HOLIDAYS));
}

function addHoliday(dateStr, description) {
  requireRole_([ROLE.ADMIN]);
  appendRow_(SHEETS.HOLIDAYS, { Date: new Date(dateStr), Description: description });
  _holidaySet_ = null; // invalidate the in-memory cache so the new holiday takes effect immediately
  return { ok: true };
}

// ---------- Admin: settings (branding + message templates) ----------

/** Maps the client-facing settings keys to their Config sheet keys, in one place so get/update can't drift apart. */
const APP_SETTINGS_MAP_ = {
  appTitle: 'AppTitle',
  theme: 'Theme',
  paymentReceiptWhatsAppTemplate: 'PaymentReceiptWhatsAppTemplate',
  paymentReceiptEmailTemplate: 'PaymentReceiptEmailTemplate',
  drawResultWhatsAppTemplate: 'DrawResultWhatsAppTemplate',
  drawResultEmailTemplate: 'DrawResultEmailTemplate'
};

/** Current customizable app settings, with sensible defaults for anything never saved. */
function getAppSettings() {
  requireRole_([ROLE.ADMIN]);
  return {
    appTitle: getConfigValue_('AppTitle', 'Chitty Kampany'),
    theme: getConfigValue_('Theme', 'classic'),
    paymentReceiptWhatsAppTemplate: getConfigValue_('PaymentReceiptWhatsAppTemplate', DEFAULT_PAYMENT_RECEIPT_WHATSAPP_),
    paymentReceiptEmailTemplate: getConfigValue_('PaymentReceiptEmailTemplate', DEFAULT_PAYMENT_RECEIPT_EMAIL_),
    drawResultWhatsAppTemplate: getConfigValue_('DrawResultWhatsAppTemplate', DEFAULT_DRAW_RESULT_WHATSAPP_),
    drawResultEmailTemplate: getConfigValue_('DrawResultEmailTemplate', DEFAULT_DRAW_RESULT_EMAIL_)
  };
}

/** Saves any subset of the customizable settings — only recognized keys are written, anything else is ignored. */
function updateAppSettings(patch) {
  requireRole_([ROLE.ADMIN]);
  Object.keys(APP_SETTINGS_MAP_).forEach(function (key) {
    if (patch[key] !== undefined) setConfigValue_(APP_SETTINGS_MAP_[key], patch[key]);
  });
  return { ok: true };
}
