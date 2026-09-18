import { CLINIC_LOGO_BASE64 } from '../../invoices/pdf/clinic-logo';
import { Decimal } from '@prisma/client/runtime/library';

export interface ReportsExportData {
  from: string;
  to: string;
  summary: {
    totalRevenue: number;
    totalCollected: number;
    outstandingAmount: number;
    totalInvoices: number;
    totalVisits: number;
    newPatients: number;
    totalAppointments: number;
  };
  revenueTimeseries: Array<{ date: string; revenue: number; collected: number }>;
  paymentMethods: Array<{ method: string; amount: number; count: number }>;
  invoiceStatus: Array<{ paymentStatus: string; amount: number; count: number }>;
  serviceUsage: Array<{ serviceName: string; timesUsed: number; revenue: number }>;
  visitTypes: Array<{ type: string; count: number }>;
  appointmentStatus: Array<{ status: string; count: number }>;
  newPatientsTimeseries: Array<{ date: string; count: number }>;
  outstandingInvoices: Array<{ invoiceNumber: string; patientName: string; total: number; paid: number; remaining: number; paymentStatus: string }>;
}

type Lang = 'en' | 'ar';

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Reports & Analytics', period: 'Period', generatedAt: 'Generated at',
    totalRevenue: 'Total Revenue', totalCollected: 'Total Collected', outstandingAmount: 'Outstanding',
    totalInvoices: 'Invoices', totalVisits: 'Visits', newPatients: 'New Patients', totalAppointments: 'Appointments',
    dailyRevenue: 'Revenue & Collections by Day', date: 'Date', revenue: 'Revenue', collected: 'Collected',
    paymentMethods: 'Payment Methods', method: 'Method', amount: 'Amount', count: 'Count',
    invoiceStatus: 'Invoices by Payment Status', status: 'Status',
    serviceUsage: 'Top Services by Revenue', service: 'Service', timesUsed: 'Times Used',
    visitTypes: 'Visit Types', type: 'Type',
    appointmentStatus: 'Appointment Status',
    newPatientsTrend: 'New Patients Trend',
    outstandingInvoices: 'Outstanding Invoices', invoiceNumber: 'Invoice #', patient: 'Patient', total: 'Total', paid: 'Paid', remaining: 'Remaining',
    currency: 'KD', clinic: 'Specialized Clinics Center', noData: 'No data',
    UNPAID: 'Unpaid', PARTIALLY_PAID: 'Partially Paid', PAID: 'Paid in Full',
    CASH: 'Cash', VISA: 'Visa', KNET: 'KNET', LINK: 'Payment Link', OTHER: 'Other',
    CHECKUP: 'Checkup', FOLLOW_UP: 'Follow-up',
    BOOKED: 'Booked', CONFIRMED: 'Confirmed', DONE: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'No Show',
  },
  ar: {
    title: 'التقارير والتحليلات', period: 'الفترة', generatedAt: 'تاريخ الإنشاء',
    totalRevenue: 'إجمالي الإيرادات', totalCollected: 'إجمالي المدفوعات', outstandingAmount: 'المستحق',
    totalInvoices: 'الفواتير', totalVisits: 'الزيارات', newPatients: 'مرضى جدد', totalAppointments: 'المواعيد',
    dailyRevenue: 'الإيرادات والمدفوعات يوميًا', date: 'التاريخ', revenue: 'الإيرادات', collected: 'المدفوعات',
    paymentMethods: 'طرق الدفع', method: 'الطريقة', amount: 'المبلغ', count: 'العدد',
    invoiceStatus: 'الفواتير حسب حالة الدفع', status: 'الحالة',
    serviceUsage: 'أعلى الخدمات من حيث الإيرادات', service: 'الخدمة', timesUsed: 'عدد المرات',
    visitTypes: 'أنواع الزيارات', type: 'النوع',
    appointmentStatus: 'حالة المواعيد',
    newPatientsTrend: 'اتجاه المرضى الجدد',
    outstandingInvoices: 'الفواتير المستحقة', invoiceNumber: 'رقم الفاتورة', patient: 'المريض', total: 'الإجمالي', paid: 'المدفوع', remaining: 'المتبقي',
    currency: 'د.ك', clinic: 'مركز العيادات التخصصية', noData: 'لا توجد بيانات',
    UNPAID: 'غير مدفوعة', PARTIALLY_PAID: 'مدفوعة جزئيًا', PAID: 'مدفوعة بالكامل',
    CASH: 'نقداً', VISA: 'فيزا', KNET: 'كي نت', LINK: 'رابط دفع', OTHER: 'أخرى',
    CHECKUP: 'كشف', FOLLOW_UP: 'متابعة',
    BOOKED: 'محجوز', CONFIRMED: 'مؤكد', DONE: 'تم', CANCELLED: 'ملغي', NO_SHOW: 'لم يحضر',
  },
};

function money(v: number, t: Record<string, string>): string {
  return `${new Decimal(String(v)).toDecimalPlaces(2).toFixed(2)} ${t.currency}`;
}
function label(t: Record<string, string>, key: string): string {
  return t[key] || key;
}
function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderReportsHtml(data: ReportsExportData, lang: Lang): string {
  const t = TEXT[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const s = data.summary;
  const now = new Date();

  const tableOrEmpty = (rows: string, colSpan: number) =>
    rows || `<tr><td colspan="${colSpan}" class="empty">${t.noData}</td></tr>`;

  const revenueRows = data.revenueTimeseries
    .map((r) => `<tr><td>${r.date}</td><td>${money(r.revenue, t)}</td><td>${money(r.collected, t)}</td></tr>`)
    .join('');

  const paymentRows = data.paymentMethods
    .map((r) => `<tr><td>${label(t, r.method)}</td><td>${money(r.amount, t)}</td><td>${r.count}</td></tr>`)
    .join('');

  const invoiceStatusRows = data.invoiceStatus
    .map((r) => `<tr><td>${label(t, r.paymentStatus)}</td><td>${money(r.amount, t)}</td><td>${r.count}</td></tr>`)
    .join('');

  const serviceRows = data.serviceUsage
    .map((r) => `<tr><td>${escapeHtml(r.serviceName)}</td><td>${r.timesUsed}</td><td>${money(r.revenue, t)}</td></tr>`)
    .join('');

  const visitTypeRows = data.visitTypes
    .map((r) => `<tr><td>${label(t, r.type)}</td><td>${r.count}</td></tr>`)
    .join('');

  const apptStatusRows = data.appointmentStatus
    .map((r) => `<tr><td>${label(t, r.status)}</td><td>${r.count}</td></tr>`)
    .join('');

  const newPatientsRows = data.newPatientsTimeseries
    .map((r) => `<tr><td>${r.date}</td><td>${r.count}</td></tr>`)
    .join('');

  const outstandingRows = data.outstandingInvoices
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.invoiceNumber)}</td><td>${escapeHtml(r.patientName)}</td><td>${money(r.total, t)}</td><td>${money(r.paid, t)}</td><td>${money(r.remaining, t)}</td><td>${label(t, r.paymentStatus)}</td></tr>`,
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Arial', 'Noto Sans Arabic', 'Noto Naskh Arabic', sans-serif;
    color: #1F2430;
    margin: 0;
    font-size: 12px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 14px;
    border-bottom: 3px double #102F63;
    padding-bottom: 12px;
    margin-bottom: 14px;
  }
  .header img { width: 56px; height: 56px; }
  .header h1 { font-size: 18px; color: #102F63; margin: 0; }
  .header .clinic { font-size: 12px; color: #64748B; }
  .meta { text-align: ${dir === 'rtl' ? 'left' : 'right'}; font-size: 11px; color: #64748B; }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 18px;
  }
  .kpi {
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    padding: 8px 10px;
  }
  .kpi .label { font-size: 10px; color: #64748B; }
  .kpi .value { font-size: 15px; font-weight: bold; color: #102F63; }
  h2.section {
    font-size: 13px;
    color: #102F63;
    border-bottom: 1px solid #E2E8F0;
    padding-bottom: 4px;
    margin: 16px 0 8px;
    page-break-after: avoid;
  }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 11px; }
  th { background: #102F63; color: #fff; padding: 5px 8px; text-align: ${dir === 'rtl' ? 'right' : 'left'}; }
  td { padding: 5px 8px; border-bottom: 1px solid #E2E8F0; }
  tr:nth-child(even) td { background: #F6F8FC; }
  td.empty { text-align: center; color: #94A3B8; }
</style>
</head>
<body>
  <div class="header">
    <img src="data:image/png;base64,${CLINIC_LOGO_BASE64}" alt="logo" />
    <div style="flex:1">
      <h1>${t.title}</h1>
      <div class="clinic">${t.clinic}</div>
    </div>
    <div class="meta">
      <div>${t.period}: ${data.from} — ${data.to}</div>
      <div>${t.generatedAt}: ${now.toISOString().slice(0, 16).replace('T', ' ')}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi"><div class="label">${t.totalRevenue}</div><div class="value">${money(s.totalRevenue, t)}</div></div>
    <div class="kpi"><div class="label">${t.totalCollected}</div><div class="value">${money(s.totalCollected, t)}</div></div>
    <div class="kpi"><div class="label">${t.outstandingAmount}</div><div class="value">${money(s.outstandingAmount, t)}</div></div>
    <div class="kpi"><div class="label">${t.totalInvoices}</div><div class="value">${s.totalInvoices}</div></div>
    <div class="kpi"><div class="label">${t.totalVisits}</div><div class="value">${s.totalVisits}</div></div>
    <div class="kpi"><div class="label">${t.newPatients}</div><div class="value">${s.newPatients}</div></div>
    <div class="kpi"><div class="label">${t.totalAppointments}</div><div class="value">${s.totalAppointments}</div></div>
  </div>

  <h2 class="section">${t.dailyRevenue}</h2>
  <table>
    <thead><tr><th>${t.date}</th><th>${t.revenue}</th><th>${t.collected}</th></tr></thead>
    <tbody>${tableOrEmpty(revenueRows, 3)}</tbody>
  </table>

  <h2 class="section">${t.paymentMethods}</h2>
  <table>
    <thead><tr><th>${t.method}</th><th>${t.amount}</th><th>${t.count}</th></tr></thead>
    <tbody>${tableOrEmpty(paymentRows, 3)}</tbody>
  </table>

  <h2 class="section">${t.invoiceStatus}</h2>
  <table>
    <thead><tr><th>${t.status}</th><th>${t.amount}</th><th>${t.count}</th></tr></thead>
    <tbody>${tableOrEmpty(invoiceStatusRows, 3)}</tbody>
  </table>

  <h2 class="section">${t.serviceUsage}</h2>
  <table>
    <thead><tr><th>${t.service}</th><th>${t.timesUsed}</th><th>${t.amount}</th></tr></thead>
    <tbody>${tableOrEmpty(serviceRows, 3)}</tbody>
  </table>

  <h2 class="section">${t.visitTypes}</h2>
  <table>
    <thead><tr><th>${t.type}</th><th>${t.count}</th></tr></thead>
    <tbody>${tableOrEmpty(visitTypeRows, 2)}</tbody>
  </table>

  <h2 class="section">${t.appointmentStatus}</h2>
  <table>
    <thead><tr><th>${t.status}</th><th>${t.count}</th></tr></thead>
    <tbody>${tableOrEmpty(apptStatusRows, 2)}</tbody>
  </table>

  <h2 class="section">${t.newPatientsTrend}</h2>
  <table>
    <thead><tr><th>${t.date}</th><th>${t.count}</th></tr></thead>
    <tbody>${tableOrEmpty(newPatientsRows, 2)}</tbody>
  </table>

  <h2 class="section">${t.outstandingInvoices}</h2>
  <table>
    <thead><tr><th>${t.invoiceNumber}</th><th>${t.patient}</th><th>${t.total}</th><th>${t.paid}</th><th>${t.remaining}</th><th>${t.status}</th></tr></thead>
    <tbody>${tableOrEmpty(outstandingRows, 6)}</tbody>
  </table>
</body>
</html>`;
}
