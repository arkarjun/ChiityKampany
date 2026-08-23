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
  HOLIDAYS: 'Holidays'
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
  Enrollments: [
    'EnrollmentID', 'ChitID', 'MemberID', 'JoinDate', 'JoinType',
    'CatchUpAmountDue', 'CatchUpAmountPaid', 'Status'
  ],
  Collections: [
    'CollectionID', 'ChitID', 'MemberID', 'Date', 'Amount', 'Mode',
    'EntryType', 'AgentEmail', 'Timestamp', 'Notes', 'Deleted'
  ],
  Draws: [
    'DrawID', 'ChitID', 'RoundNumber', 'DrawDate', 'WinnerMemberID',
    'PoolAmount', 'CommissionAmount', 'NetPayout', 'RecordedByEmail', 'Timestamp'
  ],
  Holidays: ['Date', 'Description']
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
