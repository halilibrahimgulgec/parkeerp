import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Mold, MoldSummary, MoldMaintenanceLog, Product, Company } from '../types';
import {
  Layers,
  Plus,
  Search,
  Filter,
  RefreshCw,
  FileSpreadsheet,
  Printer,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Boxes,
  Factory,
  ChevronRight,
  X,
  Edit2,
  Trash2,
  Activity,
  History,
  Gauge,
  Sparkles,
  Building2,
} from 'lucide-react';

export default function MoldsPage() {
  const { user, profile, isSuperAdmin, isAdmin } = useAuth();

  // Multi-tenant isolation
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    return localStorage.getItem('parke_molds_selected_company') || '';
  });

  const targetCompanyId = useMemo(() => {
    if (isSuperAdmin()) {
      return selectedCompanyId || profile?.company_id || '';
    }
    return profile?.company_id || '';
  }, [isSuperAdmin, selectedCompanyId, profile?.company_id]);

  useEffect(() => {
    if (isSuperAdmin()) {
      supabase
        .from('companies')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setCompanies(data);
            if (!selectedCompanyId) {
              const defaultId = profile?.company_id || data[0].id;
              setSelectedCompanyId(defaultId);
              localStorage.setItem('parke_molds_selected_company', defaultId);
            }
          }
        });
    }
  }, [isSuperAdmin, profile?.company_id, selectedCompanyId]);

  // Data states
  const [molds, setMolds] = useState<MoldSummary[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'mounted' | 'active' | 'maintenance' | 'retired'>('all');
  const [machineFilter, setMachineFilter] = useState<string>('all');
  const [schemaMissing, setSchemaMissing] = useState(false);

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMold, setEditingMold] = useState<Mold | null>(null);

  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [selectedMoldForMaint, setSelectedMoldForMaint] = useState<MoldSummary | null>(null);

  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [selectedMoldForLedger, setSelectedMoldForLedger] = useState<MoldSummary | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Maintenance history modal
  const [isMaintHistoryOpen, setIsMaintHistoryOpen] = useState(false);
  const [selectedMoldForMaintHistory, setSelectedMoldForMaintHistory] = useState<MoldSummary | null>(null);
  const [maintLogs, setMaintLogs] = useState<MoldMaintenanceLog[]>([]);
  const [loadingMaintLogs, setLoadingMaintLogs] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    machine_no: '1',
    m2_per_stroke: 1.0,
    initial_m2: 0,
    target_lifespan_m2: 100000,
    maintenance_interval_m2: 25000,
    status: 'active' as 'active' | 'mounted' | 'maintenance' | 'retired',
    notes: '',
    selected_product_ids: [] as string[],
  });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Maintenance Form State
  const [maintData, setMaintData] = useState({
    date: new Date().toISOString().split('T')[0],
    action_type: 'taslama' as 'taslama' | 'temizlik' | 'plaka_degisimi' | 'kaynak' | 'diger',
    service_provider: '',
    cost: 0,
    notes: '',
  });
  const [maintSaving, setMaintSaving] = useState(false);

  // 1. Fetch Molds and Products
  const loadData = async () => {
    setLoading(true);
    try {
      // 1a. Products
      let prodQ = supabase.from('products').select('*').eq('is_active', true).order('name', { ascending: true });
      if (targetCompanyId) prodQ = prodQ.eq('company_id', targetCompanyId);
      const { data: prodData } = await prodQ;
      setProducts(prodData || []);

      // 1b. Molds with summary
      let moldQ = supabase.from('molds').select('*, mold_products(product_id, products(id, name, thickness, color, unit))').order('name', { ascending: true });
      if (targetCompanyId) moldQ = moldQ.eq('company_id', targetCompanyId);
      const { data: rawMolds, error: mErr } = await moldQ;

      if (mErr) {
        if (mErr.code === 'PGRST205' || mErr.message?.includes('molds')) {
          setSchemaMissing(true);
        }
        throw mErr;
      } else {
        setSchemaMissing(false);
      }

      // 1c. Calculate usage for each mold from production_entries
      let prodEntriesQ = supabase.from('production_entries').select('id, mold_id, net_m2, date');
      if (targetCompanyId) prodEntriesQ = prodEntriesQ.eq('company_id', targetCompanyId);
      const { data: pEntries } = await prodEntriesQ;

      // 1d. Maintenance counts
      let maintQ = supabase.from('mold_maintenance_logs').select('mold_id, date');
      if (targetCompanyId) maintQ = maintQ.eq('company_id', targetCompanyId);
      const { data: mLogs } = await maintQ;

      const entriesByMold: Record<string, { total_m2: number; last_date: string | null }> = {};
      (pEntries || []).forEach((pe: any) => {
        if (!pe.mold_id) return;
        if (!entriesByMold[pe.mold_id]) {
          entriesByMold[pe.mold_id] = { total_m2: 0, last_date: null };
        }
        entriesByMold[pe.mold_id].total_m2 += Number(pe.net_m2) || 0;
        if (!entriesByMold[pe.mold_id].last_date || pe.date > entriesByMold[pe.mold_id].last_date!) {
          entriesByMold[pe.mold_id].last_date = pe.date;
        }
      });

      const maintByMold: Record<string, { count: number; last_date: string | null }> = {};
      (mLogs || []).forEach((ml: any) => {
        if (!maintByMold[ml.mold_id]) {
          maintByMold[ml.mold_id] = { count: 0, last_date: null };
        }
        maintByMold[ml.mold_id].count++;
        if (!maintByMold[ml.mold_id].last_date || ml.date > maintByMold[ml.mold_id].last_date!) {
          maintByMold[ml.mold_id].last_date = ml.date;
        }
      });

      const summarized: MoldSummary[] = (rawMolds || []).map((m: any) => {
        const prodStats = entriesByMold[m.id] || { total_m2: 0, last_date: null };
        const mStats = maintByMold[m.id] || { count: 0, last_date: null };

        const totalProduced = Number((Number(m.initial_m2 || 0) + prodStats.total_m2).toFixed(2));
        const strokeMultiplier = Number(m.m2_per_stroke) > 0 ? Number(m.m2_per_stroke) : 1;
        const totalStrokes = Math.round(totalProduced / strokeMultiplier);

        const targetLife = Number(m.target_lifespan_m2) > 0 ? Number(m.target_lifespan_m2) : 100000;
        const wearPct = Number(((totalProduced / targetLife) * 100).toFixed(1));

        return {
          ...m,
          total_produced_m2: totalProduced,
          total_strokes: totalStrokes,
          wear_percentage: wearPct,
          last_production_date: prodStats.last_date,
          maintenance_count: mStats.count,
          last_maintenance_date: mStats.last_date,
        };
      });

      setMolds(summarized);
    } catch (err: any) {
      console.error('Kalıp verileri yüklenirken hata:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [targetCompanyId]);

  // Filtered Molds
  const filteredMolds = useMemo(() => {
    return molds.filter((m) => {
      // Status filter
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;

      // Machine filter
      if (machineFilter !== 'all') {
        if (m.machine_no !== machineFilter && m.machine_no !== 'hepsi') return false;
      }

      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchCode = m.code.toLowerCase().includes(q);
        const matchName = m.name.toLowerCase().includes(q);
        const matchProducts = (m.mold_products || []).some((mp: any) => mp.products?.name?.toLowerCase().includes(q));
        if (!matchCode && !matchName && !matchProducts) return false;
      }

      return true;
    });
  }, [molds, statusFilter, machineFilter, search]);

  // Overall KPIs
  const stats = useMemo(() => {
    const totalCount = molds.length;
    const activeCount = molds.filter((m) => m.status === 'active' || m.status === 'mounted').length;
    const mountedCount = molds.filter((m) => m.status === 'mounted').length;
    const totalFootage = molds.reduce((sum, m) => sum + (m.total_produced_m2 || 0), 0);
    const totalStrokes = molds.reduce((sum, m) => sum + (m.total_strokes || 0), 0);
    const criticalCount = molds.filter((m) => m.wear_percentage >= 80).length;

    return { totalCount, activeCount, mountedCount, totalFootage, totalStrokes, criticalCount };
  }, [molds]);

  // Handle Open Create / Edit
  const handleOpenCreate = () => {
    setEditingMold(null);
    setFormData({
      code: `KLP-${String(molds.length + 1).padStart(2, '0')}`,
      name: '',
      machine_no: '1',
      m2_per_stroke: 1.0,
      initial_m2: 0,
      target_lifespan_m2: 100000,
      maintenance_interval_m2: 25000,
      status: 'active',
      notes: '',
      selected_product_ids: [],
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (mold: MoldSummary) => {
    setEditingMold(mold);
    const linkedIds = (mold.mold_products || []).map((mp) => mp.product_id);
    setFormData({
      code: mold.code,
      name: mold.name,
      machine_no: mold.machine_no,
      m2_per_stroke: mold.m2_per_stroke || 1.0,
      initial_m2: mold.initial_m2 || 0,
      target_lifespan_m2: mold.target_lifespan_m2 || 100000,
      maintenance_interval_m2: mold.maintenance_interval_m2 || 25000,
      status: mold.status,
      notes: mold.notes || '',
      selected_product_ids: linkedIds,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  // Save Mold
  const handleSaveMold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim()) {
      setFormError('Lütfen kalıp adını ve kodunu giriniz.');
      return;
    }
    setFormSaving(true);
    setFormError(null);

    try {
      const moldPayload: any = {
        code: formData.code.trim(),
        name: formData.name.trim(),
        machine_no: formData.machine_no,
        m2_per_stroke: Number(formData.m2_per_stroke) || 1.0,
        initial_m2: Number(formData.initial_m2) || 0,
        target_lifespan_m2: Number(formData.target_lifespan_m2) || 100000,
        maintenance_interval_m2: Number(formData.maintenance_interval_m2) || 25000,
        status: formData.status,
        notes: formData.notes.trim(),
        company_id: targetCompanyId || null,
        updated_at: new Date().toISOString(),
      };

      let moldId = editingMold?.id;

      if (editingMold) {
        const { error: updErr } = await supabase.from('molds').update(moldPayload).eq('id', editingMold.id);
        if (updErr) throw updErr;
      } else {
        const { data: insData, error: insErr } = await supabase.from('molds').insert(moldPayload).select().single();
        if (insErr) throw insErr;
        moldId = insData.id;
      }

      // Update linked products
      if (moldId) {
        // Delete existing links
        await supabase.from('mold_products').delete().eq('mold_id', moldId);

        // Insert new links
        if (formData.selected_product_ids.length > 0) {
          const links = formData.selected_product_ids.map((pid) => ({
            mold_id: moldId,
            product_id: pid,
            company_id: targetCompanyId || null,
          }));
          const { error: linkErr } = await supabase.from('mold_products').insert(links);
          if (linkErr) throw linkErr;
        }
      }

      setIsFormOpen(false);
      await loadData();
    } catch (err: any) {
      console.error('Kalıp kaydedilirken hata:', err);
      setFormError(`Kayıt hatası: ${err.message}`);
    } finally {
      setFormSaving(false);
    }
  };

  // Delete Mold
  const handleDeleteMold = async (mold: MoldSummary) => {
    if (!confirm(`"${mold.name}" (${mold.code}) kalıbını silmek istediğinize emin misiniz?`)) return;
    try {
      const { error } = await supabase.from('molds').delete().eq('id', mold.id);
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      alert(`Silme hatası: ${err.message}`);
    }
  };

  // Open Ledger
  const handleOpenLedger = async (mold: MoldSummary) => {
    setSelectedMoldForLedger(mold);
    setIsLedgerOpen(true);
    setLoadingLedger(true);

    try {
      const { data, error } = await supabase
        .from('production_entries')
        .select('id, date, shift, machine_no, total_pallets, net_m2, waste_m2, lot_number, notes, products(name, thickness, color, unit)')
        .eq('mold_id', mold.id)
        .order('date', { ascending: false });

      if (error) throw error;
      setLedgerEntries(data || []);
    } catch (err: any) {
      console.error('Baskı ekstresi yüklenirken hata:', err);
    } finally {
      setLoadingLedger(false);
    }
  };

  // Open Maintenance Modal
  const handleOpenMaintenance = (mold: MoldSummary) => {
    setSelectedMoldForMaint(mold);
    setMaintData({
      date: new Date().toISOString().split('T')[0],
      action_type: 'taslama',
      service_provider: '',
      cost: 0,
      notes: '',
    });
    setIsMaintenanceOpen(true);
  };

  const handleSaveMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMoldForMaint) return;
    setMaintSaving(true);

    try {
      const payload = {
        mold_id: selectedMoldForMaint.id,
        company_id: targetCompanyId || null,
        date: maintData.date,
        action_type: maintData.action_type,
        service_provider: maintData.service_provider.trim(),
        cost: Number(maintData.cost) || 0,
        footage_at_maintenance: selectedMoldForMaint.total_produced_m2 || 0,
        notes: maintData.notes.trim(),
      };

      const { error } = await supabase.from('mold_maintenance_logs').insert(payload);
      if (error) throw error;

      setIsMaintenanceOpen(false);
      await loadData();
    } catch (err: any) {
      alert(`Bakım kaydedilirken hata: ${err.message}`);
    } finally {
      setMaintSaving(false);
    }
  };

  // Open Maintenance History Modal
  const handleOpenMaintHistory = async (mold: MoldSummary) => {
    setSelectedMoldForMaintHistory(mold);
    setIsMaintHistoryOpen(true);
    setLoadingMaintLogs(true);

    try {
      const { data, error } = await supabase
        .from('mold_maintenance_logs')
        .select('*')
        .eq('mold_id', mold.id)
        .order('date', { ascending: false });

      if (error) throw error;
      setMaintLogs(data || []);
    } catch (err: any) {
      console.error('Bakım geçmişi yüklenirken hata:', err);
    } finally {
      setLoadingMaintLogs(false);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredMolds.length === 0) return;

    const headers = [
      'Kalıp Kodu',
      'Kalıp Adı',
      'Makine',
      'Durum',
      'Bağlı Ürünler',
      'Devir Metrajı (m²)',
      'Toplam Basılan (m²)',
      'Tahmini Baskı/Vuruş',
      'Hedef Ömür (m²)',
      'Aşınma (%)',
      'Son Üretim Tarihi',
      'Bakım Adedi',
    ];

    const rows = filteredMolds.map((m) => [
      `"${m.code}"`,
      `"${m.name}"`,
      m.machine_no === 'hepsi' ? 'Her İkisi' : `Makine ${m.machine_no}`,
      m.status === 'mounted' ? 'Makinede Takılı' : m.status === 'active' ? 'Rafta / Hazır' : m.status === 'maintenance' ? 'Bakımda' : 'Hurda',
      `"${(m.mold_products || []).map((mp) => mp.products?.name).filter(Boolean).join(', ')}"`,
      m.initial_m2,
      m.total_produced_m2,
      m.total_strokes,
      m.target_lifespan_m2,
      `%${m.wear_percentage}`,
      m.last_production_date || '-',
      m.maintenance_count,
    ]);

    const csvContent = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Kalip_Baski_Metraj_Raporu_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ── TOP HEADER & ACTIONS ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 rounded-2xl bg-amber-500/10 text-amber-600">
              <Layers size={26} />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Kalıp & Baskı Metrajı Yönetimi
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Çelik kalıpların kümülatif üretim metrajı (m²), vuruş adedi, aşınma yüzdesi ve periyodik bakım takibi
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin() && companies.length > 0 && (
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
              <Building2 size={15} className="text-indigo-600" />
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  setSelectedCompanyId(e.target.value);
                  localStorage.setItem('parke_molds_selected_company', e.target.value);
                }}
                className="text-xs font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Yenile</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={filteredMolds.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet size={14} className="text-emerald-600" />
            <span>Excel / CSV</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-bold transition-all cursor-pointer"
          >
            <Printer size={14} className="text-blue-600" />
            <span>Yazdır</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-amber-600/20"
          >
            <Plus size={16} />
            <span>Yeni Kalıp Tanımla</span>
          </button>
        </div>
      </div>

      {/* ⚠️ Migration Schema Alert */}
      {schemaMissing && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 text-amber-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="p-2 bg-amber-200/60 rounded-xl text-amber-800 shrink-0">
              <AlertTriangle size={20} />
            </span>
            <div>
              <h4 className="font-bold text-sm sm:text-base">Kalıp Veritabanı Tablosu Henüz Kurulmamış</h4>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                Kalıp takip sisteminin verileri saklayabilmesi için Supabase Dashboard &gt; SQL Editor alanında oluşturduğumuz migration scriptini çalıştırmanız gerekmektedir:
                <code className="ml-1 bg-amber-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-amber-900 font-bold">supabase/migrations/20261010000000_create_molds_schema.sql</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer shadow-sm"
          >
            Tabloyu Tekrar Kontrol Et
          </button>
        </div>
      )}

      {/* ── KPI STATS CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Toplam Kalıp */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Kalıp Envanteri</span>
            <span className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Layers size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{stats.totalCount}</span>
            <span className="text-xs font-bold text-slate-500">Adet Kalıp</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-slate-600 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{stats.mountedCount} Makinede Takılı</span>
            <span className="text-slate-300">•</span>
            <span>{stats.activeCount - stats.mountedCount} Rafta / Hazır</span>
          </div>
        </div>

        {/* Card 2: Toplam Basılan Metraj */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Toplam Basılan Metraj</span>
            <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <Factory size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-700">
              {stats.totalFootage.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs font-bold text-slate-500">m²</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-emerald-600 flex items-center gap-1">
            <Activity size={14} />
            <span>~{stats.totalStrokes.toLocaleString('tr-TR')} Baskı / Vuruş Yapıldı</span>
          </div>
        </div>

        {/* Card 3: Kritik / Bakım Yaklaşan */}
        <div className={`p-5 rounded-2xl border transition-all ${
          stats.criticalCount > 0
            ? 'bg-amber-50/70 border-amber-200 text-amber-900 shadow-sm'
            : 'bg-white border-slate-100 text-slate-800 shadow-sm'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Aşınma & Bakım Alarmı</span>
            <span className={`p-2 rounded-xl ${stats.criticalCount > 0 ? 'bg-amber-200 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              <AlertTriangle size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-black ${stats.criticalCount > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {stats.criticalCount}
            </span>
            <span className="text-xs font-bold text-slate-500">Kalıp Kritik (%80+ Ömür)</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-slate-600">
            {stats.criticalCount > 0 ? 'Taşlama / plaka kontrolü önerilir' : 'Tüm kalıplar güvenli sınırda'}
          </div>
        </div>

        {/* Card 4: Otomatik Sayaç Durumu */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Sayaç Mekanizması</span>
            <span className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Gauge size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-purple-700">Canlı & Otomatik</span>
          </div>
          <div className="mt-2 text-xs font-medium text-slate-500">
            Üretim fişleri girildikçe sayaçlar sıfır iş yüküyle anlık güncellenir
          </div>
        </div>
      </div>

      {/* ── TOOLBAR: SEARCH & FILTERS ── */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl overflow-x-auto text-xs font-bold">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tümü ({molds.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('mounted')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'mounted' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🟢 Makinede Takılı ({molds.filter((m) => m.status === 'mounted').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'active' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📦 Rafta / Hazır ({molds.filter((m) => m.status === 'active').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('maintenance')}
            className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'maintenance' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ⚙️ Bakımda ({molds.filter((m) => m.status === 'maintenance').length})
          </button>
        </div>

        {/* Machine & Search Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            className="text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="all">Tüm Makineler / Hatlar</option>
            <option value="1">1 Nolu Parke Makinesi (Hat 1)</option>
            <option value="2">2 Nolu Parke Makinesi (Hat 2)</option>
            <option value="hepsi">Her İki Makinede Uyumlu</option>
          </select>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Kalıp adı, kodu, ürün ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-52 sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* ── MOLDS GRID / LIST ── */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3">
          <div className="w-9 h-9 border-3 border-amber-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-500">Kalıp envanteri ve sayaçlar yükleniyor...</span>
        </div>
      ) : filteredMolds.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center text-slate-400 shadow-sm">
          <Layers size={44} className="mx-auto mb-3 opacity-30 text-amber-600" />
          <h3 className="text-base font-bold text-slate-700">Kalıp Kaydı Bulunamadı</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Seçilen filtrelere uygun kalıp bulunmuyor veya henüz kalıp kartı tanımlanmamış.
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            + İlk Kalıbı Tanımla
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredMolds.map((mold) => {
            const isMounted = mold.status === 'mounted';
            const isMaint = mold.status === 'maintenance';
            const isRetired = mold.status === 'retired';

            // Wear percentage color
            const wear = mold.wear_percentage || 0;
            const progressColor =
              wear >= 100
                ? 'bg-red-600'
                : wear >= 85
                ? 'bg-orange-500'
                : wear >= 60
                ? 'bg-amber-500'
                : 'bg-emerald-500';

            const remainingM2 = Math.max(0, (mold.target_lifespan_m2 || 100000) - mold.total_produced_m2);

            return (
              <div
                key={mold.id}
                className="bg-white rounded-2xl border border-slate-200/90 hover:border-amber-300 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden group"
              >
                {/* Card Header */}
                <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-black px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                        {mold.code}
                      </span>
                      {isMounted && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Takılı (Hat {mold.machine_no})
                        </span>
                      )}
                      {isMaint && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                          Bakımda
                        </span>
                      )}
                      {isRetired && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-100 text-red-800">
                          Hurda
                        </span>
                      )}
                      {!isMounted && !isMaint && !isRetired && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
                          Rafta / Hazır
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-2 truncate group-hover:text-amber-700 transition-colors">
                      {mold.name}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(mold)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                      title="Düzenle"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMold(mold)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      title="Sil"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-4 flex-1">
                  {/* Linked Products Tags */}
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">
                      Bağlı Ürünler ({mold.mold_products?.length || 0}):
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {(mold.mold_products || []).length > 0 ? (
                        (mold.mold_products || []).map((mp) => (
                          <span
                            key={mp.product_id}
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200/60"
                          >
                            {mp.products?.name} {mp.products?.thickness ? `(${mp.products.thickness})` : ''}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400 italic">Ürün eşleştirmesi yapılmamış</span>
                      )}
                    </div>
                  </div>

                  {/* Main Metric: Kümülatif Metraj & Vuruş Sayısı */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-500">Kümülatif Basılan Metraj:</span>
                      <div className="text-right">
                        <span className="text-lg font-black text-slate-900">
                          {mold.total_produced_m2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs font-bold text-slate-500 ml-1">m²</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200/50">
                      <span>Baskı / Vuruş Sayısı:</span>
                      <span className="font-bold text-indigo-700">
                        ~{mold.total_strokes.toLocaleString('tr-TR')} Baskı
                      </span>
                    </div>

                    {mold.initial_m2 > 0 && (
                      <div className="text-[10px] text-slate-400 text-right mt-0.5">
                        (Devir: {mold.initial_m2.toLocaleString('tr-TR')} m²)
                      </div>
                    )}
                  </div>

                  {/* Lifespan Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-700 flex items-center gap-1">
                        <Gauge size={14} className="text-slate-400" />
                        Kalıp Aşınma / Ömür:
                      </span>
                      <span className={`font-black ${wear >= 85 ? 'text-red-700' : 'text-slate-800'}`}>
                        %{wear}
                      </span>
                    </div>

                    <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                        style={{ width: `${Math.min(100, wear)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Hedef: {mold.target_lifespan_m2?.toLocaleString('tr-TR')} m²</span>
                      <span>Kalan: {remainingM2.toLocaleString('tr-TR')} m²</span>
                    </div>
                  </div>

                  {/* Operational Details */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-100">
                    <div>
                      <span className="text-slate-400 block">1 Baskı Katsayısı:</span>
                      <span className="font-semibold text-slate-700">{mold.m2_per_stroke} m²/baskı</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Son Üretim:</span>
                      <span className="font-semibold text-slate-700">{mold.last_production_date || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenLedger(mold)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                  >
                    <History size={14} className="text-blue-600" />
                    <span>Baskı Ekstresi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenMaintenance(mold)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                  >
                    <Wrench size={14} className="text-amber-600" />
                    <span>Bakım Kaydet</span>
                  </button>

                  {mold.maintenance_count > 0 && (
                    <button
                      type="button"
                      onClick={() => handleOpenMaintHistory(mold)}
                      className="px-2 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-500 border border-slate-200 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                      title={`${mold.maintenance_count} Adet Bakım Kaydı`}
                    >
                      {mold.maintenance_count} 🛠️
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CREATE / EDIT MOLD MODAL ── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <Layers size={20} />
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    {editingMold ? 'Kalıp Bilgilerini Düzenle' : 'Yeni Kalıp Tanımla'}
                  </h3>
                  <p className="text-xs text-slate-400">Kalıp kodu, bağlı ürünler, 1 baskı metrajı ve ömür hedefleri</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveMold} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle size={15} /> {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Kalıp Kodu */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Kalıp Kodu <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="Örn: KLP-PRZ-2010-08"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>

                {/* Kalıp Adı */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Kalıp Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Örn: 20x10 Prizma Kalıbı (8cm) #1"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Makine */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Uyumlu Makine</label>
                  <select
                    value={formData.machine_no}
                    onChange={(e) => setFormData({ ...formData, machine_no: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="1">1 Nolu Makine (Hat 1)</option>
                    <option value="2">2 Nolu Makine (Hat 2)</option>
                    <option value="hepsi">Her İkisi (Uyumlu)</option>
                  </select>
                </div>

                {/* 1 Baskı Metrajı */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    1 Baskı Metrajı (m²) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0.01"
                    value={formData.m2_per_stroke}
                    onChange={(e) => setFormData({ ...formData, m2_per_stroke: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">1 vuruşta çıkan net alan</span>
                </div>

                {/* Durum */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Mevcut Durum</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="mounted">🟢 Makinede Takılı (Çalışıyor)</option>
                    <option value="active">📦 Rafta / Yedekte Bekliyor</option>
                    <option value="maintenance">⚙️ Bakımda / Taşlamada</option>
                    <option value="retired">🔴 Hurda / Emekli</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Devir / Başlangıç Metrajı */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Başlangıç / Devir Metrajı (m²)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={formData.initial_m2}
                    onChange={(e) => setFormData({ ...formData, initial_m2: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Sistem öncesi basılmış metraj</span>
                </div>

                {/* Hedef Ömür */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Hedef Ömür (m²)</label>
                  <input
                    type="number"
                    step="1000"
                    min="1000"
                    value={formData.target_lifespan_m2}
                    onChange={(e) => setFormData({ ...formData, target_lifespan_m2: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Varsayılan: 100.000 m²</span>
                </div>

                {/* Bakım Periyodu */}
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Bakım Periyodu (m²)</label>
                  <input
                    type="number"
                    step="1000"
                    min="1000"
                    value={formData.maintenance_interval_m2}
                    onChange={(e) => setFormData({ ...formData, maintenance_interval_m2: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Kaç m²'de bir taşlanmalı</span>
                </div>
              </div>

              {/* Bağlı Ürünler (Çoklu Seçim) */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Bu Kalıpla Üretilen Taşlar (Ürün Eşleştirmesi):</span>
                  <span className="text-slate-400 font-normal">
                    {formData.selected_product_ids.length} Ürün Seçildi
                  </span>
                </label>
                <div className="max-h-40 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {products.map((p) => {
                    const isChecked = formData.selected_product_ids.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                          isChecked ? 'bg-amber-100/70 text-amber-900 font-bold border border-amber-300' : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                selected_product_ids: [...formData.selected_product_ids, p.id],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                selected_product_ids: formData.selected_product_ids.filter((id) => id !== p.id),
                              });
                            }
                          }}
                          className="rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                        <span className="truncate">
                          {p.name} {p.thickness ? `(${p.thickness})` : ''} {p.color ? `[${p.color}]` : ''}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Notlar */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Notlar / Açıklama</label>
                <textarea
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Kalıp üreticisi, teslim alma tarihi veya özel notlar..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm shadow-amber-600/20"
                >
                  {formSaving ? 'Kaydediliyor...' : editingMold ? 'Kalıbı Güncelle' : 'Kalıbı Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MOLD USAGE LEDGER MODAL (BASKI EKSTRESİ) ── */}
      {isLedgerOpen && selectedMoldForLedger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600">
                  <History size={20} />
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Kalıp Baskı Ekstresi — {selectedMoldForLedger.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Kod: <strong>{selectedMoldForLedger.code}</strong> | Toplam Basılan:{' '}
                    <strong>{selectedMoldForLedger.total_produced_m2.toLocaleString('tr-TR')} m²</strong> (
                    <strong>~{selectedMoldForLedger.total_strokes.toLocaleString('tr-TR')} Baskı</strong>)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsLedgerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6">
              {loadingLedger ? (
                <div className="py-16 text-center text-slate-400">
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <span className="text-xs font-semibold">Baskı hareketleri yükleniyor...</span>
                </div>
              ) : ledgerEntries.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <Boxes size={36} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-semibold text-slate-600">Bu kalıpla henüz üretim fişi işlenmemiş</p>
                  {selectedMoldForLedger.initial_m2 > 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      Kalıbın sisteme girilmeden önceki devir metrajı: {selectedMoldForLedger.initial_m2} m²
                    </p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto max-h-96 border border-slate-200 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-semibold text-[10px] tracking-wider sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5 text-center w-12">#</th>
                        <th className="px-3 py-2.5 text-left w-24">Tarih</th>
                        <th className="px-3 py-2.5 text-left w-20">Vardiya</th>
                        <th className="px-3 py-2.5 text-left w-24">Makine</th>
                        <th className="px-3 py-2.5 text-left min-w-[150px]">Ürün</th>
                        <th className="px-3 py-2.5 text-left w-28">Lot No</th>
                        <th className="px-3 py-2.5 text-right w-24 text-emerald-700">Net Metraj</th>
                        <th className="px-3 py-2.5 text-right w-20">Palet</th>
                        <th className="px-3 py-2.5 text-left">Notlar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-sans">
                      {ledgerEntries.map((pe, idx) => (
                        <tr key={pe.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-center text-slate-400 font-medium">{idx + 1}</td>
                          <td className="px-3 py-2 font-bold text-slate-800 whitespace-nowrap">{pe.date}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pe.shift === 'Gece' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              {pe.shift || 'Gündüz'}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-600">Makine {pe.machine_no}</td>
                          <td className="px-3 py-2 font-bold text-slate-900">{pe.products?.name}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{pe.lot_number || '-'}</td>
                          <td className="px-3 py-2 text-right font-black text-emerald-700 whitespace-nowrap">
                            +{Number(pe.net_m2).toLocaleString('tr-TR')} m²
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-600">
                            {pe.total_pallets || '-'}
                          </td>
                          <td className="px-3 py-2 text-slate-500 text-[11px] truncate max-w-xs">{pe.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                      <tr>
                        <td colSpan={6} className="px-3 py-2 text-slate-700">
                          Sistem Üretim Fişleri Toplamı:
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-800 font-black">
                          +{ledgerEntries.reduce((s, e) => s + (Number(e.net_m2) || 0), 0).toLocaleString('tr-TR')} m²
                        </td>
                        <td className="px-3 py-2 text-right text-slate-800">
                          {ledgerEntries.reduce((s, e) => s + (Number(e.total_pallets) || 0), 0)} Palet
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="flex justify-end pt-4 mt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLedgerOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MAINTENANCE LOG MODAL ── */}
      {isMaintenanceOpen && selectedMoldForMaint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <Wrench size={20} />
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Kalıp Bakım / Taşlama Kaydet
                  </h3>
                  <p className="text-xs text-slate-500">{selectedMoldForMaint.name} ({selectedMoldForMaint.code})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMaintenanceOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveMaintenance} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Bakım Tarihi</label>
                  <input
                    type="date"
                    required
                    value={maintData.date}
                    onChange={(e) => setMaintData({ ...maintData, date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">İşlem Türü</label>
                  <select
                    value={maintData.action_type}
                    onChange={(e) => setMaintData({ ...maintData, action_type: e.target.value as any })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="taslama">Taşlama / Yüzey Düzeltme</option>
                    <option value="plaka_degisimi">Baskı Plakası Değişimi</option>
                    <option value="kaynak">Kaynak / Çatlak Onarımı</option>
                    <option value="temizlik">Detaylı Temizlik & Yağlama</option>
                    <option value="diger">Diğer / Genel Revizyon</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Yapan Servis / Usta</label>
                  <input
                    type="text"
                    value={maintData.service_provider}
                    onChange={(e) => setMaintData({ ...maintData, service_provider: e.target.value })}
                    placeholder="Örn: Fabrika Atölyesi / Ahmet Usta"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Maliyet (TL)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={maintData.cost}
                    onChange={(e) => setMaintData({ ...maintData, cost: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Yapılan İşlem Detayı / Notlar</label>
                <textarea
                  rows={3}
                  value={maintData.notes}
                  onChange={(e) => setMaintData({ ...maintData, notes: e.target.value })}
                  placeholder="Kalıpta yapılan taşlama mikronu, değişen parçalar vb..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsMaintenanceOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={maintSaving}
                  className="px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm shadow-amber-600/20"
                >
                  {maintSaving ? 'Kaydediliyor...' : 'Bakımı Onayla & Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MAINTENANCE HISTORY MODAL ── */}
      {isMaintHistoryOpen && selectedMoldForMaintHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <Wrench size={20} />
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Kalıp Bakım Geçmişi — {selectedMoldForMaintHistory.name}
                  </h3>
                  <p className="text-xs text-slate-500">Kalıpta bugüne kadar yapılan tüm taşlama ve onarım kayıtları</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMaintHistoryOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6">
              {loadingMaintLogs ? (
                <div className="py-12 text-center text-slate-400">
                  <div className="w-8 h-8 border-3 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <span className="text-xs font-semibold">Bakım kayıtları alınıyor...</span>
                </div>
              ) : maintLogs.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  <p className="text-sm">Bu kalıp için henüz kayıtlı bir bakım bulunmuyor.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {maintLogs.map((log) => (
                    <div key={log.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{log.date}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase">
                            {log.action_type === 'taslama' ? 'Taşlama' : log.action_type === 'plaka_degisimi' ? 'Plaka Değişimi' : log.action_type}
                          </span>
                        </div>
                        {log.cost > 0 && (
                          <span className="text-xs font-bold text-slate-700">
                            {Number(log.cost).toLocaleString('tr-TR')} TL
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600">
                        {log.service_provider && <span>Usta/Servis: <strong>{log.service_provider}</strong> • </span>}
                        <span>İşlem Anındaki Metraj: <strong>{Number(log.footage_at_maintenance).toLocaleString('tr-TR')} m²</strong></span>
                      </div>
                      {log.notes && (
                        <p className="text-xs text-slate-500 bg-white p-2 rounded-lg border border-slate-100 mt-1">
                          {log.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-4 mt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsMaintHistoryOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
