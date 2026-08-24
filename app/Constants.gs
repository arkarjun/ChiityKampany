/**
 * Constants.gs
 * Central place for sheet names and column layouts, so every other file
 * refers to a tab or a field by name instead of a magic column number.
 * If you ever need to add a column, add it here and to the matching
 * header row in Setup.gs — the rest of the code reads columns by name.
 */

const SHEETS = {
  CONFIG: 'Config',
  USERS: 'Users',
  MEMBERS: 'Members',
  CHITS: 'Chits',
  ENROLLMENTS: 'Enrollments',
  COLLECTIONS: 'Collections',
  DRAWS: 'Draws',
  HOLIDAYS: 'Holidays',
  DRAW_ATTEMPTS: 'DrawAttempts'
};

// Column headers per sheet, in the exact order they appear in row 1.
// DataAccess.gs turns each data row into an object keyed by these names.
const COLUMNS = {
  Config: ['Key', 'Value'],
  Users: ['Email', 'Name', 'Role', 'Active'],
  // 'Deleted' is appended at the end of Members/Chits/Collections rather than
  // inserted among the original columns: ensureHeader_() only ever rewrites
  // row 1 (the header), so an existing sheet's data rows are never shifted.
  // Appending keeps old rows positionally correct — they simply read as
  // Deleted = '' (falsy, i.e. not deleted) until touched.
  Members: ['MemberID', 'Name', 'Phone', 'Email', 'JoinedOn', 'Notes', 'Deleted'],
  Chits: [
    'ChitID', 'Name', 'InstallmentAmount', 'FrequencyType', 'RoundLengthInTicks',
    'PlannedParticipantCount', 'CommissionType', 'CommissionValue',
    'StartDate', 'Status', 'CreatedBy', 'CreatedOn', 'CustomDays', 'Deleted'
  ],
  // 'MemberName' is appended at the end (same reasoning as 'Deleted' above) and
  // is never written as a plain value — Code.gs drops a live VLOOKUP formula
  // into it when an enrollment row is created, so it always reflects whatever
  // the member's current name is rather than a stale snapshot. It exists
  // purely so the raw sheet is readable for debugging without cross-referencing
  // MemberID against the Members tab by hand.
  Enrollments: [
    'EnrollmentID', 'ChitID', 'MemberID', 'JoinDate', 'JoinType',
    'CatchUpAmountDue', 'CatchUpAmountPaid', 'Status', 'MemberName'
  ],
  // 'Seal' is appended at the end (same reasoning as 'Deleted' above). It's
  // written only by logPayment()/logCatchupPayment() in Code.gs, computed
  // from a secret that never leaves the script's own private settings —
  // see Receipts.gs. A row typed directly into the sheet, however
  // convincing, will have a blank or wrong Seal and fail verifyReceipt().
  Collections: [
    'CollectionID', 'ChitID', 'MemberID', 'Date', 'Amount', 'Mode',
    'EntryType', 'AgentEmail', 'Timestamp', 'Notes', 'Deleted', 'Seal'
  ],
  Draws: [
    'DrawID', 'ChitID', 'RoundNumber', 'DrawDate', 'WinnerMemberID',
    'PoolAmount', 'CommissionAmount', 'NetPayout', 'RecordedByEmail', 'Timestamp'
  ],
  Holidays: ['Date', 'Description'],
  // Every wheel spin gets a row here — whether it's ultimately recorded as
  // the real winner or discarded via ReDraw — so there's a durable record of
  // the actual draw history, not just whatever the admin chose to keep. Not
  // surfaced anywhere prominent in the UI; it exists for the rare "how many
  // times did you redraw before I won?" question. See spinDraw_/confirmSpinWinner
  // /discardSpin in Code.gs.
  DrawAttempts: ['AttemptID', 'ChitID', 'MemberID', 'Timestamp', 'Outcome']
};

// Enumerated values used across the app. Keeping them as constants avoids
// typos like 'Admin' vs 'ADMIN' silently breaking a role check.
const ROLE = { ADMIN: 'ADMIN', AGENT: 'AGENT' };

const FREQUENCY_TYPE = {
  DAILY: 'DAILY',
  WORKING_DAYS: 'WORKING_DAYS', // Mon-Sat, or Mon-Sat minus Holidays sheet
  ALTERNATE_DAYS: 'ALTERNATE_DAYS',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  // A committee-chosen subset of weekdays, e.g. Mon/Wed/Fri only. Which days
  // are picked lives per-chit in the Chits.CustomDays column, as a
  // comma-separated list of JS Date.getDay() numbers (0=Sun ... 6=Sat).
  CUSTOM_DAYS: 'CUSTOM_DAYS'
};

const CHIT_STATUS = { ENROLLING: 'ENROLLING', ACTIVE: 'ACTIVE', CLOSED: 'CLOSED' };

const ENROLLMENT_STATUS = { ACTIVE: 'ACTIVE', WON: 'WON', EXITED: 'EXITED' };

const JOIN_TYPE = { NORMAL: 'NORMAL', VACANCY: 'VACANCY', EXTRA: 'EXTRA' };

const ENTRY_TYPE = {
  INSTALLMENT: 'INSTALLMENT',
  CATCHUP: 'CATCHUP' // a late joiner's one-time lump sum
};

const COMMISSION_TYPE = {
  // Every member pays exactly one extra round's installment, once, over the
  // life of the chit. The round pool itself is never reduced for this type —
  // the winner always gets the full pool. This matches the model the product
  // brief was designed against.
  EXTRA_INSTALLMENT_TOTAL: 'EXTRA_INSTALLMENT_TOTAL',
  // A fixed rupee amount is deducted from each round's pool before payout.
  FLAT_PER_ROUND: 'FLAT_PER_ROUND',
  // A percentage of each round's pool is deducted before payout.
  PERCENTAGE_OF_POOL: 'PERCENTAGE_OF_POOL'
};

const MODE = { CASH: 'CASH', UPI: 'UPI' };

const DRAW_ATTEMPT_STATUS = { PENDING: 'PENDING', RECORDED: 'RECORDED', REDRAWN: 'REDRAWN' };

// Bumped by hand on any release worth calling out — shown in the footer and
// in CHANGELOG.md. Format: <major>.<minor>.<patch> — major for breaking
// setup/data changes, minor for new features, patch for fixes only.
const APP_VERSION = '1.0.1';
