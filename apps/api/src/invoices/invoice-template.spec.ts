import { renderInvoiceHtml, InvoicePdfData } from './pdf/invoice-template';
import puppeteer from 'puppeteer';

const invoice: InvoicePdfData = {
  invoiceNumber: 'INV-1788803016897',
  status: 'ISSUED',
  subtotal: 10,
  total: 10,
  paid: 10,
  remaining: 0,
  paymentStatus: 'PAID',
  issuedAt: '2026-09-25T10:00:00.000Z',
  createdAt: '2026-09-25T10:00:00.000Z',
  patient: { fullNameAr: 'سارة أحمد', fullNameEn: 'Sara Ahmed', civilId: null },
  invoiceItems: [{ serviceNameSnapshot: 'Consultation', unitPriceSnapshot: 10, quantity: 1, lineTotal: 10 }],
  payments: [],
};

const longNameInvoice: InvoicePdfData = {
  ...invoice,
  patient: {
    fullNameAr: 'QA Wolf Targeted 20260925-094420',
    fullNameEn: 'QA Wolf Targeted 20260925-094420',
    civilId: null,
  },
};

const exceptionalContentInvoice: InvoicePdfData = {
  ...invoice,
  invoiceNumber: 'INV-LONG-CONTENT-2032',
  patient: {
    fullNameAr: 'المريضة ذات الاسم العربي الطويل جدًا لاختبار التفاف النص في الفاتورة دون قص أو تداخل في جميع الحقول',
    fullNameEn: 'A Patient With An Exceptionally Long English Name For Invoice Wrapping And Readability Verification',
    civilId: null,
  },
  invoiceItems: Array.from({ length: 8 }, (_, index) => ({
    serviceNameSnapshot: index % 2 === 0
      ? `خدمة طبية عربية طويلة لاختبار التفاف النص رقم ${index + 1} دون فقدان تفاصيل الخدمة أو المبلغ المستحق`
      : `Extended English consultation service description ${index + 1} wrapping across multiple readable lines`,
    unitPriceSnapshot: 10,
    quantity: 1,
    lineTotal: 10,
  })),
  subtotal: 80,
  total: 83,
  paid: 25,
  remaining: 58,
  paymentStatus: 'PARTIALLY_PAID',
  additionalCharges: [{ chargeType: 'FIXED', chargeValue: 3, calculatedAmount: 3, description: 'Additional charge' }],
  payments: [{ amount: 25, method: 'KNET', paymentDate: '2032-05-20T07:30:00.000Z' }],
};

describe('invoice print/PDF template', () => {
  it.each([
    ['en', 'Invoice - Sara Ahmed - INV-1788803016897'],
    ['ar', 'Invoice - سارة أحمد - INV-1788803016897'],
  ] as const)('sets a patient-identifying document title and renders one copy for %s', (language, title) => {
    const html = renderInvoiceHtml(invoice, language);

    expect(html).toContain(`<title>${title}</title>`);
    expect(html.match(/class="invoice-copy"/g)).toHaveLength(1);
    expect(html).not.toContain('<div class="cut-line">');
    expect(html).toContain('.invoice-copy {\n    flex: 0 0 auto;');
    expect(html).toContain('.copy {\n    flex: 0 0 auto;');
    expect(html).toContain('min-height: 297mm;');
  });

  it('defaults to one copy when options are not provided', () => {
    const html = renderInvoiceHtml(invoice, 'en');
    expect(html.match(/class="invoice-copy"/g)).toHaveLength(1);
    expect(html).not.toContain('<div class="cut-line">');
  });

  it.each([
    ['en', 'Remaining', '58.00 KD'],
    ['ar', 'المتبقي', '58.00 KD'],
  ] as const)('shows the outstanding balance in the existing payment summary for %s', (language, label, value) => {
    const html = renderInvoiceHtml({ ...invoice, total: 83, paid: 25, remaining: 58 }, language);

    expect(html).toContain(`<span class="pay-label">${label}</span>`);
    expect(html).toContain(`<span class="pay-value">${value}</span>`);
    expect(html).toContain('size: A4;');
    expect(html).toContain('min-height: 148.5mm;');
  });

  it('formats the invoice business date in Asia/Kuwait at a UTC midnight boundary', () => {
    const html = renderInvoiceHtml({
      ...invoice,
      issuedAt: '2026-09-25T21:00:00.000Z',
    }, 'en', { copies: 1 });

    expect(html).toContain('Date:</b> 26/09/2026');
  });

  it('labels telephone consultations in the invoice PDF and preserves long multi-item content', () => {
    const telephone = renderInvoiceHtml({
      ...invoice,
      visit: { type: 'TELEPHONE_CONSULTATION' },
      patient: { fullNameAr: 'اسم عربي طويل جدًا للمريضة لاختبار عدم قص النص في الفاتورة', fullNameEn: 'A very long English patient name for invoice layout validation', civilId: null },
      invoiceItems: Array.from({ length: 8 }, (_, index) => ({
        serviceNameSnapshot: `خدمة استشارة هاتفية طويلة رقم ${index + 1} with an extended service name to verify wrapping`,
        unitPriceSnapshot: 10, quantity: 1, lineTotal: 10,
      })),
      additionalCharges: [{ chargeType: 'FIXED', chargeValue: 2, calculatedAmount: 2, description: 'Additional fee' }],
      payments: [{ amount: 5, method: 'KNET', paymentDate: '2026-09-25T07:30:00.000Z' }],
    }, 'en', { copies: 2 });
    expect(telephone.match(/class="invoice-copy"/g)).toHaveLength(1);
    expect(telephone).toContain('Telephone consultation');
    expect(telephone).not.toContain('class="col-qty"');
    expect(telephone).not.toContain('QTY');
    expect(telephone).not.toContain('>1</td>');
    expect(telephone).toContain('خدمة استشارة هاتفية طويلة رقم 8');
    expect(telephone).toContain('Additional fee');
    expect(telephone).toContain('min-height: 148.5mm;');
    expect(telephone).not.toContain('overflow: hidden;');
  });

  it('renders exactly one copy for internal print/download mode', () => {
    const html = renderInvoiceHtml(invoice, 'en', { copies: 1 });
    expect(html.match(/class="invoice-copy"/g)).toHaveLength(1);
    expect(html).not.toContain('<div class="cut-line">');
    expect(html).toContain('min-height: 297mm;');
  });

  it('renders exactly one copy in customer share mode and ignores legacy two-copy requests', () => {
    const htmlOne = renderInvoiceHtml(invoice, 'en', { copies: 1 });
    const htmlTwo = renderInvoiceHtml(invoice, 'en', { copies: 2 });

    const oneCopyCount = (htmlOne.match(/<div class="invoice-copy">/g) || []).length;
    const twoCopyCount = (htmlTwo.match(/<div class="invoice-copy">/g) || []).length;
    expect(oneCopyCount).toBe(1);
    expect(twoCopyCount).toBe(1);

    const oneCutLines = (htmlOne.match(/<div class="cut-line"><\/div>/g) || []).length;
    const twoCutLines = (htmlTwo.match(/<div class="cut-line"><\/div>/g) || []).length;
    expect(oneCutLines).toBe(0);
    expect(twoCutLines).toBe(0);

    const invoiceCopyRegex = /<div class="invoice-copy">([\s\S]*?)<\/div>\s*(?:<div class="cut-line"><\/div>\s*)?/g;
    const twoMatches = [...htmlTwo.matchAll(invoiceCopyRegex)];
    expect(twoMatches).toHaveLength(1);

    const oneMatch = [...htmlOne.matchAll(invoiceCopyRegex)];
    expect(oneMatch).toHaveLength(1);
    expect(oneMatch[0][1].trim()).toBe(twoMatches[0][1].trim());

    expect(htmlOne).toContain(invoice.invoiceNumber);
    expect(htmlOne).toContain(invoice.patient?.fullNameEn as string);
    expect(htmlOne).not.toContain(invoice.patient?.fullNameAr);
    const htmlArabic = renderInvoiceHtml(invoice, 'ar', { copies: 1 });
    expect(htmlArabic).toContain(invoice.patient?.fullNameAr);
    expect(htmlOne).toContain('Consultation');
    expect(htmlOne).toContain(`<title>Invoice - Sara Ahmed - INV-1788803016897</title>`);
    expect(htmlOne).toContain('min-height: 297mm;');
  });

  it('renders one non-clipped copy on the A4 sheet', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123 });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
        else void request.abort();
      });
      await page.setContent(renderInvoiceHtml(invoice, 'en'), { waitUntil: 'domcontentloaded' });
      await page.emulateMediaType('print');

      const layout = await page.evaluate(() => {
        const sheet = document.querySelector('.sheet')!.getBoundingClientRect();
        const copies = Array.from(document.querySelectorAll('.invoice-copy'));
        const first = copies[0].getBoundingClientRect();
        const summary = copies[0].querySelector('.pay-row')!.getBoundingClientRect();
        const innerCopy = copies[0].querySelector('.copy')!.getBoundingClientRect();
        const upperHalfPlacement = first.bottom <= sheet.top + sheet.height / 2 + 2;
        const copyContentsFit = copies.every((copy) => copy.scrollHeight <= copy.clientHeight + 1);
        return {
          count: copies.length,
          copyFitsOnSheet: first.bottom <= sheet.bottom,
          copyContentsFit,
          upperHalfPlacement,
          summaryUsesLowerContentArea: summary.top >= innerCopy.top + innerCopy.height * 0.55,
        };
      });

      expect(layout.count).toBe(1);
      expect(layout.copyFitsOnSheet).toBe(true);
      expect(layout.copyContentsFit).toBe(true);
      expect(layout.upperHalfPlacement).toBe(true);
      expect(layout.summaryUsesLowerContentArea).toBe(true);
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      expect((Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it.each(['ar', 'en'] as const)('renders manual telephone patient and service snapshots in %s', (language) => {
    const html = renderInvoiceHtml({
      ...invoice,
      patient: null,
      patientNameSnapshot: 'مريض هاتفي يدوي / Manual Telephone Patient',
      isTelephoneConsultation: true,
      visit: null,
      invoiceItems: [{ serviceNameSnapshot: 'استشارة هاتفية يدوية / Manual telephone consultation', unitPriceSnapshot: 18.5, quantity: 1, lineTotal: 18.5 }],
      subtotal: 18.5,
      total: 18.5,
      paid: 0,
      remaining: 18.5,
      paymentStatus: 'UNPAID',
    }, language);
    expect(html).toContain('مريض هاتفي يدوي / Manual Telephone Patient');
    expect(html).toContain('استشارة هاتفية يدوية / Manual telephone consultation');
    expect(html).toContain('18.50 KD');
    expect(html).not.toContain('class="col-qty"');
    expect(html).not.toContain(language === 'ar' ? 'الكمية' : 'QTY');
    expect(html).not.toContain('>1</td>');
    expect(html).toContain(language === 'ar' ? 'استشارة هاتفية' : 'Telephone consultation');
  });

  it('does not truncate long patient names in the internal copy', async () => {
    const expectedPatientName = 'QA Wolf Targeted 20260925-094420';
    const expectedTextLength = expectedPatientName.length;
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123 });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
        else void request.abort();
      });
      await page.setContent(renderInvoiceHtml(longNameInvoice, 'en'), { waitUntil: 'domcontentloaded' });
      await page.emulateMediaType('print');

      const patientNameTruncation = await page.evaluate(() => {
        const copies = Array.from(document.querySelectorAll('.invoice-copy'));
        const results = copies.map((copy) => {
          const patientValue = copy.querySelector('.p-value.en') as HTMLElement;
          const computedStyle = window.getComputedStyle(patientValue);
          const isEllipsisTruncation = computedStyle.textOverflow === 'ellipsis' && computedStyle.whiteSpace === 'nowrap';
          const scrollWidth = patientValue.scrollWidth;
          const clientWidth = patientValue.clientWidth;
          const isHorizontallyClipped = scrollWidth > clientWidth + 2;
          const text = patientValue.textContent || '';
          return {
            isEllipsisTruncation,
            isHorizontallyClipped,
            scrollWidth,
            clientWidth,
            text,
            textLength: text.length,
            textOverflow: computedStyle.textOverflow,
            whiteSpace: computedStyle.whiteSpace,
          };
        });
        return results;
      });

      expect(patientNameTruncation).toHaveLength(1);
      patientNameTruncation.forEach((result) => {
        expect(result.text).toBe(expectedPatientName);
        expect(result.textLength).toBe(expectedTextLength);
        expect(result.isEllipsisTruncation).toBe(false);
        expect(result.isHorizontallyClipped).toBe(false);
        expect(result.textOverflow).not.toBe('ellipsis');
        expect(result.whiteSpace).not.toBe('nowrap');
      });
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it('renders a single non-clipped invoice copy for customer share mode with the same invoice content', async () => {
    const expectedPatientName = 'QA Wolf Targeted 20260925-094420';
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123 });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
        else void request.abort();
      });
      await page.setContent(renderInvoiceHtml(longNameInvoice, 'en', { copies: 1 }), { waitUntil: 'domcontentloaded' });
      await page.emulateMediaType('print');

      const layout = await page.evaluate(() => {
        const sheet = document.querySelector('.sheet')!.getBoundingClientRect();
        const copies = Array.from(document.querySelectorAll('.invoice-copy'));
        const copyFits = copies.length === 1 && copies[0].getBoundingClientRect().bottom <= sheet.bottom;
        const copyContentsFit = copies.every((copy) => copy.scrollHeight <= copy.clientHeight + 1);
        const patientValue = copies[0].querySelector('.p-value.en') as HTMLElement;
        const computedStyle = window.getComputedStyle(patientValue);
        const isEllipsisTruncation = computedStyle.textOverflow === 'ellipsis' && computedStyle.whiteSpace === 'nowrap';
        const isHorizontallyClipped = patientValue.scrollWidth > patientValue.clientWidth + 2;
        const hasCutLine = Boolean(document.querySelector('.cut-line'));
        return {
          count: copies.length,
          copyFits,
          copyContentsFit,
          isEllipsisTruncation,
          isHorizontallyClipped,
          patientText: patientValue.textContent || '',
          hasCutLine,
        };
      });

      expect(layout.count).toBe(1);
      expect(layout.hasCutLine).toBe(false);
      expect(layout.copyFits).toBe(true);
      expect(layout.copyContentsFit).toBe(true);
      expect(layout.isEllipsisTruncation).toBe(false);
      expect(layout.isHorizontallyClipped).toBe(false);
      expect(layout.patientText).toBe(expectedPatientName);
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it.each([
    ['ar', exceptionalContentInvoice.patient.fullNameAr],
    ['en', exceptionalContentInvoice.patient.fullNameEn as string],
  ] as const)('renders long %s invoice content as one readable A4 page in the upper half', async (language, expectedPatientName) => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 794, height: 1123 });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue();
        else void request.abort();
      });
      await page.setContent(renderInvoiceHtml(exceptionalContentInvoice, language, { copies: 1 }), { waitUntil: 'domcontentloaded' });
      await page.emulateMediaType('print');
      await page.waitForFunction(() => (document.querySelector('.logo') as HTMLImageElement).complete);

      const layout = await page.evaluate((locale) => {
        const sheet = document.querySelector('.sheet') as HTMLElement;
        const copies = Array.from(document.querySelectorAll('.invoice-copy')) as HTMLElement[];
        const invoiceCopy = copies[0];
        const copy = invoiceCopy.querySelector('.copy') as HTMLElement;
        const patientName = copy.querySelector('.p-value') as HTMLElement;
        const serviceCells = Array.from(copy.querySelectorAll('tbody tr:not(.charge-row) .col-service')) as HTMLElement[];
        const logo = copy.querySelector('.logo') as HTMLImageElement;
        const sheetBounds = sheet.getBoundingClientRect();
        const invoiceBounds = invoiceCopy.getBoundingClientRect();
        return {
          copyCount: copies.length,
          sheetWidth: sheetBounds.width,
          sheetHeight: sheetBounds.height,
          pageWidth: document.documentElement.scrollWidth,
          invoiceBottom: invoiceBounds.bottom,
          upperHalfBottom: sheetBounds.top + sheetBounds.height / 2 + 2,
          copyScrollWidth: copy.scrollWidth,
          copyClientWidth: copy.clientWidth,
          copyScrollHeight: copy.scrollHeight,
          copyClientHeight: copy.clientHeight,
          patientName: patientName.textContent,
          expectedDirectionClass: patientName.classList.contains(locale === 'ar' ? 'ar' : 'en'),
          patientClipped: patientName.scrollWidth > patientName.clientWidth + 1,
          serviceCellCount: serviceCells.length,
          serviceClipped: serviceCells.some((cell) => cell.scrollWidth > cell.clientWidth + 1),
          serviceLineCounts: serviceCells.map((cell) => {
            const range = document.createRange();
            range.selectNodeContents(cell);
            return range.getClientRects().length;
          }),
          logoLoaded: logo.complete && logo.naturalWidth > 0,
          clinicNameAr: copy.querySelector('.clinic-name-ar')?.textContent?.trim(),
          clinicNameEn: copy.querySelector('.clinic-name-en')?.textContent?.trim(),
        };
      }, language);

      expect(layout.copyCount).toBe(1);
      expect(layout.sheetWidth).toBeGreaterThan(780);
      expect(layout.sheetHeight).toBeGreaterThan(1100);
      expect(layout.pageWidth).toBeLessThanOrEqual(layout.sheetWidth + 2);
      expect(layout.invoiceBottom).toBeLessThanOrEqual(layout.upperHalfBottom);
      expect(layout.copyScrollWidth).toBeLessThanOrEqual(layout.copyClientWidth + 1);
      expect(layout.copyScrollHeight).toBeLessThanOrEqual(layout.copyClientHeight + 2);
      expect(layout.patientName).toBe(expectedPatientName);
      expect(layout.expectedDirectionClass).toBe(true);
      expect(layout.patientClipped).toBe(false);
      expect(layout.serviceCellCount).toBe(8);
      expect(layout.serviceClipped).toBe(false);
      expect(layout.serviceLineCounts.some((lineCount) => lineCount > 1)).toBe(true);
      expect(layout.logoLoaded).toBe(true);
      expect(layout.clinicNameAr).toBe('مركز العيادات التخصصية');
      expect(layout.clinicNameEn).toBe('Specialized Clinics Center');

      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      expect((Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
      await page.close();
    } finally {
      await browser.close();
    }
  });
});
