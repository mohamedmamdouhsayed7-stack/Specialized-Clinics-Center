import { Response } from 'express';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesController } from './invoices.controller';

describe('InvoicesController PDF routes', () => {
  const pdfService = {
    generate: jest.fn().mockResolvedValue({
      buffer: Buffer.from('pdf'),
      patientName: 'Sara Ahmed',
      invoiceNumber: 'INV-1',
    }),
  };
  const response = {
    set: jest.fn(),
    end: jest.fn(),
  } as unknown as Response;
  const controller = new InvoicesController({} as never, pdfService as unknown as InvoicePdfService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses a single copy for internal print and download PDFs', async () => {
    await controller.pdf('invoice-id', 'en', response);

    expect(pdfService.generate).toHaveBeenCalledWith('invoice-id', 'en', { copies: 1 });
  });

  it('keeps customer-share PDFs at a single copy', async () => {
    await controller.sharePdf('invoice-id', 'en', response);

    expect(pdfService.generate).toHaveBeenCalledWith('invoice-id', 'en', { copies: 1 });
  });
});
