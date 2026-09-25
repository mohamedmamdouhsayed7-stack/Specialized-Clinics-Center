function sanitizeInvoiceFilenamePart(value: string): string {
  return Array.from(
    value.normalize('NFC')
      .replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  ).slice(0, 96).join('').replace(/^[. ]+|[. ]+$/gu, '') || 'Unknown';
}

export function invoicePatientDisplayName(
  patient: { fullNameAr: string; fullNameEn?: string | null } | undefined,
  language: 'ar' | 'en',
): string {
  if (!patient) return 'Unknown';
  return language === 'ar'
    ? patient.fullNameAr || patient.fullNameEn || 'Unknown'
    : patient.fullNameEn || patient.fullNameAr || 'Unknown';
}

export function createInvoiceDocumentTitle(patientName: string, invoiceNumber: string): string {
  return `Invoice - ${sanitizeInvoiceFilenamePart(patientName)} - ${sanitizeInvoiceFilenamePart(invoiceNumber)}`;
}

export function createInvoiceFilename(patientName: string, invoiceNumber: string): string {
  return `${createInvoiceDocumentTitle(patientName, invoiceNumber)}.pdf`;
}
