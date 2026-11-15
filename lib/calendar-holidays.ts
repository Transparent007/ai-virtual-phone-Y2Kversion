/** U.S. nationwide federal holidays, using the standard Monday–Friday observed-day rules.
 * Source: https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/
 * State/school holidays, DC-only Inauguration Day and one-off closures are not included.
 * Date arithmetic stays in UTC so the calendar date never shifts with device timezone/DST.
 */
export type CalendarHolidayRegion = "US" | "none";
export type CalendarHoliday = {
  id: string;
  date: string;
  name: string;
  shortName: string;
  englishName: string;
  observed: boolean;
  actualDate: string;
};

const yearCache = new Map<number, CalendarHoliday[]>();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const date = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const nthWeekday = (year: number, month: number, weekday: number, nth: number) =>
  date(year, month, 1 + (weekday - date(year, month, 1).getUTCDay() + 7) % 7 + (nth - 1) * 7);
const lastMonday = (year: number, month: number) => {
  const last = date(year, month + 1, 0);
  last.setUTCDate(last.getUTCDate() - (last.getUTCDay() + 6) % 7);
  return last;
};

/** Includes actual holiday dates and separate observed dates, including adjacent-year spillover. */
export function getUSCalendarHolidays(year: number): CalendarHoliday[] {
  if (!Number.isInteger(year) || year < 1971 || year > 9998) return [];
  const cached = yearCache.get(year);
  if (cached) return cached;
  const entries: CalendarHoliday[] = [];
  for (let y = year - 1; y <= year + 1; y++) {
    const add = (id: string, name: string, shortName: string, englishName: string, day: Date, fixed = false) => {
      const actualDate = iso(day);
      const addDay = (d: Date, observed: boolean) => {
        if (d.getUTCFullYear() !== year) return;
        entries.push({ id: `${id}-${y}${observed ? "-observed" : ""}`, date: iso(d), name, shortName, englishName, observed, actualDate });
      };
      addDay(day, false);
      if (fixed && (day.getUTCDay() === 0 || day.getUTCDay() === 6)) {
        const observed = new Date(day);
        observed.setUTCDate(observed.getUTCDate() + (day.getUTCDay() === 6 ? -1 : 1));
        addDay(observed, true);
      }
    };
    add("new-year", "元旦", "元旦", "New Year's Day", date(y, 1, 1), true);
    if (y >= 1986) add("mlk", "马丁·路德·金纪念日", "马丁金日", "Birthday of Martin Luther King, Jr.", nthWeekday(y, 1, 1, 3));
    add("presidents", "总统日（华盛顿诞辰）", "总统日", "Washington's Birthday", nthWeekday(y, 2, 1, 3));
    add("memorial", "阵亡将士纪念日", "阵亡纪念", "Memorial Day", lastMonday(y, 5));
    if (y >= 2021) add("juneteenth", "六月节", "六月节", "Juneteenth National Independence Day", date(y, 6, 19), true);
    add("independence", "独立日", "独立日", "Independence Day", date(y, 7, 4), true);
    add("labor", "劳动节", "劳动节", "Labor Day", nthWeekday(y, 9, 1, 1));
    add("columbus", "哥伦布日（部分地区称原住民日）", "哥伦布日", "Columbus Day", nthWeekday(y, 10, 1, 2));
    add("veterans", "退伍军人节", "退伍军人", "Veterans Day", date(y, 11, 11), true);
    add("thanksgiving", "感恩节", "感恩节", "Thanksgiving Day", nthWeekday(y, 11, 4, 4));
    add("christmas", "圣诞节", "圣诞节", "Christmas Day", date(y, 12, 25), true);
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  if (yearCache.size >= 12) yearCache.clear();
  yearCache.set(year, entries);
  return entries;
}

export function getCalendarHolidays(isoDate: string, region: CalendarHolidayRegion): CalendarHoliday[] {
  if (region !== "US") return [];
  return getUSCalendarHolidays(Number(isoDate.slice(0, 4))).filter(h => h.date === isoDate);
}

export function calendarHolidayLabel(holiday: CalendarHoliday, short = false): string {
  return `${short ? holiday.shortName : holiday.name}${holiday.observed ? "（补休）" : ""}`;
}
