import React, { useState, useEffect, useCallback } from 'react';
import { supabase, createIsolatedClient } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, Company, UserRole } from '../types';
import {
  Users, CheckCircle, XCircle, Clock, Shield, RefreshCw,
  Plus, Building2, Mail, Lock, User, Eye, EyeOff
} from 'lucide-react';

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-amber-100 text-amber-800',
  field_manager: 'bg-blue-100 text-blue-800',
  weighbridge: 'bg-green-100 text-green-800',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Firma Yöneticisi',
  field_manager: 'Saha Sorumlusu',
  weighbridge: 'Kantar Görevlisi',
};

export default function AdminUsers() {
  const { profile, isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');

  // Add User Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addFullName, setAddFullName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRole, setAddRole] = useState<UserRole>('field_manager');
  const [addCompanyId, setAddCompanyId] = useState<string>('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');

  const fetchUsersAndCompanies = useCallback(async () => {
    setLoading(true);
    try {
      let userQuery = supabase
        .from('user_profiles')
        .select('*, companies(*)')
        .order('created_at', { ascending: false });

      // If not super admin, strictly filter to current company
      if (!profile?.is_super_admin && profile?.company_id) {
        userQuery = userQuery.eq('company_id', profile.company_id);
      }

      const [usersRes, compRes] = await Promise.all([
        userQuery,
        profile?.is_super_admin
          ? supabase.from('companies').select('*').order('name', { ascending: true })
          : Promise.resolve({ data: [] as Company[], error: null }),
      ]);

      if (usersRes.error) throw usersRes.error;
      setUsers(usersRes.data || []);
      if (compRes.data) setCompanies(compRes.data);
    } catch (err: any) {
      console.error('Kullanıcılar yüklenirken hata oluştu:', err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    fetchUsersAndCompanies();
  }, [fetchUsersAndCompanies]);

  const approve = async (userId: string) => {
    setActionLoading(userId + '_approve');
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          is_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: profile?.id,
        })
        .eq('id', userId);
      if (error) throw error;
      await fetchUsersAndCompanies();
    } catch (err) {
      console.error('Kullanıcı onaylanırken hata oluştu:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const revoke = async (userId: string) => {
    setActionLoading(userId + '_revoke');
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          is_approved: false,
          approved_at: null,
          approved_by: null,
        })
        .eq('id', userId);
      if (error) throw error;
      await fetchUsersAndCompanies();
    } catch (err) {
      console.error('Kullanıcı yetkisi kaldırılırken hata oluştu:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const changeRole = async (userId: string, role: any) => {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role })
        .eq('id', userId);
      if (error) throw error;
      await fetchUsersAndCompanies();
    } catch (err) {
      console.error('Rol değiştirilirken hata oluştu:', err);
    }
  };

  const handleOpenAddUser = () => {
    setAddFullName('');
    setAddEmail('');
    setAddPassword('');
    setAddRole('field_manager');
    setAddCompanyId(profile?.company_id || (companies[0]?.id ?? ''));
    setAddError('');
    setAddSuccess('');
    setIsAddModalOpen(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    setAddLoading(true);

    try {
      const targetCompany = profile?.is_super_admin ? addCompanyId : profile?.company_id;
      if (!targetCompany) {
        throw new Error('Lütfen kullanıcının atanacağı firmayı seçin.');
      }

      // Create user via isolated client so current admin session is not lost
      const isolatedClient = createIsolatedClient();
      const { data, error } = await isolatedClient.auth.signUp({
        email: addEmail.trim(),
        password: addPassword,
      });

      if (error) throw error;

      if (data.user) {
        // Automatically approve the user created directly by company admin
        const { error: profileError } = await supabase
          .from('user_profiles')
          .upsert({
            id: data.user.id,
            full_name: addFullName.trim(),
            role: addRole,
            company_id: targetCompany,
            is_approved: true,
            approved_at: new Date().toISOString(),
            approved_by: profile?.id,
          });

        if (profileError) throw profileError;
      }

      setAddSuccess('Alt kullanıcı başarıyla oluşturuldu ve onaylandı.');
      setTimeout(() => {
        setIsAddModalOpen(false);
        fetchUsersAndCompanies();
      }, 1200);
    } catch (err: any) {
      setAddError(err.message || 'Kullanıcı oluşturulurken bir hata oluştu.');
    } finally {
      setAddLoading(false);
    }
  };

  // Filter users by company (for super admin)
  const filteredUsers = users.filter((u) => {
    if (selectedCompanyFilter !== 'all' && u.company_id !== selectedCompanyFilter) {
      return false;
    }
    return true;
  });

  const pending = filteredUsers.filter((u) => !u.is_approved && u.id !== profile?.id);
  const approved = filteredUsers.filter((u) => u.is_approved);
  const displayed = tab === 'pending' ? pending : approved;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-200">
            <Users size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <span>Kullanıcı & Alt Ekip Yönetimi</span>
              {profile?.company?.name && (
                <span className="text-xs bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                  {profile.company.name}
                </span>
              )}
            </h1>
            <p className="text-slate-500 text-sm">
              {profile?.is_super_admin
                ? 'Sistemdeki tüm firmaların kullanıcılarını ve yetkilerini yönetin.'
                : 'Firmanızın saha, kantar ve yönetici kullanıcılarını yönetin.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsersAndCompanies}
            className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors text-sm font-medium border border-slate-200 cursor-pointer"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            <span>Yenile</span>
          </button>

          <button
            onClick={handleOpenAddUser}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-colors text-sm font-bold shadow-md cursor-pointer"
          >
            <Plus size={18} />
            <span>Yeni Alt Kullanıcı Ekle</span>
          </button>
        </div>
      </div>

      {/* Super Admin Company Filter */}
      {profile?.is_super_admin && companies.length > 0 && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
          <Building2 size={20} className="text-indigo-600 shrink-0" />
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700">Firma Filtresi (Süper Admin):</span>
            <select
              value={selectedCompanyFilter}
              onChange={(e) => setSelectedCompanyFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">Tüm Firmalar ({users.length} Kullanıcı)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({users.filter((u) => u.company_id === c.id).length})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
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

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
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

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
              <Shield size={20} className="text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{filteredUsers.length}</p>
              <p className="text-slate-500 text-sm">Toplam Kullanıcı</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50/50">
          <button
            onClick={() => setTab('pending')}
            className={`flex-1 py-4 text-sm font-bold transition-colors relative cursor-pointer ${
              tab === 'pending' ? 'text-amber-600 bg-white' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Onay Bekleyen Talepler
            {pending.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs font-black px-2 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
            {tab === 'pending' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setTab('approved')}
            className={`flex-1 py-4 text-sm font-bold transition-colors relative cursor-pointer ${
              tab === 'approved' ? 'text-amber-600 bg-white' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Onaylı Aktif Kullanıcılar
            {approved.length > 0 && (
              <span className="ml-2 bg-emerald-500 text-white text-xs font-black px-2 py-0.5 rounded-full">
                {approved.length}
              </span>
            )}
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
                {tab === 'pending' ? 'Onay bekleyen kullanıcı kaydı yok.' : 'Kayıtlı aktif kullanıcı bulunamadı.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayed.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-slate-200 text-slate-700 font-black rounded-full flex items-center justify-center shrink-0">
                      {u.full_name ? u.full_name.charAt(0).toUpperCase() : 'U'}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-800 truncate">{u.full_name || 'İsimsiz'}</span>
                        {u.is_super_admin && (
                          <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.2 rounded border border-purple-200">
                            Süper Admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        {u.companies?.name && (
                          <span className="text-indigo-600 font-semibold flex items-center gap-1">
                            <Building2 size={11} />
                            <span>{u.companies.name}</span>
                          </span>
                        )}
                        <span>Kayıt: {new Date(u.created_at).toLocaleDateString('tr-TR')}</span>
                        {u.approved_at && (
                          <span>· Onay: {new Date(u.approved_at).toLocaleDateString('tr-TR')}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value)}
                      className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400 ${ROLE_COLORS[u.role] || 'bg-slate-100 text-slate-700'}`}
                    >
                      <option value="admin">{ROLE_LABELS.admin}</option>
                      <option value="field_manager">{ROLE_LABELS.field_manager}</option>
                      <option value="weighbridge">{ROLE_LABELS.weighbridge}</option>
                    </select>

                    {tab === 'pending' ? (
                      <button
                        onClick={() => approve(u.id)}
                        disabled={actionLoading === u.id + '_approve'}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-60 cursor-pointer shadow-xs"
                      >
                        {actionLoading === u.id + '_approve' ? (
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <CheckCircle size={14} />
                        )}
                        <span>Onayla</span>
                      </button>
                    ) : (
                      u.id !== profile?.id && (
                        <button
                          onClick={() => revoke(u.id)}
                          disabled={actionLoading === u.id + '_revoke'}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-60 cursor-pointer"
                        >
                          {actionLoading === u.id + '_revoke' ? (
                            <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <XCircle size={14} />
                          )}
                          <span>Erişimi Kaldır</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Sub-User Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Users size={20} className="text-amber-500" />
                <span>Yeni Alt Kullanıcı Tanımla</span>
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {addError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 text-xs font-medium">
                {addError}
              </div>
            )}
            {addSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5">
                <CheckCircle size={16} />
                <span>{addSuccess}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3">
              {profile?.is_super_admin && companies.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Atanacağı Firma *
                  </label>
                  <select
                    required
                    value={addCompanyId}
                    onChange={(e) => setAddCompanyId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">Firma Seçin...</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Kullanıcı Adı & Soyadı *
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="Ahmet Yılmaz"
                    value={addFullName}
                    onChange={(e) => setAddFullName(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Giriş E-postası *
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    placeholder="kantar@sirketiniz.com"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  İlk Giriş Şifresi *
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="En az 6 karakter"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Kullanıcı Görevi / Rolü *
                </label>
                <select
                  value={addRole}
                  onChange={(e: any) => setAddRole(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="weighbridge">Kantar Görevlisi (Tartım & Sevkiyat & İrsaliye)</option>
                  <option value="field_manager">Saha Sorumlusu (Üretim Girişi & Stok Takibi)</option>
                  <option value="admin">Firma Yöneticisi (Tüm Yetkiler & Raporlar)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-sm transition-colors cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
                >
                  {addLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CheckCircle size={16} />
                  )}
                  <span>Kullanıcıyı Kaydet</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
