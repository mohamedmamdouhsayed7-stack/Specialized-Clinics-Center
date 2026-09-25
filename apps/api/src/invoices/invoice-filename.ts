const ILLEGAL_FILENAME_CHARACTERS = /[\p{Cc}\p{Cf}<>:"/\\|?*]/gu;

export function invoicePatientDisplayName(
  patient: { fullNameAr: string; fullNameEn?: string | null },
  language: 'ar' | 'en',
): string {
  return language === 'ar'
    ? patient.fullNameAr || patient.fullNameEn || 'Unknown'
    : patient.fullNameEn || patient.fullNameAr || 'Unknown';
}

export function sanitizeInvoiceFilenamePart(value: string): string {
  const sanitized = Array.from(
    value.normalize('NFC').replace(ILLEGAL_FILENAME_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim(),
  ).slice(0, 96).join('').replace(/^[. ]+|[. ]+$/gu, '');
  return sanitized || 'Unknown';
}

export function createInvoiceDocumentTitle(patientName: string, invoiceNumber: string): string {
  return `Invoice - ${sanitizeInvoiceFilenamePart(patientName)} - ${sanitizeInvoiceFilenamePart(invoiceNumber)}`;
}

export function createInvoiceFilename(patientName: string, invoiceNumber: string): string {
  return `${createInvoiceDocumentTitle(patientName, invoiceNumber)}.pdf`;
}

export function createInvoiceContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
