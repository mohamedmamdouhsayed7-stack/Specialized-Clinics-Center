import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsService, CreateAppointmentDto, UpdateAppointmentDto } from '../services/appointments.service';
import { Patient, patientsService } from '../services/patients.service';
import { useTranslation } from 'react-i18next';
import DateInput from '../components/DateInput';
import TimeInput from '../components/TimeInput';
import { getReturnTo } from '../utils/listState';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { kuwaitDateTimeLocalToIso, toKuwaitDateTimeLocal } from '../utils/kuwaitDateTime';

export default function AppointmentForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  const prefillPatientId = searchParams.get('patientId') || '';
  const returnTo = getReturnTo(searchParams.toString(), '/appointments');
  const { showToast } = useToast();
  const [formData, setFormData] = useState<CreateAppointmentDto>({
    patientId: prefillPatientId,
    scheduledAt: '',
    notes: '',
  });
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [highlightedPatientIndex, setHighlightedPatientIndex] = useState(-1);
  const initialFormData = useMemo(() => ({ patientId: prefillPatientId, scheduledAt: '', notes: '' }), [prefillPatientId]);

  const { data: existingAppointment, isLoading: isLoadingAppointment } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => appointmentsService.getAppointment(id!),
    enabled: isEdit,
  });
  const baseline = existingAppointment
    ? { patientId: existingAppointment.patientId, scheduledAt: toKuwaitDateTimeLocal(existingAppointment.scheduledAt), notes: existingAppointment.notes || '' }
    : initialFormData;
  const isDirty = JSON.stringify(formData) !== JSON.stringify(baseline);
  const { confirmOpen, requestNavigation, stay, leave } = useUnsavedChanges(isDirty);

  useEffect(() => {
    if (!existingAppointment) return;
    const next = {
      patientId: existingAppointment.patientId,
      scheduledAt: toKuwaitDateTimeLocal(existingAppointment.scheduledAt),
      notes: existingAppointment.notes || '',
    };
    setFormData(next);
    setPatientSearch(existingAppointment.patient.fullNameAr);
    setSelectedPatient({
      id: existingAppointment.patient.id,
      civilId: existingAppointment.patient.civilId,
      fullNameAr: existingAppointment.patient.fullNameAr,
      phone: existingAppointment.patient.phone,
      isArchived: false,
      createdAt: '',
      updatedAt: '',
    });
  }, [existingAppointment]);

  const { data: prefilledPatient } = useQuery({
    queryKey: ['patient', prefillPatientId],
    queryFn: () => patientsService.getPatient(prefillPatientId),
    enabled: !isEdit && !!prefillPatientId,
  });

  useEffect(() => {
    if (prefilledPatient && !isEdit) {
      setPatientSearch(prefilledPatient.fullNameAr);
      setSelectedPatient(prefilledPatient);
      setFormData((previous) => ({ ...previous, patientId: prefilledPatient.id }));
    }
  }, [prefilledPatient, isEdit]);

  // Search patients for typeahead
  const { data: patientsData } = useQuery({
    queryKey: ['patients', patientSearch],
    queryFn: () => patientsService.getPatients(patientSearch, false, 1, 10),
    enabled: patientSearch.length >= 2,
  });

  const patients = (patientsData?.data || []).filter((patient) => !patient.isArchived);

  const saveMutation = useMutation({
    mutationFn: (data: CreateAppointmentDto | UpdateAppointmentDto) =>
      isEdit ? appointmentsService.updateAppointment(id!, data) : appointmentsService.createAppointment(data as CreateAppointmentDto),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      showToast({ type: 'success', message: t(isEdit ? 'feedback.appointmentUpdated' : 'feedback.appointmentCreated') });
      navigate(`/appointments/${data.id}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error: Error) => {
      showToast({ type: 'error', message: error.message || t('appointments.createError') });
      setErrors({ general: error.message || t('appointments.createError') });
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.patientId || !selectedPatient || selectedPatient.id !== formData.patientId) {
      newErrors.patientId = t('visits.patientRequired');
    } else if (selectedPatient?.isArchived) {
      newErrors.patientId = t('appointments.patientArchived');
    }

    if (!formData.scheduledAt) {
      newErrors.scheduledAt = t('appointments.dateTimeRequired');
    } else {
      const scheduledDate = new Date(formData.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        newErrors.scheduledAt = t('visits.invalidDateTime');
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

    saveMutation.mutate({ ...formData, scheduledAt: kuwaitDateTimeLocalToIso(formData.scheduledAt) });
  };

  const handlePatientSelect = (patient: Patient) => {
    if (patient.isArchived) {
      setErrors((previous) => ({ ...previous, patientId: t('appointments.patientArchived') }));
      return;
    }
    setFormData((prev) => ({ ...prev, patientId: patient.id }));
    setSelectedPatient(patient);
    setPatientSearch(patient.fullNameAr);
    setShowPatientDropdown(false);
    setHighlightedPatientIndex(-1);
    setErrors((previous) => ({ ...previous, patientId: '' }));
  };

  const handleCancel = () => {
    requestNavigation(() => navigate(returnTo));
  };

  const handlePatientSearchChange = (value: string) => {
    setPatientSearch(value);
    setShowPatientDropdown(true);
    setHighlightedPatientIndex(-1);
    setErrors((previous) => ({ ...previous, patientId: '' }));
    if (!selectedPatient || value.trim() !== selectedPatient.fullNameAr) {
      setSelectedPatient(null);
      setFormData((previous) => ({ ...previous, patientId: '' }));
    }
  };

  const handlePatientKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && patients.length > 0) {
      event.preventDefault();
      setShowPatientDropdown(true);
      setHighlightedPatientIndex((previous) => Math.min(previous + 1, patients.length - 1));
    } else if (event.key === 'ArrowUp' && patients.length > 0) {
      event.preventDefault();
      setHighlightedPatientIndex((previous) => Math.max(previous - 1, 0));
    } else if (event.key === 'Enter' && highlightedPatientIndex >= 0 && patients[highlightedPatientIndex]) {
      event.preventDefault();
      handlePatientSelect(patients[highlightedPatientIndex]);
    } else if (event.key === 'Escape') {
      setShowPatientDropdown(false);
      setHighlightedPatientIndex(-1);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7FA]">
      <div className="container mx-auto px-4 py-5 sm:py-8">
        <PageHeader
          title={t(isEdit ? 'appointments.editAppointment' : 'appointments.newAppointment')}
          breadcrumbs={[{ label: t('sidebar.appointments'), href: returnTo }, { label: t(isEdit ? 'appointments.editAppointment' : 'appointments.newAppointment') }]}
          backTo={returnTo}
          onBack={() => requestNavigation(() => navigate(returnTo))}
          actions={<button onClick={handleCancel} className="btn-primary px-4 py-2">{t('common.cancel')}</button>}
        />

        {/* Form */}
        <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-md sm:p-6">
          {isLoadingAppointment && <p className="mb-4 text-sm text-gray-500">{t('common.loading')}</p>}
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
                onChange={(e) => handlePatientSearchChange(e.target.value)}
                onBlur={() => window.setTimeout(() => setShowPatientDropdown(false), 150)}
                onFocus={() => setShowPatientDropdown(true)}
                onKeyDown={handlePatientKeyDown}
                role="combobox"
                aria-expanded={showPatientDropdown && patients.length > 0}
                aria-controls="appointment-patient-options"
                aria-autocomplete="list"
                aria-activedescendant={highlightedPatientIndex >= 0 ? `appointment-patient-option-${patients[highlightedPatientIndex]?.id}` : undefined}
                placeholder={t('visits.patientSearchPlaceholder')}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.patientId ? 'border-red-500' : 'border-gray-300'
                  }`}
              />
              {errors.patientId && (
                <p className="mt-1 text-sm text-red-600">{errors.patientId}</p>
              )}
              {selectedPatient && !errors.patientId && (
                <p className="mt-1 text-sm text-green-700" role="status">
                  {t('appointments.selectedPatient')}: {selectedPatient.fullNameAr}
                </p>
              )}

              {/* Patient Dropdown */}
              {showPatientDropdown && patients.length > 0 && (
                <div id="appointment-patient-options" role="listbox" className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {patients.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      id={`appointment-patient-option-${patient.id}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handlePatientSelect(patient);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handlePatientSelect(patient);
                        }
                      }}
                      role="option"
                      aria-selected={highlightedPatientIndex >= 0 && patients[highlightedPatientIndex]?.id === patient.id}
                      className={`w-full px-4 py-3 text-right border-b border-gray-100 last:border-b-0 ${
                        highlightedPatientIndex >= 0 && patients[highlightedPatientIndex]?.id === patient.id
                          ? 'bg-gray-100'
                          : 'hover:bg-gray-100'
                      }`}
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

            {/* Date and Time */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('common.date')} <span className="text-red-500">*</span>
                </label>
                <DateInput
                  value={formData.scheduledAt ? formData.scheduledAt.split('T')[0] : ''}
                  onChange={(dateStr) => {
                    const time = formData.scheduledAt ? formData.scheduledAt.split('T')[1] || '10:00' : '10:00';
                    setFormData((prev) => ({ ...prev, scheduledAt: `${dateStr}T${time}` }));
                  }}
                  onBlur={validateForm}
                  className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.scheduledAt ? 'border-red-500' : 'border-gray-300'
                    }`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('visits.time')} <span className="text-red-500">*</span>
                </label>
                <TimeInput
                  value={formData.scheduledAt ? formData.scheduledAt.split('T')[1] || '10:00' : '10:00'}
                  onChange={(timeStr) => {
                    const date = formData.scheduledAt ? formData.scheduledAt.split('T')[0] : toKuwaitDateTimeLocal(new Date()).split('T')[0];
                    setFormData((prev) => ({ ...prev, scheduledAt: `${date}T${timeStr}` }));
                  }}
                  className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.scheduledAt ? 'border-red-500' : 'border-gray-300'
                    }`}
                />
              </div>
            </div>
            {errors.scheduledAt && (
              <p className="mt-1 text-sm text-red-600">{errors.scheduledAt}</p>
            )}

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
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.notes ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder={t('appointments.notesPlaceholder')}
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
                disabled={saveMutation.isPending || isLoadingAppointment}
                className="w-full rounded-md bg-[#111844] px-6 py-2 text-white transition-colors hover:bg-[#1a237e] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {saveMutation.isPending ? t('common.saving') : t(isEdit ? 'common.saveChanges' : 'appointments.bookAppointment')}
              </button>
            </div>
          </form>
        </div>
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
  );
}
