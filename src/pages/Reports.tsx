import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BarChart3, TrendingUp, Package, DollarSign, Truck, AlertTriangle } from 'lucide-react';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

interface StockItem {
  product_id: string;
  product_name: string;
  thickness: string;
  color: string;
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
}

function BarChartSimple({ data, maxVal, color }: { data: { label: string; value: number; formattedValue?: string }[]; maxVal: number; color: string }) {
  return (
    <div className="flex items-end gap-2 h-44 pt-4 pb-2">
      {data.map((d, i) => {
        const height = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <span className="text-[11px] text-slate-600 font-semibold truncate">
              {d.value > 0 ? (d.formattedValue || d.value.toLocaleString('tr-TR')) : '0'}
            </span>
            <div
              className="w-full rounded-t-md transition-all duration-300 hover:opacity-80"
              style={{
                height: `${Math.max(height, d.value > 0 ? 4 : 2)}%`,
                backgroundColor: d.value > 0 ? color : '#e2e8f0',
              }}
              title={`${d.label}: ${d.formattedValue || d.value}`}
            />
            <span className="text-xs text-slate-500 font-medium text-center leading-tight mt-1">{d.label}</span>
          </div>
        );
      })}
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
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [profitItems, setProfitItems] = useState<ProfitItem[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown>({ hammadde: 0, operasyonel: 0, genel: 0, total: 0 });
  const [dailyShipments, setDailyShipments] = useState<DailyShipment[]>([]);
  const [unitCost, setUnitCost] = useState(0);
  const [monthlyProduction, setMonthlyProduction] = useState(0);
  const [shipmentUnit, setShipmentUnit] = useState<'m2' | 'ton'>('m2');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0];

      const [prodMonthRes, shipMonthRes, stocksRes, costsRes, shipmentsRes] = await Promise.all([
        supabase.from('production_entries').select('product_id, net_m2, date').gte('date', startDate).lte('date', endDate),
        supabase.from('shipment_items').select('product_id, m2, shipments!inner(shipment_date, status)').eq('shipments.status', 'completed').gte('shipments.shipment_date', startDate).lte('shipments.shipment_date', endDate),
        supabase.from('v_product_stock').select('*'),
        supabase.from('cost_entries').select('cost_type, total_amount').eq('period_month', selectedMonth).eq('period_year', selectedYear),
        supabase.from('shipments').select('*, customers(name)').gte('shipment_date', startDate).lte('shipment_date', endDate).eq('status', 'completed'),
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
        const revenue = s.sale_price_per_m2 * s.total_m2;
        const totalCost = uc * s.total_m2 + (s.logistics_cost || 0);
        const profit = revenue - totalCost;
        const margin_pct = revenue > 0 ? (profit / revenue) * 100 : 0;
        return {
          shipment_id: s.id, invoice_no: s.invoice_no, customer_name: s.customers?.name || '-',
          shipment_date: s.shipment_date, total_m2: s.total_m2, sale_price_per_m2: s.sale_price_per_m2,
          logistics_cost: s.logistics_cost || 0, revenue, unit_cost: uc, total_cost: totalCost, profit, margin_pct,
        };
      });
      setProfitItems(profItems);

      const dailyMap: Record<string, { tonnage: number; m2: number }> = {};
      (shipData as any[]).forEach(s => {
        const d = s.shipment_date;
        if (!dailyMap[d]) dailyMap[d] = { tonnage: 0, m2: 0 };
        dailyMap[d].tonnage += (s.net_weight || 0) / 1000;
        dailyMap[d].m2 += s.total_m2;
      });
      const dailyArr = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
      setDailyShipments(dailyArr.slice(-15));

      setLoading(false);
    };
    load();
  }, [selectedMonth, selectedYear]);

  const totalRevenue = profitItems.reduce((s, p) => s + p.revenue, 0);
  const totalProfit = profitItems.reduce((s, p) => s + p.profit, 0);
  const avgMargin = profitItems.length > 0 ? profitItems.reduce((s, p) => s + p.margin_pct, 0) / profitItems.length : 0;
  const lowStocks = stocks.filter(s => s.current_stock <= s.min_stock_alert);
  const maxDailyTonnage = Math.max(...dailyShipments.map(d => d.tonnage), 1);
  const maxDailyM2 = Math.max(...dailyShipments.map(d => d.m2), 1);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 size={24} className="text-slate-700" /> Raporlar & Analizler
          </h1>
          <p className="text-slate-500 text-sm mt-1">Üretim, stok, maliyet ve karlılık analizleri</p>
        </div>
        <div className="flex gap-2">
          <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
            {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Aylık Üretim', value: `${monthlyProduction.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} m²`, icon: Package, color: 'bg-amber-500' },
              { label: 'Birim Maliyet', value: `₺${unitCost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/m²`, icon: DollarSign, color: 'bg-emerald-500' },
              { label: 'Toplam Ciro', value: `₺${totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, icon: TrendingUp, color: 'bg-blue-500' },
              { label: 'Toplam Kar/Zarar', value: `₺${totalProfit.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`, icon: BarChart3, color: totalProfit >= 0 ? 'bg-green-500' : 'bg-red-500' },
            ].map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                  <div className={`w-10 h-10 ${kpi.color} rounded-xl flex items-center justify-center mb-3`}>
                    <Icon size={20} className="text-white" />
                  </div>
                  <p className="text-xl font-bold text-slate-900">{kpi.value}</p>
                  <p className="text-sm text-slate-500 mt-1">{kpi.label}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Truck size={16} className="text-blue-500" /> Günlük Sevkiyat {shipmentUnit === 'm2' ? 'Miktarı' : 'Tonajı'}
                </h2>
                <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setShipmentUnit('m2')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      shipmentUnit === 'm2'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    m²
                  </button>
                  <button
                    type="button"
                    onClick={() => setShipmentUnit('ton')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      shipmentUnit === 'ton'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Ton
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Son 15 gün ({shipmentUnit === 'm2' ? 'm² cinsinden' : 'kantar tartım net tonajı'})
              </p>
              {dailyShipments.length === 0 ? (
                <div className="flex items-center justify-center h-44 text-slate-400 text-sm">Bu dönemde sevkiyat yok.</div>
              ) : (
                <BarChartSimple
                  data={dailyShipments.map(d => {
                    const val = shipmentUnit === 'm2' ? d.m2 : d.tonnage;
                    return {
                      label: new Date(d.date).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }),
                      value: shipmentUnit === 'm2' ? Math.round(val) : parseFloat(val.toFixed(2)),
                      formattedValue: shipmentUnit === 'm2'
                        ? `${Math.round(val).toLocaleString('tr-TR')} m²`
                        : `${parseFloat(val.toFixed(2)).toLocaleString('tr-TR')} t`,
                    };
                  })}
                  maxVal={shipmentUnit === 'm2' ? maxDailyM2 : maxDailyTonnage}
                  color="#3b82f6"
                />
              )}
              {shipmentUnit === 'ton' && dailyShipments.some(d => d.tonnage === 0 && d.m2 > 0) && (
                <p className="text-[11px] text-amber-600 mt-2 bg-amber-50 rounded-lg px-2.5 py-1.5">
                  💡 Kantar tartımı (Brüt/Dara) girilmemiş sevkiyatlar 0 ton olarak görünür. Sevk edilen metrekareyi görmek için yukarıdan <strong>m²</strong> seçiniz.
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
              <div className="grid grid-cols-2 gap-3">
                {lowStocks.map(s => (
                  <div key={s.product_id} className="bg-white rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800 text-sm">{s.product_name}</p>
                      <p className="text-xs text-slate-400">{s.thickness} / {s.color}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-red-600">{s.current_stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</p>
                      <p className="text-xs text-slate-400">Min: {s.min_stock_alert} m²</p>
                    </div>
                  </div>
                ))}
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
                      {['İrsaliye', 'Müşteri', 'Tarih', 'm²', 'Satış Fiyatı', 'Ciro', 'Maliyet', 'Lojistik', 'Kar/Zarar', 'Marj'].map((h, i) => (
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
                        <td className="px-4 py-3 font-semibold text-slate-700">{item.total_m2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</td>
                        <td className="px-4 py-3 text-slate-600">₺{item.sale_price_per_m2}/m²</td>
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
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                <Package size={18} className="text-amber-500" /> Ürün Bazlı Stok Durumu
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                    {['Ürün', 'Kalınlık', 'Renk', 'Üretilen m²', 'Sevk Edilen m²', 'Mevcut Stok', 'Min. Uyarı', 'Durum'].map((h, i) => (
                      <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stocks.map(s => {
                    const isLow = s.current_stock <= s.min_stock_alert;
                    return (
                      <tr key={s.product_id} className={`hover:bg-slate-50/50 ${isLow ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-3 font-medium text-slate-800">{s.product_name}</td>
                        <td className="px-4 py-3 text-slate-600">{s.thickness}</td>
                        <td className="px-4 py-3 text-slate-600">{s.color}</td>
                        <td className="px-4 py-3 text-amber-700 font-semibold">{s.total_produced.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</td>
                        <td className="px-4 py-3 text-blue-700">{s.total_shipped.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</td>
                        <td className="px-4 py-3 font-bold" style={{ color: isLow ? '#dc2626' : '#16a34a' }}>
                          {s.current_stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
                        </td>
                        <td className="px-4 py-3 text-slate-500">{s.min_stock_alert} m²</td>
                        <td className="px-4 py-3">
                          {isLow
                            ? <span className="flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle size={12} /> Kritik</span>
                            : <span className="text-xs font-medium text-green-600">Normal</span>}
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
    </div>
  );
}
