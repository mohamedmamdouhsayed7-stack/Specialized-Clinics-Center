import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';
import { PdfBrowserService } from '../common/filters/pdf/pdf-browser.service';
import { renderReportsHtml, ReportsExportData } from './templates/reports-pdf-template';

const LABELS_EN: Record<string, string> = {
  CASH: 'Cash', VISA: 'Visa', KNET: 'KNET', LINK: 'Payment Link', OTHER: 'Other',
  UNPAID: 'Unpaid', PARTIALLY_PAID: 'Partially Paid', PAID: 'Paid in Full',
  CHECKUP: 'Checkup', FOLLOW_UP: 'Follow-up',
  BOOKED: 'Booked', CONFIRMED: 'Confirmed', DONE: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'No Show',
};
const LABELS_AR: Record<string, string> = {
  CASH: 'نقداً', VISA: 'فيزا', KNET: 'كي نت', LINK: 'رابط دفع', OTHER: 'أخرى',
  UNPAID: 'غير مدفوعة', PARTIALLY_PAID: 'مدفوعة جزئيًا', PAID: 'مدفوعة بالكامل',
  CHECKUP: 'كشف', FOLLOW_UP: 'متابعة',
  BOOKED: 'محجوز', CONFIRMED: 'مؤكد', DONE: 'تم', CANCELLED: 'ملغي', NO_SHOW: 'لم يحضر',
};

@Injectable()
export class ReportsExportService {
  constructor(
    private reportsService: ReportsService,
    private pdfBrowserService: PdfBrowserService,
  ) {}

  // Single source of truth for export data: every field here comes from the
  // exact same ReportsService methods (and therefore the exact same
  // queries/filters) that power the Reports page itself — nothing here is
  // recomputed differently, so the exported numbers can never drift from
  // what's on screen.
  private async collectData(from?: string, to?: string): Promise<{ from: string; to: string; summary: ReportsExportData['summary']; rest: Omit<ReportsExportData, 'from' | 'to' | 'summary'> }> {
    const [summary, revenueTimeseries, paymentMethods, invoiceStatus, serviceUsage, visitTypes, appointmentStatus, newPatientsTimeseries, outstanding] =
      await Promise.all([
        this.reportsService.getSummary(from, to),
        this.reportsService.getRevenueTimeseries(from, to),
        this.reportsService.getPaymentMethodBreakdown(from, to),
        this.reportsService.getInvoiceStatusBreakdown(from, to),
        this.reportsService.getServiceUsage(from, to),
        this.reportsService.getVisitTypeBreakdown(from, to),
        this.reportsService.getAppointmentStatusBreakdown(from, to),
        this.reportsService.getNewPatientsTimeseries(from, to),
        this.reportsService.getOutstandingInvoices(1, 100),
      ]);

    return {
      from: summary.range.from.toISOString().slice(0, 10),
      to: summary.range.to.toISOString().slice(0, 10),
      summary: {
        totalRevenue: summary.totalRevenue,
        totalCollected: summary.totalCollected,
        outstandingAmount: summary.outstandingAmount,
        totalInvoices: summary.totalInvoices,
        totalVisits: summary.totalVisits,
        newPatients: summary.newPatients,
        totalAppointments: summary.totalAppointments,
      },
      rest: {
        revenueTimeseries,
        paymentMethods,
        invoiceStatus,
        serviceUsage,
        visitTypes,
        appointmentStatus,
        newPatientsTimeseries,
        outstandingInvoices: outstanding.data.map((inv) => ({
          invoiceNumber: inv.invoiceNumber,
          patientName: inv.patient.fullNameAr,
          total: Number(inv.total),
          paid: Number(inv.paid),
          remaining: Number(inv.remaining),
          paymentStatus: inv.paymentStatus,
        })),
      },
    };
  }

  async generatePdf(from: string | undefined, to: string | undefined, lang: 'en' | 'ar'): Promise<Buffer> {
    const { from: f, to: t, summary, rest } = await this.collectData(from, to);
    const data: ReportsExportData = { from: f, to: t, summary, ...rest };
    const html = renderReportsHtml(data, lang);
    return this.pdfBrowserService.renderHtmlToPdf(html);
  }

  async generateExcel(from: string | undefined, to: string | undefined, lang: 'en' | 'ar'): Promise<Buffer> {
    const { from: f, to: t, summary, rest } = await this.collectData(from, to);
    const L = lang === 'ar' ? LABELS_AR : LABELS_EN;
    const label = (key: string) => L[key] || key;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Specialized Clinics Center';
    workbook.created = new Date();

    const currencyFmt = '#,##0.00 "KD"';
    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102F63' } };
    const headerFont: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

    const styleHeader = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
      });
    };

    // --- Summary sheet ---
    const summarySheet = workbook.addWorksheet(lang === 'ar' ? 'الملخص' : 'Summary');
    summarySheet.columns = [{ width: 28 }, { width: 20 }];
    summarySheet.addRow([lang === 'ar' ? 'التقارير والتحليلات' : 'Reports & Analytics']);
    summarySheet.addRow([lang === 'ar' ? 'الفترة' : 'Period', `${f} — ${t}`]);
    summarySheet.addRow([lang === 'ar' ? 'تاريخ الإنشاء' : 'Generated At', new Date().toISOString().slice(0, 16).replace('T', ' ')]);
    summarySheet.addRow([]);
    const summaryHeaderRow = summarySheet.addRow([lang === 'ar' ? 'المؤشر' : 'Metric', lang === 'ar' ? 'القيمة' : 'Value']);
    styleHeader(summaryHeaderRow);
    const summaryRows: Array<[string, number]> = [
      [lang === 'ar' ? 'إجمالي الإيرادات' : 'Total Revenue', summary.totalRevenue],
      [lang === 'ar' ? 'إجمالي المدفوعات' : 'Total Collected', summary.totalCollected],
      [lang === 'ar' ? 'المستحق' : 'Outstanding', summary.outstandingAmount],
      [lang === 'ar' ? 'عدد الفواتير' : 'Invoices', summary.totalInvoices],
      [lang === 'ar' ? 'عدد الزيارات' : 'Visits', summary.totalVisits],
      [lang === 'ar' ? 'مرضى جدد' : 'New Patients', summary.newPatients],
      [lang === 'ar' ? 'عدد المواعيد' : 'Appointments', summary.totalAppointments],
    ];
    for (const [name, value] of summaryRows) {
      const row = summarySheet.addRow([name, value]);
      if (name.toLowerCase().includes('total') || name.includes('إجمالي') || name.includes('المستحق') || name.toLowerCase().includes('outstanding')) {
        row.getCell(2).numFmt = currencyFmt;
      }
    }

    // --- Revenue by day sheet ---
    const revenueSheet = workbook.addWorksheet(lang === 'ar' ? 'الإيرادات اليومية' : 'Daily Revenue');
    revenueSheet.columns = [{ width: 14 }, { width: 16 }, { width: 16 }];
    const revenueHeader = revenueSheet.addRow([lang === 'ar' ? 'التاريخ' : 'Date', lang === 'ar' ? 'الإيرادات' : 'Revenue', lang === 'ar' ? 'المدفوعات' : 'Collected']);
    styleHeader(revenueHeader);
    for (const r of rest.revenueTimeseries) {
      const row = revenueSheet.addRow([r.date, r.revenue, r.collected]);
      row.getCell(2).numFmt = currencyFmt;
      row.getCell(3).numFmt = currencyFmt;
    }

    // --- Payment methods sheet ---
    const pmSheet = workbook.addWorksheet(lang === 'ar' ? 'طرق الدفع' : 'Payment Methods');
    pmSheet.columns = [{ width: 16 }, { width: 16 }, { width: 10 }];
    const pmHeader = pmSheet.addRow([lang === 'ar' ? 'الطريقة' : 'Method', lang === 'ar' ? 'المبلغ' : 'Amount', lang === 'ar' ? 'العدد' : 'Count']);
    styleHeader(pmHeader);
    for (const r of rest.paymentMethods) {
      const row = pmSheet.addRow([label(r.method), r.amount, r.count]);
      row.getCell(2).numFmt = currencyFmt;
    }

    // --- Invoice status sheet ---
    const statusSheet = workbook.addWorksheet(lang === 'ar' ? 'حالة الفواتير' : 'Invoice Status');
    statusSheet.columns = [{ width: 18 }, { width: 16 }, { width: 10 }];
    const statusHeader = statusSheet.addRow([lang === 'ar' ? 'الحالة' : 'Status', lang === 'ar' ? 'المبلغ' : 'Amount', lang === 'ar' ? 'العدد' : 'Count']);
    styleHeader(statusHeader);
    for (const r of rest.invoiceStatus) {
      const row = statusSheet.addRow([label(r.paymentStatus), r.amount, r.count]);
      row.getCell(2).numFmt = currencyFmt;
    }

    // --- Service usage sheet ---
    const serviceSheet = workbook.addWorksheet(lang === 'ar' ? 'استخدام الخدمات' : 'Services Usage');
    serviceSheet.columns = [{ width: 26 }, { width: 14 }, { width: 16 }];
    const serviceHeader = serviceSheet.addRow([lang === 'ar' ? 'الخدمة' : 'Service', lang === 'ar' ? 'عدد المرات' : 'Times Used', lang === 'ar' ? 'الإيرادات' : 'Revenue']);
    styleHeader(serviceHeader);
    for (const r of rest.serviceUsage) {
      const row = serviceSheet.addRow([r.serviceName, r.timesUsed, r.revenue]);
      row.getCell(3).numFmt = currencyFmt;
    }

    // --- Visit types sheet ---
    const visitSheet = workbook.addWorksheet(lang === 'ar' ? 'أنواع الزيارات' : 'Visit Types');
    visitSheet.columns = [{ width: 18 }, { width: 10 }];
    const visitHeader = visitSheet.addRow([lang === 'ar' ? 'النوع' : 'Type', lang === 'ar' ? 'العدد' : 'Count']);
    styleHeader(visitHeader);
    for (const r of rest.visitTypes) {
      visitSheet.addRow([label(r.type), r.count]);
    }

    // --- Appointment status sheet ---
    const apptSheet = workbook.addWorksheet(lang === 'ar' ? 'حالة المواعيد' : 'Appointment Status');
    apptSheet.columns = [{ width: 18 }, { width: 10 }];
    const apptHeader = apptSheet.addRow([lang === 'ar' ? 'الحالة' : 'Status', lang === 'ar' ? 'العدد' : 'Count']);
    styleHeader(apptHeader);
    for (const r of rest.appointmentStatus) {
      apptSheet.addRow([label(r.status), r.count]);
    }

    // --- New patients sheet ---
    const patientsSheet = workbook.addWorksheet(lang === 'ar' ? 'مرضى جدد' : 'New Patients');
    patientsSheet.columns = [{ width: 14 }, { width: 10 }];
    const patientsHeader = patientsSheet.addRow([lang === 'ar' ? 'التاريخ' : 'Date', lang === 'ar' ? 'العدد' : 'Count']);
    styleHeader(patientsHeader);
    for (const r of rest.newPatientsTimeseries) {
      patientsSheet.addRow([r.date, r.count]);
    }

    // --- Outstanding invoices sheet ---
    const outSheet = workbook.addWorksheet(lang === 'ar' ? 'الفواتير المستحقة' : 'Outstanding Invoices');
    outSheet.columns = [{ width: 16 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }];
    const outHeader = outSheet.addRow([
      lang === 'ar' ? 'رقم الفاتورة' : 'Invoice #',
      lang === 'ar' ? 'المريضة' : 'Patient',
      lang === 'ar' ? 'الإجمالي' : 'Total',
      lang === 'ar' ? 'المدفوع' : 'Paid',
      lang === 'ar' ? 'المتبقي' : 'Remaining',
      lang === 'ar' ? 'الحالة' : 'Status',
    ]);
    styleHeader(outHeader);
    for (const r of rest.outstandingInvoices) {
      const row = outSheet.addRow([r.invoiceNumber, r.patientName, r.total, r.paid, r.remaining, label(r.paymentStatus)]);
      row.getCell(3).numFmt = currencyFmt;
      row.getCell(4).numFmt = currencyFmt;
      row.getCell(5).numFmt = currencyFmt;
    }

    // Real, filterable/sortable tables (not just static ranges) for every sheet.
    for (const ws of workbook.worksheets) {
      if (ws.rowCount > 1 && ws.columnCount > 0) {
        const headerRowNumber = ws.name.includes('Summary') || ws.name.includes('الملخص') ? 5 : 1;
        ws.autoFilter = {
          from: { row: headerRowNumber, column: 1 },
          to: { row: headerRowNumber, column: ws.columnCount },
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
