import ExcelJS from 'exceljs';
import { ReportsExportService } from './reports-export.service';

describe('ReportsExportService Excel export', () => {
  it('still produces the report workbook independently of the backup feature', async () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-25T00:00:00.000Z');
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

    const buffer = await service.generateExcel('2026-09-01', '2026-09-25', 'en');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    expect(workbook.getWorksheet('Summary')?.getCell('B6').value).toBe(100);
    expect(workbook.getWorksheet('Daily Revenue')).toBeDefined();
    expect(reportsService.getSummary).toHaveBeenCalledWith('2026-09-01', '2026-09-25');
  });
});
