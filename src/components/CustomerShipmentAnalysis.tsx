import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Customer, Site, Product } from '../types';
import {
  Filter, Printer, RefreshCw, X, Search, Phone, MapPin,
  Layers, TrendingUp, Package, Boxes, Truck, Scale,
  Building2, ChevronDown, Users
} from 'lucide-react';

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function getEffectiveUnit(item: any, products: Product[]): 'm2' | 'metre' | 'adet' {
  const prod = products.find(p => p.id === item.product_id);
  if (prod?.unit === 'metre' || item.unit === 'metre') return 'metre';
  if (prod?.unit === 'adet' || item.unit === 'adet') return 'adet';
  return (item.unit || prod?.unit || 'm2') as any;
}

export type PrintScope = 'all' | 'products' | 'customers' | 'sites' | 'shipments';

interface CustomerShipmentAnalysisProps {
  initialCustomerId?: string;
  initialStartDate?: string;
  initialEndDate?: string;
  customers?: Customer[];
  sites?: Site[];
  products?: Product[];
  shipmentItems?: any[];
  onRefresh?: () => void;
}

export default function CustomerShipmentAnalysis({
  initialCustomerId = '',
  initialStartDate,
  initialEndDate,
  customers: propCustomers,
  sites: propSites,
  products: propProducts,
  shipmentItems: propShipmentItems,
  onRefresh
}: CustomerShipmentAnalysisProps) {
  // Data states (fallback to internal fetch if props are omitted)
  const [customers, setCustomers] = useState<Customer[]>(propCustomers || []);
  const [sites, setSites] = useState<Site[]>(propSites || []);
  const [products, setProducts] = useState<Product[]>(propProducts || []);
  const [shipmentItems, setShipmentItems] = useState<any[]>(propShipmentItems || []);
  const [loading, setLoading] = useState(false);

  // Filter states
  const [queryCustomerId, setQueryCustomerId] = useState<string>(initialCustomerId);
  const [querySiteId, setQuerySiteId] = useState<string>('');
  const [queryProductId, setQueryProductId] = useState<string>('');
  const [queryUnit, setQueryUnit] = useState<string>('all');
  const [querySearch, setQuerySearch] = useState<string>('');
  const [queryStartDate, setQueryStartDate] = useState<string>(() => {
    if (initialStartDate !== undefined) return initialStartDate;
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return getLocalDateStr(firstDay);
  });
  const [queryEndDate, setQueryEndDate] = useState<string>(() => {
    if (initialEndDate !== undefined) return initialEndDate;
    return getLocalDateStr(new Date());
  });

  // Print states
  const [printScope, setPrintScope] = useState<PrintScope>('all');
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const printMenuRef = useRef<HTMLDivElement>(null);

  // Distribution View: 'both' | 'customer' | 'site'
  const [distributionView, setDistributionView] = useState<'both' | 'customer' | 'site'>('both');

  // Synchronize when initialCustomerId changes from parent
  useEffect(() => {
    if (initialCustomerId !== undefined) {
      setQueryCustomerId(initialCustomerId);
    }
  }, [initialCustomerId]);

  useEffect(() => {
    if (initialStartDate !== undefined) {
      setQueryStartDate(initialStartDate);
    }
  }, [initialStartDate]);

  // Sync prop changes
  useEffect(() => {
    if (propCustomers) setCustomers(propCustomers);
  }, [propCustomers]);
  useEffect(() => {
    if (propSites) setSites(propSites);
  }, [propSites]);
  useEffect(() => {
    if (propProducts) setProducts(propProducts);
  }, [propProducts]);
  useEffect(() => {
    if (propShipmentItems) setShipmentItems(propShipmentItems);
  }, [propShipmentItems]);

  // Fetch internal data if props were not provided
  const loadInternalData = async () => {
    setLoading(true);
    try {
      const [custRes, sitesRes, prodRes, shipItemsRes] = await Promise.all([
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('sites').select('*').eq('is_active', true).order('name'),
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('shipment_items').select(`
          id,
          product_id,
          m2,
          unit,
          pallets,
          pallet_type,
          shipments!inner (
            id,
            invoice_no,
            shipment_date,
            customer_id,
            site_id,
            vehicle_plate,
            driver_name,
            driver_phone,
            gross_weight,
            tare_weight,
            notes,
            status
          )
        `).eq('shipments.status', 'completed').limit(50000)
      ]);

      if (custRes.data) setCustomers(custRes.data);
      if (sitesRes.data) setSites(sitesRes.data);
      if (prodRes.data) setProducts(prodRes.data);
      if (shipItemsRes.data) setShipmentItems(shipItemsRes.data);
    } catch (err) {
      console.error('Veri yükleme hatası:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!propShipmentItems || propShipmentItems.length === 0) {
      loadInternalData();
    }
  }, []);

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      loadInternalData();
    }
  };

  // Close print dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) {
        setShowPrintMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter sites for the selected customer
  const querySites = useMemo(() => {
    if (!queryCustomerId) return sites;
    return sites.filter(s => s.customer_id === queryCustomerId);
  }, [queryCustomerId, sites]);

  useEffect(() => {
    if (queryCustomerId && querySiteId) {
      const exists = sites.some(s => s.id === querySiteId && s.customer_id === queryCustomerId);
      if (!exists) setQuerySiteId('');
    }
  }, [queryCustomerId, querySiteId, sites]);

  // Fast Date Presets
  const handleDatePreset = (preset: 'today' | 'week' | 'month' | '30days' | 'year' | 'all') => {
    const now = new Date();
    const todayStr = getLocalDateStr(now);

    if (preset === 'today') {
      setQueryStartDate(todayStr);
      setQueryEndDate(todayStr);
    } else if (preset === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diff));
      setQueryStartDate(getLocalDateStr(monday));
      setQueryEndDate(todayStr);
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setQueryStartDate(getLocalDateStr(firstDay));
      setQueryEndDate(todayStr);
    } else if (preset === '30days') {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setQueryStartDate(getLocalDateStr(past30));
      setQueryEndDate(todayStr);
    } else if (preset === 'year') {
      const firstJan = new Date(now.getFullYear(), 0, 1);
      setQueryStartDate(getLocalDateStr(firstJan));
      setQueryEndDate(todayStr);
    } else if (preset === 'all') {
      setQueryStartDate('');
      setQueryEndDate('');
    }
  };

  // Trigger Print with designated Scope
  const handlePrint = (scope: PrintScope) => {
    setPrintScope(scope);
    setShowPrintMenu(false);
    setTimeout(() => {
      window.print();
    }, 120);
  };

  // Main Analysis Aggregations
  const analysisResults = useMemo(() => {
    const matched = shipmentItems.filter(item => {
      const s = item.shipments;
      if (!s) return false;

      if (queryCustomerId && s.customer_id !== queryCustomerId) return false;
      if (querySiteId && s.site_id !== querySiteId) return false;
      if (queryProductId && item.product_id !== queryProductId) return false;

      const itemUnit = getEffectiveUnit(item, products);
      if (queryUnit !== 'all' && itemUnit !== queryUnit) return false;

      if (queryStartDate && s.shipment_date < queryStartDate) return false;
      if (queryEndDate && s.shipment_date > queryEndDate) return false;

      if (querySearch.trim()) {
        const kw = querySearch.toLowerCase();
        const inv = (s.invoice_no || '').toLowerCase();
        const plate = (s.vehicle_plate || '').toLowerCase();
        const driver = (s.driver_name || '').toLowerCase();
        if (!inv.includes(kw) && !plate.includes(kw) && !driver.includes(kw)) {
          return false;
        }
      }

      return true;
    });

    let totalM2 = 0;
    let totalMetre = 0;
    let totalAdet = 0;
    let totalPallets = 0;
    const uniqueShipments = new Map<string, any>();

    matched.forEach(item => {
      const s = item.shipments;
      const u = getEffectiveUnit(item, products);
      const qty = Number(item.m2) || 0;
      const pal = Number(item.pallets) || 0;

      if (u === 'm2') totalM2 += qty;
      else if (u === 'metre') totalMetre += qty;
      else if (u === 'adet') totalAdet += qty;

      totalPallets += pal;

      if (s && !uniqueShipments.has(s.id)) {
        uniqueShipments.set(s.id, s);
      }
    });

    let totalNetWeightKg = 0;
    uniqueShipments.forEach(s => {
      const gross = Number(s.gross_weight) || 0;
      const tare = Number(s.tare_weight) || 0;
      if (gross > tare) {
        totalNetWeightKg += (gross - tare);
      }
    });

    // 1. Product Breakdown
    const prodMap = new Map<string, {
      product_id: string;
      name: string;
      thickness: string;
      color: string;
      unit: string;
      total_qty: number;
      total_pallets: number;
      shipment_count: number;
      shipment_ids: Set<string>;
    }>();

    matched.forEach(item => {
      const prod = products.find(p => p.id === item.product_id);
      const pid = item.product_id || 'unknown';
      const name = prod ? prod.name : 'Diğer / Belirtilmemiş';
      const thickness = prod?.thickness || '';
      const color = prod?.color || '';
      const unit = getEffectiveUnit(item, products);
      const qty = Number(item.m2) || 0;
      const pal = Number(item.pallets) || 0;
      const sId = item.shipments?.id;

      const groupKey = `${pid}__${unit}`;

      if (!prodMap.has(groupKey)) {
        prodMap.set(groupKey, {
          product_id: pid,
          name,
          thickness,
          color,
          unit,
          total_qty: 0,
          total_pallets: 0,
          shipment_count: 0,
          shipment_ids: new Set(),
        });
      }

      const pEntry = prodMap.get(groupKey)!;
      pEntry.total_qty += qty;
      pEntry.total_pallets += pal;
      if (sId && !pEntry.shipment_ids.has(sId)) {
        pEntry.shipment_ids.add(sId);
        pEntry.shipment_count++;
      }
    });

    const productBreakdown = Array.from(prodMap.values()).sort((a, b) => b.total_qty - a.total_qty);

    // 2. Customer Breakdown
    const custMap = new Map<string, {
      customer_id: string;
      name: string;
      phone?: string;
      total_m2: number;
      total_metre: number;
      total_adet: number;
      total_pallets: number;
      shipment_count: number;
      shipment_ids: Set<string>;
      sites: Set<string>;
    }>();

    matched.forEach(item => {
      const s = item.shipments;
      const cid = s?.customer_id || 'unassigned';
      const custObj = customers.find(c => c.id === cid);
      const name = custObj ? custObj.name : 'Genel / Belirtilmemiş Müşteri';
      const phone = custObj?.phone;
      const unit = getEffectiveUnit(item, products);
      const qty = Number(item.m2) || 0;
      const pal = Number(item.pallets) || 0;
      const sId = s?.id;

      const siteObj = sites.find(st => st.id === s?.site_id);
      const siteName = siteObj ? siteObj.name : (s?.site_id ? 'Şantiye' : 'Genel Saha');

      if (!custMap.has(cid)) {
        custMap.set(cid, {
          customer_id: cid,
          name,
          phone,
          total_m2: 0,
          total_metre: 0,
          total_adet: 0,
          total_pallets: 0,
          shipment_count: 0,
          shipment_ids: new Set(),
          sites: new Set(),
        });
      }

      const cEntry = custMap.get(cid)!;
      if (unit === 'm2') cEntry.total_m2 += qty;
      else if (unit === 'metre') cEntry.total_metre += qty;
      else if (unit === 'adet') cEntry.total_adet += qty;
      cEntry.total_pallets += pal;
      if (siteName) cEntry.sites.add(siteName);

      if (sId && !cEntry.shipment_ids.has(sId)) {
        cEntry.shipment_ids.add(sId);
        cEntry.shipment_count++;
      }
    });

    const customerBreakdown = Array.from(custMap.values()).sort((a, b) => {
      if (b.total_m2 !== a.total_m2) return b.total_m2 - a.total_m2;
      return b.total_metre - a.total_metre;
    });

    // 3. Site Breakdown (grouped with customer reference)
    const siteMap = new Map<string, {
      site_id: string;
      name: string;
      customer_id?: string;
      customer_name: string;
      total_m2: number;
      total_metre: number;
      total_adet: number;
      total_pallets: number;
      shipment_count: number;
      shipment_ids: Set<string>;
    }>();

    matched.forEach(item => {
      const s = item.shipments;
      const sid = s?.site_id || 'unassigned';
      const siteObj = sites.find(st => st.id === sid);
      const name = siteObj ? siteObj.name : 'Genel / Belirtilmemiş Şantiye';
      const cid = s?.customer_id || siteObj?.customer_id;
      const custObj = customers.find(c => c.id === cid);
      const customer_name = custObj ? custObj.name : '-';
      const unit = getEffectiveUnit(item, products);
      const qty = Number(item.m2) || 0;
      const pal = Number(item.pallets) || 0;
      const sId = s?.id;

      const groupKey = `${sid}__${cid || 'nocust'}`;

      if (!siteMap.has(groupKey)) {
        siteMap.set(groupKey, {
          site_id: sid,
          name,
          customer_id: cid,
          customer_name,
          total_m2: 0,
          total_metre: 0,
          total_adet: 0,
          total_pallets: 0,
          shipment_count: 0,
          shipment_ids: new Set(),
        });
      }

      const sEntry = siteMap.get(groupKey)!;
      if (unit === 'm2') sEntry.total_m2 += qty;
      else if (unit === 'metre') sEntry.total_metre += qty;
      else if (unit === 'adet') sEntry.total_adet += qty;
      sEntry.total_pallets += pal;

      if (sId && !sEntry.shipment_ids.has(sId)) {
        sEntry.shipment_ids.add(sId);
        sEntry.shipment_count++;
      }
    });

    const siteBreakdown = Array.from(siteMap.values()).sort((a, b) => {
      if (b.total_m2 !== a.total_m2) return b.total_m2 - a.total_m2;
      return b.total_metre - a.total_metre;
    });

    // 4. Chronological Shipment List
    const shipMap = new Map<string, {
      shipment: any;
      items: any[];
      total_m2: number;
      total_pallets: number;
    }>();

    matched.forEach(item => {
      const s = item.shipments;
      if (!s) return;
      if (!shipMap.has(s.id)) {
        shipMap.set(s.id, {
          shipment: s,
          items: [],
          total_m2: 0,
          total_pallets: 0,
        });
      }
      const sg = shipMap.get(s.id)!;
      sg.items.push(item);
      sg.total_m2 += Number(item.m2) || 0;
      sg.total_pallets += Number(item.pallets) || 0;
    });

    const shipmentList = Array.from(shipMap.values()).sort((a, b) => {
      return (b.shipment.shipment_date || '').localeCompare(a.shipment.shipment_date || '');
    });

    return {
      matchedCount: matched.length,
      totalM2,
      totalMetre,
      totalAdet,
      totalPallets,
      totalShipments: uniqueShipments.size,
      totalNetWeightKg,
      productBreakdown,
      customerBreakdown,
      siteBreakdown,
      shipmentList,
    };
  }, [shipmentItems, queryCustomerId, querySiteId, queryProductId, queryUnit, queryStartDate, queryEndDate, querySearch, products, sites, customers]);

  const selectedCustomerObj = useMemo(() => {
    return customers.find(c => c.id === queryCustomerId);
  }, [customers, queryCustomerId]);

  const selectedSiteObj = useMemo(() => {
    return sites.find(s => s.id === querySiteId);
  }, [sites, querySiteId]);

  return (
    <div className="space-y-6">
      {/* ── PRINT STYLES ── */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0.8cm 1cm !important;
          }
          aside, header, nav, .no-print, button {
            display: none !important;
          }
          body, html, #root, main, main > div {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            color: black !important;
          }
          .print-clean {
            border: 1px solid #cbd5e1 !important;
            box-shadow: none !important;
            page-break-inside: avoid;
          }
          .print-only {
            display: block !important;
          }
          .print-hidden {
            display: none !important;
          }
          table {
            width: 100% !important;
            font-size: 10px !important;
          }
          th, td {
            padding: 4px 6px !important;
          }
        }
        @media screen {
          .print-only {
            display: none !important;
          }
        }
      `}</style>

      {/* ── QUERY FILTER CARD ── */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Filter size={16} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Sevk Sorgulama & Rapor Filtresi</h3>
              <p className="text-slate-400 text-xs">Müşteri ve tarih aralığı belirleyerek sevkiyatları anlık analiz edin ve dilediğiniz bölümü yazdırın</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Print Scope Dropdown */}
            <div className="relative" ref={printMenuRef}>
              <button
                type="button"
                onClick={() => setShowPrintMenu(!showPrintMenu)}
                className="flex items-center gap-2 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs transition-colors shadow-sm cursor-pointer"
                title="Yazdırma veya PDF seçenekleri"
              >
                <Printer size={15} />
                <span>Yazdır / PDF</span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${showPrintMenu ? 'rotate-180' : ''}`} />
              </button>

              {showPrintMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 text-xs animate-in fade-in slide-in-from-top-1">
                  <div className="px-3.5 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    Yazdırma Kapsamını Seçin
                  </div>
                  <button
                    type="button"
                    onClick={() => handlePrint('all')}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center gap-2.5 text-slate-800 font-semibold transition-colors cursor-pointer"
                  >
                    <Printer size={15} className="text-slate-500" />
                    <div>
                      <div className="font-bold text-slate-900">📑 Tüm Sayfayı Yazdır (Komple)</div>
                      <div className="text-[10px] text-slate-400 font-normal">Tüm kırılımlar ve irsaliyeler birlikte</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrint('products')}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50 flex items-center gap-2.5 text-slate-800 font-semibold transition-colors cursor-pointer"
                  >
                    <Package size={15} className="text-blue-600" />
                    <div>
                      <div className="font-bold text-blue-900">📦 Sadece Ürün Bazında Sevk Kırılımı</div>
                      <div className="text-[10px] text-slate-400 font-normal">Yalnızca sevk edilen ürünler tablosu</div>
                    </div>
                  </button>
                  {analysisResults.customerBreakdown.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handlePrint('customers')}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-purple-50 flex items-center gap-2.5 text-slate-800 font-semibold transition-colors cursor-pointer"
                    >
                      <Users size={15} className="text-purple-600" />
                      <div>
                        <div className="font-bold text-purple-900">👥 Sadece Müşteri Bazında Dağılım</div>
                        <div className="text-[10px] text-slate-400 font-normal">Müşterilere göre sevk özet tablosu</div>
                      </div>
                    </button>
                  )}
                  {analysisResults.siteBreakdown.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handlePrint('sites')}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50 flex items-center gap-2.5 text-slate-800 font-semibold transition-colors cursor-pointer"
                    >
                      <Building2 size={15} className="text-amber-600" />
                      <div>
                        <div className="font-bold text-amber-900">🏗️ Sadece Şantiye Bazında Dağılım</div>
                        <div className="text-[10px] text-slate-400 font-normal">Şantiyelere göre sevk özet tablosu</div>
                      </div>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handlePrint('shipments')}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 flex items-center gap-2.5 text-slate-800 font-semibold transition-colors cursor-pointer"
                  >
                    <Truck size={15} className="text-emerald-600" />
                    <div>
                      <div className="font-bold text-emerald-900">🚚 Sadece Kronolojik İrsaliye Dökümü</div>
                      <div className="text-[10px] text-slate-400 font-normal">Tüm sefer, araç ve irsaliye detay listesi</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1 px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl text-xs font-semibold border border-slate-200 transition-colors"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Yenile</span>
            </button>
          </div>
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Müşteri Seçimi */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Müşteri / Cari Seçimi
            </label>
            <select
              value={queryCustomerId}
              onChange={e => {
                setQueryCustomerId(e.target.value);
                setQuerySiteId('');
              }}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              <option value="">-- Tüm Müşteriler (Genel Özet) --</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* 2. Şantiye Seçimi */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Şantiye / Saha
            </label>
            <select
              value={querySiteId}
              onChange={e => setQuerySiteId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              <option value="">-- Tüm Şantiyeler --</option>
              {querySites.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* 3. Başlangıç Tarihi */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Başlangıç Tarihi
            </label>
            <div className="relative">
              <input
                type="date"
                value={queryStartDate}
                onChange={e => setQueryStartDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
              {queryStartDate && (
                <button
                  type="button"
                  onClick={() => setQueryStartDate('')}
                  className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                  title="Temizle"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* 4. Bitiş Tarihi */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Bitiş Tarihi
            </label>
            <div className="relative">
              <input
                type="date"
                value={queryEndDate}
                onChange={e => setQueryEndDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
              {queryEndDate && (
                <button
                  type="button"
                  onClick={() => setQueryEndDate('')}
                  className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                  title="Temizle"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Date Presets & Secondary Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-medium mr-1 text-[11px]">Hızlı Tarih:</span>
            <button
              type="button"
              onClick={() => handleDatePreset('today')}
              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
            >
              Bugün
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('week')}
              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
            >
              Bu Hafta
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('month')}
              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
            >
              Bu Ay
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('30days')}
              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
            >
              Son 30 Gün
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('year')}
              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
            >
              Bu Yıl
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('all')}
              className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 font-medium transition-colors"
            >
              Tüm Zamanlar
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Ürün Filtresi */}
            <select
              value={queryProductId}
              onChange={e => setQueryProductId(e.target.value)}
              className="border border-slate-200 rounded-xl px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              <option value="">Tüm Ürünler</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.thickness})</option>
              ))}
            </select>

            {/* Birim Filtresi */}
            <select
              value={queryUnit}
              onChange={e => setQueryUnit(e.target.value)}
              className="border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              <option value="all">Tüm Birimler</option>
              <option value="m2">m² (Metrekare)</option>
              <option value="metre">Metre (Bordür)</option>
              <option value="adet">Adet</option>
            </select>

            {/* Arama */}
            <div className="relative w-44">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="İrsaliye, plaka..."
                value={querySearch}
                onChange={e => setQuerySearch(e.target.value)}
                className="w-full pl-7 pr-2 py-1 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── PRINT-ONLY OFFICIAL HEADER ── */}
      <div className="print-only border-b-2 border-slate-800 pb-3 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">PARKE ERP • FABRİKA YÖNETİM SİSTEMİ</h1>
            <h2 className="text-sm font-bold text-blue-900 uppercase mt-0.5">
              {printScope === 'products'
                ? '📦 MÜŞTERİ SEVK EKSTRESİ — ÜRÜN BAZINDA SEVK KIRILIMI RAPORU'
                : printScope === 'customers'
                ? '👥 MÜŞTERİ SEVK EKSTRESİ — MÜŞTERİ BAZINDA DAĞILIM RAPORU'
                : printScope === 'sites'
                ? '🏗️ MÜŞTERİ SEVK EKSTRESİ — ŞANTİYE BAZINDA DAĞILIM RAPORU'
                : printScope === 'shipments'
                ? '🚚 MÜŞTERİ SEVK EKSTRESİ — KRONOLOJİK SEVKİYAT & İRSALİYE DÖKÜMÜ'
                : '📑 MÜŞTERİ SEVK EKSTRESİ & DETAYLI SEVKİYAT RAPORU'}
            </h2>
          </div>
          <div className="text-right text-[10px] text-slate-600 font-mono">
            <div><strong>Yazdırma Tarihi:</strong> {new Date().toLocaleString('tr-TR')}</div>
            <div><strong>Rapor Dönemi:</strong> {queryStartDate || 'Başlangıç'} → {queryEndDate || 'Bugün'}</div>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2 rounded border border-slate-200">
          <div>
            <span className="text-slate-500 font-semibold">Müşteri / Cari: </span>
            <strong className="text-slate-900">{selectedCustomerObj ? selectedCustomerObj.name : 'Tüm Müşteriler (Genel Özet)'}</strong>
            {selectedCustomerObj?.phone && <span className="text-slate-500 ml-1">({selectedCustomerObj.phone})</span>}
          </div>
          <div className="text-right">
            <span className="text-slate-500 font-semibold">Teslim Şantiyesi: </span>
            <strong className="text-slate-900">{selectedSiteObj ? selectedSiteObj.name : (querySiteId ? 'Özel Şantiye' : 'Tüm Şantiyeler')}</strong>
          </div>
        </div>
      </div>

      {/* ── ACTIVE CUSTOMER BANNER (SCREEN ONLY) ── */}
      <div className="bg-gradient-to-r from-blue-900 to-slate-900 text-white rounded-2xl p-5 shadow-sm no-print">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-xs text-blue-300 font-semibold uppercase tracking-wider">
              Müşteri Sevk Ekstresi & Raporu
            </span>
            <h2 className="text-xl sm:text-2xl font-bold mt-1">
              {selectedCustomerObj ? selectedCustomerObj.name : 'Tüm Müşteriler Genel Özeti'}
            </h2>
            {selectedCustomerObj && (
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 mt-1.5">
                {selectedCustomerObj.phone && (
                  <span className="flex items-center gap-1">
                    <Phone size={13} className="text-blue-400" />
                    {selectedCustomerObj.phone}
                  </span>
                )}
                {selectedCustomerObj.address && (
                  <span className="flex items-center gap-1">
                    <MapPin size={13} className="text-blue-400" />
                    {selectedCustomerObj.address}
                  </span>
                )}
                {querySiteId && (
                  <span className="bg-blue-800/60 px-2 py-0.5 rounded-lg text-blue-200 font-medium">
                    Şantiye: {sites.find(s => s.id === querySiteId)?.name}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/10 text-right min-w-[200px]">
            <span className="text-[11px] text-blue-200 block">Sorgu Tarih Aralığı:</span>
            <strong className="text-sm font-mono block">
              {queryStartDate ? new Date(queryStartDate).toLocaleDateString('tr-TR') : 'Başlangıçtan'}
              {' → '}
              {queryEndDate ? new Date(queryEndDate).toLocaleDateString('tr-TR') : 'Bugüne'}
            </strong>
            <span className="text-[10px] text-blue-300 mt-0.5 block">
              Toplam {analysisResults.totalShipments} Sefer • {analysisResults.matchedCount} Sevkiyat Kalemi
            </span>
          </div>
        </div>
      </div>

      {/* ── KPI METRIC CARDS (SHOW IN PRINT SUMMARY) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Toplam m² */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold text-slate-500">Toplam m²</span>
            <Layers size={15} className="text-blue-500 no-print" />
          </div>
          <p className="text-xl font-black text-slate-900 font-mono">
            {analysisResults.totalM2.toLocaleString('tr-TR')}
          </p>
          <span className="text-[10px] text-slate-400 font-medium">Metrekare parke</span>
        </div>

        {/* Toplam Metre */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold text-slate-500">Toplam Metre</span>
            <TrendingUp size={15} className="text-amber-500 no-print" />
          </div>
          <p className="text-xl font-black text-slate-900 font-mono">
            {analysisResults.totalMetre.toLocaleString('tr-TR')}
          </p>
          <span className="text-[10px] text-slate-400 font-medium">Bordür / Oluk (tül)</span>
        </div>

        {/* Toplam Adet */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold text-slate-500">Toplam Adet</span>
            <Package size={15} className="text-purple-500 no-print" />
          </div>
          <p className="text-xl font-black text-slate-900 font-mono">
            {analysisResults.totalAdet.toLocaleString('tr-TR')}
          </p>
          <span className="text-[10px] text-slate-400 font-medium">Adetli ürünler</span>
        </div>

        {/* Toplam Palet */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold text-slate-500">Toplam Palet</span>
            <Boxes size={15} className="text-orange-500 no-print" />
          </div>
          <p className="text-xl font-black text-slate-900 font-mono">
            {analysisResults.totalPallets.toLocaleString('tr-TR')}
          </p>
          <span className="text-[10px] text-slate-400 font-medium">Sevk edilen palet</span>
        </div>

        {/* Sefer / İrsaliye */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold text-slate-500">Toplam Sefer</span>
            <Truck size={15} className="text-emerald-500 no-print" />
          </div>
          <p className="text-xl font-black text-slate-900 font-mono">
            {analysisResults.totalShipments}
          </p>
          <span className="text-[10px] text-slate-400 font-medium">Araç / İrsaliye</span>
        </div>

        {/* Net Tonaj */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 print-clean">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold text-slate-500">Net Tonaj</span>
            <Scale size={15} className="text-slate-500 no-print" />
          </div>
          <p className="text-xl font-black text-slate-900 font-mono">
            {(analysisResults.totalNetWeightKg / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Ton
          </p>
          <span className="text-[10px] text-slate-400 font-medium">
            {analysisResults.totalNetWeightKg.toLocaleString('tr-TR')} kg net
          </span>
        </div>
      </div>

      {/* ── 1. PRODUCT BREAKDOWN TABLE ── */}
      <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print-clean ${
        printScope !== 'all' && printScope !== 'products' ? 'print-hidden' : ''
      }`}>
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-slate-700 no-print" />
            <h3 className="font-bold text-slate-900 text-sm">Ürün Bazında Sevk Kırılımı</h3>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-slate-500 font-medium">
              {analysisResults.productBreakdown.length} Farklı Ürün
            </span>
            <button
              type="button"
              onClick={() => handlePrint('products')}
              className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 hover:text-blue-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer no-print"
              title="Sadece bu ürün tablosunu yazdır veya PDF olarak kaydet"
            >
              <Printer size={13} className="text-blue-600" />
              <span>Bu Bölümü Yazdır</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                <th className="px-4 py-3">Ürün Adı</th>
                <th className="px-3 py-3">Özellik (Kalınlık / Renk)</th>
                <th className="px-3 py-3 text-right">Sevk Miktarı</th>
                <th className="px-3 py-3 text-right">Palet</th>
                <th className="px-3 py-3 text-right">Sefer</th>
                <th className="px-4 py-3 min-w-[150px] no-print">Dağılım Payı</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analysisResults.productBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Belirtilen tarih aralığında ve kriterlere uygun sevk edilmiş ürün bulunamadı.
                  </td>
                </tr>
              ) : (
                analysisResults.productBreakdown.map((p, idx) => {
                  const baseTotal = p.unit === 'metre'
                    ? analysisResults.totalMetre
                    : p.unit === 'adet'
                    ? analysisResults.totalAdet
                    : analysisResults.totalM2;
                  const sharePct = baseTotal > 0 ? Math.round((p.total_qty / baseTotal) * 100) : 0;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {p.name}
                      </td>
                      <td className="px-3 py-3 text-slate-500">
                        {p.thickness ? `${p.thickness}` : '-'}
                        {p.color ? ` / ${p.color}` : ''}
                      </td>
                      <td className="px-3 py-3 text-right font-extrabold text-blue-900 font-mono text-sm">
                        {p.total_qty.toLocaleString('tr-TR')} {p.unit === 'metre' ? 'Metre' : p.unit === 'adet' ? 'Adet' : 'm²'}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-700 font-mono">
                        {p.total_pallets > 0 ? `${p.total_pallets.toLocaleString('tr-TR')} Palet` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">
                        {p.shipment_count} Sefer
                      </td>
                      <td className="px-4 py-3 no-print">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${Math.min(sharePct, 100)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold text-slate-600 min-w-[32px] text-right">
                            %{sharePct}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── DISTRIBUTION VIEW MODE SELECTOR (MÜŞTERİ / ŞANTİYE / TÜMÜ) ── */}
      <div className="flex items-center justify-between flex-wrap gap-2 no-print bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 pl-2">
          <Layers size={14} className="text-slate-500" />
          <span>Dağılım Raporu:</span>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setDistributionView('both')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              distributionView === 'both'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            🔄 Tümü (Müşteri & Şantiye)
          </button>
          <button
            type="button"
            onClick={() => setDistributionView('customer')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              distributionView === 'customer'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Users size={13} />
            <span>Müşteri Bazında ({analysisResults.customerBreakdown.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setDistributionView('site')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              distributionView === 'site'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Building2 size={13} />
            <span>Şantiye Bazında ({analysisResults.siteBreakdown.length})</span>
          </button>
        </div>
      </div>

      {/* ── 2A. CUSTOMER BREAKDOWN TABLE ── */}
      {(distributionView === 'both' || distributionView === 'customer') && analysisResults.customerBreakdown.length > 0 && (
        <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print-clean ${
          printScope !== 'all' && printScope !== 'customers' ? 'print-hidden' : ''
        }`}>
          <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-purple-700 no-print" />
              <h3 className="font-bold text-slate-900 text-sm">Müşteri / Cari Bazında Dağılım</h3>
              {queryCustomerId && (
                <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200 no-print">
                  Filtreli
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              {queryCustomerId && (
                <button
                  type="button"
                  onClick={() => {
                    setQueryCustomerId('');
                    setQuerySiteId('');
                  }}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-purple-700 bg-white hover:bg-purple-50 border border-slate-200 rounded-lg shadow-xs transition-colors cursor-pointer no-print flex items-center gap-1"
                >
                  <X size={12} />
                  <span>Tüm Carileri Göster</span>
                </button>
              )}
              <span className="text-xs text-purple-700 font-semibold bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-100">
                {analysisResults.customerBreakdown.length} Müşteri / Cari
              </span>
              <button
                type="button"
                onClick={() => handlePrint('customers')}
                className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 hover:text-purple-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer no-print"
                title="Sadece bu müşteri tablosunu yazdır veya PDF olarak kaydet"
              >
                <Printer size={13} className="text-purple-600" />
                <span>Bu Bölümü Yazdır</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                  <th className="px-4 py-3">Müşteri / Cari Ünvanı</th>
                  <th className="px-3 py-3">Sevk Giden Şantiyeler</th>
                  <th className="px-3 py-3 text-right">Sevk (m²)</th>
                  <th className="px-3 py-3 text-right">Sevk (Metre)</th>
                  <th className="px-3 py-3 text-right">Sevk (Adet)</th>
                  <th className="px-3 py-3 text-right">Palet Sayısı</th>
                  <th className="px-3 py-3 text-right">Sefer Adedi</th>
                  <th className="px-4 py-3 min-w-[130px] no-print">Dağılım Payı</th>
                  <th className="px-3 py-3 text-center no-print">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysisResults.customerBreakdown.map((c, idx) => {
                  const baseTotal = analysisResults.totalM2 > 0
                    ? analysisResults.totalM2
                    : analysisResults.totalMetre > 0
                    ? analysisResults.totalMetre
                    : analysisResults.totalAdet;
                  const compareVal = analysisResults.totalM2 > 0
                    ? c.total_m2
                    : analysisResults.totalMetre > 0
                    ? c.total_metre
                    : c.total_adet;
                  const sharePct = baseTotal > 0 ? Math.round((compareVal / baseTotal) * 100) : 0;
                  const isSelected = queryCustomerId === c.customer_id;
                  const siteList = Array.from(c.sites);

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{c.name}</div>
                        {c.phone && (
                          <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                            <Phone size={10} />
                            <span>{c.phone}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {siteList.length > 0 ? (
                            siteList.map((stName, sIdx) => (
                              <span
                                key={sIdx}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium"
                              >
                                <MapPin size={9} className="text-slate-400" />
                                {stName}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-slate-800">
                        {c.total_m2 > 0 ? `${c.total_m2.toLocaleString('tr-TR')} m²` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">
                        {c.total_metre > 0 ? `${c.total_metre.toLocaleString('tr-TR')} m` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-700">
                        {c.total_adet > 0 ? `${c.total_adet.toLocaleString('tr-TR')} adet` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">
                        {c.total_pallets > 0 ? `${c.total_pallets.toLocaleString('tr-TR')} Palet` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-purple-700">
                        {c.shipment_count} Sefer
                      </td>
                      <td className="px-4 py-3 no-print">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full"
                              style={{ width: `${Math.min(sharePct, 100)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold text-purple-700 min-w-[32px] text-right">
                            %{sharePct}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center no-print">
                        {isSelected ? (
                          <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold border border-emerald-200">
                            Seçili
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setQueryCustomerId(c.customer_id);
                              setQuerySiteId('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                            title="Bu carinin tüm şantiye ve irsaliyelerini filtrele"
                          >
                            <Search size={11} />
                            <span>İncele</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 2B. SITE BREAKDOWN TABLE ── */}
      {(distributionView === 'both' || distributionView === 'site') && analysisResults.siteBreakdown.length > 0 && (
        <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print-clean ${
          printScope !== 'all' && printScope !== 'sites' ? 'print-hidden' : ''
        }`}>
          <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-amber-700 no-print" />
              <h3 className="font-bold text-slate-900 text-sm">Şantiye Bazında Dağılım</h3>
              {querySiteId && (
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 no-print">
                  Filtreli
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              {querySiteId && (
                <button
                  type="button"
                  onClick={() => setQuerySiteId('')}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-amber-700 bg-white hover:bg-amber-50 border border-slate-200 rounded-lg shadow-xs transition-colors cursor-pointer no-print flex items-center gap-1"
                >
                  <X size={12} />
                  <span>Tüm Şantiyeleri Göster</span>
                </button>
              )}
              <span className="text-xs text-amber-700 font-semibold bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-100">
                {analysisResults.siteBreakdown.length} Şantiye
              </span>
              <button
                type="button"
                onClick={() => handlePrint('sites')}
                className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 hover:text-amber-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer no-print"
                title="Sadece bu şantiye tablosunu yazdır veya PDF olarak kaydet"
              >
                <Printer size={13} className="text-amber-600" />
                <span>Bu Bölümü Yazdır</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                  <th className="px-4 py-3">Şantiye Adı</th>
                  <th className="px-3 py-3">Müşteri / Cari</th>
                  <th className="px-3 py-3 text-right">Sevk (m²)</th>
                  <th className="px-3 py-3 text-right">Sevk (Metre)</th>
                  <th className="px-3 py-3 text-right">Sevk (Adet)</th>
                  <th className="px-3 py-3 text-right">Palet Sayısı</th>
                  <th className="px-3 py-3 text-right">Sefer Adedi</th>
                  <th className="px-4 py-3 min-w-[130px] no-print">Dağılım Payı</th>
                  <th className="px-3 py-3 text-center no-print">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysisResults.siteBreakdown.map((st, idx) => {
                  const baseTotal = analysisResults.totalM2 > 0
                    ? analysisResults.totalM2
                    : analysisResults.totalMetre > 0
                    ? analysisResults.totalMetre
                    : analysisResults.totalAdet;
                  const compareVal = analysisResults.totalM2 > 0
                    ? st.total_m2
                    : analysisResults.totalMetre > 0
                    ? st.total_metre
                    : st.total_adet;
                  const sharePct = baseTotal > 0 ? Math.round((compareVal / baseTotal) * 100) : 0;
                  const isSiteSelected = querySiteId === st.site_id && st.site_id !== 'unassigned';

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {st.name}
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-700">
                        {st.customer_name}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-slate-800">
                        {st.total_m2 > 0 ? `${st.total_m2.toLocaleString('tr-TR')} m²` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold text-slate-700">
                        {st.total_metre > 0 ? `${st.total_metre.toLocaleString('tr-TR')} m` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-700">
                        {st.total_adet > 0 ? `${st.total_adet.toLocaleString('tr-TR')} adet` : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-slate-600">
                        {st.total_pallets.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-amber-700">
                        {st.shipment_count} Sefer
                      </td>
                      <td className="px-4 py-3 no-print">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 rounded-full"
                              style={{ width: `${Math.min(sharePct, 100)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold text-amber-700 min-w-[32px] text-right">
                            %{sharePct}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center no-print">
                        {isSiteSelected ? (
                          <span className="inline-flex items-center px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold border border-emerald-200">
                            Seçili
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (st.customer_id) setQueryCustomerId(st.customer_id);
                              if (st.site_id && st.site_id !== 'unassigned') setQuerySiteId(st.site_id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                            title="Bu şantiyeyi filtrele"
                          >
                            <Search size={11} />
                            <span>İncele</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 3. DETAILED SHIPMENT / WAYBILL LIST ── */}
      <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print-clean ${
        printScope !== 'all' && printScope !== 'shipments' ? 'print-hidden' : ''
      }`}>
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-slate-700 no-print" />
            <h3 className="font-bold text-slate-900 text-sm">Kronolojik Sevkiyat & İrsaliye Dökümü</h3>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-slate-500 font-medium">
              {analysisResults.shipmentList.length} İrsaliye
            </span>
            <button
              type="button"
              onClick={() => handlePrint('shipments')}
              className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 hover:text-emerald-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer no-print"
              title="Sadece bu irsaliye dökümünü yazdır veya PDF olarak kaydet"
            >
              <Printer size={13} className="text-emerald-600" />
              <span>Bu Bölümü Yazdır</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                <th className="px-3 py-3">Tarih</th>
                <th className="px-3 py-3">İrsaliye No</th>
                <th className="px-3 py-3">Müşteri</th>
                <th className="px-3 py-3">Şantiye</th>
                <th className="px-3 py-3">Araç / Plaka</th>
                <th className="px-3 py-3">Sürücü</th>
                <th className="px-3 py-3">Taşınan Ürünler & Miktarlar</th>
                <th className="px-3 py-3 text-right">Palet</th>
                <th className="px-3 py-3 text-right">Net Tonaj</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {analysisResults.shipmentList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 font-sans">
                    Kriterlere uygun sevkiyat irsaliyesi bulunamadı.
                  </td>
                </tr>
              ) : (
                analysisResults.shipmentList.map((sg, idx) => {
                  const s = sg.shipment;
                  const cName = customers.find(c => c.id === s.customer_id)?.name || '-';
                  const sName = sites.find(st => st.id === s.site_id)?.name || 'Direkt Sevk';
                  const gross = Number(s.gross_weight) || 0;
                  const tare = Number(s.tare_weight) || 0;
                  const netWeight = gross > tare ? gross - tare : 0;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                        {s.shipment_date ? new Date(s.shipment_date).toLocaleDateString('tr-TR') : '-'}
                      </td>
                      <td className="px-3 py-3 font-bold text-slate-900 whitespace-nowrap">
                        #{s.invoice_no || 'TARTIM'}
                      </td>
                      <td className="px-3 py-3 text-slate-800 font-sans font-semibold max-w-[140px] truncate" title={cName}>
                        {cName}
                      </td>
                      <td className="px-3 py-3 text-slate-600 font-sans max-w-[120px] truncate" title={sName}>
                        {sName}
                      </td>
                      <td className="px-3 py-3 font-bold text-slate-900 whitespace-nowrap">
                        {s.vehicle_plate || '-'}
                      </td>
                      <td className="px-3 py-3 text-slate-500 font-sans">
                        {s.driver_name || '-'}
                      </td>
                      <td className="px-3 py-3 font-sans">
                        <div className="space-y-0.5">
                          {sg.items.map((it, itemIdx) => {
                            const p = products.find(prod => prod.id === it.product_id);
                            const u = getEffectiveUnit(it, products);
                            const uLabel = u === 'metre' ? 'm' : u === 'adet' ? 'ad.' : 'm²';
                            return (
                              <div key={itemIdx} className="text-[11px] text-slate-700">
                                <span className="font-semibold">{p?.name || 'Ürün'}:</span>{' '}
                                <strong className="text-blue-900 font-mono">
                                  {Number(it.m2).toLocaleString('tr-TR')} {uLabel}
                                </strong>{' '}
                                {it.pallets > 0 && <span className="text-slate-400 font-mono text-[10px]">({it.pallets} palet)</span>}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-slate-800">
                        {sg.total_pallets > 0 ? sg.total_pallets : '-'}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">
                        {netWeight > 0 ? `${(netWeight / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} t` : '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
