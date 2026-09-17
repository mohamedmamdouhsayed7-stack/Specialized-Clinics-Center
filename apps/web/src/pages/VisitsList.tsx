import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Eye, ReceiptText, CheckCircle2, Plus } from 'lucide-react';
import { visitsService, VisitStatus } from '../services/visits.service';
import { useTranslation } from 'react-i18next';
import { formatDate, formatTime } from '../utils/dateFormat';
import DateInput from '../components/DateInput';
import { preserveListState } from '../utils/listState';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import MobileRecordCard, { MobileRecordField } from '../components/MobileRecordCard';

function statusBadgeStyle(status: VisitStatus) {
  switch (status) {
    case 'COMPLETED':
      return { background: 'rgba(22,128,60,0.1)', color: 'var(--success)' };
    case 'IN_PROGRESS':
      return { background: 'rgba(23,59,120,0.1)', color: 'var(--brand-blue)' };
    case 'CANCELLED':
      return { background: 'rgba(196,54,43,0.1)', color: 'var(--danger)' };
    default:
      return { background: 'rgba(201,130,0,0.1)', color: 'var(--warning)' };
  }
}

// Mask civilId for privacy while showing first and last digits
// Handles null/empty civilId values safely
function maskCivilId(civilId: string | null | undefined): string {
  if (!civilId || civilId.length <= 2) return civilId || '—';
  return civilId[0] + 'X'.repeat(civilId.length - 2) + civilId[civilId.length - 1];
}

export default function VisitsList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState<VisitStatus | ''>((searchParams.get('status') as VisitStatus) || '');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || '');
  const [dateFilter, setDateFilter] = useState(searchParams.get('date') || '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const limit = 20;

  const STATUS_LABELS: Record<VisitStatus, string> = {
    SCHEDULED: t('visits.statusScheduled'),
    IN_PROGRESS: t('visits.statusInProgress'),
    COMPLETED: t('visits.statusCompleted'),
    CANCELLED: t('visits.statusCancelled'),
  };
  const TYPE_LABELS: Record<string, string> = {
    CHECKUP: t('visits.typeCheckup'),
    FOLLOW_UP: t('visits.typeFollowUp'),
    OTHER: t('visits.typeOther'),
  };

  const { data: counts } = useQuery({
    queryKey: ['visits-today-counts'],
    queryFn: () => visitsService.getTodayCounts(),
    refetchInterval: 60000,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['visits', search, statusFilter, typeFilter, dateFilter, page],
    queryFn: () =>
      visitsService.getVisits(
        undefined,
        undefined,
        typeFilter || undefined,
        (statusFilter || undefined) as VisitStatus | undefined,
        dateFilter || undefined,
        dateFilter || undefined,
        search || undefined,
        page,
        limit,
      ),
  });

  const visits = data?.data || [];
  const meta = data?.meta;

  const handleComplete = async (visitId: string) => {
    try {
      await visitsService.updateVisitStatus(visitId, 'COMPLETED');
      refetch();
    } catch (err) {
      console.error('Failed to complete visit:', err);
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title={t('sidebar.visits')}
        subtitle={t('visits.subtitle')}
        breadcrumbs={[{ label: t('sidebar.visits') }]}
        actions={
          <button onClick={() => navigate('/visits/new')} className="btn-primary flex items-center gap-2 px-4 py-2.5">
            <Plus size={18} strokeWidth={2} />
            {t('visits.registerNew')}
          </button>
        }
      />

      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          {[
            { label: t('visits.todayVisits'), value: counts.total, color: '#102F63' },
            { label: t('visits.statusScheduled'), value: counts.scheduled, color: 'var(--warning)' },
            { label: t('visits.statusInProgress'), value: counts.inProgress, color: 'var(--brand-blue)' },
            { label: t('visits.statusCompleted'), value: counts.completed, color: 'var(--success)' },
            { label: t('visits.statusCancelled'), value: counts.cancelled, color: 'var(--danger)' },
          ].map((c) => (
            <div key={c.label} className="ui-card p-4 text-center">
              <div className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</div>
              <div className="text-xs text-[#64748B] mt-1">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full flex-1 sm:min-w-[240px] sm:max-w-md">
          <Search size={17} strokeWidth={1.75} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); setSearchParams((current) => { current.set('search', e.target.value); current.set('page', '1'); return current; }); }}
            placeholder={t('visits.searchPlaceholder')}
            className="ui-input pr-10"
          />
        </div>
        <DateInput
          value={dateFilter}
          onChange={(v) => { setDateFilter(v); setPage(1); setSearchParams((current) => { if (v) current.set('date', v); else current.delete('date'); current.set('page', '1'); return current; }); }}
          className="ui-input w-full sm:w-auto"
          isClearable
        />
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); setSearchParams((current) => { if (e.target.value) current.set('type', e.target.value); else current.delete('type'); current.set('page', '1'); return current; }); }} className="ui-input w-full sm:w-auto">
          <option value="">{t('visits.allTypes')}</option>
          <option value="CHECKUP">{t('visits.typeCheckup')}</option>
          <option value="FOLLOW_UP">{t('visits.typeFollowUp')}</option>
          <option value="OTHER">{t('visits.typeOther')}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as VisitStatus | ''); setPage(1); setSearchParams((current) => { if (e.target.value) current.set('status', e.target.value); else current.delete('status'); current.set('page', '1'); return current; }); }}
          className="ui-input w-full sm:w-auto"
        >
          <option value="">{t('common.allStatuses')}</option>
          {(Object.keys(STATUS_LABELS) as VisitStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="ui-card p-6 space-y-3">
          <Skeleton className="h-11 rounded-lg" count={6} />
        </div>
      )}

      {error && <div className="ui-card p-6 text-center text-[#C4362B] text-sm">{t('visits.loadError')}</div>}

      {!isLoading && !error && visits.length === 0 && (
        <div className="ui-card">
          <EmptyState title={t('common.noDataAvailable')} description={t('common.emptyDescription')} />
        </div>
      )}

      {!isLoading && !error && visits.length > 0 && (
        <div className="ui-card overflow-hidden p-0">
          <div className="mobile-record-list p-3 md:hidden">
            {visits.map((visit) => {
              const invoice = visit.invoices?.[0];
              return (
                <MobileRecordCard
                  key={visit.id}
                  title={visit.patient.fullNameAr}
                  subtitle={`${formatDate(visit.visitDate, i18n.language)} · ${formatTime(visit.visitDate, i18n.language)}`}
                  actions={<span className="ui-badge" style={statusBadgeStyle(visit.status)}>{STATUS_LABELS[visit.status]}</span>}
                  onClick={() => navigate(preserveListState(`/visits/${visit.id}`, location))}
                >
                  <MobileRecordField label={t('patients.civilId')} value={maskCivilId(visit.patient.civilId)} />
                  <MobileRecordField label={t('visits.type')} value={TYPE_LABELS[visit.type]} />
                  <MobileRecordField label={t('visits.services')} value={invoice?.invoiceItems?.length ? invoice.invoiceItems.map((i) => i.serviceNameSnapshot).join(i18n.language === 'ar' ? '، ' : ', ') : '—'} />
                  <div className="flex flex-wrap gap-1 pt-1">
                    <button onClick={(event) => { event.stopPropagation(); navigate(preserveListState(`/visits/${visit.id}`, location)); }} aria-label={t('visits.viewDetails')} className="icon-btn"><Eye size={16} strokeWidth={1.75} /></button>
                    {invoice && <button onClick={(event) => { event.stopPropagation(); navigate(preserveListState(`/invoices/${invoice.id}`, location)); }} aria-label={t('visits.viewInvoice')} className="icon-btn"><ReceiptText size={16} strokeWidth={1.75} /></button>}
                    {(visit.status === 'SCHEDULED' || visit.status === 'IN_PROGRESS') && <button onClick={(event) => { event.stopPropagation(); handleComplete(visit.id); }} aria-label={t('visits.completeVisit')} className="icon-btn"><CheckCircle2 size={16} strokeWidth={1.75} /></button>}
                  </div>
                </MobileRecordCard>
              );
            })}
          </div>
          <div className="hidden md:block">
          <table className="ui-table">
            <thead>
              <tr>
                <th>{t('visits.time')}</th>
                <th>{t('visits.patient')}</th>
                <th>{t('patients.civilId')}</th>
                <th>{t('visits.type')}</th>
                <th>{t('visits.services')}</th>
                <th>{t('visits.invoice')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((visit) => {
                // A visit can have at most one invoice (enforced by the
                // backend), but the API returns it as an array (`invoices`).
                const invoice = visit.invoices?.[0];
                return (
                <tr key={visit.id}>
                  <td className="text-[#64748B]">
                    {formatTime(visit.visitDate, i18n.language)}
                    <div className="text-xs text-[#94A3B8]">{formatDate(visit.visitDate, i18n.language)}</div>
                  </td>
                  <td className="font-medium text-[#1F2430]">{visit.patient.fullNameAr}</td>
                  <td className="font-mono text-[#64748B]">{maskCivilId(visit.patient.civilId)}</td>
                  <td className="text-[#1F2430]">{TYPE_LABELS[visit.type]}</td>
                  <td className="text-[#64748B] text-sm">
                    {invoice?.invoiceItems?.length
                      ? invoice.invoiceItems.map((i) => i.serviceNameSnapshot).join(i18n.language === 'ar' ? '، ' : ', ')
                      : '—'}
                  </td>
                  <td className="text-[#64748B]">{invoice?.invoiceNumber || '—'}</td>
                  <td>
                    <span className="ui-badge" style={statusBadgeStyle(visit.status)}>
                      {STATUS_LABELS[visit.status]}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => navigate(preserveListState(`/visits/${visit.id}`, location))} aria-label={t('visits.viewDetails')} className="icon-btn">
                        <Eye size={16} strokeWidth={1.75} />
                      </button>
                      {invoice && (
                        <button onClick={() => navigate(preserveListState(`/invoices/${invoice.id}`, location))} aria-label={t('visits.viewInvoice')} className="icon-btn">
                          <ReceiptText size={16} strokeWidth={1.75} />
                        </button>
                      )}
                      {(visit.status === 'SCHEDULED' || visit.status === 'IN_PROGRESS') && (
                        <button onClick={() => handleComplete(visit.id)} aria-label={t('visits.completeVisit')} className="icon-btn">
                          <CheckCircle2 size={16} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {meta && (
            <div className="flex items-center justify-between px-5 py-4 border-t border-[#E2E8F0]">
              <span className="text-[13px] text-[#64748B]">
                {t('common.showingRange', {
                  from: (meta.page - 1) * meta.limit + 1,
                  to: Math.min(meta.page * meta.limit, meta.total),
                  total: meta.total,
                  item: t('visits.itemPlural'),
                })}
              </span>
              {meta.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => { const next = Math.max(1, p - 1); setSearchParams((current) => { current.set('page', String(next)); return current; }); return next; })} disabled={page === 1} className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-sm disabled:opacity-40">
                    {t('common.previous')}
                  </button>
                  <span className="text-sm text-[#102F63] font-medium">{meta.page} / {meta.totalPages}</span>
                  <button onClick={() => setPage((p) => { const next = Math.min(meta.totalPages, p + 1); setSearchParams((current) => { current.set('page', String(next)); return current; }); return next; })} disabled={page === meta.totalPages} className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-sm disabled:opacity-40">
                    {t('common.next')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
