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
});
