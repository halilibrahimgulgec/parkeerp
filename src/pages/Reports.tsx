import { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  BarChart3,
  TrendingUp,
  Package,
  DollarSign,
  Truck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Table,
  Calendar,
  Search,
  X,
  Download,
  CheckCircle2,
  Clock,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import DailyShipmentStockMatrixReport from '../components/DailyShipmentStockMatrixReport';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

interface StockItem {
  product_id: string;
  product_name: string;
  thickness: string;
  color: string;
  unit: string;
  total_produced: number;
  total_shipped: number;
  current_stock: number;
  min_stock_alert: number;
}

interface ProfitItem {
  shipment_id: string;
  invoice_no: string;
  customer_name: string;
  shipment_date: string;
  total_m2: number;
  displayQuantity: string;
  unitLabel: string;
  sale_price_per_m2: number;
  logistics_cost: number;
  revenue: number;
  unit_cost: number;
  total_cost: number;
  profit: number;
  margin_pct: number;
}

interface CostBreakdown {
  hammadde: number;
  operasyonel: number;
  genel: number;
  total: number;
}

interface DailyShipment {
  date: string;
  tonnage: number;
  m2: number;
  metre: number;
  adet: number;
}

export interface QuotaDetailItem {
  id: string;
  customer_id: string;
  customer_name: string;
  site_id?: string | null;
  site_name?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  target_quantity: number;
  shipped_quantity: number;
  remaining_quantity: number;
  unit: string;
  completion_pct: number;
  start_date?: string | null;
  end_date?: string | null;
  status: 'completed' | 'in_progress' | 'pending';
}

function BarChartScrollable({
  data,
  maxVal,
}: {
  data: { label: string; value: number; formattedValue?: string; date: string }[];
  maxVal: number;
  color?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth;
    }
  }, [data]);

  const scrollLeft = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: -220, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: 220, behavior: 'smooth' });
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="relative group select-none">
      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2 px-1">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="hidden sm:inline">↔️ Grafiği sağa/sola kaydırarak tüm günleri görebilirsiniz</span>
          <span className="sm:hidden">↔️ Sağa/sola kaydırın</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={scrollLeft}
            className="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
            title="Sola Kaydır"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={scrollRight}
            className="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
            title="Sağa Kaydır"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="overflow-x-auto pb-3 pt-2 scrollbar-thin scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400 scrollbar-track-transparent overscroll-x-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex items-end gap-2.5 h-48 min-w-max px-1">
          {data.map((d, i) => {
            const height = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
            const isToday = d.date === todayStr;
            const isLatest = i === data.length - 1;
            const isZero = d.value === 0;

            return (
              <div key={d.date || i} className="flex flex-col items-center gap-1 group/bar w-12 sm:w-14">
                <div
                  className={`text-[10px] font-bold text-center px-1 rounded transition-opacity ${
                    isZero ? 'opacity-30 text-slate-400' : 'text-slate-700'
                  }`}
                >
                  {d.formattedValue || d.value}
                </div>

                <div className="w-full flex items-end justify-center h-28 bg-slate-100/60 rounded-t-lg p-0.5">
                  <div
                    className={`w-full rounded-t-md transition-all duration-300 ${
                      isZero
                        ? 'bg-slate-200'
                        : isToday
                        ? 'bg-gradient-to-t from-emerald-600 via-emerald-500 to-teal-400 shadow-emerald-500/20'
                        : isLatest
                        ? 'bg-gradient-to-t from-blue-600 via-blue-500 to-indigo-500 shadow-blue-500/20'
                        : 'bg-gradient-to-t from-blue-500 to-blue-400 group-hover/bar:brightness-110'
                    }`}
                    style={{
                      height: `${Math.max(height, isZero ? 3 : 5)}%`,
                    }}
                    title={`${d.label}: ${d.formattedValue || d.value}`}
                  />
                </div>

                <div className="text-center mt-1">
                  <span
                    className={`text-[11px] font-semibold block leading-none ${
                      isToday || isLatest ? 'text-blue-700 font-bold' : 'text-slate-600'
                    }`}
                  >
                    {d.label}
                  </span>
                  {isToday ? (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1 rounded-sm uppercase tracking-tighter block mt-0.5">
                      Bugün
                    </span>
                  ) : isLatest ? (
                    <span className="text-[9px] font-bold text-blue-600 bg-blue-100 px-1 rounded-sm uppercase tracking-tighter block mt-0.5">
                      Son
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DonutChart({ slices }: { slices: { value: number; color: string; label: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <div className="flex items-center justify-center h-36 text-slate-400 text-sm">Veri yok</div>;

  let cumulative = 0;
  const paths = slices.map((slice) => {
    const pct = slice.value / total;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const endAngle = (cumulative + pct) * 2 * Math.PI - Math.PI / 2;
    cumulative += pct;
    const r = 60,
      cx = 70,
      cy = 70;
    const x1 = cx + r * Math.cos(startAngle),
      y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle),
      y2 = cy + r * Math.sin(endAngle);
    return { ...slice, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`, pct };
  });

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="w-32 h-32 flex-shrink-0">
        {paths.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2" />
        ))}
        <circle cx="70" cy="70" r="30" fill="white" />
      </svg>
      <div className="space-y-2 flex-1">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-slate-600">{s.label}</span>
            </div>
            <div className="text-right">
              <div className="font-semibold text-slate-900">{((s.value / total) * 100).toFixed(1)}%</div>
              <div className="text-xs text-slate-400">₺{s.value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Reports() {
  const [activeReportTab, setActiveReportTab] = useState<'factory' | 'matrix'>('factory');
  const [periodPreset, setPeriodPreset] = useState<'today' | 'week' | 'month' | 'custom_month'>('month');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [profitItems, setProfitItems] = useState<ProfitItem[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown>({ hammadde: 0, operasyonel: 0, genel: 0, total: 0 });
  const [dailyShipments, setDailyShipments] = useState<DailyShipment[]>([]);
  const [unitCost, setUnitCost] = useState(0);
  const [shipmentUnit, setShipmentUnit] = useState<'m2' | 'metre' | 'adet' | 'ton'>('m2');
  const [shipmentDaysRange, setShipmentDaysRange] = useState<number>(15);
  const [loading, setLoading] = useState(true);

  // Production and Shipment Metrics
  const [productionMetrics, setProductionMetrics] = useState({ totalM2: 0, totalMetre: 0, totalAdet: 0 });
  const [shipmentMetrics, setShipmentMetrics] = useState({ totalM2: 0, totalMetre: 0, totalAdet: 0, totalTonnage: 0, shipmentCount: 0 });

  // Customer Quotas & Open Balance
  const [quotas, setQuotas] = useState<QuotaDetailItem[]>([]);
  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [quotaSearch, setQuotaSearch] = useState('');
  const [quotaStatusFilter, setQuotaStatusFilter] = useState<'all' | 'open' | 'completed'>('all');

  // Active Date Range based on Preset
  const activeDateRange = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (periodPreset === 'today') {
      return { start: todayStr, end: todayStr, label: 'Bugün' };
    }

    if (periodPreset === 'week') {
      const day = today.getDay();
      const diff = day === 0 ? -6 : 1 - day; // Monday
      const monday = new Date(today);
      monday.setDate(today.getDate() + diff);
      const mondayStr = monday.toISOString().split('T')[0];
      return { start: mondayStr, end: todayStr, label: 'Bu Hafta' };
    }

    if (periodPreset === 'custom_month') {
      const start = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const end = new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0];
      return { start, end, label: `${MONTHS[selectedMonth - 1]} ${selectedYear}` };
    }

    // Default: 'month' (current month)
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const start = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const end = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
    return { start, end, label: `${MONTHS[currentMonth - 1]} ${currentYear}` };
  }, [periodPreset, selectedYear, selectedMonth]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const startDate = activeDateRange.start;
      const endDate = activeDateRange.end;

      // Cost month/year derived from endDate
      const endDateObj = new Date(endDate);
      const costYear = endDateObj.getFullYear();
      const costMonth = endDateObj.getMonth() + 1;

      try {
        const [prodMonthRes, shipMonthRes, stocksRes, costsRes, shipmentsRes, quotasRes, allShipmentItemsRes] = await Promise.all([
          supabase
            .from('production_entries')
            .select('product_id, net_m2, date, products(unit)')
            .gte('date', startDate)
            .lte('date', endDate),
          supabase
            .from('shipment_items')
            .select('product_id, m2, unit, products(unit), shipments!inner(id, customer_id, site_id, shipment_date, status)')
            .eq('shipments.status', 'completed')
            .gte('shipments.shipment_date', startDate)
            .lte('shipments.shipment_date', endDate),
          supabase.from('v_product_stock').select('*'),
          supabase
            .from('cost_entries')
            .select('cost_type, total_amount')
            .eq('period_month', costMonth)
            .eq('period_year', costYear),
          supabase
            .from('shipments')
            .select('*, customers(name), sites(name), shipment_items(*, products(*))')
            .gte('shipment_date', startDate)
            .lte('shipment_date', endDate)
            .eq('status', 'completed'),
          supabase
            .from('customer_quotas')
            .select('*, customers(name), sites(name), products(name, unit)')
            .eq('is_active', true),
          supabase
            .from('shipment_items')
            .select('id, product_id, m2, unit, shipments!inner(id, customer_id, site_id, shipment_date, status)')
            .eq('shipments.status', 'completed'),
        ]);

        // 1. Production Metrics
        let pM2 = 0;
        let pMetre = 0;
        let pAdet = 0;
        const productMap: Record<string, number> = {};
        (prodMonthRes.data || []).forEach((r: any) => {
          const qty = Number(r.net_m2) || 0;
          productMap[r.product_id] = (productMap[r.product_id] || 0) + qty;
          const u = r.products?.unit;
          if (u === 'metre') pMetre += qty;
          else if (u === 'adet') pAdet += qty;
          else pM2 += qty;
        });
        setProductionMetrics({ totalM2: pM2, totalMetre: pMetre, totalAdet: pAdet });

        // 2. Shipment Items Map for Stock Table
        const shipMap: Record<string, number> = {};
        let sM2 = 0;
        let sMetre = 0;
        let sAdet = 0;
        (shipMonthRes.data || []).forEach((r: any) => {
          const qty = Number(r.m2) || 0;
          shipMap[r.product_id] = (shipMap[r.product_id] || 0) + qty;
          const prodUnit = r.products?.unit;
          const u = prodUnit === 'metre' || r.unit === 'metre' ? 'metre' : prodUnit === 'adet' || r.unit === 'adet' ? 'adet' : 'm2';
          if (u === 'metre') sMetre += qty;
          else if (u === 'adet') sAdet += qty;
          else sM2 += qty;
        });

        // 3. Stock Items
        const stockItems: StockItem[] = (stocksRes.data || []).map((p: any) => ({
          product_id: p.product_id,
          product_name: p.product_name,
          thickness: p.thickness,
          color: p.color,
          unit: p.unit || 'm2',
          total_produced: productMap[p.product_id] || 0,
          total_shipped: shipMap[p.product_id] || 0,
          current_stock: p.current_stock || 0,
          min_stock_alert: p.min_stock_alert,
        }));
        setStocks(stockItems);

        // 4. Costs
        const costs = costsRes.data || [];
        const cd: CostBreakdown = { hammadde: 0, operasyonel: 0, genel: 0, total: 0 };
        costs.forEach((c) => {
          cd[c.cost_type as keyof CostBreakdown] += c.total_amount;
          cd.total += c.total_amount;
        });
        setCostBreakdown(cd);

        const uc = pM2 > 0 ? cd.total / pM2 : 0;
        setUnitCost(uc);

        // 5. Profit Items & Shipments
        const shipData = shipmentsRes.data || [];
        let sTonnage = 0;
        const profItems: ProfitItem[] = (shipData as any[]).map((s) => {
          sTonnage += (s.net_weight || 0) / 1000;
          const items = s.shipment_items || [];
          let itemM2 = 0;
          let itemMetre = 0;
          let itemAdet = 0;
          items.forEach((it: any) => {
            const u =
              it.products?.unit === 'metre' || it.unit === 'metre'
                ? 'metre'
                : it.products?.unit === 'adet' || it.unit === 'adet'
                ? 'adet'
                : 'm2';
            const qty = Number(it.m2) || 0;
            if (u === 'metre') itemMetre += qty;
            else if (u === 'adet') itemAdet += qty;
            else itemM2 += qty;
          });

          const badges: string[] = [];
          if (itemM2 > 0) badges.push(`${itemM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`);
          if (itemMetre > 0) badges.push(`${itemMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre`);
          if (itemAdet > 0) badges.push(`${itemAdet.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} Adet`);
          const displayQuantity = badges.length > 0 ? badges.join(' + ') : `${(s.total_m2 || 0).toLocaleString('tr-TR')} m²`;
          const unitLabel = itemMetre > 0 && itemM2 === 0 ? 'm' : itemAdet > 0 && itemM2 === 0 ? 'adet' : 'm²';

          const revenue = s.sale_price_per_m2 * s.total_m2;
          const totalCost = uc * s.total_m2 + (s.logistics_cost || 0);
          const profit = revenue - totalCost;
          const margin_pct = revenue > 0 ? (profit / revenue) * 100 : 0;
          return {
            shipment_id: s.id,
            invoice_no: s.invoice_no,
            customer_name: s.customers?.name || '-',
            shipment_date: s.shipment_date,
            total_m2: s.total_m2,
            displayQuantity,
            unitLabel,
            sale_price_per_m2: s.sale_price_per_m2,
            logistics_cost: s.logistics_cost || 0,
            revenue,
            unit_cost: uc,
            total_cost: totalCost,
            profit,
            margin_pct,
          };
        });
        setProfitItems(profItems);

        setShipmentMetrics({
          totalM2: sM2,
          totalMetre: sMetre,
          totalAdet: sAdet,
          totalTonnage: sTonnage,
          shipmentCount: shipData.length,
        });

        // 6. Daily Shipments for Chart
        const dailyMap: Record<string, { tonnage: number; m2: number; metre: number; adet: number }> = {};
        (shipData as any[]).forEach((s) => {
          const d = s.shipment_date;
          if (!dailyMap[d]) dailyMap[d] = { tonnage: 0, m2: 0, metre: 0, adet: 0 };
          dailyMap[d].tonnage += (s.net_weight || 0) / 1000;
        });

        (shipMonthRes.data || []).forEach((item: any) => {
          const d = item.shipments?.shipment_date;
          if (!d) return;
          if (!dailyMap[d]) dailyMap[d] = { tonnage: 0, m2: 0, metre: 0, adet: 0 };
          const prodUnit = item.products?.unit;
          const u =
            prodUnit === 'metre' || item.unit === 'metre'
              ? 'metre'
              : prodUnit === 'adet' || item.unit === 'adet'
              ? 'adet'
              : item.unit || 'm2';
          const qty = Number(item.m2) || 0;
          if (u === 'metre') dailyMap[d].metre += qty;
          else if (u === 'adet') dailyMap[d].adet += qty;
          else dailyMap[d].m2 += qty;
        });

        const dailyArr = Object.entries(dailyMap)
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => a.date.localeCompare(b.date));
        setDailyShipments(dailyArr);

        // 7. Customer Quotas & Open Balance Calculations
        const activeQuotas = quotasRes.data || [];
        const allItems = allShipmentItemsRes.data || [];

        const quotaList: QuotaDetailItem[] = activeQuotas.map((q: any) => {
          const target = Number(q.target_quantity) || 0;
          const matching = allItems.filter((item: any) => {
            const s = item.shipments;
            if (!s) return false;
            if (s.customer_id !== q.customer_id) return false;
            if (q.site_id && s.site_id !== q.site_id) return false;
            if (q.product_id && item.product_id !== q.product_id) return false;
            if (q.start_date && s.shipment_date < q.start_date) return false;
            if (q.end_date && s.shipment_date > q.end_date) return false;
            return true;
          });

          const shipped = matching.reduce((acc: number, cur: any) => acc + (Number(cur.m2) || 0), 0);
          const remaining = Math.max(0, target - shipped);
          const completionPct = target > 0 ? Math.min(100, Math.round((shipped / target) * 100)) : 100;
          const status: 'completed' | 'in_progress' | 'pending' =
            remaining <= 0 ? 'completed' : shipped > 0 ? 'in_progress' : 'pending';

          return {
            id: q.id,
            customer_id: q.customer_id,
            customer_name: q.customers?.name || 'Bilinmeyen Müşteri',
            site_id: q.site_id,
            site_name: q.sites?.name || null,
            product_id: q.product_id,
            product_name: q.products?.name || null,
            target_quantity: target,
            shipped_quantity: shipped,
            remaining_quantity: remaining,
            unit: q.unit || 'm²',
            completion_pct: completionPct,
            start_date: q.start_date,
            end_date: q.end_date,
            status,
          };
        });

        setQuotas(quotaList);
      } catch (err) {
        console.error('Rapor yükleme hatası:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activeDateRange]);

  const displayedDailyShipments = shipmentDaysRange === 0 ? dailyShipments : dailyShipments.slice(-shipmentDaysRange);

  const totalRevenue = profitItems.reduce((s, p) => s + p.revenue, 0);
  const totalProfit = profitItems.reduce((s, p) => s + p.profit, 0);
  const avgMargin = profitItems.length > 0 ? profitItems.reduce((s, p) => s + p.margin_pct, 0) / profitItems.length : 0;
  const lowStocks = stocks.filter((s) => s.current_stock <= s.min_stock_alert);

  const maxDailyTonnage = Math.max(...displayedDailyShipments.map((d) => d.tonnage), 1);
  const maxDailyM2 = Math.max(...displayedDailyShipments.map((d) => d.m2), 1);
  const maxDailyMetre = Math.max(...displayedDailyShipments.map((d) => d.metre), 1);
  const maxDailyAdet = Math.max(...displayedDailyShipments.map((d) => d.adet), 1);

  const totalStockM2 = stocks.filter((s) => (s.unit || 'm2') === 'm2').reduce((acc, s) => acc + s.current_stock, 0);
  const totalStockMetre = stocks.filter((s) => s.unit === 'metre').reduce((acc, s) => acc + s.current_stock, 0);
  const totalStockAdet = stocks.filter((s) => s.unit === 'adet').reduce((acc, s) => acc + s.current_stock, 0);

  const totalProdM2 = stocks.filter((s) => (s.unit || 'm2') === 'm2').reduce((acc, s) => acc + s.total_produced, 0);
  const totalProdMetre = stocks.filter((s) => s.unit === 'metre').reduce((acc, s) => acc + s.total_produced, 0);
  const totalProdAdet = stocks.filter((s) => s.unit === 'adet').reduce((acc, s) => acc + s.total_produced, 0);

  const totalShipM2 = stocks.filter((s) => (s.unit || 'm2') === 'm2').reduce((acc, s) => acc + s.total_shipped, 0);
  const totalShipMetre = stocks.filter((s) => s.unit === 'metre').reduce((acc, s) => acc + s.total_shipped, 0);
  const totalShipAdet = stocks.filter((s) => s.unit === 'adet').reduce((acc, s) => acc + s.total_shipped, 0);

  // Quota Summary Calculations
  const totalOpenQuotaRemainingM2 = quotas
    .filter((q) => q.unit === 'm2' || q.unit === 'm²')
    .reduce((acc, q) => acc + q.remaining_quantity, 0);

  const totalQuotaTargetM2 = quotas
    .filter((q) => q.unit === 'm2' || q.unit === 'm²')
    .reduce((acc, q) => acc + q.target_quantity, 0);

  const totalQuotaShippedM2 = quotas
    .filter((q) => q.unit === 'm2' || q.unit === 'm²')
    .reduce((acc, q) => acc + q.shipped_quantity, 0);

  const uniqueQuotaCustomersCount = new Set(quotas.map((q) => q.customer_id)).size;

  // Filtered Quotas for Modal
  const filteredQuotas = useMemo(() => {
    return quotas.filter((q) => {
      const matchSearch =
        quotaSearch === '' ||
        q.customer_name.toLowerCase().includes(quotaSearch.toLowerCase()) ||
        (q.site_name && q.site_name.toLowerCase().includes(quotaSearch.toLowerCase())) ||
        (q.product_name && q.product_name.toLowerCase().includes(quotaSearch.toLowerCase()));

      if (!matchSearch) return false;

      if (quotaStatusFilter === 'open' && q.remaining_quantity <= 0) return false;
      if (quotaStatusFilter === 'completed' && q.remaining_quantity > 0) return false;

      return true;
    });
  }, [quotas, quotaSearch, quotaStatusFilter]);

  // Export Modal Quota Breakdown to Excel (.xls)
  const handleExportQuotaExcel = () => {
    const dateStr = new Date().toLocaleDateString('tr-TR');
    let tableHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Calibri, Arial, sans-serif; }
          table { border-collapse: collapse; width: 100%; }
          th { background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1px solid #cbd5e1; padding: 8px; font-size: 11pt; text-align: left; }
          td { border: 1px solid #e2e8f0; padding: 6px; font-size: 10pt; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .font-bold { font-weight: bold; }
          .bg-total { background-color: #f1f5f9; font-weight: bold; }
        </style>
      </head>
      <body>
        <h2>MÜŞTERİ AÇIK SİPARİŞ & SÖZLEŞME KOTASI DÖKÜMÜ</h2>
        <p>Rapor Tarihi: ${dateStr}</p>
        <table>
          <thead>
            <tr>
              <th>Müşteri Adı</th>
              <th>Şantiye</th>
              <th>Ürün / Kapsam</th>
              <th class="text-right">Hedef Kota</th>
              <th class="text-right">Sevk Edilen</th>
              <th class="text-right">Kalan Açık Bakiye</th>
              <th class="text-center">Birim</th>
              <th class="text-center">Tamamlanma %</th>
              <th class="text-center">Durum</th>
            </tr>
          </thead>
          <tbody>
    `;

    filteredQuotas.forEach((q) => {
      const statusText = q.status === 'completed' ? 'Tamamlandı' : q.status === 'in_progress' ? 'Sevk Ediliyor' : 'Başlamadı';
      tableHtml += `
        <tr>
          <td>${q.customer_name}</td>
          <td>${q.site_name || 'Merkez / Genel'}</td>
          <td>${q.product_name || 'Genel Ürünler'}</td>
          <td class="text-right font-bold">${q.target_quantity.toLocaleString('tr-TR')}</td>
          <td class="text-right">${q.shipped_quantity.toLocaleString('tr-TR')}</td>
          <td class="text-right font-bold" style="color: ${q.remaining_quantity > 0 ? '#b91c1c' : '#15803d'}">${q.remaining_quantity.toLocaleString('tr-TR')}</td>
          <td class="text-center">${q.unit}</td>
          <td class="text-center font-bold">%${q.completion_pct}</td>
          <td class="text-center">${statusText}</td>
        </tr>
      `;
    });

    tableHtml += `
          </tbody>
          <tfoot>
            <tr class="bg-total">
              <td colspan="3">GENEL TOPLAM</td>
              <td class="text-right">${totalQuotaTargetM2.toLocaleString('tr-TR')}</td>
              <td class="text-right">${totalQuotaShippedM2.toLocaleString('tr-TR')}</td>
              <td class="text-right">${totalOpenQuotaRemainingM2.toLocaleString('tr-TR')}</td>
              <td class="text-center">m²</td>
              <td class="text-center">%${totalQuotaTargetM2 > 0 ? Math.round((totalQuotaShippedM2 / totalQuotaTargetM2) * 100) : 100}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([tableHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Musteri_Acik_Siparis_Dokumu_${new Date().toISOString().split('T')[0]}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 print:p-0 print:m-0 print:w-full print:space-y-1">
      {/* ── TOP HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2 no-print">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <BarChart3 size={26} className="text-blue-600" /> Raporlama & Fabrika Analizleri
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            2 Büyük Master Rapor: Yönetici İcmali ve Müşteri-Şantiye Sevk Matrisi
          </p>
        </div>
      </div>

      {/* ── TOP 2 MASTER REPORT TABS ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 no-print">
        <button
          type="button"
          onClick={() => setActiveReportTab('factory')}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeReportTab === 'factory'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <BarChart3 size={18} />
          <span>1. Fabrika Yönetici İcmali & Finansal Röntgen</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReportTab('matrix')}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeReportTab === 'matrix'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Table size={18} />
          <span>2. Müşteri, Şantiye & Ürün Sevk Matrisi</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
            Excel + Yazdır
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 hidden sm:inline">
            Şantiye Kırılımlı
          </span>
        </button>
      </div>

      {/* ── TAB 2: MASTER MATRIX REPORT ── */}
      {activeReportTab === 'matrix' ? (
        <DailyShipmentStockMatrixReport />
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-28 gap-3">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold text-slate-500">Yönetici icmali ve finansal veriler yükleniyor...</p>
        </div>
      ) : (
        /* ── TAB 1: MASTER EXECUTIVE & FINANCIAL RÖNTGEN ── */
        <div className="space-y-6">
          {/* ── PERIOD PRESET TOOLBAR ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-100 shadow-xs no-print">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setPeriodPreset('today')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  periodPreset === 'today' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📅 Bugün
              </button>
              <button
                type="button"
                onClick={() => setPeriodPreset('week')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  periodPreset === 'week' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📆 Bu Hafta
              </button>
              <button
                type="button"
                onClick={() => setPeriodPreset('month')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  periodPreset === 'month' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🗓️ Bu Ay
              </button>
              <button
                type="button"
                onClick={() => setPeriodPreset('custom_month')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  periodPreset === 'custom_month' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ⏳ Özel Ay / Yıl
              </button>
            </div>

            {periodPreset === 'custom_month' && (
              <div className="flex items-center gap-2">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {[2023, 2024, 2025, 2026].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="text-xs text-slate-500 font-medium flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
              <span>Seçili Dönem:</span>
              <span className="font-bold text-slate-800 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                {new Date(activeDateRange.start).toLocaleDateString('tr-TR')} - {new Date(activeDateRange.end).toLocaleDateString('tr-TR')}
              </span>
            </div>
          </div>

          {/* ── 4 MASTER KPI CARDS ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Üretim Performansı */}
            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-100 flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-amber-500" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center font-bold">
                    <Package size={20} />
                  </div>
                  <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    Üretim
                  </span>
                </div>
                <p className="text-2xl font-black text-slate-900 tracking-tight">
                  {productionMetrics.totalM2.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}{' '}
                  <span className="text-base font-bold text-slate-500">m²</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">Toplam Üretim Miktarı</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <div>
                  <span className="text-slate-400">Birim Maliyet: </span>
                  <span className="font-bold text-slate-800">₺{unitCost.toFixed(2)}/m²</span>
                </div>
                {productionMetrics.totalMetre > 0 && (
                  <span className="font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                    {productionMetrics.totalMetre.toLocaleString('tr-TR')} m
                  </span>
                )}
              </div>
            </div>

            {/* KPI 2: Sevkiyat & Lojistik */}
            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-100 flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-500" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-bold">
                    <Truck size={20} />
                  </div>
                  <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                    Sevkiyat
                  </span>
                </div>
                <p className="text-2xl font-black text-slate-900 tracking-tight">
                  {shipmentMetrics.totalM2.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}{' '}
                  <span className="text-base font-bold text-slate-500">m²</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">Toplam Sevk Edilen</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                <span className="font-bold text-slate-700">{shipmentMetrics.shipmentCount} Sefer / İrsaliye</span>
                <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                  {shipmentMetrics.totalTonnage > 0 ? `${shipmentMetrics.totalTonnage.toFixed(1)} Ton` : '-'}
                </span>
              </div>
            </div>

            {/* KPI 3: Finansal Röntgen (Ciro & Net Kâr) */}
            <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-100 flex flex-col justify-between relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-1.5 ${totalProfit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`w-10 h-10 ${
                      totalProfit >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
                    } rounded-xl flex items-center justify-center font-bold`}
                  >
                    <TrendingUp size={20} />
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      totalProfit >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
                    }`}
                  >
                    Marj: %{avgMargin.toFixed(1)}
                  </span>
                </div>
                <p className={`text-2xl font-black tracking-tight ${totalProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {totalProfit >= 0 ? '+' : ''}₺{totalProfit.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 font-medium">Dönem Net Kâr / Zarar</p>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400">Ciro: </span>
                  <span className="font-bold text-blue-700">₺{totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
                </div>
                <div>
                  <span className="text-slate-400">Maliyet: </span>
                  <span className="font-bold text-slate-700">₺{costBreakdown.total.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            </div>

            {/* KPI 4: Açık Sipariş Bakiyesi */}
            <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-5 shadow-md text-white flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-white/10 backdrop-blur-xs text-indigo-200 rounded-xl flex items-center justify-center font-bold">
                    <Table size={20} />
                  </div>
                  <span className="text-[11px] font-bold text-indigo-200 bg-white/10 px-2 py-0.5 rounded-full border border-white/15">
                    {uniqueQuotaCustomersCount} Kotalı Müşteri
                  </span>
                </div>
                <p className="text-2xl font-black text-white tracking-tight">
                  {totalOpenQuotaRemainingM2.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}{' '}
                  <span className="text-base font-semibold text-indigo-200">m²</span>
                </p>
                <p className="text-xs text-indigo-200 mt-0.5">Kalan Açık Sipariş / Taahhüt</p>
              </div>
              <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between">
                <div className="text-[11px] text-indigo-200">
                  Toplam: <span className="font-bold text-white">{totalQuotaTargetM2.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} m²</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsQuotaModalOpen(true)}
                  className="px-2.5 py-1 bg-white text-indigo-900 hover:bg-indigo-50 font-bold text-xs rounded-lg transition-all shadow-xs cursor-pointer flex items-center gap-1"
                >
                  <span>🔍 Dökümü Gör</span>
                </button>
              </div>
            </div>
          </div>

          {/* ── CHARTS ROW ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Günlük Sevkiyat Kayan Grafiği */}
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                  <h2 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                    <Truck size={17} className="text-blue-500" /> Günlük Sevkiyat {
                      shipmentUnit === 'metre' ? 'Metrajı (Metre)' :
                      shipmentUnit === 'adet' ? 'Miktarı (Adet)' :
                      shipmentUnit === 'ton' ? 'Tonajı (Ton)' : 'Miktarı (m²)'
                    }
                  </h2>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Gün Aralığı Filtresi */}
                    <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold gap-0.5">
                      {[
                        { days: 7, label: '7 Gün' },
                        { days: 15, label: '15 Gün' },
                        { days: 30, label: '30 Gün' },
                        { days: 0, label: 'Tüm Dönem' },
                      ].map((r) => (
                        <button
                          key={r.days}
                          type="button"
                          onClick={() => setShipmentDaysRange(r.days)}
                          className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                            shipmentDaysRange === r.days
                              ? 'bg-white text-slate-900 shadow-xs font-bold'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>

                    {/* Birim Seçici */}
                    <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold gap-0.5">
                      {[
                        { key: 'm2', label: 'm²' },
                        { key: 'metre', label: 'Metre' },
                        { key: 'adet', label: 'Adet' },
                        { key: 'ton', label: 'Ton' },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setShipmentUnit(tab.key as any)}
                          className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                            shipmentUnit === tab.key
                              ? 'bg-blue-600 text-white shadow-xs font-bold'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-400 mb-3">
                  {shipmentDaysRange === 0 ? 'Dönemdeki tüm sevkiyatlar' : `Son ${displayedDailyShipments.length} gün`} ({
                    shipmentUnit === 'metre' ? 'Bordür vb. metre cinsinden ürünler' :
                    shipmentUnit === 'adet' ? 'Oluk vb. adetli ürünler' :
                    shipmentUnit === 'ton' ? 'Kantar tartım net tonajı' : 'Parke vb. m² cinsinden ürünler'
                  })
                </p>
              </div>

              {displayedDailyShipments.length === 0 ? (
                <div className="flex items-center justify-center h-44 text-slate-400 text-sm">Bu dönemde sevkiyat yok.</div>
              ) : (
                <BarChartScrollable
                  data={displayedDailyShipments.map((d) => {
                    let val = d.m2;
                    let fmt = `${Math.round(d.m2).toLocaleString('tr-TR')} m²`;
                    if (shipmentUnit === 'metre') {
                      val = d.metre;
                      fmt = `${Math.round(d.metre).toLocaleString('tr-TR')} m`;
                    } else if (shipmentUnit === 'adet') {
                      val = d.adet;
                      fmt = `${Math.round(d.adet).toLocaleString('tr-TR')} adet`;
                    } else if (shipmentUnit === 'ton') {
                      val = d.tonnage;
                      fmt = `${parseFloat(d.tonnage.toFixed(1)).toLocaleString('tr-TR')} t`;
                    }
                    return {
                      date: d.date,
                      label: new Date(d.date).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }),
                      value: shipmentUnit === 'ton' ? parseFloat(val.toFixed(2)) : Math.round(val),
                      formattedValue: fmt,
                    };
                  })}
                  maxVal={
                    shipmentUnit === 'metre'
                      ? maxDailyMetre
                      : shipmentUnit === 'adet'
                      ? maxDailyAdet
                      : shipmentUnit === 'ton'
                      ? maxDailyTonnage
                      : maxDailyM2
                  }
                  color="#3b82f6"
                />
              )}
            </div>

            {/* Maliyet Dağılımı */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div>
                <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
                  <DollarSign size={16} className="text-emerald-500" /> Maliyet Dağılımı
                </h2>
                <p className="text-xs text-slate-400 mb-4">{activeDateRange.label} dönemi</p>
                <DonutChart
                  slices={[
                    { value: costBreakdown.hammadde, color: '#f59e0b', label: 'Hammadde' },
                    { value: costBreakdown.operasyonel, color: '#3b82f6', label: 'Operasyonel' },
                    { value: costBreakdown.genel, color: '#10b981', label: 'Genel Gider' },
                  ]}
                />
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Toplam Fabrika Gideri:</span>
                <span className="font-bold text-slate-900 text-sm">₺{costBreakdown.total.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          </div>

          {/* ── KRİTİK STOK UYARISI ── */}
          {lowStocks.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
              <h2 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" /> Kritik Stok Uyarısı ({lowStocks.length} ürün)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {lowStocks.map((s) => {
                  const uLabel = s.unit === 'm2' ? 'm²' : s.unit === 'metre' ? 'Metre' : s.unit === 'adet' ? 'Adet' : s.unit;
                  return (
                    <div key={s.product_id} className="bg-white rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-800 text-sm">{s.product_name}</p>
                        <p className="text-xs text-slate-400">
                          {s.thickness} / {s.color}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-red-600">
                          {s.current_stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}
                        </p>
                        <p className="text-xs text-slate-400">
                          Min: {s.min_stock_alert} {uLabel}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── SİPARİŞ BAZLI KARLILIK ANALİZİ ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <TrendingUp size={18} className="text-slate-600" /> Sipariş Bazlı Karlılık Analizi
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Formül: Ciro − (Birim Maliyet × m² + Lojistik Gideri) | Ortalama Marj: %{avgMargin.toFixed(1)}
              </p>
            </div>
            {profitItems.length === 0 ? (
              <div className="py-12 text-center text-slate-400">Bu dönemde tamamlanan sevkiyat bulunmuyor.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                      {['İrsaliye', 'Müşteri', 'Tarih', 'Sevk Miktarı', 'Birim Fiyat', 'Ciro', 'Maliyet', 'Lojistik', 'Kar/Zarar', 'Marj'].map((h, i) => (
                        <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {profitItems.map((item) => (
                      <tr key={item.shipment_id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-mono text-slate-600 text-xs">{item.invoice_no}</td>
                        <td className="px-4 py-3 text-slate-700">{item.customer_name}</td>
                        <td className="px-4 py-3 text-slate-500">{new Date(item.shipment_date).toLocaleDateString('tr-TR')}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{item.displayQuantity}</td>
                        <td className="px-4 py-3 text-slate-600">
                          ₺{item.sale_price_per_m2}/{item.unitLabel}
                        </td>
                        <td className="px-4 py-3 font-semibold text-blue-700">₺{item.revenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 text-slate-600">₺{item.total_cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 text-slate-500">₺{item.logistics_cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 font-bold">
                          <span className={item.profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {item.profit >= 0 ? '+' : ''}₺{item.profit.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              item.margin_pct >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {item.margin_pct >= 0 ? '+' : ''}
                            {item.margin_pct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 font-semibold text-slate-700">
                        Toplam / Ortalama
                      </td>
                      <td className="px-4 py-3 font-bold text-blue-700">₺{totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                      <td colSpan={2} className="px-4 py-3"></td>
                      <td className="px-4 py-3 font-bold">
                        <span className={totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {totalProfit >= 0 ? '+' : ''}₺{totalProfit.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold">
                        <span className={avgMargin >= 0 ? 'text-green-600' : 'text-red-600'}>%{avgMargin.toFixed(1)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* ── ÜRÜN BAZLI STOK DURUMU ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Package size={18} className="text-amber-500" /> Ürün Bazlı Stok Durumu
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Dönem içi üretim, sevkiyat ve anlık mevcut fabrika stokları</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="bg-blue-50 text-blue-800 font-semibold px-3 py-1.5 rounded-lg border border-blue-100">
                  Toplam Parke: <span className="font-bold">{totalStockM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</span>
                </div>
                <div className="bg-emerald-50 text-emerald-800 font-semibold px-3 py-1.5 rounded-lg border border-emerald-100">
                  Toplam Bordür: <span className="font-bold">{totalStockMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre</span>
                </div>
                <div className="bg-purple-50 text-purple-800 font-semibold px-3 py-1.5 rounded-lg border border-purple-100">
                  Toplam Parça: <span className="font-bold">{totalStockAdet.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Adet</span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                    {['Ürün', 'Kalınlık', 'Renk', 'Birim', 'Üretilen Miktar', 'Sevk Edilen Miktar', 'Mevcut Stok', 'Min. Uyarı', 'Durum'].map((h, i) => (
                      <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stocks.map((s) => {
                    const isLow = s.current_stock <= s.min_stock_alert;
                    const uLabel = s.unit === 'm2' ? 'm²' : s.unit === 'metre' ? 'Metre' : s.unit === 'adet' ? 'Adet' : s.unit;
                    return (
                      <tr key={s.product_id} className={`hover:bg-slate-50/50 ${isLow ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-3 font-medium text-slate-800">{s.product_name}</td>
                        <td className="px-4 py-3 text-slate-600">{s.thickness}</td>
                        <td className="px-4 py-3 text-slate-600">{s.color}</td>
                        <td className="px-4 py-3 text-slate-500 font-medium">{uLabel}</td>
                        <td className="px-4 py-3 text-amber-700 font-semibold">
                          {s.total_produced.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}
                        </td>
                        <td className="px-4 py-3 text-blue-700">
                          {s.total_shipped.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}
                        </td>
                        <td className="px-4 py-3 font-bold" style={{ color: isLow ? '#dc2626' : '#16a34a' }}>
                          {s.current_stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {s.min_stock_alert} {uLabel}
                        </td>
                        <td className="px-4 py-3">
                          {isLow ? (
                            <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                              <AlertTriangle size={12} /> Kritik
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-green-600">Normal</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-xs">
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-slate-700">
                      Parke Taşları Toplamı (m²)
                    </td>
                    <td className="px-4 py-2.5 text-amber-700 font-bold">{totalProdM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</td>
                    <td className="px-4 py-2.5 text-blue-700 font-bold">{totalShipM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</td>
                    <td className="px-4 py-2.5 text-slate-900 font-bold">{totalStockM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</td>
                    <td colSpan={2} className="px-4 py-2.5"></td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-slate-700">
                      Bordürler Toplamı (Metre)
                    </td>
                    <td className="px-4 py-2.5 text-amber-700 font-bold">{totalProdMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre</td>
                    <td className="px-4 py-2.5 text-blue-700 font-bold">{totalShipMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre</td>
                    <td className="px-4 py-2.5 text-slate-900 font-bold">{totalStockMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre</td>
                    <td colSpan={2} className="px-4 py-2.5"></td>
                  </tr>
                  {stocks.some((s) => s.unit === 'adet') && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-slate-700">
                        Adetli Ürünler Toplamı (Adet)
                      </td>
                      <td className="px-4 py-2.5 text-amber-700 font-bold">{totalProdAdet.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Adet</td>
                      <td className="px-4 py-2.5 text-blue-700 font-bold">{totalShipAdet.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Adet</td>
                      <td className="px-4 py-2.5 text-slate-900 font-bold">{totalStockAdet.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Adet</td>
                      <td colSpan={2} className="px-4 py-2.5"></td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── CUSTOMER OPEN ORDER & QUOTA BREAKDOWN MODAL ── */}
      {isQuotaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs no-print">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                  <Table size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    Müşteri Açık Sipariş & Sözleşme Kotası Dökümü
                  </h2>
                  <p className="text-xs text-slate-500">
                    Hangi müşteriye kaç m² taahhüt edildi, ne kadarı sevk edildi ve ne kadar bakiye kaldı?
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQuotaModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Summary Pills */}
            <div className="p-4 bg-indigo-50/40 border-b border-indigo-100/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-white p-3 rounded-xl border border-indigo-100 shadow-2xs">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Toplam Kota</div>
                <div className="text-lg font-black text-slate-900 mt-0.5">
                  {totalQuotaTargetM2.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} <span className="text-xs font-semibold">m²</span>
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-indigo-100 shadow-2xs">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Kümülatif Sevk</div>
                <div className="text-lg font-black text-blue-700 mt-0.5">
                  {totalQuotaShippedM2.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} <span className="text-xs font-semibold">m²</span>
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-indigo-100 shadow-2xs">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Kalan Açık Bakiye</div>
                <div className="text-lg font-black text-amber-700 mt-0.5">
                  {totalOpenQuotaRemainingM2.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} <span className="text-xs font-semibold">m²</span>
                </div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-indigo-100 shadow-2xs">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Genel Tamamlanma</div>
                <div className="text-lg font-black text-emerald-700 mt-0.5">
                  %{totalQuotaTargetM2 > 0 ? Math.round((totalQuotaShippedM2 / totalQuotaTargetM2) * 100) : 100}
                </div>
              </div>
            </div>

            {/* Filter and Action Bar */}
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Müşteri, şantiye veya ürün ara..."
                    value={quotaSearch}
                    onChange={(e) => setQuotaSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold gap-0.5">
                  <button
                    type="button"
                    onClick={() => setQuotaStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      quotaStatusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tümü ({quotas.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuotaStatusFilter('open')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      quotaStatusFilter === 'open' ? 'bg-white text-amber-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Açık Kalanlar ({quotas.filter((q) => q.remaining_quantity > 0).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuotaStatusFilter('completed')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      quotaStatusFilter === 'completed' ? 'bg-white text-emerald-700 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tamamlanan ({quotas.filter((q) => q.remaining_quantity <= 0).length})
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleExportQuotaExcel}
                className="w-full sm:w-auto px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download size={15} />
                <span>Excel İndir (.xls)</span>
              </button>
            </div>

            {/* Modal Table Content */}
            <div className="overflow-y-auto flex-1 p-4">
              {filteredQuotas.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Layers size={36} className="mx-auto text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-600 text-sm">Gösterilecek açık sipariş veya kota kaydı bulunamadı.</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                    {quotas.length === 0
                      ? 'Sistemde henüz aktif bir müşteri kotası tanımlanmamış. "Müşteri Kotaları" menüsünden sözleşmeli işleriniz için hedef kotalar ekleyebilirsiniz.'
                      : 'Arama kriterlerinize uyan kayıt bulunamadı.'}
                  </p>
                </div>
              ) : (
                <div className="border border-slate-100 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-600 font-bold">
                        <th className="py-3 px-3">Müşteri</th>
                        <th className="py-3 px-3">Şantiye</th>
                        <th className="py-3 px-3">Ürün / Kapsam</th>
                        <th className="py-3 px-3 text-right">Hedef Kota</th>
                        <th className="py-3 px-3 text-right">Sevk Edilen</th>
                        <th className="py-3 px-3 text-right">Kalan Bakiye</th>
                        <th className="py-3 px-3 text-center w-36">İlerleme</th>
                        <th className="py-3 px-3 text-center">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {filteredQuotas.map((q) => {
                        const isDone = q.remaining_quantity <= 0;
                        return (
                          <tr key={q.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-3 font-bold text-slate-900">{q.customer_name}</td>
                            <td className="py-2.5 px-3">
                              {q.site_name ? (
                                <span className="font-medium text-slate-700">🏗️ {q.site_name}</span>
                              ) : (
                                <span className="text-slate-400 italic">Merkez / Şantiyesiz</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {q.product_name ? (
                                <span className="text-blue-800 font-medium">{q.product_name}</span>
                              ) : (
                                <span className="text-slate-500">Tüm Ürünler (Genel)</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold">
                              {q.target_quantity.toLocaleString('tr-TR')} {q.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-blue-700">
                              {q.shipped_quantity.toLocaleString('tr-TR')} {q.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right font-black">
                              <span className={isDone ? 'text-emerald-600' : 'text-amber-700'}>
                                {q.remaining_quantity.toLocaleString('tr-TR')} {q.unit}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="w-full flex items-center gap-2">
                                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      isDone ? 'bg-emerald-500' : q.completion_pct > 50 ? 'bg-blue-600' : 'bg-amber-500'
                                    }`}
                                    style={{ width: `${Math.min(100, q.completion_pct)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-bold text-slate-600 w-8 text-right">%{q.completion_pct}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {isDone ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 size={12} /> Tamamlandı
                                </span>
                              ) : q.shipped_quantity > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                  <Clock size={12} /> Sevk Ediliyor
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                  ⏳ Başlamadı
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-xs text-slate-500 font-medium">Toplam {filteredQuotas.length} sözleşme / kota listelendi.</span>
              <button
                type="button"
                onClick={() => setIsQuotaModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
