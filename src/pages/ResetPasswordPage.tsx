import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Factory, KeyRound, Eye, EyeOff, CheckCircle } from 'lucide-react';

interface Props {
  onDone: () => void;
}

export default function ResetPasswordPage({ onDone }: Props) {
  const { updatePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('Şifre en az 6 karakter olmalıdır.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await updatePassword(newPassword);
      if (error) {
        setError('Şifre güncellenemedi. Lütfen tekrar deneyin.');
      } else {
        setDone(true);
        setTimeout(() => onDone(), 2500);
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
          {done ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle size={36} className="text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-slate-800">Şifreniz Güncellendi</h2>
              <p className="text-sm text-slate-500 text-center">Yeni şifrenizle giriş yapabilirsiniz. Giriş sayfasına yönlendiriliyorsunuz...</p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-slate-800">Yeni Şifre Belirle</h2>
                <p className="text-sm text-slate-500 mt-1">Hesabınız için yeni bir şifre oluşturun.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Yeni Şifre</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className={inputClass + ' pr-10'}
                      placeholder="En az 6 karakter"
                      required
                      autoFocus
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

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Şifre Tekrar</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className={inputClass}
                    placeholder="••••••••"
                    required
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <><KeyRound size={18} /> Şifreyi Kaydet</>
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
