import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  UsersRound, ShieldCheck, Server, Lock, DatabaseBackup,
  CheckCircle2, XCircle, Loader2, Plus, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usersService, AppUser } from '../services/users.service';
import { backupService, BackupStatus, BackupEntry } from '../services/backup.service';
import { apiBaseUrl } from '../config/api';
import { getAccessToken } from '../config/auth-token';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import ModalDialog from '../components/ModalDialog';

const APP_VERSION = 'v1.0.0';

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('ar-KW', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<string | null>(null);

  return (
    <div className="page-container">
      <PageHeader title={t('sidebar.settings')} subtitle={t('settings.subtitle')} breadcrumbs={[{ label: t('sidebar.settings') }]} />

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <SettingsCard
          icon={UsersRound}
          color="#16803C"
          title={t('settings.rolesTitle')}
          description={t('settings.rolesDesc')}
          active={activeSection === 'roles'}
          onClick={() => setActiveSection(activeSection === 'roles' ? null : 'roles')}
        />
        <SettingsCard
          icon={ShieldCheck}
          color="#173B78"
          title={t('settings.securityTitle')}
          description={t('settings.securityDesc')}
          active={activeSection === 'security'}
          onClick={() => setActiveSection(activeSection === 'security' ? null : 'security')}
        />
        <SettingsCard
          icon={DatabaseBackup}
          color="#6B4FBB"
          title={t('settings.backupTitle')}
          description={t('settings.backupDesc')}
          active={activeSection === 'backup'}
          onClick={() => setActiveSection(activeSection === 'backup' ? null : 'backup')}
        />
        <SettingsCard
          icon={Server}
          color="#C4362B"
          title={t('settings.systemTitle')}
          description={t('settings.systemDesc')}
          active={activeSection === 'system'}
          onClick={() => setActiveSection(activeSection === 'system' ? null : 'system')}
        />
      </div>

      {activeSection === 'roles' && <RolesSection currentUserId={user?.id} />}
      {activeSection === 'security' && <SecuritySection />}
      {activeSection === 'backup' && <BackupSection />}
      {activeSection === 'system' && <SystemInfoSection />}

      {!activeSection && <SystemOverviewGrid />}
    </div>
  );
}

// ---------- النسخ الاحتياطي والاستعادة ----------
function BackupSection() {
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [confirmRestore, setConfirmRestore] = useState<BackupEntry | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([backupService.getStatus(), backupService.listBackups()]);
      setStatus(s);
      setBackups(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.backupLoadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRunBackup = async () => {
    setRunning(true);
    setError('');
    try {
      await backupService.runBackup();
      await load();
      showToast({ type: 'success', message: t('feedback.backupCreated') });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.backupCreateError'));
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('feedback.backupFailed') });
    } finally {
      setRunning(false);
    }
  };

  const handleRestore = async () => {
    if (!confirmRestore) return;
    setRestoring(true);
    setError('');
    try {
      await backupService.restoreBackup(confirmRestore.filename);
      setConfirmRestore(null);
      await load();
      showToast({ type: 'success', message: t('feedback.backupRestored') });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.backupRestoreError'));
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('feedback.restoreFailed') });
    } finally {
      setRestoring(false);
    }
  };

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  return (
    <div className="ui-card p-5">
      <h2 className="text-[16px] font-bold text-[#102F63] mb-1 flex items-center gap-2">
        <DatabaseBackup size={17} strokeWidth={1.75} />
        {t('settings.backupTitle')}
      </h2>
      <p className="text-xs text-[#94A3B8] mb-5">
        {t('settings.backupIntro', { days: status?.retentionDays ?? '—' })}
        {status && !status.remoteStorageConfigured && ` ${t('settings.remoteStorageNotConfigured')}`}
      </p>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-[#C4362B] rounded-lg text-sm">{error}</div>}

      {loading ? (
        <Skeleton className="h-32 rounded-lg mb-5" />
      ) : (
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="p-4 rounded-xl border border-[#E2E8F0]">
            <div className="text-xs text-[#94A3B8] mb-1">{t('settings.lastBackup')}</div>
            <div className="font-bold text-[#1F2430] text-sm">
              {status?.lastBackup ? new Date(status.lastBackup.createdAt).toLocaleString(i18n.language === 'ar' ? 'ar-KW' : 'en-KW') : t('settings.noPreviousBackups')}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-[#E2E8F0]">
            <div className="text-xs text-[#94A3B8] mb-1">{t('settings.remoteStorage')}</div>
            <div className={`font-bold text-sm ${status?.remoteStorageConfigured ? 'text-[var(--success)]' : 'text-[#94A3B8]'}`}>
              {status?.remoteStorageConfigured ? t('settings.enabled') : t('settings.notEnabledYet')}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-[#E2E8F0]">
            <div className="text-xs text-[#94A3B8] mb-1">{t('settings.savedBackupsCount')}</div>
            <div className="font-bold text-[#1F2430]">{status?.totalBackups ?? 0}</div>
          </div>
          <div className="p-4 rounded-xl border border-[#E2E8F0]">
            <div className="text-xs text-[#94A3B8] mb-1">{t('settings.spaceUsed')}</div>
            <div className="font-bold text-[#1F2430]">{status ? formatSize(status.totalSizeBytes) : '—'}</div>
          </div>
        </div>
      )}

      <button onClick={handleRunBackup} disabled={running} className="btn-primary px-4 py-2.5 text-sm mb-5 flex items-center gap-2">
        {running ? <Loader2 size={16} className="animate-spin" /> : null}
        {running ? t('settings.creatingBackup') : t('settings.createBackupNow')}
      </button>

      <h3 className="text-sm font-bold text-[#102F63] mb-3">{t('settings.availableBackups')}</h3>
      {backups.length === 0 && !loading && <EmptyState title={t('settings.noBackupsYet')} />}
      {backups.length > 0 && (
        <div className="space-y-2">
          {backups.map((b) => (
            <div key={b.filename} className="flex items-center justify-between p-3 rounded-lg border border-[#E2E8F0] text-sm">
              <div>
                <div className="text-[#1F2430]">{new Date(b.createdAt).toLocaleString(i18n.language === 'ar' ? 'ar-KW' : 'en-KW')}</div>
                <div className="text-xs text-[#94A3B8]">{formatSize(b.sizeBytes)} · {b.triggeredBy === 'manual' ? t('settings.triggerManual') : b.triggeredBy === 'scheduled' ? t('settings.triggerScheduled') : t('settings.triggerPreRestore')}{b.uploadedToRemote ? ` · ${t('settings.uploadedRemotely')}` : ''}</div>
              </div>
              <button onClick={() => setConfirmRestore(b)} className="text-[#C4362B] hover:underline">{t('settings.restore')}</button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmRestore}
        title={t('settings.confirmRestoreTitle')}
        message={confirmRestore ? t('settings.confirmRestoreBody', {
          date: new Date(confirmRestore.createdAt).toLocaleString('ar-KW'),
        }) : ''}
        confirmLabel={restoring ? t('settings.restoring') : t('settings.confirmRestoreBtn')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={restoring}
        onCancel={() => setConfirmRestore(null)}
        onConfirm={handleRestore}
      />
    </div>
  );
}

function SettingsCard({
  icon: Icon, color, title, description, active, onClick,
}: {
  icon: typeof UsersRound; color: string; title: string; description: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={`ui-card p-5 text-right transition-shadow hover:shadow-[var(--shadow-soft-lg)] ${active ? 'ring-2 ring-[#102F63]' : ''}`}>
      <div className="w-11 h-11 rounded-full flex items-center justify-center mb-3" style={{ background: `${color}1A` }}>
        <Icon size={20} strokeWidth={1.75} style={{ color }} />
      </div>
      <h3 className="font-bold text-[#102F63] mb-1">{title}</h3>
      <p className="text-[13px] text-[#64748B] leading-relaxed">{description}</p>
    </button>
  );
}

// ---------- الصلاحيات والأدوار ----------
function RolesSection({ currentUserId }: { currentUserId?: string }) {
  const [showCreate, setShowCreate] = useState(false);
  const { t } = useTranslation();
  const { data: users, isLoading, refetch } = useQuery({ queryKey: ['users'], queryFn: () => usersService.getUsers() });

  return (
    <div className="ui-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-bold text-[#102F63]">{t('settings.usersAndRoles')}</h2>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-sm">
          <Plus size={16} strokeWidth={2} />
          {t('settings.addUser')}
        </button>
      </div>

      {isLoading && <Skeleton className="h-32 rounded-lg" />}

      {users && (
        <table className="ui-table">
          <thead>
            <tr>
              <th>{t('settings.userName')}</th>
              <th>{t('settings.email')}</th>
              <th>{t('settings.role')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} onChanged={refetch} />
            ))}
          </tbody>
        </table>
      )}

      <p className="text-xs text-[#94A3B8] mt-4">
        {t('settings.rolesFootnote')}
      </p>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={refetch} />}
    </div>
  );
}

function UserRow({ user, isSelf, onChanged }: { user: AppUser; isSelf: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const { t } = useTranslation();
  const { showToast } = useToast();

  const toggleStatus = async () => {
    setBusy(true);
    try {
      await usersService.updateUserStatus(user.id, !user.isActive);
      onChanged();
    } catch (err) {
      showToast({ type: 'error', message: err instanceof Error ? err.message : t('feedback.appointmentStatusFailed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td className="font-medium text-[#1F2430]">{user.name}{isSelf && <span className="text-xs text-[#94A3B8]"> ({t('settings.you')})</span>}</td>
      <td className="text-[#64748B]">{user.email}</td>
      <td>
        <span className="ui-badge" style={{ background: 'rgba(23,59,120,0.1)', color: 'var(--brand-blue)' }}>
          {user.role === 'ADMIN' ? t('roles.admin') : t('roles.receptionist')}
        </span>
      </td>
      <td>
        <span className="ui-badge" style={user.isActive ? { background: 'rgba(22,128,60,0.1)', color: 'var(--success)' } : { background: 'rgba(100,116,139,0.1)', color: 'var(--text-secondary)' }}>
          {user.isActive ? t('common.active') : t('settings.disabled')}
        </span>
      </td>
      <td>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEdit(true)} className="text-sm text-[#173B78] hover:underline">
            {t('common.edit')}
          </button>
          <button onClick={toggleStatus} disabled={isSelf || busy} className="text-sm text-[#173B78] disabled:opacity-40 disabled:cursor-not-allowed hover:underline">
            {busy ? '...' : user.isActive ? t('common.deactivate') : t('common.activate')}
          </button>
        </div>
      </td>
      {showEdit && <EditUserModal user={user} isSelf={isSelf} onClose={() => setShowEdit(false)} onUpdated={onChanged} />}
    </tr>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'RECEPTIONIST'>('RECEPTIONIST');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await usersService.createUser({ name, email, password, role });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.createUserError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog open title={t('settings.addNewUser')} labelledBy="create-user-title" onClose={onClose}>
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-[#C4362B] rounded-lg text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.userName')} required className="ui-input" />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('settings.email')} required className="ui-input" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('settings.passwordMinLength')} required minLength={6} className="ui-input" />
        <select value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'RECEPTIONIST')} className="ui-input">
          <option value="RECEPTIONIST">{t('roles.receptionist')}</option>
          <option value="ADMIN">{t('roles.admin')}</option>
        </select>
        <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5 text-sm">
          {submitting ? t('settings.creatingUser') : t('settings.createUser')}
        </button>
      </form>
    </ModalDialog>
  );
}

function EditUserModal({ user, isSelf, onClose, onUpdated }: { user: AppUser; isSelf: boolean; onClose: () => void; onUpdated: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<'ADMIN' | 'RECEPTIONIST'>(user.role as 'ADMIN' | 'RECEPTIONIST');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await usersService.updateUser(user.id, { name, email, role });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.updateUserError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog open title={t('settings.editUser')} labelledBy="edit-user-title" onClose={onClose}>
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-[#C4362B] rounded-lg text-sm">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.userName')} required className="ui-input" />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('settings.email')} required className="ui-input" />
        <select value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'RECEPTIONIST')} disabled={isSelf} className="ui-input">
          <option value="RECEPTIONIST">{t('roles.receptionist')}</option>
          <option value="ADMIN">{t('roles.admin')}</option>
        </select>
        {isSelf && <p className="text-xs text-[#94A3B8]">{t('settings.cannotEditOwnRole')}</p>}
        <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5 text-sm">
          {submitting ? t('settings.updatingUser') : t('settings.updateUser')}
        </button>
      </form>
    </ModalDialog>
  );
}

// ---------- الأمان ----------
function SecuritySection() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError(t('settings.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const token = getAccessToken();
      const response = await fetch(`${apiBaseUrl}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || t('settings.passwordChangeError'));
      setSuccess(t('settings.passwordChangeSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.passwordChangeError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ui-card p-5 max-w-md">
      <h2 className="text-[16px] font-bold text-[#102F63] mb-4 flex items-center gap-2">
        <Lock size={17} strokeWidth={1.75} />
        {t('settings.changePassword')}
      </h2>
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-[#C4362B] rounded-lg text-sm">{error}</div>}
      {success && <div className="mb-3 px-3 py-2 bg-green-50 border border-green-100 text-[var(--success)] rounded-lg text-sm">{success}</div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <input
            type={showCurrent ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t('settings.currentPassword')}
            required
            className="ui-input pe-10"
          />
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            aria-label={showCurrent ? t('common.hidePassword') : t('common.showPassword')}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-[#94A3B8] hover:text-[#173B78]"
          >
            {showCurrent ? <EyeOff size={17} strokeWidth={1.75} /> : <Eye size={17} strokeWidth={1.75} />}
          </button>
        </div>
        <div className="relative">
          <input
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('settings.newPassword')}
            required
            minLength={6}
            className="ui-input pe-10"
          />
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            aria-label={showNew ? t('common.hidePassword') : t('common.showPassword')}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-[#94A3B8] hover:text-[#173B78]"
          >
            {showNew ? <EyeOff size={17} strokeWidth={1.75} /> : <Eye size={17} strokeWidth={1.75} />}
          </button>
        </div>
        <div className="relative">
          <input
            type={showConfirm ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('settings.confirmNewPassword')}
            required
            minLength={6}
            className="ui-input pe-10"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? t('common.hidePassword') : t('common.showPassword')}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-[#94A3B8] hover:text-[#173B78]"
          >
            {showConfirm ? <EyeOff size={17} strokeWidth={1.75} /> : <Eye size={17} strokeWidth={1.75} />}
          </button>
        </div>
        <button type="submit" disabled={submitting} className="btn-primary px-4 py-2.5 text-sm">
          {submitting ? t('settings.savingPassword') : t('settings.saveNewPassword')}
        </button>
      </form>
    </div>
  );
}

// ---------- معلومات النظام ----------
function SystemInfoSection() {
  const { t } = useTranslation();
  const { data: health, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/health`);
      return { ok: res.ok, data: await res.json().catch(() => null) };
    },
    refetchInterval: 30000,
  });

  return (
    <div className="ui-card p-5">
      <h2 className="text-[16px] font-bold text-[#102F63] mb-4">{t('settings.systemTitle')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoTile label={t('settings.serverStatus')} loading={isLoading} ok={health?.ok} okText={t('settings.workingNormally')} badText={t('settings.disconnected')} />
        <InfoTile label={t('settings.database')} loading={isLoading} ok={health?.data?.database === 'connected'} okText={t('settings.connected')} badText={t('settings.notConnected')} />
        <div className="p-4 rounded-xl border border-[#E2E8F0]">
          <div className="text-xs text-[#94A3B8] mb-1">{t('settings.systemVersion')}</div>
          <div className="font-bold text-[#1F2430]">{APP_VERSION}</div>
        </div>
        <div className="p-4 rounded-xl border border-[#E2E8F0]">
          <div className="text-xs text-[#94A3B8] mb-1">{t('settings.lastCheck')}</div>
          <div className="font-bold text-[#1F2430] text-sm">{health?.data?.timestamp ? formatDateTime(health.data.timestamp) : '—'}</div>
        </div>
      </div>
      <p className="text-xs text-[#94A3B8] mt-4">{t('settings.systemInfoNote')}</p>
    </div>
  );
}

function InfoTile({ label, loading, ok, okText, badText }: { label: string; loading: boolean; ok?: boolean; okText: string; badText: string }) {
  return (
    <div className="p-4 rounded-xl border border-[#E2E8F0]">
      <div className="text-xs text-[#94A3B8] mb-1">{label}</div>
      <div className="flex items-center gap-1.5 font-bold text-sm">
        {loading ? (
          <Loader2 size={15} className="animate-spin text-[#94A3B8]" />
        ) : ok ? (
          <><CheckCircle2 size={15} className="text-[var(--success)]" /><span className="text-[var(--success)]">{okText}</span></>
        ) : (
          <><XCircle size={15} className="text-[#C4362B]" /><span className="text-[#C4362B]">{badText}</span></>
        )}
      </div>
    </div>
  );
}

// ---------- نظرة عامة (الحالة الافتراضية) ----------
function SystemOverviewGrid() {
  const { t } = useTranslation();
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/health`);
      return { ok: res.ok, data: await res.json().catch(() => null) };
    },
  });

  return (
    <div className="ui-card p-5">
      <h2 className="text-[15px] font-bold text-[#102F63] mb-4">{t('settings.systemOverview')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoTile label={t('settings.systemStatus')} loading={!health} ok={health?.ok} okText={t('settings.systemHealthy')} badText={t('settings.systemOffline')} />
        <InfoTile label={t('settings.database')} loading={!health} ok={health?.data?.database === 'connected'} okText={t('settings.connected')} badText={t('settings.disconnected')} />
        <div className="p-4 rounded-xl border border-[#E2E8F0]">
          <div className="text-xs text-[#94A3B8] mb-1">{t('settings.systemVersion')}</div>
          <div className="font-bold text-[#1F2430]">{APP_VERSION}</div>
        </div>
        <div className="p-4 rounded-xl border border-[#E2E8F0]">
          <div className="text-xs text-[#94A3B8] mb-1">{t('settings.backup')}</div>
          <div className="font-bold text-[#94A3B8] text-sm">{t('settings.reviewBackup')}</div>
        </div>
      </div>
    </div>
  );
}

