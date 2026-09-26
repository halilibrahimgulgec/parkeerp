import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { CustomerQuota, Customer, Site, Product } from '../types';
import Modal from '../components/Modal';
import CustomerShipmentAnalysis from '../components/CustomerShipmentAnalysis';
import {
  Target, Plus, Search, Filter, AlertTriangle, CheckCircle2,
  Edit2, Trash2, TrendingUp, Truck,
  Printer, Eye, RefreshCw, Clock,
  Building2, Package, Layers, BarChart2, Scale,
  Boxes, Phone, MapPin, X, ShoppingBag, RotateCcw, Lock, CheckCircle
} from 'lucide-react';
import { getSupplierInfo } from './Shipment';

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function getEffectiveUnit(item: any, products: Product[]): 'm2' | 'metre' | 'adet' {
  const prod = products.find(p => p.id === item.product_id);
  if (prod?.unit === 'metre' || item.unit === 'metre') return 'metre';
  if (prod?.unit === 'adet' || item.unit === 'adet') return 'adet';
  return (item.unit || prod?.unit || 'm2') as any;
}

export function getQuotaUnitPrice(q: any): number {
  if (q?.unit_price !== undefined && q?.unit_price !== null && Number(q.unit_price) > 0) {
    return Number(q.unit_price);
  }
  // Check localStorage for offline / unmigrated fallback
  try {
    const local = JSON.parse(localStorage.getItem('parke_quota_unit_prices') || '{}');
    if (q?.id && local[q.id] && Number(local[q.id]) > 0) return Number(local[q.id]);
  } catch (e) {}

  // Check notes for [FİYAT: 195 ₺] or [FIYAT: 195] pattern
  if (q?.notes) {
    const match = q.notes.match(/\[F[Iİ]YAT:\s*([0-9.,]+)\s*₺?\]/i);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
}

interface QuotaFormData {
  customer_id: string;
  site_id: string;
  product_id: string;
  target_quantity: number;
  unit: 'm2' | 'metre' | 'adet';
  alert_threshold_pct: number;
  unit_price: number;
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
  unit_price: 0,
  start_date: getLocalDateStr(new Date()),
  end_date: '',
  notes: '',
  is_active: true,
};

export default function CustomerQuotas() {
  // Top-level tab: 'quotas' (Taahhütler & Kotalar) or 'analysis' (Tarih Aralıklı Sevk Analizi)
  const [activeTab, setActiveTab] = useState<'quotas' | 'analysis'>('quotas');

  const [quotas, setQuotas] = useState<CustomerQuota[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shipmentItems, setShipmentItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states for Quotas
  const [showModal, setShowModal] = useState(false);
  const [editingQuota, setEditingQuota] = useState<CustomerQuota | null>(null);
  const [form, setForm] = useState<QuotaFormData>(EMPTY_FORM);
  const [formSites, setFormSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);

  // History detail modal for Quotas
  const [selectedQuotaForHistory, setSelectedQuotaForHistory] = useState<CustomerQuota | null>(null);

  // Quota list Filter & Search states
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'closed'>('active');
  const [statusFilter, setStatusFilter] = useState<'all' | 'normal' | 'approaching' | 'exceeded'>('all');
  const [unitFilter, setUnitFilter] = useState<'all' | 'm2' | 'metre' | 'adet'>('all');

  // ── PRINT STATES & HANDLERS ──
  const [singlePrintQuota, setSinglePrintQuota] = useState<CustomerQuota | null>(null);

  const handlePrintAll = () => {
    setSinglePrintQuota(null);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const handlePrintSingle = (q: CustomerQuota) => {
    setSinglePrintQuota(q);
    setTimeout(() => {
      window.print();
      setTimeout(() => setSinglePrintQuota(null), 1000);
    }, 120);
  };

  // ── ANALYSIS TAB PRE-SELECTION ──
  const [queryCustomerId, setQueryCustomerId] = useState<string>('');
  const [queryStartDate, setQueryStartDate] = useState<string>('');

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
          pallet_type,
          shipments!inner (
            id,
            invoice_no,
            shipment_date,
            customer_id,
            site_id,
            vehicle_plate,
            driver_name,
            driver_phone,
            gross_weight,
            tare_weight,
            notes,
            status
          )
        `).eq('shipments.status', 'completed').limit(50000)
      ]);

      if (quotasRes.data) {
        const enrichedQuotas = quotasRes.data.map((q: any) => ({
          ...q,
          unit_price: getQuotaUnitPrice(q),
        }));
        setQuotas(enrichedQuotas);
      }
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

  // Update sites in quota form when customer is selected
  useEffect(() => {
    if (form.customer_id) {
      const filtered = sites.filter(s => s.customer_id === form.customer_id);
      setFormSites(filtered);
    } else {
      setFormSites([]);
    }
  }, [form.customer_id, sites]);

  // Jump from Quotas to Analysis Tab with customer pre-selected
  const handleJumpToAnalysis = (customerId: string, startDate?: string) => {
    setQueryCustomerId(customerId);
    setQueryStartDate(startDate || '');
    setActiveTab('analysis');
  };

  // Compute metrics for Quotas tab
  const calculatedQuotas = useMemo(() => {
    return quotas.map(quota => {
      const matchingItems = shipmentItems.filter(item => {
        const s = item.shipments;
        if (!s) return false;
        if (s.customer_id !== quota.customer_id) return false;
        if (quota.site_id && s.site_id !== quota.site_id) return false;
        if (quota.product_id && item.product_id !== quota.product_id) return false;

        if (quota.start_date && s.shipment_date < quota.start_date) return false;
        if (quota.end_date && s.shipment_date > quota.end_date) return false;

        // Ürüne özel kota tanımlanmışsa o ürünün tüm sevkiyatları dahil edilir
        // Genel kota ise birim eşleşmesi aranır
        const itemUnit = getEffectiveUnit(item, products);
        if (!quota.product_id && itemUnit !== quota.unit) return false;

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
  }, [quotas, shipmentItems, products]);

  // Filtered Quotas list
  const filteredQuotas = useMemo(() => {
    return calculatedQuotas.filter(q => {
      // Active / Closed filter
      if (activeFilter === 'active' && q.is_active === false) return false;
      if (activeFilter === 'closed' && q.is_active !== false) return false;

      const custName = q.customers?.name?.toLowerCase() || '';
      const siteName = q.sites?.name?.toLowerCase() || '';
      const prodName = q.products?.name?.toLowerCase() || '';
      const s = search.toLowerCase();
      if (s && !custName.includes(s) && !siteName.includes(s) && !prodName.includes(s)) {
        return false;
      }

      if (unitFilter !== 'all' && q.unit !== unitFilter) return false;

      const pct = q.completion_pct || 0;
      const threshold = q.alert_threshold_pct || 85;
      if (statusFilter === 'normal' && pct >= threshold) return false;
      if (statusFilter === 'approaching' && (pct < threshold || pct >= 100)) return false;
      if (statusFilter === 'exceeded' && pct < 100) return false;

      return true;
    });
  }, [calculatedQuotas, activeFilter, search, statusFilter, unitFilter]);

  // Overall KPIs for Quotas tab
  const quotaKpis = useMemo(() => {
    let approachingCount = 0;
    let exceededCount = 0;
    let activeCount = 0;
    let closedCount = 0;
    let totalTargetM2 = 0;
    let totalShippedM2 = 0;

    calculatedQuotas.forEach(q => {
      if (q.is_active === false) {
        closedCount++;
      } else {
        activeCount++;
        const pct = q.completion_pct || 0;
        const threshold = q.alert_threshold_pct || 85;
        if (pct >= 100) exceededCount++;
        else if (pct >= threshold) approachingCount++;

        if (q.unit === 'm2') {
          totalTargetM2 += Number(q.target_quantity) || 0;
          totalShippedM2 += Number(q.shipped_quantity) || 0;
        }
      }
    });

    return {
      totalCount: calculatedQuotas.length,
      activeCount,
      closedCount,
      approachingCount,
      exceededCount,
      totalTargetM2,
      totalShippedM2,
    };
  }, [calculatedQuotas]);

  // Quota Form Handlers
  const handleOpenAdd = () => {
    setEditingQuota(null);
    setForm({
      ...EMPTY_FORM,
      customer_id: customers[0]?.id || '',
      start_date: getLocalDateStr(new Date()),
      unit_price: 0,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (q: CustomerQuota) => {
    setEditingQuota(q);
    const existingPrice = getQuotaUnitPrice(q);
    // Strip [FİYAT: xxx ₺] from notes for clean editing display
    const cleanNotes = (q.notes || '').replace(/\[F[Iİ]YAT:\s*[0-9.,]+\s*₺?\]/gi, '').trim();
    setForm({
      customer_id: q.customer_id,
      site_id: q.site_id || '',
      product_id: q.product_id || '',
      target_quantity: q.target_quantity,
      unit: q.unit,
      alert_threshold_pct: q.alert_threshold_pct || 85,
      unit_price: existingPrice,
      start_date: q.start_date || '2026-01-01',
      end_date: q.end_date || '',
      notes: cleanNotes,
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
      // Append [FİYAT: X ₺] to notes for zero-loss fallback across DB instances
      let finalNotes = form.notes.trim();
      if (form.unit_price > 0) {
        finalNotes = finalNotes ? `${finalNotes} [FİYAT: ${form.unit_price} ₺]` : `[FİYAT: ${form.unit_price} ₺]`;
      }

      const payload: any = {
        customer_id: form.customer_id,
        site_id: form.site_id || null,
        product_id: form.product_id || null,
        target_quantity: form.target_quantity,
        unit: form.unit,
        alert_threshold_pct: form.alert_threshold_pct,
        unit_price: form.unit_price,
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: finalNotes,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };

      let savedId = editingQuota?.id;

      if (editingQuota) {
        let { error } = await supabase
          .from('customer_quotas')
          .update(payload)
          .eq('id', editingQuota.id);
        
        // Resilient fallback if column unit_price does not exist yet on remote table
        if (error && (error.message?.includes('unit_price') || error.message?.includes('column "unit_price"'))) {
          const { unit_price, ...restPayload } = payload;
          const retryRes = await supabase
            .from('customer_quotas')
            .update(restPayload)
            .eq('id', editingQuota.id);
          error = retryRes.error;
        }
        if (error) throw error;
      } else {
        let { data, error } = await supabase
          .from('customer_quotas')
          .insert([payload])
          .select()
          .single();
        
        if (error && (error.message?.includes('unit_price') || error.message?.includes('column "unit_price"'))) {
          const { unit_price, ...restPayload } = payload;
          const retryRes = await supabase
            .from('customer_quotas')
            .insert([restPayload])
            .select()
            .single();
          error = retryRes.error;
          if (retryRes.data) savedId = retryRes.data.id;
        } else if (data) {
          savedId = data.id;
        }
        if (error) throw error;
      }

      // Persist in localStorage for instant offline access and fallback
      if (savedId) {
        try {
          const local = JSON.parse(localStorage.getItem('parke_quota_unit_prices') || '{}');
          local[savedId] = form.unit_price || 0;
          localStorage.setItem('parke_quota_unit_prices', JSON.stringify(local));
        } catch (e) {
          console.error('LocalStorage write error:', e);
        }
      }

      setShowModal(false);
      await loadData();
    } catch (err: any) {
      console.error('Kaydetme hatası:', err);
      alert('Kota kaydedilirken bir hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, customerName: string) => {
    if (!confirm(`"${customerName}" müşterisine ait bu kotayı silmek istediğinizden emin misiniz?`)) {
      return;
    }
    try {
      const { error } = await supabase.from('customer_quotas').delete().eq('id', id);
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      console.error('Silme hatası:', err);
      alert('Kota silinirken hata oluştu: ' + err.message);
    }
  };

  const handleToggleActive = async (q: CustomerQuota) => {
    const isCurrentlyActive = q.is_active !== false;
    const newActive = !isCurrentlyActive;
    const pName = q.products?.name ? `${q.products.name} (${q.products.thickness || ''})` : 'bu genel kotayı';
    const custName = q.customers?.name || 'Müşteri';

    const confirmMsg = newActive
      ? `"${custName}" firmasına ait "${pName}" kotasını/bağlantısını YENİDEN AKTİF ETMEK istiyor musunuz?`
      : `"${custName}" firmasına ait "${pName}" (${Number(q.target_quantity).toLocaleString('tr-TR')} ${q.unit}) kotasını/bağlantısını TAMAMLANDI OLARAK KAPATMAK istiyor musunuz?\n\nKapatıldığında sevkiyat kantar fişlerinde yeni sevkiyatları meşgul etmeyecek ve arşivde saklanacaktır.`;

    if (!confirm(confirmMsg)) return;

    try {
      const todayStr = getLocalDateStr(new Date());
      const { error } = await supabase
        .from('customer_quotas')
        .update({
          is_active: newActive,
          end_date: newActive ? (q.end_date || null) : (q.end_date || todayStr),
          updated_at: new Date().toISOString(),
        })
        .eq('id', q.id);

      if (error) throw error;
      await loadData();
    } catch (err: any) {
      console.error('Kota durum değiştirme hatası:', err);
      alert('Kota durumu güncellenirken hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
    }
  };

  // Shipment history for selected quota
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
      if (!selectedQuotaForHistory.product_id && itemUnit !== selectedQuotaForHistory.unit) return false;
      return true;
    });
  }, [selectedQuotaForHistory, shipmentItems]);

  // Shipment history for single print quota
  const singleQuotaShipments = useMemo(() => {
    if (!singlePrintQuota) return [];
    return shipmentItems.filter(item => {
      const s = item.shipments;
      if (!s) return false;
      if (s.customer_id !== singlePrintQuota.customer_id) return false;
      if (singlePrintQuota.site_id && s.site_id !== singlePrintQuota.site_id) return false;
      if (singlePrintQuota.product_id && item.product_id !== singlePrintQuota.product_id) return false;
      if (singlePrintQuota.start_date && s.shipment_date < singlePrintQuota.start_date) return false;
      if (singlePrintQuota.end_date && s.shipment_date > singlePrintQuota.end_date) return false;
      const itemUnit = item.unit || 'm2';
      if (!singlePrintQuota.product_id && itemUnit !== singlePrintQuota.unit) return false;
      return true;
    });
  }, [singlePrintQuota, shipmentItems]);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      {/* ── PRINT STYLES ── */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 0.8cm 1cm !important;
          }
          aside, header, nav, .no-print, button, input, select {
            display: none !important;
          }
          body, html, #root, main, main > div {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            color: black !important;
          }
          .print-clean {
            border: 1px solid #cbd5e1 !important;
            box-shadow: none !important;
            page-break-inside: avoid;
          }
          .print-only {
            display: block !important;
          }
          .print-hidden {
            display: none !important;
          }
          .overflow-x-auto {
            overflow: visible !important;
            width: 100% !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 9.5px !important;
          }
          th {
            background-color: #f1f5f9 !important;
            color: #0f172a !important;
            border: 1px solid #cbd5e1 !important;
            padding: 6px 8px !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          td {
            border: 1px solid #e2e8f0 !important;
            padding: 5px 8px !important;
            vertical-align: middle !important;
          }
          .print-exact {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
        @media screen {
          .print-only {
            display: none !important;
          }
        }
      `}</style>

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
              <Target size={22} />
            </div>
            Müşteri Kotaları & Sevk Takibi
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Müşteri taahhütleri, akıllı kota takibi ve serbest tarih aralıklı malzeme sevk raporları
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors cursor-pointer"
            title="Yenile"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          {activeTab === 'quotas' && (
            <>
              <button
                onClick={handlePrintAll}
                className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl font-semibold text-sm shadow-xs transition-all hover:border-slate-400 cursor-pointer"
                title="Kota ve Taahhüt Listesini Yazdır / PDF Al"
              >
                <Printer size={18} className="text-slate-600" />
                <span>Yazdır / PDF</span>
              </button>
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm shadow-sm transition-all hover:shadow cursor-pointer"
              >
                <Plus size={18} />
                Yeni Kota Tanımla
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── NAVIGATION TABS ── */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 no-print">
        <button
          onClick={() => setActiveTab('quotas')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
            activeTab === 'quotas'
              ? 'bg-amber-500 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Target size={18} />
          <span>Müşteri Kotaları & Taahhütler</span>
          {quotaKpis.approachingCount + quotaKpis.exceededCount > 0 && (
            <span className="ml-1.5 px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-red-600 text-white shadow-sm">
              {quotaKpis.approachingCount + quotaKpis.exceededCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('analysis')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${
            activeTab === 'analysis'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <BarChart2 size={18} />
          <span>Müşteri Sevk Analizi & Raporu</span>
          <span className="text-[11px] font-normal opacity-80 hidden sm:inline">(Tarih Aralıklı)</span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 1: KOTALAR & TAAHHÜTLER ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'quotas' && (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Toplam Aktif Kota</span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Target size={16} />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-2">{quotaKpis.activeCount}</p>
              <span className="text-[11px] text-slate-400">{quotaKpis.closedCount} tamamlanan / kapatılan bağlantı</span>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-600 font-medium">Kotaya Yaklaşanlar</span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Clock size={16} />
                </div>
              </div>
              <p className="text-2xl font-bold text-amber-600 mt-2">{quotaKpis.approachingCount}</p>
              <span className="text-[11px] text-amber-700/80 font-medium">%85 doluluk eşiğini geçenler</span>
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-red-600 font-medium">Kota Dolanlar / Aşanlar</span>
                <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                  <AlertTriangle size={16} />
                </div>
              </div>
              <p className="text-2xl font-bold text-red-600 mt-2">{quotaKpis.exceededCount}</p>
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
                {quotaKpis.totalShippedM2.toLocaleString('tr-TR')} m²
              </p>
              <span className="text-[11px] text-emerald-700 font-medium">
                Hedef: {quotaKpis.totalTargetM2.toLocaleString('tr-TR')} m²
              </span>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4 no-print">
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
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold">
                <button
                  onClick={() => setActiveFilter('active')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    activeFilter === 'active' ? 'bg-white text-emerald-700 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  🟢 Aktif ({quotaKpis.activeCount})
                </button>
                <button
                  onClick={() => setActiveFilter('closed')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    activeFilter === 'closed' ? 'bg-white text-slate-800 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Lock size={12} />
                  Kapatılanlar ({quotaKpis.closedCount})
                </button>
                <button
                  onClick={() => setActiveFilter('all')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    activeFilter === 'all' ? 'bg-white text-slate-900 shadow-sm font-bold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Tümü ({quotaKpis.totalCount})
                </button>
              </div>

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

          {/* ── PRINT-ONLY OFFICIAL HEADER (GENERAL QUOTA REPORT) ── */}
          {!singlePrintQuota && (
            <div className="print-only border-b-2 border-slate-800 pb-3 mb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-black text-slate-900 tracking-tight">PARKE ERP • FABRİKA YÖNETİM SİSTEMİ</h1>
                  <h2 className="text-sm font-bold text-amber-700 uppercase mt-0.5">
                    📋 MÜŞTERİ KOTALARI & TAAHHÜT TAKİP RAPORU
                  </h2>
                </div>
                <div className="text-right text-[10px] text-slate-600 font-mono">
                  <div><strong>Rapor Tarihi:</strong> {new Date().toLocaleString('tr-TR')}</div>
                  <div><strong>Durum Kapsamı:</strong> {activeFilter === 'active' ? '🟢 Aktif Kotalar' : activeFilter === 'closed' ? '🔒 Kapatılan / Tamamlanan Kotalar' : 'Tümü'}</div>
                  {unitFilter !== 'all' && <div><strong>Birim:</strong> {unitFilter}</div>}
                  {search && <div><strong>Arama:</strong> "{search}"</div>}
                </div>
              </div>

              {/* Print summary KPI bar */}
              <div className="mt-3 grid grid-cols-4 gap-2 text-xs bg-slate-50 p-2.5 rounded border border-slate-300">
                <div>
                  <span className="text-slate-600 font-medium">Aktif Kota: </span>
                  <strong className="text-slate-900">{quotaKpis.activeCount} Adet</strong>
                  <span className="text-[10px] text-slate-500 block">({quotaKpis.closedCount} kapalı / arşiv)</span>
                </div>
                <div>
                  <span className="text-amber-800 font-medium">Kotaya Yaklaşan (%85+): </span>
                  <strong className="text-amber-900">{quotaKpis.approachingCount} Adet</strong>
                </div>
                <div>
                  <span className="text-red-800 font-medium">Kota Dolan / Aşan (%100+): </span>
                  <strong className="text-red-900">{quotaKpis.exceededCount} Adet</strong>
                </div>
                <div className="text-right">
                  <span className="text-emerald-900 font-medium">Toplam Sevk: </span>
                  <strong className="text-emerald-950 font-bold block">{quotaKpis.totalShippedM2.toLocaleString('tr-TR')} m²</strong>
                  <span className="text-[10px] text-slate-500">Hedef: {quotaKpis.totalTargetM2.toLocaleString('tr-TR')} m²</span>
                </div>
              </div>
            </div>
          )}

          {/* ── PRINT-ONLY OFFICIAL HEADER (SINGLE CUSTOMER QUOTA EKSTRESİ) ── */}
          {singlePrintQuota && (
            <div className="print-only border-b-2 border-slate-800 pb-3 mb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-black text-slate-900 tracking-tight">PARKE ERP • FABRİKA YÖNETİM SİSTEMİ</h1>
                  <h2 className="text-sm font-bold text-amber-700 uppercase mt-0.5">
                    📜 MÜŞTERİ TAAHHÜT & SEVKİYAT İRSALİYE EKSTRESİ
                  </h2>
                </div>
                <div className="text-right text-[10px] text-slate-600 font-mono">
                  <div><strong>Rapor Tarihi:</strong> {new Date().toLocaleString('tr-TR')}</div>
                  <div><strong>Kota Başlangıç:</strong> {new Date(singlePrintQuota.start_date).toLocaleDateString('tr-TR')}</div>
                  {singlePrintQuota.end_date && <div><strong>Bitiş:</strong> {new Date(singlePrintQuota.end_date).toLocaleDateString('tr-TR')}</div>}
                </div>
              </div>

              {/* Single Quota Card */}
              <div className="mt-3 p-3 bg-slate-50 rounded border border-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Müşteri / Cari:</span>
                  <strong className="text-slate-900 text-sm">{singlePrintQuota.customers?.name || '-'}</strong>
                  {singlePrintQuota.customers?.phone && <span className="text-[10px] text-slate-500 block">Tel: {singlePrintQuota.customers.phone}</span>}
                </div>
                <div>
                  <span className="text-slate-500 block">Teslim Şantiyesi:</span>
                  <strong className="text-slate-900">{singlePrintQuota.sites?.name || 'Tüm Şantiyeler (Genel)'}</strong>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Kapsam: {singlePrintQuota.products?.name ? `${singlePrintQuota.products.name} (${singlePrintQuota.products.thickness || ''})` : `Tüm Ürünler (${singlePrintQuota.unit})`}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Taahhüt / Hedef:</span>
                  <strong className="text-slate-900 font-mono text-sm">{Number(singlePrintQuota.target_quantity).toLocaleString('tr-TR')} {singlePrintQuota.unit}</strong>
                  <span className="text-blue-700 font-mono font-bold block mt-0.5">
                    Sevk: {(singlePrintQuota.shipped_quantity || 0).toLocaleString('tr-TR')} {singlePrintQuota.unit}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block">Kalan Bakiye:</span>
                  <strong className={`font-mono text-sm ${((singlePrintQuota.remaining_quantity ?? 0) < 0) ? 'text-red-700' : 'text-slate-900'}`}>
                    {((singlePrintQuota.remaining_quantity ?? 0) < 0)
                      ? `+${Math.abs(singlePrintQuota.remaining_quantity ?? 0).toLocaleString('tr-TR')} ${singlePrintQuota.unit} Aşıldı`
                      : `${(singlePrintQuota.remaining_quantity ?? 0).toLocaleString('tr-TR')} ${singlePrintQuota.unit}`}
                  </strong>
                  <span className="text-[11px] font-bold block mt-0.5 text-amber-800">
                    Doluluk: %{singlePrintQuota.completion_pct || 0} {singlePrintQuota.is_active === false ? '(Kapalı)' : ''}
                  </span>
                  {singlePrintQuota.unit_price && singlePrintQuota.unit_price > 0 ? (
                    <span className="text-[11px] font-bold block mt-0.5 text-emerald-800 font-mono">
                      🏷️ Anlaşma Fiyatı: {Number(singlePrintQuota.unit_price).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺/{singlePrintQuota.unit === 'metre' ? 'm' : singlePrintQuota.unit === 'adet' ? 'Adet' : 'm²'}
                    </span>
                  ) : null}
                </div>
              </div>

              {singlePrintQuota.notes && (
                <div className="mt-2 text-xs bg-amber-50/60 p-2 rounded border border-amber-200 text-amber-900">
                  <strong>Sözleşme / Açıklama Notu:</strong> {singlePrintQuota.notes}
                </div>
              )}

              {/* Single Quota Waybill History Table */}
              <div className="mt-4">
                <h3 className="text-xs font-bold text-slate-800 mb-2 uppercase">Bu Kotaya Ait Sevkiyat İrsaliyeleri Dökümü:</h3>
                <table className="w-full text-xs text-left border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300">
                      <th className="p-2">Tarih</th>
                      <th className="p-2">İrsaliye No</th>
                      <th className="p-2">Araç Plaka</th>
                      <th className="p-2">Şantiye</th>
                      <th className="p-2">Ürün</th>
                      <th className="p-2 text-right">Sevk Miktarı</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {singleQuotaShipments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-400">
                          Bu kotanın başlangıç tarihinden sonra yapılmış sevkiyat bulunmuyor.
                        </td>
                      </tr>
                    ) : (
                      singleQuotaShipments.map((item, idx) => {
                        const s = item.shipments;
                        const prod = products.find(p => p.id === item.product_id);
                        const siteObj = sites.find(st => st.id === s?.site_id);
                        const sup = getSupplierInfo(s);

                        return (
                          <tr key={idx}>
                            <td className="p-2 font-mono">{new Date(s?.shipment_date).toLocaleDateString('tr-TR')}</td>
                            <td className="p-2 font-mono font-bold">
                              {s?.invoice_no || '-'}
                              {sup.isExternal && <span className="ml-1 text-[9px] text-amber-800 font-semibold">({sup.supplierName})</span>}
                            </td>
                            <td className="p-2 font-mono">{s?.vehicle_plate || '-'}</td>
                            <td className="p-2">{siteObj?.name || '-'}</td>
                            <td className="p-2">{prod?.name || 'Parke Taşı'}</td>
                            <td className="p-2 text-right font-bold text-blue-900 font-mono">
                              {Number(item.m2).toLocaleString('tr-TR')} {item.unit || 'm2'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Quotas Table */}
          <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${singlePrintQuota ? 'hidden print:hidden' : ''}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="px-4 py-3.5">Müşteri / Şantiye</th>
                    <th className="px-3 py-3.5">Kapsam / Ürün</th>
                    <th className="px-3 py-3.5 text-right">Anlaşma Fiyatı</th>
                    <th className="px-3 py-3.5 text-center">Başlangıç Tarihi</th>
                    <th className="px-3 py-3.5 text-right">Hedef Kota</th>
                    <th className="px-3 py-3.5 text-right">Sevk Edilen</th>
                    <th className="px-3 py-3.5 text-right">Kalan Miktar</th>
                    <th className="px-4 py-3.5 min-w-[170px]">Tamamlanma Oranı</th>
                    <th className="px-3 py-3.5 text-center">Durum</th>
                    <th className="px-3 py-3.5 text-center no-print">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredQuotas.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
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
                        <tr key={q.id} className={`transition-colors ${q.is_active === false ? 'bg-slate-50/50 opacity-75 hover:opacity-100 hover:bg-slate-50' : 'hover:bg-slate-50/60'}`}>
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

                          <td className="px-3 py-3.5 text-right font-mono">
                            {q.unit_price && q.unit_price > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-xs">
                                <span>🏷️</span>
                                {Number(q.unit_price).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs italic">Standart Liste</span>
                            )}
                          </td>

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

                          <td className="px-3 py-3.5 text-right font-bold text-slate-900 font-mono text-sm">
                            {Number(q.target_quantity).toLocaleString('tr-TR')} {q.unit}
                          </td>

                          <td className="px-3 py-3.5 text-right font-extrabold text-blue-900 font-mono text-sm">
                            {(q.shipped_quantity || 0).toLocaleString('tr-TR')} {q.unit}
                          </td>

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

                          <td className="px-3 py-3.5 text-center">
                            {q.is_active === false ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 shadow-sm">
                                <Lock size={10} />
                                Kapatıldı
                              </span>
                            ) : isExceeded ? (
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

                          <td className="px-3 py-3.5 text-center no-print">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handlePrintSingle(q)}
                                className="p-1.5 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                title="Bu Kotanın Ekstresini Yazdır / PDF Al"
                              >
                                <Printer size={15} />
                              </button>
                              <button
                                onClick={() => setSelectedQuotaForHistory(q)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                title="Sevkiyat İrsaliyelerini İncele"
                              >
                                <Eye size={15} />
                              </button>
                              <button
                                onClick={() => handleJumpToAnalysis(q.customer_id, q.start_date)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                title="Tarih Aralıklı Sevk Raporuna Git"
                              >
                                <BarChart2 size={15} />
                              </button>
                              <button
                                onClick={() => handleToggleActive(q)}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                   q.is_active !== false
                                     ? 'text-slate-400 hover:text-emerald-700 hover:bg-emerald-50'
                                     : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                                }`}
                                title={q.is_active !== false ? 'Kotayı Tamamlandı Olarak Kapat' : 'Kotayı Yeniden Aktif Et'}
                              >
                                {q.is_active !== false ? <Lock size={15} /> : <RotateCcw size={15} />}
                              </button>
                              <button
                                onClick={() => handleOpenEdit(q)}
                                className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                title="Düzenle"
                              >
                                <Edit2 size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(q.id, q.customers?.name || '')}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
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

          {/* ── PRINT-ONLY SIGNATURE FOOTER ── */}
          <div className="print-only mt-8 pt-4 border-t border-slate-300">
            <div className="grid grid-cols-3 gap-8 text-center text-xs">
              <div>
                <div className="font-bold text-slate-800">Raporu Hazırlayan</div>
                <div className="text-slate-500 text-[10px] mt-0.5">Saha / Sevkiyat Sorumlusu</div>
                <div className="mt-12 border-b border-dashed border-slate-400 mx-8"></div>
                <div className="text-[10px] text-slate-400 mt-1">İmza</div>
              </div>
              <div>
                <div className="font-bold text-slate-800">Sevkiyat & Kantar Yetkilisi</div>
                <div className="text-slate-500 text-[10px] mt-0.5">Kantar & Lojistik Kontrol</div>
                <div className="mt-12 border-b border-dashed border-slate-400 mx-8"></div>
                <div className="text-[10px] text-slate-400 mt-1">İmza</div>
              </div>
              <div>
                <div className="font-bold text-slate-800">Fabrika / Satış Müdürü</div>
                <div className="text-slate-500 text-[10px] mt-0.5">Onay & Tasdik</div>
                <div className="mt-12 border-b border-dashed border-slate-400 mx-8"></div>
                <div className="text-[10px] text-slate-400 mt-1">İmza / Kaşe</div>
              </div>
            </div>
            <div className="text-center text-[9px] text-slate-400 mt-6">
              Bu resmi belge Parke ERP Fabrika Otomasyon Sistemi tarafından üretilmiştir.
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 2: MÜŞTERİ SEVK ANALİZİ & TARİH ARALIKLI SORGULAMA ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'analysis' && (
        <CustomerShipmentAnalysis
          initialCustomerId={queryCustomerId}
          initialStartDate={queryStartDate}
          customers={customers}
          sites={sites}
          products={products}
          shipmentItems={shipmentItems}
          onRefresh={loadData}
        />
      )}

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
                  onChange={e => {
                    const pId = e.target.value;
                    const p = products.find(x => x.id === pId);
                    setForm(f => ({
                      ...f,
                      product_id: pId,
                      unit: p?.unit ? (p.unit as any) : f.unit,
                    }));
                  }}
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

            <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <span>🏷️</span>
                  <span>Sözleşme / Anlaşma Birim Satış Fiyatı (₺ / {form.unit === 'metre' ? 'Metre' : form.unit === 'adet' ? 'Adet' : 'm²'})</span>
                </label>
                <span className="text-[10px] bg-emerald-200 text-emerald-900 font-extrabold px-2 py-0.5 rounded-full border border-emerald-300">
                  1. Öncelik
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.unit_price}
                onChange={e => setForm({ ...form, unit_price: Number(e.target.value) })}
                className="w-full border border-emerald-300 rounded-xl px-3 py-2 text-xs font-bold font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                placeholder="0.00"
              />
              <p className="text-[11px] text-emerald-800 leading-tight">
                💡 Bu müşteriye sevkiyat girilirken kantar ekranında satış fiyatı <strong>otomatik olarak</strong> bu değerle dolar. (Boş veya 0 bırakılırsa fabrika standart liste fiyatı geçerli olur).
              </p>
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

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <span className="text-xs font-bold text-slate-800 block">Kota / Bağlantı Durumu</span>
                <span className="text-[11px] text-slate-500">
                  {form.is_active 
                    ? '🟢 Aktif: Sevkiyat kantar fişlerinde kontrol edilir.' 
                    : '🔒 Kapatıldı / Tamamlandı: Sevkiyatlardan kaldırılır, arşivde saklanır.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  form.is_active ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-700'
                }`}
              >
                {form.is_active ? '🟢 Aktif' : '🔒 Kapatıldı'}
              </button>
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

      {/* ── SHIPMENT HISTORY MODAL (FOR QUOTA ROW) ── */}
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
                      const sup = getSupplierInfo(s);

                      return (
                        <tr key={idx} className={`transition-colors ${sup.isExternal ? 'bg-amber-50/30 hover:bg-amber-50/50' : 'hover:bg-slate-50/70'}`}>
                          <td className="px-3 py-2.5 font-mono text-slate-700">
                            {new Date(s?.shipment_date).toLocaleDateString('tr-TR')}
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-slate-900 font-mono">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{s?.invoice_no || '-'}</span>
                              {sup.isExternal && (
                                <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300" title={`Doğrudan Transit Sevk (Tedarikçi: ${sup.supplierName})`}>
                                  <ShoppingBag size={9} className="text-amber-700" /> {sup.supplierName}
                                </span>
                              )}
                            </div>
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

            <div className="flex justify-between items-center pt-2 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const q = selectedQuotaForHistory;
                  setSelectedQuotaForHistory(null);
                  handleJumpToAnalysis(q.customer_id, q.start_date);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-blue-600 hover:text-blue-800 text-xs font-semibold hover:bg-blue-50 rounded-xl transition-colors cursor-pointer"
              >
                <BarChart2 size={15} />
                Tarih Aralıklı Tam Analiz Sayfasına Git
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedQuotaForHistory) {
                      handlePrintSingle(selectedQuotaForHistory);
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  title="Bu kotanın irsaliye dökümünü resmi çıktı olarak yazdır"
                >
                  <Printer size={15} />
                  <span>Yazdır / PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedQuotaForHistory(null)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
