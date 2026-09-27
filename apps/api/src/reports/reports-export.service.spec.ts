import ExcelJS from 'exceljs';
import { ReportsExportService } from './reports-export.service';

describe('ReportsExportService Excel export', () => {
  it('still produces the report workbook independently of the backup feature', async () => {
    // Kuwait midnight at the start of Aug 29 through the final instant of Sep 27.
    const from = new Date('2026-08-28T21:00:00.000Z');
    const to = new Date('2026-09-27T20:59:59.999Z');
    const reportsService = {
      getSummary: jest.fn().mockResolvedValue({
        range: { from, to }, totalRevenue: 100, totalCollected: 80, outstandingAmount: 20,
        totalInvoices: 2, totalVisits: 3, newPatients: 1, totalAppointments: 4,
      }),
      getRevenueTimeseries: jest.fn().mockResolvedValue([]),
      getPaymentMethodBreakdown: jest.fn().mockResolvedValue([]),
      getInvoiceStatusBreakdown: jest.fn().mockResolvedValue([]),
      getServiceUsage: jest.fn().mockResolvedValue([]),
      getVisitTypeBreakdown: jest.fn().mockResolvedValue([]),
      getAppointmentStatusBreakdown: jest.fn().mockResolvedValue([]),
      getNewPatientsTimeseries: jest.fn().mockResolvedValue([]),
      getOutstandingInvoices: jest.fn().mockResolvedValue({ data: [] }),
    };
    const service = new ReportsExportService(reportsService as never, {} as never);

    const buffer = await service.generateExcel('2026-08-29', '2026-09-27', 'en');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    expect(workbook.getWorksheet('Summary')?.getCell('B6').value).toBe(100);
    expect(workbook.getWorksheet('Daily Revenue')).toBeDefined();
    expect(workbook.getWorksheet('Summary')?.getCell('B2').value).toBe('2026-08-29 — 2026-09-27');
    expect(reportsService.getSummary).toHaveBeenCalledWith('2026-08-29', '2026-09-27');
  });

  it('labels the PDF period with Kuwait calendar dates across a UTC day boundary', async () => {
    const reportsService = {
      getSummary: jest.fn().mockResolvedValue({
        range: {
          from: new Date('2026-08-28T21:00:00.000Z'),
          to: new Date('2026-09-27T20:59:59.999Z'),
        },
        totalRevenue: 0, totalCollected: 0, outstandingAmount: 0,
        totalInvoices: 0, totalVisits: 0, newPatients: 0, totalAppointments: 0,
      }),
      getRevenueTimeseries: jest.fn().mockResolvedValue([]),
      getPaymentMethodBreakdown: jest.fn().mockResolvedValue([]),
      getInvoiceStatusBreakdown: jest.fn().mockResolvedValue([]),
      getServiceUsage: jest.fn().mockResolvedValue([]),
      getVisitTypeBreakdown: jest.fn().mockResolvedValue([]),
      getAppointmentStatusBreakdown: jest.fn().mockResolvedValue([]),
      getNewPatientsTimeseries: jest.fn().mockResolvedValue([]),
      getOutstandingInvoices: jest.fn().mockResolvedValue({ data: [] }),
    };
    const pdfBrowserService = { renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const service = new ReportsExportService(reportsService as never, pdfBrowserService as never);

    await service.generatePdf('2026-08-29', '2026-09-27', 'en');

    expect(pdfBrowserService.renderHtmlToPdf).toHaveBeenCalledWith(expect.stringContaining('Period: 2026-08-29 — 2026-09-27'));
  });
});
