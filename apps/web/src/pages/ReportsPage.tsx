import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import { TrendingUp, Wallet, ClipboardList, FileSpreadsheet, FileText, ClipboardCheck, ReceiptText } from 'lucide-react';
import { reportsService } from '../services/reports.service';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DateInput from '../components/DateInput';
import { formatMoney } from '../utils/money';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';

// Get local calendar date (YYYY-MM-DD) in Asia/Kuwait for the current day
function getLocalToday(): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function todayMinus(days: number): string {
  const todayStr = getLocalToday();
  const [y, m, d] = todayStr.split('-').map(Number);

  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function isValidDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    KNET: t('payments.methodKnet'),
    LINK: t('payments.methodLink'),
    OTHER: t('payments.methodOther'),
    CASH: t('payments.methodCash'),
    VISA: t('payments.methodVisa'),
  };

  // For the main report payment-method summary UI, display only: KNET, Link, OTHER
  const REPORT_PAYMENT_METHOD_LABELS: Record<string, string> = {
    KNET: 'KNET',
    LINK: 'Link',
    OTHER: 'Other',
  };
  const reportPaymentMethods = new Set(['KNET', 'LINK', 'OTHER']);
  const VISIT_TYPE_LABELS: Record<string, string> = {
    CHECKUP: t('visits.typeCheckup'), FOLLOW_UP: t('visits.typeFollowUp'), OTHER: t('visits.typeOther'),
  };

  const [defaultFrom] = useState(todayMinus(29));
  const [defaultTo] = useState(getLocalToday());
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const from = isValidDate(fromParam) ? fromParam : defaultFrom;
  const to = isValidDate(toParam) ? toParam : defaultTo;
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const updateDateRange = (nextFrom: string, nextTo: string) => {
    setSearchParams((current) => {
      current.set('from', nextFrom);
      current.set('to', nextTo);
      return current;
    });
  };

  const summary = useQuery({ queryKey: ['reports-summary', from, to], queryFn: () => reportsService.getSummary(from, to) });
  const revenueTimeseries = useQuery({ queryKey: ['reports-revenue-ts', from, to], queryFn: () => reportsService.getRevenueTimeseries(from, to) });
  const paymentMethods = useQuery({ queryKey: ['reports-payment-methods', from, to], queryFn: () => reportsService.getPaymentMethods(from, to) });
  const serviceUsage = useQuery({ queryKey: ['reports-service-usage', from, to], queryFn: () => reportsService.getServiceUsage(from, to) });
  const visitTypes = useQuery({ queryKey: ['reports-visit-types', from, to], queryFn: () => reportsService.getVisitTypes(from, to) });

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
            <DateInput value={from} onChange={(value) => updateDateRange(value, to)} className="ui-input w-full" />
          </div>
          <span className="text-[#94A3B8] text-sm">{t('reports.to')}</span>
          <div className="flex items-center gap-2 flex-1 min-w-[140px] max-w-[180px]">
            <DateInput value={to} onChange={(value) => updateDateRange(from, value)} className="ui-input w-full" />
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

      {/* Requires Attention - slim banner only when there are outstanding invoices */}
      {summary.data && summary.data.outstandingAmount > 0 && (
        <div className="ui-card p-3 mb-4 border-l-4 border-l-[#C4362B]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[13px] font-bold text-[#C4362B]">{t('reports.requiresAttention')}</h3>
              <p className="text-[11px] text-[#64748B] mt-0.5">
                {t('reports.outstandingInvoicesCount', { amount: formatMoney(summary.data.outstandingAmount) })}
              </p>
            </div>
            <button
              onClick={() => navigate('/invoices')}
              className="text-[11px] text-[#102F63] hover:text-[#173B78] font-medium"
            >
              {t('reports.viewInvoices')} →
            </button>
          </div>
        </div>
      )}

      {/* FOUR PRIMARY KPI CARDS ONLY */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard icon={TrendingUp} label={t('reports.totalInvoiced')} value={s ? formatMoney(s.totalRevenue, i18n.language) : '—'} suffix={t('common.currency')} />
        <KpiCard icon={Wallet} label={t('reports.totalCollected')} value={s ? formatMoney(s.totalCollected, i18n.language) : '—'} suffix={t('common.currency')} />
        <KpiCard icon={ReceiptText} label={t('reports.outstandingAmount')} value={s ? formatMoney(s.outstandingAmount, i18n.language) : '—'} suffix={t('common.currency')} />
        <KpiCard icon={ClipboardList} label={t('reports.totalVisits')} value={s ? s.totalVisits : '—'} />
      </div>

      {/* ONE PRIMARY CHART: Invoiced vs Collected */}
      <div className="ui-card p-4 mb-4">
        <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.invoicedVsCollected')}</h2>
        {revenueTimeseries.isLoading ? (
          <Skeleton className="h-52 rounded-lg" />
        ) : revenueTimeseries.data && revenueTimeseries.data.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
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

      {/* SECONDARY INFORMATION - compact sections */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        {/* Payment Methods - compact */}
        <div className="ui-card p-4">
          <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.paymentMethods')}</h2>
          {paymentMethods.isLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : paymentMethods.data && paymentMethods.data.length > 0 ? (
            (() => {
              // Allow KNET, LINK, OTHER (new methods) and historical CASH/VISA when they exist
              const validMethods = paymentMethods.data.filter(
                (row) => (row.amount > 0 || row.count > 0) && (
                  reportPaymentMethods.has(row.method) || // New methods: KNET, LINK, OTHER
                  row.method === 'CASH' || row.method === 'VISA' // Historical methods
                ),
              );
              if (validMethods.length === 0) {
                return <EmptyState title={t('reports.noPaymentsInPeriod')} />;
              }
              return (
                <div className="space-y-2">
                  {validMethods.map((row) => (
                    <div key={row.method} className="flex items-center justify-between text-sm">
                      <span className="text-[#1F2430]">{REPORT_PAYMENT_METHOD_LABELS[row.method] || PAYMENT_METHOD_LABELS[row.method] || row.method}</span>
                      <span className="font-medium text-[#102F63]">{formatMoney(row.amount, i18n.language)} {t('common.currency')}</span>
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            <EmptyState title={t('reports.noPaymentsInPeriod')} />
          )}
        </div>

        {/* Top Services - top 5 only, simple list */}
        <div className="ui-card p-4">
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
            <Skeleton className="h-24 rounded-lg" />
          ) : serviceUsage.data && serviceUsage.data.length > 0 ? (
            <div className="space-y-2">
              {serviceUsage.data.slice(0, 5).map((row, index) => (
                <div key={row.serviceName} className="flex items-center justify-between text-sm">
                  <span className="text-[#1F2430]">{index + 1}. {row.serviceName}</span>
                  <span className="font-medium text-[#102F63]">{formatMoney(row.revenue, i18n.language)} {t('common.currency')}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={t('reports.noDataInPeriod')} />
          )}
        </div>
      </div>

      {/* Visit Types - compact */}
      <div className="ui-card p-4 mb-4">
        <h2 className="text-[14px] font-bold text-[#102F63] mb-3">{t('reports.visitTypesTitle')}</h2>
        {visitTypes.data && visitTypes.data.length > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {visitTypes.data.map((row) => (
              <div key={row.type} className="text-center p-3 bg-[#F6F8FC] rounded-lg">
                <div className="text-xl font-bold text-[#102F63]">{row.count}</div>
                <div className="text-xs text-[#64748B] mt-1">{VISIT_TYPE_LABELS[row.type] || row.type}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t('reports.noVisitsInPeriod')} />
        )}
      </div>

      <p className="text-xs text-[#94A3B8] text-center">{t('reports.footerNote')}</p>
    </div>
  );
}
