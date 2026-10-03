import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Company } from '../types';
import {
  Building2, Plus, Search, ShieldCheck, CheckCircle2,
  XCircle, Clock, AlertTriangle, RefreshCw, Edit2, Users,
  Globe, Calendar, Key, Mail, Phone, MapPin
} from 'lucide-react';

export default function SuperAdminCompanies() {
  const { profile, isSuperAdmin } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyUserCounts, setCompanyUserCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTaxNumber, setFormTaxNumber] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPlan, setFormPlan] = useState<'starter' | 'pro' | 'enterprise'>('pro');
  const [formValidUntil, setFormValidUntil] = useState(
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [formError, setFormError] = useState('');

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const [compRes, usersRes] = await Promise.all([
        supabase.from('companies').select('*').order('created_at', { ascending: false }),
        supabase.from('user_profiles').select('id, company_id')
      ]);

      if (compRes.error) throw compRes.error;
      setCompanies(compRes.data || []);

      const counts: Record<string, number> = {};
      (usersRes.data || []).forEach((u: any) => {
        if (u.company_id) {
          counts[u.company_id] = (counts[u.company_id] || 0) + 1;
        }
      });
      setCompanyUserCounts(counts);
    } catch (err: any) {
      console.error('Firmalar yüklenirken hata:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const handleOpenAddModal = () => {
    setEditingCompany(null);
    setFormName('');
    setFormSlug('');
    setFormPhone('');
    setFormEmail('');
    setFormTaxNumber('');
    setFormAddress('');
    setFormPlan('pro');
    setFormValidUntil(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (comp: Company) => {
    setEditingCompany(comp);
    setFormName(comp.name);
    setFormSlug(comp.slug);
    setFormPhone(comp.phone || '');
    setFormEmail(comp.email || '');
    setFormTaxNumber(comp.tax_number || '');
    setFormAddress(comp.address || '');
    setFormPlan(comp.subscription_plan || 'pro');
    setFormValidUntil(comp.valid_until ? comp.valid_until.split('T')[0] : '');
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanSlug = formSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!formName.trim() || !cleanSlug) {
      setFormError('Lütfen firma adı ve URL kodunu eksiksiz doldurun.');
      return;
    }

    try {
      if (editingCompany) {
        // Update
        const { error } = await supabase
          .from('companies')
          .update({
            name: formName.trim(),
            slug: cleanSlug,
            phone: formPhone.trim(),
            email: formEmail.trim(),
            tax_number: formTaxNumber.trim(),
            address: formAddress.trim(),
            subscription_plan: formPlan,
            valid_until: formValidUntil ? new Date(formValidUntil).toISOString() : null,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingCompany.id);

        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('companies')
          .insert({
            name: formName.trim(),
            slug: cleanSlug,
            phone: formPhone.trim(),
            email: formEmail.trim(),
            tax_number: formTaxNumber.trim(),
            address: formAddress.trim(),
            subscription_plan: formPlan,
            is_active: true,
            valid_until: formValidUntil ? new Date(formValidUntil).toISOString() : null,
          });

        if (error) throw error;
      }

      setIsModalOpen(false);
      await fetchCompanies();
    } catch (err: any) {
      setFormError(err.message || 'Firma kaydedilirken bir hata oluştu.');
    }
  };

  const toggleCompanyStatus = async (comp: Company) => {
    setActionLoading(comp.id);
    try {
      const nextStatus = !comp.is_active;
      const { error } = await supabase
        .from('companies')
        .update({ is_active: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', comp.id);

      if (error) throw error;
      await fetchCompanies();
    } catch (err: any) {
      console.error('Firma durumu güncellenirken hata:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredCompanies = companies.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  });

  const activeCount = companies.filter((c) => c.is_active).length;
  const suspendedCount = companies.length - activeCount;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <Building2 size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <span>SaaS Firma & Kiracı Yönetimi</span>
              <span className="text-xs bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                Süper Admin
              </span>
            </h1>
            <p className="text-slate-500 text-sm">
              Sistemdeki tüm bağımsız şirketleri, lisans sürelerini ve erişim izinlerini yönetin.
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-colors cursor-pointer"
        >
          <Plus size={18} />
          <span>Yeni Firma Oluştur</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Toplam Firma</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{companies.length}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Building2 size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Aktif Abonelikler</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{activeCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Askıya Alınanlar</p>
            <p className="text-2xl font-black text-rose-600 mt-1">{suspendedCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertTriangle size={20} />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Toplam Alt Kullanıcı</p>
            <p className="text-2xl font-black text-blue-600 mt-1">
              {Object.values(companyUserCounts).reduce((a, b) => a + b, 0)}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users size={20} />
          </div>
        </div>
      </div>

      {/* Search & Actions Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Firma adı, kod veya telefon ara..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        <button
          onClick={fetchCompanies}
          className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition-colors cursor-pointer shrink-0"
          title="Yenile"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Companies Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="p-4">FİRMA ÜNVANI / KOD</th>
                <th className="p-4">İLETİŞİM</th>
                <th className="p-4">PAKET</th>
                <th className="p-4">LİSANS GEÇERLİLİK</th>
                <th className="p-4 text-center">ALT KULLANICI</th>
                <th className="p-4 text-center">DURUM</th>
                <th className="p-4 text-right">İŞLEMLER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    Firmalar yükleniyor...
                  </td>
                </tr>
              ) : filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    Aramanıza uygun firma kaydı bulunamadı.
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((c) => {
                  const userCount = companyUserCounts[c.id] || 0;
                  const isSuspended = !c.is_active;

                  return (
                    <tr key={c.id} className={`hover:bg-slate-50/80 transition-colors ${isSuspended ? 'bg-rose-50/20' : ''}`}>
                      <td className="p-4 font-bold text-slate-900">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-black flex items-center justify-center text-sm border border-slate-200 shrink-0">
                            {c.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-extrabold text-slate-900">{c.name}</div>
                            <div className="text-xs text-indigo-600 font-mono font-medium flex items-center gap-1">
                              <Globe size={11} />
                              <span>{c.slug}.parkeerp.com</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4 text-xs text-slate-600">
                        {c.phone && <div className="font-mono">{c.phone}</div>}
                        {c.email && <div className="text-slate-400">{c.email}</div>}
                        {!c.phone && !c.email && <span className="text-slate-300">-</span>}
                      </td>

                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${
                          c.subscription_plan === 'enterprise'
                            ? 'bg-purple-100 text-purple-800 border-purple-200'
                            : c.subscription_plan === 'pro'
                            ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : 'bg-slate-100 text-slate-800 border-slate-200'
                        }`}>
                          {c.subscription_plan || 'Standart'}
                        </span>
                      </td>

                      <td className="p-4 text-xs font-medium text-slate-700">
                        {c.valid_until ? (
                          <div className="flex items-center gap-1.5">
                            <Calendar size={13} className="text-slate-400" />
                            <span>{new Date(c.valid_until).toLocaleDateString('tr-TR')}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Sınırsız</span>
                        )}
                      </td>

                      <td className="p-4 text-center">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                          {userCount} Kullanıcı
                        </span>
                      </td>

                      <td className="p-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleCompanyStatus(c)}
                          disabled={actionLoading === c.id}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer transition-colors ${
                            c.is_active
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-200'
                              : 'bg-rose-100 text-rose-800 hover:bg-rose-200 border border-rose-200'
                          }`}
                        >
                          {c.is_active ? (
                            <>
                              <CheckCircle2 size={12} />
                              <span>Aktif</span>
                            </>
                          ) : (
                            <>
                              <XCircle size={12} />
                              <span>Askıda</span>
                            </>
                          )}
                        </button>
                      </td>

                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleOpenEditModal(c)}
                          className="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                          <Edit2 size={12} />
                          <span>Düzenle</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Company Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Building2 size={20} className="text-indigo-600" />
                <span>{editingCompany ? 'Firma Bilgilerini Düzenle' : 'Yeni Müşteri Firma Tanımla'}</span>
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 text-xs font-medium">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveCompany} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Firma Ticari Ünvanı *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Öz Parke Beton Ürünleri San. Tic. Ltd."
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (!editingCompany) {
                      // Auto slug suggestion
                      setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'));
                    }
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    URL / Sistem Kodu *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="oz-parke"
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Paket / Lisans
                  </label>
                  <select
                    value={formPlan}
                    onChange={(e: any) => setFormPlan(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="starter">Standart (Starter)</option>
                    <option value="pro">Gelişmiş (Pro)</option>
                    <option value="enterprise">Kurumsal (Enterprise)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Telefon
                  </label>
                  <input
                    type="text"
                    placeholder="0352 000 00 00"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Yetkili E-posta
                  </label>
                  <input
                    type="email"
                    placeholder="info@ozparke.com"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Vergi Kimlik No
                  </label>
                  <input
                    type="text"
                    placeholder="1234567890"
                    value={formTaxNumber}
                    onChange={(e) => setFormTaxNumber(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Lisans Bitiş Tarihi
                  </label>
                  <input
                    type="date"
                    value={formValidUntil}
                    onChange={(e) => setFormValidUntil(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Fabrika / Tesis Adresi
                </label>
                <textarea
                  rows={2}
                  placeholder="Organize Sanayi Bölgesi..."
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-sm transition-colors cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors cursor-pointer"
                >
                  {editingCompany ? 'Değişiklikleri Kaydet' : 'Firmayı Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
