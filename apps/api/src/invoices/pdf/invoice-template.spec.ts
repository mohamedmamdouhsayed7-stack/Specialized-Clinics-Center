import { renderInvoiceHtml, InvoicePdfData, InvoiceLocale } from './invoice-template';

describe('Invoice Template', () => {
  const mockInvoice: InvoicePdfData = {
    invoiceNumber: 'INV-000001',
    status: 'ISSUED',
    subtotal: 45.00,
    total: 45.00,
    paid: 45.00,
    remaining: 0.00,
    paymentStatus: 'PAID',
    issuedAt: '2024-09-11',
    createdAt: '2024-09-11',
    patient: {
      fullNameAr: 'فاطمة محمد العلي',
      civilId: '295010123456',
      phone: '+965 60008977',
    },
    visit: {
      type: 'CHECKUP',
      diagnosis: 'فحص دوري',
    },
    invoiceItems: [
      {
        serviceNameSnapshot: 'استشارة طبية',
        unitPriceSnapshot: 45.00,
        quantity: 1,
        lineTotal: 45.00,
        service: { code: 'CONS-001' },
      },
    ],
    additionalCharges: [],
    payments: [
      {
        amount: 45.00,
        method: 'CASH',
        paymentDate: '2024-09-11',
        status: 'RECORDED',
      },
    ],
  };

  const legacyInvoice: InvoicePdfData = {
    ...mockInvoice,
    invoiceNumber: 'INV-000002',
    patient: {
      fullNameAr: 'سارة أحمد',
      civilId: null,
      phone: '+965 91234567',
    },
  };

  describe('renderInvoiceHtml', () => {
    it('should render Arabic invoice HTML', () => {
      const html = renderInvoiceHtml(mockInvoice, 'ar');

      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="ar"');
      expect(html).toContain('فاتورة');
      expect(html).toContain('رقم الفاتورة');
      expect(html).toContain('فاطمة محمد العلي');
      expect(html).toContain('295010123456');
      expect(html).toContain('استشارة طبية');
      expect(html).toContain('INV-000001');
    });

    it('should render English invoice HTML', () => {
      const html = renderInvoiceHtml(mockInvoice, 'en');

      expect(html).toContain('dir="ltr"');
      expect(html).toContain('lang="en"');
      expect(html).toContain('INVOICE');
      expect(html).toContain('Invoice No.');
      expect(html).toContain('فاطمة محمد العلي');
      expect(html).toContain('295010123456');
      expect(html).toContain('استشارة طبية');
      expect(html).toContain('INV-000001');
    });

    it('should handle nullable Civil ID correctly in Arabic', () => {
      const html = renderInvoiceHtml(legacyInvoice, 'ar');

      expect(html).toContain('سارة أحمد');
      expect(html).toContain('—'); // Dash for null Civil ID
      expect(html).not.toContain('null');
    });

    it('should handle nullable Civil ID correctly in English', () => {
      const html = renderInvoiceHtml(legacyInvoice, 'en');

      expect(html).toContain('سارة أحمد');
      expect(html).toContain('—'); // Dash for null Civil ID
      expect(html).not.toContain('null');
    });

    it('should include clinic identity bilingually regardless of locale', () => {
      const arHtml = renderInvoiceHtml(mockInvoice, 'ar');
      const enHtml = renderInvoiceHtml(mockInvoice, 'en');

      // Both should contain Arabic and English clinic names
      expect(arHtml).toContain('مركز العيادات التخصصية');
      expect(arHtml).toContain('Specialized Clinics Center');
      expect(enHtml).toContain('مركز العيادات التخصصية');
      expect(enHtml).toContain('Specialized Clinics Center');

      // Both should contain doctor names in both languages
      expect(arHtml).toContain('د. نداء بوخضور');
      expect(arHtml).toContain('Dr. Nada Bokhdour');
      expect(enHtml).toContain('د. نداء بوخضور');
      expect(enHtml).toContain('Dr. Nada Bokhdour');
    });

    it('should render additional charges when present', () => {
      const invoiceWithCharges: InvoicePdfData = {
        ...mockInvoice,
        total: 55.00,
        additionalCharges: [
          {
            chargeType: 'FIXED',
            chargeValue: 10.00,
            calculatedAmount: 10.00,
            description: 'رسوم إضافية',
          },
        ],
      };

      const html = renderInvoiceHtml(invoiceWithCharges, 'ar');

      expect(html).toContain('رسوم إضافية');
      expect(html).toContain('10.00');
    });

    it('should render VOID watermark for voided invoices', () => {
      const voidInvoice: InvoicePdfData = {
        ...mockInvoice,
        status: 'VOID',
      };

      const html = renderInvoiceHtml(voidInvoice, 'ar');

      expect(html).toContain('VOID');
      expect(html).toContain('watermark');
    });

    it('should render replacement note for replaced invoices', () => {
      const replacedInvoice: InvoicePdfData = {
        ...mockInvoice,
        replacedByInvoiceId: 'new-invoice-id',
      };

      const html = renderInvoiceHtml(replacedInvoice, 'ar');

      expect(html).toContain('تم استبدال هذه الفاتورة');
    });

    it('should escape HTML in patient name to prevent XSS', () => {
      const xssInvoice: InvoicePdfData = {
        ...mockInvoice,
        patient: {
          fullNameAr: '<script>alert("xss")</script>',
          civilId: '123456',
          phone: '123456',
        },
      };

      const html = renderInvoiceHtml(xssInvoice, 'ar');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should format money values correctly', () => {
      const html = renderInvoiceHtml(mockInvoice, 'ar');

      expect(html).toContain('45.00');
    });

    it('should format dates correctly', () => {
      const html = renderInvoiceHtml(mockInvoice, 'ar');

      expect(html).toContain('11/09/2024');
    });
  });
});
