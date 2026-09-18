import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportsExportService } from './reports-export.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

// Financial data end-to-end, so Admin-only — same access level as invoices.
// Query params land raw in an HTTP response header below — strip anything
// that isn't a safe date-ish character so a crafted `from`/`to` value can't
// break out of the header (CRLF/quote injection).
function safeForFilename(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const cleaned = value.replace(/[^0-9A-Za-z-]/g, '');
  return cleaned || fallback;
}

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsExportService: ReportsExportService,
  ) {}

  @Get('summary')
  getSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getSummary(from, to);
  }

  @Get('revenue-timeseries')
  getRevenueTimeseries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getRevenueTimeseries(from, to);
  }

  @Get('payment-methods')
  getPaymentMethodBreakdown(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getPaymentMethodBreakdown(from, to);
  }

  @Get('invoice-status')
  getInvoiceStatusBreakdown(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getInvoiceStatusBreakdown(from, to);
  }

  @Get('service-usage')
  getServiceUsage(@Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return this.reportsService.getServiceUsage(from, to, limit ? parseInt(limit, 10) : 10);
  }

  @Get('visit-types')
  getVisitTypeBreakdown(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getVisitTypeBreakdown(from, to);
  }

  @Get('appointment-status')
  getAppointmentStatusBreakdown(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getAppointmentStatusBreakdown(from, to);
  }

  @Get('today-appointment-exceptions')
  getTodayAppointmentExceptions() {
    return this.reportsService.getTodayAppointmentExceptions();
  }

  @Get('new-patients-timeseries')
  getNewPatientsTimeseries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getNewPatientsTimeseries(from, to);
  }

  @Get('outstanding-invoices')
  getOutstandingInvoices(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.reportsService.getOutstandingInvoices(page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
  }

  @Get('daily-closing')
  getDailyClosing(@Query('date') date?: string) {
    return this.reportsService.getDailyClosing(date);
  }

  @Get('export/pdf')
  async exportPdf(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('lang') lang: string | undefined,
    @Res() res: Response,
  ) {
    const language = lang === 'ar' ? 'ar' : 'en';
    const pdfBuffer = await this.reportsExportService.generatePdf(from, to, language);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reports_${safeForFilename(from, 'all')}_${safeForFilename(to, 'all')}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get('export/excel')
  async exportExcel(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('lang') lang: string | undefined,
    @Res() res: Response,
  ) {
    const language = lang === 'ar' ? 'ar' : 'en';
    const excelBuffer = await this.reportsExportService.generateExcel(from, to, language);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="reports_${safeForFilename(from, 'all')}_${safeForFilename(to, 'all')}.xlsx"`,
      'Content-Length': excelBuffer.length,
    });
    res.end(excelBuffer);
  }
}
