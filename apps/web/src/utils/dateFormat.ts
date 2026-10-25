// Centralized, language-aware date formatting
// its own copy of this hardcoded to 'ar-KW'. Having it in one place means
// adding a third language later only means editing this file.
const KUWAIT_TIME_ZONE = 'Asia/Kuwait';

function timeOptionsWithoutZeroMinutes(value: Date): Intl.DateTimeFormatOptions {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: KUWAIT_TIME_ZONE,
  }).formatToParts(value);
  const minute = parts.find((part) => part.type === 'minute')?.value;

  return {
    hour: 'numeric',
    ...(minute === '00' ? {} : { minute: '2-digit' as const }),
    timeZone: KUWAIT_TIME_ZONE,
  };
}

function formatWithoutPaddedHour(value: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  const parts = new Intl.DateTimeFormat(locale, options).formatToParts(value);
  const localizedZero = new Intl.NumberFormat(locale, { useGrouping: false }).format(0);
  return parts.map((part) => {
    if (part.type !== 'hour' || !part.value.startsWith(localizedZero) || part.value.length === localizedZero.length) {
      return part.value;
    }
    return part.value.slice(localizedZero.length);
  }).join('');
}

function formatEnglishTime(value: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...options, hour12: true }).formatToParts(value)
    .map((part) => part.value)
    .join('')
    .replace(/\u202f/g, ' ');
}

export function formatDate(value: string | Date | null | undefined, language: string): string {
  if (!value) return '—';
  const locale = language === 'ar' ? 'ar-KW' : 'en-GB';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kuwait' });
  }
  return new Date(value).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Kuwait' });
}

export function formatDateTime(value: string | Date | null | undefined, language: string): string {
  if (!value) return '—';
  const locale = language === 'ar' ? 'ar-KW' : 'en-GB';
  const date = new Date(value);
  if (language !== 'ar') {
    const dateLabel = date.toLocaleDateString(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: KUWAIT_TIME_ZONE,
    });
    return `${dateLabel} ${formatEnglishTime(date, timeOptionsWithoutZeroMinutes(date))}`;
  }
  return formatWithoutPaddedHour(date, locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', ...timeOptionsWithoutZeroMinutes(date),
  });
}

export function formatTime(value: string | Date | null | undefined, language: string): string {
  if (!value) return '—';
  const locale = language === 'ar' ? 'ar-KW' : 'en-GB';
  const date = new Date(value);
  if (language !== 'ar') return formatEnglishTime(date, timeOptionsWithoutZeroMinutes(date));
  return formatWithoutPaddedHour(date, locale, timeOptionsWithoutZeroMinutes(date));
}
