import { Product, MachineDefinition, ProductionOrder, CustomerQuota, ProductionPlanItem } from '../types';

export interface PlanningOptions {
  startDate: string;
  daysCount: number;
  dailyWorkingHours: number; // default: 10
  shiftsPerDay: 1 | 2; // 1 = 10 saat normal vardiya, 2 = 10+10 saat çift vardiya
  excludeSundays: boolean; // default: true (Pazarları tatil)
  strategy: 'balanced' | 'minimize_mold_change' | 'urgent_first';
  includeMinStockDeficit: boolean;
  includeQuotaDemand: boolean;
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
  const activeProducts = products.filter(p => p.is_active);

  // 1. Calculate Demands & Urgency
  const demands: ProductDemand[] = activeProducts.map(p => {
    const currentStock = stockMap[p.id] || 0;
    const minStockAlert = p.min_stock_alert || 0;
    const stockDeficit = currentStock < minStockAlert ? minStockAlert - currentStock : 0;

    // Filter pending orders for this product
    const prodOrders = orders.filter(o => o.product_id === p.id && (o.status === 'pending' || o.status === 'planned'));
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
      const prodQuotas = quotas.filter(q => q.product_id === p.id && q.is_active);
      quotaDemandQty = prodQuotas.reduce((sum, q) => {
        const target = Number(q.target_quantity || 0);
        const shipped = Number(q.shipped_quantity || 0);
        return sum + Math.max(0, target - shipped);
      }, 0);
    }

    const netNeed = (options.includeMinStockDeficit ? stockDeficit : 0) + pendingOrderQty;
    const totalNetNeed = Math.max(0, netNeed > 0 ? netNeed : (quotaDemandQty > 0 ? Math.min(quotaDemandQty, 2000) : 0));

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
  const m1Def = machines.find(m => m.machine_no === '1') || {
    machine_no: '1',
    name: '1 Nolu Parke Baskı Makinesi',
    daily_capacity_m2: 1000,
    shift_count: options.shiftsPerDay,
    specialized_types: ['Kilitli', 'Aşık', 'Prizma', 'Küp Taşı'],
    is_active: true,
  };

  const m2Def = machines.find(m => m.machine_no === '2') || {
    machine_no: '2',
    name: '2 Nolu Parke & Bordür Makinesi',
    daily_capacity_m2: 1000,
    shift_count: options.shiftsPerDay,
    specialized_types: ['Bordür', 'Oluk', 'Begonit', 'Tretuar'],
    is_active: true,
  };

  // 10 saatlik vardiya kapasitesi
  const shiftCapM1 = Math.round(Number(m1Def.daily_capacity_m2 || 1000));
  const shiftCapM2 = Math.round(Number(m2Def.daily_capacity_m2 || 1000));

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
    moldGroups[mKey].forEach(d => {
      // Check if linked to order
      const relatedOrder = orders.find(o => o.product_id === d.product.id && o.status === 'pending');
      const relatedQuota = quotas.find(q => q.product_id === d.product.id && q.is_active);
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
  const startObj = new Date(options.startDate);
  for (let i = 0; i < options.daysCount; i++) {
    const cur = new Date(startObj);
    cur.setDate(cur.getDate() + i);
    const dateStr = cur.toISOString().split('T')[0];
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

  // 4. Fill Slots Day by Day (Sadece Çalışma Günleri - Pazarlar Hariç)
  workingDates.forEach(dateStr => {
    shifts.forEach(shift => {
      // Allocate for Machine 1
      const slotCap1 = shiftCapM1;
      allocateForMachine('1', slotCap1, dateStr, shift);

      // Allocate for Machine 2
      const slotCap2 = shiftCapM2;
      allocateForMachine('2', slotCap2, dateStr, shift);
    });
  });

  function allocateForMachine(
    machineNo: '1' | '2',
    capacity: number,
    dateStr: string,
    shift: 'Gündüz' | 'Gece'
  ) {
    if (queue.length === 0) return;

    // Find best queue item for this machine:
    // 1) Match current mold on this machine if possible
    // 2) Or match specialized type
    // 3) Or highest urgency
    let chosenIdx = -1;
    const currentMold = machineState[machineNo].currentMold;

    if (options.strategy === 'minimize_mold_change' && currentMold) {
      chosenIdx = queue.findIndex(q => q.moldKey === currentMold && q.remainingQty > 0);
      if (chosenIdx !== -1) {
        moldChangesSaved++;
      }
    }

    // If no current mold match, find specialization preference
    if (chosenIdx === -1) {
      chosenIdx = queue.findIndex(q => {
        if (q.remainingQty <= 0) return false;
        const prefM2 = isM2Preferred(q.product.product_type);
        return machineNo === '2' ? prefM2 : !prefM2;
      });
    }

    // If still none, take the first available in queue
    if (chosenIdx === -1) {
      chosenIdx = queue.findIndex(q => q.remainingQty > 0);
    }

    if (chosenIdx === -1) return;

    const item = queue[chosenIdx];
    const qtyToProduce = Math.min(item.remainingQty, capacity);

    item.remainingQty -= qtyToProduce;
    machineState[machineNo].currentMold = item.moldKey;
    machineState[machineNo].totalM2 += qtyToProduce;
    machineState[machineNo].busyDays.add(dateStr);

    if (item.urgency === 'critical') {
      criticalDeficitsCovered++;
    }

    const pallets = item.product.m2_per_pallet > 0
      ? Math.round((qtyToProduce / item.product.m2_per_pallet) * 10) / 10
      : 0;

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
      notes: `${item.product.name} (${item.product.thickness || '6cm'}/${item.product.color || 'Gri'}) — ${shift} (10 Saat)`,
      products: item.product,
    });
  }

  // 5. Build Comprehensive Reasoning Report
  const totalPlannedM2 = machineState['1'].totalM2 + machineState['2'].totalM2;

  // Alerts
  neededDemands.forEach(d => {
    if (d.currentStock <= 0) {
      criticalAlerts.push(`🚨 ${d.product.name}: Stok tamamen tükenmiş durumda (Mevcut: 0 ${d.product.unit || 'm²'}). Acil ilk vardiyalara alındı.`);
    } else if (d.currentStock < d.minStockAlert) {
      criticalAlerts.push(`⚠️ ${d.product.name}: Emniyet stoğu (${d.minStockAlert}) altına düşmüş (Kalan: ${d.currentStock}).`);
    }
    if (d.closestDueDate) {
      criticalAlerts.push(`📅 ${d.product.name}: Sipariş teslim tarihi yaklaşıyor (${new Date(d.closestDueDate).toLocaleDateString('tr-TR')}).`);
    }
  });

  // Reasoning
  reasoning.push(`📅 Çalışma Takvimi: Günlük 10 saat çalışma esasına göre planlandı. Toplam ${workingDates.length} iş günü planlandı (${sundayDates.length} Pazar günü fabrika tatili olarak ayrıldı).`);
  reasoning.push(`Makine 1 (Hat 1) üzerine toplam ${machineState['1'].totalM2.toLocaleString('tr-TR')} m² parke taşı üretimi planlandı (${machineState['1'].busyDays.size} çalışma günü).`);
  reasoning.push(`Makine 2 (Hat 2) üzerine toplam ${machineState['2'].totalM2.toLocaleString('tr-TR')} m² bordür ve ikincil taş üretimi planlandı (${machineState['2'].busyDays.size} çalışma günü).`);
  
  if (moldChangesSaved > 0) {
    reasoning.push(`Kalıp optimizasyonu sayesinde aynı kalıp tipindeki ürünler peş peşe kümelenerek yaklaşık ${moldChangesSaved} gereksiz kalıp söküm-takım işleminden tasarruf edildi.`);
  }

  if (options.shiftsPerDay === 1) {
    recommendations.push(`Günlük 10 saatlik tek vardiya çalışma düzeni devrede (Pazar günleri tatil). Acil terminler için fazla mesai veya 2. vardiya açılabilir.`);
  } else {
    recommendations.push(`Çift vardiya (10 + 10 Saat) çalışma düzeni ile günlük üretim kapasitesi 2 katına çıkarıldı.`);
  }

  const endDate = (workingDates.length > 0 ? workingDates[workingDates.length - 1] : options.startDate);
  const startFormatted = new Date(options.startDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const endFormatted = new Date(endDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  const planName = `${startFormatted} – ${endFormatted} Üretim Planı (10s/Gün)`;

  return {
    planName,
    startDate: options.startDate,
    endDate,
    items: planItems,
    demands,
    summary: {
      totalPlannedM2,
      machine1M2: machineState['1'].totalM2,
      machine2M2: machineState['2'].totalM2,
      machine1Days: machineState['1'].busyDays.size,
      machine2Days: machineState['2'].busyDays.size,
      moldChangesSaved,
      criticalDeficitsCovered,
      reasoning,
      criticalAlerts,
      recommendations,
    },
  };
}
