import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Factory, Truck, AlertTriangle, TrendingUp, Package,
  DollarSign, BarChart2, Calendar
} from 'lucide-react';

interface KPI {
  todayProduction: number;
  todayShipment: number;
  monthCost: number;
  lowStockCount: number;
}

interface StockItem {
  product_id: string;
  product_name: string;
  current_stock: number;
  min_stock_alert: number;
  color: string;
  thickness: string;
  unit: string;
}

interface CostBreakdown {
  hammadde: number;
  operasyonel: number;
  genel: number;
}

interface RecentShipment {
  id: string;
  invoice_no: string;
  customer_name: string;
  total_m2: number;
  shipment_date: string;
  status: string;
}

function DonutChart({ data }: { data: CostBreakdown }) {
  const total = data.hammadde + data.operasyonel + data.genel;
  if (total === 0) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Veri yok</div>;

  const slices = [
    { value: data.hammadde, color: '#f59e0b', label: 'Hammadde' },
    { value: data.operasyonel, color: '#3b82f6', label: 'Operasyonel' },
    { value: data.genel, color: '#10b981', label: 'Genel' },
  ];

  let cumulative = 0;
  const paths = slices.map(slice => {
    const pct = slice.value / total;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const endAngle = (cumulative + pct) * 2 * Math.PI - Math.PI / 2;
    cumulative += pct;

    const r = 70;
    const cx = 90, cy = 90;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = pct > 0.5 ? 1 : 0;

    return { ...slice, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`, pct };
  });

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 180 180" className="w-40 h-40 flex-shrink-0">
        {paths.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke="white" strokeWidth="2" />
        ))}
        <circle cx="90" cy="90" r="40" fill="white" />
      </svg>
      <div className="space-y-2 flex-1">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-slate-600">{s.label}</span>
            </div>
            <span className="font-semibold text-slate-900">{total > 0 ? ((s.value / total) * 100).toFixed(1) : 0}%</span>
          </div>
        ))}
        <div className="pt-2 border-t border-slate-100 text-sm">
          <span className="text-slate-500">Toplam: </span>
          <span className="font-bold text-slate-900">₺{total.toLocaleString('tr-TR', { minimumFractionDigits: 0 })}</span>
        </div>
      </div>
    </div>
  );
}

function KPICard({ title, value, sub, icon: Icon, color }: { title: string; value: string; sub: string; icon: any; color: string }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center`}>
          <Icon size={22} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-sm font-medium text-slate-700 mt-1">{title}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  );
}

export default function Dashboard() {
  const [kpi, setKpi] = useState<KPI>({ todayProduction: 0, todayShipment: 0, monthCost: 0, lowStockCount: 0 });
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown>({ hammadde: 0, operasyonel: 0, genel: 0 });
  const [recentShipments, setRecentShipments] = useState<RecentShipment[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const [prodRes, shipRes, costRes, stockRes] = await Promise.all([
        supabase.from('production_entries').select('net_m2').eq('date', today),
        supabase.from('shipments').select('total_m2').eq('shipment_date', today).eq('status', 'completed'),
        supabase.from('cost_entries').select('cost_type, total_amount').eq('period_month', currentMonth).eq('period_year', currentYear),
        supabase.from('v_product_stock').select('*'),
      ]);

      const todayProduction = (prodRes.data || []).reduce((s, r) => s + (r.net_m2 || 0), 0);
      const todayShipment = (shipRes.data || []).reduce((s, r) => s + (r.total_m2 || 0), 0);

      const costs = costRes.data || [];
      const monthCost = costs.reduce((s, r) => s + (r.total_amount || 0), 0);
      const breakdown: CostBreakdown = { hammadde: 0, operasyonel: 0, genel: 0 };
      costs.forEach(c => {
        if (c.cost_type === 'hammadde') breakdown.hammadde += c.total_amount;
        else if (c.cost_type === 'operasyonel') breakdown.operasyonel += c.total_amount;
        else if (c.cost_type === 'genel') breakdown.genel += c.total_amount;
      });
      setCostBreakdown(breakdown);

      const stockItems: StockItem[] = (stockRes.data || []).map((p: any) => ({
        product_id: p.product_id,
        product_name: p.product_name,
        current_stock: p.current_stock || 0,
        min_stock_alert: p.min_stock_alert,
        color: p.color,
        thickness: p.thickness,
        unit: p.unit,
      }));

      const lowStockCount = stockItems.filter(s => s.current_stock <= s.min_stock_alert).length;
      setStocks(stockItems);
      setKpi({ todayProduction, todayShipment, monthCost, lowStockCount });

      const { data: shipData } = await supabase
        .from('shipments')
        .select('id, invoice_no, total_m2, shipment_date, status, customers(name)')
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentShipments((shipData || []).map((s: any) => ({
        id: s.id,
        invoice_no: s.invoice_no,
        customer_name: s.customers?.name || '-',
        total_m2: s.total_m2,
        shipment_date: s.shipment_date,
        status: s.status,
      })));

      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
    completed: { label: 'Tamamlandı', cls: 'bg-green-100 text-green-700' },
    pending: { label: 'Bekliyor', cls: 'bg-yellow-100 text-yellow-700' },
    cancelled: { label: 'İptal', cls: 'bg-red-100 text-red-700' },
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">
            <Calendar size={14} className="inline mr-1" />
            {new Date().toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <KPICard
          title="Bugünkü Üretim"
          value={`${kpi.todayProduction.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`}
          sub="Net üretim (fire düşülmüş)"
          icon={Factory}
          color="bg-amber-500"
        />
        <KPICard
          title="Bugünkü Sevkiyat"
          value={`${kpi.todayShipment.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`}
          sub="Tamamlanan çıkışlar"
          icon={Truck}
          color="bg-blue-500"
        />
        <KPICard
          title="Aylık Toplam Gider"
          value={`₺${kpi.monthCost.toLocaleString('tr-TR', { minimumFractionDigits: 0 })}`}
          sub={`${new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}`}
          icon={DollarSign}
          color="bg-emerald-500"
        />
        <KPICard
          title="Kritik Stok Uyarısı"
          value={String(kpi.lowStockCount)}
          sub="Minimum seviyenin altındaki ürünler"
          icon={AlertTriangle}
          color={kpi.lowStockCount > 0 ? 'bg-red-500' : 'bg-slate-400'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Package size={18} className="text-slate-600" />
            <h2 className="font-semibold text-slate-900">Anlık Stok Durumu</h2>
          </div>
          {stocks.length === 0 ? (
            <p className="text-slate-400 text-sm py-8 text-center">Ürün tanımı bulunamadı.</p>
          ) : (
            <div className="space-y-3">
              {stocks.map(item => {
                const pct = item.min_stock_alert > 0
                  ? Math.min((item.current_stock / (item.min_stock_alert * 3)) * 100, 100)
                  : 100;
                const isLow = item.current_stock <= item.min_stock_alert;
                const itemUnit = item.unit === 'm2' ? 'm²' : item.unit === 'adet' ? 'Adet' : item.unit === 'metre' ? 'Metre' : item.unit;
                return (
                  <div key={item.product_id} className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-700 truncate">
                          {item.product_name} — {item.thickness} / {item.color}
                        </span>
                        <div className="flex items-center gap-2 ml-2">
                          {isLow && <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />}
                          <span className={`text-sm font-semibold ${isLow ? 'text-red-600' : 'text-slate-900'}`}>
                            {item.current_stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {itemUnit}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${isLow ? 'bg-red-400' : 'bg-amber-400'}`}
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">Min. uyarı: {item.min_stock_alert} {itemUnit}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={18} className="text-slate-600" />
            <h2 className="font-semibold text-slate-900">Aylık Maliyet Dağılımı</h2>
          </div>
          <DonutChart data={costBreakdown} />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-slate-600" />
          <h2 className="font-semibold text-slate-900">Son Sevkiyatlar</h2>
        </div>
        {recentShipments.length === 0 ? (
          <p className="text-slate-400 text-sm py-8 text-center">Henüz sevkiyat kaydı bulunmuyor.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="pb-3 font-medium">İrsaliye No</th>
                  <th className="pb-3 font-medium">Müşteri</th>
                  <th className="pb-3 font-medium text-right">Miktar (m²)</th>
                  <th className="pb-3 font-medium">Tarih</th>
                  <th className="pb-3 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentShipments.map(s => {
                  const st = STATUS_LABELS[s.status] || { label: s.status, cls: '' };
                  return (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 font-mono text-slate-700">{s.invoice_no || '-'}</td>
                      <td className="py-3 text-slate-700">{s.customer_name}</td>
                      <td className="py-3 text-right font-semibold text-slate-900">
                        {(s.total_m2 || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
                      </td>
                      <td className="py-3 text-slate-500">
                        {new Date(s.shipment_date).toLocaleDateString('tr-TR')}
                      </td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
