import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { patientsService, CreatePatientDto, UpdatePatientDto } from '../services/patients.service';
import { useTranslation } from 'react-i18next';
import DateInput from '../components/DateInput';
import { getReturnTo } from '../utils/listState';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';

interface PatientFormProps {
  patientId?: string;
}

export default function PatientForm({ patientId }: PatientFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routePatientId } = useParams<{ id: string }>();
  const pathPatientId = location.pathname.match(/^\/patients\/([^/]+)\/edit$/)?.[1];
  const resolvedPatientId = patientId || routePatientId || pathPatientId;
  const [searchParams] = useSearchParams();
  const returnTo = getReturnTo(searchParams.toString(), '/patients');
  const { showToast } = useToast();
  const [formData, setFormData] = useState<CreatePatientDto | UpdatePatientDto>({
    civilId: '',
    fullNameAr: '',
    fullNameEn: '',
    phone: '',
    dateOfBirth: '',
    address: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch patient data if editing
  const { data: patient, isLoading: isLoadingPatient } = useQuery({
    queryKey: ['patient', resolvedPatientId],
    queryFn: () => patientsService.getPatient(resolvedPatientId!),
    enabled: !!resolvedPatientId,
  });
  const initialFormData = { civilId: '', fullNameAr: '', fullNameEn: '', phone: '', dateOfBirth: '', address: '' };
  const baseline = patient ? {
    civilId: patient.civilId || '',
    fullNameAr: patient.fullNameAr,
    fullNameEn: patient.fullNameEn || '',
    phone: patient.phone || '',
    dateOfBirth: patient.dateOfBirth ? patient.dateOfBirth.split('T')[0] : '',
    address: patient.address || '',
  } : initialFormData;
  const { confirmOpen, requestNavigation, stay, leave } = useUnsavedChanges(JSON.stringify(formData) !== JSON.stringify(baseline));

  // Populate form when patient data is loaded
  useEffect(() => {
    if (patient) {
      setFormData({
        civilId: patient.civilId || '',
        fullNameAr: patient.fullNameAr,
        fullNameEn: patient.fullNameEn || '',
        phone: patient.phone || '',
        dateOfBirth: patient.dateOfBirth ? patient.dateOfBirth.split('T')[0] : '',
        address: patient.address || '',
      });
    }
  }, [patient]);

  const createMutation = useMutation({
    mutationFn: (data: CreatePatientDto) => patientsService.createPatient(data),
    onSuccess: (data) => {
      showToast({ type: 'success', message: t('feedback.patientCreated') });
      navigate(`/patients/${data.id}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error: Error) => {
      showToast({ type: 'error', message: error.message || t('patients.createError') });
      setErrors({ general: error.message || t('patients.createError') });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePatientDto }) =>
      patientsService.updatePatient(id, data),
    onSuccess: (data) => {
      showToast({ type: 'success', message: t('feedback.patientUpdated') });
      navigate(`/patients/${data.id}?returnTo=${encodeURIComponent(returnTo)}`);
    },
    onError: (error: Error) => {
      showToast({ type: 'error', message: error.message || t('patients.updateError') });
      setErrors({ general: error.message || t('patients.updateError') });
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (formData.civilId && !/^\d+$/.test(formData.civilId.trim())) {
      newErrors.civilId = t('patients.civilIdDigitsOnly');
    } else if (formData.civilId && formData.civilId.trim().length > 12) {
      newErrors.civilId = t('patients.civilIdTooLong');
    }

    if (!formData.fullNameAr || !formData.fullNameAr.trim()) {
      newErrors.fullNameAr = t('patients.nameArRequired');
    } else if (formData.fullNameAr.length > 255) {
      newErrors.fullNameAr = t('patients.nameTooLong');
    }

    if (formData.fullNameEn && formData.fullNameEn.length > 255) {
      newErrors.fullNameEn = t('patients.nameTooLong');
    }

    if (formData.phone && formData.phone.length > 20) {
      newErrors.phone = t('patients.phoneTooLong');
    }

    if (formData.address && formData.address.length > 500) {
      newErrors.address = t('patients.addressTooLong');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // The date input gives back "YYYY-MM-DD" — Prisma's DateTime
    // column needs a full ISO-8601 datetime, and an empty string must
    // become undefined (not sent) rather than an invalid empty date.
    const payload = {
      ...formData,
      civilId: formData.civilId?.trim() || undefined,
      dateOfBirth: formData.dateOfBirth ? `${formData.dateOfBirth}T00:00:00.000Z` : undefined,
    };

    if (resolvedPatientId) {
      updateMutation.mutate({ id: resolvedPatientId, data: payload as UpdatePatientDto });
    } else {
      createMutation.mutate(payload as CreatePatientDto);
    }
  };

  const handleChange = (field: keyof CreatePatientDto, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  if (isLoadingPatient) {
    return (
      <div className="min-h-screen bg-[#F6F7FA]">
        <div className="container mx-auto px-4 py-5 sm:py-8">
          <div className="ui-card p-6 space-y-3">
            <Skeleton className="h-8 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" count={6} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F7FA]">
      <div className="container mx-auto px-4 py-8">
        <PageHeader
          title={resolvedPatientId ? t('patients.editPatientTitle') : t('patients.addNew')}
          breadcrumbs={[{ label: t('sidebar.patients'), href: returnTo }, { label: resolvedPatientId ? t('patients.editPatientTitle') : t('patients.addNew') }]}
          backTo={returnTo}
          onBack={() => requestNavigation(() => navigate(returnTo))}
          actions={<button onClick={() => requestNavigation(() => navigate(returnTo))} className="btn-primary px-4 py-2">{t('common.cancel')}</button>}
        />

        {/* Form */}
        <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-md sm:p-6">
          {errors.general && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Civil ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patients.civilId')} <span className="text-gray-500">({t('patients.optional')})</span>
              </label>
              <input
                type="text"
                value={formData.civilId}
                onChange={(e) => handleChange('civilId', e.target.value)}
                onBlur={validateForm}
                maxLength={12}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.civilId ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder={t('patients.civilIdPlaceholder')}
              />
              {errors.civilId && (
                <p className="mt-1 text-sm text-red-600">{errors.civilId}</p>
              )}
            </div>

            {/* Full Name (Arabic) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patients.nameArLabel')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.fullNameAr}
                onChange={(e) => handleChange('fullNameAr', e.target.value)}
                onBlur={validateForm}
                maxLength={255}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.fullNameAr ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder={t('patients.nameArPlaceholder')}
              />
              {errors.fullNameAr && (
                <p className="mt-1 text-sm text-red-600">{errors.fullNameAr}</p>
              )}
            </div>

            {/* Full Name (English) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patients.nameEnLabel')}
              </label>
              <input
                type="text"
                value={formData.fullNameEn}
                onChange={(e) => handleChange('fullNameEn', e.target.value)}
                maxLength={255}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.fullNameEn ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder={t('patients.nameEnPlaceholder')}
              />
              {errors.fullNameEn && (
                <p className="mt-1 text-sm text-red-600">{errors.fullNameEn}</p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patients.phoneLabel')}
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                maxLength={20}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.phone ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder={t('patients.phonePlaceholder')}
              />
              {errors.phone && (
                <p className="mt-1 text-sm text-red-600">{errors.phone}</p>
              )}
            </div>

            {/* Date of Birth */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patients.dobLabel')}
              </label>
              <DateInput
                value={formData.dateOfBirth || ''}
                onChange={(v) => handleChange('dateOfBirth', v)}
                isClearable
              />
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('patients.addressLabel')}
              </label>
              <textarea
                value={formData.address}
                onChange={(e) => handleChange('address', e.target.value)}
                maxLength={500}
                rows={3}
                className={`w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844] ${errors.address ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder={t('patients.addressPlaceholder')}
              />
              {errors.address && (
                <p className="mt-1 text-sm text-red-600">{errors.address}</p>
              )}
            </div>

            {/* Submit Button */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-4">
              <button
                type="button"
                onClick={() => requestNavigation(() => navigate(returnTo))}
                className="w-full rounded-md bg-gray-200 px-6 py-2 text-gray-700 transition-colors hover:bg-gray-300 sm:w-auto"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="w-full rounded-md bg-[#111844] px-6 py-2 text-white transition-colors hover:bg-[#1a237e] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? t('common.saving')
                  : resolvedPatientId
                    ? t('common.saveChanges')
                    : t('patients.addPatientBtn')}
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
