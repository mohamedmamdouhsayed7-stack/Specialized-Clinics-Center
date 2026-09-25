import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, UserRound, LogOut, ChevronDown, Languages } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { setLanguage } from '../i18n/config';

interface HeaderProps {
  onOpenSidebar: () => void;
}

export default function Header({ onOpenSidebar }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleLanguage = () => {
    setLanguage(i18n.language === 'ar' ? 'en' : 'ar');
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    try {
      await logout();
    } catch {
      showToast({ type: 'error', message: t('common.logoutFailed') });
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const roleLabel = user?.role === 'ADMIN' ? t('roles.admin') : t('roles.receptionist');

  return (
    <header className="h-[76px] shrink-0 border-b border-[#E2E8F0] bg-white px-4 sm:px-5 md:px-8">
      <div className="flex h-full items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          aria-label={t('common.openMenu')}
          className="md:hidden text-[#102F63] p-1.5 -mr-1.5"
        >
          <Menu size={22} />
        </button>
        <div className="hidden md:flex items-center gap-2.5">
          <img src="/assets/logo.png" alt="Specialized Clinics Center" className="w-9 h-9 rounded-full" />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-[#102F63]">مركز العيادات التخصصية</div>
            <div className="text-[10px] text-[#94A3B8]">Specialized Clinics Center</div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={toggleLanguage}
          aria-label={t('sidebar.language')}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#173B78] border border-[#E2E8F0] hover:bg-[#F6F8FC] rounded-lg px-3 py-1.5 transition-colors"
        >
          <Languages size={16} strokeWidth={1.75} />
          {i18n.language === 'ar' ? 'English' : 'العربية'}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('common.user')}
            aria-expanded={menuOpen}
            className="flex items-center gap-2 hover:bg-[#F6F8FC] rounded-lg px-2 py-1.5 transition-colors"
          >
            <span className="w-8 h-8 rounded-full bg-[#173B78] text-white flex items-center justify-center">
              <UserRound size={16} strokeWidth={1.75} />
            </span>
            <span className="hidden sm:block text-right leading-tight">
              <span className="block text-[13px] font-semibold text-[#102F63]">{user?.name || t('common.user')}</span>
              <span className="block text-[11px] text-[#94A3B8]">{roleLabel}</span>
            </span>
            <ChevronDown size={14} className="text-[#94A3B8] hidden sm:block" />
          </button>

          {menuOpen && (
            <div className="absolute z-50 mt-2 w-48 rounded-lg border border-[#E2E8F0] bg-white py-1 shadow-[var(--shadow-soft-lg)] ltr:right-0 rtl:left-0">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-[#C4362B] hover:bg-red-50 transition-colors"
              >
                <LogOut size={15} strokeWidth={1.75} />
                {t('common.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </header>
  );
}
