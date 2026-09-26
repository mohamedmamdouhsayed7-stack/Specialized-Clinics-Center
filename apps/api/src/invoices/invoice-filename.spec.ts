import {
  containsMojibakeIndicators,
  createInvoiceContentDisposition,
  createInvoiceDocumentTitle,
  createInvoiceFilename,
  invoicePatientDisplayName,
  isSafeInvoiceFilename,
  parseContentDispositionFilename,
} from './invoice-filename';

describe('invoice filenames', () => {
  it('includes readable English patient and invoice names', () => {
    expect(createInvoiceFilename('Ahmed Ali', 'INV-1788803016897'))
      .toBe('Invoice - Ahmed Ali - INV-1788803016897.pdf');
  });

  it('preserves readable Arabic names in UTF-8 filenames and headers', () => {
    const filename = createInvoiceFilename('سارة أحمد', 'INV-1788803016897');
    expect(filename).toBe('Invoice - سارة أحمد - INV-1788803016897.pdf');
    expect(createInvoiceContentDisposition(filename)).toContain("filename*=UTF-8''Invoice%20-%20%D8%B3%D8%A7%D8%B1%D8%A9%20%D8%A3%D8%AD%D9%85%D8%AF");
  });

  it('removes path separators, control/bidi characters, and illegal filesystem punctuation', () => {
    const filename = createInvoiceFilename('../Ahmed/\u202eAli:*?', 'INV/../../42');
    expect(filename).toBe('Invoice - Ahmed Ali - INV .. .. 42.pdf');
    expect(filename).not.toMatch(/[\\/:*?<>|\u202e]/u);
  });

  it('uses the same safe readable title as the filename without the extension', () => {
    expect(createInvoiceDocumentTitle('سارة أحمد', 'INV-123'))
      .toBe('Invoice - سارة أحمد - INV-123');
  });

  it('selects the localized patient name when available and safely falls back', () => {
    const patient = { fullNameAr: 'سارة أحمد', fullNameEn: 'Sara Ahmed' };
    expect(invoicePatientDisplayName(patient, 'en')).toBe('Sara Ahmed');
    expect(invoicePatientDisplayName(patient, 'ar')).toBe('سارة أحمد');
    expect(invoicePatientDisplayName({ fullNameAr: 'مريم' }, 'en')).toBe('مريم');
  });

  describe('Content-Disposition parsing (customer-share WhatsApp safe filenames)', () => {
    it('decodes Arabic patient names from filename*= RFC 5987 UTF-8 without mojibake', () => {
      const original = createInvoiceFilename('محمد ممدوح', 'INV-1788803016897');
      const header = createInvoiceContentDisposition(original);
      const parsed = parseContentDispositionFilename(header);

      expect(parsed).toBe('Invoice - محمد ممدوح - INV-1788803016897.pdf');
      expect(parsed).toContain('محمد ممدوح');
      expect(containsMojibakeIndicators(parsed!)).toBe(false);
    });

    it('decodes سارة أحمد Arabic names correctly and preserves invoice number + .pdf', () => {
      const invNum = 'INV-1788803016897';
      const original = createInvoiceFilename('سارة أحمد', invNum);
      const header = createInvoiceContentDisposition(original);
      const parsed = parseContentDispositionFilename(header);

      expect(parsed).toBe(original);
      expect(parsed).toContain(invNum);
      expect(parsed?.endsWith('.pdf')).toBe(true);
      expect(containsMojibakeIndicators(parsed!)).toBe(false);
    });

    it('preserves English patient names from quoted filename= without corruption', () => {
      const invNum = 'INV-1788803016897';
      const original = createInvoiceFilename('Ahmed Ali', invNum);
      const header = createInvoiceContentDisposition(original);
      const parsed = parseContentDispositionFilename(header);

      expect(parsed).toBe('Invoice - Ahmed Ali - INV-1788803016897.pdf');
      expect(parsed).toContain(invNum);
      expect(parsed?.endsWith('.pdf')).toBe(true);
      expect(containsMojibakeIndicators(parsed!)).toBe(false);
    });

    it('prefers filename*= UTF-8 over ASCII underscore-only filename= fallback for Arabic', () => {
      const original = createInvoiceFilename('سارة أحمد', 'INV-TEST');
      const header = createInvoiceContentDisposition(original);

      const asciiMatch = header.match(/filename="([^"]+)"/);
      expect(asciiMatch).not.toBeNull();
      expect(asciiMatch![1]).not.toContain('سارة أحمد');
      expect(asciiMatch![1]).toContain('_');

      const parsed = parseContentDispositionFilename(header);

      expect(parsed).toBe(original);
      expect(parsed).toContain('سارة أحمد');
    });

    it('falls back to quoted filename= when filename*= is missing', () => {
      const header = 'attachment; filename="Invoice - Sara Ahmed - INV-001.pdf"';
      const parsed = parseContentDispositionFilename(header);
      expect(parsed).toBe('Invoice - Sara Ahmed - INV-001.pdf');
    });

    it('returns null for null / empty / unparseable Content-Disposition', () => {
      expect(parseContentDispositionFilename(null)).toBeNull();
      expect(parseContentDispositionFilename(undefined)).toBeNull();
      expect(parseContentDispositionFilename('')).toBeNull();
      expect(parseContentDispositionFilename('attachment')).toBeNull();
    });

    it('does NOT produce Ø Ù Â Ã mojibake even if naive per-byte decoding would', () => {
      const original = createInvoiceFilename('محمد ممدوح', 'INV-X');
      const header = createInvoiceContentDisposition(original);
      const rfc5987Match = header.match(/filename\*\s*=\s*[^']*''([^;]+)/i)!;
      const encoded = rfc5987Match[1];

      const naiveLatin1Decode = encoded.replace(
        /%([0-9A-Fa-f]{2})/g,
        (_, hex) => String.fromCharCode(parseInt(hex, 16)),
      );
      expect(containsMojibakeIndicators(naiveLatin1Decode)).toBe(true);

      const correctDecoded = parseContentDispositionFilename(header)!;
      expect(containsMojibakeIndicators(correctDecoded)).toBe(false);
      expect(correctDecoded).toBe(original);
    });

    it('validates isSafeInvoiceFilename for Arabic + English share filenames', () => {
      const arabic = createInvoiceFilename('سارة أحمد', 'INV-999');
      const english = createInvoiceFilename('Ahmed Ali', 'INV-999');

      expect(isSafeInvoiceFilename(arabic, 'INV-999')).toBe(true);
      expect(isSafeInvoiceFilename(english, 'INV-999')).toBe(true);
      expect(isSafeInvoiceFilename(arabic)).toBe(true);
      expect(isSafeInvoiceFilename('Invoice - Bad - INV-999.exe', 'INV-999')).toBe(false);
      expect(isSafeInvoiceFilename('Bad - INV-999.pdf', 'INV-999')).toBe(false);
      expect(isSafeInvoiceFilename('Invoice - Bad - INV-OTHER.pdf', 'INV-999')).toBe(false);
      expect(isSafeInvoiceFilename('Invoice - ../../../etc - INV-BAD.pdf', 'INV-BAD')).toBe(false);
      expect(isSafeInvoiceFilename('Invoice - A<B - INV-BAD.pdf', 'INV-BAD')).toBe(false);
    });
  });
});
