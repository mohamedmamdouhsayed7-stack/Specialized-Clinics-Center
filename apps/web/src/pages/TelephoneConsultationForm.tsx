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
  const [patientMode, setPatientMode] = useState<'existing' | 'manual'>('existing');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [serviceMode, setServiceMode] = useState<'existing' | 'manual'>('existing');
  const [serviceId, setServiceId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const patientsQuery = useQuery({
    queryKey: ['patients', 'telephone-consultation', patientSearch],
    queryFn: () => patientsService.getPatients(patientSearch, false, 1, 20),
    enabled: patientMode === 'existing' && patientSearch.trim().length >= 2,
  });
  const servicesQuery = useQuery({ queryKey: ['services', 'active'], queryFn: () => servicesService.getActiveServices(), enabled: serviceMode === 'existing' });
  const mutation = useMutation({
    mutationFn: () => invoicesService.createTelephoneConsultation({
      ...(patientMode === 'existing' ? { patientId } : { patientName: patientName.trim() }),
      items: [serviceMode === 'existing' ? { serviceId } : { serviceName: serviceName.trim(), unitPrice: Number(manualPrice) }],
    }),
    onSuccess: (invoice) => {
      showToast({ type: 'success', message: t('telephoneConsultation.draftCreated') });
      navigate(`/invoices/${invoice.id}`);
    },
    onError: () => showToast({ type: 'error', message: t('telephoneConsultation.createError') }),
  });
  const patients = (patientsQuery.data?.data || []).filter((patient) => !patient.isArchived);
  const services = servicesQuery.data?.data || [];
  const patientValid = patientMode === 'existing' ? Boolean(patientId) : Boolean(patientName.trim());
  const serviceValid = serviceMode === 'existing'
    ? Boolean(serviceId)
    : Boolean(serviceName.trim()) && manualPrice !== '' && Number.isFinite(Number(manualPrice)) && Number(manualPrice) >= 0;

  return <div className="page-container">
    <PageHeader title={t('telephoneConsultation.title')} breadcrumbs={[{ label: t('sidebar.invoices'), href: '/invoices' }, { label: t('telephoneConsultation.title') }]} />
    <div className="ui-card max-w-2xl space-y-5 p-6">
      <p className="rounded bg-blue-50 p-3 text-sm text-blue-900">{t('telephoneConsultation.noAttendance')}</p>
      <div>
        <label className="block text-sm font-medium">{t('visits.patient')}</label>
        <select value={patientMode} onChange={(event) => { setPatientMode(event.target.value as 'existing' | 'manual'); setPatientId(''); setPatientSearch(''); }} className="mt-1 w-full rounded border px-3 py-2">
          <option value="existing">{t('telephoneConsultation.existingPatient')}</option>
          <option value="manual">{t('telephoneConsultation.manualPatient')}</option>
        </select>
        {patientMode === 'existing' ? <>
          {patientId ? <div className="mt-2 flex items-center justify-between rounded border p-3">
            <span>{patients.find((patient) => patient.id === patientId)?.fullNameAr || patientSearch}</span>
            <button type="button" className="text-blue-700" onClick={() => { setPatientId(''); setPatientSearch(''); }}>{t('common.change')}</button>
          </div> : <>
            <input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} className="mt-2 w-full rounded border px-3 py-2" placeholder={t('visits.patientSearchPlaceholder')} />
            <div className="mt-1 max-h-48 overflow-auto rounded border">
              {patients.map((patient) => <button key={patient.id} type="button" onClick={() => { setPatientId(patient.id); setPatientSearch(patient.fullNameAr); }} className="block w-full border-b p-2 text-right hover:bg-gray-50">
                {patient.fullNameAr}{patient.civilId ? ` · ${patient.civilId}` : ''}
              </button>)}
            </div>
          </>}
        </> : <label className="mt-2 block text-sm font-medium">{t('telephoneConsultation.patientName')}
          <input value={patientName} onChange={(event) => setPatientName(event.target.value)} maxLength={200} className="mt-1 w-full rounded border px-3 py-2" />
        </label>}
      </div>
      <div>
        <label className="block text-sm font-medium">{t('invoices.service')}</label>
        <select value={serviceMode} onChange={(event) => { setServiceMode(event.target.value as 'existing' | 'manual'); setServiceId(''); setServiceName(''); setManualPrice(''); }} className="mt-1 w-full rounded border px-3 py-2">
          <option value="existing">{t('telephoneConsultation.existingService')}</option>
          <option value="manual">{t('telephoneConsultation.manualService')}</option>
        </select>
        {serviceMode === 'existing' ? <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="mt-2 w-full rounded border px-3 py-2">
          <option value="">{t('common.select')}</option>
          {services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.currentPrice} {t('common.currency')}</option>)}
        </select> : <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">{t('telephoneConsultation.serviceDescription')}
            <input value={serviceName} onChange={(event) => setServiceName(event.target.value)} maxLength={300} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="block text-sm font-medium">{t('telephoneConsultation.servicePrice')}
            <input type="number" min="0" step="0.01" value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
        </div>}
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary px-4 py-2" onClick={() => navigate('/invoices')}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary px-4 py-2" disabled={!patientValid || !serviceValid || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? t('common.saving') : t('telephoneConsultation.createDraft')}
        </button>
      </div>
    </div>
  </div>;
}
