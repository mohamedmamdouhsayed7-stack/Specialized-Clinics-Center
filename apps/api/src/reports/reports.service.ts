import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

// Clinic business timezone (Kuwait - used for KNET, KD, ar-KW localization)
// Kuwait is UTC+3 year-round (no DST)
const CLINIC_TIMEZONE_OFFSET_HOURS = 3; // UTC+3

/**
 * Convert a local calendar date (YYYY-MM-DD) in the clinic's timezone to
 * the corresponding UTC instant for the start of that day (00:00:00 local).
 * This ensures PostgreSQL timestamp comparisons represent the exact local day.
 *
 * Example: "2026-09-18" in Kuwait (UTC+3) becomes "2026-09-17T21:00:00.000Z"
 */
export function localDayStartToUtc(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Create a Date representing midnight UTC on the target date
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  
  // Subtract the timezone offset to get the UTC instant that represents
  // midnight in the clinic's local timezone
  // For UTC+3: midnight local = 21:00 UTC previous day
  const utcInstant = new Date(utcMidnight.getTime() - (CLINIC_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000));
  
  return utcInstant;
}

/**
 * Convert a local calendar date (YYYY-MM-DD) in the clinic's timezone to
 * the corresponding UTC instant for the end of that day (23:59:59.999 local).
 *
 * Example: "2026-09-18" in Kuwait (UTC+3) becomes "2026-09-18T20:59:59.999Z"
 */
export function localDayEndToUtc(dateStr: string): Date {
  const start = localDayStartToUtc(dateStr);
  // Add 24 hours and subtract 1 millisecond to get end of day
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * Get today's calendar date in the clinic's timezone as YYYY-MM-DD.
 */
function getLocalTodayInClinicTimezone(): string {
  const now = new Date();
  // Convert current UTC time to clinic timezone
  const utcNow = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const clinicNow = new Date(utcNow + (CLINIC_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000));
  
  const year = clinicNow.getUTCFullYear();
  const month = String(clinicNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(clinicNow.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private resolveRange(from?: string, to?: string) {
    // Use timezone-aware calendar day conversion for date range queries
    if (to) {
      const toDate = localDayEndToUtc(to);
      if (from) {
        const fromDate = localDayStartToUtc(from);
        return { fromDate, toDate };
      }
      // If only 'to' is provided, calculate 29 days before it
      const toDateObj = new Date(to);
      const fromDateObj = new Date(toDateObj.getTime() - 29 * 24 * 60 * 60 * 1000);
      const fromDateStr = fromDateObj.toISOString().slice(0, 10);
      const fromDate = localDayStartToUtc(fromDateStr);
      return { fromDate, toDate };
    }
    
    // If no dates provided, use today and 29 days ago in clinic timezone
    const todayStr = getLocalTodayInClinicTimezone();
    const toDate = localDayEndToUtc(todayStr);
    
    const toDateObj = new Date(todayStr);
    const fromDateObj = new Date(toDateObj.getTime() - 29 * 24 * 60 * 60 * 1000);
    const fromDateStr = fromDateObj.toISOString().slice(0, 10);
    const fromDate = localDayStartToUtc(fromDateStr);
    
    return { fromDate, toDate };
  }

  // Every number below comes from an actual query against real rows in the
  // given date range — nothing here is a placeholder or invented figure.
  async getSummary(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);

    const [
      revenueAgg,
      collectedAgg,
      outstandingAgg,
      totalInvoices,
      totalVisits,
      newPatients,
      totalAppointments,
      completedAppointments,
    ] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { status: 'ISSUED', issuedAt: { gte: fromDate, lte: toDate } },
        _sum: { total: true },
      }),
      this.prisma.payment.aggregate({
        where: { paymentDate: { gte: fromDate, lte: toDate }, status: 'RECORDED' },
        _sum: { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where: { status: 'ISSUED', issuedAt: { gte: fromDate, lte: toDate } },
        _sum: { remaining: true },
      }),
      this.prisma.invoice.count({
        where: { status: 'ISSUED', issuedAt: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.visit.count({
        where: { visitDate: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.patient.count({
        where: { createdAt: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.appointment.count({
        where: { scheduledAt: { gte: fromDate, lte: toDate } },
      }),
      this.prisma.appointment.count({
        where: { scheduledAt: { gte: fromDate, lte: toDate }, status: 'DONE' },
      }),
    ]);

    const appointmentCompletionRate = totalAppointments > 0
      ? (completedAppointments / totalAppointments) * 100
      : 0;

    return {
      range: { from: fromDate, to: toDate },
      totalRevenue: Number(revenueAgg._sum.total || 0),
      totalCollected: Number(collectedAgg._sum.amount || 0),
      outstandingAmount: Number(outstandingAgg._sum.remaining || 0),
      totalInvoices,
      totalVisits,
      newPatients,
      totalAppointments,
      appointmentCompletionRate: Math.round(appointmentCompletionRate * 10) / 10,
    };
  }

  async getRevenueTimeseries(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);

    // Raw SQL for day-level grouping using Asia/Kuwait timezone
    // We convert timestamps to Kuwait timezone before truncating to day
    const revenueRows = await this.prisma.$queryRaw<Array<{ day: Date; revenue: string }>>`
      SELECT date_trunc('day', "issuedAt" AT TIME ZONE 'Asia/Kuwait') AS day, SUM("total") AS revenue
      FROM "Invoice"
      WHERE "status" = 'ISSUED' AND "issuedAt" BETWEEN ${fromDate} AND ${toDate}
      GROUP BY day ORDER BY day ASC
    `;
    const collectedRows = await this.prisma.$queryRaw<Array<{ day: Date; collected: string }>>`
      SELECT date_trunc('day', "paymentDate" AT TIME ZONE 'Asia/Kuwait') AS day, SUM("amount") AS collected
      FROM "Payment"
      WHERE "paymentDate" BETWEEN ${fromDate} AND ${toDate} AND "status" = 'RECORDED'
      GROUP BY day ORDER BY day ASC
    `;

    const byDay = new Map<string, { date: string; revenue: number; collected: number }>();
    for (const row of revenueRows) {
      const key = row.day.toISOString().slice(0, 10);
      byDay.set(key, { date: key, revenue: Number(row.revenue), collected: 0 });
    }
    for (const row of collectedRows) {
      const key = row.day.toISOString().slice(0, 10);
      const existing = byDay.get(key);
      if (existing) existing.collected = Number(row.collected);
      else byDay.set(key, { date: key, revenue: 0, collected: Number(row.collected) });
    }

    return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getPaymentMethodBreakdown(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);
    const rows = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { paymentDate: { gte: fromDate, lte: toDate }, status: 'RECORDED' },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      method: r.method,
      amount: Number(r._sum.amount || 0),
      count: r._count._all,
    }));
  }

  async getInvoiceStatusBreakdown(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);
    const rows = await this.prisma.invoice.groupBy({
      by: ['paymentStatus'],
      where: { status: 'ISSUED', issuedAt: { gte: fromDate, lte: toDate } },
      _sum: { total: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      paymentStatus: r.paymentStatus,
      amount: Number(r._sum.total || 0),
      count: r._count._all,
    }));
  }

  async getPaymentExceptions(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);
    const exceptions = await this.prisma.invoice.findMany({
      where: {
        status: 'ISSUED',
        issuedAt: { gte: fromDate, lte: toDate },
        OR: [
          { remaining: { gt: 0 } },
          { paymentStatus: { not: 'PAID' } },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        paid: true,
        remaining: true,
        paymentStatus: true,
        issuedAt: true,
        patient: { select: { fullNameAr: true, civilId: true } },
      },
    });
    return exceptions.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      total: Number(inv.total),
      paid: Number(inv.paid),
      remaining: Number(inv.remaining),
      paymentStatus: inv.paymentStatus,
      issuedAt: inv.issuedAt,
      patient: inv.patient,
    }));
  }

  async getServiceUsage(from?: string, to?: string, limit: number = 10) {
    const { fromDate, toDate } = this.resolveRange(from, to);
    const rows = await this.prisma.invoiceItem.groupBy({
      by: ['serviceNameSnapshot'],
      where: {
        invoice: { status: 'ISSUED', issuedAt: { gte: fromDate, lte: toDate } },
      },
      _sum: { lineTotal: true, quantity: true },
      _count: { _all: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      serviceName: r.serviceNameSnapshot,
      timesUsed: r._sum.quantity || 0,
      revenue: Number(r._sum.lineTotal || 0),
    }));
  }

  async getVisitTypeBreakdown(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);
    const rows = await this.prisma.visit.groupBy({
      by: ['type'],
      where: { visitDate: { gte: fromDate, lte: toDate } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ type: r.type, count: r._count._all }));
  }

  async getAppointmentStatusBreakdown(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);
    const rows = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: { scheduledAt: { gte: fromDate, lte: toDate } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  async getNewPatientsTimeseries(from?: string, to?: string) {
    const { fromDate, toDate } = this.resolveRange(from, to);
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Kuwait') AS day, COUNT(*) AS count
      FROM "Patient"
      WHERE "createdAt" BETWEEN ${fromDate} AND ${toDate}
      GROUP BY day ORDER BY day ASC
    `;
    return rows.map((r) => ({ date: r.day.toISOString().slice(0, 10), count: Number(r.count) }));
  }

  async getOutstandingInvoices(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const where = { status: 'ISSUED' as const, remaining: { gt: 0 } };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { remaining: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          paid: true,
          remaining: true,
          paymentStatus: true,
          issuedAt: true,
          patient: { select: { fullNameAr: true, civilId: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  // Daily Closing Report — a single calendar day's snapshot of invoicing and
  // collections, built entirely from real Invoice/Payment rows for that day.
  // Reversed payments are excluded from collection totals (they were undone),
  // matching what a genuine end-of-day cash closing should show.
  //
  // Reconciliation semantics:
  // - expected = total of invoices issued during the selected local calendar day
  // - actual = total of payments recorded during the selected local calendar day
  // - difference = operational reconciliation signal
  // - difference does NOT automatically mean unpaid debt; it may reflect payment date variations
  async getDailyClosing(date?: string) {
    // Use timezone-aware calendar day conversion for the clinic's local business day
    const dateStr = date || getLocalTodayInClinicTimezone();
    const dayStart = localDayStartToUtc(dateStr);
    const dayEnd = localDayEndToUtc(dateStr);

    const [
      invoicesToday,
      paymentsToday,
      paymentMethodBreakdown,
      invoicePaymentStatusBreakdown,
      visitsToday,
      completedVisits,
      appointmentsToday,
      completedAppointments,
      cancelledOrNoShowAppointments,
    ] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: 'ISSUED', issuedAt: { gte: dayStart, lte: dayEnd } },
        orderBy: { issuedAt: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          paid: true,
          remaining: true,
          paymentStatus: true,
          issuedAt: true,
          patient: { select: { fullNameAr: true, civilId: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { status: 'RECORDED', paymentDate: { gte: dayStart, lte: dayEnd } },
        orderBy: { paymentDate: 'asc' },
        select: {
          id: true,
          amount: true,
          method: true,
          paymentDate: true,
          invoice: { select: { invoiceNumber: true, patient: { select: { fullNameAr: true } } } },
        },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { status: 'RECORDED', paymentDate: { gte: dayStart, lte: dayEnd } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['paymentStatus'],
        where: { status: 'ISSUED', issuedAt: { gte: dayStart, lte: dayEnd } },
        _count: { _all: true },
      }),
      this.prisma.visit.count({
        where: { visitDate: { gte: dayStart, lte: dayEnd } },
      }),
      this.prisma.visit.count({
        where: { visitDate: { gte: dayStart, lte: dayEnd }, status: 'COMPLETED' },
      }),
      this.prisma.appointment.count({
        where: { scheduledAt: { gte: dayStart, lte: dayEnd } },
      }),
      this.prisma.appointment.count({
        where: { scheduledAt: { gte: dayStart, lte: dayEnd }, status: 'DONE' },
      }),
      this.prisma.appointment.count({
        where: { scheduledAt: { gte: dayStart, lte: dayEnd }, status: { in: ['CANCELLED', 'NO_SHOW'] } },
      }),
    ]);

    const totalInvoiced = invoicesToday
      .reduce((sum, inv) => sum.add(inv.total), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();
    const totalCollected = paymentsToday
      .reduce((sum, p) => sum.add(p.amount), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();
    const totalRemaining = invoicesToday
      .reduce((sum, inv) => sum.add(inv.remaining), new Decimal(0))
      .toDecimalPlaces(2)
      .toNumber();

    const paymentStatusCounts: Record<string, number> = { UNPAID: 0, PARTIALLY_PAID: 0, PAID: 0 };
    for (const row of invoicePaymentStatusBreakdown) {
      paymentStatusCounts[row.paymentStatus] = row._count._all;
    }

    // Calculate reconciliation difference
    const reconciliationDifference = totalInvoiced - totalCollected;

    // Count payment exceptions
    const paymentExceptions = invoicesToday.filter(
      inv => inv.remaining.gt(0) || inv.paymentStatus !== 'PAID'
    ).length;

    return {
      date: dateStr,
      totalInvoiced,
      totalCollected,
      totalRemaining,
      reconciliationDifference,
      invoiceCount: invoicesToday.length,
      paymentExceptions,
      visitsToday,
      completedVisits,
      appointmentsToday,
      completedAppointments,
      cancelledOrNoShowAppointments,
      paymentMethods: paymentMethodBreakdown.map((r) => ({
        method: r.method,
        amount: Number(r._sum.amount || 0),
        count: r._count._all,
      })),
      paymentStatusCounts,
      invoices: invoicesToday.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        patientName: inv.patient.fullNameAr,
        civilId: inv.patient.civilId,
        total: Number(inv.total),
        paid: Number(inv.paid),
        remaining: Number(inv.remaining),
        paymentStatus: inv.paymentStatus,
        issuedAt: inv.issuedAt,
      })),
      payments: paymentsToday.map((p) => ({
        id: p.id,
        invoiceNumber: p.invoice.invoiceNumber,
        patientName: p.invoice.patient.fullNameAr,
        amount: Number(p.amount),
        method: p.method,
        paymentDate: p.paymentDate,
      })),
    };
  }
}
