// family fork: dates that may be known only to the year or month (ancestors, old photos). Stored and
// exchanged as exactly what's known: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' (never padded to a made-up day).

export const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** True for '1938', '1938-03' and real days like '1938-03-14' (not '1938-02-30'). */
export const isPartialDate = (value: string): boolean => {
  if (!PARTIAL_DATE.test(value)) {
    return false;
  }
  if (value.length < 10) {
    return true;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** The last day a date could mean: '1951' → '1951-12-31', '1952-02' → '1952-02-29'. */
export const endOfPeriod = (value: string): string => {
  const [year, month] = value.split('-').map(Number);
  if (value.length === 4) {
    return `${value}-12-31`;
  }
  if (value.length === 7) {
    return `${value}-${String(daysIn(year, month)).padStart(2, '0')}`;
  }
  return value;
};

/**
Age in whole years on `taken` ('YYYY-MM-DD'), or null when it can't be told for sure: unknown birth,
a photo from before it, or a birth known only to the year or month when the photo is close enough to the
birthday that the age could be either of two numbers.
*/
export const ageOnPartial = (birth: string | null, taken: string | null): number | null => {
  if (!birth || !taken) {
    return null;
  }
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = taken.split('-').map(Number);
  const before = (month: number, day: number) => tm < month || (tm === month && td < day);
  // youngest and oldest they could be, over every day the birth could have been
  const oldest = ty - by - (bm === undefined ? (before(1, 1) ? 1 : 0) : before(bm, bd ?? 1) ? 1 : 0);
  const youngest =
    ty - by - (bm === undefined ? (before(12, 31) ? 1 : 0) : before(bm, bd ?? daysIn(by, bm)) ? 1 : 0);
  if (oldest !== youngest || youngest < 0) {
    return null;
  }
  return youngest;
};

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
What a stock screen's birth date means for the family's record: undefined for no change, else the new
value. Members' own copies hold null when the family date is partial ('1938'), so a stock screen
saving that null back must not wipe it; a full day can still be cleared.
*/
export const stockBirthDateChange = (requested: string | null, current: string | null): string | null | undefined => {
  if (requested === current) {
    return undefined;
  }
  if (requested === null && current !== null && !FULL_DAY.test(current)) {
    return undefined;
  }
  return requested;
};

const FULL_DAY = /^\d{4}-\d{2}-\d{2}$/;
