import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile } from '../types';
import { Users, CheckCircle, XCircle, Clock, Shield, RefreshCw } from 'lucide-react';

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-amber-100 text-amber-800',
  field_manager: 'bg-blue-100 text-blue-800',
  weighbridge: 'bg-green-100 text-green-800',
};

export default function AdminUsers() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');

  const adminFetch = useCallback(async (method: string, body?: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-get-users`,
      {
        method,
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      }
    );
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('GET');
      const data = res.ok ? await res.json() : [];
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setUsers([]);
    }
    setLoading(false);
  }, [adminFetch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const approve = async (userId: string) => {
    setActionLoading(userId + '_approve');
    await adminFetch('PATCH', {
      id: userId,
      is_approved: true,
      approved_at: new Date().toISOString(),
      approved_by: profile?.id,
    });
    await fetchUsers();
    setActionLoading(null);
  };

  const revoke = async (userId: string) => {
    setActionLoading(userId + '_revoke');
    await adminFetch('PATCH', {
      id: userId,
      is_approved: false,
      approved_at: null,
      approved_by: null,
    });
    await fetchUsers();
    setActionLoading(null);
  };

  const changeRole = async (userId: string, role: string) => {
    await adminFetch('PATCH', { id: userId, role });
    await fetchUsers();
  };

  const pending = users.filter(u => !u.is_approved && u.id !== profile?.id);
  const approved = users.filter(u => u.is_approved);
  const displayed = tab === 'pending' ? pending : approved;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Kullanıcı Yönetimi</h1>
            <p className="text-slate-500 text-sm">Kayıt taleplerini onaylayın veya reddedin</p>
          </div>
        </div>
        <button
          onClick={fetchUsers}
          className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors text-sm font-medium"
        >
          <RefreshCw size={16} />
          Yenile
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <Clock size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{pending.length}</p>
              <p className="text-slate-500 text-sm">Onay Bekleyen</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <CheckCircle size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{approved.length}</p>
              <p className="text-slate-500 text-sm">Onaylı Kullanıcı</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Shield size={20} className="text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{users.length}</p>
              <p className="text-slate-500 text-sm">Toplam Kayıt</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setTab('pending')}
            className={`flex-1 py-4 text-sm font-medium transition-colors relative ${
              tab === 'pending' ? 'text-amber-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Onay Bekleyenler
            {pending.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
            {tab === 'pending' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setTab('approved')}
            className={`flex-1 py-4 text-sm font-medium transition-colors relative ${
              tab === 'approved' ? 'text-amber-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Onaylı Kullanıcılar
            {tab === 'approved' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
            )}
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                {tab === 'pending' ? <Clock size={24} className="text-slate-400" /> : <Users size={24} className="text-slate-400" />}
              </div>
              <p className="text-slate-500 text-sm">
                {tab === 'pending' ? 'Onay bekleyen kullanıcı yok.' : 'Onaylı kullanıcı yok.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayed.map(u => (
                <div key={u.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all">
                  <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-slate-600 font-bold text-sm">
                      {u.full_name.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{u.full_name}</p>
                    <p className="text-xs text-slate-500">
                      Kayıt: {new Date(u.created_at).toLocaleDateString('tr-TR')}
                      {u.approved_at && ` · Onay: ${new Date(u.approved_at).toLocaleDateString('tr-TR')}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <select
                      value={u.role}
                      onChange={e => changeRole(u.id, e.target.value)}
                      className={`text-xs font-medium px-2 py-1 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 ${ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-700'}`}
                    >
                      <option value="admin">Yönetici</option>
                      <option value="field_manager">Saha Sorumlusu</option>
                      <option value="weighbridge">Kantar Görevlisi</option>
                    </select>

                    {tab === 'pending' ? (
                      <button
                        onClick={() => approve(u.id)}
                        disabled={actionLoading === u.id + '_approve'}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
                      >
                        {actionLoading === u.id + '_approve'
                          ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <CheckCircle size={14} />
                        }
                        Onayla
                      </button>
                    ) : (
                      <button
                        onClick={() => revoke(u.id)}
                        disabled={actionLoading === u.id + '_revoke'}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
                      >
                        {actionLoading === u.id + '_revoke'
                          ? <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          : <XCircle size={14} />
                        }
                        Erişimi Kaldır
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
