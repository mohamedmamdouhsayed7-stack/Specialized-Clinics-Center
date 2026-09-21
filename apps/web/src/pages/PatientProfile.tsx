import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { patientsService } from '../services/patients.service';
import { ApiError } from '../services/api-error';
import { visitsService } from '../services/visits.service';
import { invoicesService } from '../services/invoices.service';
import { appointmentsService } from '../services/appointments.service';
import { paymentsService, Payment } from '../services/payments.service';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDateTime } from '../utils/dateFormat';
import { getReturnTo, preserveListState } from '../utils/listState';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import MobileRecordCard, { MobileRecordField } from '../components/MobileRecordCard';
import { formatMoney } from '../utils/money';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

type TabType = 'overview' | 'visits' | 'invoices' | 'payments' | 'appointments';

export default function PatientProfile() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, refreshAccessToken } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const patientsListReturnTo = getReturnTo(searchParams.toString(), '/patients');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const archiveMutation = useMutation({
    mutationFn: () => patientsService.archivePatient(id!),
    onSuccess: () => {
      setShowArchiveDialog(false);
      queryClient.invalidateQueries({ queryKey: ['patient', id] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      showToast({ type: 'success', message: t('feedback.patientArchived') });
    },
    onError: (archiveError: Error) => {
      showToast({ type: 'error', message: archiveError.message || t('feedback.patientArchiveFailed') });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      try {
        return await patientsService.deletePatientPermanently(id!);
      } catch (error) {
        // A tab can retain an access token invalidated by a refresh in another
        // tab. Recover once through the HttpOnly refresh cookie, then retry.
        if (error instanceof ApiError && error.status === 401) {
          await refreshAccessToken();
          return patientsService.deletePatientPermanently(id!);
        }
        throw error;
      }
    },
    onSuccess: () => {
      setShowDeleteDialog(false);
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      showToast({ type: 'success', message: t('feedback.patientDeleted') });
      navigate(patientsListReturnTo);
    },
    onError: (deleteError: Error) => {
      showToast({ type: 'error', message: deleteError.message });
    },
  });

  const { data: patient, isLoading, error } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => patientsService.getPatient(id!),
    enabled: !!id,
  });

  const { data: visitsData, isLoading: visitsLoading } = useQuery({
    queryKey: ['patientVisits', id],
    queryFn: () => visitsService.getPatientVisits(id!),
    enabled: !!id,
  });
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['patientInvoices', id],
    queryFn: () => invoicesService.getInvoices(id!, undefined, 1, 50),
    enabled: !!id,
  });
  const { data: appointmentsData, isLoading: appointmentsLoading } = useQuery({
    queryKey: ['patientAppointments', id],
    queryFn: () => appointmentsService.getAppointments(undefined, undefined, id!, 1, 50),
    enabled: !!id,
  });
  const { data: payments = [] } = useQuery<Payment[]>({
    queryKey: ['patientPayments', id, invoicesData?.data.map((invoice) => invoice.id)],
    queryFn: async () => {
      const invoices = invoicesData?.data || [];
      return (await Promise.all(invoices.map((invoice) => paymentsService.getPaymentsForInvoice(invoice.id)))).flat();
    },
    enabled: !!id && activeTab === 'payments' && !!invoicesData,
  });

  const visits = visitsData?.data || [];
  const outstandingAmount = (invoicesData?.data || [])
    .filter((invoice) => invoice.status === 'ISSUED')
    .reduce((total, invoice) => total + Number(invoice.remaining || 0), 0);
  const lastVisit = visits
    .filter((visit) => visit.visitDate)
    .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime())[0];
  const nextAppointment = (appointmentsData?.data || [])
    .filter((appointment) => new Date(appointment.scheduledAt).getTime() >= Date.now() && appointment.status !== 'CANCELLED')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F6F7FA]">
        <div className="container mx-auto px-4 py-8">
          <div className="ui-card p-6 space-y-3">
            <Skeleton className="h-8 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" count={2} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="min-h-screen bg-[#F6F7FA]">
        <div className="container mx-auto px-4 py-8">
          <div className="ui-card p-6 text-center text-[#C4362B] text-sm" role="alert">
            {t('patients.detailLoadError')}
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as TabType, label: t('patients.tabOverview') },
    { id: 'visits' as TabType, label: t('sidebar.visits') },
    { id: 'invoices' as TabType, label: t('sidebar.invoices') },
    { id: 'payments' as TabType, label: t('patients.tabPayments') },
    { id: 'appointments' as TabType, label: t('sidebar.appointments') },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7FA]">
      <div className="container mx-auto px-4 py-8">
        <PageHeader
          title={patient.fullNameAr}
          subtitle={patient.civilId || t('patients.civilIdMissing')}
          breadcrumbs={[{ label: t('sidebar.patients'), href: patientsListReturnTo }, { label: patient.fullNameAr }]}
          backTo={patientsListReturnTo}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile Panel (Right side in RTL) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-6 sticky top-8">
              {/* Unpaid Balance Warning */}
              {outstandingAmount > 0 && (
                <div className="mb-4 bg-orange-50 border border-orange-200 text-orange-700 px-4 py-2 rounded text-sm">
                  {t('patients.outstandingBalance')}: {formatMoney(outstandingAmount, i18n.language)} {t('common.currency')}
                </div>
              )}

              {/* Patient Name */}
              <h2 className="text-2xl font-bold text-[#111844] mb-4">{patient.fullNameAr}</h2>
              {patient.legacySource && (
                <div className="mb-4 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
                  {t('patients.legacyRecord')}
                </div>
              )}

              {/* Civil ID - Most Dominant */}
              <div className="mb-4">
                <label className="text-sm text-gray-500 block mb-1">{t('patients.civilId')}</label>
                <p className="text-xl font-bold text-[#111844]">{patient.civilId || t('patients.civilIdMissing')}</p>
              </div>

              {/* Phone */}
              {patient.phone && (
                <div className="mb-4">
                  <label className="text-sm text-gray-500 block mb-1">{t('patients.phone')}</label>
                  <p className="text-start text-gray-900">{patient.phone}</p>
                </div>
              )}

              {/* Date of Birth */}
              {patient.dateOfBirth && (
                <div className="mb-4">
                  <label className="text-sm text-gray-500 block mb-1">{t('patients.dobLabel')}</label>
                  <p className="text-start text-gray-900">
                    {formatDate(patient.dateOfBirth, i18n.language)}
                  </p>
                </div>
              )}

              {/* Address */}
              {patient.address && (
                <div className="mb-4">
                  <label className="text-sm text-gray-500 block mb-1">{t('patients.addressLabel')}</label>
                  <p className="text-start text-gray-900">{patient.address}</p>
                </div>
              )}

              {/* English Name */}
              {patient.fullNameEn && (
                <div className="mb-6">
                  <label className="text-sm text-gray-500 block mb-1">{t('patients.nameEnLabel')}</label>
                  <p className="text-start text-gray-900" dir="ltr">{patient.fullNameEn}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3">
                {/* + New Visit - Primary Action */}
                <button
                  onClick={() => navigate(preserveListState(`/visits/new?patientId=${patient.id}`, { pathname: `/patients/${patient.id}`, search: '' }))}
                  className="w-full py-3 bg-[#111844] text-white rounded-md hover:bg-[#1a237e] transition-colors font-medium"
                >
                  + {t('visits.newVisit')}
                </button>

                {/* Edit Patient */}
                <button
                  onClick={() => navigate(preserveListState(`/patients/${patient.id}/edit`, { pathname: `/patients/${patient.id}`, search: searchParams.toString() }))}
                  className="w-full py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                >
                  {t('patients.editData')}
                </button>
                {user?.role === 'ADMIN' && !patient.isArchived && (
                  <button
                    type="button"
                    onClick={() => setShowArchiveDialog(true)}
                    className="w-full rounded-md border border-red-200 bg-red-50 py-2 text-red-700 transition-colors hover:bg-red-100"
                  >
                    {t('patients.archivePatient')}
                  </button>
                )}
              </div>

              {/* Archive Status */}
              {patient.isArchived && (
                <div className="mt-4 bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-2 rounded text-sm">
                  {t('patients.archivedNotice')}
                </div>
              )}
              {(user?.role === 'ADMIN' || user?.role === 'RECEPTIONIST') && (
                <button type="button" onClick={() => setShowDeleteDialog(true)} className="mt-3 w-full rounded-md border border-red-300 bg-red-50 py-2 text-red-700 transition-colors hover:bg-red-100">
                  {t('patients.deletePermanently')}
                </button>
              )}
            </div>
            <ConfirmDialog
              open={showArchiveDialog}
              title={t('patients.archivePatient')}
              message={t('patients.archiveWarning')}
              confirmLabel={archiveMutation.isPending ? t('common.loading') : t('patients.confirmArchive')}
              cancelLabel={t('common.cancel')}
              destructive
              loading={archiveMutation.isPending}
              onConfirm={() => archiveMutation.mutate()}
              onCancel={() => setShowArchiveDialog(false)}
            />
            <ConfirmDialog
              open={showDeleteDialog}
              title={t('patients.deletePermanently')}
              message={t('patients.deleteWarning')}
              confirmLabel={deleteMutation.isPending ? t('common.loading') : t('patients.confirmPermanentDelete')}
              cancelLabel={t('common.cancel')}
              destructive
              loading={deleteMutation.isPending}
              onConfirm={() => deleteMutation.mutate()}
              onCancel={() => setShowDeleteDialog(false)}
            />
          </div>

          {/* Tabbed Content Area */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md">
              {/* Tabs */}
              <div className="border-b border-gray-200">
                <nav className="grid grid-cols-2 sm:flex sm:flex-wrap" aria-label={t('patients.sections')} role="tablist">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      id={`patient-tab-${tab.id}`}
                      role="tab"
                      aria-selected={activeTab === tab.id}
                      aria-controls={`patient-panel-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-3 text-sm font-medium transition-colors sm:px-6 sm:py-4 ${
                        activeTab === tab.id
                          ? 'text-[#111844] border-b-2 border-[#111844]'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Tab Content */}
              <div className="p-6">
                {activeTab === 'overview' && (
                  <div id="patient-panel-overview" role="tabpanel" aria-labelledby="patient-tab-overview" className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900">{t('patients.tabOverview')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-gray-50 p-4 rounded">
                        <p className="text-sm text-gray-500">{t('patients.lastVisit')}</p>
                        <p className="text-lg font-semibold text-gray-900">{visitsLoading ? t('common.loading') : lastVisit ? formatDateTime(lastVisit.visitDate, i18n.language) : '—'}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded">
                        <p className="text-sm text-gray-500">{t('patients.outstandingBalance')}</p>
                        <p className={`text-lg font-semibold ${outstandingAmount > 0 ? 'text-[#C4362B]' : 'text-[var(--success)]'}`}>
                          {invoicesLoading ? t('common.loading') : `${formatMoney(outstandingAmount, i18n.language)} ${t('common.currency')}`}
                        </p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded">
                        <p className="text-sm text-gray-500">{t('patients.nextVisit')}</p>
                        <p className="text-lg font-semibold text-gray-900">{appointmentsLoading ? t('common.loading') : nextAppointment ? formatDateTime(nextAppointment.scheduledAt, i18n.language) : '—'}</p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded">
                        <p className="text-sm text-gray-500">{t('patients.totalVisits')}</p>
                        <p className="text-lg font-semibold text-gray-900">{visitsLoading ? t('common.loading') : visits.length}</p>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'visits' && (
                  <div id="patient-panel-visits" role="tabpanel" aria-labelledby="patient-tab-visits">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">{t('patients.visitsHistory')}</h3>
                      <button
                        onClick={() => navigate(preserveListState(`/visits/new?patientId=${id}`, { pathname: `/patients/${id}`, search: '' }))}
                        className="px-4 py-2 bg-[#111844] text-white rounded-md hover:bg-[#1a237e] transition-colors text-sm"
                      >
                        + {t('visits.newVisit')}
                      </button>
                    </div>
                    {visits.length === 0 ? (
                      <EmptyState title={t('patients.noVisitsRecorded')} />
                    ) : (
                      <>
                      <div className="mobile-record-list md:hidden">
                        {visits.map((visit) => (
                          <MobileRecordCard
                            key={visit.id}
                            title={formatDateTime(visit.visitDate, i18n.language)}
                            subtitle={visit.notes || undefined}
                            onClick={() => navigate(preserveListState(`/visits/${visit.id}`, { pathname: `/patients/${patient.id}`, search: '' }))}
                          >
                            <MobileRecordField label={t('visits.type')} value={visit.type === 'CHECKUP' ? t('visits.typeCheckup') : visit.type === 'FOLLOW_UP' ? t('visits.typeFollowUp') : t('visits.typeOther')} />
                            <MobileRecordField label={t('sidebar.appointments')} value={visit.appointment ? formatDate(visit.appointment.scheduledAt, i18n.language) : '-'} />
                          </MobileRecordCard>
                        ))}
                      </div>
                      <div className="hidden md:block">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700">{t('common.date')}</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700">{t('visits.type')}</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700">{t('sidebar.appointments')}</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700">{t('visits.notesLabel')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {visits.map((visit) => (
                            <tr key={visit.id} onClick={() => navigate(preserveListState(`/visits/${visit.id}`, { pathname: `/patients/${patient.id}`, search: '' }))} className="cursor-pointer hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-900">
                                {formatDateTime(visit.visitDate, i18n.language)}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  visit.type === 'CHECKUP' ? 'bg-blue-100 text-blue-700' :
                                  visit.type === 'FOLLOW_UP' ? 'bg-green-100 text-green-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {visit.type === 'CHECKUP' ? t('visits.typeCheckup') :
                                   visit.type === 'FOLLOW_UP' ? t('visits.typeFollowUp') : t('visits.typeOther')}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-600">
                                {visit.appointment ? formatDate(visit.appointment.scheduledAt, i18n.language) : '-'}
                              </td>
                              <td className="px-4 py-3 text-gray-600 text-sm">
                                {visit.notes || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === 'invoices' && (
                  <div id="patient-panel-invoices" role="tabpanel" aria-labelledby="patient-tab-invoices">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('patients.invoicesHistory')}</h3>
                    {(invoicesData?.data || []).length === 0 ? <EmptyState title={t('patients.noInvoicesRecorded')} /> : (
                      <div className="space-y-2">{invoicesData?.data.map((invoice) => (
                        <button key={invoice.id} onClick={() => navigate(preserveListState(`/invoices/${invoice.id}`, { pathname: `/patients/${patient.id}`, search: '' }))} className="flex w-full flex-col gap-1 rounded bg-gray-50 p-3 text-start hover:bg-gray-100 sm:flex-row sm:items-center sm:justify-between">
                          <span className="font-medium">{invoice.invoiceNumber}</span><span>{formatDate(invoice.createdAt, i18n.language)} · {formatMoney(invoice.total, i18n.language)} {t('common.currency')}</span>
                        </button>
                      ))}</div>
                    )}
                  </div>
                )}

                {activeTab === 'payments' && (
                  <div id="patient-panel-payments" role="tabpanel" aria-labelledby="patient-tab-payments">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('patients.paymentsHistory')}</h3>
                    {payments.length === 0 ? <EmptyState title={t('patients.noPaymentsRecorded')} /> : (
                      <div className="space-y-2">{payments.map((payment) => (
                        <button key={payment.id} onClick={() => navigate(preserveListState(`/invoices/${payment.invoiceId}`, { pathname: `/patients/${patient.id}`, search: '' }))} className="flex w-full flex-col gap-1 rounded bg-gray-50 p-3 text-start hover:bg-gray-100 sm:flex-row sm:items-center sm:justify-between">
                          <span>{formatDate(payment.paymentDate, i18n.language)}</span><span className="font-semibold">{formatMoney(payment.amount, i18n.language)} {t('common.currency')}</span>
                        </button>
                      ))}</div>
                    )}
                  </div>
                )}

                {activeTab === 'appointments' && (
                  <div id="patient-panel-appointments" role="tabpanel" aria-labelledby="patient-tab-appointments">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('patients.appointmentsHistory')}</h3>
                    {(appointmentsData?.data || []).length === 0 ? <EmptyState title={t('patients.noAppointmentsRecorded')} /> : (
                      <div className="space-y-2">{appointmentsData?.data.map((appointment) => (
                        <button key={appointment.id} onClick={() => navigate(preserveListState(`/appointments/${appointment.id}`, { pathname: `/patients/${patient.id}`, search: '' }))} className="w-full flex justify-between p-3 bg-gray-50 rounded hover:bg-gray-100 text-start">
                          <span>{formatDateTime(appointment.scheduledAt, i18n.language)}</span><span>{appointment.status}</span>
                        </button>
                      ))}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
