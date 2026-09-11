import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CustomerQuota, Customer, Site, Product } from '../types';
import Modal from '../components/Modal';
import {
  Target, Plus, Search, Filter, AlertTriangle, CheckCircle2,
  AlertCircle, Edit2, Trash2, Calendar, TrendingUp, Truck,
  Printer, ArrowRight, Eye, RefreshCw, ChevronDown, Clock,
  Building2, Package, Layers
} from 'lucide-react';

interface QuotaFormData {
  customer_id: string;
  site_id: string;
  product_id: string;
  target_quantity: number;
  unit: 'm2' | 'metre' | 'adet';
  alert_threshold_pct: number;
  start_date: string;
  end_date: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: QuotaFormData = {
  customer_id: '',
  site_id: '',
  product_id: '',
  target_quantity: 1000,
  unit: 'm2',
  alert_threshold_pct: 85,
  start_date: '2026-01-01',
  end_date: '',
  notes: '',
  is_active: true,
};

export default function CustomerQuotas() {
  const { isAdmin, isWeighbridge, isFieldManager } = useAuth();

  const [quotas, setQuotas] = useState<CustomerQuota[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shipmentItems, setShipmentItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingQuota, setEditingQuota] = useState<CustomerQuota | null>(null);
  const [form, setForm] = useState<QuotaFormData>(EMPTY_FORM);
  const [formSites, setFormSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);

  // History detail modal
  const [selectedQuotaForHistory, setSelectedQuotaForHistory] = useState<CustomerQuota | null>(null);

  // Filter & Search states
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'normal' | 'approaching' | 'exceeded'>('all');
  const [unitFilter, setUnitFilter] = useState<'all' | 'm2' | 'metre' | 'adet'>('all');

  // Load all necessary data
  const loadData = async () => {
    setLoading(true);
    try {
      const [quotasRes, custRes, sitesRes, prodRes, shipItemsRes] = await Promise.all([
        supabase.from('customer_quotas').select('*, customers(*), sites(*), products(*)').order('created_at', { ascending: false }),
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('sites').select('*').eq('is_active', true).order('name'),
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('shipment_items').select(`
          id,
          product_id,
          m2,
          unit,
          pallets,
          shipments!inner (
            id,
            invoice_no,
            shipment_date,
            customer_id,
            site_id,
            vehicle_plate,
            driver_name,
            status
          )
        `).eq('shipments.status', 'completed')
      ]);

      if (quotasRes.data) setQuotas(quotasRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (sitesRes.data) setSites(sitesRes.data);
      if (prodRes.data) setProducts(prodRes.data);
      if (shipItemsRes.data) setShipmentItems(shipItemsRes.data);
    } catch (err) {
      console.error('Veri yükleme hatası:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Update sites in form when customer is selected
  useEffect(() => {
    if (form.customer_id) {
      const filtered = sites.filter(s => s.customer_id === form.customer_id);
      setFormSites(filtered);
    } else {
      setFormSites([]);
    }
  }, [form.customer_id, sites]);

  // Compute shipped quantities and metrics for each quota
  const calculatedQuotas = useMemo(() => {
    return quotas.map(quota => {
      // Find relevant shipment items
      const matchingItems = shipmentItems.filter(item => {
        const s = item.shipments;
        if (!s) return false;
        if (s.customer_id !== quota.customer_id) return false;
        if (quota.site_id && s.site_id !== quota.site_id) return false;
        if (quota.product_id && item.product_id !== quota.product_id) return false;

        // Date filter (respects custom start_date and optional end_date)
        if (quota.start_date && s.shipment_date < quota.start_date) return false;
        if (quota.end_date && s.shipment_date > quota.end_date) return false;

        // Unit match
        const itemUnit = item.unit || 'm2';
        if (itemUnit !== quota.unit) return false;

        return true;
      });

      const shipped_quantity = matchingItems.reduce((acc, cur) => acc + (Number(cur.m2) || 0), 0);
      const remaining_quantity = quota.target_quantity - shipped_quantity;
      const completion_pct = quota.target_quantity > 0
        ? Math.round((shipped_quantity / quota.target_quantity) * 100)
        : 0;

      return {
        ...quota,
        shipped_quantity,
        remaining_quantity,
        completion_pct,
      };
    });
  }, [quotas, shipmentItems]);

  // Filtered list
  const filteredQuotas = useMemo(() => {
    return calculatedQuotas.filter(q => {
      // Search filter
      const custName = q.customers?.name?.toLowerCase() || '';
      const siteName = q.sites?.name?.toLowerCase() || '';
      const prodName = q.products?.name?.toLowerCase() || '';
      const s = search.toLowerCase();
      if (s && !custName.includes(s) && !siteName.includes(s) && !prodName.includes(s)) {
        return false;
      }

      // Unit filter
      if (unitFilter !== 'all' && q.unit !== unitFilter) return false;

      // Status filter
      const pct = q.completion_pct || 0;
      const threshold = q.alert_threshold_pct || 85;
      if (statusFilter === 'normal' && pct >= threshold) return false;
      if (statusFilter === 'approaching' && (pct < threshold || pct >= 100)) return false;
      if (statusFilter === 'exceeded' && pct < 100) return false;

      return true;
    });
  }, [calculatedQuotas, search, statusFilter, unitFilter]);

  // Overall KPIs
  const kpis = useMemo(() => {
    let approachingCount = 0;
    let exceededCount = 0;
    let totalTargetM2 = 0;
    let totalShippedM2 = 0;

    calculatedQuotas.forEach(q => {
      const pct = q.completion_pct || 0;
      const threshold = q.alert_threshold_pct || 85;
      if (pct >= 100) exceededCount++;
      else if (pct >= threshold) approachingCount++;

      if (q.unit === 'm2') {
        totalTargetM2 += Number(q.target_quantity) || 0;
        totalShippedM2 += Number(q.shipped_quantity) || 0;
      }
    });

    return {
      totalCount: calculatedQuotas.length,
      approachingCount,
      exceededCount,
      totalTargetM2,
      totalShippedM2,
    };
  }, [calculatedQuotas]);

  // Handlers
  const handleOpenAdd = () => {
    setEditingQuota(null);
    setForm({
      ...EMPTY_FORM,
      customer_id: customers[0]?.id || '',
      start_date: '2026-01-01',
    });
    setShowModal(true);
  };

  const handleOpenEdit = (q: CustomerQuota) => {
    setEditingQuota(q);
    setForm({
      customer_id: q.customer_id,
      site_id: q.site_id || '',
      product_id: q.product_id || '',
      target_quantity: q.target_quantity,
      unit: q.unit,
      alert_threshold_pct: q.alert_threshold_pct || 85,
      start_date: q.start_date || '2026-01-01',
      end_date: q.end_date || '',
      notes: q.notes || '',
      is_active: q.is_active ?? true,
    });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id) {
      alert('Lütfen bir müşteri seçiniz.');
      return;
    }
    if (form.target_quantity <= 0) {
      alert('Hedef miktar 0\'dan büyük olmalıdır.');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        customer_id: form.customer_id,
        site_id: form.site_id || null,
        product_id: form.product_id || null,
        target_quantity: Number(form.target_quantity),
        unit: form.unit,
        alert_threshold_pct: Number(form.alert_threshold_pct),
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: form.notes || '',
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };

      if (editingQuota) {
        const { error } = await supabase.from('customer_quotas').update(payload).eq('id', editingQuota.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('customer_quotas').insert(payload);
        if (error) throw error;
      }

      setShowModal(false);
      await loadData();
    } catch (err: any) {
      alert('Kayıt kaydedilirken hata: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, customerName: string) => {
    if (!confirm(`"${customerName}" müşterisine ait bu kota kaydını silmek istediğinize emin misiniz?`)) return;
    try {
      const { error } = await supabase.from('customer_quotas').delete().eq('id', id);
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      alert('Silinirken hata: ' + err.message);
    }
  };

  // Get matching shipment items for selected history modal
  const historyShipments = useMemo(() => {
    if (!selectedQuotaForHistory) return [];
    return shipmentItems.filter(item => {
      const s = item.shipments;
      if (!s) return false;
      if (s.customer_id !== selectedQuotaForHistory.customer_id) return false;
      if (selectedQuotaForHistory.site_id && s.site_id !== selectedQuotaForHistory.site_id) return false;
      if (selectedQuotaForHistory.product_id && item.product_id !== selectedQuotaForHistory.product_id) return false;
      if (selectedQuotaForHistory.start_date && s.shipment_date < selectedQuotaForHistory.start_date) return false;
      if (selectedQuotaForHistory.end_date && s.shipment_date > selectedQuotaForHistory.end_date) return false;
      const itemUnit = item.unit || 'm2';
      if (itemUnit !== selectedQuotaForHistory.unit) return false;
      return true;
    });
  }, [selectedQuotaForHistory, shipmentItems]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
              <Target size={22} />
            </div>
            Müşteri Kotaları & Sevk Takibi
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Müşterilere tanımlanan malzeme taahhütleri, gerçekleşen sevkiyatlar ve kalan kota analizleri
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
            title="Yenile"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm shadow-sm transition-all hover:shadow"
          >
            <Plus size={18} />
            Yeni Kota Tanımla
          </button>
        </div>
      </div>

      {/* ── TOP KPI CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">Toplam Aktif Kota</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Target size={16} />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{kpis.totalCount}</p>
          <span className="text-[11px] text-slate-400">Tanımlı müşteri taahhüdü</span>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-600 font-medium">Kotaya Yaklaşanlar</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock size={16} />
            </div>
          </div>
          <p className="text-2xl font-bold text-amber-600 mt-2">{kpis.approachingCount}</p>
          <span className="text-[11px] text-amber-700/80 font-medium">%85 doluluk eşiğini geçenler</span>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-xs text-red-600 font-medium">Kota Dolanlar / Aşanlar</span>
            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <AlertTriangle size={16} />
            </div>
          </div>
          <p className="text-2xl font-bold text-red-600 mt-2">{kpis.exceededCount}</p>
          <span className="text-[11px] text-red-700/80 font-medium">%100 tamamlanan veya aşan</span>
        </div>

        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-800 font-bold">Toplam Sevk (m²)</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Truck size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-emerald-950 mt-2">
            {kpis.totalShippedM2.toLocaleString('tr-TR')} m²
          </p>
          <span className="text-[11px] text-emerald-700 font-medium">
            Hedef: {kpis.totalTargetM2.toLocaleString('tr-TR')} m²
          </span>
        </div>
      </div>

      {/* ── FILTERS & SEARCH ── */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Müşteri, şantiye veya ürün ara..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Durum Filtresi */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Tümü
            </button>
            <button
              onClick={() => setStatusFilter('normal')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === 'normal' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Normal
            </button>
            <button
              onClick={() => setStatusFilter('approaching')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === 'approaching' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Clock size={12} />
              Yaklaşanlar
            </button>
            <button
              onClick={() => setStatusFilter('exceeded')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === 'exceeded' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <AlertTriangle size={12} />
              Dolanlar / Aşanlar
            </button>
          </div>

          {/* Birim Filtresi */}
          <select
            value={unitFilter}
            onChange={e => setUnitFilter(e.target.value as any)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="all">Tüm Birimler</option>
            <option value="m2">m² (Metrekare)</option>
            <option value="metre">Metre (Bordür)</option>
            <option value="adet">Adet</option>
          </select>
        </div>
      </div>

      {/* ── QUOTAS TABLE ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                <th className="px-4 py-3.5">Müşteri / Şantiye</th>
                <th className="px-3 py-3.5">Kapsam / Ürün</th>
                <th className="px-3 py-3.5 text-center">Başlangıç Tarihi</th>
                <th className="px-3 py-3.5 text-right">Hedef Kota</th>
                <th className="px-3 py-3.5 text-right">Sevk Edilen</th>
                <th className="px-3 py-3.5 text-right">Kalan Miktar</th>
                <th className="px-4 py-3.5 min-w-[170px]">Tamamlanma Oranı</th>
                <th className="px-3 py-3.5 text-center">Durum</th>
                <th className="px-3 py-3.5 text-center">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredQuotas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Target size={36} className="mx-auto text-slate-300 mb-2 opacity-60" />
                    Henüz tanımlı kota veya kriterlere uygun kayıt bulunamadı.
                  </td>
                </tr>
              ) : (
                filteredQuotas.map(q => {
                  const pct = q.completion_pct || 0;
                  const threshold = q.alert_threshold_pct || 85;
                  const isExceeded = pct >= 100;
                  const isApproaching = pct >= threshold && !isExceeded;
                  const remaining = q.remaining_quantity ?? 0;

                  return (
                    <tr key={q.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Müşteri & Şantiye */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900 text-sm">{q.customers?.name || '-'}</div>
                        <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mt-0.5">
                          {q.sites ? (
                            <span className="flex items-center gap-1 text-slate-600 font-medium">
                              <Building2 size={11} className="text-amber-500" />
                              {q.sites.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Tüm Şantiyeler (Genel)</span>
                          )}
                          {q.customers?.phone && <span>• {q.customers.phone}</span>}
                        </div>
                      </td>

                      {/* Ürün / Kapsam */}
                      <td className="px-3 py-3.5">
                        {q.products ? (
                          <div>
                            <div className="font-semibold text-slate-800">{q.products.name}</div>
                            <div className="text-[10px] text-slate-400">
                              {q.products.thickness} - {q.products.color}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                            <Layers size={10} />
                            Tüm Ürünler ({q.unit})
                          </span>
                        )}
                      </td>

                      {/* Başlangıç Tarihi */}
                      <td className="px-3 py-3.5 text-center">
                        <div className="font-semibold text-slate-700 font-mono">
                          {new Date(q.start_date).toLocaleDateString('tr-TR')}
                        </div>
                        {q.end_date && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            Bitiş: {new Date(q.end_date).toLocaleDateString('tr-TR')}
                          </div>
                        )}
                      </td>

                      {/* Hedef Kota */}
                      <td className="px-3 py-3.5 text-right font-bold text-slate-900 font-mono text-sm">
                        {Number(q.target_quantity).toLocaleString('tr-TR')} {q.unit}
                      </td>

                      {/* Sevk Edilen */}
                      <td className="px-3 py-3.5 text-right font-extrabold text-blue-900 font-mono text-sm">
                        {(q.shipped_quantity || 0).toLocaleString('tr-TR')} {q.unit}
                      </td>

                      {/* Kalan Miktar */}
                      <td className="px-3 py-3.5 text-right font-mono">
                        {remaining > 0 ? (
                          <span className="font-bold text-slate-700 text-sm">
                            {remaining.toLocaleString('tr-TR')} {q.unit}
                          </span>
                        ) : (
                          <span className="font-black text-red-600 text-xs">
                            +{Math.abs(remaining).toLocaleString('tr-TR')} {q.unit} Aşıldı
                          </span>
                        )}
                      </td>

                      {/* İlerleme Çubuğu */}
                      <td className="px-4 py-3.5">
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[11px] font-semibold">
                            <span className={isExceeded ? 'text-red-700 font-black' : isApproaching ? 'text-amber-700' : 'text-slate-600'}>
                              %{pct}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Eşik: %{q.alert_threshold_pct || 85}
                            </span>
                          </div>
                          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isExceeded
                                  ? 'bg-red-500'
                                  : isApproaching
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Durum Rozeti */}
                      <td className="px-3 py-3.5 text-center">
                        {isExceeded ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200 shadow-sm animate-pulse">
                            <AlertTriangle size={11} />
                            Kota Doldu
                          </span>
                        ) : isApproaching ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 shadow-sm">
                            <Clock size={11} />
                            Yaklaştı
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={11} />
                            Normal
                          </span>
                        )}
                      </td>

                      {/* İşlemler */}
                      <td className="px-3 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setSelectedQuotaForHistory(q)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Sevkiyat İrsaliyelerini İncele"
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(q)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Düzenle"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(q.id, q.customers?.name || '')}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Sil"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── QUOTA FORM MODAL ── */}
      {showModal && (
        <Modal
          title={editingQuota ? 'Müşteri Kotasını Düzenle' : 'Yeni Müşteri Kotası / Taahhüdü Tanımla'}
          onClose={() => setShowModal(false)}
          size="md"
        >
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Müşteri Seçiniz *</label>
              <select
                required
                value={form.customer_id}
                onChange={e => setForm({ ...form, customer_id: e.target.value, site_id: '' })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">-- Müşteri Seçin --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Şantiye (Opsiyonel)</label>
                <select
                  value={form.site_id}
                  onChange={e => setForm({ ...form, site_id: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">Tüm Şantiyeler (Genel)</option>
                  {formSites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ürün / Kapsam</label>
                <select
                  value={form.product_id}
                  onChange={e => setForm({ ...form, product_id: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">Tüm Ürünler (Genel Kota)</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.thickness} - {p.color})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Hedef Taahhüt Miktarı *</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={form.target_quantity}
                  onChange={e => setForm({ ...form, target_quantity: Number(e.target.value) })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="5000"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Birim</label>
                <select
                  value={form.unit}
                  onChange={e => setForm({ ...form, unit: e.target.value as any })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="m2">m² (Metrekare)</option>
                  <option value="metre">Metre (Bordür vb.)</option>
                  <option value="adet">Adet</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-amber-50/50 p-3 rounded-xl border border-amber-100">
              <div>
                <label className="block text-xs font-semibold text-amber-900 mb-1">
                  Kota Başlangıç Tarihi *
                </label>
                <input
                  type="date"
                  required
                  value={form.start_date}
                  onChange={e => setForm({ ...form, start_date: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Bu tarihten sonraki sevkiyatlar dahil edilir.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-amber-900 mb-1">
                  Uyarı Eşiği (%)
                </label>
                <input
                  type="number"
                  min="50"
                  max="100"
                  value={form.alert_threshold_pct}
                  onChange={e => setForm({ ...form, alert_threshold_pct: Number(e.target.value) })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Varsayılan: %85 dolulukta uyarı verilir.
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Kota Bitiş Tarihi (Opsiyonel)</label>
              <input
                type="date"
                value={form.end_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Açıklama & Sözleşme Notu</label>
              <textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Örn: 2026 yılı 1. etap kilitli taş taahhüdü..."
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-sm transition-colors"
              >
                {saving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── SHIPMENT HISTORY MODAL ── */}
      {selectedQuotaForHistory && (
        <Modal
          title={`${selectedQuotaForHistory.customers?.name} — Sevkiyat Geçmişi`}
          onClose={() => setSelectedQuotaForHistory(null)}
          size="lg"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <div>
                <span className="text-slate-500">Müşteri:</span>{' '}
                <strong className="text-slate-900">{selectedQuotaForHistory.customers?.name}</strong>
                {selectedQuotaForHistory.sites && (
                  <span className="text-slate-600 ml-2">({selectedQuotaForHistory.sites.name})</span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-slate-500">Hedef:</span>{' '}
                  <strong className="text-slate-900 font-mono">
                    {selectedQuotaForHistory.target_quantity.toLocaleString('tr-TR')} {selectedQuotaForHistory.unit}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Sevk Edilen:</span>{' '}
                  <strong className="text-blue-700 font-mono font-bold">
                    {(selectedQuotaForHistory.shipped_quantity || 0).toLocaleString('tr-TR')} {selectedQuotaForHistory.unit}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Başlangıç:</span>{' '}
                  <span className="font-mono">{new Date(selectedQuotaForHistory.start_date).toLocaleDateString('tr-TR')}</span>
                </div>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="px-3 py-2.5">Tarih</th>
                    <th className="px-3 py-2.5">İrsaliye No</th>
                    <th className="px-3 py-2.5">Araç Plaka</th>
                    <th className="px-3 py-2.5">Şantiye</th>
                    <th className="px-3 py-2.5">Ürün</th>
                    <th className="px-3 py-2.5 text-right">Sevk Miktarı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyShipments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Bu kotanın başlangıç tarihinden ({new Date(selectedQuotaForHistory.start_date).toLocaleDateString('tr-TR')}) sonra yapılmış tamamlanmış sevkiyat bulunmuyor.
                      </td>
                    </tr>
                  ) : (
                    historyShipments.map((item, idx) => {
                      const s = item.shipments;
                      const prod = products.find(p => p.id === item.product_id);
                      const siteObj = sites.find(st => st.id === s?.site_id);

                      return (
                        <tr key={idx} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2.5 font-mono text-slate-700">
                            {new Date(s?.shipment_date).toLocaleDateString('tr-TR')}
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-slate-900 font-mono">
                            {s?.invoice_no || '-'}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-600">
                            {s?.vehicle_plate || '-'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {siteObj?.name || '-'}
                          </td>
                          <td className="px-3 py-2.5 text-slate-800">
                            {prod?.name || 'Parke Taşı'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold text-blue-800 font-mono">
                            {Number(item.m2).toLocaleString('tr-TR')} {item.unit || 'm2'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedQuotaForHistory(null)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
              >
                Kapat
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
