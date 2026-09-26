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
  getMachineProductCapacity,
  PlanningOptions,
  AIPlanningResult,
  ProductShipmentVelocity
} from '../utils/productionPlanner';
import {
  Sparkles, Calendar, Factory, Plus, Filter,
  CheckCircle2, AlertTriangle, ArrowLeftRight,
  Layers, Printer, RefreshCw,
  Sliders, Trash2, TrendingUp, Clock, Flame
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

  // AI Agent Planning Parameters (Günlük 10 Saat ve Pazarları Tatil)
  const [planningOptions, setPlanningOptions] = useState<PlanningOptions>({
    startDate: getLocalDateStr(),
    daysCount: 7,
    dailyWorkingHours: 10,
    shiftsPerDay: 1,
    excludeSundays: true,
    strategy: 'minimize_mold_change',
    includeMinStockDeficit: true,
    includeQuotaDemand: true,
    onlyWithOrders: false,
    excludedProductIds: [],
    considerShipmentVelocity: true,
  });

  // Shipment Velocity & Burn Rate State
  const [shipmentVelocityMap, setShipmentVelocityMap] = useState<Record<string, ProductShipmentVelocity>>({});

  // Generated Plan State
  const [generatedPlan, setGeneratedPlan] = useState<AIPlanningResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState('');
  const planPreviewRef = React.useRef<HTMLDivElement>(null);

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

  // Machine Product Capacity Selection State: machine_no -> { productId: '', capacity: 1000 }
  const [newProdCapMap, setNewProdCapMap] = useState<Record<string, { productId: string; capacity: number }>>({
    '1': { productId: '', capacity: 1200 },
    '2': { productId: '', capacity: 1000 },
  });

  const handleSetProductCapacity = (machineNo: string, productId: string, capacity: number) => {
    if (!productId || capacity <= 0) return;
    setMachines(prev => prev.map(m => {
      if (m.machine_no !== machineNo) return m;
      const updated = { ...(m.product_capacities || {}) };
      updated[productId] = capacity;
      return { ...m, product_capacities: updated };
    }));
  };

  const handleRemoveProductCapacity = (machineNo: string, productId: string) => {
    setMachines(prev => prev.map(m => {
      if (m.machine_no !== machineNo) return m;
      const updated = { ...(m.product_capacities || {}) };
      delete updated[productId];
      return { ...m, product_capacities: updated };
    }));
  };

  const handlePopulateAllProducts = (machineNo: string) => {
    setMachines(prev => prev.map(m => {
      if (m.machine_no !== machineNo) return m;
      const updated = { ...(m.product_capacities || {}) };
      const defaultCap = Number(m.daily_capacity_m2) || 1000;
      products.forEach(p => {
        if (!updated[p.id]) {
          updated[p.id] = defaultCap;
        }
      });
      return { ...m, product_capacities: updated };
    }));
  };

  const handleClearProductCapacities = (machineNo: string) => {
    if (window.confirm('Bu makineye ait tanımlanmış tüm ürün kapasiteleri temizlenecektir. Devam etmek istiyor musunuz?')) {
      setMachines(prev => prev.map(m => m.machine_no === machineNo ? { ...m, product_capacities: {} } : m));
    }
  };

  const handleSaveMachine = async (m: MachineDefinition) => {
    try {
      // 1. Always update localStorage cache
      localStorage.setItem(`parke_erp_machine_${m.machine_no}_capacities`, JSON.stringify(m.product_capacities || {}));

      // 2. Try direct upsert with product_capacities
      const payload: any = {
        machine_no: m.machine_no,
        name: m.name,
        daily_capacity_m2: m.daily_capacity_m2,
        shift_count: m.shift_count,
        specialized_types: m.specialized_types,
        product_capacities: m.product_capacities || {},
        notes: m.notes,
        is_active: true,
      };

      const { error: upsertErr } = await supabase.from('machine_definitions').upsert(payload);
      if (upsertErr) {
        console.warn('Direct column upsert failed, using notes fallback:', upsertErr.message);
        const fallbackNotes = `${m.notes || ''}\n[PRODUCT_CAPACITIES]${JSON.stringify(m.product_capacities || {})}[/PRODUCT_CAPACITIES]`;
        const fallbackPayload = {
          ...payload,
          product_capacities: undefined,
          notes: fallbackNotes,
        };
        const { error: fbErr } = await supabase.from('machine_definitions').upsert(fallbackPayload);
        if (fbErr) throw fbErr;
      }

      alert(`✅ ${m.name} ayarları ve ürün kapasiteleri başarıyla kaydedildi.`);
    } catch (err: any) {
      console.error('Machine save error:', err);
      alert(`Kaydetme hatası: ${err.message || 'Bilinmeyen hata'}`);
    }
  };

  // -------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------
  const loadAllData = async () => {
    setLoading(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

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
        shipItemsRes,
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
        supabase.from('shipment_items').select('product_id, m2, unit, shipments!inner(shipment_date, status)').eq('shipments.status', 'completed').gte('shipments.shipment_date', thirtyDaysAgoStr),
      ]);

      if (prodRes.data) setProducts(prodRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (siteRes.data) setSites(siteRes.data);
      if (quotaRes.data) setQuotas(quotaRes.data as any);
      if (orderRes.data) setOrders(orderRes.data as any);

      // Machines fallback if table empty
      const parseMachine = (m: any): MachineDefinition => {
        let productCapacities: Record<string, number> = {};
        if (m.product_capacities && typeof m.product_capacities === 'object') {
          productCapacities = { ...m.product_capacities };
        } else if (typeof m.product_capacities === 'string') {
          try { productCapacities = JSON.parse(m.product_capacities); } catch {}
        }
        let cleanNotes = m.notes || '';
        const match = cleanNotes.match(/\[PRODUCT_CAPACITIES\]([\s\S]*?)\[\/PRODUCT_CAPACITIES\]/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            productCapacities = { ...parsed, ...productCapacities };
          } catch {}
          cleanNotes = cleanNotes.replace(/\[PRODUCT_CAPACITIES\][\s\S]*?\[\/PRODUCT_CAPACITIES\]/, '').trim();
        }
        try {
          const cached = localStorage.getItem(`parke_erp_machine_${m.machine_no}_capacities`);
          if (cached) {
            const parsedLocal = JSON.parse(cached);
            productCapacities = { ...parsedLocal, ...productCapacities };
          }
        } catch {}

        return {
          machine_no: m.machine_no,
          name: m.name,
          daily_capacity_m2: Number(m.daily_capacity_m2) || 1000,
          shift_count: Number(m.shift_count) || 1,
          specialized_types: m.specialized_types || [],
          product_capacities: productCapacities,
          notes: cleanNotes,
          is_active: m.is_active !== false,
        };
      };

      if (machRes.data && machRes.data.length > 0) {
        setMachines(machRes.data.map(parseMachine));
      } else {
        const defaultM1 = parseMachine({
          machine_no: '1',
          name: '1 Nolu Parke Baskı Makinesi',
          daily_capacity_m2: 1000,
          shift_count: 1,
          specialized_types: ['Kilitli', 'Aşık', 'Prizma', 'Küp Taşı'],
          notes: 'Ana parke hattı',
          is_active: true,
        });
        const defaultM2 = parseMachine({
          machine_no: '2',
          name: '2 Nolu Parke & Bordür Makinesi',
          daily_capacity_m2: 1000,
          shift_count: 1,
          specialized_types: ['Bordür', 'Oluk', 'Kilitli', 'Begonit', 'Tretuar'],
          notes: 'Bordür ve ikincil parke hattı',
          is_active: true,
        });
        setMachines([defaultM1, defaultM2]);
      }

      // Stock Map
      const sMap: Record<string, number> = {};
      if (stockRes.data) {
        stockRes.data.forEach((s: any) => {
          sMap[s.product_id] = Number(s.current_stock || 0);
        });
      }
      setStockMap(sMap);

      // Shipment Velocity Map (Stok Erime Hızı)
      const vMap: Record<string, ProductShipmentVelocity> = {};
      const allActiveProds = prodRes.data || [];
      const sItems = shipItemsRes.data || [];

      allActiveProds.forEach((p: any) => {
        const pItems = sItems.filter((it: any) => it.product_id === p.id);
        const total30 = pItems.reduce((sum: number, it: any) => sum + (Number(it.m2) || 0), 0);
        const total7 = pItems
          .filter((it: any) => {
            const sDate = Array.isArray(it.shipments) ? it.shipments[0]?.shipment_date : it.shipments?.shipment_date;
            return sDate && sDate >= sevenDaysAgoStr;
          })
          .reduce((sum: number, it: any) => sum + (Number(it.m2) || 0), 0);

        const curStock = sMap[p.id] || 0;
        const dailyRate = Math.round((total30 / 30) * 10) / 10;
        const weeklyRate = Math.round(dailyRate * 7);
        let daysRemaining = 999;
        if (curStock <= 0 && dailyRate > 0) {
          daysRemaining = 0;
        } else if (dailyRate > 0) {
          daysRemaining = Math.round(curStock / dailyRate);
        }

        let category: 'very_fast' | 'moderate' | 'slow' | 'stagnant' = 'stagnant';
        if (dailyRate >= 200) category = 'very_fast';
        else if (dailyRate >= 50) category = 'moderate';
        else if (dailyRate > 0) category = 'slow';

        vMap[p.id] = {
          productId: p.id,
          totalShippedLast30Days: total30,
          totalShippedLast7Days: total7,
          dailyBurnRate: dailyRate,
          weeklyBurnRate: weeklyRate,
          daysOfStockRemaining: daysRemaining,
          velocityCategory: category,
          trendText: category === 'very_fast' ? '🔥 Çok Hızlı' : category === 'moderate' ? '⚡ Orta' : category === 'slow' ? '🐢 Yavaş' : '💤 Durgun',
        };
      });
      setShipmentVelocityMap(vMap);

      // Plans & Items
      let planList = (planRes.data || []) as ProductionPlan[];
      let allPlanItems = (itemsRes.data || []) as any[];

      // Check if there is an active local offline plan
      try {
        const localPlanRaw = localStorage.getItem('parke_erp_local_active_plan');
        const localItemsRaw = localStorage.getItem('parke_erp_local_active_items');
        if (localPlanRaw && localItemsRaw) {
          const localPlanParsed = JSON.parse(localPlanRaw);
          const localItemsParsed = JSON.parse(localItemsRaw);
          if (!planList.some(p => p.id === localPlanParsed.id)) {
            planList = [localPlanParsed, ...planList];
            allPlanItems = [...localItemsParsed, ...allPlanItems];
          }
        }
      } catch {}

      setPlans(planList);
      if (planList.length > 0) {
        const active = planList.find(p => p.status === 'active') || planList[0];
        setActivePlan(active);
      }
      setPlanItems(allPlanItems);
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
      try {
        const res = generateSmartProductionPlan({
          products,
          stockMap,
          orders,
          quotas,
          machines,
          options: {
            ...planningOptions,
            shipmentVelocities: shipmentVelocityMap,
          },
        });
        setGeneratedPlan(res);
        setTimeout(() => {
          planPreviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      } catch (err: any) {
        console.error('AI plan oluşturma hatası:', err);
        alert('Plan hesaplanırken bir hata oluştu: ' + (err?.message || 'Bilinmeyen hata'));
      } finally {
        setIsGenerating(false);
      }
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

  // Remove individual item from generated preview plan
  const handleRemovePreviewItem = (itemIndex: number) => {
    if (!generatedPlan) return;
    const newItems = generatedPlan.items.filter((_, idx) => idx !== itemIndex);
    const m1M2 = newItems.filter(i => i.machine_no === '1').reduce((s, i) => s + Number(i.planned_m2 || 0), 0);
    const m2M2 = newItems.filter(i => i.machine_no === '2').reduce((s, i) => s + Number(i.planned_m2 || 0), 0);
    const totalM2 = m1M2 + m2M2;

    setGeneratedPlan({
      ...generatedPlan,
      items: newItems,
      summary: {
        ...generatedPlan.summary,
        totalPlannedM2: totalM2,
        machine1M2: m1M2,
        machine2M2: m2M2,
      },
    });
  };

  // Toggle product exclusion from AI planning
  const toggleExcludeProduct = (productId: string) => {
    setPlanningOptions(prev => {
      const current = prev.excludedProductIds || [];
      const exists = current.includes(productId);
      const updated = exists ? current.filter(id => id !== productId) : [...current, productId];
      return { ...prev, excludedProductIds: updated };
    });
  };

  // Resilient retry helper for Supabase operations (handling cold-start / network blips)
  const runWithRetry = async <T,>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1500,
    onRetry?: (attempt: number) => void
  ): Promise<T> => {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        console.warn(`[Supabase Retry] Deneme ${attempt}/${maxRetries} başarısız oldu:`, err);
        if (attempt < maxRetries) {
          if (onRetry) onRetry(attempt);
          await new Promise(res => setTimeout(res, delayMs * attempt));
        }
      }
    }
    throw lastErr;
  };

  // Approve & Save Generated Plan
  const handleSaveAndActivatePlan = async () => {
    if (!generatedPlan || generatedPlan.items.length === 0) return;
    setIsSavingPlan(true);
    setSaveStatusText('Sunucu bağlantısı ve oturum doğrulanıyor...');

    // 0. Safety cache in local storage before doing anything
    try {
      localStorage.setItem('parke_erp_last_generated_plan_backup', JSON.stringify(generatedPlan));
    } catch {}

    try {
      // Refresh / confirm authenticated user session
      let currentUserId = user?.id || null;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.id) {
          currentUserId = sessionData.session.user.id;
        }
      } catch (authErr) {
        console.warn('Oturum kontrolünde uyarı:', authErr);
      }

      // 1. Insert new production plan with retry
      setSaveStatusText('Üretim planı kaydediliyor (Sunucu uyandırılıyor)...');
      const planPayload = {
        plan_name: (generatedPlan.planName || 'AI Üretim Planı').trim(),
        start_date: generatedPlan.startDate,
        end_date: generatedPlan.endDate,
        status: 'active',
        ai_summary: JSON.parse(JSON.stringify(generatedPlan.summary || {})),
        created_by: currentUserId,
      };

      const createdPlan = await runWithRetry(
        async () => {
          const { data, error } = await supabase
            .from('production_plans')
            .insert(planPayload)
            .select()
            .single();
          if (error) throw error;
          return data;
        },
        3,
        1500,
        attempt => setSaveStatusText(`Sunucu yanıt vermedi, tekrar deneniyor (${attempt}/3)...`)
      );

      // 2. Insert plan items (in chunks of 25 to avoid payload timeouts)
      setSaveStatusText('İş emirleri oluşturuluyor...');
      const itemsPayload = generatedPlan.items.map((it, idx) => ({
        plan_id: createdPlan.id,
        machine_no: String(it.machine_no || '1'),
        planned_date: it.planned_date,
        shift: it.shift || 'Gündüz',
        product_id: it.product_id,
        order_id: it.order_id || null,
        quota_id: it.quota_id || null,
        planned_m2: Math.round(Number(it.planned_m2) * 100) / 100,
        planned_pallets: Math.round(Number(it.planned_pallets || 0)),
        produced_m2: 0,
        status: 'scheduled' as const,
        sequence_order: idx + 1,
        notes: String(it.notes || ''),
      }));

      const chunkSize = 25;
      for (let i = 0; i < itemsPayload.length; i += chunkSize) {
        const chunk = itemsPayload.slice(i, i + chunkSize);
        await runWithRetry(
          async () => {
            const { error } = await supabase.from('production_plan_items').insert(chunk);
            if (error) throw error;
          },
          3,
          1500,
          attempt => setSaveStatusText(`İş emirleri aktarılıyor (Parça ${Math.floor(i / chunkSize) + 1}, Deneme ${attempt}/3)...`)
        );
      }

      // 3. Mark linked orders as 'planned' (isolated try-catch so it won't break plan creation if order was deleted)
      setSaveStatusText('Sipariş durumları güncelleniyor...');
      const linkedOrderIds = generatedPlan.items
        .map(it => it.order_id)
        .filter(Boolean) as string[];

      if (linkedOrderIds.length > 0) {
        try {
          await supabase
            .from('production_orders')
            .update({ status: 'planned' })
            .in('id', linkedOrderIds);
        } catch (orderErr) {
          console.warn('Sipariş durumları güncellenirken ikincil uyarı (önemsiz):', orderErr);
        }
      }

      // Clean up temporary local storage backup
      try {
        localStorage.removeItem('parke_erp_last_generated_plan_backup');
        localStorage.removeItem('parke_erp_local_active_plan');
        localStorage.removeItem('parke_erp_local_active_items');
      } catch {}

      alert('Tebrikler! AI Üretim Planı başarıyla kaydedildi ve Makine Çalışma Çizelgesine aktarıldı.');
      setGeneratedPlan(null);
      await loadAllData();
      setActiveTab('schedule');
    } catch (err: any) {
      console.error('Plan kaydedilirken hata:', err);
      const isNetworkError =
        err?.message?.includes('fetch') ||
        err?.name === 'TypeError' ||
        err?.message?.includes('NetworkError') ||
        err?.message?.includes('Failed to fetch') ||
        err?.code === 'PGRST301';

      if (isNetworkError) {
        const confirmSaveLocally = window.confirm(
          '⚠️ Sunucu / İnternet Bağlantı Uyarısı:\n\n' +
          'Supabase sunucusu uyku modundan henüz uyanamadı veya geçici bir ağ kesintisi yaşandı.\n\n' +
          'Hazırladığınız AI Üretim Planını kaybetmemek için yerel tarayıcı hafızasına (Çevrimdışı Mod) kaydedip Makine Çalışma Çizelgenize aktarmak ister misiniz?'
        );

        if (confirmSaveLocally) {
          const localPlanId = `local-plan-${Date.now()}`;
          const localPlan: ProductionPlan = {
            id: localPlanId,
            plan_name: generatedPlan.planName + ' (Yerel Yedek)',
            start_date: generatedPlan.startDate,
            end_date: generatedPlan.endDate,
            status: 'active',
            ai_summary: generatedPlan.summary,
            created_at: new Date().toISOString(),
          };

          const localItems: ProductionPlanItem[] = generatedPlan.items.map((it, idx) => ({
            id: `local-item-${Date.now()}-${idx}`,
            plan_id: localPlanId,
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
            products: products.find(p => p.id === it.product_id),
          }));

          try {
            localStorage.setItem('parke_erp_local_active_plan', JSON.stringify(localPlan));
            localStorage.setItem('parke_erp_local_active_items', JSON.stringify(localItems));
          } catch {}

          setPlans(prev => [localPlan, ...prev]);
          setActivePlan(localPlan);
          setPlanItems(prev => [...localItems, ...prev]);
          setGeneratedPlan(null);
          setActiveTab('schedule');
          alert('AI Planı yerel tarayıcı hafızasına güvenle aktarıldı ve Makine Çalışma Çizelgeniz oluşturuldu!');
          return;
        }
      }

      alert('Plan kaydedilirken bir hata oluştu: ' + (err.message || 'Bilinmeyen hata') + '\n\nLütfen internet bağlantınızı kontrol edip birkaç saniye sonra tekrar deneyiniz.');
    } finally {
      setIsSavingPlan(false);
      setSaveStatusText('');
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

  // Cancel / Delete Scheduled Item with Confirmation
  const handleDeleteScheduleItem = async (item: ProductionPlanItem) => {
    const productName = item.products?.name || 'İş Emri';
    const dateFormatted = new Date(item.planned_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' });
    const isConfirmed = window.confirm(
      `"${productName}" (${dateFormatted} - ${item.shift || 'Gündüz'}) iş emrini iptal etmek ve çizelgeden kaldırmak istediğinize emin misiniz?`
    );
    if (!isConfirmed) return;

    try {
      // 1. Delete plan item
      const { error } = await supabase
        .from('production_plan_items')
        .delete()
        .eq('id', item.id);
      if (error) throw error;

      // 2. If it was linked to an order, reset order status to 'pending'
      if (item.order_id) {
        await supabase
          .from('production_orders')
          .update({ status: 'pending' })
          .eq('id', item.order_id);
      }

      // 3. Update local state
      setPlanItems(prev => prev.filter(it => it.id !== item.id));
    } catch (err: any) {
      console.error('İş emri iptal etme hatası:', err);
      alert('İş emri iptal edilirken bir hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
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

  const velocityStats = useMemo(() => {
    const list = Object.values(shipmentVelocityMap);
    const total30 = list.reduce((s, x) => s + (x.totalShippedLast30Days || 0), 0);
    const sorted = [...list].sort((a, b) => b.dailyBurnRate - a.dailyBurnRate);
    const top = sorted[0];
    const topProd = top ? products.find(p => p.id === top.productId) : null;
    const runOutCount = list.filter(x => x.dailyBurnRate > 0 && x.daysOfStockRemaining <= 7 && x.daysOfStockRemaining > 0).length;
    return { total30, topProd, topBurn: top?.dailyBurnRate || 0, runOutCount };
  }, [shipmentVelocityMap, products]);

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
              <span className="text-[11px] text-slate-400">
                {Object.keys(machines.find(m => m.machine_no === '1')?.product_capacities || {}).length > 0
                  ? `⚡ ${Object.keys(machines.find(m => m.machine_no === '1')?.product_capacities || {}).length} ürüne özel kapasite tanımlı`
                  : 'Varsayılan Genel Kapasite (10 Saat)'}
              </span>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-xs">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="text-xs font-semibold text-slate-500">2 Nolu Makine Kapasitesi</span>
                <Factory size={16} className="text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-slate-800 font-mono">
                {((machines.find(m => m.machine_no === '2')?.daily_capacity_m2 || 1000)).toLocaleString('tr-TR')} m²/gün
              </p>
              <span className="text-[11px] text-slate-400">
                {Object.keys(machines.find(m => m.machine_no === '2')?.product_capacities || {}).length > 0
                  ? `⚡ ${Object.keys(machines.find(m => m.machine_no === '2')?.product_capacities || {}).length} ürüne özel kapasite tanımlı`
                  : 'Varsayılan Genel Kapasite (10 Saat)'}
              </span>
            </div>
          </div>

          {/* Sevkiyat & Stok Erime Hızı Özet Bandı */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50/60 border border-emerald-200/80 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs flex-shrink-0">
                <TrendingUp size={20} />
              </div>
              <div className="overflow-hidden">
                <span className="text-[11px] font-semibold text-emerald-900 block">Son 30 Gün Toplam Sevkiyat</span>
                <strong className="text-xl font-black text-emerald-950 font-mono block">
                  {velocityStats.total30.toLocaleString('tr-TR')} m²
                </strong>
                <span className="text-[10px] text-emerald-700 block">Tesis çıkış / sevk hacmi</span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-orange-50/60 border border-amber-200/80 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold shadow-xs flex-shrink-0">
                <Flame size={20} />
              </div>
              <div className="overflow-hidden">
                <span className="text-[11px] font-semibold text-amber-900 block">En Hızlı Eriyen / Çok Satan</span>
                <strong className="text-sm font-black text-amber-950 truncate block" title={velocityStats.topProd?.name || 'Veri yok'}>
                  {velocityStats.topProd ? velocityStats.topProd.name : 'Veri toplanıyor'}
                </strong>
                <span className="text-[10px] text-amber-700 font-mono font-bold block">
                  {velocityStats.topBurn > 0 ? `🔥 Günde ~${velocityStats.topBurn} ${velocityStats.topProd?.unit || 'm²'} sevk` : 'Henüz sevkiyat yok'}
                </span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-rose-50 to-red-50/60 border border-rose-200/80 rounded-2xl p-4 flex items-center gap-3 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center font-bold shadow-xs flex-shrink-0">
                <Clock size={20} />
              </div>
              <div className="overflow-hidden">
                <span className="text-[11px] font-semibold text-rose-900 block">Stok Tükenme Riski (≤7 Gün)</span>
                <strong className="text-xl font-black text-rose-950 font-mono block">
                  {velocityStats.runOutCount} Ürün
                </strong>
                <span className="text-[10px] text-rose-700 block">Mevcut sevkiyat hızıyla kritik</span>
              </div>
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
                    onChange={e => setPlanningOptions(o => ({ ...o, startDate: e.target.value || getLocalDateStr() }))}
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
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Günlük Çalışma / Vardiya</label>
                  <select
                    value={planningOptions.shiftsPerDay}
                    onChange={e => setPlanningOptions(o => ({ ...o, shiftsPerDay: Number(e.target.value) as any }))}
                    className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold"
                  >
                    <option value={1}>Tek Vardiya (Günlük 10 Saat Çalışma)</option>
                    <option value={2}>Çift Vardiya (10 + 10 Saat - Yoğun Dönem)</option>
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
                <label className="flex items-center gap-2 cursor-pointer text-amber-300 font-bold hover:text-white transition-colors bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-xl">
                  <input
                    type="checkbox"
                    checked={planningOptions.excludeSundays}
                    onChange={e => setPlanningOptions(o => ({ ...o, excludeSundays: e.target.checked }))}
                    className="rounded border-slate-700 text-amber-500 focus:ring-amber-400 w-4 h-4 bg-slate-800"
                  />
                  <span>🏖️ Pazar Günleri Fabrika Tatili (Pazarları Üretim Yapılmaz)</span>
                </label>

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

                <label className="flex items-center gap-2 cursor-pointer text-indigo-300 font-bold hover:text-white transition-colors bg-indigo-500/10 border border-indigo-500/30 px-3 py-1.5 rounded-xl">
                  <input
                    type="checkbox"
                    checked={planningOptions.onlyWithOrders || false}
                    onChange={e => setPlanningOptions(o => ({ ...o, onlyWithOrders: e.target.checked }))}
                    className="rounded border-slate-700 text-indigo-400 focus:ring-indigo-400 w-4 h-4 bg-slate-800"
                  />
                  <span>📦 Sadece Kesin Siparişi Olan Ürünleri Planla (Siparişsiz Üretim Açma)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-emerald-300 font-bold hover:text-white transition-colors bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                  <input
                    type="checkbox"
                    checked={planningOptions.considerShipmentVelocity ?? true}
                    onChange={e => setPlanningOptions(o => ({ ...o, considerShipmentVelocity: e.target.checked }))}
                    className="rounded border-slate-700 text-emerald-400 focus:ring-emerald-400 w-4 h-4 bg-slate-800"
                  />
                  <span>📈 Sevkiyat & Stok Erime Hızını Dikkate Al (Hızlı tükenen ürünleri öne al)</span>
                </label>

                {planningOptions.excludedProductIds && planningOptions.excludedProductIds.length > 0 && (
                  <span className="flex items-center gap-1.5 text-rose-300 bg-rose-500/10 border border-rose-500/30 px-3 py-1.5 rounded-xl text-xs font-semibold">
                    🚫 {planningOptions.excludedProductIds.length} Ürün Plan Dışı Bırakıldı
                    <button
                      type="button"
                      onClick={() => setPlanningOptions(o => ({ ...o, excludedProductIds: [] }))}
                      className="underline text-white ml-1 hover:text-rose-200 cursor-pointer"
                    >
                      (Hepsini Dahil Et)
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* AI GENERATED PLAN PREVIEW & REASONING (IF GENERATED) */}
          {generatedPlan && (
            <div ref={planPreviewRef} className="bg-white rounded-3xl p-6 border-2 border-amber-400 shadow-lg space-y-6">
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
                    disabled={isSavingPlan || generatedPlan.items.length === 0}
                    className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSavingPlan ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CheckCircle2 size={18} />
                    )}
                    <span>
                      {isSavingPlan
                        ? (saveStatusText || 'Kaydediliyor...')
                        : (generatedPlan.items.length === 0 ? 'Üretilecek İş Yok' : 'Planı Onayla & İş Emirlerine Dönüştür')}
                    </span>
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
              {generatedPlan.items.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                    <CheckCircle2 size={24} />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">Tüm Stok Seviyeleri Yeterli & Bekleyen Sipariş Yok</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Seçtiğiniz kriterlere göre acil üretim gerektiren bir stok açığı bulunmuyor. Yeni sipariş eklendiğinde veya stok emniyet seviyesinin altına indiğinde AI otomatik olarak üretim planı hazırlayacaktır.
                  </p>
                </div>
              ) : (
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
                          <th className="px-3 py-2.5 text-center">İşlemler</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {generatedPlan.items.map((it, idx) => {
                          const isM1 = it.machine_no === '1';
                          return (
                            <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                              <td className="px-3 py-2.5 font-mono text-slate-700 whitespace-nowrap">
                                {new Date(it.planned_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' })}
                              </td>
                              <td className="px-3 py-2.5 font-semibold text-slate-800">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  it.shift === 'Gündüz' ? 'bg-amber-100 text-amber-900' : 'bg-indigo-100 text-indigo-900'
                                }`}>
                                  {it.shift} ({planningOptions.dailyWorkingHours || 10} Saat)
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
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePreviewMachine(idx)}
                                    className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                    title="Diğer makineye aktar"
                                  >
                                    <ArrowLeftRight size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePreviewItem(idx)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                    title="Bu iş emrini plandan çıkar"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section: Live Stock Deficit & Demand Table */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Ürün Bazlı Canlı Stok Durumu & Sevkiyat Erime Hızı Röntgeni</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tesisinizdeki mevcut bitmiş ürün stoku, son 30 günün sevkiyat tüketim hızı (burn rate) ve tahmini stok tükenme süresi
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
                    <th className="px-3 py-3 text-right">Son 30 Gün Sevk</th>
                    <th className="px-3 py-3 text-center">Günlük Erime Hızı</th>
                    <th className="px-3 py-3 text-center">Stok Dayanma Süresi</th>
                    <th className="px-3 py-3 text-right">Bekleyen Sipariş</th>
                    <th className="px-3 py-3 text-right font-bold text-slate-900">Net İhtiyaç</th>
                    <th className="px-3 py-3 text-center">Planlama Durumu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map(p => {
                    const currentStock = stockMap[p.id] || 0;
                    const minStock = p.min_stock_alert || 0;
                    const isZero = currentStock <= 0;
                    const isBelowMin = currentStock < minStock;
                    const isExcluded = (planningOptions.excludedProductIds || []).includes(p.id);
                    const vel = shipmentVelocityMap[p.id];

                    const pendingOrdersForProduct = orders
                      .filter(o => o.product_id === p.id && (o.status === 'pending' || o.status === 'planned'))
                      .reduce((sum, o) => sum + Number(o.quantity || 0), 0);

                    const deficit = isBelowMin ? minStock - currentStock : 0;
                    const netNeed = deficit + pendingOrdersForProduct;

                    return (
                      <tr key={p.id} className={`hover:bg-slate-50/60 transition-colors ${isExcluded ? 'opacity-60 bg-rose-50/20' : ''}`}>
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {p.name}
                          {isExcluded && (
                            <span className="ml-2 text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                              Hariç Tutuldu
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {p.product_type} • {p.thickness} • {p.color}
                        </td>
                        <td className={`px-3 py-3 text-right font-mono font-bold ${
                          isZero ? 'text-red-600' : isBelowMin ? 'text-amber-600' : 'text-emerald-700'
                        }`}>
                          {currentStock.toLocaleString('tr-TR')} {p.unit}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">
                          {vel && vel.totalShippedLast30Days > 0 ? (
                            <span>{vel.totalShippedLast30Days.toLocaleString('tr-TR')} {p.unit}</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {vel && vel.dailyBurnRate > 0 ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                              vel.velocityCategory === 'very_fast'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : vel.velocityCategory === 'moderate'
                                ? 'bg-blue-100 text-blue-900 border border-blue-200'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {vel.trendText} {vel.dailyBurnRate.toLocaleString('tr-TR')} {p.unit}/g
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">💤 Hareketsiz</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {vel && vel.dailyBurnRate > 0 ? (
                            vel.daysOfStockRemaining === 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
                                🚨 Tükendi
                              </span>
                            ) : vel.daysOfStockRemaining <= 3 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">
                                ⏳ {vel.daysOfStockRemaining} Gün (Kritik)
                              </span>
                            ) : vel.daysOfStockRemaining <= 7 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                ⏳ {vel.daysOfStockRemaining} Gün (Dikkat)
                              </span>
                            ) : vel.daysOfStockRemaining <= 30 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                ⏳ {vel.daysOfStockRemaining} Gün
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                                ⏳ {vel.daysOfStockRemaining}+ Gün
                              </span>
                            )
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
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
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleExcludeProduct(p.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shadow-2xs cursor-pointer ${
                              isExcluded
                                ? 'bg-rose-100 text-rose-800 border border-rose-300 hover:bg-rose-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                            }`}
                            title={isExcluded ? 'Plana dahil etmek için tıklayın' : 'Plandan hariç tutmak için tıklayın'}
                          >
                            {isExcluded ? '🚫 Plan Dışı' : '✓ Dahil Ediliyor'}
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

          {/* Çalışma Esası ve Tatil Bilgisi */}
          <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between text-xs text-amber-950 gap-3 shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="font-bold">⏰ Fabrika Çalışma Esası:</span>
              <span>Günlük <strong>10 Saat</strong> Tek Vardiya (Haftalık 6 İş Günü)</span>
            </div>
            <div className="flex items-center gap-2 text-amber-900 bg-amber-100/80 px-3 py-1 rounded-xl font-semibold text-[11px] border border-amber-300/60">
              <span>🏖️ <strong>Pazar Günleri:</strong> Fabrika Tatili (Pazarları Üretim Yapılmaz)</span>
            </div>
          </div>

          {scheduleDateFilter && new Date(scheduleDateFilter).getDay() === 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-800 flex items-center gap-2">
              <span className="text-base">🏖️</span>
              <div>
                <strong>Seçtiğiniz tarih ({new Date(scheduleDateFilter).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })}) Pazar günüdür.</strong>
                <span className="block text-rose-600 text-[11px] mt-0.5">Fabrika Pazar günleri tatildir ve bu güne üretim planı atanmaz.</span>
              </div>
            </div>
          )}

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
                                {item.shift} (10 Saat)
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
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleMoveScheduleItemMachine(item.id, '1')}
                              className="flex items-center gap-1 text-slate-500 hover:text-amber-600 font-semibold text-[11px] transition-colors"
                              title="Makine 2'ye taşı"
                            >
                              <ArrowLeftRight size={13} />
                              Makine 2'ye Aktar
                            </button>

                            <button
                              onClick={() => handleDeleteScheduleItem(item)}
                              className="flex items-center gap-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-2 py-0.5 rounded-lg font-bold text-[11px] transition-colors"
                              title="İş emrini iptal et ve çizelgeden kaldır"
                            >
                              <Trash2 size={13} />
                              İptal Et
                            </button>
                          </div>

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
                                {item.shift} (10 Saat)
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
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleMoveScheduleItemMachine(item.id, '2')}
                              className="flex items-center gap-1 text-slate-500 hover:text-amber-600 font-semibold text-[11px] transition-colors"
                              title="Makine 1'e taşı"
                            >
                              <ArrowLeftRight size={13} />
                              Makine 1'e Aktar
                            </button>

                            <button
                              onClick={() => handleDeleteScheduleItem(item)}
                              className="flex items-center gap-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-2 py-0.5 rounded-lg font-bold text-[11px] transition-colors"
                              title="İş emrini iptal et ve çizelgeden kaldır"
                            >
                              <Trash2 size={13} />
                              İptal Et
                            </button>
                          </div>

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
          <div className="bg-amber-500/10 border border-amber-200/80 rounded-2xl p-4 text-xs text-amber-950 flex items-center gap-3">
            <Sliders size={20} className="text-amber-600 flex-shrink-0" />
            <div>
              <strong className="font-bold block text-sm">Ürün Bazlı Makine Kapasite Ayarları</strong>
              <span>
                Beton parke, bordür ve yağmur oluklarının üretim hızları birbirinden farklıdır. Her makinede üretilen taş/ürün için 10 saatlik net günlük kapasite belirleyin. Akıllı Asistan (AI) üretim çizelgesini bu değerleri esas alarak oluşturacaktır.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {machines.map(m => {
              const customCapEntries = Object.entries(m.product_capacities || {});
              const currentNew = newProdCapMap[m.machine_no] || { productId: '', capacity: Number(m.daily_capacity_m2) || 1000 };
              const selectedProd = products.find(p => p.id === currentNew.productId);

              return (
                <div key={m.machine_no} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-5">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-black text-base">
                        {m.machine_no}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-base">{m.name}</h3>
                        <p className="text-xs text-slate-400">Tesis Makine Parametreleri & Ürün Kapasiteleri</p>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-full border border-emerald-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      Aktif
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Varsayılan Genel Kapasite (10 Saat)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={m.daily_capacity_m2}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setMachines(prev => prev.map(x => x.machine_no === m.machine_no ? { ...x, daily_capacity_m2: val } : x));
                          }}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 pr-16"
                        />
                        <span className="absolute right-3 top-2 text-slate-400 text-xs font-semibold">m²/gün</span>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-0.5 block">Özel tanımı olmayan ürünler için</span>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Varsayılan Vardiya Düzeni</label>
                      <select
                        value={m.shift_count}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setMachines(prev => prev.map(x => x.machine_no === m.machine_no ? { ...x, shift_count: val } : x));
                        }}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        <option value={1}>1 Vardiya (Günlük 10 Saat)</option>
                        <option value={2}>2 Vardiya (10 + 10 Saat)</option>
                      </select>
                      <span className="text-[10px] text-slate-400 mt-0.5 block">Pazar günleri tatil</span>
                    </div>
                  </div>

                  <div className="text-xs">
                    <label className="block font-semibold text-slate-700 mb-1">Uzmanlaştığı Ürün Tipleri</label>
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700">
                      {m.specialized_types && m.specialized_types.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {m.specialized_types.map((st, i) => (
                            <span key={i} className="bg-white border border-slate-200 px-2 py-0.5 rounded-md font-semibold text-slate-800 text-[11px]">
                              {st}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500">Tüm Ürün Tipleri (Kısıtlama Yok)</span>
                      )}
                    </div>
                  </div>

                  {/* 🎯 ÖZEL BÖLÜM: ÜRÜN BAZLI GÜNLÜK KAPASİTE AYARLARI */}
                  <div className="border border-amber-200 bg-amber-50/40 rounded-2xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <Sliders size={14} className="text-amber-600" />
                          Ürüne Özel Günlük Kapasite Belirleme
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Bu makinede üretilecek ürünün günlük baskı kapasitesini belirleyin.
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePopulateAllProducts(m.machine_no)}
                          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold shadow-2xs transition-colors flex items-center gap-1"
                          title="Fabrikadaki tüm ürünleri otomatik ekle"
                        >
                          <Plus size={12} />
                          Tüm Ürünleri Getir
                        </button>
                        {customCapEntries.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleClearProductCapacities(m.machine_no)}
                            className="px-2 py-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-[11px] font-medium transition-colors"
                            title="Tüm ürün kapasitelerini temizle"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Ürün Seç & Kapasite Ekle Barı */}
                    <div className="bg-white border border-amber-200 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs items-end shadow-2xs">
                      <div className="sm:col-span-6">
                        <label className="block font-semibold text-slate-700 mb-1 text-[11px]">Ürün Seç *</label>
                        <select
                          value={currentNew.productId}
                          onChange={e => {
                            const pid = e.target.value;
                            const existingCap = m.product_capacities?.[pid] || Number(m.daily_capacity_m2) || 1200;
                            setNewProdCapMap(prev => ({
                              ...prev,
                              [m.machine_no]: { productId: pid, capacity: existingCap }
                            }));
                          }}
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 font-medium"
                        >
                          <option value="">Ürün Seçiniz...</option>
                          {products.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.thickness || 'Standart'} - {p.color || 'Gri'}) [{p.unit}]
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block font-semibold text-slate-700 mb-1 text-[11px]">
                          Kapasite ({selectedProd?.unit || 'm²'}/10s)
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="Kapasite"
                          value={currentNew.capacity || ''}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setNewProdCapMap(prev => ({
                              ...prev,
                              [m.machine_no]: { ...prev[m.machine_no], capacity: val }
                            }));
                          }}
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <button
                          type="button"
                          disabled={!currentNew.productId || !currentNew.capacity}
                          onClick={() => {
                            handleSetProductCapacity(m.machine_no, currentNew.productId, currentNew.capacity);
                            setNewProdCapMap(prev => ({
                              ...prev,
                              [m.machine_no]: { productId: '', capacity: Number(m.daily_capacity_m2) || 1000 }
                            }));
                          }}
                          className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1 shadow-2xs"
                        >
                          <Plus size={14} />
                          Ekle / Güncelle
                        </button>
                      </div>
                    </div>

                    {/* Tanımlı Ürün Kapasiteleri Listesi */}
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {customCapEntries.length === 0 ? (
                        <div className="text-center py-4 bg-white/60 rounded-xl border border-dashed border-amber-200 text-slate-400 text-xs">
                          Henüz bu makineye özel bir ürün kapasitesi eklenmedi.
                          <br />
                          <span className="text-[11px] text-slate-400">
                            Özel kapasite belirlemek için yukarıdan ürün seçin veya <strong>"Tüm Ürünleri Getir"</strong> butonuna basın.
                          </span>
                        </div>
                      ) : (
                        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden text-xs">
                          {customCapEntries.map(([pid, cap]) => {
                            const prod = products.find(p => p.id === pid);
                            const unit = prod?.unit || 'm²';
                            const pallets = prod?.m2_per_pallet && prod.m2_per_pallet > 0
                              ? (cap / prod.m2_per_pallet).toFixed(1)
                              : null;

                            return (
                              <div key={pid} className="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors">
                                <div className="min-w-0 flex-1">
                                  <div className="font-bold text-slate-900 truncate">
                                    {prod ? prod.name : 'Bilinmeyen / Silinmiş Ürün'}
                                  </div>
                                  <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                    <span>{prod?.product_type || 'Parke'}</span>
                                    <span>•</span>
                                    <span>{prod?.thickness || 'Standart'}</span>
                                    <span>•</span>
                                    <span>{prod?.color || 'Gri'}</span>
                                    {pallets && (
                                      <>
                                        <span>•</span>
                                        <span className="font-medium text-emerald-600">~{pallets} Palet/Gün</span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <div className="relative w-28">
                                    <input
                                      type="number"
                                      min="1"
                                      value={cap}
                                      onChange={e => {
                                        const val = Number(e.target.value);
                                        handleSetProductCapacity(m.machine_no, pid, val);
                                      }}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-right font-mono font-black text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 pr-9"
                                    />
                                    <span className="absolute right-2 top-1 text-[10px] font-bold text-slate-400">
                                      {unit}
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveProductCapacity(m.machine_no, pid)}
                                    className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Ürünü makine listesinden kaldır"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Açıklama / Not */}
                  <div className="text-xs">
                    <label className="block font-semibold text-slate-700 mb-1">Açıklama / Not</label>
                    <input
                      type="text"
                      value={m.notes || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setMachines(prev => prev.map(x => x.machine_no === m.machine_no ? { ...x, notes: val } : x));
                      }}
                      placeholder="Makine hattı veya kalıp notları..."
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  {/* Kaydet Butonu */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => handleSaveMachine(m)}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={15} className="text-emerald-400" />
                      {m.name} Ayarlarını & Ürün Kapasitelerini Kaydet
                    </button>
                  </div>
                </div>
              );
            })}
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
              {orderForm.product_id && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 bg-amber-50/50 px-2.5 py-1.5 rounded-lg border border-amber-200/60">
                  <span className="font-semibold text-amber-900">Tesis Baskı Kapasitesi:</span>
                  <span className="flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    1 Nolu Makine: <strong className="text-slate-900">{getMachineProductCapacity(machines.find(m => m.machine_no === '1'), products.find(p => p.id === orderForm.product_id)).toLocaleString('tr-TR')} {orderForm.unit}/gün</strong>
                  </span>
                  <span className="text-amber-300">|</span>
                  <span className="flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    2 Nolu Makine: <strong className="text-slate-900">{getMachineProductCapacity(machines.find(m => m.machine_no === '2'), products.find(p => p.id === orderForm.product_id)).toLocaleString('tr-TR')} {orderForm.unit}/gün</strong>
                  </span>
                </div>
              )}
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
