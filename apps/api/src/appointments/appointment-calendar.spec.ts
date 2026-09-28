import {
  addCalendarDays,
  formatKuwaitCalendarDate,
  getKuwaitCalendarDate,
  getKuwaitTimeSlot,
  getSelectedKuwaitCalendarDate,
  groupAppointmentsByKuwaitTime,
  isCalendarDate,
} from '../../../web/src/utils/kuwaitDateTime';
import { collectAppointmentPages } from '../../../web/src/utils/appointmentPages';

describe('Kuwait appointment calendar helpers', () => {
  it('collects all API pages for refresh-safe appointment calendars', async () => {
    const fetchPage = jest.fn(async (page: number, limit: number) => ({
      data: page === 1 ? ['first', 'second'] : ['third'],
      meta: { total: 3, page, limit, totalPages: 2 },
    }));
    const result = await collectAppointmentPages(fetchPage, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 2);
    expect(result.data).toEqual(['first', 'second', 'third']);
  });

  it('keeps the Kuwait business date stable across browser and UTC date boundaries', () => {
    expect(getKuwaitCalendarDate(new Date('2026-09-27T21:00:00.000Z'))).toBe('2026-09-28');
    expect(getSelectedKuwaitCalendarDate('2026-09-28', new Date('2026-09-20T21:00:00.000Z'))).toBe('2026-09-28');
    expect(getSelectedKuwaitCalendarDate('invalid', new Date('2026-09-27T21:00:00.000Z'))).toBe('2026-09-28');
    expect(addCalendarDays('2026-09-28', 1)).toBe('2026-09-29');
    expect(addCalendarDays('2026-09-28', -1)).toBe('2026-09-27');
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(formatKuwaitCalendarDate('2026-09-28', 'en-GB')).toContain('28');
  });

  it('formats slot keys in Kuwait time independent of user-facing locale', () => {
    expect(getKuwaitTimeSlot('2026-09-27T21:00:00.000Z')).toBe('00:00');
    expect(getKuwaitTimeSlot('2026-09-27T21:30:00.000Z')).toBe('00:30');
    expect(getKuwaitTimeSlot('2026-09-28T20:30:00.000Z')).toBe('23:30');
  });

  it('groups every same-time appointment and leaves empty slots absent for Available rendering', () => {
    type TestAppointment = { id: string; scheduledAt: string };
    const empty = groupAppointmentsByKuwaitTime<TestAppointment>([]);
    expect(empty.has('10:00')).toBe(false);

    const atTen = (ids: string[]): TestAppointment[] => ids.map((id) => ({
      id,
      scheduledAt: '2026-09-28T07:00:00.000Z',
    }));
    expect(groupAppointmentsByKuwaitTime(atTen(['one'])).get('10:00')).toHaveLength(1);
    expect(groupAppointmentsByKuwaitTime(atTen(['one', 'two'])).get('10:00')).toHaveLength(2);
    expect(groupAppointmentsByKuwaitTime(atTen(['one', 'two', 'three'])).get('10:00')?.map(({ id }) => id))
      .toEqual(['one', 'two', 'three']);

    const grouped = groupAppointmentsByKuwaitTime([
      ...atTen(['first', 'second', 'third']),
      { id: 'half-past', scheduledAt: '2026-09-28T07:30:00.000Z' },
    ]);
    expect(grouped.get('10:00')).toHaveLength(3);
    expect(grouped.get('10:30')?.map(({ id }) => id)).toEqual(['half-past']);
  });
});
