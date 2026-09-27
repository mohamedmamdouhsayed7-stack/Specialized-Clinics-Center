import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { visitsService, CreateVisitDto } from '../services/visits.service';
import { patientsService } from '../services/patients.service';
import { appointmentsService } from '../services/appointments.service';
import { useTranslation } from 'react-i18next';
import { getReturnTo } from '../utils/listState';
import PageHeader from '../components/PageHeader';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { kuwaitDateTimeLocalToIso, toKuwaitDateTimeLocal } from '../utils/kuwaitDateTime';

const VISIT_TYPES = [
  { value: 'CHECKUP' as const, labelKey: 'visits.typeCheckup' },
  { value: 'FOLLOW_UP' as const, labelKey: 'visits.typeFollowUp' },
  { value: 'OTHER' as const, labelKey: 'visits.typeOther' },
];

export default function VisitForm() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const prefillPatientId = searchParams.get('patientId') || '';
  const prefillAppointmentId = searchParams.get('appointmentId') || '';
  const returnTo = getReturnTo(searchParams.toString(), prefillPatientId ? `/patients/${prefillPatientId}` : '/visits');
  const { showToast } = useToast();
  const [initialVisitDate] = useState(() => toKuwaitDateTimeLocal(new Date()));

  const [formData, setFormData] = useState<CreateVisitDto>({
    patientId: prefillPatientId,
    appointmentId: prefillAppointmentId,
    type: 'CHECKUP',
    visitDate: initialVisitDate,
    notes: '',
    diagnosis: '',
  });
  const [patientSearch, setPatientSearch] = useState('');
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const initialFormData = {
    patientId: prefillPatientId,
    appointmentId: prefillAppointmentId,
    type: 'CHECKUP',
    visitDate: initialVisitDate,
    notes: '',
    diagnosis: '',
  };
  const { confirmOpen, requestNavigation, stay, leave } = useUnsavedChanges(JSON.stringify(formData) !== JSON.stringify(initialFormData));

  // Search patients for typeahead
  const { data: patientsData } = useQuery({
    queryKey: ['patients', patientSearch],
    queryFn: () => patientsService.getPatients(patientSearch, false, 1, 10),
    enabled: patientSearch.length >= 2,
  });

  const patients = patientsData?.data || [];

  // If appointment is pre-filled, load it to get patient info
  const { data: appointmentData } = useQuery({
    queryKey: ['appointment', prefillAppointmentId],
    queryFn: () => appointmentsService.getAppointment(prefillAppointmentId),
    enabled: !!prefillAppointmentId,
  });

  // Pre-fill patient from appointment if available
  useEffect(() => {
    if (appointmentData && !prefillPatientId) {
      setFormData((prev) => ({ ...prev, patientId: appointmentData.patientId }));
      setPatientSearch(appointmentData.patient.fullNameAr);
    }
  }, [appointmentData, prefillPatientId]);

  const createMutation = useMutation({
    mutationFn: (data: CreateVisitDto) => visitsService.createVisit(data),
    onSuccess: (data) => {
      showToast({ type: 'success', message: t('feedback.visitCreated') });
      navigate(`/patients/${data.patientId}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error: Error) => {
      showToast({ type: 'error', message: error.message || t('visits.createError') });
      setErrors({ general: error.message || t('visits.createError') });
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.patientId) {
      newErrors.patientId = t('visits.patientRequired');
    }

    if (!formData.type) {
      newErrors.type = t('visits.typeRequired');
    }

    if (formData.visitDate) {
      const visitDate = new Date(formData.visitDate);
      if (isNaN(visitDate.getTime())) {
        newErrors.visitDate = t('visits.invalidDateTime');
      }
    }

    if (formData.notes && formData.notes.length > 1000) {
      newErrors.notes = t('visits.notesTooLong');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const { appointmentId, ...visitData } = formData;
    createMutation.mutate({
      ...visitData,
      visitDate: visitData.visitDate ? kuwaitDateTimeLocalToIso(visitData.visitDate) : visitData.visitDate,
      ...(appointmentId ? { appointmentId } : {}),
      type: VISIT_TYPES.find((visitType) => visitType.value === formData.type)?.value || 'CHECKUP',
    });
  };

  const handlePatientSelect = (patientId: string, patientName: string) => {
    setFormData((prev) => ({ ...prev, patientId }));
    setPatientSearch(patientName);
    setShowPatientDropdown(false);
  };

  const handleCancel = () => {
    requestNavigation(() => navigate(returnTo));
  };

  return (
    <div className="min-h-screen bg-[#F6F7FA] dir-rtl">
      <div className="container mx-auto px-4 py-5 sm:py-8">
        <PageHeader
          title={t('visits.newVisit')}
          breadcrumbs={[{ label: t('sidebar.visits'), href: returnTo }, { label: t('visits.newVisit') }]}
          backTo={returnTo}
          onBack={() => requestNavigation(() => navigate(returnTo))}
          actions={<button onClick={handleCancel} className="btn-primary px-4 py-2">{t('common.cancel')}</button>}
        />

        {/* Form */}
        <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-md sm:p-6">
          {errors.general && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Patient Selection */}
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('visits.patient')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={patientSearch}
                onChange={(e) => {
                  setPatientSearch(e.target.value);
                  setShowPatientDropdown(true);
                }}
                onBlur={validateForm}
                onFocus={() => setShowPatientDropdown(true)}
                placeholder={t('visits.patientSearchPlaceholder')}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${
                  errors.patientId ? 'border-red-500' : 'border-gray-300'
                }`}
                disabled={!!prefillPatientId}
              />
              {errors.patientId && (
                <p className="mt-1 text-sm text-red-600">{errors.patientId}</p>
              )}

              {/* Patient Dropdown */}
              {showPatientDropdown && patients.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {patients.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      onClick={() => handlePatientSelect(patient.id, patient.fullNameAr)}
                      className="w-full px-4 py-3 text-right hover:bg-gray-100 border-b border-gray-100 last:border-b-0"
                    >
                      <div className="font-medium text-gray-900">{patient.fullNameAr}</div>
                      <div className="text-sm text-gray-500">
                        {patient.civilId} {patient.phone && `• ${patient.phone}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Visit Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('visits.type')} <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value as 'CHECKUP' | 'FOLLOW_UP' | 'OTHER' }))}
                onBlur={validateForm}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${
                  errors.type ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                {VISIT_TYPES.map((visitType) => (
                  <option key={visitType.value} value={visitType.value}>{t(visitType.labelKey)}</option>
                ))}
              </select>
              {errors.type && (
                <p className="mt-1 text-sm text-red-600">{errors.type}</p>
              )}
            </div>

            {/* Date and Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('visits.dateTimeLabel')}
              </label>
              <input
                type="datetime-local"
                value={formData.visitDate || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, visitDate: e.target.value }))}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${
                  errors.visitDate ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.visitDate && (
                <p className="mt-1 text-sm text-red-600">{errors.visitDate}</p>
              )}
            </div>

            {prefillAppointmentId && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-sm font-medium text-gray-700">
                  {t('visits.linkedAppointment')}
                </div>
                <p className="mt-1 text-sm text-gray-500">{t('visits.appointmentAutoLinked')}</p>
              </div>
            )}

            {/* Diagnosis */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('visits.diagnosisLabel')}
              </label>
              <input
                type="text"
                value={formData.diagnosis}
                onChange={(e) => setFormData((prev) => ({ ...prev, diagnosis: e.target.value }))}
                maxLength={500}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844]"
                placeholder={t('visits.diagnosisPlaceholder')}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('visits.notesLabel')}
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                maxLength={1000}
                rows={3}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${
                  errors.notes ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder={t('visits.notesPlaceholder')}
              />
              {errors.notes && (
                <p className="mt-1 text-sm text-red-600">{errors.notes}</p>
              )}
            </div>

            {/* Submit Buttons */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-4">
              <button
                type="button"
                onClick={handleCancel}
                className="w-full rounded-md bg-gray-200 px-6 py-2 text-gray-700 transition-colors hover:bg-gray-300 sm:w-auto"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full rounded-md bg-[#111844] px-6 py-2 text-white transition-colors hover:bg-[#1a237e] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {createMutation.isPending ? t('common.saving') : t('visits.saveVisit')}
              </button>
            </div>
          </form>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          title={t('common.unsavedChangesTitle')}
          message={t('common.unsavedChangesMessage')}
          confirmLabel={t('common.leave')}
          cancelLabel={t('common.stay')}
          destructive
          onConfirm={() => leave(() => navigate(returnTo))}
          onCancel={stay}
        />
      </div>
    </div>
  );
}
