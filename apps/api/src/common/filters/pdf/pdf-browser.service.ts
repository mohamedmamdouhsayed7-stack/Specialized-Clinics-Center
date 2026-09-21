import { Injectable, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

// Generic HTML → PDF renderer shared by any feature that needs it (currently
// the Reports export). Same lazy single-browser-instance pattern as the
// invoice PDF service — reuses Puppeteer, the library already in this
// project, rather than introducing a second PDF engine.
@Injectable()
export class PdfBrowserService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browserPromise;
  }

  async renderHtmlToPdf(
    html: string,
    margin: { top: string; bottom: string; left: string; right: string } = {
      top: '8mm',
      bottom: '8mm',
      left: '8mm',
      right: '8mm',
    },
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      // Allow loading external fonts from Google Fonts
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      });

      await page.setContent(html, { waitUntil: 'load' });
      // Add a small delay to allow fonts to load
      await new Promise(resolve => globalThis.setTimeout(resolve, 1000));
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin,
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy() {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
    }
  }
}
