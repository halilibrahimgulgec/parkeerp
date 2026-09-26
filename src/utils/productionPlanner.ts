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
  excludedProductIds?: string[]; // Belirli ürünleri planlamadan hariç tutma (örn. 6'lık parke)
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
  closestDueDate?: string;
  velocity?: ProductShipmentVelocity;
}

export interface AIPlanningResult {
  planName: string;
  startDate: string;
  endDate: string;
  items: Omit<ProductionPlanItem, 'id' | 'plan_id'>[];
  demands: ProductDemand[];
  summary: {
    totalPlannedM2: number;
    machine1M2: number;
    machine2M2: number;
    machine1Days: number;
    machine2Days: number;
    moldChangesSaved: number;
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
    if (options.onlyWithOrders && pendingOrderQty <= 0) {
      // Sadece kesin siparişi olan ürünleri üret
      totalNetNeed = 0;
    } else {
      const netNeed = (options.includeMinStockDeficit ? stockDeficit : 0) + pendingOrderQty;
      // Sevkiyat ve stok erime hızına göre 7 günlük tüketim tamponu ekle
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
        // Durgun ve siparişi yoksa aciliyeti düşür (gereksiz stok birikmesin)
        urgencyScore = Math.max(5, urgencyScore - 40);
      }
    }

    const moldKey = `${p.product_type || 'Genel'}_${p.thickness || 'Standart'}`.toLowerCase();

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
      closestDueDate,
      velocity: vel,
    };
  });

  // Only keep demands that have positive need
  const neededDemands = demands.filter(d => d.totalNetNeed > 0);

  // Group by moldKey to minimize changeover
  const moldGroups: Record<string, ProductDemand[]> = {};
  neededDemands.forEach(d => {
    if (!moldGroups[d.moldKey]) moldGroups[d.moldKey] = [];
    moldGroups[d.moldKey].push(d);
  });

  // Sort groups by maximum urgency score in group
  const sortedMoldKeys = Object.keys(moldGroups).sort((a, b) => {
    const maxA = Math.max(...moldGroups[a].map(d => d.urgencyScore));
    const maxB = Math.max(...moldGroups[b].map(d => d.urgencyScore));
    return maxB - maxA;
  });

  // 2. Setup Machines and Capacities (Günlük 10 Saatlik Çalışma)
  const m1Def = (machines || []).find(m => String(m.machine_no) === '1') || {
    machine_no: '1',
    name: '1 Nolu Parke Baskı Makinesi',
    daily_capacity_m2: 1000,
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

  // 3. Date & Shift Grid Generation (Pazar Günleri Tatil Kontrolü)
  const shifts: ('Gündüz' | 'Gece')[] = options.shiftsPerDay === 2 ? ['Gündüz', 'Gece'] : ['Gündüz'];
  const planItems: Omit<ProductionPlanItem, 'id' | 'plan_id'>[] = [];

  // Working queue of items to produce: { product, remainingQty, moldKey, urgency, ... }
  const queue: {
    product: Product;
    remainingQty: number;
    moldKey: string;
    urgency: string;
    orderId?: string;
    quotaId?: string;
  }[] = [];

  sortedMoldKeys.forEach(mKey => {
    (moldGroups[mKey] || []).forEach(d => {
      // Check if linked to order
      const relatedOrder = (orders || []).find(o => o && o.product_id === d.product.id && o.status === 'pending');
      const relatedQuota = (quotas || []).find(q => q && q.product_id === d.product.id && q.is_active);
      queue.push({
        product: d.product,
        remainingQty: d.totalNetNeed,
        moldKey: d.moldKey,
        urgency: d.urgency,
        orderId: relatedOrder?.id,
        quotaId: relatedQuota?.id,
      });
    });
  });

  // Build calendar dates (Check Sundays)
  const workingDates: string[] = [];
  const sundayDates: string[] = [];
  const startObj = parseSafeDate(options.startDate);
  const daysCount = Math.max(1, Number(options.daysCount) || 7);
  for (let i = 0; i < daysCount; i++) {
    const cur = new Date(startObj);
    cur.setDate(cur.getDate() + i);
    const dateStr = formatSafeISODate(cur);
    const isSunday = cur.getDay() === 0; // 0 = Pazar

    if (isSunday && options.excludeSundays) {
      sundayDates.push(dateStr);
    } else {
      workingDates.push(dateStr);
    }
  }

  // Machine state tracker
  const machineState: Record<string, { currentMold: string | null; totalM2: number; busyDays: Set<string> }> = {
    '1': { currentMold: null, totalM2: 0, busyDays: new Set() },
    '2': { currentMold: null, totalM2: 0, busyDays: new Set() },
  };

  let moldChangesSaved = 0;
  let criticalDeficitsCovered = 0;
  const reasoning: string[] = [];
  const criticalAlerts: string[] = [];
  const recommendations: string[] = [];

  // Prefer machine assignment based on product type
  const isM2Preferred = (productType: string) => {
    const pt = (productType || '').toLowerCase();
    return pt.includes('bordür') || pt.includes('oluk') || pt.includes('tretuar') || pt.includes('begonit');
  };

  // Helper for product-specific daily capacity
  const getProductCap = (machDef?: MachineDefinition, prod?: Product) => {
    if (!machDef || !prod) return 1000;
    if (machDef.product_capacities && prod.id && machDef.product_capacities[prod.id] !== undefined) {
      const val = Number(machDef.product_capacities[prod.id]);
      if (val > 0) return val;
    }
    return Math.max(100, Math.round(Number(machDef.daily_capacity_m2 || 1000)));
  };

  let productCustomCapacityUsage = 0;

  function allocateForMachine(
    machineNo: '1' | '2',
    dateStr: string,
    shift: 'Gündüz' | 'Gece'
  ) {
    if (queue.length === 0) return;

    const mDef = machineNo === '1' ? m1Def : m2Def;
    const otherDef = machineNo === '1' ? m2Def : m1Def;

    // Find best queue item for this machine:
    // 1) Match current mold on this machine if possible
    // 2) Or match product with custom capacity defined on this machine
    // 3) Or match specialized type
    // 4) Or highest urgency
    let chosenIdx = -1;
    const currentMold = machineState[machineNo]?.currentMold;

    if (options.strategy === 'minimize_mold_change' && currentMold) {
      chosenIdx = queue.findIndex(q => q.moldKey === currentMold && q.remainingQty > 0);
      if (chosenIdx !== -1) {
        moldChangesSaved++;
      }
    }

    // Check if item has specific capacity configured on this machine
    if (chosenIdx === -1) {
      chosenIdx = queue.findIndex(q => {
        if (q.remainingQty <= 0) return false;
        const hasThis = !!(mDef?.product_capacities && mDef.product_capacities[q.product?.id]);
        const hasOther = !!(otherDef?.product_capacities && otherDef.product_capacities[q.product?.id]);
        return hasThis && !hasOther;
      });
    }

    // If no specific match, find specialization preference
    if (chosenIdx === -1) {
      chosenIdx = queue.findIndex(q => {
        if (q.remainingQty <= 0) return false;
        const prefM2 = isM2Preferred(q.product?.product_type);
        return machineNo === '2' ? prefM2 : !prefM2;
      });
    }

    // If still none, take the first available in queue
    if (chosenIdx === -1) {
      chosenIdx = queue.findIndex(q => q.remainingQty > 0);
    }

    if (chosenIdx === -1) return;

    const item = queue[chosenIdx];
    const effectiveCapacity = getProductCap(mDef, item.product);

    if (mDef?.product_capacities && mDef.product_capacities[item.product?.id]) {
      productCustomCapacityUsage++;
    }

    const qtyToProduce = Math.min(item.remainingQty, effectiveCapacity);
    if (qtyToProduce <= 0 || isNaN(qtyToProduce)) return;

    item.remainingQty -= qtyToProduce;
    machineState[machineNo].currentMold = item.moldKey;
    machineState[machineNo].totalM2 += qtyToProduce;
    machineState[machineNo].busyDays.add(dateStr);

    if (item.urgency === 'critical') {
      criticalDeficitsCovered++;
    }

    const pallets = item.product?.m2_per_pallet && item.product.m2_per_pallet > 0
      ? Math.round((qtyToProduce / item.product.m2_per_pallet) * 10) / 10
      : 0;

    const capStr = (Number(effectiveCapacity) || 1000).toLocaleString('tr-TR');
    const unitStr = item.product?.unit || 'm²';
    const prodName = item.product?.name || 'Ürün';
    const thickStr = item.product?.thickness || 'Standart';
    const colorStr = item.product?.color || 'Gri';

    planItems.push({
      machine_no: machineNo,
      planned_date: dateStr,
      shift,
      product_id: item.product.id,
      order_id: item.orderId || null,
      quota_id: item.quotaId || null,
      planned_m2: qtyToProduce,
      planned_pallets: pallets,
      produced_m2: 0,
      status: 'scheduled',
      sequence_order: planItems.length + 1,
      notes: `${prodName} (${thickStr}/${colorStr}) — ${shift} (Kapasite: ${capStr} ${unitStr}/10s)`,
      products: item.product,
    });
  }

  // 4. Fill Slots Day by Day (Sadece Çalışma Günleri - Pazarlar Hariç)
  workingDates.forEach(dateStr => {
    shifts.forEach(shift => {
      // Allocate for Machine 1
      allocateForMachine('1', dateStr, shift);

      // Allocate for Machine 2
      allocateForMachine('2', dateStr, shift);
    });
  });

  // 5. Build Comprehensive Reasoning Report
  const totalPlannedM2 = (machineState['1']?.totalM2 || 0) + (machineState['2']?.totalM2 || 0);

  // Alerts
  neededDemands.forEach(d => {
    const pName = d.product?.name || 'Ürün';
    const pUnit = d.product?.unit || 'm²';
    if (d.currentStock <= 0) {
      criticalAlerts.push(`🚨 ${pName}: Stok tamamen tükenmiş durumda (Mevcut: 0 ${pUnit}). Acil ilk vardiyalara alındı.`);
    } else if (d.currentStock < d.minStockAlert) {
      criticalAlerts.push(`⚠️ ${pName}: Emniyet stoğu (${d.minStockAlert}) altına düşmüş (Kalan: ${d.currentStock} ${pUnit}).`);
    }
    if (d.closestDueDate) {
      const parsedDue = parseSafeDate(d.closestDueDate);
      criticalAlerts.push(`📅 ${pName}: Sipariş teslim tarihi yaklaşıyor (${parsedDue.toLocaleDateString('tr-TR')}).`);
    }
  });

  // Reasoning
  reasoning.push(`📅 Çalışma Takvimi: Günlük 10 saat çalışma esasına göre planlandı. Toplam ${workingDates.length} iş günü planlandı (${sundayDates.length} Pazar günü fabrika tatili olarak ayrıldı).`);
  reasoning.push(`Makine 1 (Hat 1) üzerine toplam ${(machineState['1']?.totalM2 || 0).toLocaleString('tr-TR')} m² parke taşı üretimi planlandı (${machineState['1']?.busyDays.size || 0} çalışma günü).`);
  reasoning.push(`Makine 2 (Hat 2) üzerine toplam ${(machineState['2']?.totalM2 || 0).toLocaleString('tr-TR')} m² bordür ve ikincil taş üretimi planlandı (${machineState['2']?.busyDays.size || 0} çalışma günü).`);
  
  if (moldChangesSaved > 0) {
    reasoning.push(`Kalıp optimizasyonu sayesinde aynı kalıp tipindeki ürünler peş peşe kümelenerek yaklaşık ${moldChangesSaved} gereksiz kalıp söküm-takım işleminden tasarruf edildi.`);
  }

  if (productCustomCapacityUsage > 0) {
    reasoning.push(`🎯 Ürün Bazlı Özel Kapasiteler: ${productCustomCapacityUsage} adet iş emri, makineler için tanımlanan ürüne özel günlük baskı kapasitelerine göre hassas olarak planlandı.`);
  }

  if (options.excludedProductIds && options.excludedProductIds.length > 0) {
    reasoning.push(`🚫 Hariç Tutulan Ürünler: ${options.excludedProductIds.length} ürün kullanıcının tercihi doğrultusunda üretim planı dışı bırakıldı.`);
  }

  if (options.onlyWithOrders) {
    reasoning.push(`📦 Sipariş Filtresi: Yalnızca kesin müşteri siparişi olan ürünler planlandı; siparişsiz emniyet stoğu üretimi yapılmadı.`);
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

    const stagnantItems = velList.filter(v => v.velocityCategory === 'stagnant');
    if (stagnantItems.length > 0) {
      reasoning.push(`💤 Sevkiyat Hareketi Durgun Ürünler: ${stagnantItems.length} kalemin son 30 günde sevkiyatı bulunmadığı için siparişsiz gereksiz stok birikiminden kaçınıldı.`);
    }
  }

  if (options.shiftsPerDay === 1) {
    recommendations.push(`Günlük 10 saatlik tek vardiya çalışma düzeni devrede (Pazar günleri tatil). Acil terminler için fazla mesai veya 2. vardiya açılabilir.`);
  } else {
    recommendations.push(`Çift vardiya (10 + 10 Saat) çalışma düzeni ile günlük üretim kapasitesi 2 katına çıkarıldı.`);
  }

  if (planItems.length === 0) {
    reasoning.push('ℹ️ Bilgi: Seçilen kriterlere göre şu anda acil üretim ihtiyacı bulunmuyor. Tüm ürünlerin stokları emniyet seviyelerinin üzerinde ve bekleyen sipariş bulunmuyor.');
    recommendations.push('Dilerseniz "Sadece Kesin Siparişi Olan Ürünleri Planla" filtresini kaldırabilir veya planlama süresini uzatarak ön stok üretimi planlayabilirsiniz.');
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
      criticalDeficitsCovered,
      reasoning,
      criticalAlerts,
      recommendations,
    },
  };
}
