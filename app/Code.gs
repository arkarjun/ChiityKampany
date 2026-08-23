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
  const template = HtmlService.createTemplateFromFile('Index');
  template.appTitle = appTitle;
  template.themeClass = 'theme-' + theme;
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

  appendRow_(SHEETS.COLLECTIONS, {
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
  });

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

  appendRow_(SHEETS.COLLECTIONS, {
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
  });

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

function recordDrawWinner(chitId, memberId) {
  const user = requireRole_([ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  const result = recordDraw_(chitId, memberId, user.Email);
  const member = listMembersById_()[memberId];
  sendDrawResultEmail_(member, chit, result);
  const waLink = buildDrawResultWhatsAppLink_(member, chit, result);
  return Object.assign({ whatsAppLink: waLink }, result);
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
    const arrears = e.Status === ENROLLMENT_STATUS.ACTIVE ? getMemberArrears_(chit, e, today) : 0;
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

function getDashboardSummary() {
  requireRole_([ROLE.ADMIN]);
  const chits = readAll_(SHEETS.CHITS).filter(function (c) { return c.Status === CHIT_STATUS.ACTIVE && !c.Deleted; });
  const allCollections = readAll_(SHEETS.COLLECTIONS).filter(function (c) { return !c.Deleted; });
  const todayStr = formatDate_(new Date());

  const todaysCollections = allCollections.filter(function (c) { return formatDate_(c.Date) === todayStr; });
  const todayTotal = todaysCollections.reduce(function (s, c) { return s + Number(c.Amount); }, 0);

  const byAgent = {};
  todaysCollections.forEach(function (c) {
    byAgent[c.AgentEmail] = (byAgent[c.AgentEmail] || 0) + Number(c.Amount);
  });

  const perChit = chits.map(function (chit) {
    const summary = getChitCollectionSummary_(chit);
    const defaulters = getDefaultersForChit_(chit.ChitID);
    return {
      chitId: chit.ChitID,
      name: chit.Name,
      expectedToDate: summary.expected,
      collectedToDate: summary.collected,
      defaulterCount: defaulters.length
    };
  });

  return {
    todayTotal: todayTotal,
    byAgent: Object.keys(byAgent).map(function (email) { return { email: email, amount: byAgent[email] }; }),
    perChit: perChit
  };
}

function getChitCollectionSummary_(chit) {
  const today = new Date();
  const enrollments = getActiveEnrollments_(chit.ChitID);
  let expected = 0;
  enrollments.forEach(function (e) {
    const effectiveStart = e.JoinDate > chit.StartDate ? e.JoinDate : chit.StartDate;
    const ticks = generateTicks_(effectiveStart, chit.FrequencyType, null, today, chit.CustomDays).length;
    expected += ticks * Number(chit.InstallmentAmount);
  });
  const collections = readAll_(SHEETS.COLLECTIONS).filter(function (c) { return c.ChitID === chit.ChitID && !c.Deleted; });
  const collected = collections.reduce(function (s, c) { return s + Number(c.Amount); }, 0);
  return { expected: expected, collected: collected };
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
