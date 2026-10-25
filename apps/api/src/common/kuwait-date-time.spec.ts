import {
  kuwaitDateTimeLocalToIso,
  toKuwaitDateTimeLocal,
  getKuwaitCalendarDate,
} from '../../../web/src/utils/kuwaitDateTime';
import { formatDate, formatDateTime, formatTime } from '../../../web/src/utils/dateFormat';

describe('Kuwait local datetime serialization used by appointment and visit forms', () => {
  it.each([
    ['2026-09-25T08:00:00.000Z', '11 AM'],
    ['2026-09-25T08:05:00.000Z', '11:05 AM'],
    ['2026-09-25T08:30:00.000Z', '11:30 AM'],
    ['2026-09-25T21:00:00.000Z', '12 AM'],
    ['2026-09-25T21:05:00.000Z', '12:05 AM'],
    ['2026-09-25T09:00:00.000Z', '12 PM'],
    ['2026-09-25T09:05:00.000Z', '12:05 PM'],
    ['2026-09-25T22:05:00.000Z', '1:05 AM'],
    ['2026-09-25T12:00:00.000Z', '3 PM'],
    ['2026-09-25T12:30:00.000Z', '3:30 PM'],
    ['2026-09-25T10:00:00.000Z', '1 PM'],
    ['2026-09-25T10:05:00.000Z', '1:05 PM'],
    ['2026-09-25T20:00:00.000Z', '11 PM'],
    ['2026-09-25T20:45:00.000Z', '11:45 PM'],
    ['2026-09-25T07:30:00.000Z', '10:30 AM'],
  ])('formats Kuwait display time for %s as %s without changing instant conversion', (instant, expected) => {
    expect(formatTime(instant, 'en')).toBe(expected);
  });

  it('formats calendar slot labels through the Kuwait timezone formatter', () => {
    expect(formatTime(kuwaitDateTimeLocalToIso('2026-09-25T10:00'), 'en')).toBe('10 AM');
    expect(formatTime(kuwaitDateTimeLocalToIso('2026-09-25T09:30'), 'en')).toBe('9:30 AM');
  });

  it('omits zero minutes in date-time displays and preserves non-zero minutes', () => {
    expect(formatDateTime('2026-09-25T08:00:00.000Z', 'en')).toMatch(/11 AM$/);
    expect(formatDateTime('2026-09-25T08:30:00.000Z', 'en')).toMatch(/11:30 AM$/);
  });

  it('serializes a local midnight boundary as an explicit UTC instant', () => {
    expect(kuwaitDateTimeLocalToIso('2026-08-29T00:00')).toBe('2026-08-28T21:00:00.000Z');
  });

  it('formats and round-trips a representative business appointment time', () => {
    const formValue = toKuwaitDateTimeLocal('2026-09-25T07:30:00.000Z');

    expect(formValue).toBe('2026-09-25T10:30');
    expect(kuwaitDateTimeLocalToIso(formValue)).toBe('2026-09-25T07:30:00.000Z');
  });

  it('rejects invalid or incomplete local datetime values', () => {
    expect(() => kuwaitDateTimeLocalToIso('2026-02-30T10:00')).toThrow('Invalid Kuwait local date and time');
    expect(() => kuwaitDateTimeLocalToIso('2026-09-25T10:00Z')).toThrow('Invalid Kuwait local date and time');
  });

  it('keeps the same Kuwait instant across host timezones and preserves date-only values', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const losAngeles = kuwaitDateTimeLocalToIso('2026-09-25T10:30');
      process.env.TZ = 'Pacific/Honolulu';
      const honolulu = kuwaitDateTimeLocalToIso('2026-09-25T10:30');
      expect(losAngeles).toBe('2026-09-25T07:30:00.000Z');
      expect(honolulu).toBe(losAngeles);
      expect(getKuwaitCalendarDate(new Date('2026-09-25T21:30:00.000Z'))).toBe('2026-09-26');
      expect(formatDate('2026-09-25', 'en')).toContain('25');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
