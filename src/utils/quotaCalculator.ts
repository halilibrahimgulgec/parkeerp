import { Product } from '../types';

export interface CalculatedQuotaItem {
  id: string;
  customer_id: string;
  customer_name: string;
  site_id?: string | null;
  site_name?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  target_quantity: number;
  shipped_quantity: number;
  remaining_quantity: number; // Kalan açık sipariş miktarı (asla eksiye düşmez: Math.max(0, target - shipped))
  net_balance: number; // Ham bakiye: target - shipped (fazla sevk varsa negatiftir)
  completion_pct: number;
  unit: string;
  unit_price: number;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean;
  status: 'completed' | 'in_progress' | 'pending';
  isExceeded: boolean;
  isApproaching: boolean;
  alert_threshold_pct: number;
}

export interface QuotaMetric {
  productId?: string;
  productName?: string;
  target: number;
  shipped: number;
  remaining: number;
  unit: string;
}

export interface CustomerQuotaSummary {
  hasQuota: boolean;
  totalTarget: number;
  totalShipped: number;
  totalRemaining: number;
  netBalance: number;
  completionPct: number;
  productQuotas: Record<string, QuotaMetric>;
  hasUnassignedProductQuota: boolean;
  unassignedTarget?: number;
  unassignedShipped?: number;
  unassignedQuota?: number;
  unassignedRemaining: number;
  items: CalculatedQuotaItem[];
}

export interface SiteQuotaSummary {
  hasQuota: boolean;
  totalTarget: number;
  totalShipped: number;
  totalRemaining: number;
  netBalance: number;
  completionPct: number;
  productQuotas: Record<string, QuotaMetric>;
  items: CalculatedQuotaItem[];
}

export interface FactoryOpenOrdersSummary {
  totalTargetM2: number;
  totalShippedM2: number;
  totalRemainingM2: number;
  totalCompletedCount: number;
  totalInProgressCount: number;
  totalPendingCount: number;
  activeCustomerCount: number;
  quotaItems: CalculatedQuotaItem[];
}

/**
 * Bir sevkiyat kaleminin belirli bir müşteri kotasıyla eşleşip eşleşmediğini kontrol eden standart fonksiyon.
 */
export function matchShipmentItemToQuota(
  item: any,
  quota: any,
  productsMap?: Map<string, Product> | Product[]
): boolean {
  const s = item.shipments;
  if (!s) return false;

  // İptal edilen veya henüz tamamlanmamış sevkiyatlar kota düşümüne dahil edilmez
  if (s.status && s.status !== 'completed') return false;

  // 1. Müşteri kontrolü (Zorunlu)
  if (s.customer_id !== quota.customer_id) return false;

  // 2. Şantiye kontrolü (Eğer kotada şantiye belirtilmişse eşleşmeli)
  if (quota.site_id && s.site_id !== quota.site_id) return false;

  // 3. Ürün kontrolü (Eğer kotada ürün belirtilmişse eşleşmeli)
  if (quota.product_id && item.product_id !== quota.product_id) return false;

  // 4. Tarih aralığı kontrolü
  if (quota.start_date && s.shipment_date < quota.start_date) return false;
  if (quota.end_date && s.shipment_date > quota.end_date) return false;

  // 5. Birim kontrolü (Genel ürün belirtilmemiş kotalarda birim eşleşmesi)
  if (!quota.product_id && quota.unit) {
    let itemUnit = item.products?.unit || item.unit || 'm2';
    if (productsMap && !item.products?.unit) {
      const prod = Array.isArray(productsMap)
        ? productsMap.find((p) => p.id === item.product_id)
        : productsMap.get(item.product_id);
      if (prod?.unit) itemUnit = prod.unit;
    }
    const normItemUnit = (itemUnit === 'metre' || itemUnit === 'm') ? 'metre' : (itemUnit === 'adet' || itemUnit === 'ad') ? 'adet' : 'm2';
    const normQuotaUnit = (quota.unit === 'metre' || quota.unit === 'm') ? 'metre' : (quota.unit === 'adet' || quota.unit === 'ad') ? 'adet' : 'm2';
    if (normItemUnit !== normQuotaUnit) return false;
  }

  return true;
}

/**
 * Tüm kotaların sevk, kalan ve tamamlanma metriklerini hesaplayan standart motor.
 */
export function calculateAllQuotas(
  quotas: any[],
  shipmentItems: any[],
  products: Product[] = []
): CalculatedQuotaItem[] {
  const prodMap = new Map(products.map((p) => [p.id, p]));

  return quotas.map((q) => {
    const target = Number(q.target_quantity) || 0;
    const matchingItems = shipmentItems.filter((item) =>
      matchShipmentItemToQuota(item, q, prodMap)
    );

    const shipped = matchingItems.reduce(
      (acc, cur) => acc + (Number(cur.m2) || 0),
      0
    );
    const netBalance = target - shipped;
    const remaining = Math.max(0, netBalance);
    const completionPct =
      target > 0 ? Math.round((shipped / target) * 100) : 0;
    const threshold = Number(q.alert_threshold_pct) || 85;
    const isExceeded = shipped >= target && target > 0;
    const isApproaching = completionPct >= threshold && !isExceeded;

    const status: 'completed' | 'in_progress' | 'pending' =
      remaining === 0 && target > 0
        ? 'completed'
        : shipped > 0
        ? 'in_progress'
        : 'pending';

    const prod = q.product_id ? prodMap.get(q.product_id) : null;

    return {
      ...q,
      id: q.id,
      customer_id: q.customer_id,
      customer_name: q.customers?.name || q.customer_name || 'Müşteri',
      site_id: q.site_id || null,
      site_name: q.sites?.name || q.site_name || null,
      product_id: q.product_id || null,
      product_name: prod ? prod.name : q.products?.name || q.product_name || null,
      target_quantity: target,
      shipped_quantity: shipped,
      remaining_quantity: remaining,
      net_balance: netBalance,
      completion_pct: completionPct,
      unit: prod?.unit || q.unit || 'm²',
      unit_price: Number(q.unit_price) || 0,
      start_date: q.start_date || null,
      end_date: q.end_date || null,
      is_active: q.is_active !== false,
      status,
      isExceeded,
      isApproaching,
      alert_threshold_pct: threshold,
    };
  });
}

/**
 * Müşteri bazında kotaları gruplayıp özetleyen harita (Sevk Matrisi ve Raporlar için).
 */
export function calculateCustomerQuotaMap(
  calculatedQuotas: CalculatedQuotaItem[],
  customerIds: string[]
): Record<string, CustomerQuotaSummary> {
  const map: Record<string, CustomerQuotaSummary> = {};

  customerIds.forEach((custId) => {
    const custQuotas = calculatedQuotas.filter(
      (q) => q.customer_id === custId && q.is_active
    );

    if (custQuotas.length === 0) {
      map[custId] = {
        hasQuota: false,
        totalTarget: 0,
        totalShipped: 0,
        totalRemaining: 0,
        netBalance: 0,
        completionPct: 0,
        productQuotas: {},
        hasUnassignedProductQuota: false,
        unassignedRemaining: 0,
        items: [],
      };
      return;
    }

    let totalTarget = 0;
    let totalShipped = 0;
    let totalRemaining = 0;
    let netBalance = 0;
    let hasUnassigned = false;
    let unassignedTarget = 0;
    let unassignedShipped = 0;
    let unassignedRemaining = 0;
    const productQuotas: Record<string, QuotaMetric> = {};

    custQuotas.forEach((q) => {
      totalTarget += q.target_quantity;
      totalShipped += q.shipped_quantity;
      totalRemaining += q.remaining_quantity;
      netBalance += q.net_balance;

      if (q.product_id) {
        const prev = productQuotas[q.product_id];
        const t = (prev?.target || 0) + q.target_quantity;
        const sh = (prev?.shipped || 0) + q.shipped_quantity;
        productQuotas[q.product_id] = {
          productId: q.product_id,
          productName: q.product_name || prev?.productName || 'Tanımlı Taş',
          target: t,
          shipped: sh,
          remaining: Math.max(0, t - sh),
          unit: q.unit || 'm²',
        };
      } else {
        hasUnassigned = true;
        unassignedTarget += q.target_quantity;
        unassignedShipped += q.shipped_quantity;
        unassignedRemaining += q.remaining_quantity;
      }
    });

    const completionPct =
      totalTarget > 0 ? Math.round((totalShipped / totalTarget) * 100) : 0;

    map[custId] = {
      hasQuota: true,
      totalTarget,
      totalShipped,
      totalRemaining,
      netBalance,
      completionPct,
      productQuotas,
      hasUnassignedProductQuota: hasUnassigned,
      unassignedTarget,
      unassignedShipped,
      unassignedQuota: unassignedTarget,
      unassignedRemaining,
      items: custQuotas,
    };
  });

  return map;
}

/**
 * Şantiye bazında kotaları gruplayıp özetleyen harita (Sevk Matrisi akordeon alt satırları için).
 */
export function calculateSiteQuotaMap(
  calculatedQuotas: CalculatedQuotaItem[],
  customerIds: string[]
): Record<string, Record<string, SiteQuotaSummary>> {
  const map: Record<string, Record<string, SiteQuotaSummary>> = {};

  customerIds.forEach((custId) => {
    map[custId] = {};
    const custQuotas = calculatedQuotas.filter(
      (q) => q.customer_id === custId && q.is_active
    );

    custQuotas.forEach((q) => {
      const siteKey = q.site_id || '__unassigned__';
      if (!map[custId][siteKey]) {
        map[custId][siteKey] = {
          hasQuota: true,
          totalTarget: 0,
          totalShipped: 0,
          totalRemaining: 0,
          netBalance: 0,
          completionPct: 0,
          productQuotas: {},
          items: [],
        };
      }

      const sq = map[custId][siteKey];
      sq.totalTarget += q.target_quantity;
      sq.totalShipped += q.shipped_quantity;
      sq.totalRemaining += q.remaining_quantity;
      sq.netBalance += q.net_balance;
      sq.items.push(q);

      if (q.product_id) {
        const prev = sq.productQuotas[q.product_id];
        const t = (prev?.target || 0) + q.target_quantity;
        const sh = (prev?.shipped || 0) + q.shipped_quantity;
        sq.productQuotas[q.product_id] = {
          productId: q.product_id,
          productName: q.product_name || prev?.productName || 'Tanımlı Taş',
          target: t,
          shipped: sh,
          remaining: Math.max(0, t - sh),
          unit: q.unit || 'm²',
        };
      }
    });

    // Her şantiyenin tamamlanma yüzdesini hesapla
    Object.values(map[custId]).forEach((sq) => {
      sq.completionPct =
        sq.totalTarget > 0 ? Math.round((sq.totalShipped / sq.totalTarget) * 100) : 0;
    });
  });

  return map;
}

/**
 * Fabrika genelindeki tüm aktif açık sipariş ve taahhüt havuzunu hesaplayan tek ve merkezi fonksiyon.
 */
export function calculateFactoryOpenOrders(
  calculatedQuotas: CalculatedQuotaItem[]
): FactoryOpenOrdersSummary {
  const activeQuotas = calculatedQuotas.filter((q) => q.is_active);

  const totalTargetM2 = activeQuotas.reduce(
    (sum, q) => sum + q.target_quantity,
    0
  );
  const totalShippedM2 = activeQuotas.reduce(
    (sum, q) => sum + q.shipped_quantity,
    0
  );
  // Açık Sipariş Bakiyesi: Kalan miktarların toplamı (Math.max(0, target - shipped))
  const totalRemainingM2 = activeQuotas.reduce(
    (sum, q) => sum + q.remaining_quantity,
    0
  );

  const completed = activeQuotas.filter((q) => q.status === 'completed').length;
  const inProgress = activeQuotas.filter((q) => q.status === 'in_progress').length;
  const pending = activeQuotas.filter((q) => q.status === 'pending').length;

  const customerSet = new Set(
    activeQuotas
      .filter((q) => q.remaining_quantity > 0)
      .map((q) => q.customer_id)
  );

  return {
    totalTargetM2,
    totalShippedM2,
    totalRemainingM2,
    totalCompletedCount: completed,
    totalInProgressCount: inProgress,
    totalPendingCount: pending,
    activeCustomerCount: customerSet.size,
    quotaItems: activeQuotas,
  };
}
