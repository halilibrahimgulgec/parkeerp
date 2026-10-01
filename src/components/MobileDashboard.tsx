import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import NotificationBell from './NotificationBell';
import {
  Truck,
  Factory,
  Package,
  Layers,
  Target,
  Sparkles,
  Sun,
  Moon,
  ChevronRight,
  TrendingUp,
  RefreshCw,
  Camera,
  X
} from 'lucide-react';

type Page =
  | 'dashboard'
  | 'production'
  | 'production_planning'
  | 'purchases'
  | 'shipment'
  | 'customer_quotas'
  | 'costs'
  | 'definitions'
  | 'reports'
  | 'admin_users'
  | 'pallet_tracking'
  | 'labor_tracking';

interface MobileDashboardProps {
  onNavigate: (page: Page) => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

interface RecentShipmentSummary {
  invoice_no: string;
  vehicle_plate: string;
  customer_name: string;
  site_name: string;
  total_m2: number;
  total_pallets: number;
}

export default function MobileDashboard({ onNavigate, isDark, onToggleTheme }: MobileDashboardProps) {
  const { user } = useAuth();

  // Metrics
  const [todayProdM2, setTodayProdM2] = useState<number>(0);
  const [dailyTargetM2] = useState<number>(2000);
  const [recentShipment, setRecentShipment] = useState<RecentShipmentSummary | null>(null);
  const [totalStockM2, setTotalStockM2] = useState<number>(0);
  const [unreturnedPallets, setUnreturnedPallets] = useState<number>(0);
  const [activeQuotasCount, setActiveQuotasCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [showStockModal, setShowStockModal] = useState(false);
  const [stockList, setStockList] = useState<any[]>([]);

  const fetchLiveMetrics = async () => {
    try {
      setLoading(true);
      const todayStr = new Date().toISOString().split('T')[0];

      // 1. Günlük Üretim
      const { data: prodData } = await supabase
        .from('production_entries')
        .select('net_m2, total_m2')
        .eq('date', todayStr);

      const prodSum = (prodData || []).reduce((acc, row) => acc + (Number(row.net_m2 || row.total_m2) || 0), 0);
      setTodayProdM2(Math.round(prodSum));

      // 2. Son Sevkiyat
      const { data: shipData } = await supabase
        .from('shipments')
        .select('invoice_no, vehicle_plate, total_m2, customers(name), sites(name), shipment_items(pallets)')
        .order('shipment_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);

      if (shipData && shipData.length > 0) {
        const s = shipData[0] as any;
        const totalPal = (s.shipment_items || []).reduce((acc: number, item: any) => acc + (Number(item.pallets) || 0), 0);
        setRecentShipment({
          invoice_no: s.invoice_no || '-',
          vehicle_plate: s.vehicle_plate || 'Kayıtlı Araç',
          customer_name: s.customers?.name || 'Müşteri',
          site_name: s.sites?.name || '',
          total_m2: Number(s.total_m2) || 0,
          total_pallets: totalPal,
        });
      }

      // 3. Stok Toplamı
      const { data: stocks } = await supabase.from('v_product_stock').select('*');
      if (stocks) {
        setStockList(stocks);
        const sumStock = stocks.reduce((acc, row: any) => acc + (Number(row.current_stock) || 0), 0);
        setTotalStockM2(Math.round(sumStock));
      }

      // 4. Müşteri Kotaları
      const { count: quotaCount } = await supabase
        .from('customer_quotas')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      setActiveQuotasCount(quotaCount || 0);

      // 5. Palet Borçları
      const { data: palletTxs } = await supabase.from('pallet_transactions').select('transaction_type, quantity');
      if (palletTxs) {
        let sent = 0;
        let returned = 0;
        palletTxs.forEach((tx) => {
          if (tx.transaction_type === 'sent') sent += Number(tx.quantity) || 0;
          if (tx.transaction_type === 'returned') returned += Number(tx.quantity) || 0;
        });
        setUnreturnedPallets(Math.max(0, sent - returned));
      }
    } catch (err) {
      console.warn('MobileDashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveMetrics();
  }, []);

  const completionPct = Math.min(100, Math.round((todayProdM2 / dailyTargetM2) * 100));
  const rawUserName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Halil İbrahim';
  const displayName = rawUserName.charAt(0).toUpperCase() + rawUserName.slice(1);

  return (
    <div
      className={`min-h-screen pb-24 transition-colors duration-300 font-sans ${
        isDark ? 'bg-[#0f172a] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
      }`}
    >
      {/* ── 1. HEADER SECTION (KAVİSLİ DEGRADE BAŞLIK) ── */}
      <div
        className={`relative pt-7 pb-10 px-5 rounded-b-[2.5rem] shadow-xl overflow-hidden transition-all duration-300 ${
          isDark
            ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border-b border-slate-800'
            : 'bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#1e3a8a]'
        }`}
      >
        {/* Dekoratif Arka Plan Kavisli Dalga */}
        <div className="absolute -right-10 -bottom-14 w-48 h-48 bg-gradient-to-br from-amber-500/25 to-orange-600/30 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -left-12 -top-12 w-40 h-40 bg-blue-500/20 rounded-full blur-xl pointer-events-none" />

        {/* Üst Çubuk (Profil + Tema & Bildirim) */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          {/* Kullanıcı Profili */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-13 h-13 rounded-full bg-gradient-to-tr from-amber-500 via-orange-500 to-blue-500 p-0.5 shadow-md">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256"
                  alt="Yönetici"
                  className="w-full h-full object-cover rounded-full bg-slate-800"
                  onError={(e) => {
                    // Fallback to avatar letter
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-slate-900 shadow-sm" />
            </div>
            <div>
              <h1 className="text-white text-base font-extrabold tracking-tight flex items-center gap-1.5">
                <span>Merhaba, {displayName}</span>
              </h1>
              <p className="text-slate-300 text-xs font-medium opacity-90">Fabrika Genel Yönetimi</p>
            </div>
          </div>

          {/* Aksiyonlar (Tema Butonu & Bildirim) */}
          <div className="flex items-center gap-2">
            {/* Tema Değiştirici */}
            <button
              type="button"
              onClick={onToggleTheme}
              className={`p-2.5 rounded-2xl transition-all shadow-sm ${
                isDark
                  ? 'bg-slate-800/80 hover:bg-slate-700 text-amber-400 border border-slate-700/60'
                  : 'bg-white/10 hover:bg-white/20 text-amber-300 border border-white/10'
              }`}
              title={isDark ? 'Aydınlık Moda Geç' : 'Karanlık Moda Geç'}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Bildirim Zili */}
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-1 border border-white/10 text-white">
              <NotificationBell onNavigate={onNavigate} />
            </div>
          </div>
        </div>

        {/* ── 2. CANLI HEDEF GÖSTERGE ÇUBUĞU (TARGET PILL) ── */}
        <div className="relative z-10 mt-6">
          <div
            className={`p-3.5 rounded-2xl backdrop-blur-md border transition-all shadow-md ${
              isDark
                ? 'bg-slate-900/85 border-slate-700/80 text-white'
                : 'bg-white/95 border-white text-slate-900 shadow-slate-900/10'
            }`}
          >
            <div className="flex items-center justify-between text-xs font-bold mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-amber-500">🎯</span>
                <span>Bugün: {todayProdM2.toLocaleString('tr-TR')} m²</span>
                <span className="text-slate-400 font-normal">/ Hedef: {dailyTargetM2.toLocaleString('tr-TR')} m²</span>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                completionPct >= 70
                  ? isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-700'
                  : isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-700'
              }`}>
                %{completionPct}
              </span>
            </div>

            {/* İlerleme Çubuğu */}
            <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`}>
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. ANA EYLEM KARTLARI (2x3 DOKUNMATİK IZGARA) ── */}
      <div className="px-4 -mt-3 relative z-20">
        <div className="grid grid-cols-2 gap-3.5">
          {/* KART 1: SEVKİYAT & KANTAR */}
          <button
            type="button"
            onClick={() => onNavigate('shipment')}
            className={`group text-left p-4 rounded-3xl transition-all duration-200 border cursor-pointer ${
              isDark
                ? 'bg-slate-900/90 border-slate-800 hover:border-blue-500/50 hover:bg-slate-800/90 shadow-lg shadow-black/20'
                : 'bg-white border-slate-200/90 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/5 shadow-md shadow-slate-200/50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm ${
                  isDark ? 'bg-blue-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-blue-50 text-blue-600 border border-blue-100'
                }`}
              >
                <Truck size={24} />
              </div>
              <Camera size={16} className={isDark ? 'text-slate-500' : 'text-slate-400'} />
            </div>
            <h3 className="font-extrabold text-sm sm:text-base leading-snug tracking-tight mb-2">
              Sevkiyat & Kantar
            </h3>
            <span
              className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-xl tracking-tight ${
                isDark
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
              }`}
            >
              Fiş / Kamera OCR
            </span>
          </button>

          {/* KART 2: GÜNLÜK ÜRETİM */}
          <button
            type="button"
            onClick={() => onNavigate('production')}
            className={`group text-left p-4 rounded-3xl transition-all duration-200 border cursor-pointer ${
              isDark
                ? 'bg-slate-900/90 border-slate-800 hover:border-amber-500/50 hover:bg-slate-800/90 shadow-lg shadow-black/20'
                : 'bg-white border-slate-200/90 hover:border-amber-400 hover:shadow-xl hover:shadow-amber-500/5 shadow-md shadow-slate-200/50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm ${
                  isDark ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-amber-50 text-amber-600 border border-amber-100'
                }`}
              >
                <Factory size={24} />
              </div>
              <TrendingUp size={16} className={isDark ? 'text-slate-500' : 'text-slate-400'} />
            </div>
            <h3 className="font-extrabold text-sm sm:text-base leading-snug tracking-tight mb-2">
              Günlük Üretim
            </h3>
            <span
              className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-xl tracking-tight ${
                isDark
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/30'
              }`}
            >
              1. & 2. Vardiya
            </span>
          </button>

          {/* KART 3: PALET TAKİBİ */}
          <button
            type="button"
            onClick={() => onNavigate('pallet_tracking')}
            className={`group text-left p-4 rounded-3xl transition-all duration-200 border cursor-pointer ${
              isDark
                ? 'bg-slate-900/90 border-slate-800 hover:border-emerald-500/50 hover:bg-slate-800/90 shadow-lg shadow-black/20'
                : 'bg-white border-slate-200/90 hover:border-emerald-400 hover:shadow-xl hover:shadow-emerald-500/5 shadow-md shadow-slate-200/50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm ${
                  isDark ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                }`}
              >
                <Package size={24} />
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                {unreturnedPallets > 0 ? `${unreturnedPallets.toLocaleString('tr-TR')} Adet` : '0 Borç'}
              </span>
            </div>
            <h3 className="font-extrabold text-sm sm:text-base leading-snug tracking-tight mb-2">
              Palet Takibi
            </h3>
            <span
              className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-xl tracking-tight ${
                isDark
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
              }`}
            >
              Borç & İade
            </span>
          </button>

          {/* KART 4: STOK & AMBAR */}
          <button
            type="button"
            onClick={() => setShowStockModal(true)}
            className={`group text-left p-4 rounded-3xl transition-all duration-200 border cursor-pointer ${
              isDark
                ? 'bg-slate-900/90 border-slate-800 hover:border-yellow-500/50 hover:bg-slate-800/90 shadow-lg shadow-black/20'
                : 'bg-white border-slate-200/90 hover:border-yellow-400 hover:shadow-xl hover:shadow-yellow-500/5 shadow-md shadow-slate-200/50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm ${
                  isDark ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-amber-50 text-amber-700 border border-amber-100'
                }`}
              >
                <Layers size={24} />
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                {totalStockM2 > 0 ? `${(totalStockM2 / 1000).toFixed(1)}k m²` : 'Canlı'}
              </span>
            </div>
            <h3 className="font-extrabold text-sm sm:text-base leading-snug tracking-tight mb-2">
              Stok & Ambar
            </h3>
            <span
              className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-xl tracking-tight ${
                isDark
                  ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                  : 'bg-amber-600 text-white shadow-sm shadow-amber-600/30'
              }`}
            >
              m² & Tonaj
            </span>
          </button>

          {/* KART 5: MÜŞTERİ KOTALARI */}
          <button
            type="button"
            onClick={() => onNavigate('customer_quotas')}
            className={`group text-left p-4 rounded-3xl transition-all duration-200 border cursor-pointer ${
              isDark
                ? 'bg-slate-900/90 border-slate-800 hover:border-purple-500/50 hover:bg-slate-800/90 shadow-lg shadow-black/20'
                : 'bg-white border-slate-200/90 hover:border-purple-400 hover:shadow-xl hover:shadow-purple-500/5 shadow-md shadow-slate-200/50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm ${
                  isDark ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-purple-50 text-purple-600 border border-purple-100'
                }`}
              >
                <Target size={24} />
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                {activeQuotasCount} Kota
              </span>
            </div>
            <h3 className="font-extrabold text-sm sm:text-base leading-snug tracking-tight mb-2">
              Müşteri Kotaları
            </h3>
            <span
              className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-xl tracking-tight ${
                isDark
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
              }`}
            >
              Açık Siparişler
            </span>
          </button>

          {/* KART 6: PARKE AI ZEKASI */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-parke-ai'))}
            className={`group text-left p-4 rounded-3xl transition-all duration-200 border cursor-pointer ${
              isDark
                ? 'bg-gradient-to-br from-indigo-950/60 to-slate-900 border-indigo-500/30 hover:border-indigo-400 shadow-lg shadow-indigo-950/40'
                : 'bg-gradient-to-br from-indigo-50/70 to-blue-50/40 border-indigo-200 hover:border-indigo-400 hover:shadow-xl hover:shadow-indigo-500/10 shadow-md shadow-slate-200/50'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm ${
                  isDark ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                }`}
              >
                <Sparkles size={24} />
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <h3 className="font-extrabold text-sm sm:text-base leading-snug tracking-tight mb-2 flex items-center gap-1">
              <span>Parke AI Zekası</span>
            </h3>
            <span
              className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-xl tracking-tight ${
                isDark
                  ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                  : 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
              }`}
            >
              Sesli & Görsel
            </span>
          </button>
        </div>
      </div>

      {/* ── 4. CANLI SON SEVKİYATLAR KARTI ── */}
      <div className="px-4 mt-4">
        <div
          className={`p-4 rounded-3xl border transition-all ${
            isDark
              ? 'bg-slate-900/80 border-slate-800 text-white'
              : 'bg-white border-slate-200/90 text-slate-900 shadow-md shadow-slate-200/40'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🚛</span>
              <h2 className="text-xs sm:text-sm font-extrabold tracking-tight">Son Sevkiyat</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('shipment')}
              className={`text-xs font-bold flex items-center gap-1 transition-colors ${
                isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
              }`}
            >
              <span>Tümünü Gör</span>
              <ChevronRight size={14} />
            </button>
          </div>

          {recentShipment ? (
            <div
              onClick={() => onNavigate('shipment')}
              className={`p-3 rounded-2xl flex items-center justify-between cursor-pointer transition-all ${
                isDark ? 'bg-slate-800/60 hover:bg-slate-800' : 'bg-slate-50 hover:bg-slate-100/80 border border-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                    isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  <Truck size={18} />
                </div>
                <div>
                  <div className="font-extrabold text-xs sm:text-sm flex items-center gap-2">
                    <span className="font-mono">{recentShipment.vehicle_plate}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold">
                      #{recentShipment.invoice_no}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium truncate max-w-[200px]">
                    {recentShipment.customer_name} {recentShipment.site_name ? `• ${recentShipment.site_name}` : ''}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-black text-xs sm:text-sm text-blue-500">
                  {recentShipment.total_m2.toLocaleString('tr-TR')} m²
                </div>
                <div className="text-[10px] text-slate-400">
                  {recentShipment.total_pallets} Palet
                </div>
              </div>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-slate-400 font-medium">
              Henüz sevkiyat kaydı bulunmuyor.
            </div>
          )}
        </div>
      </div>

      {/* ── 5. HIZLI STOK ÖZETİ MODALI (POPUP) ── */}
      {showStockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className={`w-full max-w-sm rounded-3xl p-5 border shadow-2xl transition-all ${
              isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="text-amber-500" size={20} />
                <h3 className="font-extrabold text-sm">Fabrika Canlı Taş Stoğu</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowStockModal(false)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-200"
              >
                <X size={20} />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {stockList.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl flex items-center justify-between text-xs ${
                    isDark ? 'bg-slate-800/80' : 'bg-slate-50 border border-slate-100'
                  }`}
                >
                  <div>
                    <div className="font-bold">{item.product_name || item.name}</div>
                    <div className="text-[10px] text-slate-400">
                      {item.thickness ? `${item.thickness} • ` : ''}
                      {item.color || 'Gri'}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-amber-500">
                      {Number(item.current_stock || 0).toLocaleString('tr-TR')} {item.unit || 'm²'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs">
              <span className="text-slate-400 font-semibold">Toplam Stok:</span>
              <span className="font-black text-sm text-emerald-500">
                {totalStockM2.toLocaleString('tr-TR')} m²
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
