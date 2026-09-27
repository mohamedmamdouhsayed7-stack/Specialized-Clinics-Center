const KUWAIT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Convert an instant into the value expected by an HTML datetime-local input. */
export function toKuwaitDateTimeLocal(value: string | Date): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Convert a Kuwait-local datetime-local value to an unambiguous UTC instant. */
export function kuwaitDateTimeLocalToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Invalid Kuwait local date and time');
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(localAsUtc);
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
    date.getUTCHours() !== hour || date.getUTCMinutes() !== minute
  ) throw new Error('Invalid Kuwait local date and time');
  return new Date(localAsUtc - KUWAIT_UTC_OFFSET_MS).toISOString();
}
