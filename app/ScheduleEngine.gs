/**
 * ScheduleEngine.gs
 * Turns a chit's frequency configuration into actual calendar dates —
 * "ticks" (collection due-dates) and "rounds" (groups of N ticks that end
 * in a draw). Everything here works in whole calendar days at midnight,
 * committee timezone (Asia/Kolkata, set in appsscript.json), so date
 * comparisons are simple.
 *
 * A tick is one due collection instance. A round is RoundLengthInTicks
 * consecutive ticks; the chit draws at the end of each round.
 */

function dateOnly_(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays_(date, days) {
  const d = dateOnly_(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonthsClamped_(startDate, monthsToAdd) {
  const start = dateOnly_(startDate);
  const targetMonthIndex = start.getMonth() + monthsToAdd;
  const targetYear = start.getFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(start.getDate(), daysInTargetMonth);
  return new Date(targetYear, targetMonth, day);
}

function formatDate_(d) {
  return Utilities.formatDate(dateOnly_(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

let _holidaySet_ = null;
function getHolidaySet_() {
  if (_holidaySet_) return _holidaySet_;
  const rows = readAll_(SHEETS.HOLIDAYS);
  _holidaySet_ = new Set(rows.map(function (r) { return formatDate_(r.Date); }));
  return _holidaySet_;
}

function isHoliday_(date) {
  return getHolidaySet_().has(formatDate_(date));
}

/** Working day = Monday-Saturday, and not in the Holidays sheet. */
function isWorkingDay_(date) {
  const day = dateOnly_(date).getDay(); // 0 = Sunday
  if (day === 0) return false;
  return !isHoliday_(date);
}

/** Parses Chits.CustomDays ('1,3,5') into a Set of Date.getDay() numbers. Empty/blank -> empty Set. */
function parseCustomDays_(customDaysStr) {
  const set = new Set();
  String(customDaysStr || '').split(',').forEach(function (part) {
    const n = parseInt(part, 10);
    if (!isNaN(n)) set.add(n);
  });
  return set;
}

/**
 * Generates tick dates for a chit's frequency starting at startDate (inclusive).
 * Bound with EITHER maxCount (stop after this many ticks) OR maxDate
 * (stop once a tick would fall after this date) — pass whichever the caller needs.
 * customDays is only consulted when frequencyType is CUSTOM_DAYS: a Set (or
 * comma-separated string) of Date.getDay() numbers (0=Sun ... 6=Sat).
 */
function generateTicks_(startDate, frequencyType, maxCount, maxDate, customDays) {
  const start = dateOnly_(startDate);
  const ticks = [];
  const customDaysSet = customDays instanceof Set ? customDays : parseCustomDays_(customDays);

  if (frequencyType === FREQUENCY_TYPE.MONTHLY) {
    let i = 0;
    while (true) {
      const d = addMonthsClamped_(start, i);
      if (maxDate && d > dateOnly_(maxDate)) break;
      ticks.push(d);
      i++;
      if (maxCount && ticks.length >= maxCount) break;
      if (i > 2000) break; // safety valve
    }
    return ticks;
  }

  let dayOffset = 0;
  while (true) {
    const d = addDays_(start, dayOffset);
    if (maxDate && d > dateOnly_(maxDate)) break;
    let isTick = false;
    switch (frequencyType) {
      case FREQUENCY_TYPE.DAILY:
        isTick = true;
        break;
      case FREQUENCY_TYPE.WORKING_DAYS:
        isTick = isWorkingDay_(d);
        break;
      case FREQUENCY_TYPE.ALTERNATE_DAYS:
        isTick = (dayOffset % 2 === 0);
        break;
      case FREQUENCY_TYPE.WEEKLY:
        isTick = (dayOffset % 7 === 0);
        break;
      case FREQUENCY_TYPE.CUSTOM_DAYS:
        isTick = customDaysSet.has(d.getDay());
        break;
      default:
        throw new Error('Unknown FrequencyType: ' + frequencyType);
    }
    if (isTick) {
      ticks.push(d);
      if (maxCount && ticks.length >= maxCount) break;
    }
    dayOffset++;
    if (dayOffset > 20000) break; // safety valve: ~55 years of daily ticks
  }
  return ticks;
}

/** All due dates from the chit's start up to and including `uptoDate`. */
function getTicksSoFar_(chit, uptoDate) {
  return generateTicks_(chit.StartDate, chit.FrequencyType, null, uptoDate, chit.CustomDays);
}

/** The calendar date on which round `roundNumber` (1-based) draws. */
function getRoundDrawDate_(chit, roundNumber) {
  const roundLength = Number(chit.RoundLengthInTicks);
  const ticks = generateTicks_(chit.StartDate, chit.FrequencyType, roundNumber * roundLength, null, chit.CustomDays);
  return ticks[ticks.length - 1];
}

/** Which round a given tick index (1-based) belongs to. */
function tickIndexToRound_(tickIndex, roundLengthInTicks) {
  return Math.ceil(tickIndex / roundLengthInTicks);
}

/**
 * Total scheduled rounds for a chit, honoring the commission model: when
 * commission is collected as one extra installment per member, that adds
 * one settlement round with no draw at the end of the schedule.
 */
function getTotalScheduledRounds_(chit) {
  const base = Number(chit.PlannedParticipantCount);
  return chit.CommissionType === COMMISSION_TYPE.EXTRA_INSTALLMENT_TOTAL ? base + 1 : base;
}
