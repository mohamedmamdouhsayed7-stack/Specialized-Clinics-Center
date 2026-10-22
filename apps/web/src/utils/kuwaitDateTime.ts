const KUWAIT_TIME_ZONE = 'Asia/Kuwait';

function calendarPartsInKuwait(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KUWAIT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, Number(part)])) as Record<string, number>;
}

function kuwaitLocalToUtcEpoch(year: number, month: number, day: number, hour: number, minute: number): number {
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = localEpoch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = calendarPartsInKuwait(new Date(candidate));
    const representedEpoch = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    const correction = localEpoch - representedEpoch;
    candidate += correction;
    if (correction === 0) break;
  }
  const verified = calendarPartsInKuwait(new Date(candidate));
  if (verified.year !== year || verified.month !== month || verified.day !== day || verified.hour !== hour || verified.minute !== minute) {
    throw new Error('Invalid Kuwait local date and time');
  }
  return candidate;
}

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
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) throw new Error('Invalid Kuwait local date and time');
  return new Date(kuwaitLocalToUtcEpoch(year, month, day, hour, minute)).toISOString();
}
