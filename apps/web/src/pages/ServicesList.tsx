import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Pencil, Trash2, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { servicesService, Service } from '../services/services.service';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../utils/dateFormat';
import { formatMoney } from '../utils/money';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import MobileRecordCard, { MobileRecordField } from '../components/MobileRecordCard';

export default function ServicesList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [isActiveFilter, setIsActiveFilter] = useState<boolean | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Service | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null);
  const limit = 20;

  const isAdmin = user?.role === 'ADMIN';

  const { showToast } = useToast();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['services', search, isActiveFilter, page],
    queryFn: () => servicesService.getServices(search, isActiveFilter, page, limit),
  });

  const services = data?.data || [];
  const meta = data?.meta;

  const handleToggleStatus = async (service: Service) => {
    try {
      await servicesService.updateServiceStatus(service.id, { isActive: !service.isActive });
      setConfirmDeactivate(null);
      refetch();
      showToast({ type: 'success', message: service.isActive ? t('feedback.serviceDeactivated') : t('feedback.serviceActivated') });
    } catch (err) {
      console.error('Failed to update service status:', err);
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('feedback.serviceStatusFailed') });
    }
  };
  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await servicesService.deleteServicePermanently(confirmDelete.id);
      setConfirmDelete(null);
      refetch();
      showToast({ type: 'success', message: t('feedback.serviceDeleted') });
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('feedback.serviceStatusFailed') });
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title={t('sidebar.services')}
        subtitle={t('services.subtitle')}
        breadcrumbs={[{ label: t('sidebar.services') }]}
        actions={isAdmin && (
          <button onClick={() => navigate('/services/new')} className="btn-primary flex items-center gap-2 px-4 py-2.5">
            <Plus size={18} strokeWidth={2} />
            {t('services.addNew')}
          </button>
        )}
      />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={17} strokeWidth={1.75} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('services.searchPlaceholder')}
            className="ui-input pr-10"
          />
        </div>
        <select
          value={isActiveFilter === undefined ? '' : String(isActiveFilter)}
          onChange={(e) => {
            const value = e.target.value;
            setIsActiveFilter(value === '' ? undefined : value === 'true');
            setPage(1);
          }}
          className="ui-input w-full sm:w-auto"
        >
          <option value="">{t('common.allStatuses')}</option>
          <option value="true">{t('services.statusActive')}</option>
          <option value="false">{t('services.statusInactive')}</option>
        </select>
      </div>

      {isLoading && (
        <div className="ui-card p-6 space-y-3">
          <Skeleton className="h-11 rounded-lg" count={6} />
        </div>
      )}

      {error && (
        <div className="ui-card p-6 text-center text-[#C4362B] text-sm">{t('services.loadError')}</div>
      )}

      {!isLoading && !error && services.length === 0 && (
        <div className="ui-card">
          <EmptyState title={search ? t('common.noSearchResults') : t('common.noDataAvailable')} description={t('common.emptyDescription')} />
        </div>
      )}

      {!isLoading && !error && services.length > 0 && (
        <div className="ui-card overflow-hidden p-0">
          <div className="mobile-record-list p-3 md:hidden">
            {services.map((service) => (
              <MobileRecordCard
                key={service.id}
                title={service.name}
                subtitle={service.description}
                actions={<span className="ui-badge" style={service.isActive ? { background: 'rgba(22,128,60,0.1)', color: 'var(--success)' } : { background: 'rgba(100,116,139,0.1)', color: 'var(--text-secondary)' }}>{service.isActive ? t('services.statusActive') : t('services.statusInactive')}</span>}
              >
                <MobileRecordField label={t('services.code')} value={service.code || '—'} />
                <MobileRecordField label={t('services.price')} value={`${formatMoney(service.currentPrice, i18n.language)} ${t('common.currency')}`} />
                <MobileRecordField label={t('services.updatedAt')} value={formatDate(service.updatedAt, i18n.language)} />
                {(isAdmin || user?.role === 'RECEPTIONIST') && (
                  <div className="flex gap-1 pt-1">
                    {isAdmin && <button onClick={() => navigate(`/services/${service.id}/edit`)} aria-label={t('services.editService')} className="icon-btn"><Pencil size={16} strokeWidth={1.75} /></button>}
                    {isAdmin && <button onClick={() => setConfirmDeactivate(service)} aria-label={service.isActive ? t('services.deactivateService') : t('services.activateService')} className="icon-btn danger"><Trash2 size={16} strokeWidth={1.75} /></button>}
                    <button onClick={() => setConfirmDelete(service)} aria-label={t('services.deletePermanently')} className="icon-btn danger"><Trash2 size={16} strokeWidth={1.75} /></button>
                  </div>
                )}
              </MobileRecordCard>
            ))}
          </div>
          <div className="hidden md:block">
          <table className="ui-table">
            <thead>
              <tr>
                <th>{t('services.name')}</th>
                <th>{t('services.code')}</th>
                <th>{t('services.price')} ({t('common.currency')})</th>
                <th>{t('common.status')}</th>
                <th>{t('services.updatedAt')}</th>
                {isAdmin && <th>{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id}>
                  <td>
                    <div className="font-medium text-[#1F2430]">{service.name}</div>
                    {service.description && <div className="text-xs text-[#94A3B8]">{service.description}</div>}
                  </td>
                  <td className="font-mono text-[#64748B]">{service.code || '—'}</td>
                  <td className="font-medium text-[#1F2430]">{formatMoney(service.currentPrice, i18n.language)}</td>
                  <td>
                    <span
                      className="ui-badge"
                      style={
                        service.isActive
                          ? { background: 'rgba(22,128,60,0.1)', color: 'var(--success)' }
                          : { background: 'rgba(100,116,139,0.1)', color: 'var(--text-secondary)' }
                      }
                    >
                      {service.isActive ? t('services.statusActive') : t('services.statusInactive')}
                    </span>
                  </td>
                  <td className="text-[#64748B]">{formatDate(service.updatedAt, i18n.language)}</td>
                  {(isAdmin || user?.role === 'RECEPTIONIST') && (
                    <td>
                      <div className="flex items-center gap-1.5">
                        {isAdmin && <button
                          onClick={() => navigate(`/services/${service.id}/edit`)}
                          aria-label={t('services.editService')}
                          className="icon-btn"
                        >
                          <Pencil size={16} strokeWidth={1.75} />
                        </button>}
                        {isAdmin && <button
                          onClick={() => setConfirmDeactivate(service)}
                          aria-label={service.isActive ? t('services.deactivateService') : t('services.activateService')}
                          className="icon-btn danger"
                        >
                          <Trash2 size={16} strokeWidth={1.75} />
                        </button>}
                        <button onClick={() => setConfirmDelete(service)} aria-label={t('services.deletePermanently')} className="icon-btn danger"><Trash2 size={16} strokeWidth={1.75} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
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
                  item: t('services.itemPlural'),
                })}
              </span>
              {meta.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-sm disabled:opacity-40"
                  >
                    {t('common.previous')}
                  </button>
                  <span className="text-sm text-[#102F63] font-medium">{meta.page} / {meta.totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                    disabled={page === meta.totalPages}
                    className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-sm disabled:opacity-40"
                  >
                    {t('common.next')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDeactivate}
        title={confirmDeactivate?.isActive ? t('services.deactivateService') : t('services.activateService')}
        message={confirmDeactivate
          ? (confirmDeactivate.isActive
            ? t('services.deactivateConfirm', { name: confirmDeactivate.name })
            : t('services.activateConfirm', { name: confirmDeactivate.name }))
          : ''}
        confirmLabel={confirmDeactivate?.isActive ? t('common.deactivate') : t('common.activate')}
        cancelLabel={t('common.cancel')}
        destructive={!!confirmDeactivate?.isActive}
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() => confirmDeactivate && handleToggleStatus(confirmDeactivate)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('services.deletePermanently')}
        message={t('services.deleteWarning')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
