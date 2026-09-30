import { Product, MachineDefinition, ProductionOrder, CustomerQuota, ProductionPlanItem } from '../types';

export interface ProductShipmentVelocity {
  productId: string;
  totalShippedLast30Days: number;
  totalShippedLast7Days: number;
  dailyBurnRate: number; // m2 or unit / day (based on 30-day average)
  weeklyBurnRate: number; // dailyBurnRate * 7
  daysOfStockRemaining: number; // currentStock / dailyBurnRate (999 if no consumption)
  velocityCategory: 'very_fast' | 'moderate' | 'slow' | 'stagnant';
  trendText: string;
}

export interface PlanningOptions {
  startDate: string;
  daysCount: number;
  dailyWorkingHours: number; // default: 10
  shiftsPerDay: 1 | 2; // 1 = 10 saat normal vardiya, 2 = 10+10 saat çift vardiya
  excludeSundays: boolean; // default: true (Pazarları tatil)
  strategy: 'balanced' | 'minimize_mold_change' | 'urgent_first';
  includeMinStockDeficit: boolean;
  includeQuotaDemand: boolean;
  onlyWithOrders?: boolean; // Sadece kesin siparişi olan ürünleri üret (siparişsiz stok yapma)
  excludedProductIds?: string[]; // Belirli ürünleri planlamadan hariç tutma
  considerShipmentVelocity?: boolean; // Sevkiyat ve stok erime hızını dikkate al
  shipmentVelocities?: Record<string, ProductShipmentVelocity>; // Ürün bazlı sevkiyat hız haritası
}

export interface ProductDemand {
  product: Product;
  currentStock: number;
  minStockAlert: number;
  stockDeficit: number; // minStock - currentStock (if currentStock < minStock)
  pendingOrderQty: number;
  quotaDemandQty: number;
  totalNetNeed: number;
  urgency: 'critical' | 'high' | 'normal';
  urgencyScore: number;
  moldKey: string;
  moldName: string;
  closestDueDate?: string;
  velocity?: ProductShipmentVelocity;
}

export interface PlannedItemWithMoldInfo extends Omit<ProductionPlanItem, 'id' | 'plan_id'> {
  is_mold_change?: boolean;
  mold_name?: string;
  campaign_day?: number;
  campaign_total_days?: number;
}

export interface AIPlanningResult {
  planName: string;
  startDate: string;
  endDate: string;
  items: PlannedItemWithMoldInfo[];
  demands: ProductDemand[];
  summary: {
    totalPlannedM2: number;
    machine1M2: number;
    machine2M2: number;
    machine1Days: number;
    machine2Days: number;
    moldChangesSaved: number;
    totalMoldChanges: number;
    criticalDeficitsCovered: number;
    reasoning: string[];
    criticalAlerts: string[];
    recommendations: string[];
  };
}

export function parseSafeDate(dateStr?: string | null): Date {
  if (!dateStr || typeof dateStr !== 'string') return new Date();
  const trimmed = dateStr.trim();
  const dmyMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return parsed;
  return new Date();
}

export function formatSafeISODate(d: Date): string {
  if (!d || isNaN(d.getTime())) d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getMachineProductCapacity(machine?: MachineDefinition, product?: Product): number {
  if (!machine) return 1000;
  if (machine.product_capacities && product?.id && machine.product_capacities[product.id] !== undefined) {
    const val = Number(machine.product_capacities[product.id]);
    if (val > 0) return val;
  }
  return Math.round(Number(machine.daily_capacity_m2 || 1000));
}

/**
 * Ürünün Bordür / Oluk / Altyapı elemanı olup olmadığını tespit eder.
 * Bordürler Makine 2'ye, Zemin Parke Taşları Makine 1'e önceliklidir.
 */
export function isBordurOrAuxiliary(product?: Product): boolean {
  if (!product) return false;
  const name = (product.name || '').toLowerCase();
  const type = (product.product_type || '').toLowerCase();
  const unit = (product.unit || '').toLowerCase();

  if (type.includes('bordür') || type.includes('oluk') || type.includes('tretuar')) return true;
  if (name.includes('bordür') || name.includes('bordur') || name.includes('oluk') || name.includes('yağmur') || name.includes('yagmur') || name.includes('harpuşta') || name.includes('engelli')) return true;
  if (unit === 'metre') return true;
  return false;
}

/**
 * 1 Palete sığan miktar (m², metre veya adet)
 */
export function getProductPalletCapacity(product?: Product): number {
  if (product?.m2_per_pallet && Number(product.m2_per_pallet) > 0) {
    return Number(product.m2_per_pallet);
  }
  const unit = (product?.unit || 'm2').toLowerCase();
  if (unit === 'metre') return 25; // standard ~25-30m / palet
  if (unit === 'adet') return 50;  // standard ~50 adet / palet
  return 10; // standard ~10 m2 / palet
}

/**
 * Endüstriyel Parke ve Bordür Fabrikası Akıllı Üretim Planlayıcısı
 *
 * Temel Fabrika Kuralları:
 * 1. "Her Ürünün Kalıbı Farklıdır": Kalıp kimliği ürün bazlıdır (moldKey = product.id). Ürün değiştiğinde mutlaka kalıp değişimi gerçekleşir.
 * 2. "Asgari Parti Büyüklüğü & Tam Vardiya": 1.5-2 saatlik kalıp montajı sonrası 59m gibi mikro üretimler yapılamaz; kalıp takılan vardiya tam çalıştırılır, artan miktar ambar emniyet stoğuna alınır.
 * 3. "Kesintisiz Kalıp Kampanyası (Campaign / Block Production)": Bir makineye kalıp takıldığında, o ürünün ihtiyacı bitene kadar ardışık günlerde kesintisiz üretilir; her gün kalıp değiştirilmez.
 * 4. "Makine Uzmanlaşması": Hat 1 Parke taşlarına (Kilitli, Prizma vb.), Hat 2 Bordür ve oluk hatlarına tahsis edilir.
 * 5. "Kalıp Değişimi Duruş Süresi": Yeni kalıp bağlanan ilk vardiyada ~1.5 saatlik montaj ve ayar süresi nedeniyle net kapasite %85 olarak planlanır.
 */
export function generateSmartProductionPlan({
  products,
  stockMap,
  orders,
  quotas,
  machines,
  options,
}: {
  products: Product[];
  stockMap: Record<string, number>;
  orders: ProductionOrder[];
  quotas: CustomerQuota[];
  machines: MachineDefinition[];
  options: PlanningOptions;
}): AIPlanningResult {
  const excludedSet = new Set(options.excludedProductIds || []);
  const activeProducts = (products || []).filter(p => p && p.is_active && !excludedSet.has(p.id));

  // 1. Calculate Demands & Urgency
  const demands: ProductDemand[] = activeProducts.map(p => {
    const currentStock = Number(stockMap?.[p.id]) || 0;
    const minStockAlert = Number(p.min_stock_alert) || 0;
    const stockDeficit = currentStock < minStockAlert ? minStockAlert - currentStock : 0;

    // Filter pending orders for this product
    const prodOrders = (orders || []).filter(o => o && o.product_id === p.id && (o.status === 'pending' || o.status === 'planned'));
    const pendingOrderQty = prodOrders.reduce((sum, o) => sum + Number(o.quantity || 0), 0);

    let closestDueDate: string | undefined = undefined;
    prodOrders.forEach(o => {
      if (o.due_date && (!closestDueDate || o.due_date < closestDueDate)) {
        closestDueDate = o.due_date;
      }
    });

    // Quotas remaining demand
    let quotaDemandQty = 0;
    if (options.includeQuotaDemand) {
      const prodQuotas = (quotas || []).filter(q => q && q.product_id === p.id && q.is_active);
      quotaDemandQty = prodQuotas.reduce((sum, q) => {
        const target = Number(q.target_quantity || 0);
        const shipped = Number(q.shipped_quantity || 0);
        return sum + Math.max(0, target - shipped);
      }, 0);
    }

    const vel = options.shipmentVelocities ? options.shipmentVelocities[p.id] : undefined;

    let totalNetNeed = 0;
    if (options.onlyWithOrders) {
      // Yalnızca kesin müşteri siparişi olan ürünleri üret
      totalNetNeed = pendingOrderQty;
    } else {
      const netNeed = (options.includeMinStockDeficit ? stockDeficit : 0) + pendingOrderQty;
      // Sevkiyat ve stok erime hızına göre 7 günlük tüketim tamponu
      let velocityNeed = 0;
      if (options.considerShipmentVelocity && vel && vel.dailyBurnRate > 0 && vel.daysOfStockRemaining <= 7) {
        const weeklyDemand = Math.round(vel.dailyBurnRate * 7);
        velocityNeed = Math.max(0, weeklyDemand - currentStock);
      }
      const combinedNeed = Math.max(netNeed, velocityNeed);
      totalNetNeed = Math.max(0, combinedNeed > 0 ? combinedNeed : (quotaDemandQty > 0 ? Math.min(quotaDemandQty, 2000) : 0));
    }

    // Urgency calculation
    let urgency: 'critical' | 'high' | 'normal' = 'normal';
    let urgencyScore = 10;

    if (currentStock <= 0 && totalNetNeed > 0) {
      urgency = 'critical';
      urgencyScore += 100;
    } else if (currentStock < minStockAlert && totalNetNeed > 0) {
      urgency = 'high';
      urgencyScore += 50;
    }

    if (closestDueDate) {
      const today = new Date().toISOString().split('T')[0];
      const diffDays = (new Date(closestDueDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays <= 3) {
        urgency = 'critical';
        urgencyScore += 80;
      } else if (diffDays <= 7) {
        if (urgency !== 'critical') urgency = 'high';
        urgencyScore += 40;
      }
    }

    // Sevkiyat Hızı & Stok Erime Analizi Önceliklendirmesi
    if (options.considerShipmentVelocity && vel) {
      if (vel.daysOfStockRemaining <= 3 && totalNetNeed > 0) {
        urgency = 'critical';
        urgencyScore += 75; // 3 günden az stok kaldı -> Acil kritik!
      } else if (vel.daysOfStockRemaining <= 7 && totalNetNeed > 0) {
        if (urgency !== 'critical') urgency = 'high';
        urgencyScore += 45; // 7 gün içinde bitecek -> Yüksek öncelik
      } else if (vel.velocityCategory === 'very_fast') {
        urgencyScore += 25; // Lokomotif ürün
      } else if (vel.velocityCategory === 'stagnant' && pendingOrderQty === 0) {
        urgencyScore = Math.max(5, urgencyScore - 40);
      }
    }

    // KURAL: Her ürünün kalıbı bağımsızdır ve kendine aittir
    const moldKey = p.id;
    const moldName = p.name;

    return {
      product: p,
      currentStock,
      minStockAlert,
      stockDeficit,
      pendingOrderQty,
      quotaDemandQty,
      totalNetNeed,
      urgency,
      urgencyScore,
      moldKey,
      moldName,
      closestDueDate,
      velocity: vel,
    };
  });

  // 2. Setup Machines and Capacities (Günlük 10 Saatlik Çalışma)
  const m1Def = (machines || []).find(m => String(m.machine_no) === '1') || {
    machine_no: '1',
    name: '1 Nolu Parke Baskı Makinesi',
    daily_capacity_m2: 1200,
    shift_count: options.shiftsPerDay || 1,
    specialized_types: ['Kilitli', 'Aşık', 'Prizma', 'Küp Taşı'],
    product_capacities: {},
    is_active: true,
  };

  const m2Def = (machines || []).find(m => String(m.machine_no) === '2') || {
    machine_no: '2',
    name: '2 Nolu Parke & Bordür Makinesi',
    daily_capacity_m2: 1000,
    shift_count: options.shiftsPerDay || 1,
    specialized_types: ['Bordür', 'Oluk', 'Begonit', 'Tretuar'],
    product_capacities: {},
    is_active: true,
  };

  // 3. Build Calendar Dates (Pazar Tatili Kontrolü)
  const shifts: ('Gündüz' | 'Gece')[] = options.shiftsPerDay === 2 ? ['Gündüz', 'Gece'] : ['Gündüz'];
  const workingDates: string[] = [];
  const sundayDates: string[] = [];
  const startObj = parseSafeDate(options.startDate);
  const daysCount = Math.max(1, Number(options.daysCount) || 7);

  for (let i = 0; i < daysCount; i++) {
    const cur = new Date(startObj);
    cur.setDate(cur.getDate() + i);
    const dateStr = formatSafeISODate(cur);
    const isSunday = cur.getDay() === 0;

    if (isSunday && options.excludeSundays) {
      sundayDates.push(dateStr);
    } else {
      workingDates.push(dateStr);
    }
  }

  // 4. Makine Uzmanlaşmasına Göre Ürün Havuzlarını Ayır (Line Specialization)
  interface CandidateItem {
    product: Product;
    remainingNeed: number;
    urgency: string;
    urgencyScore: number;
    orderId?: string;
    quotaId?: string;
  }

  const m1Candidates: CandidateItem[] = [];
  const m2Candidates: CandidateItem[] = [];

  demands.forEach(d => {
    const isBordur = isBordurOrAuxiliary(d.product);
    const hasM1Custom = !!(m1Def.product_capacities && m1Def.product_capacities[d.product.id]);
    const hasM2Custom = !!(m2Def.product_capacities && m2Def.product_capacities[d.product.id]);

    const relatedOrder = (orders || []).find(o => o && o.product_id === d.product.id && (o.status === 'pending' || o.status === 'planned'));
    const relatedQuota = (quotas || []).find(q => q && q.product_id === d.product.id && q.is_active);

    const candItem: CandidateItem = {
      product: d.product,
      remainingNeed: d.totalNetNeed,
      urgency: d.urgency,
      urgencyScore: d.urgencyScore,
      orderId: relatedOrder?.id,
      quotaId: relatedQuota?.id,
    };

    if (hasM1Custom && !hasM2Custom) {
      m1Candidates.push(candItem);
    } else if (hasM2Custom && !hasM1Custom) {
      m2Candidates.push(candItem);
    } else if (isBordur) {
      m2Candidates.push(candItem);
    } else {
      m1Candidates.push(candItem);
    }
  });

  // Sıralama: Acil ihtiyacı olanlar en öne
  m1Candidates.sort((a, b) => b.urgencyScore - a.urgencyScore);
  m2Candidates.sort((a, b) => b.urgencyScore - a.urgencyScore);

  // 5. Kampanya / Blok Planlama Motoru (Campaign Scheduling per Machine)
  const planItems: PlannedItemWithMoldInfo[] = [];
  let totalMoldChanges = 0;
  let moldChangesSaved = 0;
  let criticalDeficitsCovered = 0;
  let productCustomCapacityUsage = 0;

  const machineState: Record<string, { currentMold: string | null; totalM2: number; busyDays: Set<string>; moldChanges: number }> = {
    '1': { currentMold: null, totalM2: 0, busyDays: new Set(), moldChanges: 0 },
    '2': { currentMold: null, totalM2: 0, busyDays: new Set(), moldChanges: 0 },
  };

  function scheduleMachine(machineNo: '1' | '2', candidates: CandidateItem[], machDef: MachineDefinition) {
    const totalSlots = workingDates.length * shifts.length;
    let slotIdx = 0;

    // Yalnızca net ihtiyacı > 0 olan ürünleri öncelikle planla
    const needed = candidates.filter(c => c.remainingNeed > 0);

    for (const cand of needed) {
      if (slotIdx >= totalSlots) break;

      let campaignShiftsCount = 0;

      while (cand.remainingNeed > 0 && slotIdx < totalSlots) {
        const dateStr = workingDates[Math.floor(slotIdx / shifts.length)];
        const shift = shifts[slotIdx % shifts.length];

        const isMoldChange = (machineState[machineNo].currentMold !== cand.product.id);
        const nominalCapacity = getMachineProductCapacity(machDef, cand.product);

        if (machDef.product_capacities && machDef.product_capacities[cand.product.id]) {
          productCustomCapacityUsage++;
        }

        // KURAL: Kalıp Değişimi Duruş Süresi (~1.5 saat montaj/ayar -> %15 kapasite indirimi)
        // Eğer aynı kalıp devam ediyorsa tam %100 vardiya kapasitesi
        const effectiveShiftCapacity = isMoldChange
          ? Math.round(nominalCapacity * 0.85)
          : nominalCapacity;

        if (isMoldChange) {
          machineState[machineNo].moldChanges++;
          totalMoldChanges++;
        } else {
          moldChangesSaved++;
        }

        machineState[machineNo].currentMold = cand.product.id;

        // KURAL: Asgari Parti Büyüklüğü (Minimum Viable Run)
        // 59m gibi küçük kalan siparişlerde makine durdurulmaz; tam vardiya çalışılır.
        // İhtiyaç kadar miktar siparişe ayrılır, kalan miktar mamul ambar emniyet stoğu yapılır.
        let plannedQty = effectiveShiftCapacity;
        let note = '';
        const unitStr = cand.product.unit || 'm²';

        if (cand.remainingNeed < effectiveShiftCapacity) {
          const orderPart = Math.round(cand.remainingNeed);
          const bufferPart = effectiveShiftCapacity - orderPart;
          cand.remainingNeed = 0;

          if (isMoldChange) {
            note = `🔧 Kalıp Montajı: ${cand.product.name} (~1.5 sa ayar) | ${orderPart.toLocaleString('tr-TR')} ${unitStr} Sipariş + ${bufferPart.toLocaleString('tr-TR')} ${unitStr} Ambar Emniyet Stoğu`;
          } else {
            note = `🔁 Kesintisiz Üretim (Kalıp Sabit) | ${orderPart.toLocaleString('tr-TR')} ${unitStr} Sipariş + ${bufferPart.toLocaleString('tr-TR')} ${unitStr} Ambar Emniyet Stoğu`;
          }
        } else {
          cand.remainingNeed -= effectiveShiftCapacity;

          if (isMoldChange) {
            note = `🔧 Kalıp Montajı: ${cand.product.name} (~1.5 sa ayar süresi dahil)`;
          } else {
            note = `🔁 Kesintisiz Üretim (Kalıp Sabit - Duruşsuz Tam Vardiya)`;
          }
        }

        if (cand.urgency === 'critical') {
          criticalDeficitsCovered++;
        }

        const palletCap = getProductPalletCapacity(cand.product);
        const plannedPallets = palletCap > 0 ? Math.round((plannedQty / palletCap) * 10) / 10 : 0;

        machineState[machineNo].totalM2 += plannedQty;
        machineState[machineNo].busyDays.add(dateStr);
        campaignShiftsCount++;

        planItems.push({
          machine_no: machineNo,
          planned_date: dateStr,
          shift,
          product_id: cand.product.id,
          order_id: cand.orderId || null,
          quota_id: cand.quotaId || null,
          planned_m2: plannedQty,
          planned_pallets: plannedPallets,
          produced_m2: 0,
          status: 'scheduled',
          sequence_order: planItems.length + 1,
          notes: note,
          products: cand.product,
          is_mold_change: isMoldChange,
          mold_name: cand.product.name,
          campaign_day: campaignShiftsCount,
        });

        slotIdx++;
      }
    }

    // Eğer haftanın kalan günleri varsa ve "Yalnızca Sipariş Olanları Üret" seçili DEĞİLSE:
    // Kalıp sökmeden, makinede takılı olan son ürünün emniyet stoğunu üretmeye devam et (sıfır duruş!)
    if (!options.onlyWithOrders && slotIdx < totalSlots && machineState[machineNo].currentMold) {
      const activeMoldId = machineState[machineNo].currentMold;
      const lastCand = candidates.find(c => c.product.id === activeMoldId);

      if (lastCand) {
        while (slotIdx < totalSlots) {
          const dateStr = workingDates[Math.floor(slotIdx / shifts.length)];
          const shift = shifts[slotIdx % shifts.length];
          const nominalCapacity = getMachineProductCapacity(machDef, lastCand.product);
          const palletCap = getProductPalletCapacity(lastCand.product);
          const plannedPallets = palletCap > 0 ? Math.round((nominalCapacity / palletCap) * 10) / 10 : 0;

          machineState[machineNo].totalM2 += nominalCapacity;
          machineState[machineNo].busyDays.add(dateStr);
          moldChangesSaved++;

          planItems.push({
            machine_no: machineNo,
            planned_date: dateStr,
            shift,
            product_id: lastCand.product.id,
            order_id: null,
            quota_id: null,
            planned_m2: nominalCapacity,
            planned_pallets: plannedPallets,
            produced_m2: 0,
            status: 'scheduled',
            sequence_order: planItems.length + 1,
            notes: `🔁 Kesintisiz Üretim (Kalıp Sabit) | Fabrika Ambar Emniyet Stoğu Tamamlama`,
            products: lastCand.product,
            is_mold_change: false,
            mold_name: lastCand.product.name,
          });

          slotIdx++;
        }
      }
    }
  }

  // Schedule Machine 1 (Parke Hattı)
  scheduleMachine('1', m1Candidates, m1Def);

  // Schedule Machine 2 (Bordür & İkincil Hat)
  scheduleMachine('2', m2Candidates, m2Def);

  // Sort all plan items by planned_date and sequence
  planItems.sort((a, b) => {
    if (a.planned_date !== b.planned_date) {
      return a.planned_date.localeCompare(b.planned_date);
    }
    if (a.machine_no !== b.machine_no) {
      return a.machine_no.localeCompare(b.machine_no);
    }
    return a.sequence_order - b.sequence_order;
  });

  // 6. Build Comprehensive AI Reasoning & Operational Report
  const totalPlannedM2 = (machineState['1']?.totalM2 || 0) + (machineState['2']?.totalM2 || 0);
  const reasoning: string[] = [];
  const criticalAlerts: string[] = [];
  const recommendations: string[] = [];

  // Alerts
  demands.forEach(d => {
    const pName = d.product?.name || 'Ürün';
    const pUnit = d.product?.unit || 'm²';
    if (d.currentStock <= 0 && d.totalNetNeed > 0) {
      criticalAlerts.push(`🚨 ${pName}: Stok tamamen tükenmiş durumda (Mevcut: 0 ${pUnit}). Acil ilk vardiyalara alındı.`);
    } else if (d.currentStock < d.minStockAlert && d.totalNetNeed > 0) {
      criticalAlerts.push(`⚠️ ${pName}: Emniyet stoğu (${d.minStockAlert}) altına düşmüş (Kalan: ${d.currentStock} ${pUnit}).`);
    }
    if (d.closestDueDate) {
      const parsedDue = parseSafeDate(d.closestDueDate);
      criticalAlerts.push(`📅 ${pName}: Sipariş teslim tarihi yaklaşıyor (${parsedDue.toLocaleDateString('tr-TR')}).`);
    }
  });

  // Operational Reasoning Rules
  reasoning.push(`📅 Çalışma Takvimi: Günlük ${options.dailyWorkingHours || 10} saat çalışma esasına göre planlandı. Toplam ${workingDates.length} iş günü planlandı (${sundayDates.length} Pazar günü fabrika tatili olarak ayrıldı).`);
  reasoning.push(`🏭 Makine Uzmanlaşması: Makine 1 yalnızca parke taşlarına, Makine 2 bordür ve altyapı elemanlarına tahsis edildi. İki hat arasında gereksiz kalıp transferi ve çaprazlama engellendi.`);
  reasoning.push(`🔧 Her Ürün Bağımsız Kalıp Kuralı: Tüm ürünlerin kalıpları ayrı kabul edildi. Yeni kalıp montajı olan ilk vardiyalara ~1.5 saatlik söküm-takım ve ayar payı (%15 kapasite düşüşü) otomatik olarak uygulandı.`);
  reasoning.push(`📦 Asgari Parti & Tam Vardiya Kuralı: 59 m gibi mikro siparişler için makine durdurulmadı; tam 10 saatlik vardiya çalıştırılarak sipariş kapatıldı ve artan miktar fabrikanın satış ambarı emniyet stoğuna eklendi.`);

  if (moldChangesSaved > 0) {
    reasoning.push(`✨ Blok Kampanya Planlaması: Aynı ürünler ardışık günlerde kesintisiz çalıştırılarak yaklaşık ${moldChangesSaved} gereksiz kalıp söküm-takım işleminden tasarruf edildi.`);
  }

  reasoning.push(`Makine 1 (Hat 1) üzerine toplam ${(machineState['1']?.totalM2 || 0).toLocaleString('tr-TR')} m² parke taşı üretimi planlandı (${machineState['1']?.busyDays.size || 0} çalışma günü, ${machineState['1']?.moldChanges || 0} kalıp değişimi).`);
  reasoning.push(`Makine 2 (Hat 2) üzerine toplam ${(machineState['2']?.totalM2 || 0).toLocaleString('tr-TR')} m² / metre bordür üretimi planlandı (${machineState['2']?.busyDays.size || 0} çalışma günü, ${machineState['2']?.moldChanges || 0} kalıp değişimi).`);

  if (productCustomCapacityUsage > 0) {
    reasoning.push(`🎯 Ürün Bazlı Özel Kapasiteler: ${productCustomCapacityUsage} adet iş emri, makineler için tanımlanan ürüne özel günlük baskı kapasitelerine göre hassas olarak planlandı.`);
  }

  if (options.onlyWithOrders) {
    reasoning.push(`📦 Sipariş Filtresi: Yalnızca kesin müşteri siparişi olan ürünler planlandı; siparişi olmayan kalemler için ön stok basılmadı.`);
  }

  // Sevkiyat & Stok Erime Analizi Raporlama
  if (options.considerShipmentVelocity && options.shipmentVelocities) {
    const velList = Object.values(options.shipmentVelocities);
    const sortedByBurn = [...velList].sort((a, b) => (Number(b.dailyBurnRate) || 0) - (Number(a.dailyBurnRate) || 0));
    const topBurn = sortedByBurn[0];
    const topProduct = topBurn ? (products || []).find(p => p && p.id === topBurn.productId) : null;

    if (topProduct && topBurn && (Number(topBurn.dailyBurnRate) || 0) > 0) {
      const burnRateStr = (Number(topBurn.dailyBurnRate) || 0).toLocaleString('tr-TR');
      const shipped30Str = (Number(topBurn.totalShippedLast30Days) || 0).toLocaleString('tr-TR');
      const unit = topProduct.unit || 'm²';
      reasoning.push(`🔥 En Hızlı Eriyen / Çok Satan Ürün: "${topProduct.name}" (Günde ortalama ${burnRateStr} ${unit} sevk ediliyor; son 30 gün toplamı: ${shipped30Str} ${unit}).`);
    }

    const runOutRisks = velList.filter(v => (Number(v.dailyBurnRate) || 0) > 0 && (Number(v.daysOfStockRemaining) || 999) <= 7 && (Number(v.daysOfStockRemaining) || 999) > 0);
    if (runOutRisks.length > 0) {
      const names = runOutRisks.map(r => (products || []).find(p => p && p.id === r.productId)?.name).filter(Boolean).slice(0, 3).join(', ');
      criticalAlerts.push(`⚠️ Sevkiyat Hızı Uyarısı: ${runOutRisks.length} kalemin (${names}${runOutRisks.length > 3 ? '...' : ''}) stoku mevcut sevkiyat temposuyla 7 günden az sürede tükenecektir. Sevkiyat aksamaması için üretimleri öne alındı.`);
    }
  }

  recommendations.push(`Kalıp tasarrufu ve minimum duruş için ardışık kampanya bloklarına sadık kalınması önerilir.`);
  if (options.shiftsPerDay === 1) {
    recommendations.push(`Günlük 10 saatlik tek vardiya çalışma düzeni devrede (Pazar günleri tatil). Acil terminler için fazla mesai veya 2. vardiya açılabilir.`);
  }

  const safeStart = parseSafeDate(options.startDate);
  const startDateStr = formatSafeISODate(safeStart);
  const endDateStr = workingDates.length > 0 ? workingDates[workingDates.length - 1] : startDateStr;
  const safeEnd = parseSafeDate(endDateStr);
  const startFormatted = safeStart.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const endFormatted = safeEnd.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  const planName = `${startFormatted} – ${endFormatted} Üretim Planı (10s/Gün)`;

  return {
    planName,
    startDate: startDateStr,
    endDate: endDateStr,
    items: planItems,
    demands,
    summary: {
      totalPlannedM2,
      machine1M2: machineState['1']?.totalM2 || 0,
      machine2M2: machineState['2']?.totalM2 || 0,
      machine1Days: machineState['1']?.busyDays.size || 0,
      machine2Days: machineState['2']?.busyDays.size || 0,
      moldChangesSaved,
      totalMoldChanges,
      criticalDeficitsCovered,
      reasoning,
      criticalAlerts,
      recommendations,
    },
  };
}
