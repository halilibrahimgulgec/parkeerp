import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CustomerQuota, Customer, Site, Product } from '../types';
import Modal from '../components/Modal';
import {
  Target, Plus, Search, Filter, AlertTriangle, CheckCircle2,
  AlertCircle, Edit2, Trash2, Calendar, TrendingUp, Truck,
  Printer, ArrowRight, Eye, RefreshCw, ChevronDown, Clock,
  Building2, Package, Layers, BarChart2, FileText, Scale,
  Boxes, Phone, MapPin, X
} from 'lucide-react';

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  const [statusFilter, setStatusFilter] = useState<'all' | 'normal' | 'approaching' | 'exceeded'>('all');
  const [unitFilter, setUnitFilter] = useState<'all' | 'm2' | 'metre' | 'adet'>('all');

  // ── ANALYSIS TAB STATES ──
  const [queryCustomerId, setQueryCustomerId] = useState<string>('');
  const [querySiteId, setQuerySiteId] = useState<string>('');
  const [queryProductId, setQueryProductId] = useState<string>('');
  const [queryUnit, setQueryUnit] = useState<string>('all');
  const [querySearch, setQuerySearch] = useState<string>('');
  const [queryStartDate, setQueryStartDate] = useState<string>(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return getLocalDateStr(firstDay);
  });
  const [queryEndDate, setQueryEndDate] = useState<string>(() => getLocalDateStr(new Date()));

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

  // Update sites in quota form when customer is selected
  useEffect(() => {
    if (form.customer_id) {
      const filtered = sites.filter(s => s.customer_id === form.customer_id);
      setFormSites(filtered);
    } else {
      setFormSites([]);
    }
  }, [form.customer_id, sites]);

  // Sites available for Query/Analysis tab
  const querySites = useMemo(() => {
    if (!queryCustomerId) return sites;
    return sites.filter(s => s.customer_id === queryCustomerId);
  }, [queryCustomerId, sites]);

  // Reset query site if customer changed and site doesn't belong to them
  useEffect(() => {
    if (queryCustomerId && querySiteId) {
      const exists = sites.some(s => s.id === querySiteId && s.customer_id === queryCustomerId);
      if (!exists) setQuerySiteId('');
    }
  }, [queryCustomerId, querySiteId, sites]);

  // Fast Date Presets for Query Tab
  const handleDatePreset = (preset: 'today' | 'week' | 'month' | '30days' | 'year' | 'all') => {
    const now = new Date();
    const todayStr = getLocalDateStr(now);

    if (preset === 'today') {
      setQueryStartDate(todayStr);
      setQueryEndDate(todayStr);
    } else if (preset === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const monday = new Date(now.setDate(diff));
      setQueryStartDate(getLocalDateStr(monday));
      setQueryEndDate(todayStr);
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setQueryStartDate(getLocalDateStr(firstDay));
      setQueryEndDate(todayStr);
    } else if (preset === '30days') {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setQueryStartDate(getLocalDateStr(past30));
      setQueryEndDate(todayStr);
    } else if (preset === 'year') {
      const firstJan = new Date(now.getFullYear(), 0, 1);
      setQueryStartDate(getLocalDateStr(firstJan));
      setQueryEndDate(todayStr);
    } else if (preset === 'all') {
      setQueryStartDate('');
      setQueryEndDate('');
    }
  };

  // Jump from Quotas to Analysis Tab with customer pre-selected
  const handleJumpToAnalysis = (customerId: string, startDate?: string) => {
    setActiveTab('analysis');
    setQueryCustomerId(customerId);
    setQuerySiteId('');
    setQueryProductId('');
    setQueryUnit('all');
    if (startDate) {
      setQueryStartDate(startDate);
    }
    setQueryEndDate(getLocalDateStr(new Date()));
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

  // Filtered Quotas list
  const filteredQuotas = useMemo(() => {
    return calculatedQuotas.filter(q => {
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
  }, [calculatedQuotas, search, statusFilter, unitFilter]);

  // Overall KPIs for Quotas tab
  const quotaKpis = useMemo(() => {
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

  // ── SEVK ANALİZİ HESAPLAMALARI (TAB 2) ──
  const analysisResults = useMemo(() => {
    // 1. Filter shipment items
    const matched = shipmentItems.filter(item => {
      const s = item.shipments;
      if (!s) return false;

      // Customer filter
      if (queryCustomerId && s.customer_id !== queryCustomerId) return false;

      // Site filter
      if (querySiteId && s.site_id !== querySiteId) return false;

      // Product filter
      if (queryProductId && item.product_id !== queryProductId) return false;

      // Unit filter
      const itemUnit = item.unit || 'm2';
      if (queryUnit !== 'all' && itemUnit !== queryUnit) return false;

      // Date range filter
      if (queryStartDate && s.shipment_date < queryStartDate) return false;
      if (queryEndDate && s.shipment_date > queryEndDate) return false;

      // Search keyword filter (invoice, plate, driver)
      if (querySearch.trim()) {
        const kw = querySearch.toLowerCase();
        const inv = (s.invoice_no || '').toLowerCase();
        const plate = (s.vehicle_plate || '').toLowerCase();
        const driver = (s.driver_name || '').toLowerCase();
        if (!inv.includes(kw) && !plate.includes(kw) && !driver.includes(kw)) {
          return false;
        }
      }

      return true;
    });

    // 2. Aggregate Totals
    let totalM2 = 0;
    let totalMetre = 0;
    let totalAdet = 0;
    let totalPallets = 0;
    const uniqueShipments = new Map<string, any>();

    matched.forEach(item => {
      const s = item.shipments;
      const u = item.unit || 'm2';
      const qty = Number(item.m2) || 0;
      const pal = Number(item.pallets) || 0;

      if (u === 'm2') totalM2 += qty;
      else if (u === 'metre') totalMetre += qty;
      else if (u === 'adet') totalAdet += qty;

      totalPallets += pal;

      if (s && !uniqueShipments.has(s.id)) {
        uniqueShipments.set(s.id, s);
      }
    });

    // Calculate total net weight from unique shipments
    let totalNetWeightKg = 0;
    uniqueShipments.forEach(s => {
      const gross = Number(s.gross_weight) || 0;
      const tare = Number(s.tare_weight) || 0;
      if (gross > tare) {
        totalNetWeightKg += (gross - tare);
      }
    });

    // 3. Product Breakdown
    const prodMap = new Map<string, {
      product_id: string;
      name: string;
      thickness: string;
      color: string;
      unit: string;
      total_qty: number;
      total_pallets: number;
      shipment_count: number;
      shipment_ids: Set<string>;
    }>();

    matched.forEach(item => {
      const prod = products.find(p => p.id === item.product_id);
      const pid = item.product_id || 'unknown';
      const name = prod ? prod.name : 'Diğer / Belirtilmemiş';
      const thickness = prod?.thickness || '';
      const color = prod?.color || '';
      const unit = item.unit || prod?.unit || 'm2';
      const qty = Number(item.m2) || 0;
      const pal = Number(item.pallets) || 0;
      const sId = item.shipments?.id;

      if (!prodMap.has(pid)) {
        prodMap.set(pid, {
          product_id: pid,
          name,
          thickness,
          color,
          unit,
          total_qty: 0,
          total_pallets: 0,
          shipment_count: 0,
          shipment_ids: new Set(),
        });
      }

      const pEntry = prodMap.get(pid)!;
      pEntry.total_qty += qty;
      pEntry.total_pallets += pal;
      if (sId && !pEntry.shipment_ids.has(sId)) {
        pEntry.shipment_ids.add(sId);
        pEntry.shipment_count++;
      }
    });

    const productBreakdown = Array.from(prodMap.values()).sort((a, b) => b.total_qty - a.total_qty);

    // 4. Site Breakdown
    const siteMap = new Map<string, {
      site_id: string;
      name: string;
      total_m2: number;
      total_metre: number;
      total_adet: number;
      total_pallets: number;
      shipment_count: number;
      shipment_ids: Set<string>;
    }>();

    matched.forEach(item => {
      const s = item.shipments;
      const sid = s?.site_id || 'unassigned';
      const siteObj = sites.find(st => st.id === sid);
      const name = siteObj ? siteObj.name : 'Genel / Belirtilmemiş Şantiye';
      const unit = item.unit || 'm2';
      const qty = Number(item.m2) || 0;
      const pal = Number(item.pallets) || 0;
      const sId = s?.id;

      if (!siteMap.has(sid)) {
        siteMap.set(sid, {
          site_id: sid,
          name,
          total_m2: 0,
          total_metre: 0,
          total_adet: 0,
          total_pallets: 0,
          shipment_count: 0,
          shipment_ids: new Set(),
        });
      }

      const sEntry = siteMap.get(sid)!;
      if (unit === 'm2') sEntry.total_m2 += qty;
      else if (unit === 'metre') sEntry.total_metre += qty;
      else if (unit === 'adet') sEntry.total_adet += qty;
      sEntry.total_pallets += pal;

      if (sId && !sEntry.shipment_ids.has(sId)) {
        sEntry.shipment_ids.add(sId);
        sEntry.shipment_count++;
      }
    });

    const siteBreakdown = Array.from(siteMap.values()).sort((a, b) => b.total_m2 - a.total_m2);

    // 5. Group by Shipment for chronological list
    const shipMap = new Map<string, {
      shipment: any;
      items: any[];
      total_m2: number;
      total_pallets: number;
    }>();

    matched.forEach(item => {
      const s = item.shipments;
      if (!s) return;
      if (!shipMap.has(s.id)) {
        shipMap.set(s.id, {
          shipment: s,
          items: [],
          total_m2: 0,
          total_pallets: 0,
        });
      }
      const sg = shipMap.get(s.id)!;
      sg.items.push(item);
      sg.total_m2 += Number(item.m2) || 0;
      sg.total_pallets += Number(item.pallets) || 0;
    });

    const shipmentList = Array.from(shipMap.values()).sort((a, b) => {
      return (b.shipment.shipment_date || '').localeCompare(a.shipment.shipment_date || '');
    });

    return {
      matchedCount: matched.length,
      totalM2,
      totalMetre,
      totalAdet,
      totalPallets,
      totalShipments: uniqueShipments.size,
      totalNetWeightKg,
      productBreakdown,
      siteBreakdown,
      shipmentList,
    };
  }, [shipmentItems, queryCustomerId, querySiteId, queryProductId, queryUnit, queryStartDate, queryEndDate, querySearch, products, sites]);

  // Selected customer details for summary header
  const selectedCustomerObj = useMemo(() => {
    return customers.find(c => c.id === queryCustomerId);
  }, [customers, queryCustomerId]);

  // Quota Form Handlers
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
        target_quantity: form.target_quantity,
        unit: form.unit,
        alert_threshold_pct: form.alert_threshold_pct,
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: form.notes,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };

      if (editingQuota) {
        const { error } = await supabase
          .from('customer_quotas')
          .update(payload)
          .eq('id', editingQuota.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('customer_quotas')
          .insert([payload]);
        if (error) throw error;
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
      if (itemUnit !== selectedQuotaForHistory.unit) return false;
      return true;
    });
  }, [selectedQuotaForHistory, shipmentItems]);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      {/* ── PRINT STYLES ── */}
      <style>{`
        @media print {
          aside, header, nav, .no-print, button {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
          }
          .print-clean {
            border: 1px solid #cbd5e1 !important;
            box-shadow: none !important;
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

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
            title="Yenile"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          {activeTab === 'quotas' && (
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm shadow-sm transition-all hover:shadow"
            >
              <Plus size={18} />
              Yeni Kota Tanımla
            </button>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Toplam Aktif Kota</span>
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Target size={16} />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-2">{quotaKpis.totalCount}</p>
              <span className="text-[11px] text-slate-400">Tanımlı müşteri taahhüdü</span>
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

          {/* Quotas Table */}
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
                                onClick={() => handleJumpToAnalysis(q.customer_id, q.start_date)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Tarih Aralıklı Sevk Raporuna Git"
                              >
                                <BarChart2 size={15} />
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
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 2: MÜŞTERİ SEVK ANALİZİ & TARİH ARALIKLI SORGULAMA ── */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'analysis' && (
        <div className="space-y-6">
          {/* Query Filter Card */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4 no-print">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Filter size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Sevk Sorgulama & Filtreleme</h3>
                  <p className="text-slate-400 text-xs">Müşteri ve tarih aralığı belirleyerek sevkiyatları anlık analiz edin</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold text-xs transition-colors shadow-sm"
                  title="Yazdır veya PDF olarak kaydet"
                >
                  <Printer size={15} />
                  <span>Yazdır / PDF</span>
                </button>
                <button
                  onClick={loadData}
                  className="flex items-center gap-1 px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl text-xs font-semibold border border-slate-200"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  <span>Yenile</span>
                </button>
              </div>
            </div>

            {/* Filter Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Müşteri Seçimi */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Müşteri Seçimi
                </label>
                <select
                  value={queryCustomerId}
                  onChange={e => {
                    setQueryCustomerId(e.target.value);
                    setQuerySiteId('');
                  }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="">-- Tüm Müşteriler (Genel Özet) --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* 2. Şantiye Seçimi */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Şantiye
                </label>
                <select
                  value={querySiteId}
                  onChange={e => setQuerySiteId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="">-- Tüm Şantiyeler --</option>
                  {querySites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* 3. Başlangıç Tarihi */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Başlangıç Tarihi
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={queryStartDate}
                    onChange={e => setQueryStartDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  />
                  {queryStartDate && (
                    <button
                      onClick={() => setQueryStartDate('')}
                      className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                      title="Temizle"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* 4. Bitiş Tarihi */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Bitiş Tarihi
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={queryEndDate}
                    onChange={e => setQueryEndDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  />
                  {queryEndDate && (
                    <button
                      onClick={() => setQueryEndDate('')}
                      className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                      title="Temizle"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Date Presets & Secondary Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-medium mr-1 text-[11px]">Hızlı Tarih:</span>
                <button
                  onClick={() => handleDatePreset('today')}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
                >
                  Bugün
                </button>
                <button
                  onClick={() => handleDatePreset('week')}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
                >
                  Bu Hafta
                </button>
                <button
                  onClick={() => handleDatePreset('month')}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
                >
                  Bu Ay
                </button>
                <button
                  onClick={() => handleDatePreset('30days')}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
                >
                  Son 30 Gün
                </button>
                <button
                  onClick={() => handleDatePreset('year')}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
                >
                  Bu Yıl
                </button>
                <button
                  onClick={() => handleDatePreset('all')}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
                >
                  Tüm Zamanlar
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Ürün Filtresi */}
                <select
                  value={queryProductId}
                  onChange={e => setQueryProductId(e.target.value)}
                  className="border border-slate-200 rounded-xl px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="">Tüm Ürünler</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.thickness})</option>
                  ))}
                </select>

                {/* Birim Filtresi */}
                <select
                  value={queryUnit}
                  onChange={e => setQueryUnit(e.target.value)}
                  className="border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="all">Tüm Birimler</option>
                  <option value="m2">m² (Metrekare)</option>
                  <option value="metre">Metre (Bordür)</option>
                  <option value="adet">Adet</option>
                </select>

                {/* Arama */}
                <div className="relative w-44">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="İrsaliye, plaka..."
                    value={querySearch}
                    onChange={e => setQuerySearch(e.target.value)}
                    className="w-full pl-7 pr-2 py-1 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── ACTIVE CUSTOMER BANNER (PRINT & SCREEN) ── */}
          <div className="bg-gradient-to-r from-blue-900 to-slate-900 text-white rounded-2xl p-5 shadow-sm print-clean">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs text-blue-300 font-semibold uppercase tracking-wider">
                  Müşteri Sevk Ekstresi & Raporu
                </span>
                <h2 className="text-xl sm:text-2xl font-bold mt-1">
                  {selectedCustomerObj ? selectedCustomerObj.name : 'Tüm Müşteriler Genel Özeti'}
                </h2>
                {selectedCustomerObj && (
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 mt-1.5">
                    {selectedCustomerObj.phone && (
                      <span className="flex items-center gap-1">
                        <Phone size={13} className="text-blue-400" />
                        {selectedCustomerObj.phone}
                      </span>
                    )}
                    {selectedCustomerObj.address && (
                      <span className="flex items-center gap-1">
                        <MapPin size={13} className="text-blue-400" />
                        {selectedCustomerObj.address}
                      </span>
                    )}
                    {querySiteId && (
                      <span className="bg-blue-800/60 px-2 py-0.5 rounded-lg text-blue-200 font-medium">
                        Şantiye: {sites.find(s => s.id === querySiteId)?.name}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10 text-right min-w-[200px]">
                <span className="text-[11px] text-blue-200 block">Sorgu Tarih Aralığı:</span>
                <strong className="text-sm font-mono block">
                  {queryStartDate ? new Date(queryStartDate).toLocaleDateString('tr-TR') : 'Başlangıçtan'}
                  {' → '}
                  {queryEndDate ? new Date(queryEndDate).toLocaleDateString('tr-TR') : 'Bugüne'}
                </strong>
                <span className="text-[10px] text-blue-300 mt-0.5 block">
                  Toplam {analysisResults.totalShipments} Sefer • {analysisResults.matchedCount} Sevkiyat Kalemi
                </span>
              </div>
            </div>
          </div>

          {/* ── KPI METRIC CARDS ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Toplam m² */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[11px] font-bold text-slate-500">Toplam m²</span>
                <Layers size={15} className="text-blue-500" />
              </div>
              <p className="text-xl font-black text-slate-900 font-mono">
                {analysisResults.totalM2.toLocaleString('tr-TR')}
              </p>
              <span className="text-[10px] text-slate-400 font-medium">Metrekare parke</span>
            </div>

            {/* Toplam Metre */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[11px] font-bold text-slate-500">Toplam Metre</span>
                <TrendingUp size={15} className="text-amber-500" />
              </div>
              <p className="text-xl font-black text-slate-900 font-mono">
                {analysisResults.totalMetre.toLocaleString('tr-TR')}
              </p>
              <span className="text-[10px] text-slate-400 font-medium">Bordür / Oluk (tül)</span>
            </div>

            {/* Toplam Adet */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[11px] font-bold text-slate-500">Toplam Adet</span>
                <Package size={15} className="text-purple-500" />
              </div>
              <p className="text-xl font-black text-slate-900 font-mono">
                {analysisResults.totalAdet.toLocaleString('tr-TR')}
              </p>
              <span className="text-[10px] text-slate-400 font-medium">Adetli ürünler</span>
            </div>

            {/* Toplam Palet */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[11px] font-bold text-slate-500">Toplam Palet</span>
                <Boxes size={15} className="text-orange-500" />
              </div>
              <p className="text-xl font-black text-slate-900 font-mono">
                {analysisResults.totalPallets.toLocaleString('tr-TR')}
              </p>
              <span className="text-[10px] text-slate-400 font-medium">Sevk edilen palet</span>
            </div>

            {/* Sefer / İrsaliye */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[11px] font-bold text-slate-500">Toplam Sefer</span>
                <Truck size={15} className="text-emerald-500" />
              </div>
              <p className="text-xl font-black text-slate-900 font-mono">
                {analysisResults.totalShipments}
              </p>
              <span className="text-[10px] text-slate-400 font-medium">Araç / İrsaliye</span>
            </div>

            {/* Net Tonaj */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-[11px] font-bold text-slate-500">Net Tonaj</span>
                <Scale size={15} className="text-slate-500" />
              </div>
              <p className="text-xl font-black text-slate-900 font-mono">
                {(analysisResults.totalNetWeightKg / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Ton
              </p>
              <span className="text-[10px] text-slate-400 font-medium">
                {analysisResults.totalNetWeightKg.toLocaleString('tr-TR')} kg net
              </span>
            </div>
          </div>

          {/* ── PRODUCT BREAKDOWN TABLE ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print-clean">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package size={16} className="text-slate-700" />
                <h3 className="font-bold text-slate-900 text-sm">Ürün Bazında Sevk Kırılımı</h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {analysisResults.productBreakdown.length} Farklı Ürün
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="px-4 py-3">Ürün Adı</th>
                    <th className="px-3 py-3">Özellik (Kalınlık / Renk)</th>
                    <th className="px-3 py-3 text-right">Sevk Miktarı</th>
                    <th className="px-3 py-3 text-right">Palet</th>
                    <th className="px-3 py-3 text-right">Sefer</th>
                    <th className="px-4 py-3 min-w-[150px]">Dağılım Payı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analysisResults.productBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Belirtilen tarih aralığında ve kriterlere uygun sevk edilmiş ürün bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    analysisResults.productBreakdown.map((p, idx) => {
                      const baseTotal = p.unit === 'm2'
                        ? analysisResults.totalM2
                        : p.unit === 'metre'
                        ? analysisResults.totalMetre
                        : analysisResults.totalAdet;
                      const sharePct = baseTotal > 0 ? Math.round((p.total_qty / baseTotal) * 100) : 0;

                      return (
                        <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-900">
                            {p.name}
                          </td>
                          <td className="px-3 py-3 text-slate-500">
                            {p.thickness ? `${p.thickness}` : '-'}
                            {p.color ? ` / ${p.color}` : ''}
                          </td>
                          <td className="px-3 py-3 text-right font-extrabold text-blue-900 font-mono text-sm">
                            {p.total_qty.toLocaleString('tr-TR')} {p.unit}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-700 font-mono">
                            {p.total_pallets > 0 ? `${p.total_pallets.toLocaleString('tr-TR')} Palet` : '-'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-slate-600">
                            {p.shipment_count} Sefer
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full"
                                  style={{ width: `${Math.min(sharePct, 100)}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-semibold text-slate-600 min-w-[32px] text-right">
                                %{sharePct}
                              </span>
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

          {/* ── SITE BREAKDOWN TABLE (IF APPLICABLE) ── */}
          {analysisResults.siteBreakdown.length > 1 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print-clean">
              <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 size={16} className="text-slate-700" />
                  <h3 className="font-bold text-slate-900 text-sm">Şantiye Bazında Dağılım</h3>
                </div>
                <span className="text-xs text-slate-500 font-medium">
                  {analysisResults.siteBreakdown.length} Şantiye
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="px-4 py-3">Şantiye Adı</th>
                      <th className="px-3 py-3 text-right">Sevk (m²)</th>
                      <th className="px-3 py-3 text-right">Sevk (Metre)</th>
                      <th className="px-3 py-3 text-right">Sevk (Adet)</th>
                      <th className="px-3 py-3 text-right">Palet Sayısı</th>
                      <th className="px-3 py-3 text-right">Sefer Adedi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analysisResults.siteBreakdown.map((st, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {st.name}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-slate-800">
                          {st.total_m2 > 0 ? `${st.total_m2.toLocaleString('tr-TR')} m²` : '-'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">
                          {st.total_metre > 0 ? `${st.total_metre.toLocaleString('tr-TR')} m` : '-'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-700">
                          {st.total_adet > 0 ? `${st.total_adet.toLocaleString('tr-TR')} adet` : '-'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-600">
                          {st.total_pallets.toLocaleString('tr-TR')}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-blue-700">
                          {st.shipment_count} Sefer
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── DETAILED SHIPMENT / WAYBILL LIST ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print-clean">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck size={16} className="text-slate-700" />
                <h3 className="font-bold text-slate-900 text-sm">Kronolojik Sevkiyat & İrsaliye Dökümü</h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {analysisResults.shipmentList.length} İrsaliye
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="px-3 py-3">Tarih</th>
                    <th className="px-3 py-3">İrsaliye No</th>
                    <th className="px-3 py-3">Müşteri</th>
                    <th className="px-3 py-3">Şantiye</th>
                    <th className="px-3 py-3">Araç / Plaka</th>
                    <th className="px-4 py-3">Sevk Edilen Malzemeler</th>
                    <th className="px-3 py-3 text-right">Toplam Palet</th>
                    <th className="px-3 py-3 text-right">Net Tonaj</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analysisResults.shipmentList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-400">
                        Seçilen kriterlere uygun sevkiyat irsaliyesi bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    analysisResults.shipmentList.map((entry, idx) => {
                      const s = entry.shipment;
                      const cust = customers.find(c => c.id === s.customer_id);
                      const siteObj = sites.find(st => st.id === s.site_id);
                      const netKg = Math.max(0, (Number(s.gross_weight) || 0) - (Number(s.tare_weight) || 0));

                      return (
                        <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-3 py-3 font-mono font-medium text-slate-700 whitespace-nowrap">
                            {new Date(s.shipment_date).toLocaleDateString('tr-TR')}
                          </td>
                          <td className="px-3 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                            {s.invoice_no || '-'}
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-800">
                            {cust?.name || '-'}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {siteObj?.name || '-'}
                          </td>
                          <td className="px-3 py-3 font-mono text-slate-600 whitespace-nowrap">
                            <div className="font-bold text-slate-800">{s.vehicle_plate || '-'}</div>
                            {s.driver_name && <div className="text-[10px] text-slate-400">{s.driver_name}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              {entry.items.map((it, itemIdx) => {
                                const prod = products.find(p => p.id === it.product_id);
                                return (
                                  <div key={itemIdx} className="flex items-center gap-2 text-slate-700">
                                    <span className="font-semibold text-slate-800">
                                      {prod?.name || 'Parke Taşı'}
                                    </span>
                                    <span className="font-mono font-bold text-blue-800">
                                      {Number(it.m2).toLocaleString('tr-TR')} {it.unit || 'm2'}
                                    </span>
                                    {Number(it.pallets) > 0 && (
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        ({it.pallets} palet)
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">
                            {entry.total_pallets > 0 ? entry.total_pallets : '-'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-slate-600">
                            {netKg > 0 ? `${(netKg / 1000).toFixed(2)} Ton` : '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => {
                  const q = selectedQuotaForHistory;
                  setSelectedQuotaForHistory(null);
                  handleJumpToAnalysis(q.customer_id, q.start_date);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-blue-600 hover:text-blue-800 text-xs font-semibold hover:bg-blue-50 rounded-xl transition-colors"
              >
                <BarChart2 size={15} />
                Tarih Aralıklı Tam Analiz Sayfasına Git
              </button>
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
