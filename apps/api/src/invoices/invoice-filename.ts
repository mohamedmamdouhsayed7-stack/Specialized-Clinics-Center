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

export function parseContentDispositionFilename(contentDisposition: string | null | undefined): string | null {
  if (!contentDisposition) return null;

  const rfc5987Match = contentDisposition.match(/filename\*\s*=\s*([^';]+)'(?:[^']*)'([^;]+)/i);
  if (rfc5987Match) {
    const charset = rfc5987Match[1].trim().toUpperCase();
    const encoded = rfc5987Match[2].trim();
    if (charset === 'UTF-8' || charset === 'UTF8') {
      try {
        return decodeURIComponent(encoded);
      } catch (e) {
        void e;
      }
    }
  }

  const quotedMatch = contentDisposition.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
  if (quotedMatch) {
    return quotedMatch[1].replace(/\\(.)/g, '$1');
  }

  const unquotedMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (unquotedMatch) {
    return unquotedMatch[1].trim();
  }

  return null;
}

function containsIllegalFilenameCharacters(value: string): boolean {
  const symbols = '<>:"/\\|?*';
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n <= 0x1f) return true;
    if (symbols.indexOf(value.charAt(i)) >= 0) return true;
  }
  return false;
}

export function isSafeInvoiceFilename(filename: unknown, invoiceNumber?: string): filename is string {
  if (typeof filename !== 'string') return false;
  if (!filename.endsWith('.pdf')) return false;
  if (!filename.startsWith('Invoice - ')) return false;
  if (invoiceNumber && !filename.includes(invoiceNumber)) return false;
  if (containsIllegalFilenameCharacters(filename)) return false;
  if (/\.\./.test(filename.split(/[\\/]/).pop() || '')) return false;
  return true;
}

export function containsMojibakeIndicators(value: string): boolean {
  return /[ØÙÂÃ]/.test(value);
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
