import {
  createInvoiceContentDisposition,
  createInvoiceDocumentTitle,
  createInvoiceFilename,
  invoicePatientDisplayName,
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
});
