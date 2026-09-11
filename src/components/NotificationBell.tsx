import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Bell, AlertTriangle, Clock, ArrowRight, Target, CheckCircle2 } from 'lucide-react';

interface QuotaAlert {
  id: string;
  customerName: string;
  siteName: string | null;
  targetQuantity: number;
  shippedQuantity: number;
  remainingQuantity: number;
  completionPct: number;
  unit: string;
  isExceeded: boolean;
}

export default function NotificationBell({ onNavigate }: { onNavigate: (page: any) => void }) {
  const [alerts, setAlerts] = useState<QuotaAlert[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchAlerts = async () => {
    try {
      const [quotasRes, shipItemsRes] = await Promise.all([
        supabase.from('customer_quotas')
          .select('id, customer_id, site_id, product_id, target_quantity, unit, alert_threshold_pct, start_date, end_date, customers(name), sites(name)')
          .eq('is_active', true),
        supabase.from('shipment_items')
          .select(`
            product_id,
            m2,
            unit,
            shipments!inner (
              shipment_date,
              customer_id,
              site_id,
              status
            )
          `)
          .eq('shipments.status', 'completed')
      ]);

      if (!quotasRes.data || !shipItemsRes.data) return;

      const activeAlerts: QuotaAlert[] = [];

      quotasRes.data.forEach((quota: any) => {
        const matchingItems = (shipItemsRes.data || []).filter((item: any) => {
          const s = item.shipments;
          if (!s) return false;
          if (s.customer_id !== quota.customer_id) return false;
          if (quota.site_id && s.site_id !== quota.site_id) return false;
          if (quota.product_id && item.product_id !== quota.product_id) return false;
          if (quota.start_date && s.shipment_date < quota.start_date) return false;
          if (quota.end_date && s.shipment_date > quota.end_date) return false;
          const itemUnit = item.unit || 'm2';
          if (itemUnit !== quota.unit) return false;
          return true;
        });

        const shipped = matchingItems.reduce((acc: number, cur: any) => acc + (Number(cur.m2) || 0), 0);
        const target = Number(quota.target_quantity) || 1;
        const pct = Math.round((shipped / target) * 100);
        const threshold = Number(quota.alert_threshold_pct) || 85;

        if (pct >= threshold) {
          activeAlerts.push({
            id: quota.id,
            customerName: quota.customers?.name || 'Müşteri',
            siteName: quota.sites?.name || null,
            targetQuantity: target,
            shippedQuantity: shipped,
            remainingQuantity: target - shipped,
            completionPct: pct,
            unit: quota.unit,
            isExceeded: pct >= 100,
          });
        }
      });

      // Sort: Exceeded first, then highest percentage
      activeAlerts.sort((a, b) => b.completionPct - a.completionPct);
      setAlerts(activeAlerts);
    } catch (err) {
      console.error('Error fetching quota alerts:', err);
    }
  };

  useEffect(() => {
    fetchAlerts();
    // Poll every 30 seconds for updates
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const count = alerts.length;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
        title="Kota Bildirimleri"
        aria-label="Kota Bildirimleri"
      >
        <Bell size={20} />
        {count > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white shadow-sm animate-pulse">
            {count}
          </span>
        )}
      </button>

      {/* Dropdown Popup */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white p-3 shadow-2xl border border-slate-100 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 px-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                <Target size={14} />
              </div>
              <h3 className="font-bold text-xs text-slate-900">Müşteri Kota Bildirimleri</h3>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              {count} Aktif Uyarı
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto py-2 space-y-1.5 divide-y divide-slate-50">
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-1.5 opacity-80" />
                <p className="text-xs font-semibold text-slate-700">Tüm Kotalar Normal</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Eşik değerini aşan müşteri taahhüdü yok.</p>
              </div>
            ) : (
              alerts.map(a => (
                <div
                  key={a.id}
                  onClick={() => {
                    setIsOpen(false);
                    onNavigate('customer_quotas');
                  }}
                  className="p-2.5 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-xs text-slate-900 leading-snug">{a.customerName}</h4>
                      {a.siteName && (
                        <p className="text-[10px] text-slate-500">{a.siteName}</p>
                      )}
                    </div>
                    {a.isExceeded ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-800 shrink-0">
                        <AlertTriangle size={10} />
                        %{a.completionPct} Kota Aşıldı
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 shrink-0">
                        <Clock size={10} />
                        %{a.completionPct} Yaklaştı
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>
                      Sevk: <strong>{a.shippedQuantity.toLocaleString('tr-TR')} {a.unit}</strong> / {a.targetQuantity.toLocaleString('tr-TR')} {a.unit}
                    </span>
                    <span className={a.remainingQuantity < 0 ? 'text-red-600 font-bold' : 'text-slate-700 font-semibold'}>
                      {a.remainingQuantity >= 0 ? `Kalan: ${a.remainingQuantity.toLocaleString('tr-TR')} ${a.unit}` : `+${Math.abs(a.remainingQuantity).toLocaleString('tr-TR')} ${a.unit} Fazla`}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${a.isExceeded ? 'bg-red-500' : 'bg-amber-500'}`}
                      style={{ width: `${Math.min(a.completionPct, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onNavigate('customer_quotas');
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold text-amber-600 hover:text-amber-700 transition-colors"
            >
              <span>Müşteri Kotaları & Sevk Sayfasına Git</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
