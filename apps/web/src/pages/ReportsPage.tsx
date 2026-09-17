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

function KpiCard({ icon: Icon, label, value, suffix }: { icon: typeof TrendingUp; label: string; value: string | number; suffix?: string }) {
  return (
    <div className="ui-card p-4">
      <div className="flex items-center gap-2 text-[#64748B] text-xs mb-2">
        <Icon size={15} strokeWidth={1.75} />
        {label}
      </div>
      <div className="text-xl font-bold text-[#102F63]">
        {value}{suffix && <span className="text-sm text-[#94A3B8] font-normal"> {suffix}</span>}
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
  const PAYMENT_STATUS_LABELS: Record<string, string> = {
    UNPAID: t('invoices.unpaid'), PARTIALLY_PAID: t('invoices.partiallyPaid'), PAID: t('invoices.paidInFull'),
  };
  const VISIT_TYPE_LABELS: Record<string, string> = {
    CHECKUP: t('visits.typeCheckup'), FOLLOW_UP: t('visits.typeFollowUp'), OTHER: t('visits.typeOther'),
  };
  const APPT_STATUS_LABELS: Record<string, string> = {
    BOOKED: t('appointments.statusBooked'), CONFIRMED: t('appointments.statusConfirmed'), DONE: t('appointments.statusDone'),
    CANCELLED: t('appointments.statusCancelled'), NO_SHOW: t('appointments.statusNoShow'),
  };

  const [from, setFrom] = useState(todayMinus(29));
  const [to, setTo] = useState(getLocalToday());
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const summary = useQuery({ queryKey: ['reports-summary', from, to], queryFn: () => reportsService.getSummary(from, to) });
  const revenueTimeseries = useQuery({ queryKey: ['reports-revenue-ts', from, to], queryFn: () => reportsService.getRevenueTimeseries(from, to) });
  const paymentMethods = useQuery({ queryKey: ['reports-payment-methods', from, to], queryFn: () => reportsService.getPaymentMethods(from, to) });
  const invoiceStatus = useQuery({ queryKey: ['reports-invoice-status', from, to], queryFn: () => reportsService.getInvoiceStatusBreakdown(from, to) });
  const serviceUsage = useQuery({ queryKey: ['reports-service-usage', from, to], queryFn: () => reportsService.getServiceUsage(from, to) });
  const visitTypes = useQuery({ queryKey: ['reports-visit-types', from, to], queryFn: () => reportsService.getVisitTypes(from, to) });
  const appointmentStatus = useQuery({ queryKey: ['reports-appt-status', from, to], queryFn: () => reportsService.getAppointmentStatus(from, to) });
  const newPatientsTimeseries = useQuery({ queryKey: ['reports-new-patients-ts', from, to], queryFn: () => reportsService.getNewPatientsTimeseries(from, to) });

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
      <div className="flex flex-wrap items-center gap-2 mb-6">
          <DateInput value={from} onChange={setFrom} className="ui-input w-auto" />
          <span className="text-[#94A3B8] text-sm">{t('reports.to')}</span>
          <DateInput value={to} onChange={setTo} className="ui-input w-auto" />
          <button
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="h-11 px-4 flex items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-white text-sm text-[#102F63] hover:bg-[#F6F8FC] disabled:opacity-50"
          >
            <FileText size={16} strokeWidth={1.75} />
            {exportingPdf ? t('reports.exporting') : t('reports.exportPdf')}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={exportingExcel}
            className="h-11 px-4 flex items-center gap-2 rounded-[10px] border border-[#E2E8F0] bg-white text-sm text-[#102F63] hover:bg-[#F6F8FC] disabled:opacity-50"
          >
            <FileSpreadsheet size={16} strokeWidth={1.75} />
            {exportingExcel ? t('reports.exporting') : t('reports.exportExcel')}
          </button>
      </div>
      {summary.error && <div className="ui-card p-4 mb-5 text-sm text-[#C4362B]" role="alert">{t('reports.loadError')}</div>}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard icon={TrendingUp} label={t('reports.totalRevenue')} value={s ? formatMoney(s.totalRevenue, i18n.language) : '—'} suffix={t('common.currency')} />
        <KpiCard icon={Wallet} label={t('reports.totalCollected')} value={s ? formatMoney(s.totalCollected, i18n.language) : '—'} suffix={t('common.currency')} />
        <KpiCard icon={UsersRound} label={t('reports.newPatientsCount')} value={s ? s.newPatients : '—'} />
        <KpiCard icon={ClipboardList} label={t('reports.totalVisits')} value={s ? s.totalVisits : '—'} />
        <KpiCard icon={ReceiptText} label={t('reports.issuedInvoices')} value={s ? s.totalInvoices : '—'} />
        <KpiCard icon={CalendarDays} label={t('reports.appointmentCompletionRate')} value={s ? `${s.appointmentCompletionRate}%` : '—'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        {/* Revenue chart */}
        <div className="ui-card p-5 lg:col-span-2">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.invoicedVsCollected')}</h2>
          {revenueTimeseries.isLoading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : revenueTimeseries.data && revenueTimeseries.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={revenueTimeseries.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
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

        {/* Payment methods donut */}
        <div className="ui-card p-5">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.paymentMethods')}</h2>
          {paymentMethods.isLoading ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : paymentMethods.data && paymentMethods.data.length > 0 ? (
            <>
              {(() => {
                const validMethods = paymentMethods.data.filter(row => row.method === 'LINK' || row.method === 'KNET');
                if (validMethods.length === 0) {
                  return <EmptyState title={t('reports.noPaymentsInPeriod')} />;
                }
                return (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={validMethods} dataKey="amount" nameKey="method" innerRadius={45} outerRadius={75}>
                          {validMethods.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => `${formatMoney(v, i18n.language)} ${t('common.currency')}`} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5 mt-2">
                      {validMethods.map((row, i) => (
                        <div key={row.method} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                            {PAYMENT_METHOD_LABELS[row.method] || row.method}
                          </span>
                          <span className="font-medium text-[#1F2430]">{formatMoney(row.amount, i18n.language)} {t('common.currency')}</span>
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
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        {/* Service usage table */}
        <div className="ui-card p-5 lg:col-span-2 overflow-x-auto">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.topServicesByRevenue')}</h2>
          {serviceUsage.isLoading ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : serviceUsage.data && serviceUsage.data.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#94A3B8] text-xs border-b border-[#E2E8F0]">
                  <th className="text-right py-2 font-medium">{t('invoices.service')}</th>
                  <th className="text-center py-2 font-medium">{t('reports.timesUsed')}</th>
                  <th className="text-left py-2 font-medium">{t('reports.revenue')} ({t('common.currency')})</th>
                </tr>
              </thead>
              <tbody>
                {serviceUsage.data.map((row) => (
                  <tr key={row.serviceName} className="border-b border-[#E2E8F0] last:border-0">
                    <td className="py-2.5 text-[#1F2430]">{row.serviceName}</td>
                    <td className="py-2.5 text-center text-[#64748B]">{row.timesUsed}</td>
                    <td className="py-2.5 text-left font-medium text-[#1F2430]">{formatMoney(row.revenue, i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title={t('reports.noDataInPeriod')} />
          )}
        </div>

        {/* Payment Exceptions */}
        <div className="ui-card p-5">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.paymentExceptions')}</h2>
          {invoiceStatus.isLoading ? (
            <Skeleton className="h-48 rounded-lg" />
          ) : invoiceStatus.data ? (
            <>
              <div className="space-y-2">
                {invoiceStatus.data
                  .filter(row => row.paymentStatus !== 'PAID')
                  .map((row) => (
                    <div key={row.paymentStatus} className="flex items-center justify-between text-sm border-b border-[#E2E8F0] last:border-0 pb-2 last:pb-0">
                      <span className="text-[#1F2430]">{PAYMENT_STATUS_LABELS[row.paymentStatus] || row.paymentStatus}</span>
                      <span className="font-medium text-[#C4362B]">{row.count}</span>
                    </div>
                  ))}
                {invoiceStatus.data.filter(row => row.paymentStatus !== 'PAID').length === 0 && (
                  <div className="text-sm text-[#94A3B8] text-center py-4">{t('reports.noPaymentExceptions')}</div>
                )}
              </div>
            </>
          ) : (
            <EmptyState title={t('reports.noInvoicesInPeriod')} />
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        {/* Visit types */}
        <div className="ui-card p-5">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.visitTypesTitle')}</h2>
          {visitTypes.data && visitTypes.data.length > 0 ? (
            <div className="space-y-2">
              {visitTypes.data.map((row) => (
                <div key={row.type} className="flex items-center justify-between text-sm">
                  <span className="text-[#1F2430]">{VISIT_TYPE_LABELS[row.type] || row.type}</span>
                  <span className="font-medium text-[#102F63]">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={t('reports.noVisitsInPeriod')} />
          )}
        </div>

        {/* Appointment status */}
        <div className="ui-card p-5">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.appointmentStatusTitle')}</h2>
          {appointmentStatus.data && appointmentStatus.data.length > 0 ? (
            <div className="space-y-2">
              {appointmentStatus.data.map((row) => (
                <div key={row.status} className="flex items-center justify-between text-sm">
                  <span className="text-[#1F2430]">{APPT_STATUS_LABELS[row.status] || row.status}</span>
                  <span className="font-medium text-[#102F63]">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={t('reports.noAppointmentsInPeriod')} />
          )}
        </div>

        {/* Smart Insights */}
        <div className="ui-card p-5">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.insights')}</h2>
          {summary.data && paymentMethods.data ? (
            <div className="space-y-3 text-sm">
              {serviceUsage.data && serviceUsage.data.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[#64748B]">•</span>
                  <span className="text-[#1F2430]">
                    {t('reports.topService')}: {serviceUsage.data[0].serviceName} ({formatMoney(serviceUsage.data[0].revenue, i18n.language)} {t('common.currency')})
                  </span>
                </div>
              )}
              {(() => {
                const validMethods = paymentMethods.data.filter(m => m.method === 'LINK' || m.method === 'KNET');
                const totalPayments = validMethods.reduce((sum, m) => sum + m.amount, 0);
                if (totalPayments > 0 && validMethods.length > 0) {
                  const linkMethod = validMethods.find(m => m.method === 'LINK');
                  const knetMethod = validMethods.find(m => m.method === 'KNET');
                  const linkShare = linkMethod ? ((linkMethod.amount / totalPayments) * 100).toFixed(1) : 0;
                  const knetShare = knetMethod ? ((knetMethod.amount / totalPayments) * 100).toFixed(1) : 0;
                  return (
                    <div className="flex items-start gap-2">
                      <span className="text-[#64748B]">•</span>
                      <span className="text-[#1F2430]">
                        {t('payments.methodLink')}: {linkShare}%, {t('payments.methodKnet')}: {knetShare}%
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
              {summary.data.appointmentCompletionRate > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[#64748B]">•</span>
                  <span className="text-[#1F2430]">
                    {t('reports.appointmentCompletionRate')}: {summary.data.appointmentCompletionRate}%
                  </span>
                </div>
              )}
              {summary.data.newPatients > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[#64748B]">•</span>
                  <span className="text-[#1F2430]">
                    {t('reports.newPatientsCount')}: {summary.data.newPatients}
                  </span>
                </div>
              )}
              {invoiceStatus.data && invoiceStatus.data.filter(row => row.paymentStatus !== 'PAID').length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[#C4362B]">⚠</span>
                  <span className="text-[#C4362B]">
                    {invoiceStatus.data.filter(row => row.paymentStatus !== 'PAID').reduce((sum, row) => sum + row.count, 0)} {t('reports.paymentExceptionsLower')}
                  </span>
                </div>
              )}
              {summary.data.totalRevenue > 0 && summary.data.totalCollected > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[#64748B]">•</span>
                  <span className="text-[#1F2430]">
                    {t('reports.totalCollected')}: {formatMoney(summary.data.totalCollected, i18n.language)} {t('common.currency')} ({summary.data.totalRevenue > 0 ? ((summary.data.totalCollected / summary.data.totalRevenue) * 100).toFixed(1) : 0}% of {t('reports.totalRevenue')})
                  </span>
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-32 rounded-lg" />
          )}
        </div>

        {/* New Patients Trend */}
        <div className="ui-card p-5">
          <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.newPatientsCount')}</h2>
          {newPatientsTimeseries.isLoading ? (
            <Skeleton className="h-48 rounded-lg" />
          ) : newPatientsTimeseries.data && newPatientsTimeseries.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={newPatientsTimeseries.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" name={t('reports.newPatientsCount')} stroke="#102F63" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title={t('reports.noDataInPeriod')} />
          )}
        </div>
      </div>

      <p className="text-xs text-[#94A3B8] text-center">{t('reports.footerNote')}</p>
    </div>
  );
}
