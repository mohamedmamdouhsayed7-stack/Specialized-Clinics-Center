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

function stripToAscii(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
}

export function createAsciiSharePatientName(patient: {
  fullNameAr: string;
  fullNameEn?: string | null;
  civilId?: string | null;
} | null | undefined): string {
  if (!patient) return 'Patient';

  if (patient.fullNameEn) {
    const asciiEn = stripToAscii(patient.fullNameEn);
    if (asciiEn) return asciiEn;
  }

  const asciiAr = stripToAscii(patient.fullNameAr || '');
  if (asciiAr) return asciiAr;

  if (patient.civilId) {
    const asciiId = stripToAscii(patient.civilId);
    if (asciiId) return `Patient-${asciiId.slice(-6)}`;
  }

  return 'Patient';
}

export function createShareInvoiceFilename(
  patient: { fullNameAr: string; fullNameEn?: string | null; civilId?: string | null },
  invoiceNumber: string,
): string {
  const asciiPatientName = createAsciiSharePatientName(patient);
  return createInvoiceFilename(asciiPatientName, invoiceNumber);
}

export function filenameIsAsciiOnly(filename: string): boolean {
  return /^[\x20-\x7e]+$/.test(filename);
}
