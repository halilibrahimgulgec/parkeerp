import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Product, Customer, Site, CustomerQuota,
  MachineDefinition, ProductionOrder, ProductionPlan, ProductionPlanItem
} from '../types';
import Modal from '../components/Modal';
import {
  generateSmartProductionPlan,
  PlanningOptions,
  AIPlanningResult
} from '../utils/productionPlanner';
import {
  Sparkles, Calendar, Factory, Plus, Filter,
  CheckCircle2, AlertTriangle, ArrowLeftRight,
  Layers, Printer, RefreshCw,
  Sliders, Trash2
} from 'lucide-react';

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type PlanningTab = 'agent' | 'schedule' | 'orders' | 'machines';

export default function ProductionPlanning() {
  const { user } = useAuth();

  // Navigation tab
  const [activeTab, setActiveTab] = useState<PlanningTab>('agent');

  // Core Data States
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [quotas, setQuotas] = useState<CustomerQuota[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [machines, setMachines] = useState<MachineDefinition[]>([]);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [activePlan, setActivePlan] = useState<ProductionPlan | null>(null);
  const [planItems, setPlanItems] = useState<ProductionPlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // AI Agent Planning Parameters
  const [planningOptions, setPlanningOptions] = useState<PlanningOptions>({
    startDate: getLocalDateStr(),
    daysCount: 7,
    shiftsPerDay: 2,
    strategy: 'minimize_mold_change',
    includeMinStockDeficit: true,
    includeQuotaDemand: true,
  });

  // Generated Plan State
  const [generatedPlan, setGeneratedPlan] = useState<AIPlanningResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  // Order Form Modal State
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ProductionOrder | null>(null);
  const [orderForm, setOrderForm] = useState({
    customer_id: '',
    site_id: '',
    product_id: '',
    quantity: 1000,
    unit: 'm2' as 'm2' | 'metre' | 'adet',
    due_date: getLocalDateStr(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    priority: 'normal' as 'critical' | 'high' | 'normal' | 'low',
    notes: '',
  });

  // Schedule Filter
  const [scheduleDateFilter, setScheduleDateFilter] = useState('');
  const [scheduleMachineFilter, setScheduleMachineFilter] = useState<'all' | '1' | '2'>('all');

  // -------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------
  const loadAllData = async () => {
    setLoading(true);
    try {
      const [
        prodRes,
        custRes,
        siteRes,
        quotaRes,
        orderRes,
        machRes,
        planRes,
        stockRes,
        itemsRes,
      ] = await Promise.all([
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('sites').select('*').eq('is_active', true).order('name'),
        supabase.from('customer_quotas').select('*, customers(*), sites(*), products(*)').eq('is_active', true),
        supabase.from('production_orders').select('*, customers(*), sites(*), products(*)').order('created_at', { ascending: false }),
        supabase.from('machine_definitions').select('*').order('machine_no'),
        supabase.from('production_plans').select('*').order('created_at', { ascending: false }),
        supabase.from('v_product_stock').select('*'),
        supabase.from('production_plan_items').select('*, products(*), production_orders(*), customer_quotas(*)').order('planned_date').order('sequence_order'),
      ]);

      if (prodRes.data) setProducts(prodRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (siteRes.data) setSites(siteRes.data);
      if (quotaRes.data) setQuotas(quotaRes.data as any);
      if (orderRes.data) setOrders(orderRes.data as any);

      // Machines fallback if table empty
      if (machRes.data && machRes.data.length > 0) {
        setMachines(machRes.data);
      } else {
        setMachines([
          {
            machine_no: '1',
            name: '1 Nolu Parke Baskı Makinesi',
            daily_capacity_m2: 1000,
            shift_count: 2,
            specialized_types: ['Kilitli', 'Aşık', 'Prizma', 'Küp Taşı'],
            notes: 'Ana parke hattı',
            is_active: true,
          },
          {
            machine_no: '2',
            name: '2 Nolu Parke & Bordür Makinesi',
            daily_capacity_m2: 1000,
            shift_count: 2,
            specialized_types: ['Bordür', 'Oluk', 'Kilitli', 'Begonit', 'Tretuar'],
            notes: 'Bordür ve ikincil parke hattı',
            is_active: true,
          },
        ]);
      }

      // Stock Map
      const sMap: Record<string, number> = {};
      if (stockRes.data) {
        stockRes.data.forEach((s: any) => {
          sMap[s.product_id] = Number(s.current_stock || 0);
        });
      }
      setStockMap(sMap);

      // Plans & Items
      const planList = (planRes.data || []) as ProductionPlan[];
      setPlans(planList);
      if (planList.length > 0) {
        const active = planList.find(p => p.status === 'active') || planList[0];
        setActivePlan(active);
      }
      setPlanItems((itemsRes.data || []) as any);
    } catch (err) {
      console.error('Veri yüklenirken hata:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // -------------------------------------------------------------
  // AI Planning Generator Trigger
  // -------------------------------------------------------------
  const handleRunAIAgent = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const res = generateSmartProductionPlan({
        products,
        stockMap,
        orders,
        quotas,
        machines,
        options: planningOptions,
      });
      setGeneratedPlan(res);
      setIsGenerating(false);
    }, 400);
  };

  // Move item between Machine 1 and Machine 2 in generated preview
  const handleTogglePreviewMachine = (itemIndex: number) => {
    if (!generatedPlan) return;
    const newItems = [...generatedPlan.items];
    const target = newItems[itemIndex];
    target.machine_no = target.machine_no === '1' ? '2' : '1';
    setGeneratedPlan({
      ...generatedPlan,
      items: newItems,
    });
  };

  // Approve & Save Generated Plan
  const handleSaveAndActivatePlan = async () => {
    if (!generatedPlan || generatedPlan.items.length === 0) return;
    setIsSavingPlan(true);
    try {
      // 1. Insert new production plan
      const planPayload = {
        plan_name: generatedPlan.planName,
        start_date: generatedPlan.startDate,
        end_date: generatedPlan.endDate,
        status: 'active',
        ai_summary: generatedPlan.summary,
        created_by: user?.id,
      };

      const { data: createdPlan, error: planErr } = await supabase
        .from('production_plans')
        .insert(planPayload)
        .select()
        .single();

      if (planErr) throw planErr;

      // 2. Insert plan items
      const itemsPayload = generatedPlan.items.map((it, idx) => ({
        plan_id: createdPlan.id,
        machine_no: it.machine_no,
        planned_date: it.planned_date,
        shift: it.shift,
        product_id: it.product_id,
        order_id: it.order_id || null,
        quota_id: it.quota_id || null,
        planned_m2: it.planned_m2,
        planned_pallets: it.planned_pallets || 0,
        produced_m2: 0,
        status: 'scheduled',
        sequence_order: idx + 1,
        notes: it.notes || '',
      }));

      const { error: itemsErr } = await supabase
        .from('production_plan_items')
        .insert(itemsPayload);

      if (itemsErr) throw itemsErr;

      // 3. Mark linked orders as 'planned'
      const linkedOrderIds = generatedPlan.items
        .map(it => it.order_id)
        .filter(Boolean) as string[];

      if (linkedOrderIds.length > 0) {
        await supabase
          .from('production_orders')
          .update({ status: 'planned' })
          .in('id', linkedOrderIds);
      }

      alert('Tebrikler! AI Üretim Planı başarıyla kaydedildi ve Makine Çalışma Çizelgesine aktarıldı.');
      setGeneratedPlan(null);
      await loadAllData();
      setActiveTab('schedule');
    } catch (err: any) {
      console.error('Plan kaydedilirken hata:', err);
      alert('Plan kaydedilirken bir hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
    } finally {
      setIsSavingPlan(false);
    }
  };

  // Toggle Item Status in Schedule
  const handleUpdateItemStatus = async (itemId: string, newStatus: 'scheduled' | 'in_progress' | 'completed') => {
    try {
      const { error } = await supabase
        .from('production_plan_items')
        .update({ status: newStatus })
        .eq('id', itemId);
      if (error) throw error;
      setPlanItems(prev => prev.map(it => it.id === itemId ? { ...it, status: newStatus } : it));
    } catch (err) {
      console.error('Durum güncelleme hatası:', err);
    }
  };

  // Move scheduled item to other machine
  const handleMoveScheduleItemMachine = async (itemId: string, currentMachine: string) => {
    const newMachine = currentMachine === '1' ? '2' : '1';
    try {
      const { error } = await supabase
        .from('production_plan_items')
        .update({ machine_no: newMachine })
        .eq('id', itemId);
      if (error) throw error;
      setPlanItems(prev => prev.map(it => it.id === itemId ? { ...it, machine_no: newMachine } : it));
    } catch (err) {
      console.error('Makine değiştirme hatası:', err);
    }
  };

  // -------------------------------------------------------------
  // Order Management Handlers
  // -------------------------------------------------------------
  const handleOpenNewOrder = () => {
    setEditingOrder(null);
    setOrderForm({
      customer_id: customers[0]?.id || '',
      site_id: '',
      product_id: products[0]?.id || '',
      quantity: 1000,
      unit: (products[0]?.unit as any) || 'm2',
      due_date: getLocalDateStr(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      priority: 'normal',
      notes: '',
    });
    setShowOrderModal(true);
  };

  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForm.product_id) {
      alert('Lütfen bir ürün seçin.');
      return;
    }

    try {
      const payload: any = {
        order_no: editingOrder?.order_no || `SIP-${Date.now().toString().slice(-6)}`,
        customer_id: orderForm.customer_id || null,
        site_id: orderForm.site_id || null,
        product_id: orderForm.product_id,
        quantity: Number(orderForm.quantity),
        unit: orderForm.unit,
        due_date: orderForm.due_date || null,
        priority: orderForm.priority,
        notes: orderForm.notes,
        created_by: user?.id,
      };

      if (editingOrder) {
        const { error } = await supabase
          .from('production_orders')
          .update(payload)
          .eq('id', editingOrder.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('production_orders')
          .insert(payload);
        if (error) throw error;
      }

      setShowOrderModal(false);
      await loadAllData();
    } catch (err: any) {
      console.error('Sipariş kaydetme hatası:', err);
      alert('Sipariş kaydedilirken hata: ' + err.message);
    }
  };

  const handleDeleteOrder = async (id: string, orderNo: string) => {
    if (!confirm(`"${orderNo}" numaralı siparişi silmek istediğinize emin misiniz?`)) return;
    try {
      await supabase.from('production_orders').delete().eq('id', id);
      await loadAllData();
    } catch (err) {
      console.error('Sipariş silinemedi:', err);
    }
  };

  // Convert Quota Remaining to Production Order
  const handleCreateOrderFromQuota = (q: CustomerQuota) => {
    const target = Number(q.target_quantity || 0);
    const shipped = Number(q.shipped_quantity || 0);
    const remaining = Math.max(0, target - shipped);

    setEditingOrder(null);
    setOrderForm({
      customer_id: q.customer_id,
      site_id: q.site_id || '',
      product_id: q.product_id || products[0]?.id || '',
      quantity: remaining > 0 ? remaining : 1000,
      unit: (q.unit as any) || 'm2',
      due_date: q.end_date || getLocalDateStr(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)),
      priority: 'high',
      notes: `Müşteri Kotası / Taahhüdü Aktarımı (${q.customers?.name})`,
    });
    setShowOrderModal(true);
  };

  // -------------------------------------------------------------
  // Filtered Schedule Items
  // -------------------------------------------------------------
  const filteredScheduleItems = useMemo(() => {
    return planItems.filter(it => {
      const matchPlan = !activePlan || it.plan_id === activePlan.id;
      const matchDate = !scheduleDateFilter || it.planned_date === scheduleDateFilter;
      const matchMach = scheduleMachineFilter === 'all' || it.machine_no === scheduleMachineFilter;
      return matchPlan && matchDate && matchMach;
    });
  }, [planItems, activePlan, scheduleDateFilter, scheduleMachineFilter]);

  const machine1Items = useMemo(() => {
    return filteredScheduleItems.filter(it => it.machine_no === '1');
  }, [filteredScheduleItems]);

  const machine2Items = useMemo(() => {
    return filteredScheduleItems.filter(it => it.machine_no === '2');
  }, [filteredScheduleItems]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
              2 Makine / Hat Planlama Motoru
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2.5 mt-1">
            <Sparkles className="text-amber-500" size={28} /> Üretim Planlama & Akıllı Asistan (AI)
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Kalan stok, kritik stok uyarıları ve müşteri taleplerine göre optimize edilmiş otomatik üretim çizelgesi
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadAllData}
            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Yenile
          </button>
          <button
            onClick={() => {
              setActiveTab('agent');
              handleRunAIAgent();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl text-sm font-bold shadow-sm shadow-amber-500/20 transition-all"
          >
            <Sparkles size={16} />
            <span>AI Plan Oluştur</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        {[
          { id: 'agent', label: '🤖 Akıllı Planlama Asistanı (AI)', icon: Sparkles },
          { id: 'schedule', label: '📅 İki Makine Çalışma Çizelgesi', icon: Calendar },
          { id: 'orders', label: '📦 Sipariş & Talep Havuzu', icon: Layers },
          { id: 'machines', label: '⚙️ Makine Parametreleri', icon: Sliders },
        ].map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as PlanningTab)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-amber-400' : 'text-slate-400'} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: 🤖 AKILLI PLANLAMA ASİSTANI (AI AGENT) */}
      {/* ========================================================================= */}
      {activeTab === 'agent' && (
        <div className="space-y-6">
          {/* Top Info Banner */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-semibold text-slate-500">Kritik Stoktaki Ürünler</span>
                <AlertTriangle size={16} className="text-red-500" />
              </div>
              <p className="text-2xl font-black text-slate-900">
                {products.filter(p => (stockMap[p.id] || 0) < (p.min_stock_alert || 0)).length} Ürün
              </p>
              <span className="text-[11px] text-red-600 font-medium">Emniyet stoğunun altında</span>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-semibold text-slate-500">Bekleyen Sipariş Miktarı</span>
                <Layers size={16} className="text-blue-500" />
              </div>
              <p className="text-2xl font-black text-blue-700 font-mono">
                {orders.filter(o => o.status === 'pending').reduce((sum, o) => sum + Number(o.quantity || 0), 0).toLocaleString('tr-TR')} m²
              </p>
              <span className="text-[11px] text-slate-400">Üretim bekleyen net talep</span>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-semibold text-slate-500">1 Nolu Makine Kapasitesi</span>
                <Factory size={16} className="text-amber-500" />
              </div>
              <p className="text-2xl font-black text-slate-800 font-mono">
                {((machines.find(m => m.machine_no === '1')?.daily_capacity_m2 || 1000)).toLocaleString('tr-TR')} m²/gün
              </p>
              <span className="text-[11px] text-slate-400">2 Vardiya (Gündüz + Gece)</span>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-semibold text-slate-500">2 Nolu Makine Kapasitesi</span>
                <Factory size={16} className="text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-slate-800 font-mono">
                {((machines.find(m => m.machine_no === '2')?.daily_capacity_m2 || 1000)).toLocaleString('tr-TR')} m²/gün
              </p>
              <span className="text-[11px] text-slate-400">2 Vardiya (Bordür / Parke)</span>
            </div>
          </div>

          {/* AI Generator Configuration Card */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-3xl p-6 shadow-md relative overflow-hidden">
            <div className="absolute right-0 top-0 opacity-10 pointer-events-none p-6">
              <Sparkles size={180} />
            </div>

            <div className="relative z-10 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Akıllı Üretim Planlama Motoru</h2>
                    <p className="text-slate-300 text-xs mt-0.5">
                      Tesisinizdeki 2 makineyi, kalıp değişim sürelerini ve terminleri analiz ederek optimize eder
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleRunAIAgent}
                  disabled={isGenerating}
                  className="flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 active:scale-98 text-white rounded-2xl font-bold text-sm transition-all shadow-lg shadow-amber-500/30 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>AI Analiz Ediyor...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>⚡ Akıllı Planı Hesapla & Oluştur</span>
                    </>
                  )}
                </button>
              </div>

              {/* Parameters Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-700/60">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Plan Başlangıç Tarihi</label>
                  <input
                    type="date"
                    value={planningOptions.startDate}
                    onChange={e => setPlanningOptions(o => ({ ...o, startDate: e.target.value }))}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Planlama Süresi</label>
                  <select
                    value={planningOptions.daysCount}
                    onChange={e => setPlanningOptions(o => ({ ...o, daysCount: Number(e.target.value) }))}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value={7}>7 Günlük Plan (1 Hafta)</option>
                    <option value={14}>14 Günlük Plan (2 Hafta)</option>
                    <option value={21}>21 Günlük Plan (3 Hafta)</option>
                    <option value={30}>30 Günlük Plan (1 Ay)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Günlük Vardiya Sayısı</label>
                  <select
                    value={planningOptions.shiftsPerDay}
                    onChange={e => setPlanningOptions(o => ({ ...o, shiftsPerDay: Number(e.target.value) as any }))}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value={1}>1 Vardiya (Sadece Gündüz)</option>
                    <option value={2}>2 Vardiya (Gündüz + Gece - Çift Kapasite)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Planlama Stratejisi</label>
                  <select
                    value={planningOptions.strategy}
                    onChange={e => setPlanningOptions(o => ({ ...o, strategy: e.target.value as any }))}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="minimize_mold_change">Kalıp Değişimini Azalt (Önerilen)</option>
                    <option value="balanced">Makineleri Eşit Yükle</option>
                    <option value="urgent_first">Acil Terminleri Öne Al</option>
                  </select>
                </div>
              </div>

              {/* Toggles */}
              <div className="flex flex-wrap items-center gap-6 pt-2 text-xs text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={planningOptions.includeMinStockDeficit}
                    onChange={e => setPlanningOptions(o => ({ ...o, includeMinStockDeficit: e.target.checked }))}
                    className="rounded border-slate-700 text-amber-500 focus:ring-amber-400 w-4 h-4 bg-slate-800"
                  />
                  <span>Emniyet Stoğu Açıklarını Otomatik Dahil Et</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    checked={planningOptions.includeQuotaDemand}
                    onChange={e => setPlanningOptions(o => ({ ...o, includeQuotaDemand: e.target.checked }))}
                    className="rounded border-slate-700 text-amber-500 focus:ring-amber-400 w-4 h-4 bg-slate-800"
                  />
                  <span>Müşteri Kotalarından Kalan Talepleri Dahil Et</span>
                </label>
              </div>
            </div>
          </div>

          {/* AI GENERATED PLAN PREVIEW & REASONING (IF GENERATED) */}
          {generatedPlan && (
            <div className="bg-white rounded-3xl p-6 border-2 border-amber-400 shadow-lg space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    Öneri Hazırlandı
                  </span>
                  <h3 className="text-xl font-bold text-slate-900 mt-1">
                    {generatedPlan.planName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {new Date(generatedPlan.startDate).toLocaleDateString('tr-TR')} – {new Date(generatedPlan.endDate).toLocaleDateString('tr-TR')} Arası Toplam {generatedPlan.items.length} Vardiya İşi
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setGeneratedPlan(null)}
                    className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Vazgeç
                  </button>
                  <button
                    onClick={handleSaveAndActivatePlan}
                    disabled={isSavingPlan}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50"
                  >
                    {isSavingPlan ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CheckCircle2 size={18} />
                    )}
                    <span>Planı Onayla & İş Emirlerine Dönüştür</span>
                  </button>
                </div>
              </div>

              {/* Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-500 block">Toplam Üretim</span>
                  <strong className="text-lg font-black text-slate-900 font-mono">
                    {generatedPlan.summary.totalPlannedM2.toLocaleString('tr-TR')} m²
                  </strong>
                </div>

                <div className="bg-amber-50/60 p-3 rounded-2xl border border-amber-200">
                  <span className="text-[11px] font-semibold text-amber-800 block">Makine 1 (Parke)</span>
                  <strong className="text-lg font-black text-amber-950 font-mono">
                    {generatedPlan.summary.machine1M2.toLocaleString('tr-TR')} m²
                  </strong>
                  <span className="text-[10px] text-amber-700 block">{generatedPlan.summary.machine1Days} Gün Çalışma</span>
                </div>

                <div className="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-200">
                  <span className="text-[11px] font-semibold text-emerald-800 block">Makine 2 (Bordür)</span>
                  <strong className="text-lg font-black text-emerald-950 font-mono">
                    {generatedPlan.summary.machine2M2.toLocaleString('tr-TR')} m²
                  </strong>
                  <span className="text-[10px] text-emerald-700 block">{generatedPlan.summary.machine2Days} Gün Çalışma</span>
                </div>

                <div className="bg-blue-50 p-3 rounded-2xl border border-blue-200">
                  <span className="text-[11px] font-semibold text-blue-800 block">Kalıp Değişimi Tasarrufu</span>
                  <strong className="text-lg font-black text-blue-900 font-mono">
                    +{generatedPlan.summary.moldChangesSaved} Değişim
                  </strong>
                  <span className="text-[10px] text-blue-600 block">Ayar süresi kurtarıldı</span>
                </div>

                <div className="bg-purple-50 p-3 rounded-2xl border border-purple-200">
                  <span className="text-[11px] font-semibold text-purple-800 block">Kritik Stok Telafisi</span>
                  <strong className="text-lg font-black text-purple-900 font-mono">
                    {generatedPlan.summary.criticalDeficitsCovered} Kalem
                  </strong>
                  <span className="text-[10px] text-purple-600 block">Stok açığı kapandı</span>
                </div>
              </div>

              {/* Agent Explanation & Reasoning Notes */}
              <div className="bg-slate-900 text-slate-100 p-4 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-amber-400">
                  <Sparkles size={15} />
                  <span>Agent Gerekçe ve Optimizasyon Notları:</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-300 pl-1">
                  {generatedPlan.summary.reasoning.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                  {generatedPlan.summary.recommendations.map((rec, i) => (
                    <li key={`rec-${i}`} className="text-emerald-300 font-medium">{rec}</li>
                  ))}
                </ul>
              </div>

              {/* Generated Plan Items Table Preview */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Önerilen Vardiya ve İş Dağılımı ({generatedPlan.items.length} İş Emri)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Makineler arası aktarmak için 🔁 butonuna tıklayabilirsiniz
                  </span>
                </div>

                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600 font-bold">
                      <tr>
                        <th className="px-3 py-2.5">Tarih</th>
                        <th className="px-3 py-2.5">Vardiya</th>
                        <th className="px-3 py-2.5">Makine</th>
                        <th className="px-3 py-2.5">Ürün</th>
                        <th className="px-3 py-2.5 text-right">Hedef Miktar</th>
                        <th className="px-3 py-2.5 text-right">Palet</th>
                        <th className="px-3 py-2.5 text-center">Makine Değiştir</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {generatedPlan.items.map((it, idx) => {
                        const isM1 = it.machine_no === '1';
                        return (
                          <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                              {new Date(it.planned_date).toLocaleDateString('tr-TR')}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-slate-800">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                it.shift === 'Gündüz' ? 'bg-amber-100 text-amber-900' : 'bg-indigo-100 text-indigo-900'
                              }`}>
                                {it.shift}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isM1 ? 'bg-blue-100 text-blue-900' : 'bg-emerald-100 text-emerald-900'
                              }`}>
                                <Factory size={10} />
                                {isM1 ? 'Makine 1 (Parke)' : 'Makine 2 (Bordür)'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-bold text-slate-900">
                              {it.products?.name} ({it.products?.thickness || 'Standart'} / {it.products?.color || 'Gri'})
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900">
                              {it.planned_m2.toLocaleString('tr-TR')} {it.products?.unit || 'm²'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-600">
                              {it.planned_pallets} palet
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button
                                onClick={() => handleTogglePreviewMachine(idx)}
                                className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                title="Diğer makineye aktar"
                              >
                                <ArrowLeftRight size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Section: Live Stock Deficit & Demand Table */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Ürün Bazlı Stok Durumu & Net Üretim İhtiyacı</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tesisinizdeki mevcut bitmiş ürün stoku, emniyet eşikleri ve bekleyen siparişlerin canlı röntgeni
                </p>
              </div>

              <span className="text-xs text-slate-400 font-mono">
                {products.length} Aktif Ürün
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="px-4 py-3">Ürün Adı</th>
                    <th className="px-3 py-3">Tip / Kalınlık / Renk</th>
                    <th className="px-3 py-3 text-right">Mevcut Stok</th>
                    <th className="px-3 py-3 text-right">Emniyet Stoğu</th>
                    <th className="px-3 py-3 text-center">Stok Durumu</th>
                    <th className="px-3 py-3 text-right">Bekleyen Sipariş</th>
                    <th className="px-3 py-3 text-right font-bold text-slate-900">Net İhtiyaç</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map(p => {
                    const currentStock = stockMap[p.id] || 0;
                    const minStock = p.min_stock_alert || 0;
                    const isZero = currentStock <= 0;
                    const isBelowMin = currentStock < minStock;

                    const pendingOrdersForProduct = orders
                      .filter(o => o.product_id === p.id && (o.status === 'pending' || o.status === 'planned'))
                      .reduce((sum, o) => sum + Number(o.quantity || 0), 0);

                    const deficit = isBelowMin ? minStock - currentStock : 0;
                    const netNeed = deficit + pendingOrdersForProduct;

                    return (
                      <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {p.name}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {p.product_type} • {p.thickness} • {p.color}
                        </td>
                        <td className={`px-3 py-3 text-right font-mono font-bold ${
                          isZero ? 'text-red-600' : isBelowMin ? 'text-amber-600' : 'text-emerald-700'
                        }`}>
                          {currentStock.toLocaleString('tr-TR')} {p.unit}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-500">
                          {minStock.toLocaleString('tr-TR')} {p.unit}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {isZero ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                              Tükendi / Kritik
                            </span>
                          ) : isBelowMin ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              Emniyet Altında
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Yeterli
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-blue-700">
                          {pendingOrdersForProduct > 0 ? `${pendingOrdersForProduct.toLocaleString('tr-TR')} ${p.unit}` : '-'}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-black text-slate-900">
                          {netNeed > 0 ? (
                            <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                              +{netNeed.toLocaleString('tr-TR')} {p.unit}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">İhtiyaç Yok</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: 📅 İKİ MAKİNE ÇALIŞMA ÇİZELGESİ (GANTT / GÜNLÜK HEDEF KARTLARI) */}
      {/* ========================================================================= */}
      {activeTab === 'schedule' && (
        <div className="space-y-6">
          {/* Active Plan Selector & Filter Controls */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-700">Aktif Plan:</span>
              <select
                value={activePlan?.id || ''}
                onChange={e => {
                  const p = plans.find(x => x.id === e.target.value);
                  setActivePlan(p || null);
                }}
                className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {plans.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.plan_name} ({p.status === 'active' ? 'Aktif' : p.status})
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 ml-2">
                <Filter size={14} className="text-slate-400" />
                <input
                  type="date"
                  value={scheduleDateFilter}
                  onChange={e => setScheduleDateFilter(e.target.value)}
                  className="border border-slate-200 rounded-xl px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                {scheduleDateFilter && (
                  <button onClick={() => setScheduleDateFilter('')} className="text-[11px] text-slate-500 hover:text-red-500">
                    Temizle
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 ml-2">
                <span className="text-xs text-slate-500 font-medium">Filtre:</span>
                <select
                  value={scheduleMachineFilter}
                  onChange={e => setScheduleMachineFilter(e.target.value as any)}
                  className="border border-slate-200 rounded-xl px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="all">Her İki Makine</option>
                  <option value="1">1 Nolu Makine</option>
                  <option value="2">2 Nolu Makine</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
              >
                <Printer size={14} />
                <span>Yazdır / PDF</span>
              </button>
            </div>
          </div>

          {/* 2-MACHINE SPLIT COLUMNS (MAKİNE 1 vs MAKİNE 2) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* COLUMN 1: MAKİNE 1 (HAT 1) */}
            <div className="bg-slate-50/80 rounded-3xl p-5 border border-slate-200 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    1
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">1 Nolu Parke Baskı Makinesi</h3>
                    <p className="text-[11px] text-slate-500">Kilitli, Aşık, Prizma ve Ana Parke Hattı</p>
                  </div>
                </div>

                <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg">
                  {machine1Items.length} İş Emri
                </span>
              </div>

              {machine1Items.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  Makine 1 için planlanmış iş emri bulunmuyor.
                </div>
              ) : (
                <div className="space-y-3">
                  {machine1Items.map(item => {
                    const pct = item.planned_m2 > 0 ? Math.min(100, Math.round((Number(item.produced_m2 || 0) / Number(item.planned_m2)) * 100)) : 0;
                    const isDone = item.status === 'completed';
                    const inProg = item.status === 'in_progress';

                    return (
                      <div
                        key={item.id}
                        className={`bg-white rounded-2xl p-4 border transition-all shadow-xs ${
                          isDone ? 'border-emerald-200 bg-emerald-50/20' : inProg ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-700">
                                {new Date(item.planned_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.shift === 'Gündüz' ? 'bg-amber-100 text-amber-900' : 'bg-indigo-100 text-indigo-900'
                              }`}>
                                {item.shift} Vardiyası
                              </span>
                            </div>
                            <h4 className="font-bold text-slate-900 text-sm mt-1">
                              {item.products?.name}
                            </h4>
                            <span className="text-[11px] text-slate-500">
                              {item.products?.thickness} • {item.products?.color} • 1 Palet: {item.products?.m2_per_pallet} m²
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="text-base font-black text-slate-900 font-mono block">
                              {Number(item.planned_m2).toLocaleString('tr-TR')} {item.products?.unit || 'm²'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              ~{item.planned_pallets} Palet
                            </span>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1 mb-3">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-slate-500">
                              Üretilen: <strong>{Number(item.produced_m2 || 0).toLocaleString('tr-TR')} m²</strong>
                            </span>
                            <span className={pct >= 100 ? 'text-emerald-700 font-bold' : 'text-blue-600 font-medium'}>
                              %{pct} Tamamlandı
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                pct >= 100 ? 'bg-emerald-500' : inProg ? 'bg-blue-600' : 'bg-amber-400'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                          <button
                            onClick={() => handleMoveScheduleItemMachine(item.id, '1')}
                            className="flex items-center gap-1 text-slate-500 hover:text-amber-600 font-semibold text-[11px] transition-colors"
                            title="Makine 2'ye taşı"
                          >
                            <ArrowLeftRight size={13} />
                            Makine 2'ye Aktar
                          </button>

                          <div className="flex items-center gap-1.5">
                            {item.status !== 'in_progress' && !isDone && (
                              <button
                                onClick={() => handleUpdateItemStatus(item.id, 'in_progress')}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-bold text-[11px] transition-colors"
                              >
                                Üretime Al
                              </button>
                            )}
                            {item.status !== 'completed' && (
                              <button
                                onClick={() => handleUpdateItemStatus(item.id, 'completed')}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] transition-colors"
                              >
                                Tamamla
                              </button>
                            )}
                            {isDone && (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold text-[11px]">
                                <CheckCircle2 size={13} /> Tamamlandı
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* COLUMN 2: MAKİNE 2 (HAT 2) */}
            <div className="bg-slate-50/80 rounded-3xl p-5 border border-slate-200 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    2
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">2 Nolu Parke & Bordür Makinesi</h3>
                    <p className="text-[11px] text-slate-500">Bordür, Oluk, Begonit ve İkincil Parke Hattı</p>
                  </div>
                </div>

                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                  {machine2Items.length} İş Emri
                </span>
              </div>

              {machine2Items.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  Makine 2 için planlanmış iş emri bulunmuyor.
                </div>
              ) : (
                <div className="space-y-3">
                  {machine2Items.map(item => {
                    const pct = item.planned_m2 > 0 ? Math.min(100, Math.round((Number(item.produced_m2 || 0) / Number(item.planned_m2)) * 100)) : 0;
                    const isDone = item.status === 'completed';
                    const inProg = item.status === 'in_progress';

                    return (
                      <div
                        key={item.id}
                        className={`bg-white rounded-2xl p-4 border transition-all shadow-xs ${
                          isDone ? 'border-emerald-200 bg-emerald-50/20' : inProg ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-slate-700">
                                {new Date(item.planned_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.shift === 'Gündüz' ? 'bg-amber-100 text-amber-900' : 'bg-indigo-100 text-indigo-900'
                              }`}>
                                {item.shift} Vardiyası
                              </span>
                            </div>
                            <h4 className="font-bold text-slate-900 text-sm mt-1">
                              {item.products?.name}
                            </h4>
                            <span className="text-[11px] text-slate-500">
                              {item.products?.thickness} • {item.products?.color} • 1 Palet: {item.products?.m2_per_pallet} {item.products?.unit}
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="text-base font-black text-slate-900 font-mono block">
                              {Number(item.planned_m2).toLocaleString('tr-TR')} {item.products?.unit || 'm²'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              ~{item.planned_pallets} Palet
                            </span>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="space-y-1 mb-3">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-slate-500">
                              Üretilen: <strong>{Number(item.produced_m2 || 0).toLocaleString('tr-TR')} {item.products?.unit || 'm²'}</strong>
                            </span>
                            <span className={pct >= 100 ? 'text-emerald-700 font-bold' : 'text-blue-600 font-medium'}>
                              %{pct} Tamamlandı
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                pct >= 100 ? 'bg-emerald-500' : inProg ? 'bg-blue-600' : 'bg-amber-400'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                          <button
                            onClick={() => handleMoveScheduleItemMachine(item.id, '2')}
                            className="flex items-center gap-1 text-slate-500 hover:text-amber-600 font-semibold text-[11px] transition-colors"
                            title="Makine 1'e taşı"
                          >
                            <ArrowLeftRight size={13} />
                            Makine 1'e Aktar
                          </button>

                          <div className="flex items-center gap-1.5">
                            {item.status !== 'in_progress' && !isDone && (
                              <button
                                onClick={() => handleUpdateItemStatus(item.id, 'in_progress')}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-bold text-[11px] transition-colors"
                              >
                                Üretime Al
                              </button>
                            )}
                            {item.status !== 'completed' && (
                              <button
                                onClick={() => handleUpdateItemStatus(item.id, 'completed')}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] transition-colors"
                              >
                                Tamamla
                              </button>
                            )}
                            {isDone && (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold text-[11px]">
                                <CheckCircle2 size={13} /> Tamamlandı
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: 📦 SİPARİŞ & TALEP HAVUZU */}
      {/* ========================================================================= */}
      {activeTab === 'orders' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Müşteri Siparişleri ve İş Talepleri</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Müşterilerden gelen siparişler ve kotalardan aktarılan üretim gereksinimleri
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenNewOrder}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                <Plus size={16} /> Yeni Sipariş Ekle
              </button>
            </div>
          </div>

          {/* Quotas Quick Import Section */}
          {quotas.length > 0 && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-600" />
                  Müşteri Taahhütlerinden (Kotalardan) Hızlı Sipariş Açma
                </span>
                <span className="text-[11px] text-amber-700 font-medium">
                  {quotas.length} Aktif Kota
                </span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {quotas.map(q => {
                  const target = Number(q.target_quantity || 0);
                  const shipped = Number(q.shipped_quantity || 0);
                  const remaining = Math.max(0, target - shipped);

                  return (
                    <button
                      key={q.id}
                      onClick={() => handleCreateOrderFromQuota(q)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-amber-100/80 text-slate-800 border border-amber-300 rounded-xl text-xs font-medium transition-colors shadow-2xs"
                    >
                      <span>{q.customers?.name}:</span>
                      <strong className="text-amber-900 font-mono">{remaining.toLocaleString('tr-TR')} {q.unit}</strong>
                      <span className="text-[10px] text-slate-400">({q.products?.name || 'Genel'})</span>
                      <Plus size={12} className="text-amber-600 ml-1" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Orders Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <tr>
                    <th className="px-4 py-3">Sipariş No</th>
                    <th className="px-3 py-3">Müşteri / Şantiye</th>
                    <th className="px-3 py-3">Talep Edilen Ürün</th>
                    <th className="px-3 py-3 text-right">Miktar</th>
                    <th className="px-3 py-3">Termin Tarihi</th>
                    <th className="px-3 py-3 text-center">Öncelik</th>
                    <th className="px-3 py-3 text-center">Durum</th>
                    <th className="px-4 py-3 text-center">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        Kayıtlı sipariş bulunmuyor. Yeni sipariş ekleyerek planlama havuzuna dahil edebilirsiniz.
                      </td>
                    </tr>
                  ) : (
                    orders.map(o => {
                      const isCritical = o.priority === 'critical';
                      const isHigh = o.priority === 'high';

                      return (
                        <tr key={o.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                            {o.order_no}
                          </td>
                          <td className="px-3 py-3 font-semibold text-slate-800">
                            <div>{o.customers?.name || 'Genel Talep'}</div>
                            {o.sites?.name && <div className="text-[10px] text-slate-400">{o.sites.name}</div>}
                          </td>
                          <td className="px-3 py-3 font-bold text-slate-900">
                            {o.products?.name} ({o.products?.thickness}/{o.products?.color})
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-black text-slate-900">
                            {Number(o.quantity).toLocaleString('tr-TR')} {o.unit}
                          </td>
                          <td className="px-3 py-3 font-mono text-slate-700 whitespace-nowrap">
                            {o.due_date ? new Date(o.due_date).toLocaleDateString('tr-TR') : '-'}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isCritical ? 'bg-red-100 text-red-900' : isHigh ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {o.priority === 'critical' ? '🔴 Kritik' : o.priority === 'high' ? '🟡 Yüksek' : 'Normal'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              o.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : o.status === 'in_production'
                                ? 'bg-blue-100 text-blue-800'
                                : o.status === 'planned'
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {o.status === 'completed' ? 'Tamamlandı' : o.status === 'in_production' ? 'Üretimde' : o.status === 'planned' ? 'Planlandı' : 'Bekliyor'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => handleDeleteOrder(o.id, o.order_no)}
                              className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Sil"
                            >
                              <Trash2 size={14} />
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: ⚙️ MAKİNE & KAPASİTE AYARLARI */}
      {/* ========================================================================= */}
      {activeTab === 'machines' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {machines.map(m => (
              <div key={m.machine_no} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-black">
                      {m.machine_no}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-base">{m.name}</h3>
                      <p className="text-xs text-slate-400">Tesis Makine Parametresi</p>
                    </div>
                  </div>

                  <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-full border border-emerald-200">
                    Aktif
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Günlük Üretim Kapasitesi (m²)</label>
                    <input
                      type="number"
                      value={m.daily_capacity_m2}
                      onChange={e => {
                        const val = Number(e.target.value);
                        setMachines(prev => prev.map(x => x.machine_no === m.machine_no ? { ...x, daily_capacity_m2: val } : x));
                      }}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Varsayılan Vardiya Sayısı</label>
                    <select
                      value={m.shift_count}
                      onChange={e => {
                        const val = Number(e.target.value);
                        setMachines(prev => prev.map(x => x.machine_no === m.machine_no ? { ...x, shift_count: val } : x));
                      }}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value={1}>1 Vardiya (Gündüz)</option>
                      <option value={2}>2 Vardiya (Gündüz + Gece)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Uzmanlaştığı Ürün Tipleri</label>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700">
                      {m.specialized_types && m.specialized_types.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {m.specialized_types.map((st, i) => (
                            <span key={i} className="bg-white border border-slate-200 px-2 py-0.5 rounded-md font-medium text-slate-800">
                              {st}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span>Tüm Ürün Tipleri (Kısıtlama Yok)</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Açıklama / Not</label>
                    <input
                      type="text"
                      value={m.notes || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setMachines(prev => prev.map(x => x.machine_no === m.machine_no ? { ...x, notes: val } : x));
                      }}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={async () => {
                      try {
                        await supabase
                          .from('machine_definitions')
                          .upsert({
                            machine_no: m.machine_no,
                            name: m.name,
                            daily_capacity_m2: m.daily_capacity_m2,
                            shift_count: m.shift_count,
                            specialized_types: m.specialized_types,
                            notes: m.notes,
                            is_active: true,
                          });
                        alert(`${m.name} ayarları kaydedildi.`);
                      } catch (err: any) {
                        alert('Hata: ' + err.message);
                      }
                    }}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors"
                  >
                    Makine Ayarlarını Kaydet
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ORDER MODAL */}
      {/* ========================================================================= */}
      {showOrderModal && (
        <Modal
          title={editingOrder ? 'Siparişi Düzenle' : 'Yeni Müşteri Siparişi / İş Talebi Ekle'}
          onClose={() => setShowOrderModal(false)}
          size="lg"
        >
          <form onSubmit={handleSaveOrder} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Müşteri</label>
                <select
                  value={orderForm.customer_id}
                  onChange={e => setOrderForm(f => ({ ...f, customer_id: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">Genel / Fabrika İhtiyacı</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Şantiye (Opsiyonel)</label>
                <select
                  value={orderForm.site_id}
                  onChange={e => setOrderForm(f => ({ ...f, site_id: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">Şantiye Yok / Genel</option>
                  {sites.filter(s => !orderForm.customer_id || s.customer_id === orderForm.customer_id).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Ürün *</label>
              <select
                value={orderForm.product_id}
                onChange={e => {
                  const pid = e.target.value;
                  const pr = products.find(p => p.id === pid);
                  setOrderForm(f => ({
                    ...f,
                    product_id: pid,
                    unit: (pr?.unit as any) || 'm2',
                  }));
                }}
                required
                className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold"
              >
                <option value="">Ürün Seçiniz...</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.thickness} - {p.color}) • Stok: {stockMap[p.id] || 0} {p.unit}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Sipariş Miktarı *</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={orderForm.quantity}
                  onChange={e => setOrderForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Birim</label>
                <select
                  value={orderForm.unit}
                  onChange={e => setOrderForm(f => ({ ...f, unit: e.target.value as any }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="m2">m² (Metrekare)</option>
                  <option value="metre">Metre (Bordür/Oluk)</option>
                  <option value="adet">Adet</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Termin / Teslim Tarihi</label>
                <input
                  type="date"
                  value={orderForm.due_date}
                  onChange={e => setOrderForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Öncelik Derecesi</label>
                <select
                  value={orderForm.priority}
                  onChange={e => setOrderForm(f => ({ ...f, priority: e.target.value as any }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="critical">🔴 Acil / Kritik (İlk Vardiyalar)</option>
                  <option value="high">🟡 Yüksek Öncelik</option>
                  <option value="normal">Normal Öncelik</option>
                  <option value="low">Düşük / Boşta Üret</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Not / Açıklama</label>
                <input
                  type="text"
                  value={orderForm.notes}
                  onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Özel istekler veya detaylar..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowOrderModal(false)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl transition-colors font-semibold"
              >
                İptal
              </button>
              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-xs transition-colors"
              >
                Siparişi Kaydet
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
