import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, Eye, EyeOff, ArrowRight, AlertCircle, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiBaseUrl } from '../config/api';

export default function ResetPassword() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isArabic = i18n.language === 'ar';
  const state = location.state as { email?: string; code?: string } | null;
  const email = state?.email || '';
  const code = state?.code || '';

  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!state || !email || !/^\d{6}$/.test(code)) {
      navigate('/forgot-password');
    }
  }, [state, email, code, navigate]);

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return t('resetPassword.passwordTooShort');
    }
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      return t('resetPassword.passwordRequirements');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !/^\d{6}$/.test(code)) {
      navigate('/forgot-password', { replace: true });
      return;
    }
    setError('');

    const passwordError = validatePassword(formData.newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError(t('resetPassword.passwordsDoNotMatch'));
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          code,
          newPassword: formData.newPassword,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reset password');
      }

      setSuccess(true);
    } catch {
      setError(t('resetPassword.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir={isArabic ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-[#F4F8FC] px-4 py-10 sm:px-6">
      <div className="pointer-events-none absolute -top-28 start-[-10%] h-72 w-[120%] rounded-[50%] bg-[#DDEBFA] sm:-top-44 sm:h-[26rem]" />
      <div className="pointer-events-none absolute -bottom-36 end-[-12%] h-72 w-[120%] rounded-[50%] bg-[#C8DCF4] sm:-bottom-52 sm:h-[28rem]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/80 to-transparent" />

      <main dir={isArabic ? 'rtl' : 'ltr'} className="relative z-10 w-full max-w-[480px]">
        <div className="mb-5 flex items-center justify-center gap-3">
          <img src="/assets/logo.png" alt="" className="h-14 w-14 rounded-2xl bg-white object-contain p-1.5 shadow-md" />
          <div className="text-start">
            <p className="font-bold text-[#102F63]">مركز العيادات التخصصية</p>
            <p className="text-xs text-[#64748B]">Specialized Clinics Center</p>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-white p-6 shadow-[0_22px_65px_rgba(16,47,99,0.18)] sm:p-10">
          <div className="absolute -end-16 -top-16 h-32 w-32 rounded-full bg-[#E7F0FB]" />
          <div className="relative mb-6 text-center">
            <h1 className="text-[28px] font-bold text-[#102F63]">{t('resetPassword.title')}</h1>
            <p className="mt-1 text-[13px] text-[#64748B]">{t('resetPassword.subtitle')}</p>
          </div>

          {success ? (
            <div className="text-center py-8">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle size={32} className="text-green-600" strokeWidth={1.75} />
                </div>
              </div>
              <p className="text-[15px] text-[#102F63] mb-6">{t('resetPassword.success')}</p>
              <button
                onClick={() => navigate('/login')}
                className="btn-primary w-full py-3.5 text-[14px]"
              >
                {t('resetPassword.backToLogin')}
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-5 flex items-start gap-2 px-3.5 py-3 bg-red-50 border border-red-100 text-[#C4362B] rounded-[10px] text-[13px]">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" strokeWidth={1.75} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} dir={isArabic ? 'rtl' : 'ltr'} className="space-y-5">
                <div>
                  <label className="block text-[13px] font-medium text-[#102F63] mb-2">{t('resetPassword.newPassword')}</label>
                  <div className="relative">
                    <Lock size={17} strokeWidth={1.75} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.newPassword}
                      onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                      dir={isArabic ? 'rtl' : 'ltr'}
                      className="ui-input ps-11 pe-11"
                      placeholder={t('resetPassword.newPasswordPlaceholder')}
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                      className="absolute end-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#173B78]"
                      disabled={loading}
                    >
                      {showPassword ? <EyeOff size={17} strokeWidth={1.75} /> : <Eye size={17} strokeWidth={1.75} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#102F63] mb-2">{t('resetPassword.confirmPassword')}</label>
                  <div className="relative">
                    <Lock size={17} strokeWidth={1.75} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      dir={isArabic ? 'rtl' : 'ltr'}
                      className="ui-input ps-11 pe-11"
                      placeholder={t('resetPassword.confirmPasswordPlaceholder')}
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      aria-label={showConfirmPassword ? t('login.hidePassword') : t('login.showPassword')}
                      className="absolute end-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#173B78]"
                      disabled={loading}
                    >
                      {showConfirmPassword ? <EyeOff size={17} strokeWidth={1.75} /> : <Eye size={17} strokeWidth={1.75} />}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-[14px]">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      {t('resetPassword.resetting')}
                    </span>
                  ) : (
                    t('resetPassword.submit')
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => navigate('/login')}
                  className="text-[13px] text-[#64748B] hover:text-[#102F63] flex items-center justify-center gap-1"
                >
                  <ArrowRight size={14} strokeWidth={1.75} className={isArabic ? '' : 'rotate-180'} />
                  {t('resetPassword.backToLogin')}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
