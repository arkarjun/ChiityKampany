/**
 * Code.gs
 * Web app entry point plus every server-side function the client calls
 * through google.script.run. Every function that reads or changes real
 * data starts with requireRole_() — the client-side role check in
 * Index.html is only there to pick which screen to show, not to enforce
 * anything.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Chitty Kampany')
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
    .filter(function (c) { return c.Status === CHIT_STATUS.ACTIVE; })
    .map(function (c) { return { chitId: c.ChitID, name: c.Name, installmentAmount: c.InstallmentAmount }; });
}

function listActiveMembersForChit(chitId) {
  requireRole_([ROLE.AGENT, ROLE.ADMIN]);
  const membersById = listMembersById_();
  return getActiveEnrollments_(chitId).map(function (e) {
    const m = membersById[e.MemberID] || {};
    return { memberId: e.MemberID, name: m.Name, phone: m.Phone };
  });
}

function logPayment(chitId, memberId, amount, mode) {
  const user = requireRole_([ROLE.AGENT, ROLE.ADMIN]);
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found.');
  const today = new Date();

  appendRow_(SHEETS.COLLECTIONS, {
    CollectionID: newId_('COL'),
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
  sendPaymentReceiptEmail_(member, chit, amount, mode, today);
  const waLink = buildPaymentReceiptWhatsAppLink_(member, chit, amount, mode, today);
  return { ok: true, whatsAppLink: waLink };
}

// ---------- Admin: chit onboarding ----------

function listAllChits() {
  requireRole_([ROLE.ADMIN]);
  return readAll_(SHEETS.CHITS);
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
    CreatedOn: new Date()
  });
  return { chitId: chitId };
}

function listMembersNotInChit(chitId) {
  requireRole_([ROLE.ADMIN]);
  const enrolled = new Set(getAllEnrollmentsForChit_(chitId).map(function (e) { return e.MemberID; }));
  return readAll_(SHEETS.MEMBERS).filter(function (m) { return !enrolled.has(m.MemberID); });
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
    Notes: params.notes || ''
  });
  return { memberId: memberId };
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
  appendRow_(SHEETS.ENROLLMENTS, {
    EnrollmentID: newId_('ENR'),
    ChitID: chitId,
    MemberID: memberId,
    JoinDate: chit.StartDate,
    JoinType: JOIN_TYPE.NORMAL,
    CatchUpAmountDue: 0,
    CatchUpAmountPaid: 0,
    Status: ENROLLMENT_STATUS.ACTIVE
  });
  return { ok: true };
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

  appendRow_(SHEETS.ENROLLMENTS, {
    EnrollmentID: newId_('ENR'),
    ChitID: chitId,
    MemberID: memberId,
    JoinDate: joinDate,
    JoinType: joinType, // VACANCY or EXTRA
    CatchUpAmountDue: catchupDue,
    CatchUpAmountPaid: 0,
    Status: ENROLLMENT_STATUS.ACTIVE
  });
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
  const collections = readAll_(SHEETS.COLLECTIONS).filter(function (c) { return c.ChitID === chitId; });

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

function getDashboardSummary() {
  requireRole_([ROLE.ADMIN]);
  const chits = readAll_(SHEETS.CHITS).filter(function (c) { return c.Status === CHIT_STATUS.ACTIVE; });
  const allCollections = readAll_(SHEETS.COLLECTIONS);
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
    const ticks = generateTicks_(effectiveStart, chit.FrequencyType, null, today).length;
    expected += ticks * Number(chit.InstallmentAmount);
  });
  const collections = readAll_(SHEETS.COLLECTIONS).filter(function (c) { return c.ChitID === chit.ChitID; });
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
  updateRow_(SHEETS.USERS, 'Email', email, { Active: active });
  return { ok: true };
}

function listHolidays() {
  requireRole_([ROLE.ADMIN]);
  return readAll_(SHEETS.HOLIDAYS);
}

function addHoliday(dateStr, description) {
  requireRole_([ROLE.ADMIN]);
  appendRow_(SHEETS.HOLIDAYS, { Date: new Date(dateStr), Description: description });
  _holidaySet_ = null; // invalidate the in-memory cache so the new holiday takes effect immediately
  return { ok: true };
}
