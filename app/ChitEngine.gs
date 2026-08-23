/**
 * ChitEngine.gs
 * The actual chit-fund math: round pools, commission, draw eligibility,
 * catch-up amounts for late joiners, and defaulter detection. This is the
 * one file that encodes the domain rules from the product brief — if a
 * rule ever changes, it should change here and nowhere else.
 */

function getActiveEnrollments_(chitId) {
  return readAll_(SHEETS.ENROLLMENTS).filter(function (e) {
    return e.ChitID === chitId && e.Status === ENROLLMENT_STATUS.ACTIVE;
  });
}

function getAllEnrollmentsForChit_(chitId) {
  return readAll_(SHEETS.ENROLLMENTS).filter(function (e) { return e.ChitID === chitId; });
}

/** Round pool = installment per tick x ticks per round x members currently active in the chit. */
function computeRoundPool_(chit, activeParticipantCount) {
  return Number(chit.InstallmentAmount) * Number(chit.RoundLengthInTicks) * activeParticipantCount;
}

/**
 * Commission for a single draw round. EXTRA_INSTALLMENT_TOTAL takes nothing
 * from the round pool — the winner always gets the full pool — because that
 * commission model is funded by each member's separate one-time extra
 * installment (collected in the chit's final settlement round), not by a
 * per-round deduction.
 */
function computeRoundCommission_(chit, poolAmount) {
  switch (chit.CommissionType) {
    case COMMISSION_TYPE.EXTRA_INSTALLMENT_TOTAL:
      return 0;
    case COMMISSION_TYPE.FLAT_PER_ROUND:
      return Number(chit.CommissionValue);
    case COMMISSION_TYPE.PERCENTAGE_OF_POOL:
      return Math.round(poolAmount * Number(chit.CommissionValue) / 100);
    default:
      throw new Error('Unknown CommissionType: ' + chit.CommissionType);
  }
}

/** Members still eligible to win this chit: actively enrolled and not already won. */
function getEligibleForDraw_(chitId) {
  return getActiveEnrollments_(chitId);
}

/**
 * Records a draw: computes the pool from the CURRENT active roster (so a
 * late EXTRA joiner correctly grows future pools), applies commission,
 * writes the Draws row, and marks the winner's enrollment WON so they drop
 * out of future eligibility for this chit.
 */
function recordDraw_(chitId, winnerMemberId, recordedByEmail) {
  const chit = getChitById_(chitId);
  if (!chit) throw new Error('Chit not found: ' + chitId);

  const eligible = getEligibleForDraw_(chitId);
  const winnerEnrollment = eligible.find(function (e) { return e.MemberID === winnerMemberId; });
  if (!winnerEnrollment) {
    throw new Error('That member is not eligible to win this draw (already won, or not enrolled).');
  }

  const existingDraws = readAll_(SHEETS.DRAWS).filter(function (d) { return d.ChitID === chitId; });
  const roundNumber = existingDraws.length + 1;

  const activeCount = getActiveEnrollments_(chitId).length;
  const pool = computeRoundPool_(chit, activeCount);
  const commission = computeRoundCommission_(chit, pool);
  const netPayout = pool - commission;

  appendRow_(SHEETS.DRAWS, {
    DrawID: newId_('DRAW'),
    ChitID: chitId,
    RoundNumber: roundNumber,
    DrawDate: new Date(),
    WinnerMemberID: winnerMemberId,
    PoolAmount: pool,
    CommissionAmount: commission,
    NetPayout: netPayout,
    RecordedByEmail: recordedByEmail,
    Timestamp: new Date()
  });

  updateRow_(SHEETS.ENROLLMENTS, 'EnrollmentID', winnerEnrollment.EnrollmentID, {
    Status: ENROLLMENT_STATUS.WON
  });

  // If that was the last member left eligible, everyone has now won once —
  // the chit's run is over. Close it automatically so it drops out of the
  // Active tab and out of the Collect screen's dropdown.
  const stillEligible = getActiveEnrollments_(chitId).filter(function (e) {
    return e.EnrollmentID !== winnerEnrollment.EnrollmentID;
  });
  if (stillEligible.length === 0) {
    updateRow_(SHEETS.CHITS, 'ChitID', chitId, { Status: CHIT_STATUS.CLOSED });
  }

  return { roundNumber: roundNumber, pool: pool, commission: commission, netPayout: netPayout };
}

/**
 * What a late joiner owes as a one-time catch-up: the installment for every
 * tick strictly before their join date. It only settles their account
 * forward — it does not reopen or top up rounds that already drew and paid
 * a winner.
 */
function computeCatchupAmountDue_(chit, joinDate) {
  const dayBeforeJoin = addDays_(joinDate, -1);
  const ticksBefore = getTicksSoFar_(chit, dayBeforeJoin);
  return ticksBefore.length * Number(chit.InstallmentAmount);
}

/**
 * How many installments a member should have paid by today, and how many
 * they've actually logged (INSTALLMENT entries only — a CATCHUP payment
 * settles pre-join ticks separately and isn't counted here). The
 * difference, if positive, is how many installments they're in default on.
 * No grace period: one unpaid due date is enough to flag as in default.
 */
function getMemberArrears_(chit, enrollment, asOfDate) {
  const effectiveStart = enrollment.JoinDate > chit.StartDate ? enrollment.JoinDate : chit.StartDate;
  const ticksDue = generateTicks_(effectiveStart, chit.FrequencyType, null, asOfDate, chit.CustomDays).length;
  const collections = readAll_(SHEETS.COLLECTIONS).filter(function (c) {
    return c.ChitID === chit.ChitID && c.MemberID === enrollment.MemberID &&
      c.EntryType === ENTRY_TYPE.INSTALLMENT && !c.Deleted;
  });
  const paidCount = collections.length;
  return Math.max(0, ticksDue - paidCount);
}

/** All members currently in default (arrears > 0) for one chit. */
function getDefaultersForChit_(chitId) {
  const chit = getChitById_(chitId);
  if (!chit) return [];
  const today = new Date();
  const members = readAll_(SHEETS.MEMBERS);
  return getActiveEnrollments_(chitId).map(function (e) {
    const arrears = getMemberArrears_(chit, e, today);
    const member = members.find(function (m) { return m.MemberID === e.MemberID; });
    return { memberId: e.MemberID, memberName: member ? member.Name : '(unknown)', arrearsCount: arrears };
  }).filter(function (row) { return row.arrearsCount > 0; });
}

function getChitById_(chitId) {
  return readAll_(SHEETS.CHITS).find(function (c) { return c.ChitID === chitId; }) || null;
}
