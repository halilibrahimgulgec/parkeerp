import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Factory, LogIn, UserPlus, Eye, EyeOff, Mail, ArrowLeft, CheckCircle, Clock } from 'lucide-react';

type Mode = 'login' | 'register' | 'forgot';

export default function LoginPage() {
  const { signIn, signUp, sendPasswordResetEmail, pendingApproval } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('field_manager');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setError('');
    setSuccess('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) setError('E-posta veya şifre hatalı.');
    } finally {
      setLoading(false);
    }
  };

  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500 rounded-2xl mb-4 shadow-lg">
              <Factory size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white">Parke ERP</h1>
          </div>
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock size={32} className="text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Onay Bekleniyor</h2>
            <p className="text-slate-500 text-sm leading-relaxed mb-6">
              Hesabınız oluşturuldu. Sisteme erişmek için yönetici onayı gereklidir.
              Onaylandıktan sonra giriş yapabilirsiniz.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Geri Dön
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      const { error } = await signUp(email, password, fullName, role);
      if (error) setError(error.message);
      else setSuccess('Hesabınız oluşturuldu. Yönetici onayından sonra giriş yapabilirsiniz.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { error } = await sendPasswordResetEmail(email);
      if (error) {
        setError(`Hata: ${error.message}`);
      } else {
        setSuccess('Şifre sıfırlama bağlantısı e-posta adresinize gönderildi. Lütfen gelen kutunuzu kontrol edin.');
      }
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500 rounded-2xl mb-4 shadow-lg">
            <Factory size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Parke ERP</h1>
          <p className="text-slate-400 mt-1">Fabrika Yönetim Sistemi</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* ── FORGOT PASSWORD ── */}
          {mode === 'forgot' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={() => switchMode('login')}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">Şifremi Unuttum</h2>
                  <p className="text-xs text-slate-500">Sıfırlama bağlantısı e-postanıza gönderilecek</p>
                </div>
              </div>

              {success ? (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                    <Mail size={28} className="text-green-600" />
                  </div>
                  <p className="text-sm text-slate-600 text-center leading-relaxed">{success}</p>
                  <button
                    onClick={() => switchMode('login')}
                    className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors"
                  >
                    Giriş sayfasına dön
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgot} className="space-y-4">
                  <p className="text-sm text-slate-500">
                    Kayıtlı e-posta adresinizi girin. Şifre sıfırlama bağlantısı göndereceğiz.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">E-posta</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className={inputClass}
                      placeholder="ornek@sirket.com"
                      required
                      autoFocus
                    />
                  </div>
                  {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">{error}</div>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {loading
                      ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <><Mail size={18} /> Bağlantı Gönder</>
                    }
                  </button>
                </form>
              )}
            </>
          )}

          {/* ── LOGIN / REGISTER ── */}
          {(mode === 'login' || mode === 'register') && (
            <>
              <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
                <button
                  onClick={() => switchMode('login')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Giriş Yap
                </button>
                <button
                  onClick={() => switchMode('register')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Hesap Oluştur
                </button>
              </div>

              <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-4">
                {mode === 'register' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Ad Soyad</label>
                      <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className={inputClass} placeholder="Ahmet Yılmaz" required />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Kullanıcı Rolü</label>
                      <select value={role} onChange={e => setRole(e.target.value)} className={inputClass}>
                        <option value="admin">Yönetici (Tam Erişim)</option>
                        <option value="field_manager">Saha Sorumlusu</option>
                        <option value="weighbridge">Kantar Görevlisi</option>
                      </select>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">E-posta</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="ornek@sirket.com" required />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">Şifre</label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors"
                      >
                        Şifremi Unuttum
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className={inputClass + ' pr-10'}
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">{error}</div>}
                {success && (
                  <div className="p-3 rounded-lg text-sm bg-green-50 text-green-700 flex items-center gap-2">
                    <CheckCircle size={16} />{success}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : mode === 'login' ? (
                    <><LogIn size={18} /> Giriş Yap</>
                  ) : (
                    <><UserPlus size={18} /> Hesap Oluştur</>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          Parke Taşı Fabrikası &copy; 2024 ERP Sistemi
        </p>
      </div>
    </div>
  );
}
