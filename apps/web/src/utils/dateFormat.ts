// Centralized, language-aware date formatting
// its own copy of this hardcoded to 'ar-KW'. Having it in one place means
// adding a third language later only means editing this file.
export function formatDate(value: string | Date | null | undefined, language: string): string {
  if (!value) return '—';
  const locale = language === 'ar' ? 'ar-KW' : 'en-GB';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return new Date(value).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatDateTime(value: string | Date | null | undefined, language: string): string {
  if (!value) return '—';
  const locale = language === 'ar' ? 'ar-KW' : 'en-GB';
  return new Date(value).toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(value: string | Date | null | undefined, language: string): string {
  if (!value) return '—';
  const locale = language === 'ar' ? 'ar-KW' : 'en-GB';
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
