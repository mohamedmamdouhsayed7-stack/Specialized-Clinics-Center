import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, MessageCircle } from 'lucide-react';
import { appointmentsService, Appointment } from '../services/appointments.service';
import { formatDate } from '../utils/dateFormat';
import { buildWhatsAppUrl, isValidWhatsAppPhone, normalizeWhatsAppPhone } from '../utils/invoiceSharing';
import { useToast } from '../contexts/ToastContext';

type MessageType = 'CONFIRMED' | 'REMINDER' | 'CANCELLED' | 'RESCHEDULED';

interface SendAppointmentMessageDialogProps {
    open: boolean;
    onClose: () => void;
}

// Local YYYY-MM-DD formatter (matches the same pattern already used in
// Dashboard.tsx for date-filtered queries) so the date the receptionist
// picks lines up with what the API expects, regardless of timezone.
function formatDateLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export default function SendAppointmentMessageDialog({ open, onClose }: SendAppointmentMessageDialogProps) {
    const { t, i18n } = useTranslation();
    const { showToast } = useToast();
    const dialogRef = useRef<HTMLDivElement>(null);

    const [step, setStep] = useState<'select' | 'compose'>('select');
    const [selectedDate, setSelectedDate] = useState(() => formatDateLocal(new Date()));
    const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
    const [messageType, setMessageType] = useState<MessageType>('CONFIRMED');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);

    // Reset all local state whenever the dialog is (re)opened, so a previous
    // selection never leaks into a fresh run.
    useEffect(() => {
        if (open) {
            setStep('select');
            setSelectedDate(formatDateLocal(new Date()));
            setSelectedAppointment(null);
            setMessageType('CONFIRMED');
            setMessage('');
            setSending(false);
        }
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    const { data: appointmentsData, isLoading, isError } = useQuery({
        queryKey: ['appointments', 'messageDialog', selectedDate],
        queryFn: () => appointmentsService.getAppointments(selectedDate, undefined, undefined, 1, 100),
        enabled: open && step === 'select',
    });

    const appointments = appointmentsData?.data ?? [];

    const appointmentTimeLabel = useMemo(() => {
        if (!selectedAppointment) return '';
        const locale = i18n.language.startsWith('ar') ? 'ar-KW' : 'en-US';
        return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
            new Date(selectedAppointment.scheduledAt),
        );
    }, [selectedAppointment, i18n.language]);

    const appointmentDateLabel = useMemo(() => {
        if (!selectedAppointment) return '';
        return formatDate(new Date(selectedAppointment.scheduledAt), i18n.language);
    }, [selectedAppointment, i18n.language]);

    const statusLabels: Record<Appointment['status'], string> = {
        BOOKED: t('appointments.statusBooked'),
        CONFIRMED: t('appointments.statusConfirmed'),
        DONE: t('appointments.statusDone'),
        CANCELLED: t('appointments.statusCancelled'),
        NO_SHOW: t('appointments.statusNoShow'),
    };

    const buildTemplate = (type: MessageType, appointment: Appointment): string => {
        const isArabic = i18n.language.startsWith('ar');

        const patientName = isArabic
            ? appointment.patient.fullNameAr || appointment.patient.fullNameEn || ''
            : appointment.patient.fullNameEn || appointment.patient.fullNameAr || '';

        const vars = {
            name: patientName,
            clinic: t('dashboard.clinicLabel'),
            date: formatDate(new Date(appointment.scheduledAt), i18n.language),
            time: new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar-KW' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
            }).format(new Date(appointment.scheduledAt)),
        };
        switch (type) {
            case 'CONFIRMED':
                return t('appointmentMessages.templateConfirmed', vars);
            case 'REMINDER':
                return t('appointmentMessages.templateReminder', vars);
            case 'CANCELLED':
                return t('appointmentMessages.templateCancelled', vars);
            case 'RESCHEDULED':
                return t('appointmentMessages.templateRescheduled', vars);
            default:
                return '';
        }
    };

    const handleSelectAppointment = (appointment: Appointment) => {
        setSelectedAppointment(appointment);
        setMessageType('CONFIRMED');
        setMessage(buildTemplate('CONFIRMED', appointment));
        setStep('compose');
    };

    const handleChangeMessageType = (type: MessageType) => {
        setMessageType(type);
        if (selectedAppointment) {
            setMessage(buildTemplate(type, selectedAppointment));
        }
    };

    const rawPhone = selectedAppointment?.patient.phone || '';
    const normalizedPhone = rawPhone ? normalizeWhatsAppPhone(rawPhone) : '';
    const hasValidPhone = !!rawPhone && isValidWhatsAppPhone(normalizedPhone);

    const handleSend = () => {
        if (!selectedAppointment || !hasValidPhone || sending) return;
        setSending(true);
        try {
            const url = buildWhatsAppUrl(normalizedPhone, message.trim());
            showToast({ type: 'info', message: t('appointmentMessages.opening') });
            window.location.assign(url);
        } finally {
            setSending(false);
        }
    };

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#111844]/40 p-4"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="send-appointment-message-title"
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#DCE3EF] bg-white p-5 shadow-[0_20px_60px_rgba(16,47,99,0.25)]"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#111844]/10 text-[#128C7E]">
                            <MessageCircle size={18} />
                        </span>
                        <h2 id="send-appointment-message-title" className="text-xl font-bold text-[#111844]">
                            {step === 'select' ? t('appointmentMessages.selectAppointmentStep') : t('appointmentMessages.composeStep')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg px-2 py-1 text-xl text-[#667085] hover:bg-[#F6F8FC] focus:outline-none focus:ring-2 focus:ring-[#4B5694]"
                        aria-label={t('common.close')}
                    >
                        <X size={18} />
                    </button>
                </div>

                {step === 'select' && (
                    <div>
                        <label className="mb-3 block text-sm font-semibold text-[#344054]">
                            {t('appointmentMessages.selectDate')}
                            <input
                                type="date"
                                lang="en"
                                dir="ltr"
                                value={selectedDate}
                                onChange={(event) => setSelectedDate(event.target.value)}
                                className="mt-1 w-full rounded-lg border border-[#DCE3EF] px-3 py-2 font-normal text-[#1F2430] outline-none focus:border-[#4B5694] focus:ring-2 focus:ring-[#4B5694]/20"
                            />
                        </label>

                        {isLoading && <div className="py-8 text-center text-sm text-[#667085]">{t('common.loading')}</div>}
                        {isError && (
                            <div className="py-8 text-center text-sm text-[#C4362B]">{t('appointments.loadError')}</div>
                        )}
                        {!isLoading && !isError && appointments.length === 0 && (
                            <div className="py-8 text-center text-sm text-[#667085]">{t('appointments.noAppointmentsToday')}</div>
                        )}

                        {!isLoading && !isError && appointments.length > 0 && (
                            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                                {appointments.map((appointment) => (
                                    <li key={appointment.id}>
                                        <button
                                            type="button"
                                            onClick={() => handleSelectAppointment(appointment)}
                                            className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#DCE3EF] px-4 py-3 text-start transition hover:border-[#4B5694] hover:bg-[#F6F8FC] focus:outline-none focus:ring-2 focus:ring-[#4B5694]"
                                        >
                                            <div>
                                                <div className="font-semibold text-[#111844]">{appointment.patient.fullNameAr}</div>
                                                <div className="mt-0.5 text-xs text-[#667085]">
                                                    {new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar-KW' : 'en-US', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    }).format(new Date(appointment.scheduledAt))}
                                                </div>
                                            </div>
                                            <span className="shrink-0 rounded-full bg-[#F6F8FC] px-3 py-1 text-xs font-semibold text-[#4B5694]">
                                                {statusLabels[appointment.status]}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {step === 'compose' && selectedAppointment && (
                    <div>
                        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-[#F6F8FC] p-3 text-sm">
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-[#8991A6]">{t('appointmentMessages.patientLabel')}</div>
                                <div className="font-medium text-[#111844]">{selectedAppointment.patient.fullNameAr}</div>
                            </div>
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-[#8991A6]">{t('appointmentMessages.phoneLabel')}</div>
                                <div className="font-medium text-[#111844]" dir="ltr">{rawPhone || t('appointmentMessages.missingPhoneShort')}</div>
                            </div>
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-[#8991A6]">{t('appointmentMessages.appointmentDateLabel')}</div>
                                <div className="font-medium text-[#111844]">{appointmentDateLabel}</div>
                            </div>
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-[#8991A6]">{t('appointmentMessages.appointmentTimeLabel')}</div>
                                <div className="font-medium text-[#111844]" dir="ltr">{appointmentTimeLabel}</div>
                            </div>
                        </div>

                        {!hasValidPhone && (
                            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#C4362B]">
                                {t('appointmentMessages.missingPhone')}
                            </div>
                        )}

                        <div className="mb-4">
                            <p className="mb-2 text-sm font-semibold text-[#344054]">{t('appointmentMessages.messageTypeLabel')}</p>
                            <div className="grid grid-cols-2 gap-2">
                                {(['CONFIRMED', 'REMINDER', 'CANCELLED', 'RESCHEDULED'] as MessageType[]).map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => handleChangeMessageType(type)}
                                        className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${messageType === type
                                                ? 'border-[#111844] bg-[#111844] text-white'
                                                : 'border-[#DCE3EF] text-[#344054] hover:bg-[#F6F8FC]'
                                            }`}
                                    >
                                        {t(`appointmentMessages.type${type.charAt(0)}${type.slice(1).toLowerCase()}`)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <label className="block text-sm font-semibold text-[#344054]">
                            {t('appointmentMessages.messageLabel')}
                            <textarea
                                value={message}
                                onChange={(event) => setMessage(event.target.value)}
                                rows={6}
                                className="mt-1 w-full resize-y rounded-lg border border-[#DCE3EF] px-3 py-2 font-normal text-[#1F2430] outline-none focus:border-[#4B5694] focus:ring-2 focus:ring-[#4B5694]/20"
                            />
                        </label>

                        <p className="mt-3 text-xs leading-5 text-[#667085]">{t('appointmentMessages.limitationNote')}</p>

                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                            <button
                                type="button"
                                onClick={() => setStep('select')}
                                className="rounded-lg border border-[#DCE3EF] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F6F8FC] focus:outline-none focus:ring-2 focus:ring-[#4B5694]"
                            >
                                {t('appointmentMessages.back')}
                            </button>
                            <button
                                type="button"
                                onClick={handleSend}
                                disabled={!hasValidPhone || sending || !message.trim()}
                                className="rounded-lg bg-[#111844] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1A237E] focus:outline-none focus:ring-2 focus:ring-[#4B5694] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {t('appointmentMessages.sendButton')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
