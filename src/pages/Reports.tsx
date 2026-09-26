import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { BarChart3, TrendingUp, Package, DollarSign, Truck, AlertTriangle, ChevronLeft, ChevronRight, Table } from 'lucide-react';
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

function BarChartScrollable({
  data,
  maxVal,
}: {
  data: { label: string; value: number; formattedValue?: string; date: string }[];
  maxVal: number;
  color?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the right on load / data change so newest dates are immediately in view
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
      {/* Scroll controls & guidance */}
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

      {/* Horizontal Scroll Area */}
      <div
        ref={containerRef}
        className="overflow-x-auto pb-3 pt-2 scrollbar-thin scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400 scrollbar-track-transparent overscroll-x-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex items-end gap-2.5 h-48 min-w-max px-1">
          {data.map((d, i) => {
            const height = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
            const isZero = d.value <= 0;
            const isToday = d.date === todayStr;
            const isLatest = i === data.length - 1;

            return (
              <div
                key={i}
                className="w-14 sm:w-16 flex flex-col items-center gap-1 h-full justify-end group/bar"
              >
                {/* Value Label on Top */}
                <span
                  className={`text-[11px] font-bold text-center leading-tight transition-all duration-200 whitespace-nowrap px-1 py-0.5 rounded ${
                    isZero
                      ? 'text-slate-300'
                      : isToday || isLatest
                      ? 'text-blue-700 bg-blue-50 border border-blue-200 font-extrabold'
                      : 'text-slate-700 group-hover/bar:text-blue-600'
                  }`}
                >
                  {isZero ? '-' : (d.formattedValue || d.value.toLocaleString('tr-TR'))}
                </span>

                {/* The Bar Container */}
                <div className="w-full bg-slate-100/80 rounded-t-lg relative flex items-end h-[125px] p-0.5">
                  <div
                    className={`w-full rounded-t-md transition-all duration-300 shadow-2xs ${
                      isZero
                        ? 'bg-slate-200'
                        : isToday || isLatest
                        ? 'bg-gradient-to-t from-blue-600 via-blue-500 to-indigo-500 shadow-blue-500/20'
                        : 'bg-gradient-to-t from-blue-500 to-blue-400 group-hover/bar:brightness-110'
                    }`}
                    style={{
                      height: `${Math.max(height, isZero ? 3 : 5)}%`,
                    }}
                    title={`${d.label}: ${d.formattedValue || d.value}`}
                  />
                </div>

                {/* Date Label on Bottom */}
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
  const paths = slices.map(slice => {
    const pct = slice.value / total;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const endAngle = (cumulative + pct) * 2 * Math.PI - Math.PI / 2;
    cumulative += pct;
    const r = 60, cx = 70, cy = 70;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    return { ...slice, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`, pct };
  });

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="w-32 h-32 flex-shrink-0">
        {paths.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2" />)}
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
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [profitItems, setProfitItems] = useState<ProfitItem[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown>({ hammadde: 0, operasyonel: 0, genel: 0, total: 0 });
  const [dailyShipments, setDailyShipments] = useState<DailyShipment[]>([]);
  const [unitCost, setUnitCost] = useState(0);
  const [monthlyProduction, setMonthlyProduction] = useState(0);
  const [shipmentUnit, setShipmentUnit] = useState<'m2' | 'metre' | 'adet' | 'ton'>('m2');
  const [shipmentDaysRange, setShipmentDaysRange] = useState<number>(15);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0];

      const [prodMonthRes, shipMonthRes, stocksRes, costsRes, shipmentsRes] = await Promise.all([
        supabase.from('production_entries').select('product_id, net_m2, date').gte('date', startDate).lte('date', endDate),
        supabase.from('shipment_items').select('product_id, m2, unit, products(unit), shipments!inner(shipment_date, status)').eq('shipments.status', 'completed').gte('shipments.shipment_date', startDate).lte('shipments.shipment_date', endDate),
        supabase.from('v_product_stock').select('*'),
        supabase.from('cost_entries').select('cost_type, total_amount').eq('period_month', selectedMonth).eq('period_year', selectedYear),
        supabase.from('shipments').select('*, customers(name), shipment_items(*, products(*))').gte('shipment_date', startDate).lte('shipment_date', endDate).eq('status', 'completed'),
      ]);

      const productMap: Record<string, number> = {};
      (prodMonthRes.data || []).forEach(r => {
        productMap[r.product_id] = (productMap[r.product_id] || 0) + (r.net_m2 || 0);
      });

      const shipMap: Record<string, number> = {};
      (shipMonthRes.data || []).forEach(r => {
        shipMap[r.product_id] = (shipMap[r.product_id] || 0) + (r.m2 || 0);
      });

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

      const costs = costsRes.data || [];
      const cd: CostBreakdown = { hammadde: 0, operasyonel: 0, genel: 0, total: 0 };
      costs.forEach(c => {
        cd[c.cost_type as keyof CostBreakdown] += c.total_amount;
        cd.total += c.total_amount;
      });
      setCostBreakdown(cd);

      const monthProd = (prodMonthRes.data || []).reduce((s: number, r: any) => s + (r.net_m2 || 0), 0);
      setMonthlyProduction(monthProd);
      const uc = monthProd > 0 ? cd.total / monthProd : 0;
      setUnitCost(uc);

      const shipData = shipmentsRes.data || [];
      const profItems: ProfitItem[] = (shipData as any[]).map(s => {
        const items = s.shipment_items || [];
        let m2Total = 0;
        let metreTotal = 0;
        let adetTotal = 0;
        items.forEach((it: any) => {
          const u = (it.products?.unit === 'metre' || it.unit === 'metre')
            ? 'metre'
            : (it.products?.unit === 'adet' || it.unit === 'adet')
            ? 'adet'
            : 'm2';
          const qty = Number(it.m2) || 0;
          if (u === 'metre') metreTotal += qty;
          else if (u === 'adet') adetTotal += qty;
          else m2Total += qty;
        });

        const badges: string[] = [];
        if (m2Total > 0) badges.push(`${m2Total.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`);
        if (metreTotal > 0) badges.push(`${metreTotal.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre`);
        if (adetTotal > 0) badges.push(`${adetTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} Adet`);
        const displayQuantity = badges.length > 0 ? badges.join(' + ') : `${(s.total_m2 || 0).toLocaleString('tr-TR')} m²`;
        const unitLabel = metreTotal > 0 && m2Total === 0 ? 'm' : adetTotal > 0 && m2Total === 0 ? 'adet' : 'm²';

        const revenue = s.sale_price_per_m2 * s.total_m2;
        const totalCost = uc * s.total_m2 + (s.logistics_cost || 0);
        const profit = revenue - totalCost;
        const margin_pct = revenue > 0 ? (profit / revenue) * 100 : 0;
        return {
          shipment_id: s.id, invoice_no: s.invoice_no, customer_name: s.customers?.name || '-',
          shipment_date: s.shipment_date, total_m2: s.total_m2, displayQuantity, unitLabel,
          sale_price_per_m2: s.sale_price_per_m2,
          logistics_cost: s.logistics_cost || 0, revenue, unit_cost: uc, total_cost: totalCost, profit, margin_pct,
        };
      });
      setProfitItems(profItems);

      const dailyMap: Record<string, { tonnage: number; m2: number; metre: number; adet: number }> = {};
      (shipData as any[]).forEach(s => {
        const d = s.shipment_date;
        if (!dailyMap[d]) dailyMap[d] = { tonnage: 0, m2: 0, metre: 0, adet: 0 };
        dailyMap[d].tonnage += (s.net_weight || 0) / 1000;
      });

      (shipMonthRes.data || []).forEach((item: any) => {
        const d = item.shipments?.shipment_date;
        if (!d) return;
        if (!dailyMap[d]) dailyMap[d] = { tonnage: 0, m2: 0, metre: 0, adet: 0 };
        const prodUnit = item.products?.unit;
        const u = (prodUnit === 'metre' || item.unit === 'metre')
          ? 'metre'
          : (prodUnit === 'adet' || item.unit === 'adet')
          ? 'adet'
          : (item.unit || 'm2');
        const qty = Number(item.m2) || 0;
        if (u === 'metre') dailyMap[d].metre += qty;
        else if (u === 'adet') dailyMap[d].adet += qty;
        else dailyMap[d].m2 += qty;
      });

      const dailyArr = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
      setDailyShipments(dailyArr);

      setLoading(false);
    };
    load();
  }, [selectedMonth, selectedYear]);

  const displayedDailyShipments = shipmentDaysRange === 0 ? dailyShipments : dailyShipments.slice(-shipmentDaysRange);

  const totalRevenue = profitItems.reduce((s, p) => s + p.revenue, 0);
  const totalProfit = profitItems.reduce((s, p) => s + p.profit, 0);
  const avgMargin = profitItems.length > 0 ? profitItems.reduce((s, p) => s + p.margin_pct, 0) / profitItems.length : 0;
  const lowStocks = stocks.filter(s => s.current_stock <= s.min_stock_alert);
  const maxDailyTonnage = Math.max(...displayedDailyShipments.map(d => d.tonnage), 1);
  const maxDailyM2 = Math.max(...displayedDailyShipments.map(d => d.m2), 1);
  const maxDailyMetre = Math.max(...displayedDailyShipments.map(d => d.metre), 1);
  const maxDailyAdet = Math.max(...displayedDailyShipments.map(d => d.adet), 1);

  const totalStockM2 = stocks.filter(s => (s.unit || 'm2') === 'm2').reduce((acc, s) => acc + s.current_stock, 0);
  const totalStockMetre = stocks.filter(s => s.unit === 'metre').reduce((acc, s) => acc + s.current_stock, 0);
  const totalStockAdet = stocks.filter(s => s.unit === 'adet').reduce((acc, s) => acc + s.current_stock, 0);

  const totalProdM2 = stocks.filter(s => (s.unit || 'm2') === 'm2').reduce((acc, s) => acc + s.total_produced, 0);
  const totalProdMetre = stocks.filter(s => s.unit === 'metre').reduce((acc, s) => acc + s.total_produced, 0);
  const totalProdAdet = stocks.filter(s => s.unit === 'adet').reduce((acc, s) => acc + s.total_produced, 0);

  const totalShipM2 = stocks.filter(s => (s.unit || 'm2') === 'm2').reduce((acc, s) => acc + s.total_shipped, 0);
  const totalShipMetre = stocks.filter(s => s.unit === 'metre').reduce((acc, s) => acc + s.total_shipped, 0);
  const totalShipAdet = stocks.filter(s => s.unit === 'adet').reduce((acc, s) => acc + s.total_shipped, 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 print:p-0 print:m-0 print:w-full print:space-y-1">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2 no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 size={24} className="text-slate-700" /> Raporlar & Analizler
          </h1>
          <p className="text-slate-500 text-sm mt-1">Üretim, stok, maliyet ve müşteri sevkiyat analizleri</p>
        </div>
        {activeReportTab === 'factory' && (
          <div className="flex items-center gap-2">
            <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white font-medium">
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white font-medium">
              {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ── TOP REPORT TABS ── */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 no-print">
        <button
          type="button"
          onClick={() => setActiveReportTab('factory')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeReportTab === 'factory'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <BarChart3 size={18} />
          <span>Fabrika Genel & Karlılık Raporu</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReportTab('matrix')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeReportTab === 'matrix'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Table size={18} />
          <span>Günlük Sevk, Üretim & Stok Matrisi</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
            Excel
          </span>
        </button>
      </div>

      {activeReportTab === 'matrix' ? (
        <DailyShipmentStockMatrixReport />
      ) : loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top 4 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[
              { label: 'Aylık Üretim', value: `${monthlyProduction.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} m²`, icon: Package, color: 'bg-amber-500' },
              { label: 'Birim Maliyet', value: `₺${unitCost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/m²`, icon: DollarSign, color: 'bg-emerald-500' },
              { label: 'Toplam Ciro', value: `₺${totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, icon: TrendingUp, color: 'bg-blue-500' },
              { label: 'Toplam Kar/Zarar', value: `₺${totalProfit.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, icon: BarChart3, color: totalProfit >= 0 ? 'bg-green-500' : 'bg-red-500' },
            ].map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <div key={i} className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-slate-100">
                  <div className={`w-10 h-10 ${kpi.color} rounded-xl flex items-center justify-center mb-3 shadow-xs`}>
                    <Icon size={20} className="text-white" />
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900">{kpi.value}</p>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">{kpi.label}</p>
                </div>
              );
            })}
          </div>

          {/* Charts Row */}
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
                        { days: 0, label: 'Tüm Ay' },
                      ].map(r => (
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
                      ].map(tab => (
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
                  {shipmentDaysRange === 0 ? 'Tüm ay sevkiyatları' : `Son ${displayedDailyShipments.length} gün`} ({
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
                  data={displayedDailyShipments.map(d => {
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
                    shipmentUnit === 'metre' ? maxDailyMetre :
                    shipmentUnit === 'adet' ? maxDailyAdet :
                    shipmentUnit === 'ton' ? maxDailyTonnage : maxDailyM2
                  }
                  color="#3b82f6"
                />
              )}
              {shipmentUnit === 'ton' && displayedDailyShipments.some(d => d.tonnage === 0 && (d.m2 > 0 || d.metre > 0 || d.adet > 0)) && (
                <p className="text-[11px] text-amber-600 mt-2 bg-amber-50 rounded-lg px-2.5 py-1.5">
                  💡 Kantar tartımı (Brüt/Dara) girilmemiş sevkiyatlar 0 ton görünür. Sevk edilen ürün adet, metre veya m² detayını görmek için yukarıdaki birim butonlarını seçebilirsiniz.
                </p>
              )}
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
                <DollarSign size={16} className="text-emerald-500" /> Maliyet Dağılımı
              </h2>
              <p className="text-xs text-slate-400 mb-4">{MONTHS[selectedMonth - 1]} {selectedYear} dönemi</p>
              <DonutChart slices={[
                { value: costBreakdown.hammadde, color: '#f59e0b', label: 'Hammadde' },
                { value: costBreakdown.operasyonel, color: '#3b82f6', label: 'Operasyonel' },
                { value: costBreakdown.genel, color: '#10b981', label: 'Genel Gider' },
              ]} />
            </div>
          </div>

          {lowStocks.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
              <h2 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" /> Kritik Stok Uyarısı ({lowStocks.length} ürün)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {lowStocks.map(s => {
                  const uLabel = s.unit === 'm2' ? 'm²' : s.unit === 'metre' ? 'Metre' : s.unit === 'adet' ? 'Adet' : s.unit;
                  return (
                    <div key={s.product_id} className="bg-white rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-800 text-sm">{s.product_name}</p>
                        <p className="text-xs text-slate-400">{s.thickness} / {s.color}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-red-600">
                          {s.current_stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}
                        </p>
                        <p className="text-xs text-slate-400">Min: {s.min_stock_alert} {uLabel}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                        <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {profitItems.map(item => (
                      <tr key={item.shipment_id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-mono text-slate-600 text-xs">{item.invoice_no}</td>
                        <td className="px-4 py-3 text-slate-700">{item.customer_name}</td>
                        <td className="px-4 py-3 text-slate-500">{new Date(item.shipment_date).toLocaleDateString('tr-TR')}</td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{item.displayQuantity}</td>
                        <td className="px-4 py-3 text-slate-600">₺{item.sale_price_per_m2}/{item.unitLabel}</td>
                        <td className="px-4 py-3 font-semibold text-blue-700">₺{item.revenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 text-slate-600">₺{item.total_cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 text-slate-500">₺{item.logistics_cost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 font-bold">
                          <span className={item.profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {item.profit >= 0 ? '+' : ''}₺{item.profit.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${item.margin_pct >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {item.margin_pct >= 0 ? '+' : ''}{item.margin_pct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 font-semibold text-slate-700">Toplam / Ortalama</td>
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

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Package size={18} className="text-amber-500" /> Ürün Bazlı Stok Durumu
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Dönem içi üretim, sevkiyat ve anlık mevcut stoklar</p>
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
                      <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stocks.map(s => {
                    const isLow = s.current_stock <= s.min_stock_alert;
                    const uLabel = s.unit === 'm2' ? 'm²' : s.unit === 'metre' ? 'Metre' : s.unit === 'adet' ? 'Adet' : s.unit;
                    return (
                      <tr key={s.product_id} className={`hover:bg-slate-50/50 ${isLow ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-3 font-medium text-slate-800">{s.product_name}</td>
                        <td className="px-4 py-3 text-slate-600">{s.thickness}</td>
                        <td className="px-4 py-3 text-slate-600">{s.color}</td>
                        <td className="px-4 py-3 text-slate-500 font-medium">{uLabel}</td>
                        <td className="px-4 py-3 text-amber-700 font-semibold">{s.total_produced.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}</td>
                        <td className="px-4 py-3 text-blue-700">{s.total_shipped.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: isLow ? '#dc2626' : '#16a34a' }}>
                          {s.current_stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {uLabel}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{s.min_stock_alert} {uLabel}</td>
                        <td className="px-4 py-3">
                          {isLow
                            ? <span className="flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle size={12} /> Kritik</span>
                            : <span className="text-xs font-medium text-green-600">Normal</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-xs">
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-slate-700">Parke Taşları Toplamı (m²)</td>
                    <td className="px-4 py-2.5 text-amber-700 font-bold">{totalProdM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</td>
                    <td className="px-4 py-2.5 text-blue-700 font-bold">{totalShipM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</td>
                    <td className="px-4 py-2.5 text-slate-900 font-bold">{totalStockM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</td>
                    <td colSpan={2} className="px-4 py-2.5"></td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-slate-700">Bordürler Toplamı (Metre)</td>
                    <td className="px-4 py-2.5 text-amber-700 font-bold">{totalProdMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre</td>
                    <td className="px-4 py-2.5 text-blue-700 font-bold">{totalShipMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre</td>
                    <td className="px-4 py-2.5 text-slate-900 font-bold">{totalStockMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre</td>
                    <td colSpan={2} className="px-4 py-2.5"></td>
                  </tr>
                  {stocks.some(s => s.unit === 'adet') && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-slate-700">Adetli Ürünler Toplamı (Adet)</td>
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
    </div>
  );
}
