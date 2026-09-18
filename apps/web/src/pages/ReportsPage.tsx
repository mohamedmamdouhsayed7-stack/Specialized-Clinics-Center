import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { TrendingUp, Wallet, ReceiptText, ClipboardList, UsersRound, CalendarDays, FileSpreadsheet, FileText, ClipboardCheck } from 'lucide-react';
import { reportsService } from '../services/reports.service';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import DateInput from '../components/DateInput';
import { formatMoney } from '../utils/money';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';

const COLORS = ['#102F63', '#173B78', '#4B5694', '#8991A6', '#C4362B', '#C98200'];

// Get local calendar date (YYYY-MM-DD) for the current day
function getLocalToday(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatAppointmentTime(dateStr: string): string {
  const d = new Date(dateStr);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuwait',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(d);
}

function KpiCard({ icon: Icon, label, value, suffix }: { icon: typeof TrendingUp; label: string; value: string | number; suffix?: string }) {
  return (
    <div className="ui-card p-3">
      <div className="flex items-center gap-1.5 text-[#64748B] text-xs mb-1.5">
        <Icon size={14} strokeWidth={1.75} />
        {label}
      </div>
      <div className="text-lg font-bold text-[#102F63] leading-tight">
        {value}{suffix && <span className="text-xs text-[#94A3B8] font-normal ml-0.5">{suffix}</span>}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    LINK: t('payments.methodLink'), KNET: t('payments.methodKnet'),
  };
  const VISIT_TYPE_LABELS: Record<string, string> = {
    CHECKUP: t('visits.typeCheckup'), FOLLOW_UP: t('visits.typeFollowUp'), OTHER: t('visits.typeOther'),
  };

  const [from, setFrom] = useState(todayMinus(29));
  const [to, setTo] = useState(getLocalToday());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const summary = useQuery({ queryKey: ['reports-summary', from, to], queryFn: () => reportsService.getSummary(from, to) });
  const revenueTimeseries = useQuery({ queryKey: ['reports-revenue-ts', from, to], queryFn: () => reportsService.getRevenueTimeseries(from, to) });
  const paymentMethods = useQuery({ queryKey: ['reports-payment-methods', from, to], queryFn: () => reportsService.getPaymentMethods(from, to) });
  const serviceUsage = useQuery({ queryKey: ['reports-service-usage', from, to], queryFn: () => reportsService.getServiceUsage(from, to) });
  const visitTypes = useQuery({ queryKey: ['reports-visit-types', from, to], queryFn: () => reportsService.getVisitTypes(from, to) });
  const newPatientsTimeseries = useQuery({ queryKey: ['reports-new-patients-ts', from, to], queryFn: () => reportsService.getNewPatientsTimeseries(from, to) });
  const todayAppointmentExceptions = useQuery({ queryKey: ['today-appt-exceptions'], queryFn: () => reportsService.getTodayAppointmentExceptions() });

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await reportsService.downloadExport('pdf', from, to);
      showToast({ type: 'success', message: t('feedback.reportExported') });
    } catch (err) {
      console.error('Failed to export PDF report:', err);
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('reports.exportError') });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      await reportsService.downloadExport('excel', from, to);
      showToast({ type: 'success', message: t('feedback.reportExported') });
    } catch (err) {
      console.error('Failed to export Excel report:', err);
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('reports.exportError') });
    } finally {
      setExportingExcel(false);
    }
  };

  const s = summary.data;

  return (
    <div className="page-container">
      <PageHeader
        title={t('sidebar.reports')}
        subtitle={t('reports.subtitle')}
        breadcrumbs={[{ label: t('sidebar.reports') }]}
        actions={
          <button
            onClick={() => navigate('/reports/daily-closing')}
            className="h-11 px-4 flex items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-white text-sm text-[#102F63] hover:bg-[#F6F8FC]"
          >
            <ClipboardCheck size={16} strokeWidth={1.75} />
            {t('dailyClosing.title')}
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1 min-w-[140px] max-w-[180px]">
            <DateInput value={from} onChange={setFrom} className="ui-input w-full" />
          </div>
          <span className="text-[#94A3B8] text-sm">{t('reports.to')}</span>
          <div className="flex items-center gap-2 flex-1 min-w-[140px] max-w-[180px]">
            <DateInput value={to} onChange={setTo} className="ui-input w-full" />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleExportPdf}
              disabled={exportingPdf}
              className="h-10 px-4 flex items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-white text-sm text-[#102F63] hover:bg-[#F6F8FC] disabled:opacity-50 whitespace-nowrap"
            >
              <FileText size={16} strokeWidth={1.75} />
              {exportingPdf ? t('reports.exporting') : t('reports.exportPdf')}
            </button>
            <button
              onClick={handleExportExcel}
              disabled={exportingExcel}
              className="h-10 px-4 flex items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-white text-sm text-[#102F63] hover:bg-[#F6F8FC] disabled:opacity-50 whitespace-nowrap"
            >
              <FileSpreadsheet size={16} strokeWidth={1.75} />
              {exportingExcel ? t('reports.exporting') : t('reports.exportExcel')}
            </button>
          </div>
      </div>
      {summary.error && <div className="ui-card p-4 mb-5 text-sm text-[#C4362B]" role="alert">{t('reports.loadError')}</div>}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <KpiCard icon={TrendingUp} label={t('reports.totalRevenue')} value={s ? formatMoney(s.totalRevenue, i18n.language) : '—'} suffix={t('common.currency')} />
        <KpiCard icon={Wallet} label={t('reports.totalCollected')} value={s ? formatMoney(s.totalCollected, i18n.language) : '—'} suffix={t('common.currency')} />
        <KpiCard icon={UsersRound} label={t('reports.newPatientsCount')} value={s ? s.newPatients : '—'} />
        <KpiCard icon={ClipboardList} label={t('reports.totalVisits')} value={s ? s.totalVisits : '—'} />
        <KpiCard icon={ReceiptText} label={t('reports.issuedInvoices')} value={s ? s.totalInvoices : '—'} />
        <KpiCard icon={CalendarDays} label={t('reports.appointmentCompletionRate')} value={s && typeof s.appointmentCompletionRate === 'number' && !isNaN(s.appointmentCompletionRate) ? `${s.appointmentCompletionRate}%` : '—'} />
      </div>

      {/* Main charts row */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* New Patients chart */}
        <div className="ui-card p-4">
          <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.newPatientsCount')}</h2>
          {newPatientsTimeseries.isLoading ? (
            <Skeleton className="h-52 rounded-lg" />
          ) : newPatientsTimeseries.data && newPatientsTimeseries.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={newPatientsTimeseries.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" name={t('reports.newPatientsCount')} stroke="#102F63" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title={t('reports.noDataInPeriod')} />
          )}
        </div>

        {/* Invoiced vs Collected chart */}
        <div className="ui-card p-4">
          <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.invoicedVsCollected')}</h2>
          {revenueTimeseries.isLoading ? (
            <Skeleton className="h-52 rounded-lg" />
          ) : revenueTimeseries.data && revenueTimeseries.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={revenueTimeseries.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="revenue" name={t('reports.revenue')} stroke="#16803C" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="collected" name={t('reports.collections')} stroke="#4B5694" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title={t('reports.noDataInPeriod')} />
          )}
        </div>
      </div>

      {/* Secondary widgets row */}
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        {/* Today's Appointment Exceptions */}
        <div className="ui-card p-4">
          <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.todayAppointmentExceptions')}</h2>
          {todayAppointmentExceptions.isLoading ? (
            <Skeleton className="h-36 rounded-lg" />
          ) : todayAppointmentExceptions.data && todayAppointmentExceptions.data.length > 0 ? (
            <>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {todayAppointmentExceptions.data.map((apt) => (
                  <div key={apt.id} className="flex items-center justify-between text-xs border-b border-[#E2E8F0] last:border-0 pb-2 last:pb-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[#1F2430] truncate">
                        {i18n.language === 'ar' ? apt.patientNameAr : apt.patientNameEn || apt.patientNameAr}
                      </div>
                      <div className="text-[#64748B]">{formatAppointmentTime(apt.scheduledAt)}</div>
                    </div>
                    <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-medium ${
                      apt.status === 'CANCELLED' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#FEE2E2] text-[#991B1B]'
                    }`}>
                      {apt.status === 'CANCELLED' ? t('appointments.statusCancelled') : t('appointments.statusNoShow')}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate('/appointments')}
                className="mt-3 text-xs text-[#102F63] hover:text-[#173B78] font-medium flex items-center gap-1"
              >
                {t('reports.viewAllAppointments')} →
              </button>
            </>
          ) : (
            <div className="text-xs text-[#94A3B8] text-center py-6">{t('reports.noTodayExceptions')}</div>
          )}
        </div>

        {/* Payment Methods */}
        <div className="ui-card p-4">
          <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.paymentMethods')}</h2>
          {paymentMethods.isLoading ? (
            <Skeleton className="h-36 rounded-lg" />
          ) : paymentMethods.data && paymentMethods.data.length > 0 ? (
            <>
              {(() => {
                const validMethods = paymentMethods.data.filter(row => row.method === 'LINK' || row.method === 'KNET');
                if (validMethods.length === 0) {
                  return <EmptyState title={t('reports.noPaymentsInPeriod')} />;
                }
                const totalPayments = validMethods.reduce((sum, m) => sum + m.amount, 0);
                return (
                  <>
                    <ResponsiveContainer width="100%" height={150}>
                      <PieChart>
                        <Pie data={validMethods} dataKey="amount" nameKey="method" innerRadius={35} outerRadius={60}>
                          {validMethods.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => `${formatMoney(v, i18n.language)} ${t('common.currency')}`} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1 mt-2">
                      {validMethods.map((row, i) => (
                        <div key={row.method} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                            {PAYMENT_METHOD_LABELS[row.method] || row.method}
                          </span>
                          <div className="text-right">
                            <span className="font-medium text-[#1F2430]">{formatMoney(row.amount, i18n.language)} {t('common.currency')}</span>
                            <span className="text-[#94A3B8] ml-1">({totalPayments > 0 ? ((row.amount / totalPayments) * 100).toFixed(1) : 0}%)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </>
          ) : (
            <EmptyState title={t('reports.noPaymentsInPeriod')} />
          )}
        </div>

        {/* Visit Types */}
        <div className="ui-card p-4">
          <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.visitTypesTitle')}</h2>
          {visitTypes.data && visitTypes.data.length > 0 ? (
            <div className="space-y-2">
              {visitTypes.data.map((row) => {
                const maxCount = Math.max(...visitTypes.data.map(r => r.count));
                const percentage = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
                return (
                  <div key={row.type} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#1F2430]">{VISIT_TYPE_LABELS[row.type] || row.type}</span>
                      <span className="font-medium text-[#102F63]">{row.count}</span>
                    </div>
                    <div className="h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#102F63] rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title={t('reports.noVisitsInPeriod')} />
          )}
        </div>
      </div>

      {/* Top Services table */}
      <div className="ui-card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-bold text-[#102F63]">{t('reports.topServicesByRevenue')}</h2>
          <button
            onClick={() => navigate('/services')}
            className="text-xs text-[#102F63] hover:text-[#173B78] font-medium flex items-center gap-1"
          >
            {t('reports.viewAllServices')} →
          </button>
        </div>
        {serviceUsage.isLoading ? (
          <Skeleton className="h-36 rounded-lg" />
        ) : serviceUsage.data && serviceUsage.data.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[#94A3B8] text-xs border-b border-[#E2E8F0]">
                <th className="text-right py-1.5 font-medium w-8">#</th>
                <th className="text-right py-1.5 font-medium">{t('invoices.service')}</th>
                <th className="text-center py-1.5 font-medium">{t('reports.timesUsed')}</th>
                <th className="text-left py-1.5 font-medium">{t('reports.revenue')} ({t('common.currency')})</th>
              </tr>
            </thead>
            <tbody>
              {serviceUsage.data.map((row, index) => (
                <tr key={row.serviceName} className="border-b border-[#E2E8F0] last:border-0">
                  <td className="py-2 text-[#64748B] text-xs">{index + 1}</td>
                  <td className="py-2 text-[#1F2430]">{row.serviceName}</td>
                  <td className="py-2 text-center text-[#64748B]">{row.timesUsed}</td>
                  <td className="py-2 text-left font-medium text-[#1F2430]">{formatMoney(row.revenue, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title={t('reports.noDataInPeriod')} />
        )}
      </div>

      <p className="text-xs text-[#94A3B8] text-center">{t('reports.footerNote')}</p>
    </div>
  );
}
