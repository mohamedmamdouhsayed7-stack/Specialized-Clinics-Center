import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';
import { parseApiError } from './api-error';

export interface ReportsSummary {
  range: { from: string; to: string };
  totalRevenue: number;
  totalCollected: number;
  outstandingAmount: number;
  totalInvoices: number;
  totalVisits: number;
  newPatients: number;
  totalAppointments: number;
  appointmentCompletionRate: number;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
  collected: number;
}

export type ReportPaymentMethod =
  | 'LINK'
  | 'KNET'
  | 'OTHER'
  | 'CASH'
  | 'VISA';
export interface PaymentMethodRow {
  method: ReportPaymentMethod;
  amount: number;
  count: number;
}

export interface InvoiceStatusRow {
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  amount: number;
  count: number;
}

export interface ServiceUsageRow {
  serviceName: string;
  timesUsed: number;
  revenue: number;
}

export interface VisitTypeRow {
  type: 'CHECKUP' | 'FOLLOW_UP' | 'OTHER';
  count: number;
}

export interface AppointmentStatusRow {
  status: string;
  count: number;
}

export interface NewPatientsPoint {
  date: string;
  count: number;
}

export interface TodayAppointmentException {
  id: string;
  patientNameAr: string;
  patientNameEn: string;
  scheduledAt: string;
  status: 'CANCELLED' | 'NO_SHOW';
}

export interface OutstandingInvoiceRow {
  id: string;
  invoiceNumber: string;
  total: string;
  paid: string;
  remaining: string;
  paymentStatus: string;
  issuedAt: string | null;
  patient: { fullNameAr: string; civilId: string };
}

export interface DailyClosingInvoiceRow {
  id: string;
  invoiceNumber: string;
  patientName: string;
  civilId: string;
  total: number;
  paid: number;
  remaining: number;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  issuedAt: string | null;
  isException?: boolean;
}

export interface DailyClosingPaymentRow {
  id: string;
  invoiceNumber: string;
  patientName: string;
  amount: number;
  method: ReportPaymentMethod;
  paymentDate: string;
}

export interface DailyClosingReport {
  date: string;
  totalInvoiced: number;
  totalCollected: number;
  totalRemaining: number;
  reconciliationDifference: number;
  invoiceCount: number;
  paymentExceptions: number;
  visitsToday: number;
  completedVisits: number;
  appointmentsToday: number;
  completedAppointments: number;
  cancelledOrNoShowAppointments: number;
  paymentMethods: Array<{ method: string; amount: number; count: number }>;
  paymentStatusCounts: { UNPAID: number; PARTIALLY_PAID: number; PAID: number };
  invoices: DailyClosingInvoiceRow[];
  payments: DailyClosingPaymentRow[];
}

class ReportsService {
  private getAuthHeaders() {
    const token = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${apiBaseUrl}${path}`, { headers: this.getAuthHeaders() });
    if (!response.ok) throw await parseApiError(response, 'Failed to fetch report data');
    return response.json();
  }

  private rangeQuery(from?: string, to?: string) {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  getSummary(from?: string, to?: string) {
    return this.get<ReportsSummary>(`/reports/summary${this.rangeQuery(from, to)}`);
  }

  getRevenueTimeseries(from?: string, to?: string) {
    return this.get<RevenuePoint[]>(`/reports/revenue-timeseries${this.rangeQuery(from, to)}`);
  }

  getPaymentMethods(from?: string, to?: string) {
    return this.get<PaymentMethodRow[]>(`/reports/payment-methods${this.rangeQuery(from, to)}`);
  }

  getInvoiceStatusBreakdown(from?: string, to?: string) {
    return this.get<InvoiceStatusRow[]>(`/reports/invoice-status${this.rangeQuery(from, to)}`);
  }

  getServiceUsage(from?: string, to?: string) {
    return this.get<ServiceUsageRow[]>(`/reports/service-usage${this.rangeQuery(from, to)}`);
  }

  getVisitTypes(from?: string, to?: string) {
    return this.get<VisitTypeRow[]>(`/reports/visit-types${this.rangeQuery(from, to)}`);
  }

  getAppointmentStatusBreakdown(from?: string, to?: string) {
    return this.get<AppointmentStatusRow[]>(`/reports/appointment-status${this.rangeQuery(from, to)}`);
  }

  getNewPatientsTimeseries(from?: string, to?: string) {
    return this.get<NewPatientsPoint[]>(`/reports/new-patients-timeseries${this.rangeQuery(from, to)}`);
  }

  getTodayAppointmentExceptions() {
    return this.get<TodayAppointmentException[]>(`/reports/today-appointment-exceptions`);
  }

  async getOutstandingInvoices(page: number = 1, limit: number = 10) {
    return this.get<{ data: OutstandingInvoiceRow[]; meta: { total: number; page: number; limit: number; totalPages: number } }>(
      `/reports/outstanding-invoices?page=${page}&limit=${limit}`,
    );
  }

  getDailyClosing(date?: string) {
    const qs = date ? `?date=${date}` : '';
    return this.get<DailyClosingReport>(`/reports/daily-closing${qs}`);
  }

  async downloadExport(format: 'pdf' | 'excel', from?: string, to?: string): Promise<void> {
    const lang = localStorage.getItem('clinic_language') === 'ar' ? 'ar' : 'en';
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    params.append('lang', lang);

    const response = await fetch(`${apiBaseUrl}/reports/export/${format}?${params.toString()}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      throw await parseApiError(response, `Failed to export report (${response.status})`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reports_${from || 'all'}_${to || 'all'}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }
}

export const reportsService = new ReportsService();
