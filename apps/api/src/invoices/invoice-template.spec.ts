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
          const patientValue = copy.querySelector('.p-value') as HTMLElement;
          const computedStyle = window.getComputedStyle(patientValue);
          const isTruncated = computedStyle.textOverflow === 'ellipsis' && computedStyle.whiteSpace === 'nowrap';
          const scrollWidth = patientValue.scrollWidth;
          const clientWidth = patientValue.clientWidth;
          const text = patientValue.textContent || '';
          return {
            isTruncated,
            scrollWidth,
            clientWidth,
            text,
            textLength: text.length,
            overflow: computedStyle.overflow,
            textOverflow: computedStyle.textOverflow,
            whiteSpace: computedStyle.whiteSpace,
          };
        });
        return results;
      });

      expect(patientNameTruncation).toHaveLength(2);
      patientNameTruncation.forEach((result) => {
        expect(result.isTruncated).toBe(false);
        expect(result.text).toBe('QA Wolf Targeted 20260925-094420');
        expect(result.textLength).toBe(30);
        expect(result.overflow).not.toBe('hidden');
        expect(result.textOverflow).not.toBe('ellipsis');
        expect(result.whiteSpace).not.toBe('nowrap');
      });
      await page.close();
    } finally {
      await browser.close();
    }
  });
});
