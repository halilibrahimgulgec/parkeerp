import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Product } from '../types';
import {
  Boxes,
  ArrowUpRight,
  ArrowDownLeft,
  FileSpreadsheet,
  Printer,
  Search,
  RefreshCw,
  Calendar,
  AlertTriangle,
  Package,
  Truck,
  Factory,
  ShoppingCart,
  ChevronLeft,
} from 'lucide-react';

interface StockLedgerReportProps {
  targetCompanyId?: string;
  initialProductId?: string;
  onBackToFactorySummary?: () => void;
}

interface RawMovement {
  id: string;
  type: 'production' | 'shipment' | 'purchase';
  date: string;
  createdAt: string;
  documentNo: string;
  title: string;
  description: string;
  subDescription?: string;
  inQty: number;
  outQty: number;
  inPallets: number;
  outPallets: number;
  isTransitShipment?: boolean;
}

interface CalculatedMovement extends RawMovement {
  runningBalanceM2: number;
  runningBalancePallets: number;
  isNegative: boolean;
}

export default function StockLedgerReport({
  targetCompanyId,
  initialProductId,
  onBackToFactorySummary,
}: StockLedgerReportProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProductId || '');
  const [productSearch, setProductSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterType, setFilterType] = useState<'all' | 'production' | 'shipment' | 'purchase'>('all');
  const [datePreset, setDatePreset] = useState<'all' | 'month' | 'last30' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tableSearch, setTableSearch] = useState('');

  // Movements data
  const [movements, setMovements] = useState<CalculatedMovement[]>([]);
  const [summaryStats, setSummaryStats] = useState({
    totalProduced: 0,
    totalProducedPallets: 0,
    totalPurchased: 0,
    totalPurchasedPallets: 0,
    totalShipped: 0,
    totalShippedPallets: 0,
    currentStock: 0,
    currentPallets: 0,
    hasNegativeOccurrence: false,
    lowestBalance: 0,
  });

  // 1. Fetch Products
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        let q = supabase
          .from('products')
          .select('*')
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (targetCompanyId) {
          q = q.eq('company_id', targetCompanyId);
        }

        const { data, error: pErr } = await q;
        if (pErr) throw pErr;

        const list = data || [];
        setProducts(list);

        // If no product selected yet, pick initial or 20X10 BEYAZ PRİZMA or first
        if (!selectedProductId && list.length > 0) {
          const defaultProd =
            list.find((p) => p.name.toUpperCase().includes('20X10') && p.name.toUpperCase().includes('BEYAZ')) ||
            list.find((p) => p.name.toUpperCase().includes('BEYAZ')) ||
            list[0];
          setSelectedProductId(defaultProd.id);
        }
      } catch (err: any) {
        console.error('Error fetching products:', err);
        setError('Ürün listesi alınırken hata oluştu.');
      }
    };

    fetchProducts();
  }, [targetCompanyId]);

  // Update selectedProductId if initialProductId changes externally
  useEffect(() => {
    if (initialProductId) {
      setSelectedProductId(initialProductId);
    }
  }, [initialProductId]);

  const selectedProduct = useMemo(() => {
    return products.find((p) => p.id === selectedProductId) || null;
  }, [products, selectedProductId]);

  // 2. Fetch Movements for Selected Product
  const loadLedger = async () => {
    if (!selectedProductId) return;
    setLoading(true);
    setError(null);

    try {
      // 2a. Production Entries
      let prodQ = supabase
        .from('production_entries')
        .select('id, date, shift, machine_no, total_pallets, total_m2, waste_m2, net_m2, lot_number, notes, created_at')
        .eq('product_id', selectedProductId)
        .order('date', { ascending: true });

      if (targetCompanyId) {
        prodQ = prodQ.eq('company_id', targetCompanyId);
      }

      // 2b. Shipment Items
      let shipQ = supabase
        .from('shipment_items')
        .select(`
          id, m2, unit, pallets, created_at,
          shipments!inner (
            id, invoice_no, shipment_date, vehicle_plate, driver_name, supplier_name, status, notes,
            customers (name),
            sites (name)
          )
        `)
        .eq('product_id', selectedProductId)
        .eq('shipments.status', 'completed');

      if (targetCompanyId) {
        shipQ = shipQ.eq('company_id', targetCompanyId);
      }

      // 2c. External Purchases
      let purchQ = supabase
        .from('external_purchases')
        .select('id, date, supplier_name, supplier_invoice_no, quantity, unit, pallets, is_direct_shipment, vehicle_plate, driver_name, notes, created_at')
        .eq('product_id', selectedProductId);

      if (targetCompanyId) {
        purchQ = purchQ.eq('company_id', targetCompanyId);
      }

      const [prodRes, shipRes, purchRes] = await Promise.all([prodQ, shipQ, purchQ]);

      if (prodRes.error) throw prodRes.error;
      if (shipRes.error) throw shipRes.error;
      const purchases = purchRes.data || [];

      const rawItems: RawMovement[] = [];

      // Add productions
      (prodRes.data || []).forEach((pe: any) => {
        rawItems.push({
          id: `prod_${pe.id}`,
          type: 'production',
          date: pe.date,
          createdAt: pe.created_at || `${pe.date}T08:00:00`,
          documentNo: pe.lot_number ? `Lot: ${pe.lot_number}` : 'Üretim Fişi',
          title: `Fabrika İmalatı (${pe.shift || 'Gündüz'} Vardiyası)`,
          description: pe.machine_no ? `Makine: ${pe.machine_no}` : 'Fabrika Hattı',
          subDescription: pe.notes || (pe.waste_m2 > 0 ? `Fire: ${pe.waste_m2} m²` : undefined),
          inQty: Number(pe.net_m2) || 0,
          outQty: 0,
          inPallets: Number(pe.total_pallets) || 0,
          outPallets: 0,
        });
      });

      // Add shipments
      (shipRes.data || []).forEach((si: any) => {
        const s = si.shipments;
        const isTransit = Boolean(s.supplier_name);
        const custName = s.customers?.name || 'Müşteri';
        const siteName = s.sites?.name ? ` / ${s.sites.name}` : '';
        const vehicle = s.vehicle_plate ? `Plaka: ${s.vehicle_plate}` : '';
        const driver = s.driver_name ? ` (${s.driver_name})` : '';

        rawItems.push({
          id: `ship_${si.id}`,
          type: 'shipment',
          date: s.shipment_date,
          createdAt: si.created_at || `${s.shipment_date}T14:00:00`,
          documentNo: s.invoice_no ? `İrsaliye: ${s.invoice_no}` : 'Sevk İrsaliyesi',
          title: isTransit ? `Transit Sevk (${s.supplier_name})` : `${custName}${siteName}`,
          description: [vehicle + driver, s.notes].filter(Boolean).join(' • ') || 'Fabrika Çıkışı',
          subDescription: isTransit ? '⚠️ Transit Doğrudan Sevk (Fabrika deposundan düşmez)' : undefined,
          inQty: 0,
          outQty: Number(si.m2) || 0,
          inPallets: 0,
          outPallets: Number(si.pallets) || 0,
          isTransitShipment: isTransit,
        });
      });

      // Add external purchases
      purchases.forEach((ep: any) => {
        rawItems.push({
          id: `purch_${ep.id}`,
          type: 'purchase',
          date: ep.date,
          createdAt: ep.created_at || `${ep.date}T10:00:00`,
          documentNo: ep.supplier_invoice_no ? `İrs: ${ep.supplier_invoice_no}` : 'Dış Alım İrsaliyesi',
          title: `Tedarikçi: ${ep.supplier_name}`,
          description: [ep.vehicle_plate ? `Plaka: ${ep.vehicle_plate}` : '', ep.driver_name ? `Şoför: ${ep.driver_name}` : '', ep.notes].filter(Boolean).join(' • ') || 'Dış Tedarik Depo Girişi',
          subDescription: ep.is_direct_shipment ? 'Doğrudan Şantiye Sevkiyatı' : 'Depo Stoğuna Alındı',
          inQty: Number(ep.quantity) || 0,
          outQty: 0,
          inPallets: Number(ep.pallets) || 0,
          outPallets: 0,
        });
      });

      // Sort Chronologically: date ASC, then production first, then shipment
      rawItems.sort((a, b) => {
        if (a.date !== b.date) {
          return a.date.localeCompare(b.date);
        }
        if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
          return a.createdAt.localeCompare(b.createdAt);
        }
        const order = { production: 1, purchase: 2, shipment: 3 };
        return (order[a.type] || 0) - (order[b.type] || 0);
      });

      // Calculate running balance
      let currentBal = 0;
      const palletMultiplier = selectedProduct?.m2_per_pallet && selectedProduct.m2_per_pallet > 0 ? selectedProduct.m2_per_pallet : 1;
      let minBal = 0;
      let hadNegative = false;
      let totalProd = 0;
      let totalProdPal = 0;
      let totalPurch = 0;
      let totalPurchPal = 0;
      let totalShip = 0;
      let totalShipPal = 0;

      const calculated: CalculatedMovement[] = rawItems.map((item) => {
        let delta = 0;
        if (item.type === 'production') {
          delta = item.inQty;
          totalProd += item.inQty;
          totalProdPal += item.inPallets;
        } else if (item.type === 'purchase') {
          delta = item.inQty;
          totalPurch += item.inQty;
          totalPurchPal += item.inPallets;
        } else if (item.type === 'shipment') {
          if (!item.isTransitShipment) {
            delta = -item.outQty;
            totalShip += item.outQty;
            totalShipPal += item.outPallets;
          }
        }

        currentBal = Number((currentBal + delta).toFixed(2));
        if (currentBal < minBal) minBal = currentBal;
        if (currentBal < 0) hadNegative = true;

        const balPallets = Number((currentBal / palletMultiplier).toFixed(2));

        return {
          ...item,
          runningBalanceM2: currentBal,
          runningBalancePallets: balPallets,
          isNegative: currentBal < 0,
        };
      });

      setMovements(calculated);
      setSummaryStats({
        totalProduced: totalProd,
        totalProducedPallets: totalProdPal,
        totalPurchased: totalPurch,
        totalPurchasedPallets: totalPurchPal,
        totalShipped: totalShip,
        totalShippedPallets: totalShipPal,
        currentStock: currentBal,
        currentPallets: Number((currentBal / palletMultiplier).toFixed(2)),
        hasNegativeOccurrence: hadNegative,
        lowestBalance: minBal,
      });
    } catch (err: any) {
      console.error('Error loading ledger:', err);
      setError(`Hareket verileri yüklenirken hata oluştu: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProductId) {
      loadLedger();
    }
  }, [selectedProductId]);

  // Date Presets
  const effectiveDateRange = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (datePreset === 'all') {
      return { start: '', end: '' };
    }
    if (datePreset === 'month') {
      const year = today.getFullYear();
      const month = today.getMonth() + 1;
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = new Date(year, month, 0).toISOString().split('T')[0];
      return { start, end };
    }
    if (datePreset === 'last30') {
      const past = new Date(today);
      past.setDate(today.getDate() - 30);
      return { start: past.toISOString().split('T')[0], end: todayStr };
    }
    return { start: startDate, end: endDate };
  }, [datePreset, startDate, endDate]);

  // Filtered Movements for Table Display
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      // Type filter
      if (filterType !== 'all' && m.type !== filterType) {
        return false;
      }
      // Date filter
      if (effectiveDateRange.start && m.date < effectiveDateRange.start) {
        return false;
      }
      if (effectiveDateRange.end && m.date > effectiveDateRange.end) {
        return false;
      }
      // Text search
      if (tableSearch.trim()) {
        const q = tableSearch.toLowerCase();
        const match =
          m.documentNo.toLowerCase().includes(q) ||
          m.title.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          (m.subDescription && m.subDescription.toLowerCase().includes(q)) ||
          m.date.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [movements, filterType, effectiveDateRange, tableSearch]);

  // Unit Label
  const unitLabel = useMemo(() => {
    if (!selectedProduct) return 'm²';
    return selectedProduct.unit === 'metre' ? 'Metre' : selectedProduct.unit === 'adet' ? 'Adet' : 'm²';
  }, [selectedProduct]);

  // Export to Excel / CSV
  const handleExportCSV = () => {
    if (!selectedProduct || filteredMovements.length === 0) return;

    const headers = [
      'Sıra',
      'Tarih',
      'İşlem Türü',
      'Belge / No',
      'Açıklama / Şantiye / Makine',
      'Detay',
      `Giriş (+ ${unitLabel})`,
      'Giriş (Palet)',
      `Çıkış (- ${unitLabel})`,
      'Çıkış (Palet)',
      `Kalan Stok (${unitLabel})`,
      'Kalan Stok (Palet)',
      'Bakiye Durumu',
    ];

    const rows = filteredMovements.map((m, idx) => [
      idx + 1,
      m.date,
      m.type === 'production' ? 'Üretim Girişi' : m.type === 'purchase' ? 'Dış Alım' : m.isTransitShipment ? 'Transit Sevk' : 'Sevkiyat Çıkışı',
      `"${m.documentNo}"`,
      `"${m.title}"`,
      `"${m.description}"`,
      m.inQty > 0 ? m.inQty : 0,
      m.inPallets > 0 ? m.inPallets : 0,
      m.outQty > 0 ? m.outQty : 0,
      m.outPallets > 0 ? m.outPallets : 0,
      m.runningBalanceM2,
      m.runningBalancePallets,
      m.isNegative ? 'UYARI: EKSİ BAKİYE' : 'Normal',
    ]);

    const csvContent = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Stok_Ekstresi_${selectedProduct.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  // Filtered products list for dropdown
  const filteredProductsList = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, productSearch]);

  return (
    <div className="space-y-6">
      {/* ── TOP ACTION BAR & PRODUCT SELECTOR ── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm no-print space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {onBackToFactorySummary && (
              <button
                type="button"
                onClick={onBackToFactorySummary}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer"
                title="Fabrika Yönetici İcmaline Dön"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <Boxes size={22} />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Ürün Stok Hareket Ekstresi (Stok Kartı)</h2>
                  <p className="text-xs text-slate-500">
                    Seçilen ürünün ilk üretiminden bugüne tüm giriş, çıkış ve anlık bakiye hareketleri
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadLedger}
              disabled={loading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              <span>Yenile</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={filteredMovements.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet size={15} className="text-emerald-600" />
              <span>Excel / CSV</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={filteredMovements.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            >
              <Printer size={15} className="text-blue-600" />
              <span>Yazdır / PDF</span>
            </button>
          </div>
        </div>

        {/* Product Picker Dropdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Package size={14} className="text-blue-600" /> İncelenecek Ürünü Seçiniz:
            </label>
            <div className="relative">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white cursor-pointer"
              >
                {filteredProductsList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.thickness ? `(${p.thickness})` : ''} {p.color ? `[${p.color}]` : ''} - 1 Palet: {p.m2_per_pallet || 0} {p.unit || 'm²'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Search size={14} className="text-slate-400" /> Ürün Listesinde Ara:
            </label>
            <input
              type="text"
              placeholder="Örn: 20X10, Beyaz, Kilit..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            />
          </div>
        </div>
      </div>

      {/* Print-Only Header */}
      <div className="hidden print:block mb-4 p-4 border border-slate-300 rounded-xl">
        <h1 className="text-xl font-bold text-slate-900">FABRİKA ÜRÜN STOK HAREKET EKSTRESİ</h1>
        <p className="text-sm text-slate-600 mt-1">
          <strong>Ürün:</strong> {selectedProduct?.name} ({selectedProduct?.thickness} - {selectedProduct?.color}) |{' '}
          <strong>Ambalaj:</strong> 1 Palet = {selectedProduct?.m2_per_pallet} {unitLabel} |{' '}
          <strong>Rapor Tarihi:</strong> {new Date().toLocaleDateString('tr-TR')}
        </p>
      </div>

      {/* ── NEGATIVE STOCK ALERT CALLOUT (If ever dipped below zero) ── */}
      {summaryStats.hasNegativeOccurrence && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 flex items-start gap-3.5 no-print">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={22} />
          <div className="text-sm">
            <h4 className="font-bold text-amber-900">Geçmişte Eksi Bakiye Tespiti Bulundu</h4>
            <p className="text-amber-800 mt-0.5 text-xs leading-relaxed">
              Bu ürünün stok geçmişinde, <strong>üretim fişi sisteme işlenmeden önce sevkiyat irsaliyesi kesildiği</strong> için bakiyenin eksiye düştüğü satırlar tespit edilmiştir. En düşük seviye: <strong>{summaryStats.lowestBalance.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}</strong> ({selectedProduct?.m2_per_pallet ? `~${Math.round(summaryStats.lowestBalance / selectedProduct.m2_per_pallet)} Palet` : ''}). İlgili tarihteki sevkiyat ve üretim kayıtları aşağıda kırmızı renkle vurgulanmıştır.
            </p>
          </div>
        </div>
      )}

      {/* ── SUMMARY KPI CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Mevcut Stok */}
        <div className={`p-5 rounded-2xl border transition-all ${
          summaryStats.currentStock < 0
            ? 'bg-red-50/70 border-red-200 text-red-900 shadow-sm'
            : summaryStats.currentStock <= (selectedProduct?.min_stock_alert || 0)
            ? 'bg-amber-50/60 border-amber-200 text-amber-900 shadow-sm'
            : 'bg-white border-slate-100 text-slate-800 shadow-sm'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Mevcut Depo Stoğu</span>
            <span className={`p-2 rounded-xl ${summaryStats.currentStock < 0 ? 'bg-red-200 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
              <Package size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-black ${summaryStats.currentStock < 0 ? 'text-red-700' : 'text-slate-900'}`}>
              {summaryStats.currentStock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
            </span>
            <span className="text-xs font-bold text-slate-500">{unitLabel}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">
              {summaryStats.currentPallets} Palet
            </span>
            <span className="text-[11px] text-slate-400">
              1 Palet = {selectedProduct?.m2_per_pallet || 1} {unitLabel}
            </span>
          </div>
        </div>

        {/* Card 2: Toplam Üretim */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Toplam Üretim</span>
            <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <Factory size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-700">
              +{summaryStats.totalProduced.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
            </span>
            <span className="text-xs font-bold text-slate-500">{unitLabel}</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-emerald-600 flex items-center gap-1">
            <ArrowUpRight size={14} />
            <span>+{summaryStats.totalProducedPallets} Palet üretildi</span>
          </div>
        </div>

        {/* Card 3: Toplam Sevkiyat */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Toplam Sevk Edilen</span>
            <span className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Truck size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-blue-700">
              -{summaryStats.totalShipped.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
            </span>
            <span className="text-xs font-bold text-slate-500">{unitLabel}</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-blue-600 flex items-center gap-1">
            <ArrowDownLeft size={14} />
            <span>-{summaryStats.totalShippedPallets} Palet sevk edildi</span>
          </div>
        </div>

        {/* Card 4: Dış Alım / Tedarik */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Dış Alım (Satın Alma)</span>
            <span className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <ShoppingCart size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-purple-700">
              +{summaryStats.totalPurchased.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
            </span>
            <span className="text-xs font-bold text-slate-500">{unitLabel}</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-purple-600">
            {summaryStats.totalPurchasedPallets > 0 ? `+${summaryStats.totalPurchasedPallets} Palet tedarik` : 'Dış alım yok'}
          </div>
        </div>
      </div>

      {/* ── FILTER & SEARCH TOOLBAR ── */}
      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm no-print flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Type Filter Pills */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              filterType === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tüm Hareketler ({movements.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('production')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              filterType === 'production' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🏭 Sadece Üretim ({movements.filter((m) => m.type === 'production').length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('shipment')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              filterType === 'shipment' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🚚 Sadece Sevkiyat ({movements.filter((m) => m.type === 'shipment').length})
          </button>
          {movements.some((m) => m.type === 'purchase') && (
            <button
              type="button"
              onClick={() => setFilterType('purchase')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                filterType === 'purchase' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🛒 Sadece Dış Alım ({movements.filter((m) => m.type === 'purchase').length})
            </button>
          )}
        </div>

        {/* Date Filter Pills */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => setDatePreset('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                datePreset === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tüm Geçmiş
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('month')}
              className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                datePreset === 'month' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bu Ay
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('last30')}
              className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                datePreset === 'last30' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Son 30 Gün
            </button>
          </div>

          {/* Quick Table Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="İrsaliye, şantiye, plaka ara..."
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 sm:w-56"
            />
          </div>
        </div>
      </div>

      {/* ── CHRONOLOGICAL LEDGER TABLE (BANK STATEMENT STYLE) ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="font-bold text-slate-900 text-sm">
              Kronolojik Stok Kartı Ekstresi
            </h3>
            <span className="text-xs text-slate-400">
              ({filteredMovements.length} Hareket Kaydı)
            </span>
          </div>

          <div className="text-xs text-slate-500 hidden sm:block">
            Sıralama: <span className="font-semibold text-slate-700">Tarih (Eskiden Yeniye Doğru)</span>
          </div>
        </div>

        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-semibold text-slate-500">Stok hareketleri hesaplanıyor...</span>
          </div>
        ) : filteredMovements.length === 0 ? (
          <div className="py-20 text-center text-slate-400">
            <Package size={40} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm font-semibold text-slate-600">Bu ürüne ait stok hareketi bulunamadı</p>
            <p className="text-xs text-slate-400 mt-1">Seçilen filtrelerde üretim veya sevkiyat kaydı yok.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="px-3 py-3 w-12 text-center">#</th>
                  <th className="px-3 py-3 w-28">Tarih</th>
                  <th className="px-3 py-3 w-36">İşlem Türü</th>
                  <th className="px-3 py-3 w-36">Belge / No</th>
                  <th className="px-3 py-3 min-w-[220px]">Açıklama / Müşteri / Şantiye</th>
                  <th className="px-3 py-3 text-right text-emerald-700 w-32">Giriş (+)</th>
                  <th className="px-3 py-3 text-right text-blue-700 w-32">Çıkış (-)</th>
                  <th className="px-3 py-3 text-right font-bold w-36">Kalan Stok ({unitLabel})</th>
                  <th className="px-3 py-3 text-right font-bold w-28">Kalan Palet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {filteredMovements.map((m, idx) => {
                  const isNegativeRow = m.isNegative;
                  return (
                    <tr
                      key={m.id}
                      className={`transition-colors ${
                        isNegativeRow
                          ? 'bg-red-50/70 hover:bg-red-100/70'
                          : idx % 2 === 0
                          ? 'bg-white hover:bg-slate-50/80'
                          : 'bg-slate-50/40 hover:bg-slate-50'
                      }`}
                    >
                      {/* # */}
                      <td className="px-3 py-3 text-center text-xs font-semibold text-slate-400">
                        {idx + 1}
                      </td>

                      {/* Tarih */}
                      <td className="px-3 py-3 text-xs font-bold text-slate-800 whitespace-nowrap">
                        {m.date}
                      </td>

                      {/* İşlem Türü */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {m.type === 'production' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-2xs">
                            <Factory size={13} className="text-emerald-600" /> Üretim Girişi
                          </span>
                        ) : m.type === 'purchase' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200 shadow-2xs">
                            <ShoppingCart size={13} className="text-purple-600" /> Dış Alım
                          </span>
                        ) : m.isTransitShipment ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs">
                            <Truck size={13} className="text-slate-500" /> Transit Sevk
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200 shadow-2xs">
                            <Truck size={13} className="text-blue-600" /> Sevkiyat Çıkışı
                          </span>
                        )}
                      </td>

                      {/* Belge No */}
                      <td className="px-3 py-3 text-xs font-mono font-bold text-slate-700 whitespace-nowrap">
                        {m.documentNo}
                      </td>

                      {/* Açıklama / Detay */}
                      <td className="px-3 py-3 text-xs">
                        <div className="font-semibold text-slate-900">{m.title}</div>
                        <div className="text-slate-500 text-[11px] mt-0.5">{m.description}</div>
                        {m.subDescription && (
                          <div className="text-amber-700 font-medium text-[10px] mt-0.5">
                            {m.subDescription}
                          </div>
                        )}
                      </td>

                      {/* Giriş (+) */}
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {m.inQty > 0 ? (
                          <div>
                            <span className="text-xs font-black text-emerald-700">
                              +{m.inQty.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                            </span>
                            {m.inPallets > 0 && (
                              <div className="text-[10px] font-semibold text-emerald-600">
                                (+{m.inPallets} Palet)
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Çıkış (-) */}
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {m.outQty > 0 ? (
                          <div>
                            <span className="text-xs font-black text-blue-700">
                              -{m.outQty.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                            </span>
                            {m.outPallets > 0 && (
                              <div className="text-[10px] font-semibold text-blue-600">
                                (-{m.outPallets} Palet)
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Yürüyen Bakiye (m²) */}
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {isNegativeRow ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white font-black text-xs shadow-xs animate-pulse">
                            <AlertTriangle size={12} /> {m.runningBalanceM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                          </span>
                        ) : (
                          <span className="font-black text-xs text-slate-900">
                            {m.runningBalanceM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                          </span>
                        )}
                      </td>

                      {/* Yürüyen Palet */}
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {isNegativeRow ? (
                          <span className="text-xs font-black text-red-700">
                            {m.runningBalancePallets} Palet
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-slate-700">
                            {m.runningBalancePallets} Palet
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-xs">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-slate-800">
                    Genel Kapanış Bakiyesi & Toplamlar ({selectedProduct?.name})
                  </td>
                  <td className="px-3 py-3 text-right text-emerald-800">
                    +{summaryStats.totalProduced.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                  </td>
                  <td className="px-3 py-3 text-right text-blue-800">
                    -{summaryStats.totalShipped.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                  </td>
                  <td className={`px-3 py-3 text-right text-sm font-black ${summaryStats.currentStock < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                    {summaryStats.currentStock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                  </td>
                  <td className={`px-3 py-3 text-right text-sm font-black ${summaryStats.currentPallets < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                    {summaryStats.currentPallets} Palet
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
