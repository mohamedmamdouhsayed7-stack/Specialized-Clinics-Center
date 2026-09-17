import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UsersRound, CalendarDays, ClipboardList, ReceiptText, Stethoscope, Wallet, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import DashboardCard from '../components/DashboardCard';
import StatCard from '../components/StatCard';
import SendAppointmentMessageDialog from '../components/SendAppointmentMessageDialog';
import { patientsService } from '../services/patients.service';
import { appointmentsService } from '../services/appointments.service';
import { visitsService } from '../services/visits.service';
import { reportsService } from '../services/reports.service';
import { formatMoney } from '../utils/money';
import { formatDate } from '../utils/dateFormat';

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);

  const roleLabel = user?.role === 'ADMIN' ? t('roles.admin') : t('roles.receptionist');

  // Helper to format date as YYYY-MM-DD in local timezone
  const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Get today's date in YYYY-MM-DD format for API calls (local timezone)
  const today = formatDateLocal(new Date());
  const weekAgo = formatDateLocal(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

  // Fetch total patients count
  const { data: patientsData, isLoading: patientsLoading } = useQuery({
    queryKey: ['patients', 'count'],
    queryFn: () => patientsService.getPatients(undefined, undefined, 1, 1),
    select: (data) => data.meta.total,
  });

  // Fetch today's appointments count
  const { data: appointmentsData, isLoading: appointmentsLoading } = useQuery({
    queryKey: ['appointments', 'today', today],
    queryFn: () => appointmentsService.getAppointments(today, undefined, undefined, 1, 1),
    select: (data) => data.meta.total,
  });

  // Fetch week visits count
  const { data: visitsData, isLoading: visitsLoading } = useQuery({
    queryKey: ['visits', 'week', weekAgo, today],
    queryFn: () => visitsService.getVisits(undefined, undefined, undefined, undefined, weekAgo, today, undefined, 1, 1),
    select: (data) => data.meta.total,
  });

  // Fetch outstanding balance (admin only - reports API is admin-only)
  const { data: reportsData, isLoading: reportsLoading } = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: () => reportsService.getSummary(),
    enabled: isAdmin,
    select: (data) => data.outstandingAmount,
  });

  return (
    <main className="page-container flex-1">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#4B5694]">{t('dashboard.clinicLabel')}</p>
              <h1 className="text-2xl font-bold tracking-tight text-[#102F63] sm:text-[30px]">{t('dashboard.title')}</h1>
              <p className="mt-1 text-sm text-[#64748B]">{t('dashboard.subtitle')}</p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <button
                type="button"
                onClick={() => setMessageDialogOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#111844] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a237e] focus:outline-none focus:ring-2 focus:ring-[#4B5694] focus:ring-offset-2"
              >
                <MessageCircle size={16} /> {t('appointmentMessages.sendMessage')}
              </button>
              <div className="text-start text-sm text-[#64748B] sm:text-end">
                <div>{formatDate(new Date(), i18n.language)}</div>
              </div>
            </div>
          </div>

          <div className="mb-6 overflow-hidden rounded-2xl bg-[#102F63] px-5 py-5 text-white shadow-[var(--shadow-soft-lg)] sm:px-7 sm:py-6">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/12">
                <UsersRound size={22} strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-lg font-semibold">{t('dashboard.welcome', { name: user?.name || t('common.user') })}</p>
                <p className="mt-1 text-sm text-white/70">{t('dashboard.role')}: {roleLabel}</p>
              </div>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('dashboard.totalPatients')} value={patientsData ?? 0} isLoading={patientsLoading} icon={UsersRound} />
            <StatCard label={t('dashboard.todayAppointments')} value={appointmentsData ?? 0} isLoading={appointmentsLoading} icon={CalendarDays} />
            <StatCard label={t('dashboard.weekVisits')} value={visitsData ?? 0} isLoading={visitsLoading} icon={ClipboardList} />
            {isAdmin && <StatCard label={t('dashboard.totalOutstanding')} value={formatMoney(reportsData ?? 0, i18n.language)} isLoading={reportsLoading} icon={Wallet} />}
          </div>

          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#102F63]">{t('dashboard.quickActions')}</h2>
              <p className="mt-1 text-sm text-[#64748B]">{t('dashboard.quickActionsSubtitle')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardCard
              title={t('sidebar.patients')}
              description={t('dashboard.patientsDesc')}
              icon={UsersRound}
              onClick={() => navigate('/patients')}
            />
            <DashboardCard
              title={t('sidebar.appointments')}
              description={t('dashboard.appointmentsDesc')}
              icon={CalendarDays}
              onClick={() => navigate('/appointments')}
            />
            <DashboardCard
              title={t('sidebar.visits')}
              description={t('dashboard.visitsDesc')}
              icon={ClipboardList}
              onClick={() => navigate('/visits')}
            />
            <DashboardCard
              title={t('sidebar.invoices')}
              description={t('dashboard.invoicesDesc')}
              icon={ReceiptText}
              onClick={() => navigate('/invoices')}
              accent="red"
            />
            {isAdmin && (
              <DashboardCard
                title={t('sidebar.services')}
                description={t('dashboard.servicesDesc')}
                icon={Stethoscope}
                onClick={() => navigate('/services')}
              />
            )}
          </div>

      <SendAppointmentMessageDialog open={messageDialogOpen} onClose={() => setMessageDialogOpen(false)} />
    </main>
  );
}
