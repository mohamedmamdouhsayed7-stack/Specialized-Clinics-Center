import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { appointmentsService, Appointment } from '../services/appointments.service';
import { useTranslation } from 'react-i18next';
import { formatTime as formatTimeUtil } from '../utils/dateFormat';
import { addCalendarDays, formatKuwaitCalendarDate, getSelectedKuwaitCalendarDate, groupAppointmentsByKuwaitTime } from '../utils/kuwaitDateTime';
import { preserveListState } from '../utils/listState';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import MobileRecordCard, { MobileRecordField } from '../components/MobileRecordCard';

type ViewType = 'calendar' | 'list';
const APPOINTMENT_STATUSES = ['BOOKED', 'CONFIRMED', 'DONE', 'CANCELLED', 'NO_SHOW'] as const;
type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];

export default function AppointmentsList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewType, setViewType] = useState<ViewType>((searchParams.get('view') as ViewType) || 'calendar');
  const selectedDate = getSelectedKuwaitCalendarDate(searchParams.get('date'));
  const initialStatus = searchParams.get('status') as AppointmentStatus | null;
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>(
    initialStatus && APPOINTMENT_STATUSES.includes(initialStatus) ? initialStatus : '',
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['appointments', selectedDate, statusFilter],
    queryFn: () => appointmentsService.getAllAppointments(selectedDate, statusFilter),
  });

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
      BOOKED: { bg: 'bg-blue-100', text: 'text-blue-700', label: t('appointments.statusBooked') },
      CONFIRMED: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: t('appointments.statusConfirmed') },
      DONE: { bg: 'bg-green-100', text: 'text-green-700', label: t('appointments.statusDone') },
      CANCELLED: { bg: 'bg-red-100', text: 'text-red-700', label: t('appointments.statusCancelled') },
      NO_SHOW: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: t('appointments.statusNoShow') },
    };

    const config = statusConfig[status] || statusConfig.BOOKED;
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const handleNewAppointment = () => {
    navigate(preserveListState('/appointments/new', location));
  };

  const handleDateChange = (days: number) => {
    const newDate = addCalendarDays(selectedDate, days);
    setSearchParams((current) => { current.set('date', newDate); return current; });
  };

  const handleAppointmentClick = (appointment: Appointment) => {
    navigate(preserveListState(`/appointments/${appointment.id}`, location));
  };

  const formatTime = (dateString: string) => formatTimeUtil(dateString, i18n.language);

  const formatDateDisplay = (date: string) => {
    const locale = i18n.language === 'ar' ? 'ar-KW' : 'en-GB';
    return formatKuwaitCalendarDate(date, locale);
  };

  if (isLoading) {
    return (
      <div className="page-container">
          <PageHeader title={t('sidebar.appointments')} breadcrumbs={[{ label: t('sidebar.appointments') }]} />
          <div className="ui-card p-6 space-y-3">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" count={5} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="ui-alert" role="alert">{t('appointments.loadError')}</div>
      </div>
    );
  }

  const appointments = (data?.data || []).filter((appointment) =>
    !statusFilter || appointment.status === statusFilter
  );

  // Generate time slots for calendar view
  const defaultTimeSlots = [];
  for (let hour = 8; hour <= 20; hour++) {
    defaultTimeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
    defaultTimeSlots.push(`${hour.toString().padStart(2, '0')}:30`);
  }

  const appointmentsByTime = groupAppointmentsByKuwaitTime(appointments);
  const timeSlots = [...new Set([...defaultTimeSlots, ...appointmentsByTime.keys()])].sort();

  return (
    <div className="page-container">
        <PageHeader
          title={t('sidebar.appointments')}
          breadcrumbs={[{ label: t('sidebar.appointments') }]}
          actions={
            <button onClick={handleNewAppointment} className="btn-primary px-4 py-2.5">
              + {t('appointments.newAppointment')}
            </button>
          }
        />

        {/* Controls */}
        <div className="ui-card mb-6 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {/* Date Navigation */}
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:gap-4">
              <button
                onClick={() => handleDateChange(-1)}
                className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                {t('common.previous')}
              </button>
              <span className="min-w-0 flex-1 text-center font-medium text-gray-900 sm:min-w-[200px]">
                {formatDateDisplay(selectedDate)}
              </span>
              <button
                onClick={() => handleDateChange(1)}
                className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
              >
                {t('common.next')}
              </button>
            </div>

            {/* View Toggle */}
            <div className="flex w-full gap-2 sm:w-auto">
              <button
                onClick={() => { setViewType('calendar'); setSearchParams((current) => { current.set('view', 'calendar'); return current; }); }}
                className={`flex-1 rounded px-3 py-2 text-sm sm:flex-none sm:py-1 ${
                  viewType === 'calendar'
                    ? 'bg-[#111844] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t('appointments.calendarView')}
              </button>
              <button
                onClick={() => { setViewType('list'); setSearchParams((current) => { current.set('view', 'list'); return current; }); }}
                className={`flex-1 rounded px-3 py-2 text-sm sm:flex-none sm:py-1 ${
                  viewType === 'list'
                    ? 'bg-[#111844] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t('appointments.listView')}
              </button>
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => {
                const nextStatus = e.target.value as AppointmentStatus | '';
                setStatusFilter(nextStatus);
                setSearchParams((current) => { if (nextStatus) current.set('status', nextStatus); else current.delete('status'); return current; });
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 sm:w-auto sm:py-1"
            >
              <option value="">{t('common.allStatuses')}</option>
              <option value="BOOKED">{t('appointments.statusBooked')}</option>
              <option value="CONFIRMED">{t('appointments.statusConfirmed')}</option>
              <option value="DONE">{t('appointments.statusDone')}</option>
              <option value="CANCELLED">{t('appointments.statusCancelled')}</option>
              <option value="NO_SHOW">{t('appointments.statusNoShow')}</option>
            </select>
        </div>

        {/* Calendar View */}
        {viewType === 'calendar' && (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="divide-y divide-gray-200">
              {timeSlots.map((time) => {
                const slotAppointments = appointmentsByTime.get(time) || [];

                return (
                  <div
                    key={time}
                    className="flex items-center p-4 hover:bg-gray-50 min-h-[60px]"
                  >
                    <div className="w-20 text-sm font-medium text-gray-600">{time}</div>
                    <div className="flex-1">
                      {slotAppointments.length > 0 ? (
                        slotAppointments.map((apt) => (
                          <div
                            key={apt.id}
                            onClick={() => handleAppointmentClick(apt)}
                            className="mb-2 flex cursor-pointer items-center justify-between rounded bg-gray-50 p-3 hover:bg-gray-100"
                          >
                            <div>
                              <div className="font-medium text-gray-900">{apt.patient.fullNameAr}</div>
                              <div className="text-sm text-gray-500">{apt.patient.civilId}</div>
                            </div>
                            {getStatusBadge(apt.status)}
                          </div>
                        ))
                      ) : (
                        <div className="text-gray-400 text-sm">{t('appointments.slotAvailable')}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* List View */}
        {viewType === 'list' && (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            {appointments.length === 0 ? (
              <EmptyState title={t('appointments.noAppointmentsToday')} description={t('common.emptyDescription')} />
            ) : (
              <>
              <div className="mobile-record-list p-3 md:hidden">
                {appointments
                  .slice()
                  .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
                  .map((apt) => (
                    <MobileRecordCard
                      key={apt.id}
                      title={apt.patient.fullNameAr}
                      subtitle={formatTime(apt.scheduledAt)}
                      onClick={() => handleAppointmentClick(apt)}
                    >
                      <MobileRecordField label={t('patients.civilId')} value={apt.patient.civilId} />
                      <MobileRecordField label={t('common.status')} value={getStatusBadge(apt.status)} />
                    </MobileRecordCard>
                  ))}
              </div>
              <div className="hidden md:block">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">{t('visits.time')}</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">{t('visits.patient')}</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">{t('patients.civilId')}</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {appointments
                    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
                    .map((apt) => (
                      <tr
                        key={apt.id}
                        onClick={() => handleAppointmentClick(apt)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-6 py-4 text-gray-900">{formatTime(apt.scheduledAt)}</td>
                        <td className="px-6 py-4 font-medium text-gray-900">{apt.patient.fullNameAr}</td>
                        <td className="px-6 py-4 text-gray-600">{apt.patient.civilId}</td>
                        <td className="px-6 py-4">{getStatusBadge(apt.status)}</td>
                      </tr>
                    ))}
                </tbody>
            </table>
            </div>
            </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
