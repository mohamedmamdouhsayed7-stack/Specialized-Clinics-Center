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

  async generate(invoiceId: string, language: 'ar' | 'en') {
    const invoice = await this.invoicesService.findOne(invoiceId);
    const pdfInvoice = {
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

    const html = renderInvoiceHtml(pdfInvoice, language);

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



