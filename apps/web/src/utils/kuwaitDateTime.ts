const KUWAIT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

function parseCalendarDate(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return [year, month, day];
}

/** Return the current business calendar date, independent of browser timezone. */
export function getKuwaitCalendarDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Move a date-only calendar value without applying the browser's local timezone. */
export function addCalendarDays(value: string, days: number): string {
  const parsed = parseCalendarDate(value);
  if (!parsed || !Number.isInteger(days)) throw new Error('Invalid calendar date');
  const [year, month, day] = parsed;
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [next.getUTCFullYear(), String(next.getUTCMonth() + 1).padStart(2, '0'), String(next.getUTCDate()).padStart(2, '0')].join('-');
}

export function isCalendarDate(value: string): boolean {
  return parseCalendarDate(value) !== null;
}

export function getSelectedKuwaitCalendarDate(requestedDate: string | null, now: Date = new Date()): string {
  return requestedDate && isCalendarDate(requestedDate) ? requestedDate : getKuwaitCalendarDate(now);
}

/** Format a date-only value in Kuwait while keeping the requested business day. */
export function formatKuwaitCalendarDate(value: string, locale: string): string {
  const parsed = parseCalendarDate(value);
  if (!parsed) return '';
  const [year, month, day] = parsed;
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(locale, {
    timeZone: 'Asia/Kuwait',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** A locale-independent appointment time key for calendar slot matching. */
export function getKuwaitTimeSlot(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuwait',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  return `${hour}:${minute}`;
}

export function groupAppointmentsByKuwaitTime<T extends { scheduledAt: string }>(appointments: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const appointment of appointments) {
    const time = getKuwaitTimeSlot(appointment.scheduledAt);
    if (!time) continue;
    const slot = grouped.get(time) || [];
    slot.push(appointment);
    grouped.set(time, slot);
  }
  return grouped;
}

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
