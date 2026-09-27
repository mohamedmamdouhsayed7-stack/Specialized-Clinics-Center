import {
  kuwaitDateTimeLocalToIso,
  toKuwaitDateTimeLocal,
} from '../../../web/src/utils/kuwaitDateTime';

describe('Kuwait local datetime serialization used by appointment and visit forms', () => {
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
});
