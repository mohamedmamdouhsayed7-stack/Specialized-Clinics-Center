export const KUWAIT_TIME_ZONE = 'Asia/Kuwait';

function partsInKuwait(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KUWAIT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, Number(part)])) as Record<string, number>;
}

export function kuwaitLocalDateTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = localEpoch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = partsInKuwait(new Date(candidate));
    candidate += localEpoch - Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  }
  const actual = partsInKuwait(new Date(candidate));
  if (actual.year !== year || actual.month !== month || actual.day !== day || actual.hour !== hour || actual.minute !== minute || actual.second !== second) {
    throw new Error('Invalid Kuwait local date and time');
  }
  return new Date(candidate);
}

export function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
