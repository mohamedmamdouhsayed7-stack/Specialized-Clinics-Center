import { Injectable } from '@nestjs/common';

import { InvoicesService } from './invoices.service';

import { PdfBrowserService } from '../common/filters/pdf/pdf-browser.service';

import { renderInvoiceHtml } from './pdf/invoice-template';
import { invoicePatientDisplayName } from './invoice-filename';

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly pdfBrowserService: PdfBrowserService,
  ) { }

  private buildPdfInvoice(invoice: Awaited<ReturnType<InvoicesService['findOne']>>) {
    return {
      ...invoice,
      payments: invoice.payments
        .filter(
          (payment) =>
            payment.method === 'KNET' ||
            payment.method === 'LINK' ||
            payment.method === 'OTHER',
        )
        .map((payment) => ({
          amount: payment.amount,
          method: payment.method as 'KNET' | 'LINK' | 'OTHER',
          paymentDate: payment.paymentDate,
          status:
            payment.status === 'RECORDED' || payment.status === 'REVERSED'
              ? payment.status
              : undefined,
        })),
    };
  }

  async generate(invoiceId: string, language: 'ar' | 'en', options: { copies?: 1 | 2 } = {}) {
    const invoice = await this.invoicesService.findOne(invoiceId);
    const pdfInvoice = this.buildPdfInvoice(invoice);

    const html = renderInvoiceHtml(pdfInvoice, language, { copies: options.copies ?? 2 });

    const buffer = await this.pdfBrowserService.renderHtmlToPdf(html, {
      top: '0',
      bottom: '0',
      left: '0',
      right: '0',
    });
    return {
      buffer,
      patientName: invoicePatientDisplayName(invoice.patient, language),
      invoiceNumber: invoice.invoiceNumber,
    };
  }
}



