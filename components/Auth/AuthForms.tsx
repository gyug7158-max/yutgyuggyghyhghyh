
import React, { useState, useEffect, useRef } from 'react';
import { AuthMode } from '../../types';
import { Input, Button, PasswordStrength, Checkbox } from '../UI/Shared';
import { GoogleIcon, DiscordIcon, MetaMaskIcon, MailIcon, LockIcon, UserIcon, HumanIcon, CheckCircle } from '../UI/Icons';
import { LegalModal } from '../UI/LegalModal';

import { apiService } from '../../services/api.service';
import { translations } from '../../src/translations';

export const AuthCard: React.FC<any> = ({ authMode, setAuthMode, onLoginSuccess, showToast, language }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isPasswordResetMode, setIsPasswordResetMode] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '', username: '', code: '' });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showLegal, setShowLegal] = useState<'terms' | 'privacy' | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin
      const origin = event.origin;
      const isAllowedOrigin = 
        origin.endsWith('.run.app') || 
        origin.includes('localhost') || 
        origin.includes('smarteyepro.com');

      if (!isAllowedOrigin) {
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const { user, token } = event.data.payload;
        apiService.setToken(token);
        onLoginSuccess(user);
        showToast(`Вход выполнен: ${user.username}`, 'success');
        setIsLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onLoginSuccess, showToast]);

  const triggerGoogleLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { url } = await apiService.getGoogleAuthUrl();
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const authWindow = window.open(
        url,
        'google_oauth_popup',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!authWindow) {
        showToast('Всплывающее окно заблокировано. Пожалуйста, разрешите всплывающие окна.', 'error');
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Google OAuth error:', err);
      showToast('Ошибка при получении ссылки авторизации', 'error');
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister && !termsAccepted) {
        showToast((translations[language || 'ru'] as any).accept_terms_checkbox, 'error');
        return;
    }
    
    setIsLoading(true);

    try {
      if (isLogin) {
        const result = await apiService.login({ email: formData.email, password: formData.password });
        onLoginSuccess(result.user);
        showToast('Доступ разрешен', 'success');
      } else if (isRegister) {
          const referrerId = localStorage.getItem('se_referrer_id');
          await apiService.register({ 
            email: formData.email, 
            password: formData.password,
            username: formData.username,
            referrerId: referrerId || undefined
          });
          if (referrerId) localStorage.removeItem('se_referrer_id');
          setAuthMode(AuthMode.VERIFY);
          showToast('Код подтверждения отправлен на вашу почту', 'info');
        } else if (authMode === AuthMode.VERIFY) {
          try {
            if (isPasswordResetMode) {
              await apiService.confirmPasswordReset({ 
                email: formData.email, 
                code: formData.code, 
                newPassword: formData.password 
              });
              showToast('Пароль успешно изменен. Теперь вы можете войти.', 'success');
              setAuthMode(AuthMode.LOGIN);
              setIsPasswordResetMode(false);
            } else {
              const result = await apiService.verify({ email: formData.email, code: formData.code });
              onLoginSuccess(result.user);
              showToast('Аккаунт успешно подтвержден', 'success');
            }
          } catch (error: any) {
             throw new Error(error.data?.error || error.message || 'Неверный код');
          }
        } else if (authMode === AuthMode.RESET) {
          try {
            await apiService.requestPasswordReset(formData.email);
            setIsPasswordResetMode(true);
            setAuthMode(AuthMode.VERIFY);
            showToast('Код восстановления отправлен на почту', 'info');
          } catch (error: any) {
            throw new Error(error.data?.error || error.message || 'Ошибка при запросе сброса пароля');
          }
        } else {
          setAuthMode(AuthMode.LOGIN);
        }
    } catch (error: any) {
      showToast(error.message || 'Ошибка авторизации', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const isLogin = authMode === AuthMode.LOGIN;
  const isRegister = authMode === AuthMode.REGISTER;
  const isVerify = authMode === AuthMode.VERIFY;
  const isReset = authMode === AuthMode.RESET;

  return (
    <div className="w-full relative">
      {(isLogin || isRegister) ? (
        <div className="flex p-1 mb-4 bg-white/5 rounded-xl border border-white/5 relative">
          <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white border border-white/10 rounded-lg transition-all duration-300 ${isLogin ? 'left-1' : 'left-[calc(50%+4px)]'}`}></div>
          <button type="button" onClick={() => setAuthMode(AuthMode.LOGIN)} className={`flex-1 relative z-10 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition-colors ${isLogin ? 'text-black' : 'text-gray-500'}`}>Вход</button>
          <button type="button" onClick={() => setAuthMode(AuthMode.REGISTER)} className={`flex-1 relative z-10 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition-colors ${isRegister ? 'text-black' : 'text-gray-500'}`}>Регистрация</button>
        </div>
      ) : (
        <div className="flex justify-start mb-6">
          <button 
            type="button" 
            onClick={() => {
              setAuthMode(AuthMode.LOGIN);
              setIsPasswordResetMode(false);
            }} 
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 hover:text-white transition-colors"
          >
            ← Вернуться ко входу
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className={`flex flex-col ${isLogin ? 'min-h-[500px] justify-between' : 'space-y-3 min-h-[480px]'}`}>
        <div className={`flex flex-col ${isLogin ? 'flex-grow justify-between gap-4' : 'space-y-3'}`}>
          <div className={`flex flex-col ${isLogin ? 'gap-2 pt-2' : 'space-y-3'}`}>
            {isRegister && <Input label="ИМЯ ПОЛЬЗОВАТЕЛЯ" placeholder="@trader_king" icon={<UserIcon className="w-5 h-5" />} value={formData.username} onChange={(e: any) => setFormData({...formData, username: e.target.value})} />}
            
            {(authMode !== AuthMode.VERIFY) && <Input label="ЭЛЕКТРОННАЯ ПОЧТА" type="email" placeholder="smarteyepro@mail.ru" icon={<MailIcon className="w-5 h-5" />} value={formData.email} onChange={(e: any) => setFormData({...formData, email: e.target.value})} />}
            
            {(isLogin || isRegister) && <div className="space-y-2">
                <Input label="ПАРОЛЬ" type="password" placeholder="••••••••" icon={<LockIcon className="w-5 h-5" />} value={formData.password} onChange={(e: any) => setFormData({...formData, password: e.target.value})} />
                {isRegister && <PasswordStrength password={formData.password} />}
                {isLogin && (
                  <div className="flex justify-start px-1 pt-0.5">
                    <button type="button" onClick={() => setAuthMode(AuthMode.RESET)} className="text-[10px] uppercase font-black text-white hover:text-gray-300 transition-colors tracking-[0.3em] font-mono">ЗАБЫЛИ ПАРОЛЬ?</button>
                  </div>
                )}
            </div>}
          </div>

          {authMode === AuthMode.VERIFY && (
            <div className="space-y-4 pt-4">
              <div className="text-center space-y-2">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-400">
                  {isPasswordResetMode ? 'Введите новый пароль и код из письма' : 'Введите код из письма'}
                </p>
                <p className="text-[13px] font-bold text-white/60">{formData.email}</p>
              </div>

              {isPasswordResetMode && (
                <div className="space-y-2">
                  <Input 
                    label="НОВЫЙ ПАРОЛЬ" 
                    type="password" 
                    placeholder="••••••••" 
                    icon={<LockIcon className="w-5 h-5" />} 
                    value={formData.password} 
                    onChange={(e: any) => setFormData({...formData, password: e.target.value})} 
                  />
                  <PasswordStrength password={formData.password} />
                </div>
              )}

              <Input 
                label="КОД ПОДТВЕРЖДЕНИЯ" 
                placeholder="123456" 
                icon={<CheckCircle className="w-5 h-5 text-purple-400" />} 
                value={formData.code} 
                onChange={(e: any) => setFormData({...formData, code: e.target.value.replace(/\D/g, '').slice(0, 6)})} 
                className="!border-purple-500/40 !bg-purple-500/5 focus:!border-purple-500/60 transition-all shadow-[0_0_15px_rgba(168,85,247,0.1)]"
              />
              <div className="flex justify-center">
                <button 
                  type="button" 
                  onClick={async () => {
                    try {
                      await apiService.resendCode(formData.email);
                      showToast('Код отправлен повторно', 'info');
                    } catch (e) {
                      showToast('Ошибка при отправке кода', 'error');
                    }
                  }} 
                  className="text-[10px] uppercase font-black text-gray-400 hover:text-white transition-colors tracking-[0.3em]"
                >
                  ОТПРАВИТЬ КОД ПОВТОРНО
                </button>
              </div>
            </div>
          )}

          {isRegister && (
            <Checkbox 
              label={
                <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider leading-relaxed">
                  {(translations[language || 'ru'] as any).i_agree_to}{' '}
                  <button 
                    type="button" 
                    onClick={(e) => { e.stopPropagation(); setShowLegal('privacy'); }}
                    className="text-[#facc15] hover:text-yellow-300 transition-colors underline decoration-yellow-400/30"
                  >
                    {(translations[language || 'ru'] as any).privacy_policy_footer}
                  </button>
                  {' '}{(translations[language || 'ru'] as any).and}{' '}
                  <button 
                    type="button" 
                    onClick={(e) => { e.stopPropagation(); setShowLegal('terms'); }}
                    className="text-[#facc15] hover:text-yellow-300 transition-colors underline decoration-yellow-400/30"
                  >
                    {(translations[language || 'ru'] as any).terms_conditions}
                  </button>
                </div>
              } 
              checked={termsAccepted} 
              onChange={setTermsAccepted} 
            />
          )}
        </div>

        <div className={`space-y-6 ${isLogin ? 'mt-4' : 'mt-auto pt-4'}`}>
          <Button type="submit" isLoading={isLoading} className="w-full bg-white hover:bg-gray-100 border border-white/10 !text-black shadow-none py-4 text-[13px] uppercase tracking-[0.3em] font-black">{isLogin ? 'Войти в терминал' : isRegister ? 'Создать аккаунт' : 'Продолжить'}</Button>

          {(isLogin || isRegister) && (
            <div className="pt-2">
              <div className="relative flex items-center mb-6">
                <div className="flex-grow border-t border-white/5"></div>
                <span className="mx-6 text-[10px] text-gray-600 uppercase font-black tracking-[0.3em]">или войти через</span>
                <div className="flex-grow border-t border-white/5"></div>
              </div>
              <div className="flex justify-center">
                <div className="relative group/google w-full">
                  <div ref={googleBtnRef} className="absolute inset-0 opacity-0 pointer-events-none z-0"></div>
                  <Button type="button" variant="social" onClick={triggerGoogleLogin} disabled={isLoading} className="w-full py-3.5 flex justify-center items-center gap-4 bg-[#0d0d1a] border border-white/10 rounded-xl hover:bg-[#1a1a2e] transition-all">
                    <GoogleIcon className="w-6 h-6" />
                    <span className="text-[13px] font-black uppercase tracking-[0.3em]">Google</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </form>

      {/* Legal Modal */}
      <LegalModal 
        isOpen={!!showLegal} 
        onClose={() => setShowLegal(null)} 
        language={language || 'ru'} 
        type={showLegal || 'terms'} 
      />
    </div>
  );
};
