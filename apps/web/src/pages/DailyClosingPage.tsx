import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Printer, Calendar, FileSpreadsheet } from 'lucide-react';
import { reportsService } from '../services/reports.service';
import { formatDate, formatDateTime } from '../utils/dateFormat';
import DateInput from '../components/DateInput';
import { formatMoney } from '../utils/money';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';

const PAYMENT_METHOD_KEYS: Record<string, string> = {
  KNET: 'payments.methodKnet',
  LINK: 'payments.methodLink',
  OTHER: 'payments.methodOther',
  CASH: 'payments.methodCash',
  VISA: 'payments.methodVisa',
};

// For the main report payment-method summary UI, display only: Cash, KNET, Link
const REPORT_PAYMENT_METHOD_LABELS: Record<string, string> = {
  KNET: 'KNET',
  LINK: 'Link',
  CASH: 'Cash',
};
const REPORT_PAYMENT_METHODS = new Set(['CASH', 'KNET', 'LINK']);

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

export default function DailyClosingPage() {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(getLocalToday());
  const [isExporting, setIsExporting] = useState(false);
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['daily-closing', date],
    queryFn: () => reportsService.getDailyClosing(date),
  });

  const handleExportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await reportsService.downloadExport('excel', date, date);
      showToast({ type: 'success', message: t('dailyClosing.exportSuccess') });
    } catch (exportError) {
      showToast({
        type: 'error',
        message: exportError instanceof Error ? exportError.message : t('dailyClosing.exportError'),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title={t('dailyClosing.title')}
        subtitle={t('dailyClosing.subtitle')}
        breadcrumbs={[{ label: t('sidebar.reports'), href: '/reports' }, { label: t('dailyClosing.title') }]}
        className="print:hidden"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Calendar size={16} strokeWidth={1.75} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" />
              <DateInput
                value={date}
                onChange={setDate}
                className="ui-input pr-10 w-auto"
              />
            </div>
            <button
              onClick={handleExportExcel}
              disabled={isExporting || !data}
              className="btn-secondary flex items-center gap-2 px-4 disabled:opacity-50"
            >
              <FileSpreadsheet size={17} strokeWidth={1.75} />
              {isExporting ? t('dailyClosing.exporting') : t('reports.exportExcel')}
            </button>
            <button
              onClick={() => window.print()}
              disabled={!data}
              className="btn-primary flex items-center gap-2 px-4 disabled:opacity-50"
            >
              <Printer size={17} strokeWidth={1.75} />
              {t('common.print')}
            </button>
          </div>
        }
      />

      {/* Print-only header */}
      <div className="hidden print:block mb-6 text-center">
        <h1 className="text-2xl font-bold text-[#102F63]">مركز العيادات التخصصية</h1>
        <p className="text-sm text-[#64748B]">Specialized Clinics Center</p>
        <h2 className="text-lg font-bold mt-3">{t('dailyClosing.title')}</h2>
        <p className="text-sm">{data ? formatDate(data.date, i18n.language) : ''}</p>
      </div>

      {isLoading && (
        <div className="ui-card p-6 space-y-3">
          <Skeleton className="h-16 rounded-lg" count={4} />
        </div>
      )}

      {error && <div className="ui-card p-6 text-center text-[#C4362B] text-sm">{t('dailyClosing.loadError')}</div>}

      {data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.todayVisits')}</div>
              <div className="text-xl font-bold text-[#102F63]">{data.visitsToday}</div>
            </div>
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.todayInvoices')}</div>
              <div className="text-xl font-bold text-[#102F63]">{data.invoiceCount}</div>
            </div>
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.totalInvoiced')}</div>
              <div className="text-xl font-bold text-[#102F63]">{formatMoney(data.totalInvoiced, i18n.language)} {t('common.currency')}</div>
            </div>
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.totalCollected')}</div>
              <div className="text-xl font-bold text-[var(--success)]">{formatMoney(data.totalCollected, i18n.language)} {t('common.currency')}</div>
            </div>
          </div>

          {/* Second KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('payments.methodKnet')}</div>
              <div className="text-xl font-bold text-[#102F63]">
                {formatMoney(data.paymentMethods.find(m => m.method === 'KNET')?.amount || 0, i18n.language)} {t('common.currency')}
              </div>
            </div>
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('payments.methodLink')}</div>
              <div className="text-xl font-bold text-[#102F63]">
                {formatMoney(data.paymentMethods.find(m => m.method === 'LINK')?.amount || 0, i18n.language)} {t('common.currency')}
              </div>
            </div>
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('payments.methodOther')}</div>
              <div className="text-xl font-bold text-[#102F63]">
                {formatMoney(data.paymentMethods.find(m => m.method === 'OTHER')?.amount || 0, i18n.language)} {t('common.currency')}
              </div>
            </div>
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.completedVisits')}</div>
              <div className="text-xl font-bold text-[var(--success)]">{data.completedVisits}</div>
            </div>
            <div className="ui-card p-4">
              <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.cancelledNoShow')}</div>
              <div className="text-xl font-bold text-[#C4362B]">{data.cancelledOrNoShowAppointments}</div>
            </div>
          </div>

          {/* Reconciliation section */}
          <div className="ui-card p-5 mb-6">
            <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('dailyClosing.reconciliation')}</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.expectedCollection')}</div>
                <div className="text-lg font-bold text-[#102F63]">{formatMoney(data.totalInvoiced, i18n.language)} {t('common.currency')}</div>
              </div>
              <div>
                <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.actualRecorded')}</div>
                <div className="text-lg font-bold text-[var(--success)]">{formatMoney(data.totalCollected, i18n.language)} {t('common.currency')}</div>
              </div>
              <div>
                <div className="text-xs text-[#64748B] mb-1">{t('dailyClosing.reconciliationDifference')}</div>
                <div className={`text-lg font-bold ${data.reconciliationDifference !== 0 ? 'text-[#C4362B]' : 'text-[#102F63]'}`}>
                  {data.reconciliationDifference !== 0 ? (data.reconciliationDifference > 0 ? '+' : '') : ''}{formatMoney(data.reconciliationDifference, i18n.language)} {t('common.currency')}
                </div>
              </div>
            </div>
            {data.reconciliationDifference !== 0 && (
              <div className="mt-3 text-xs text-[#C4362B] bg-[#FEF2F2] px-3 py-2 rounded">
                {t('dailyClosing.reconciliationNote')}
              </div>
            )}
          </div>

          {/* Payment methods breakdown */}
          <div className="ui-card p-5 mb-6">
            <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('reports.paymentMethods')}</h2>
            {(() => {
              const validMethods = data.paymentMethods.filter(
                (m) => (m.amount > 0 || m.count > 0) && REPORT_PAYMENT_METHODS.has(m.method),
              );
              if (validMethods.length === 0) {
                return <EmptyState title={t('reports.noPaymentsInPeriod')} />;
              }
              return (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {validMethods.map((m) => (
                    <div key={m.method} className="flex items-center justify-between text-sm border border-[#E2E8F0] rounded-lg px-3 py-2.5">
                      <span className="text-[#1F2430]">{REPORT_PAYMENT_METHOD_LABELS[m.method]}</span>
                      <span className="font-medium text-[#102F63]">{formatMoney(m.amount, i18n.language)} {t('common.currency')} ({m.count})</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Invoices list */}
          <div className="ui-card overflow-hidden p-0 mb-6">
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-[15px] font-bold text-[#102F63]">{t('dailyClosing.invoicesToday')}</h2>
            </div>
            {data.invoices.length === 0 ? (
              <EmptyState title={t('common.noDataAvailable')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="ui-table min-w-[680px]">
                  <thead>
                    <tr>
                      <th>{t('invoices.number')}</th>
                      <th>{t('visits.patient')}</th>
                      <th>{t('invoices.total')}</th>
                      <th>{t('invoices.paid')}</th>
                      <th>{t('invoices.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoices.map((inv) => {
                      const isException = inv.remaining > 0 || inv.paymentStatus !== 'PAID';
                      return (
                        <tr key={inv.id} className={isException ? 'bg-[#FEF2F2]' : ''}>
                          <td className="font-mono text-[#64748B]">{inv.invoiceNumber}</td>
                          <td className="text-[#1F2430]">{inv.patientName}</td>
                          <td>{formatMoney(inv.total, i18n.language)} {t('common.currency')}</td>
                          <td>{formatMoney(inv.paid, i18n.language)} {t('common.currency')}</td>
                          <td>
                            {isException ? (
                              <span className="text-[#C4362B] font-medium">
                                {inv.paymentStatus === 'UNPAID' ? t('dailyClosing.unpaid') : t('dailyClosing.partiallyPaid')}
                                {inv.remaining > 0 && ` (${formatMoney(inv.remaining, i18n.language)} ${t('common.currency')})`}
                              </span>
                            ) : (
                              <span className="text-[var(--success)]">{t('invoices.paidInFull')}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Payments list */}
          <div className="ui-card overflow-hidden p-0">
            <div className="px-5 pt-5 pb-3">
              <h2 className="text-[15px] font-bold text-[#102F63]">{t('dailyClosing.paymentsToday')}</h2>
            </div>
            {data.payments.length === 0 ? (
              <EmptyState title={t('payments.noPayments')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="ui-table min-w-[620px]">
                  <thead>
                    <tr>
                      <th>{t('invoices.number')}</th>
                      <th>{t('visits.patient')}</th>
                      <th>{t('payments.amount')}</th>
                      <th>{t('payments.method')}</th>
                      <th>{t('visits.time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="font-mono text-[#64748B]">{p.invoiceNumber}</td>
                        <td className="text-[#1F2430]">{p.patientName}</td>
                        <td>{formatMoney(p.amount, i18n.language)} {t('common.currency')}</td>
                        <td>{t(PAYMENT_METHOD_KEYS[p.method] || p.method)}</td>
                        <td className="text-[#64748B]">{formatDateTime(p.paymentDate, i18n.language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


