import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import { useToast } from '../contexts/ToastContext';
import { invoicesService } from '../services/invoices.service';
import { patientsService } from '../services/patients.service';
import { servicesService } from '../services/services.service';

export default function TelephoneConsultationForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const patientsQuery = useQuery({
    queryKey: ['patients', 'telephone-consultation', patientSearch],
    queryFn: () => patientsService.getPatients(patientSearch, false, 1, 20),
    enabled: patientSearch.trim().length >= 2,
  });
  const servicesQuery = useQuery({ queryKey: ['services', 'active'], queryFn: () => servicesService.getActiveServices() });
  const mutation = useMutation({
    mutationFn: () => invoicesService.createTelephoneConsultation({ patientId, items: [{ serviceId, quantity }] }),
    onSuccess: (invoice) => {
      showToast({ type: 'success', message: t('telephoneConsultation.draftCreated') });
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (error: Error) => showToast({ type: 'error', message: error.message }),
  });
  const patients = (patientsQuery.data?.data || []).filter((patient) => !patient.isArchived);
  const services = servicesQuery.data?.data || [];

  return <div className="page-container">
    <PageHeader title={t('telephoneConsultation.title')} breadcrumbs={[{ label: t('sidebar.invoices'), href: '/invoices' }, { label: t('telephoneConsultation.title') }]} />
    <div className="ui-card max-w-2xl space-y-5 p-6">
      <p className="rounded bg-blue-50 p-3 text-sm text-blue-900">{t('telephoneConsultation.noAttendance')}</p>
      <label className="block text-sm font-medium">{t('visits.patient')}
        {patientId ? <div className="mt-1 flex items-center justify-between rounded border p-3">
          <span>{patients.find((patient) => patient.id === patientId)?.fullNameAr || patientSearch}</span>
          <button type="button" className="text-blue-700" onClick={() => { setPatientId(''); setPatientSearch(''); }}>{t('common.change')}</button>
        </div> : <>
          <input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" placeholder={t('visits.patientSearchPlaceholder')} />
          <div className="mt-1 max-h-48 overflow-auto rounded border">
            {patients.map((patient) => <button key={patient.id} type="button" onClick={() => { setPatientId(patient.id); setPatientSearch(patient.fullNameAr); }} className="block w-full border-b p-2 text-right hover:bg-gray-50">
              {patient.fullNameAr}{patient.civilId ? ` · ${patient.civilId}` : ''}
            </button>)}
          </div>
        </>}
      </label>
      <label className="block text-sm font-medium">{t('invoices.service')}
        <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2">
          <option value="">{t('common.select')}</option>
          {services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.currentPrice} {t('common.currency')}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">{t('invoices.quantity')}
        <input type="number" min={1} max={1000} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-1 w-full rounded border px-3 py-2" />
      </label>
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary px-4 py-2" onClick={() => navigate('/invoices')}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary px-4 py-2" disabled={!patientId || !serviceId || !Number.isInteger(quantity) || quantity < 1 || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? t('common.saving') : t('telephoneConsultation.createDraft')}
        </button>
      </div>
    </div>
  </div>;
}
