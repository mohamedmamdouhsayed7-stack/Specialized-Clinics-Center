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

describe('invoice print/PDF template', () => {
  it.each([
    ['en', 'Invoice - Sara Ahmed - INV-1788803016897'],
    ['ar', 'Invoice - سارة أحمد - INV-1788803016897'],
  ] as const)('sets a patient-identifying document title and keeps both compact copies for %s', (language, title) => {
    const html = renderInvoiceHtml(invoice, language);

    expect(html).toContain(`<title>${title}</title>`);
    expect(html.match(/class="invoice-copy"/g)).toHaveLength(2);
    expect(html).toContain('.invoice-copy {\n    flex: 0 0 auto;');
    expect(html).toContain('.copy {\n    flex: 0 0 auto;');
    expect(html).toContain('height: 297mm;');
  });

  it('defaults to two copies when options are not provided', () => {
    const html = renderInvoiceHtml(invoice, 'en');
    expect(html.match(/class="invoice-copy"/g)).toHaveLength(2);
    expect(html).toContain('cut-line');
  });

  it('renders exactly two copies for internal print/download mode', () => {
    const html = renderInvoiceHtml(invoice, 'en', { copies: 2 });
    expect(html.match(/class="invoice-copy"/g)).toHaveLength(2);
    expect(html).toContain('cut-line');
    expect(html).toContain('height: 297mm;');
  });

  it('renders exactly one copy for customer share mode with the same invoice information', () => {
    const htmlOne = renderInvoiceHtml(invoice, 'en', { copies: 1 });
    const htmlTwo = renderInvoiceHtml(invoice, 'en', { copies: 2 });

    const oneCopyCount = (htmlOne.match(/<div class="invoice-copy">/g) || []).length;
    const twoCopyCount = (htmlTwo.match(/<div class="invoice-copy">/g) || []).length;
    expect(oneCopyCount).toBe(1);
    expect(twoCopyCount).toBe(2);

    const oneCutLines = (htmlOne.match(/<div class="cut-line"><\/div>/g) || []).length;
    const twoCutLines = (htmlTwo.match(/<div class="cut-line"><\/div>/g) || []).length;
    expect(oneCutLines).toBe(0);
    expect(twoCutLines).toBe(1);

    const invoiceCopyRegex = /<div class="invoice-copy">([\s\S]*?)<\/div>\s*(?:<div class="cut-line"><\/div>\s*)?/g;
    const twoMatches = [...htmlTwo.matchAll(invoiceCopyRegex)];
    expect(twoMatches).toHaveLength(2);
    expect(twoMatches[0][1].trim()).toBe(twoMatches[1][1].trim());

    const oneMatch = [...htmlOne.matchAll(invoiceCopyRegex)];
    expect(oneMatch).toHaveLength(1);
    expect(oneMatch[0][1].trim()).toBe(twoMatches[0][1].trim());

    expect(htmlOne).toContain(invoice.invoiceNumber);
    expect(htmlOne).toContain(invoice.patient.fullNameAr);
    expect(htmlOne).toContain(invoice.patient.fullNameEn as string);
    expect(htmlOne).toContain('Consultation');
    expect(htmlOne).toContain(`<title>Invoice - Sara Ahmed - INV-1788803016897</title>`);
    expect(htmlOne).toContain('height: 297mm;');
  });

  it('renders two non-overlapping copies with a reduced gap on the A4 sheet', async () => {
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
        const second = copies[1].getBoundingClientRect();
        const copyContentsFit = copies.every((copy) => copy.scrollHeight <= copy.clientHeight + 1);
        return {
          count: copies.length,
          gap: second.top - first.bottom,
          secondFitsOnSheet: second.bottom <= sheet.bottom,
          copyContentsFit,
        };
      });

      expect(layout.count).toBe(2);
      expect(layout.gap).toBeGreaterThan(0);
      expect(layout.gap).toBeLessThan(70);
      expect(layout.secondFitsOnSheet).toBe(true);
      expect(layout.copyContentsFit).toBe(true);
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it('does not truncate long patient names in either copy', async () => {
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
          const patientValue = copy.querySelector('.p-value.ar') as HTMLElement;
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

      expect(patientNameTruncation).toHaveLength(2);
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
        const patientValue = copies[0].querySelector('.p-value.ar') as HTMLElement;
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
});
