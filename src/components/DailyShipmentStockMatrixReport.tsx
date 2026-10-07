import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Product, Customer, Site } from '../types';
import {
  Table, ChevronLeft, ChevronRight, ChevronDown, ChevronsUpDown, Download, Printer,
  RefreshCw, Layers, Building2, Package, Check, AlertTriangle,
  Filter, CheckSquare, Square, Users, Target, X, Search, Boxes, MapPin,
  ClipboardList, CheckCircle2, Factory, TrendingUp
} from 'lucide-react';

import {
  calculateAllQuotas,
  calculateCustomerQuotaMap,
  calculateSiteQuotaMap,
  CustomerQuotaSummary,
  SiteQuotaSummary,
  QuotaMetric,
} from '../utils/quotaCalculator';

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface PalletBalanceEntry {
  customer_id: string;
  customer_name: string;
  site_id: string | null;
  site_name: string | null;
  pallet_type: string;
  total_sent: number;
  total_returned: number;
  balance: number;
}

export default function DailyShipmentStockMatrixReport() {
  const { user } = useAuth();

  // View Mode: 'plan' (Sade Sipariş & Üretim Planlama Tablosu - Varsayılan) | 'matrix' (Geniş Ürün Matrisi)
  const [activeViewMode, setActiveViewMode] = useState<'plan' | 'matrix'>('plan');

  // Mode: 'single' (tek gün - Excel'deki gibi) or 'range' (tarih aralığı)
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single');
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr(new Date()));
  const [startDate, setStartDate] = useState<string>(getLocalDateStr(new Date()));
  const [endDate, setEndDate] = useState<string>(getLocalDateStr(new Date()));

  // Matrix Cell Value Mode: 'cumulative' (default: sevk edilen toplam ürün miktarı) | 'daily' (günlük sevk) | 'both' (her ikisi)
  const [matrixCellMode, setMatrixCellMode] = useState<'cumulative' | 'daily' | 'both'>('cumulative');

  // Filters
  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'parke' | 'bordur' | 'diger'>('all');
  const [customerFilterMode, setCustomerFilterMode] = useState<'all' | 'with_quota' | 'shipped_only' | 'custom'>('all');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);
  const [customerModalSearch, setCustomerModalSearch] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Expand / Collapse State for Customer Child Sites
  const [expandedCustomerIds, setExpandedCustomerIds] = useState<Set<string>>(new Set());

  // Scroll Container Ref for Quick Navigation
  const matrixScrollRef = useRef<HTMLDivElement>(null);

  // Raw Database Data
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [palletBalances, setPalletBalances] = useState<PalletBalanceEntry[]>([]);
  const [shipmentItems, setShipmentItems] = useState<any[]>([]);
  const [productionEntries, setProductionEntries] = useState<any[]>([]);
  const [stockViewData, setStockViewData] = useState<any[]>([]);
  const [quotas, setQuotas] = useState<any[]>([]);
  const [cumulativeShipmentItems, setCumulativeShipmentItems] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [latestShipmentDate, setLatestShipmentDate] = useState<string | null>(null);

  // Load Data
  const loadData = async () => {
    setLoading(true);
    try {
      const qStart = dateMode === 'single' ? selectedDate : startDate;
      const qEnd = dateMode === 'single' ? selectedDate : endDate;

      const [prodRes, custRes, sitesRes, palletBalRes, shipRes, prodEntriesRes, stockRes, latestShipRes, quotasRes, cumShipItemsRes] = await Promise.all([
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('sites').select('*').order('name'),
        supabase.from('v_pallet_balances').select('*'),
        supabase
          .from('shipments')
          .select(`
            id,
            shipment_date,
            customer_id,
            site_id,
            status,
            invoice_no,
            vehicle_plate,
            customers(name),
            sites(name),
            shipment_items (
              id,
              product_id,
              m2,
              unit,
              pallets,
              pallet_type
            )
          `)
          .eq('status', 'completed')
          .gte('shipment_date', qStart)
          .lte('shipment_date', qEnd),
        supabase
          .from('production_entries')
          .select('id, date, product_id, net_m2, total_m2, shift, machine_no, notes')
          .gte('date', qStart)
          .lte('date', qEnd),
        supabase.from('v_product_stock').select('*'),
        supabase
          .from('shipments')
          .select('shipment_date')
          .eq('status', 'completed')
          .order('shipment_date', { ascending: false })
          .limit(1),
        supabase
          .from('customer_quotas')
          .select('*, products(*), sites(*)')
          .eq('is_active', true),
        supabase
          .from('shipment_items')
          .select(`
            id,
            product_id,
            m2,
            unit,
            shipments!inner (
              id,
              shipment_date,
              customer_id,
              site_id,
              status
            )
          `)
          .eq('shipments.status', 'completed')
          .limit(50000),
      ]);

      if (prodRes.data) setProducts(prodRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (sitesRes.data) setSites(sitesRes.data);
      if (palletBalRes.data) setPalletBalances(palletBalRes.data);
      if (stockRes.data) setStockViewData(stockRes.data);
      if (quotasRes.data) setQuotas(quotasRes.data);
      if (cumShipItemsRes.data) setCumulativeShipmentItems(cumShipItemsRes.data);

      if (latestShipRes.data && latestShipRes.data.length > 0) {
        setLatestShipmentDate(latestShipRes.data[0].shipment_date);
      }

      if (shipRes.data) {
        const flatItems: any[] = [];
        shipRes.data.forEach((s: any) => {
          const sDate = s.shipment_date;
          if (dateMode === 'single' && sDate !== selectedDate) return;
          if (dateMode === 'range' && (sDate < startDate || sDate > endDate)) return;

          (s.shipment_items || []).forEach((it: any) => {
            flatItems.push({
              ...it,
              shipments: s,
            });
          });
        });
        setShipmentItems(flatItems);
      } else {
        setShipmentItems([]);
      }

      if (prodEntriesRes.data && prodEntriesRes.data.length > 0) {
        setProductionEntries(prodEntriesRes.data);
      } else {
        setProductionEntries([]);
      }
    } catch (err) {
      console.error('Matris veri yükleme hatası:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [dateMode, selectedDate, startDate, endDate]);

  // Quick Day Navigation
  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(getLocalDateStr(d));
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(getLocalDateStr(d));
  };

  const handleSetToday = () => {
    setSelectedDate(getLocalDateStr(new Date()));
  };

  // Filtered Products (Columns)
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (productTypeFilter === 'parke' && !p.name.toLowerCase().includes('parke') && !p.name.toLowerCase().includes('prizma') && !p.name.toLowerCase().includes('kilit')) return false;
      if (productTypeFilter === 'bordur' && !p.name.toLowerCase().includes('bordür') && !p.name.toLowerCase().includes('bordur')) return false;
      if (productTypeFilter === 'diger' && (p.name.toLowerCase().includes('parke') || p.name.toLowerCase().includes('bordür'))) return false;
      return true;
    });
  }, [products, productTypeFilter]);

  // Dynamic column width for products so table strictly fills 100% of printable width
  const productColWidthPct = useMemo(() => {
    if (filteredProducts.length === 0) return 56;
    return Number((56 / filteredProducts.length).toFixed(3));
  }, [filteredProducts.length]);

  // Matrix Map:
  // - matrix[customerId][productId] = totalShipped on selected date/range
  // - siteMatrix[customerId][siteKey][productId] = totalShipped on selected date/range for that site
  const {
    matrix,
    siteMatrix,
    customerTotals,
    siteTotals,
    productTotals,
    grandTotalShipped,
    activeCustomerIds,
  } = useMemo(() => {
    const mat: { [cust: string]: { [prod: string]: number } } = {};
    const sMat: { [cust: string]: { [siteKey: string]: { [prod: string]: number } } } = {};
    const cTotals: { [cust: string]: number } = {};
    const sTotals: { [cust: string]: { [siteKey: string]: number } } = {};
    const pTotals: { [prod: string]: number } = {};
    const activeSet = new Set<string>();
    let grandTotal = 0;

    shipmentItems.forEach((item) => {
      const s = item.shipments;
      if (!s) return;
      const sDate = s.shipment_date;
      if (dateMode === 'single' && sDate !== selectedDate) return;
      if (dateMode === 'range' && (sDate < startDate || sDate > endDate)) return;

      const custId = s.customer_id;
      const siteKey = s.site_id || '__unassigned__';
      const prodId = item.product_id;
      const qty = Number(item.m2 || 0);

      if (!custId || !prodId || qty <= 0) return;

      activeSet.add(custId);

      // Customer Level
      if (!mat[custId]) mat[custId] = {};
      mat[custId][prodId] = (mat[custId][prodId] || 0) + qty;
      cTotals[custId] = (cTotals[custId] || 0) + qty;

      // Site Level
      if (!sMat[custId]) sMat[custId] = {};
      if (!sMat[custId][siteKey]) sMat[custId][siteKey] = {};
      sMat[custId][siteKey][prodId] = (sMat[custId][siteKey][prodId] || 0) + qty;

      if (!sTotals[custId]) sTotals[custId] = {};
      sTotals[custId][siteKey] = (sTotals[custId][siteKey] || 0) + qty;

      pTotals[prodId] = (pTotals[prodId] || 0) + qty;
      grandTotal += qty;
    });

    return {
      matrix: mat,
      siteMatrix: sMat,
      customerTotals: cTotals,
      siteTotals: sTotals,
      productTotals: pTotals,
      grandTotalShipped: grandTotal,
      activeCustomerIds: activeSet,
    };
  }, [shipmentItems, dateMode, selectedDate, startDate, endDate]);

  // Cumulative Product Matrix:
  // - cumulativeProductMatrix[customerId][productId] = total cumulative m2
  // - cumulativeSiteProductMatrix[customerId][siteKey][productId] = cumulative m2 for site
  const {
    cumulativeProductMatrix,
    cumulativeSiteProductMatrix,
    cumulativeProductTotals,
    cumulativeCustomerTotals,
    cumulativeSiteTotals,
    grandTotalCumulativeShipped,
  } = useMemo(() => {
    const cumMat: { [cust: string]: { [prod: string]: number } } = {};
    const cumSiteMat: { [cust: string]: { [siteKey: string]: { [prod: string]: number } } } = {};
    const pTotals: { [prod: string]: number } = {};
    const cTotals: { [cust: string]: number } = {};
    const sTotals: { [cust: string]: { [siteKey: string]: number } } = {};
    let grandTot = 0;

    const targetDate = dateMode === 'single' ? selectedDate : endDate;

    (cumulativeShipmentItems || []).forEach((item) => {
      const s = item.shipments;
      if (!s) return;
      if (targetDate && s.shipment_date > targetDate) return;

      const custId = s.customer_id;
      const siteKey = s.site_id || '__unassigned__';
      const prodId = item.product_id;
      const qty = Number(item.m2 || 0);

      if (!custId || !prodId || qty <= 0) return;

      // Customer Level
      if (!cumMat[custId]) cumMat[custId] = {};
      cumMat[custId][prodId] = (cumMat[custId][prodId] || 0) + qty;
      cTotals[custId] = (cTotals[custId] || 0) + qty;

      // Site Level
      if (!cumSiteMat[custId]) cumSiteMat[custId] = {};
      if (!cumSiteMat[custId][siteKey]) cumSiteMat[custId][siteKey] = {};
      cumSiteMat[custId][siteKey][prodId] = (cumSiteMat[custId][siteKey][prodId] || 0) + qty;

      if (!sTotals[custId]) sTotals[custId] = {};
      sTotals[custId][siteKey] = (sTotals[custId][siteKey] || 0) + qty;

      pTotals[prodId] = (pTotals[prodId] || 0) + qty;
      grandTot += qty;
    });

    return {
      cumulativeProductMatrix: cumMat,
      cumulativeSiteProductMatrix: cumSiteMat,
      cumulativeProductTotals: pTotals,
      cumulativeCustomerTotals: cTotals,
      cumulativeSiteTotals: sTotals,
      grandTotalCumulativeShipped: grandTot,
    };
  }, [cumulativeShipmentItems, dateMode, selectedDate, endDate]);

  // Customer & Site Quota Calculations via standardized quotaCalculator engine
  const calculatedQuotas = useMemo(() => {
    return calculateAllQuotas(quotas, cumulativeShipmentItems, products);
  }, [quotas, cumulativeShipmentItems, products]);

  const customerQuotaMap = useMemo(() => {
    return calculateCustomerQuotaMap(calculatedQuotas, customers.map((c) => c.id));
  }, [calculatedQuotas, customers]);

  const siteQuotaMap = useMemo(() => {
    return calculateSiteQuotaMap(calculatedQuotas, customers.map((c) => c.id));
  }, [calculatedQuotas, customers]);

  // Pallet Balances Map for Customer & Site
  // Pallet Balances Map for Customer & Site (Tahta vs Üretim/Sevkiyat ayrımı)
  const {
    customerPalletMap,
    sitePalletMap,
    grandTotalPalletBalance,
    grandTotalTahtaPallet,
    grandTotalUretimSevkiyatPallet,
    grandTotalUretimPallet,
    grandTotalSevkiyatPallet,
  } = useMemo(() => {
    const cMap: Record<string, { total: number; tahta: number; sevkiyat: number; uretim: number; uretimSevkiyat: number }> = {};
    const sMap: Record<string, { total: number; tahta: number; sevkiyat: number; uretim: number; uretimSevkiyat: number }> = {};
    let gTotal = 0;
    let gTahta = 0;
    let gUretim = 0;
    let gSevkiyat = 0;

    (palletBalances || []).forEach((pb) => {
      const cid = pb.customer_id;
      const sid = pb.site_id || '__unassigned__';
      const sKey = `${cid}_${sid}`;
      const qty = Number(pb.balance) || 0;
      const pType = pb.pallet_type;

      if (!cMap[cid]) cMap[cid] = { total: 0, tahta: 0, sevkiyat: 0, uretim: 0, uretimSevkiyat: 0 };
      cMap[cid].total += qty;
      if (pType === 'tahta') {
        cMap[cid].tahta += qty;
        gTahta += qty;
      } else if (pType === 'sevkiyat') {
        cMap[cid].sevkiyat += qty;
        cMap[cid].uretimSevkiyat += qty;
        gSevkiyat += qty;
      } else if (pType === 'uretim') {
        cMap[cid].uretim += qty;
        cMap[cid].uretimSevkiyat += qty;
        gUretim += qty;
      }

      if (!sMap[sKey]) sMap[sKey] = { total: 0, tahta: 0, sevkiyat: 0, uretim: 0, uretimSevkiyat: 0 };
      sMap[sKey].total += qty;
      if (pType === 'tahta') {
        sMap[sKey].tahta += qty;
      } else if (pType === 'sevkiyat') {
        sMap[sKey].sevkiyat += qty;
        sMap[sKey].uretimSevkiyat += qty;
      } else if (pType === 'uretim') {
        sMap[sKey].uretim += qty;
        sMap[sKey].uretimSevkiyat += qty;
      }

      gTotal += qty;
    });

    return {
      customerPalletMap: cMap,
      sitePalletMap: sMap,
      grandTotalPalletBalance: gTotal,
      grandTotalTahtaPallet: gTahta,
      grandTotalUretimSevkiyatPallet: gUretim + gSevkiyat,
      grandTotalUretimPallet: gUretim,
      grandTotalSevkiyatPallet: gSevkiyat,
    };
  }, [palletBalances]);

  // Helper: Child sites for a customer
  const getCustomerChildSites = (customerId: string) => {
    const registeredSites = sites.filter((s) => s.customer_id === customerId);
    const foundSiteIds = new Set<string>(registeredSites.map((s) => s.id));
    const result: { id: string; name: string; isUnassigned?: boolean }[] = registeredSites.map((s) => ({
      id: s.id,
      name: s.name,
    }));

    (shipmentItems || []).forEach((item) => {
      const s = item.shipments;
      if (s && s.customer_id === customerId && s.site_id && !foundSiteIds.has(s.site_id)) {
        foundSiteIds.add(s.site_id);
        result.push({
          id: s.site_id,
          name: s.sites?.name || 'Şantiye',
        });
      }
    });

    (cumulativeShipmentItems || []).forEach((item) => {
      const s = item.shipments;
      if (s && s.customer_id === customerId && s.site_id && !foundSiteIds.has(s.site_id)) {
        foundSiteIds.add(s.site_id);
        result.push({
          id: s.site_id,
          name: 'Şantiye',
        });
      }
    });

    // Check if there is activity without a site
    if (result.length > 0) {
      const hasUnassignedShip = shipmentItems.some((it) => it.shipments?.customer_id === customerId && !it.shipments?.site_id);
      const hasUnassignedCum = cumulativeShipmentItems.some((it) => it.shipments?.customer_id === customerId && !it.shipments?.site_id);
      const hasUnassignedQuota = quotas.some((q) => q.customer_id === customerId && !q.site_id);
      const hasUnassignedPallet = (palletBalances || []).some((pb) => pb.customer_id === customerId && !pb.site_id && pb.balance !== 0);

      if (hasUnassignedShip || hasUnassignedCum || hasUnassignedQuota || hasUnassignedPallet) {
        result.push({
          id: '__unassigned__',
          name: 'Merkez / Şantiyesiz',
          isUnassigned: true,
        });
      }
    }

    return result;
  };

  // Expand / Collapse Handlers
  const handleToggleCustomerExpanded = (customerId: string) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedCustomerIds(new Set(customers.map((c) => c.id)));
  };

  const handleCollapseAll = () => {
    setExpandedCustomerIds(new Set());
  };

  // Quota Customers Count
  const quotaCustomersCount = useMemo(() => {
    return customers.filter((c) => customerQuotaMap[c.id]?.hasQuota).length;
  }, [customers, customerQuotaMap]);

  // Filtered Customers (Rows)
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      // 1. Customer Filter Mode
      if (customerFilterMode === 'with_quota') {
        const qSummary = customerQuotaMap[c.id];
        if (!qSummary?.hasQuota) return false;
      } else if (customerFilterMode === 'shipped_only') {
        if (!activeCustomerIds.has(c.id)) return false;
      } else if (customerFilterMode === 'custom') {
        if (!selectedCustomerIds.has(c.id)) return false;
      }

      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
      }
      return true;
    });
  }, [customers, customerFilterMode, selectedCustomerIds, customerQuotaMap, activeCustomerIds, searchQuery]);

  // Current Stock Map: stockMap[productId] = current_stock
  const stockMap = useMemo(() => {
    const sm: { [prodId: string]: number } = {};
    stockViewData.forEach((stk) => {
      sm[stk.product_id] = Number(stk.current_stock || 0);
    });
    return sm;
  }, [stockViewData]);

  // Daily Production Map: dailyProductionMap[productId] = sum of net_m2 for that day/range
  const dailyProductionMap = useMemo(() => {
    const pm: { [prodId: string]: number } = {};
    productionEntries.forEach((pe) => {
      const qty = Number(pe.net_m2 || pe.total_m2) || 0;
      pm[pe.product_id] = (pm[pe.product_id] || 0) + qty;
    });
    return pm;
  }, [productionEntries]);

  // Product Quota Demands (Total remaining quota needed for each product across displayed customers)
  const productQuotaDemands = useMemo(() => {
    const demands: Record<string, number> = {};
    filteredCustomers.forEach((cust) => {
      const qSummary = customerQuotaMap[cust.id];
      if (!qSummary || !qSummary.hasQuota) return;
      Object.entries(qSummary.productQuotas).forEach(([prodId, pQ]) => {
        if (pQ.remaining > 0) {
          demands[prodId] = (demands[prodId] || 0) + pQ.remaining;
        }
      });
    });
    return demands;
  }, [filteredCustomers, customerQuotaMap]);

  // Sum of product-specific demands vs unassigned general quotas
  const { totalProductQuotaDemandSum, totalUnassignedQuotaRemainingSum, unassignedCustomerNames } = useMemo(() => {
    let pSum = 0;
    Object.values(productQuotaDemands).forEach((qty) => {
      pSum += qty;
    });

    let uSum = 0;
    const names: string[] = [];
    filteredCustomers.forEach((c) => {
      const qSummary = customerQuotaMap[c.id];
      if (qSummary?.hasUnassignedProductQuota && (qSummary.unassignedRemaining ?? 0) > 0) {
        const uRem = qSummary.unassignedRemaining ?? 0;
        uSum += uRem;
        names.push(`${c.name} (${Number(uRem).toLocaleString('tr-TR')})`);
      }
    });

    return {
      totalProductQuotaDemandSum: pSum,
      totalUnassignedQuotaRemainingSum: uSum,
      unassignedCustomerNames: names,
    };
  }, [productQuotaDemands, filteredCustomers, customerQuotaMap]);

  // Summary Totals for Right Columns
  const { totalQuotaTargetSum, totalQuotaShippedSum, totalQuotaRemainingSum } = useMemo(() => {
    let tTarget = 0;
    let tShipped = 0;
    let tRemaining = 0;

    filteredCustomers.forEach((c) => {
      const qSummary = customerQuotaMap[c.id];
      if (qSummary?.hasQuota) {
        tTarget += qSummary.totalTarget;
        tShipped += qSummary.totalShipped;
        tRemaining += qSummary.totalRemaining;
      }
    });

    return {
      totalQuotaTargetSum: tTarget,
      totalQuotaShippedSum: tShipped,
      totalQuotaRemainingSum: tRemaining,
    };
  }, [filteredCustomers, customerQuotaMap]);

  // Factory Stock, Production & Net Balance Grand Totals for Footer & Excel
  const totalFactoryStock = useMemo(() => {
    return filteredProducts.reduce((sum, prod) => sum + (stockMap[prod.id] || 0), 0);
  }, [filteredProducts, stockMap]);

  const totalDailyProduction = useMemo(() => {
    return filteredProducts.reduce((sum, prod) => {
      return sum + (dailyProductionMap[prod.id] || 0);
    }, 0);
  }, [filteredProducts, dailyProductionMap]);

  // Güne Başlangıç Devir Stoğu = Anlık Depo Stoğu - Günlük Üretim + Günlük Sevkiyat
  const totalOpeningStock = useMemo(() => {
    return totalFactoryStock - totalDailyProduction + grandTotalShipped;
  }, [totalFactoryStock, totalDailyProduction, grandTotalShipped]);

  // Gün Sonu Fiili Depo Stoğu (Güne Başlangıç + Üretim - Sevk = Mevcut Depo Stoğu)
  const totalNetBalance = totalFactoryStock;

  // Product Production Need Summaries for Top Cards & Planning View
  const productProductionSummaries = useMemo(() => {
    const list: {
      productId: string;
      productName: string;
      unit: string;
      thickness?: string;
      totalDemand: number;
      currentStock: number;
      todayProduction: number;
      netNeeded: number;
      surplus: number;
      isDeficit: boolean;
    }[] = [];

    products.forEach((p) => {
      const demand = productQuotaDemands[p.id] || 0;
      const stock = stockMap[p.id] || 0;
      const prodToday = dailyProductionMap[p.id] || 0;

      // Only include products that have active open demand OR current factory stock
      if (demand > 0 || stock > 0) {
        const netNeeded = Math.max(0, demand - stock);
        const surplus = Math.max(0, stock - demand);
        list.push({
          productId: p.id,
          productName: p.name,
          unit: p.unit || 'm²',
          thickness: p.thickness,
          totalDemand: demand,
          currentStock: stock,
          todayProduction: prodToday,
          netNeeded,
          surplus,
          isDeficit: demand > stock,
        });
      }
    });

    // Sort: deficits (urgent production needed) first, then by demand desc
    list.sort((a, b) => {
      if (a.isDeficit && !b.isDeficit) return -1;
      if (!a.isDeficit && b.isDeficit) return 1;
      return b.netNeeded - a.netNeeded || b.totalDemand - a.totalDemand;
    });

    return list;
  }, [products, productQuotaDemands, stockMap, dailyProductionMap]);

  const totalNetProductionDemandSum = useMemo(() => {
    return productProductionSummaries.reduce((acc, it) => acc + it.netNeeded, 0);
  }, [productProductionSummaries]);

  // Helper: Get list of products with quotas, actual stock and production need for a customer
  const getCustomerQuotaProducts = (cust: Customer, qSummary?: CustomerQuotaSummary) => {
    if (!qSummary || !qSummary.hasQuota) return [];
    const list: {
      productId: string;
      productName: string;
      shortName: string;
      thickness?: string;
      target: number;
      shipped: number;
      remaining: number;
      stock: number;
      unit: string;
      netNeeded: number;
      surplus: number;
      isDeficit: boolean;
      isUnassigned?: boolean;
    }[] = [];

    if (qSummary.productQuotas) {
      Object.entries(qSummary.productQuotas).forEach(([pId, metric]) => {
        const prod = products.find((p) => p.id === pId);
        const thickness = prod?.thickness;
        const prodName = prod
          ? `${prod.name}${thickness ? ` (${thickness})` : ''}`
          : (metric.productName || 'Tanımlı Taş');
        const shortName = prod ? prod.name : (metric.productName || 'Tanımlı Taş');
        const currentStock = stockMap[pId] || 0;
        const netNeeded = Math.max(0, metric.remaining - currentStock);
        const surplus = Math.max(0, currentStock - metric.remaining);

        list.push({
          productId: pId,
          productName: prodName,
          shortName,
          thickness,
          target: metric.target,
          shipped: metric.shipped,
          remaining: metric.remaining,
          stock: currentStock,
          unit: metric.unit || prod?.unit || 'm²',
          netNeeded,
          surplus,
          isDeficit: metric.remaining > currentStock,
        });
      });
    }

    if (qSummary.hasUnassignedProductQuota && ((qSummary.unassignedTarget ?? qSummary.unassignedQuota ?? 0) > 0 || (qSummary.unassignedRemaining ?? 0) > 0)) {
      const uTarget = qSummary.unassignedTarget ?? qSummary.unassignedQuota ?? 0;
      const uRem = qSummary.unassignedRemaining ?? 0;
      const uShipped = qSummary.unassignedShipped ?? Math.max(0, uTarget - uRem);

      list.push({
        productId: '__unassigned__',
        productName: 'Genel Sözleşme (Taş Belirtilmemiş)',
        shortName: 'Genel Kota',
        target: uTarget,
        shipped: uShipped,
        remaining: uRem,
        stock: 0,
        unit: 'm²',
        netNeeded: uRem,
        surplus: 0,
        isDeficit: uRem > 0,
        isUnassigned: true,
      });
    }

    return list;
  };

  // Helper: Get list of products with quotas for a site
  const getSiteQuotaProducts = (site: { id: string; name: string }, sQuota?: SiteQuotaSummary) => {
    if (!sQuota || !sQuota.hasQuota) return [];
    const list: {
      productId: string;
      productName: string;
      shortName: string;
      thickness?: string;
      target: number;
      shipped: number;
      remaining: number;
      stock: number;
      unit: string;
      netNeeded: number;
      surplus: number;
    }[] = [];

    if (sQuota.productQuotas) {
      Object.entries(sQuota.productQuotas).forEach(([pId, metric]) => {
        const prod = products.find((p) => p.id === pId);
        const thickness = prod?.thickness;
        const prodName = prod
          ? `${prod.name}${thickness ? ` (${thickness})` : ''}`
          : (metric.productName || 'Tanımlı Taş');
        const shortName = prod ? prod.name : (metric.productName || 'Tanımlı Taş');
        const currentStock = stockMap[pId] || 0;
        const netNeeded = Math.max(0, metric.remaining - currentStock);
        const surplus = Math.max(0, currentStock - metric.remaining);

        list.push({
          productId: pId,
          productName: prodName,
          shortName,
          thickness,
          target: metric.target,
          shipped: metric.shipped,
          remaining: metric.remaining,
          stock: currentStock,
          unit: metric.unit || prod?.unit || 'm²',
          netNeeded,
          surplus,
        });
      });
    }

    return list;
  };

  // Export to Excel (.xls)
  const handleExportExcel = () => {
    if (activeViewMode === 'plan') {
      const planTitle = dateMode === 'single'
        ? `MÜŞTERİ SİPARİŞ & ÜRETİM PLANLAMA RAPORU (${selectedDate})`
        : `MÜŞTERİ SİPARİŞ & ÜRETİM PLANLAMA RAPORU (${startDate} - ${endDate})`;

      let planHtml = `
        <table border="1" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px;">
          <thead>
            <tr style="background-color: #0f766e; color: #ffffff; font-weight: bold; text-align: center;">
              <th colspan="9" style="font-size: 14px; padding: 12px;">
                PARKE ERP • ${planTitle}
              </th>
            </tr>
            <tr style="background-color: #f1f5f9; font-weight: bold; text-align: left;">
              <th style="padding: 8px; width: 220px;">MÜŞTERİ / ŞANTİYE</th>
              <th style="padding: 8px; width: 240px;">SİPARİŞ VERİLEN TAŞ</th>
              <th style="padding: 8px; text-align: right; width: 110px;">SÖZLEŞME</th>
              <th style="padding: 8px; text-align: right; width: 110px;">SEVK EDİLEN</th>
              <th style="padding: 8px; text-align: right; width: 120px; background-color: #ffe4e6; color: #9f1239;">KALAN AÇIK</th>
              <th style="padding: 8px; text-align: right; width: 110px; background-color: #dcfce7; color: #166534;">DEPO STOĞU</th>
              <th style="padding: 8px; text-align: center; width: 220px; background-color: #f3e8ff; color: #6b21a8;">NET ÜRETİM İHTİYACI</th>
              <th style="padding: 8px; text-align: right; width: 90px; background-color: #fef9c3;">TAHTA PALET</th>
              <th style="padding: 8px; text-align: right; width: 100px; background-color: #ffedd5;">ÜRETİM/SEVK. PALET</th>
            </tr>
          </thead>
          <tbody>
      `;

      filteredCustomers.forEach((c) => {
        const qSummary = customerQuotaMap[c.id];
        const cPallet = customerPalletMap[c.id] || { total: 0, tahta: 0, sevkiyat: 0, uretim: 0, uretimSevkiyat: 0 };
        const childSites = getCustomerChildSites(c.id);
        const isExpanded = expandedCustomerIds.has(c.id);

        const custProducts = getCustomerQuotaProducts(c, qSummary);

        const prodNames = custProducts.length > 0
          ? custProducts.map((p) => `<b>• ${p.productName}</b>`).join('<br/>')
          : '<span style="color:#94a3b8; font-style:italic;">Serbest Satış / Kotasız</span>';

        const totalTargetStr = custProducts.length > 0
          ? custProducts.map((p) => `${Number(p.target).toLocaleString('tr-TR')} ${p.unit}`).join('<br/>')
          : '-';

        const totalShippedStr = custProducts.length > 0
          ? custProducts.map((p) => `${Number(p.shipped).toLocaleString('tr-TR')} ${p.unit}`).join('<br/>')
          : (customerTotals[c.id] ? `${Number(customerTotals[c.id]).toLocaleString('tr-TR')} m²` : (cumulativeCustomerTotals[c.id] ? `${Number(cumulativeCustomerTotals[c.id]).toLocaleString('tr-TR')} m²` : '-'));

        const totalRemStr = custProducts.length > 0
          ? custProducts.map((p) => `${Number(p.remaining).toLocaleString('tr-TR')} ${p.unit}`).join('<br/>')
          : '-';

        const totalStockStr = custProducts.length > 0
          ? custProducts.map((p) => p.isUnassigned ? '-' : `${Number(p.stock).toLocaleString('tr-TR')} ${p.unit}`).join('<br/>')
          : '-';

        const productionStatusStr = custProducts.length > 0
          ? custProducts.map((p) => {
              if (p.remaining <= 0) return `<span style="color: #2563eb; font-weight: bold;">✅ ${p.shortName}: Kota Doldu</span>`;
              if (p.netNeeded > 0) return `<span style="color: #be123c; font-weight: bold;">⚠️ <b>${p.shortName}</b>: ${Number(p.netNeeded).toLocaleString('tr-TR')} ${p.unit} Üretilmeli</span>`;
              return `<span style="color: #15803d; font-weight: bold;">✅ <b>${p.shortName}</b>: Stok Yeterli (+${Number(p.surplus).toLocaleString('tr-TR')} ${p.unit})</span>`;
            }).join('<br/>')
          : '-';

        planHtml += `
          <tr style="background-color: #ffffff; vertical-align: top;">
            <td style="padding: 6px; font-weight: bold;">
              ${c.name}
              ${childSites.length > 0 ? `<br/><small style="color: #0f766e;">[${childSites.length} Şantiye ${isExpanded ? 'Açık' : 'Gizli'}]</small>` : ''}
            </td>
            <td style="padding: 6px;">${prodNames}</td>
            <td style="padding: 6px; text-align: right; font-weight: bold;">${totalTargetStr}</td>
            <td style="padding: 6px; text-align: right; color: #1e40af; font-weight: bold;">${totalShippedStr}</td>
            <td style="padding: 6px; text-align: right; color: #9f1239; font-weight: bold; background-color: #fff1f2;">${totalRemStr}</td>
            <td style="padding: 6px; text-align: right; color: #166534; font-weight: bold; background-color: #f0fdf4;">${totalStockStr}</td>
            <td style="padding: 6px; text-align: center; background-color: #faf5ff;">${productionStatusStr}</td>
            <td style="padding: 6px; text-align: right; background-color: #fefce8; color: #854d0e; font-weight: bold;">${cPallet.tahta ? cPallet.tahta.toLocaleString('tr-TR') : '-'}</td>
            <td style="padding: 6px; text-align: right; background-color: #fff7ed; color: #9a3412; font-weight: bold;">${cPallet.uretimSevkiyat ? cPallet.uretimSevkiyat.toLocaleString('tr-TR') : '-'}</td>
          </tr>
        `;

        if (isExpanded && childSites.length > 0) {
          childSites.forEach((site) => {
            const sQuota = siteQuotaMap[c.id]?.[site.id];
            const sPallet = sitePalletMap[`${c.id}_${site.id}`] || { total: 0, tahta: 0, sevkiyat: 0, uretim: 0, uretimSevkiyat: 0 };
            const siteProducts = getSiteQuotaProducts(site, sQuota);

            const siteProdNames = siteProducts.length > 0
              ? siteProducts.map((sp) => `↳ ${sp.productName}`).join('<br/>')
              : '<span style="color:#94a3b8; font-style:italic;">Şantiye Dökümü</span>';

            const siteTargetStr = siteProducts.length > 0
              ? siteProducts.map((sp) => `${Number(sp.target).toLocaleString('tr-TR')} ${sp.unit}`).join('<br/>')
              : (sQuota?.totalTarget ? `${Number(sQuota.totalTarget).toLocaleString('tr-TR')} m²` : '-');

            const siteShippedStr = siteProducts.length > 0
              ? siteProducts.map((sp) => `${Number(sp.shipped).toLocaleString('tr-TR')} ${sp.unit}`).join('<br/>')
              : (sQuota?.totalShipped ? `${Number(sQuota.totalShipped).toLocaleString('tr-TR')} m²` : '-');

            const siteRemStr = siteProducts.length > 0
              ? siteProducts.map((sp) => `${Number(sp.remaining).toLocaleString('tr-TR')} ${sp.unit}`).join('<br/>')
              : (sQuota?.totalRemaining ? `${Number(sQuota.totalRemaining).toLocaleString('tr-TR')} m²` : '-');

            const siteStockStr = siteProducts.length > 0
              ? siteProducts.map((sp) => `${Number(sp.stock).toLocaleString('tr-TR')} ${sp.unit}`).join('<br/>')
              : '-';

            const siteProdStatusStr = siteProducts.length > 0
              ? siteProducts.map((sp) => {
                  if (sp.remaining <= 0) return `<span style="color: #2563eb;">Kota Doldu</span>`;
                  if (sp.netNeeded > 0) return `<span style="color: #be123c;">⚠️ ${sp.shortName}: ${Number(sp.netNeeded).toLocaleString('tr-TR')} ${sp.unit} Açık</span>`;
                  return `<span style="color: #15803d;">✅ ${sp.shortName}: Stok Var</span>`;
                }).join('<br/>')
              : '-';

            planHtml += `
              <tr style="background-color: #f8fafc; font-size: 10px; color: #475569; vertical-align: top;">
                <td style="padding: 4px 4px 4px 22px; font-style: italic;">
                  ↳ ${site.isUnassigned ? 'Merkez / Şantiyesiz' : `Şantiye: ${site.name}`}
                </td>
                <td style="padding: 4px;">${siteProdNames}</td>
                <td style="padding: 4px; text-align: right;">${siteTargetStr}</td>
                <td style="padding: 4px; text-align: right; color: #1e40af;">${siteShippedStr}</td>
                <td style="padding: 4px; text-align: right; color: #9f1239; background-color: #fff1f2;">${siteRemStr}</td>
                <td style="padding: 4px; text-align: right; color: #166534; background-color: #f0fdf4;">${siteStockStr}</td>
                <td style="padding: 4px; text-align: center; background-color: #faf5ff;">${siteProdStatusStr}</td>
                <td style="padding: 4px; text-align: right; background-color: #fefce8;">${sPallet.tahta ? sPallet.tahta.toLocaleString('tr-TR') : '-'}</td>
                <td style="padding: 4px; text-align: right; background-color: #fff7ed;">${sPallet.uretimSevkiyat ? sPallet.uretimSevkiyat.toLocaleString('tr-TR') : '-'}</td>
              </tr>
            `;
          });
        }
      });

      planHtml += `
          </tbody>
          <tfoot>
            <tr style="background-color: #e2e8f0; font-weight: bold; font-size: 12px;">
              <td colspan="2" style="padding: 8px;">GENEL TOPLAM (${filteredCustomers.length} Müşteri)</td>
              <td style="padding: 8px; text-align: right;">${totalQuotaTargetSum ? totalQuotaTargetSum.toLocaleString('tr-TR') : '-'}</td>
              <td style="padding: 8px; text-align: right; color: #1e40af;">${totalQuotaShippedSum ? totalQuotaShippedSum.toLocaleString('tr-TR') : '-'}</td>
              <td style="padding: 8px; text-align: right; color: #9f1239; background-color: #fecdd3;">${totalQuotaRemainingSum ? totalQuotaRemainingSum.toLocaleString('tr-TR') : '-'}</td>
              <td style="padding: 8px; text-align: right; color: #166534; background-color: #bbf7d0;">${totalFactoryStock.toLocaleString('tr-TR')}</td>
              <td style="padding: 8px; text-align: center; background-color: #e9d5ff;">Toplam Açık: ${totalQuotaRemainingSum.toLocaleString('tr-TR')} m²</td>
              <td style="padding: 8px; text-align: right; color: #854d0e; background-color: #fef08a;">${grandTotalTahtaPallet ? grandTotalTahtaPallet.toLocaleString('tr-TR') : '-'}</td>
              <td style="padding: 8px; text-align: right; color: #9a3412; background-color: #fed7aa;">${grandTotalUretimSevkiyatPallet ? grandTotalUretimSevkiyatPallet.toLocaleString('tr-TR') : '-'}</td>
            </tr>
          </tfoot>
        </table>
      `;

      const uri = 'data:application/vnd.ms-excel;base64,';
      const template = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta http-equiv="content-type" content="text/plain; charset=UTF-8"/></head>
        <body>${planHtml}</body>
      </html>`;
      const base64 = (s: string) => window.btoa(unescape(encodeURIComponent(s)));
      const link = document.createElement('a');
      link.href = uri + base64(template);
      link.download = `MUSTERI_SIPARIS_VE_URETIM_PLANI_${dateMode === 'single' ? selectedDate : `${startDate}_${endDate}`}.xls`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const reportTitle = dateMode === 'single'
      ? `GÜNLÜK SEVKİYAT VE STOK MATRİSİ (${selectedDate})`
      : `SEVKİYAT VE STOK MATRİSİ (${startDate} - ${endDate})`;

    let html = `
      <table border="1" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px;">
        <thead>
          <tr style="background-color: #1e3a8a; color: #ffffff; font-weight: bold; text-align: center;">
            <th colspan="${filteredProducts.length + 7}" style="font-size: 14px; padding: 10px;">
              PARKE ERP • ${reportTitle} • ${matrixCellMode === 'daily' ? 'GÜNLÜK SEVKİYAT MATRİSİ' : 'KÜMÜLATİF (TOPLAM) SEVKİYAT MATRİSİ'}
            </th>
          </tr>
          <tr style="background-color: #f1f5f9; font-weight: bold;">
            <th style="padding: 8px; text-align: left; min-width: 200px;">MÜŞTERİ / ŞANTİYE</th>
            ${filteredProducts.map((p) => `<th style="padding: 8px; text-align: right; min-width: 110px;">
              ${p.name} ${p.thickness ? `(${p.thickness})` : ''}
              <br/><span style="font-size: 9px; font-weight: normal; color: #475569;">[${matrixCellMode === 'daily' ? 'GÜNLÜK SEVK' : 'TOPLAM SEVK'} (${p.unit || 'm²'})]</span>
            </th>`).join('')}
            <th style="padding: 8px; text-align: right; background-color: #dbeafe;">GÜNLÜK SEVK</th>
            <th style="padding: 8px; text-align: right; background-color: #f3e8ff;">SİPARİŞ / KOTA</th>
            <th style="padding: 8px; text-align: right; background-color: #fef3c7;">KÜMÜLATİF SEVK</th>
            <th style="padding: 8px; text-align: right; background-color: #dcfce7;">KALAN BAKİYE</th>
            <th style="padding: 8px; text-align: right; background-color: #fef9c3;">TAHTA PALET</th>
            <th style="padding: 8px; text-align: right; background-color: #ffedd5;">ÜRETİM / SEVK. PALETİ</th>
          </tr>
        </thead>
        <tbody>
          ${filteredCustomers.map((c) => {
            const cDaily = customerTotals[c.id] || 0;
            const cCum = cumulativeCustomerTotals[c.id] || 0;
            const qSummary = customerQuotaMap[c.id];
            const cPallet = customerPalletMap[c.id];
            const childSites = getCustomerChildSites(c.id);

            let custRowHtml = `
              <tr>
                <td style="padding: 6px; font-weight: bold; background-color: #f8fafc;">
                  ${c.name} ${qSummary?.hasQuota ? '(Kotalı)' : ''} ${childSites.length > 0 ? `[${childSites.length} Şantiye]` : ''}
                </td>
                ${filteredProducts.map((p) => {
                  const cumVal = cumulativeProductMatrix[c.id]?.[p.id] || 0;
                  const dailyVal = matrix[c.id]?.[p.id] || 0;
                  const pQ = qSummary?.productQuotas?.[p.id];

                  let cellContent = '-';
                  if (matrixCellMode === 'daily') {
                    cellContent = dailyVal ? dailyVal.toLocaleString('tr-TR') : '-';
                  } else if (matrixCellMode === 'both') {
                    cellContent = `<b>${cumVal ? cumVal.toLocaleString('tr-TR') : '0'}</b>`;
                    if (dailyVal > 0) cellContent += `<br/><small style="color: #1d4ed8;">(Gün: ${dailyVal.toLocaleString('tr-TR')})</small>`;
                  } else {
                    cellContent = cumVal ? `<b>${cumVal.toLocaleString('tr-TR')}</b>` : '-';
                    if (dailyVal > 0) cellContent += `<br/><small style="color: #1d4ed8;">(Gün: +${dailyVal.toLocaleString('tr-TR')})</small>`;
                  }

                  if (pQ) {
                    cellContent += `<br/><small style="color: #047857;">[Kal: ${pQ.remaining.toLocaleString('tr-TR')}]</small>`;
                  }

                  return `<td style="padding: 6px; text-align: right; ${cumVal > 0 ? 'background-color: #fefce8;' : ''}">
                    ${cellContent}
                  </td>`;
                }).join('')}
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #eff6ff;">
                  ${cDaily ? cDaily.toLocaleString('tr-TR') : '-'}
                </td>
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #faf5ff;">
                  ${qSummary?.hasQuota ? qSummary.totalTarget.toLocaleString('tr-TR') : '-'}
                </td>
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #fffbeb;">
                  ${qSummary?.hasQuota ? `${qSummary.totalShipped.toLocaleString('tr-TR')} (%${qSummary.completionPct})` : (cCum ? cCum.toLocaleString('tr-TR') : '-')}
                </td>
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #f0fdf4; color: ${qSummary && qSummary.totalRemaining < 0 ? '#b91c1c' : '#15803d'};">
                  ${qSummary?.hasQuota ? qSummary.totalRemaining.toLocaleString('tr-TR') : '-'}
                </td>
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #fef9c3; color: #854d0e;">
                  ${cPallet && cPallet.tahta !== 0 ? cPallet.tahta.toLocaleString('tr-TR') : '-'}
                </td>
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #ffedd5; color: #9a3412;">
                  ${cPallet && cPallet.uretimSevkiyat !== 0 ? cPallet.uretimSevkiyat.toLocaleString('tr-TR') : '-'}
                </td>
              </tr>
            `;

            if (expandedCustomerIds.has(c.id) && childSites.length > 0) {
              childSites.forEach((site) => {
                const sDaily = siteTotals[c.id]?.[site.id] || 0;
                const sCum = cumulativeSiteTotals[c.id]?.[site.id] || 0;
                const sQuota = siteQuotaMap[c.id]?.[site.id];
                const sPallet = sitePalletMap[`${c.id}_${site.id}`];

                custRowHtml += `
                  <tr style="background-color: #f8fafc; font-size: 10px; color: #334155;">
                    <td style="padding: 4px 4px 4px 22px; font-style: italic;">
                      ↳ ${site.isUnassigned ? 'Merkez / Şantiyesiz' : `Şantiye: ${site.name}`}
                    </td>
                    ${filteredProducts.map((p) => {
                      const siteDailyVal = siteMatrix[c.id]?.[site.id]?.[p.id] || 0;
                      const siteCumVal = cumulativeSiteProductMatrix[c.id]?.[site.id]?.[p.id] || 0;
                      const sVal = matrixCellMode === 'daily' ? siteDailyVal : siteCumVal;
                      return `<td style="padding: 4px; text-align: right;">
                        ${sVal ? sVal.toLocaleString('tr-TR') : '-'}
                      </td>`;
                    }).join('')}
                    <td style="padding: 4px; text-align: right; background-color: #f0fdf4;">${sDaily ? sDaily.toLocaleString('tr-TR') : '-'}</td>
                    <td style="padding: 4px; text-align: right; background-color: #faf5ff;">${sQuota?.hasQuota ? sQuota.totalTarget.toLocaleString('tr-TR') : '-'}</td>
                    <td style="padding: 4px; text-align: right; background-color: #fffbeb;">${sCum ? sCum.toLocaleString('tr-TR') : '-'}</td>
                    <td style="padding: 4px; text-align: right; background-color: #f0fdf4;">${sQuota?.hasQuota ? sQuota.totalRemaining.toLocaleString('tr-TR') : '-'}</td>
                    <td style="padding: 4px; text-align: right; background-color: #fefce8;">${sPallet && sPallet.tahta !== 0 ? sPallet.tahta.toLocaleString('tr-TR') : '-'}</td>
                    <td style="padding: 4px; text-align: right; background-color: #fff7ed;">${sPallet && sPallet.uretimSevkiyat !== 0 ? sPallet.uretimSevkiyat.toLocaleString('tr-TR') : '-'}</td>
                  </tr>
                `;
              });
            }

            return custRowHtml;
          }).join('')}

          <!-- TOPLAM GİDEN (KÜMÜLATİF) -->
          <tr style="background-color: #dbeafe; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px;">TOPLAM GİDEN (KÜMÜLATİF SEVKİYAT)</td>
            ${filteredProducts.map((p) => {
              const cumTot = cumulativeProductTotals[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #1e40af;">${cumTot ? cumTot.toLocaleString('tr-TR') : '-'}</td>`;
            }).join('')}
            <td style="padding: 8px; text-align: right; color: #1e40af;">${grandTotalShipped.toLocaleString('tr-TR')}</td>
            <td style="padding: 8px; text-align: right; color: #6b21a8;">${totalQuotaTargetSum ? totalQuotaTargetSum.toLocaleString('tr-TR') : '-'}</td>
            <td style="padding: 8px; text-align: right; color: #b45309;">${grandTotalCumulativeShipped ? grandTotalCumulativeShipped.toLocaleString('tr-TR') : (totalQuotaShippedSum ? totalQuotaShippedSum.toLocaleString('tr-TR') : '-')}</td>
            <td style="padding: 8px; text-align: right; color: #15803d;">${totalQuotaRemainingSum ? totalQuotaRemainingSum.toLocaleString('tr-TR') : '-'}</td>
            <td style="padding: 8px; text-align: right; color: #854d0e;">${grandTotalTahtaPallet ? grandTotalTahtaPallet.toLocaleString('tr-TR') : '-'}</td>
            <td style="padding: 8px; text-align: right; color: #9a3412;">${grandTotalUretimSevkiyatPallet ? grandTotalUretimSevkiyatPallet.toLocaleString('tr-TR') : '-'}</td>
          </tr>

          <!-- 1. GÜNE BAŞLANGIÇ STOĞU (DEVİR) -->
          <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #334155;">GÜNE BAŞLANGIÇ STOĞU (DEVİR)</td>
            ${filteredProducts.map((p) => {
              const stk = stockMap[p.id] || 0;
              const prd = dailyProductionMap[p.id] || 0;
              const gdn = productTotals[p.id] || 0;
              const openStk = stk - prd + gdn;
              return `<td style="padding: 8px; text-align: right; color: #334155;">${openStk ? openStk.toLocaleString('tr-TR') : '0'}</td>`;
            }).join('')}
            <td colspan="3" style="padding: 8px; text-align: right; color: #334155; font-weight: bold;">TOPLAM GÜN BAŞI STOK:</td>
            <td style="padding: 8px; text-align: right; color: #334155; font-size: 13px; font-weight: bold;">${totalOpeningStock.toLocaleString('tr-TR')}</td>
            <td style="padding: 8px; text-align: center; color: #334155;">-</td>
            <td style="padding: 8px; text-align: center; color: #334155;">-</td>
          </tr>

          <!-- 2. GÜNLÜK ÜRETİM MİKTARI -->
          <tr style="background-color: #fef3c7; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #92400e;">(+) GÜNLÜK ÜRETİM MİKTARI</td>
            ${filteredProducts.map((p) => {
              const prd = dailyProductionMap[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #92400e;">${prd ? Number(prd).toLocaleString('tr-TR') : '-'}</td>`;
            }).join('')}
            <td colspan="3" style="padding: 8px; text-align: right; color: #92400e; font-weight: bold;">TOPLAM GÜNLÜK İMALAT:</td>
            <td style="padding: 8px; text-align: right; color: #92400e; font-size: 13px; font-weight: bold;">${totalDailyProduction.toLocaleString('tr-TR')}</td>
            <td style="padding: 8px; text-align: center; color: #92400e;">-</td>
            <td style="padding: 8px; text-align: center; color: #92400e;">-</td>
          </tr>

          <!-- 3. GÜNLÜK SEVKİYAT (SEÇİLİ GÜN) -->
          <tr style="background-color: #eff6ff; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #1e40af;">(-) GÜNLÜK SEVKİYAT</td>
            ${filteredProducts.map((p) => {
              const pTot = productTotals[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #1e40af;">${pTot ? pTot.toLocaleString('tr-TR') : '-'}</td>`;
            }).join('')}
            <td colspan="3" style="padding: 8px; text-align: right; color: #1e40af; font-weight: bold;">TOPLAM GÜNLÜK SEVKİYAT:</td>
            <td style="padding: 8px; text-align: right; color: #1e40af; font-size: 13px; font-weight: bold;">${grandTotalShipped.toLocaleString('tr-TR')}</td>
            <td style="padding: 8px; text-align: center; color: #1e40af;">-</td>
            <td style="padding: 8px; text-align: center; color: #1e40af;">-</td>
          </tr>

          <!-- 4. GÜN SONU / MEVCUT DEPO STOK -->
          <tr style="background-color: #dcfce7; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #166534;">(=) GÜN SONU / MEVCUT DEPO STOK</td>
            ${filteredProducts.map((p) => {
              const stk = stockMap[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #166534; font-weight: bold;">${stk ? stk.toLocaleString('tr-TR') : '0'}</td>`;
            }).join('')}
            <td colspan="3" style="padding: 8px; text-align: right; color: #166534; font-weight: bold;">GÜN SONU FİİLİ DEPO STOĞU:</td>
            <td style="padding: 8px; text-align: right; color: #166534; font-size: 13px; font-weight: bold;">${totalFactoryStock.toLocaleString('tr-TR')}</td>
            <td style="padding: 8px; text-align: center; color: #166534;">-</td>
            <td style="padding: 8px; text-align: center; color: #166534;">-</td>
          </tr>

          <!-- TOPLAM AÇIK SİPARİŞ / KOTA İHTİYACI -->
          <tr style="background-color: #ffe4e6; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #be123c;">AÇIK SİPARİŞ / KOTA İHTİYACI</td>
            ${filteredProducts.map((p) => {
              const demand = productQuotaDemands[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #be123c;">${demand ? demand.toLocaleString('tr-TR') : '-'}</td>`;
            }).join('')}
            <td colspan="3" style="padding: 8px; text-align: right; color: #be123c;">TOPLAM AÇIK İHTİYAÇ:</td>
            <td style="padding: 8px; text-align: right; color: #be123c; font-size: 13px;">${totalQuotaRemainingSum.toLocaleString('tr-TR')}</td>
            <td style="padding: 8px; text-align: center; color: #94a3b8;">-</td>
            <td style="padding: 8px; text-align: center; color: #94a3b8;">-</td>
          </tr>
        </tbody>
      </table>
    `;

    const uri = 'data:application/vnd.ms-excel;base64,';
    const template = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="content-type" content="text/plain; charset=UTF-8"/>
      </head>
      <body>${html}</body>
    </html>`;

    const base64 = (s: string) => window.btoa(unescape(encodeURIComponent(s)));
    const link = document.createElement('a');
    link.href = uri + base64(template);
    link.download = `RAPOR_111_PLANLAMA_MATRIS_${dateMode === 'single' ? selectedDate : `${startDate}_${endDate}`}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Multi-select customer toggle helpers
  const handleToggleCustomer = (customerId: string) => {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
      }
      return next;
    });
  };

  const handleSelectAllCustomers = () => {
    setSelectedCustomerIds(new Set(customers.map((c) => c.id)));
  };

  const handleClearAllCustomers = () => {
    setSelectedCustomerIds(new Set());
  };

  const handleSelectOnlyQuotaCustomers = () => {
    const quotaIds = customers.filter((c) => customerQuotaMap[c.id]?.hasQuota).map((c) => c.id);
    setSelectedCustomerIds(new Set(quotaIds));
  };

  const handleSelectOnlyShippedCustomers = () => {
    setSelectedCustomerIds(new Set(Array.from(activeCustomerIds)));
  };

  return (
    <div className="matrix-print-wrapper space-y-4">
      {/* ── PRINT MEDIA STYLES (A4 LANDSCAPE & MULTI-PAGE THEAD REPEAT) ── */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm 12mm 8mm 12mm;
          }
          *, *::before, *::after {
            box-sizing: border-box !important;
          }
          html, body, #root, main {
            background: white !important;
            color: #0f172a !important;
            overflow: visible !important;
            overflow-x: visible !important;
            overflow-y: visible !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            position: static !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .matrix-print-wrapper {
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            box-sizing: border-box !important;
          }
          .no-print, header, nav, aside, footer {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .print-hidden {
            display: none !important;
          }

          /* UNWRAP SCROLL CONTAINERS FOR PERFECT MULTI-PAGE PRINTING & THEAD REPEAT */
          .matrix-table-container,
          .matrix-scroll-wrapper {
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            position: static !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
          }

          table.matrix-table {
            display: table !important;
            width: 100% !important;
            max-width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            border-spacing: 0 !important;
            page-break-after: auto;
            border: 1pt solid #334155 !important;
            font-size: 7.5px !important;
          }

          /* CRITICAL: Repeating thead across all printed pages */
          thead.matrix-thead {
            display: table-header-group !important;
            position: static !important;
          }
          thead.matrix-thead tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
            position: static !important;
          }
          thead.matrix-thead th {
            position: static !important;
            top: auto !important;
            left: auto !important;
            box-shadow: none !important;
            background-color: #f1f5f9 !important;
            color: #0f172a !important;
            border: 0.75pt solid #475569 !important;
            padding: 2.5px 1px !important;
            font-size: 7px !important;
            line-height: 1.15 !important;
            white-space: normal !important;
            word-break: break-word !important;
            min-width: 0 !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          tbody {
            display: table-row-group !important;
          }
          tbody tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          tbody td {
            position: static !important;
            left: auto !important;
            box-shadow: none !important;
            border: 0.5pt solid #64748b !important;
            padding: 2px 1.5px !important;
            font-size: 7.5px !important;
            line-height: 1.15 !important;
            word-break: break-word !important;
            min-width: 0 !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Tfoot should display once at the end of the table rows */
          tfoot {
            display: table-row-group !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          tfoot tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          tfoot td {
            position: static !important;
            left: auto !important;
            box-shadow: none !important;
            border: 0.75pt solid #334155 !important;
            padding: 2px 1.5px !important;
            font-size: 7.5px !important;
            line-height: 1.15 !important;
            min-width: 0 !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Reset min-widths so table strictly fits 100% of A4 landscape width */
          table.matrix-table,
          table.matrix-table th,
          table.matrix-table td,
          table.matrix-table div {
            min-width: 0 !important;
            max-width: none !important;
          }

          .print-col-cust,
          .matrix-col-cust {
            width: 17% !important;
            min-width: 0 !important;
            max-width: none !important;
            padding-left: 4px !important;
            text-align: left !important;
          }
          .matrix-col-product {
            min-width: 0 !important;
            max-width: none !important;
          }
          .print-col-daily,
          .matrix-col-daily {
            width: 5% !important;
            min-width: 0 !important;
            max-width: none !important;
            text-align: right !important;
          }
          .print-col-quota,
          .matrix-col-quota {
            width: 5.5% !important;
            min-width: 0 !important;
            max-width: none !important;
            text-align: right !important;
          }
          .print-col-cum,
          .matrix-col-cum {
            width: 5.5% !important;
            min-width: 0 !important;
            max-width: none !important;
            text-align: right !important;
          }
          .print-col-rem,
          .matrix-col-rem {
            width: 6% !important;
            min-width: 0 !important;
            max-width: none !important;
            text-align: right !important;
          }
          .print-col-pallet,
          .matrix-col-pallet,
          .print-col-pallet-tahta,
          .matrix-col-pallet-tahta,
          .print-col-pallet-uretim,
          .matrix-col-pallet-uretim {
            width: 4.5% !important;
            min-width: 0 !important;
            max-width: none !important;
            padding-right: 3px !important;
            text-align: right !important;
          }

          .signature-block {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            margin-top: 8px !important;
            padding-top: 6px !important;
          }
        }
        @media screen {
          .print-only {
            display: none !important;
          }
          .matrix-col-cust {
            width: 240px !important;
            min-width: 240px !important;
            max-width: 240px !important;
          }
          .matrix-col-product {
            width: 115px !important;
            min-width: 115px !important;
            max-width: 115px !important;
          }
          .matrix-col-daily {
            width: 90px !important;
            min-width: 90px !important;
            max-width: 90px !important;
          }
          .matrix-col-quota {
            width: 95px !important;
            min-width: 95px !important;
            max-width: 95px !important;
          }
          .matrix-col-cum {
            width: 95px !important;
            min-width: 95px !important;
            max-width: 95px !important;
          }
          .matrix-col-rem {
            width: 100px !important;
            min-width: 100px !important;
            max-width: 100px !important;
          }
          .matrix-col-pallet,
          .matrix-col-pallet-tahta {
            width: 80px !important;
            min-width: 80px !important;
            max-width: 80px !important;
          }
          .matrix-col-pallet-uretim {
            width: 90px !important;
            min-width: 90px !important;
            max-width: 90px !important;
          }
        }
      `}</style>

      {/* ── CONTROLS & DATE SELECTOR BAR (SCREEN ONLY) ── */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-sm">
              <Table size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                Günlük Sevk, Üretim & Stok Planlama Matrisi
                <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">
                  Üretim Planlama & Excel
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Müşteri kotaları, şantiye dağılımları ve zimmetli palet bakiyeleriyle entegre fabrika sevk ve üretim denge tablosu
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={expandedCustomerIds.size === 0 ? handleExpandAll : handleCollapseAll}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
              title={expandedCustomerIds.size === 0 ? 'Tüm müşterilerin alt şantiyelerini aç' : 'Tüm şantiyeleri kapat'}
            >
              <ChevronsUpDown size={15} />
              <span>{expandedCustomerIds.size === 0 ? 'Şantiyeleri Aç' : 'Şantiyeleri Kapat'}</span>
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
              title="Excel formatında (.xls) indir"
            >
              <Download size={15} />
              <span>Excel İndir</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
              title="A4 Yatay olarak yazdır"
            >
              <Printer size={15} />
              <span>Yazdır / PDF</span>
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors cursor-pointer"
              title="Yenile"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* ── VIEW MODE SWITCHER (SADE PLANLAMA TABLOSU vs GENİŞ MATRİS) ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-slate-100 to-slate-50 p-2.5 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 ml-1">Rapor Görünümü:</span>
            <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-bold shadow-inner">
              <button
                type="button"
                onClick={() => setActiveViewMode('plan')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeViewMode === 'plan'
                    ? 'bg-emerald-600 text-white shadow-xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardList size={14} />
                <span>📋 Sade Sipariş & Üretim Planı</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveViewMode('matrix')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md transition-all cursor-pointer ${
                  activeViewMode === 'matrix'
                    ? 'bg-emerald-600 text-white shadow-xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table size={14} />
                <span>📊 Geniş Ürün Matrisi (Çapraz Tablo)</span>
              </button>
            </div>
          </div>
          <div className="text-[11px] text-slate-600 font-medium">
            {activeViewMode === 'plan' ? (
              <span className="flex items-center gap-1 text-emerald-800">
                <CheckCircle2 size={13} className="text-emerald-600" />
                <span>Tek ekranda firma siparişi, gideni, depo stoğu ve net basılacak üretim miktarı</span>
              </span>
            ) : (
              <span className="text-slate-500">Tüm ürün çeşitlerinin yan yana listelendiği detaylı matris</span>
            )}
          </div>
        </div>

        {/* Date Filter & Fast Navigation */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
            {/* Mode Switch: Single Day vs Date Range */}
            <div className="flex bg-slate-100 p-0.5 rounded-xl text-xs font-semibold">
              <button
                onClick={() => setDateMode('single')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  dateMode === 'single' ? 'bg-white text-emerald-800 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📅 Günlük (Tek Gün)
              </button>
              <button
                onClick={() => setDateMode('range')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  dateMode === 'range' ? 'bg-white text-emerald-800 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🗓️ Tarih Aralığı
              </button>
            </div>

            {dateMode === 'single' ? (
              <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                <button
                  onClick={handlePrevDay}
                  className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  title="Önceki Gün"
                >
                  <ChevronLeft size={16} />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={handleNextDay}
                  className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  title="Sonraki Gün"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  onClick={handleSetToday}
                  className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Bugün
                </button>
                {latestShipmentDate && latestShipmentDate !== selectedDate && (
                  <button
                    onClick={() => setSelectedDate(latestShipmentDate)}
                    className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-blue-200"
                    title="Sistemde sevkiyat yapılmış en son güne git"
                  >
                    Son Sevk: {latestShipmentDate}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Başlangıç:</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold bg-white"
                  />
                </div>
                <span className="text-slate-400">→</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">Bitiş:</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Product Type Filter & Matrix Cell Value Mode Selector */}
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
            {/* Cell Value Mode Toggle */}
            <div className="flex bg-slate-100 p-0.5 rounded-xl text-xs font-semibold border border-slate-200">
              <button
                type="button"
                onClick={() => setMatrixCellMode('cumulative')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  matrixCellMode === 'cumulative'
                    ? 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Ürün sütunlarında carilere sevk edilen TOPLAM (kümülatif) miktarı gösterir"
              >
                <span>📈 Toplam Sevk</span>
              </button>
              <button
                type="button"
                onClick={() => setMatrixCellMode('daily')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  matrixCellMode === 'daily'
                    ? 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Ürün sütunlarında sadece seçili günde sevk edilen miktarı gösterir"
              >
                <span>📅 Günlük Sevk</span>
              </button>
              <button
                type="button"
                onClick={() => setMatrixCellMode('both')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                  matrixCellMode === 'both'
                    ? 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Hem toplam sevk hem günlük sevk birlikte gösterilir"
              >
                <span>🔄 Toplam + Günlük</span>
              </button>
            </div>

            <select
              value={productTypeFilter}
              onChange={(e) => setProductTypeFilter(e.target.value as any)}
              className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">Tüm Ürünler ({products.length})</option>
              <option value="parke">Sadece Parke & Prizma Taşları</option>
              <option value="bordur">Sadece Bordürler</option>
              <option value="diger">Diğer Ürünler</option>
            </select>
          </div>
        </div>

        {/* ── CUSTOMER SCOPE & MULTI-SELECT CHECKBOX BAR ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
              <Users size={14} className="text-slate-500" />
              Müşteri Kapsamı:
            </span>

            {/* Mode 1: All Active Customers */}
            <button
              type="button"
              onClick={() => setCustomerFilterMode('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                customerFilterMode === 'all'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              🌐 Tüm Aktif Cariler ({customers.length})
            </button>

            {/* Mode 2: With Quotas Only */}
            <button
              type="button"
              onClick={() => setCustomerFilterMode('with_quota')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                customerFilterMode === 'with_quota'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
              }`}
            >
              <Target size={13} />
              <span>Sadece Kotalı / Siparişli ({quotaCustomersCount})</span>
            </button>

            {/* Mode 3: Shipped Only */}
            <button
              type="button"
              onClick={() => setCustomerFilterMode('shipped_only')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                customerFilterMode === 'shipped_only'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              🚚 Bugün Sevk Görenler ({activeCustomerIds.size})
            </button>

            {/* Mode 4: Custom Checkbox Modal Trigger */}
            <button
              type="button"
              onClick={() => {
                if (selectedCustomerIds.size === 0) {
                  // Default fill with current filtered or all
                  setSelectedCustomerIds(new Set(customers.map((c) => c.id)));
                }
                setCustomerFilterMode('custom');
                setIsCustomerModalOpen(true);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                customerFilterMode === 'custom'
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
              }`}
            >
              <CheckSquare size={13} />
              <span>
                ☑️ Özel Seçim {customerFilterMode === 'custom' ? `(${selectedCustomerIds.size} Seçili)` : '...'}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[200px]">
            <input
              type="text"
              placeholder="Tabloda cari ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Empty Shipment Warning with Jump Button */}
        {dateMode === 'single' && shipmentItems.length === 0 && !loading && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0" />
              <span>
                <strong>{selectedDate}</strong> tarihinde tamamlanmış sevkiyat (irsaliye) bulunamadı.
                {latestShipmentDate ? (
                  <> Sistemdeki en son sevkiyat tarihi: <strong>{latestShipmentDate}</strong></>
                ) : null}
              </span>
            </div>
            {latestShipmentDate && latestShipmentDate !== selectedDate && (
              <button
                type="button"
                onClick={() => setSelectedDate(latestShipmentDate)}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs transition-colors shrink-0 cursor-pointer"
              >
                Son Sevkiyat Gününe Git ({latestShipmentDate})
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── CUSTOMER MULTI-SELECT CHECKBOX MODAL ── */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckSquare size={18} className="text-teal-400" />
                <h3 className="font-bold text-sm">Raporda Gösterilecek Müşterileri Seç (Çoklu Onay)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCustomerModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Action Buttons & Search */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Müşteri adına veya telefonuna göre ara..."
                  value={customerModalSearch}
                  onChange={(e) => setCustomerModalSearch(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSelectAllCustomers}
                    className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg border border-slate-300 shadow-xs cursor-pointer"
                  >
                    Tümünü Seç ({customers.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAllCustomers}
                    className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg border border-slate-300 shadow-xs cursor-pointer"
                  >
                    Temizle
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectOnlyQuotaCustomers}
                    className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold rounded-lg border border-purple-200 shadow-xs cursor-pointer"
                  >
                    Sadece Kotalılar ({quotaCustomersCount})
                  </button>
                  <button
                    type="button"
                    onClick={handleSelectOnlyShippedCustomers}
                    className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg border border-blue-200 shadow-xs cursor-pointer"
                  >
                    Bugün Sevk Görenler ({activeCustomerIds.size})
                  </button>
                </div>
                <div className="font-bold text-slate-600 font-mono">
                  {selectedCustomerIds.size} / {customers.length} Seçili
                </div>
              </div>
            </div>

            {/* Checkbox List */}
            <div className="p-4 overflow-y-auto divide-y divide-slate-100 flex-1">
              {customers
                .filter((c) => {
                  if (!customerModalSearch.trim()) return true;
                  const q = customerModalSearch.toLowerCase();
                  return c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
                })
                .map((cust) => {
                  const isChecked = selectedCustomerIds.has(cust.id);
                  const qSummary = customerQuotaMap[cust.id];
                  const hasShippedToday = activeCustomerIds.has(cust.id);

                  return (
                    <label
                      key={cust.id}
                      className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                        isChecked ? 'bg-teal-50/60 hover:bg-teal-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCustomer(cust.id)}
                          className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                        />
                        <div>
                          <div className="font-bold text-slate-900 text-xs flex items-center gap-2">
                            <span>{cust.name}</span>
                            {hasShippedToday && (
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-100 text-blue-800">
                                🚚 Bugün Sevk Var
                              </span>
                            )}
                          </div>
                          {cust.phone && (
                            <div className="text-[10px] text-slate-400 font-mono">{cust.phone}</div>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        {qSummary?.hasQuota ? (
                          <div className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-200">
                            🎯 Kota: {qSummary.totalTarget.toLocaleString('tr-TR')} | Kal: {qSummary.totalRemaining.toLocaleString('tr-TR')}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">Serbest Satış</span>
                        )}
                      </div>
                    </label>
                  );
                })}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                Seçilen müşteriler raporda satır olarak listelenecektir.
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomerFilterMode('custom');
                  setIsCustomerModalOpen(false);
                }}
                className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-all"
              >
                Uygula & Raporu Göster ({selectedCustomerIds.size} Cari)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRINT-ONLY OFFICIAL DOCUMENT HEADER ── */}
      <div className="print-only border-b-2 border-slate-800 pb-1.5 mb-2 px-1">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-base font-black text-slate-900 tracking-tight print:text-[13px] print:font-black">PARKE ERP • FABRİKA YÖNETİM SİSTEMİ</h1>
            <h2 className="text-xs font-bold text-emerald-800 uppercase mt-0.5 print:text-[9px]">
              📋 GÜNLÜK MÜŞTERİ SEVKİYAT, ÜRETİM & STOK PLANLAMA MATRİSİ
            </h2>
          </div>
          <div className="text-right text-[8.5px] text-slate-700 font-mono print:text-[8px] print:leading-tight">
            <div><strong>Rapor Tarihi:</strong> {new Date().toLocaleString('tr-TR')}</div>
            <div>
              <strong>Rapor Dönemi:</strong> {dateMode === 'single' ? selectedDate : `${startDate} → ${endDate}`}
            </div>
            <div><strong>Cari Filtresi:</strong> {customerFilterMode === 'all' ? 'Tüm Aktif Cariler' : customerFilterMode === 'with_quota' ? 'Sadece Kotalı Cariler' : customerFilterMode === 'shipped_only' ? 'Bugün Sevk Görenler' : 'Özel Seçim'} ({filteredCustomers.length} Cari)</div>
            <div><strong>Rapor Türü:</strong> {matrixCellMode === 'cumulative' ? 'Kümülatif (Toplam) Sevk Matrisi' : matrixCellMode === 'daily' ? 'Günlük Sevk Matrisi' : 'Toplam + Günlük Matris'}</div>
          </div>
        </div>
      </div>

      {/* ── THE EXCEL-STYLE MATRIX TABLE (RESPONSIVE SCROLL WITH STICKY HEADERS) ── */}
      <div className="matrix-table-container bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden print:overflow-visible print:border-none print:shadow-none print:rounded-none">
        {loading ? (
          <div className="py-20 text-center text-slate-400 space-y-3">
            <RefreshCw size={32} className="mx-auto animate-spin text-emerald-600" />
            <p className="text-xs font-semibold">Matris verileri, stoklar ve kotalar hesaplanıyor...</p>
          </div>
        ) : activeViewMode === 'plan' ? (
          /* ── SADE SİPARİŞ & ÜRETİM PLANLAMA GÖRÜNÜMÜ ── */
          <div className="space-y-4 p-4">
            {/* 1. Üst Fabrika Yönetici Özet Barı */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
              <div className="bg-gradient-to-br from-rose-50 to-rose-100/60 border border-rose-200 rounded-2xl p-3.5 shadow-xs">
                <div className="text-[11px] font-bold text-rose-800 uppercase flex items-center gap-1.5">
                  <Target size={14} className="text-rose-600" />
                  <span>Toplam Açık Sipariş</span>
                </div>
                <div className="text-xl font-black text-rose-950 font-mono mt-1">
                  {totalQuotaRemainingSum.toLocaleString('tr-TR')} <span className="text-xs font-bold text-rose-700">m²</span>
                </div>
                <div className="text-[10px] text-rose-700 mt-0.5">
                  {quotaCustomersCount} kotalı firmanın kalan teslimatı
                </div>
              </div>

              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/60 border border-emerald-200 rounded-2xl p-3.5 shadow-xs">
                <div className="text-[11px] font-bold text-emerald-800 uppercase flex items-center gap-1.5">
                  <Boxes size={14} className="text-emerald-600" />
                  <span>Fabrika Depo Stoğu</span>
                </div>
                <div className="text-xl font-black text-emerald-950 font-mono mt-1">
                  {totalFactoryStock.toLocaleString('tr-TR')} <span className="text-xs font-bold text-emerald-700">m²</span>
                </div>
                <div className="text-[10px] text-emerald-700 mt-0.5">
                  Sahadaki mevcut hazır mamul
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-purple-100/60 border border-purple-200 rounded-2xl p-3.5 shadow-xs">
                <div className="text-[11px] font-bold text-purple-800 uppercase flex items-center gap-1.5">
                  <Factory size={14} className="text-purple-600" />
                  <span>Net Üretim Açığı</span>
                </div>
                <div className="text-xl font-black text-purple-950 font-mono mt-1">
                  {totalNetProductionDemandSum.toLocaleString('tr-TR')} <span className="text-xs font-bold text-purple-700">m²</span>
                </div>
                <div className="text-[10px] text-purple-700 mt-0.5">
                  Stok düşüldükten sonra basılması gereken
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-50 to-amber-100/60 border border-amber-200 rounded-2xl p-3.5 shadow-xs">
                <div className="text-[11px] font-bold text-amber-800 uppercase flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-amber-600" />
                  <span>Bugün Üretilen</span>
                </div>
                <div className="text-xl font-black text-amber-950 font-mono mt-1">
                  {totalDailyProduction.toLocaleString('tr-TR')} <span className="text-xs font-bold text-amber-700">m²</span>
                </div>
                <div className="text-[10px] text-amber-700 mt-0.5">
                  Sistemdeki imalat kayıtları
                </div>
              </div>
            </div>

            {/* 2. Ürün Bazında Net Üretim Emri Kartları */}
            {productProductionSummaries.length > 0 && (
              <div className="no-print">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-black text-slate-800 uppercase flex items-center gap-1.5">
                    <Factory size={14} className="text-slate-600" />
                    <span>Taş Bazında Acil Üretim İhtiyaçları & Depo Dengesi</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Öncelikli basılması gereken kalıplar en başta listelenir
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {productProductionSummaries.map((it) => (
                    <div
                      key={it.productId}
                      className={`p-3 rounded-xl border transition-all ${
                        it.isDeficit
                          ? 'bg-rose-50/70 border-rose-200 hover:border-rose-300'
                          : 'bg-emerald-50/50 border-emerald-200 hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="font-bold text-slate-900 text-xs line-clamp-1" title={it.productName}>
                          {it.productName}
                        </div>
                        {it.thickness && (
                          <span className="text-[9.5px] font-semibold text-slate-500 bg-white/80 px-1 rounded shrink-0">
                            {it.thickness}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                        <div>
                          <span className="text-slate-500">Açık Sipariş:</span>{' '}
                          <span className="font-bold font-mono text-slate-800">
                            {it.totalDemand ? it.totalDemand.toLocaleString('tr-TR') : '0'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500">Depo:</span>{' '}
                          <span className="font-bold font-mono text-emerald-800">
                            {it.currentStock ? it.currentStock.toLocaleString('tr-TR') : '0'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-slate-200/60 flex items-center justify-between">
                        {it.isDeficit ? (
                          <span className="text-[11px] font-black text-rose-900 bg-rose-100 px-2 py-0.5 rounded-lg border border-rose-300 inline-flex items-center gap-1">
                            <AlertTriangle size={12} className="text-rose-700 shrink-0" />
                            <span>{it.netNeeded.toLocaleString('tr-TR')} {it.unit} Üretilmeli</span>
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-lg border border-emerald-300 inline-flex items-center gap-1">
                            <CheckCircle2 size={12} className="text-emerald-700 shrink-0" />
                            <span>Stok Yeterli (+{it.surplus.toLocaleString('tr-TR')})</span>
                          </span>
                        )}
                        {it.todayProduction > 0 && (
                          <span className="text-[10px] font-bold text-amber-800 bg-amber-100/80 px-1.5 py-0.5 rounded">
                            +{it.todayProduction.toLocaleString('tr-TR')} gün
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Sade Sipariş & Üretim Planlama Tablosu */}
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs select-text">
                  <thead className="bg-slate-800 text-white uppercase text-[10.5px] font-bold tracking-wider">
                    <tr>
                      <th className="p-3 w-[260px] min-w-[220px]">Müşteri / Firma & Şantiye</th>
                      <th className="p-3 min-w-[200px]">Sipariş Verilen Ürün / Taş</th>
                      <th className="p-3 text-right w-[110px]">Sözleşme / Kota</th>
                      <th className="p-3 text-right w-[110px]">Sevk Edilen (Giden)</th>
                      <th className="p-3 text-right w-[120px] bg-rose-900/60 text-rose-100">Kalan Açık Sipariş</th>
                      <th className="p-3 text-right w-[110px] bg-emerald-900/60 text-emerald-100">Depo Stoğu</th>
                      <th className="p-3 text-center w-[160px] bg-purple-900/60 text-purple-100">Net Üretim İhtiyacı</th>
                      <th className="p-3 text-right w-[95px] bg-amber-900/60 text-amber-100">Tahta Palet</th>
                      <th className="p-3 text-right w-[105px] bg-orange-900/60 text-orange-100">Üretim/Sevk.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filteredCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-slate-400">
                          Seçili filtrelere uygun müşteri kaydı bulunamadı.
                        </td>
                      </tr>
                    ) : (
                      filteredCustomers.map((cust) => {
                        const qSummary = customerQuotaMap[cust.id];
                        const cPallet = customerPalletMap[cust.id] || { total: 0, tahta: 0, sevkiyat: 0, uretim: 0, uretimSevkiyat: 0 };
                        const childSites = getCustomerChildSites(cust.id);
                        const hasChildSites = childSites.length > 0;
                        const isExpanded = expandedCustomerIds.has(cust.id);

                        const custProducts = getCustomerQuotaProducts(cust, qSummary);

                        return (
                          <React.Fragment key={cust.id}>
                            <tr className={`hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-teal-50/20' : ''}`}>
                              {/* Col 1: Customer Name */}
                              <td className="p-3 align-top font-bold text-slate-900 border-r border-slate-100">
                                <div className="flex items-start justify-between gap-1.5">
                                  <div>
                                    <div className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                                      <span>{cust.name}</span>
                                      {qSummary?.hasQuota ? (
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 border border-purple-200">
                                          Kotalı
                                        </span>
                                      ) : null}
                                    </div>
                                    {cust.phone && (
                                      <div className="text-[10px] text-slate-400 font-mono font-normal mt-0.5">
                                        {cust.phone}
                                      </div>
                                    )}
                                  </div>
                                  {hasChildSites && (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleCustomerExpanded(cust.id)}
                                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors shrink-0 ${
                                        isExpanded
                                          ? 'bg-teal-600 text-white shadow-xs'
                                          : 'bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200'
                                      }`}
                                      title={isExpanded ? 'Şantiyeleri Daralt' : 'Şantiyeleri Aç'}
                                    >
                                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                      <span>{childSites.length} Şantiye</span>
                                    </button>
                                  )}
                                </div>
                              </td>

                              {/* Col 2: Products */}
                              <td className="p-3 align-top border-r border-slate-100">
                                {custProducts.length > 0 ? (
                                  <div className="space-y-2">
                                    {custProducts.map((p) => (
                                      <div key={p.productId} className="py-0.5 flex items-start gap-1.5">
                                        <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${p.isUnassigned ? 'bg-purple-500' : 'bg-emerald-500'}`} />
                                        <div className="flex flex-col">
                                          <span className="text-xs font-black text-slate-900 leading-tight">
                                            {p.productName}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 italic text-xs">Serbest Satış / Kotasız</span>
                                )}
                              </td>

                              {/* Col 3: Quota Target */}
                              <td className="p-3 align-top text-right font-mono font-bold text-slate-800 border-r border-slate-100">
                                {custProducts.length > 0 ? (
                                  <div className="space-y-2">
                                    {custProducts.map((p) => (
                                      <div key={p.productId} className="py-0.5">
                                        {p.target ? Number(p.target).toLocaleString('tr-TR') : '-'}
                                        <span className="text-[10px] text-slate-400 ml-0.5 font-normal">{p.unit}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>

                              {/* Col 4: Shipped */}
                              <td className="p-3 align-top text-right font-mono font-bold text-blue-900 border-r border-slate-100">
                                {custProducts.length > 0 ? (
                                  <div className="space-y-2">
                                    {custProducts.map((p) => (
                                      <div key={p.productId} className="py-0.5">
                                        {p.shipped ? Number(p.shipped).toLocaleString('tr-TR') : '0'}
                                        <span className="text-[10px] text-slate-400 ml-0.5 font-normal">{p.unit}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div>
                                    {customerTotals[cust.id]
                                      ? Number(customerTotals[cust.id]).toLocaleString('tr-TR')
                                      : (cumulativeCustomerTotals[cust.id]
                                        ? Number(cumulativeCustomerTotals[cust.id]).toLocaleString('tr-TR')
                                        : '-')}
                                    <span className="text-[10px] text-slate-400 ml-0.5 font-normal">m²</span>
                                  </div>
                                )}
                              </td>

                              {/* Col 5: Remaining Quota */}
                              <td className="p-3 align-top text-right font-mono font-black text-rose-950 bg-rose-50/40 border-r border-rose-100">
                                {custProducts.length > 0 ? (
                                  <div className="space-y-2">
                                    {custProducts.map((p) => (
                                      <div key={p.productId} className="py-0.5 text-rose-900 font-black">
                                        {p.remaining > 0 ? Number(p.remaining).toLocaleString('tr-TR') : '0'}
                                        <span className="text-[10px] text-rose-600/70 ml-0.5 font-normal">{p.unit}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>

                              {/* Col 6: Factory Stock */}
                              <td className="p-3 align-top text-right font-mono font-bold text-emerald-950 bg-emerald-50/40 border-r border-emerald-100">
                                {custProducts.length > 0 ? (
                                  <div className="space-y-2">
                                    {custProducts.map((p) => (
                                      <div key={p.productId} className="py-0.5">
                                        {p.isUnassigned ? (
                                          <span className="text-slate-400 font-normal italic text-xs">-</span>
                                        ) : (
                                          <>
                                            <span className={p.stock > 0 ? 'text-emerald-900 font-black' : 'text-slate-400 font-medium'}>
                                              {Number(p.stock).toLocaleString('tr-TR')}
                                            </span>
                                            <span className="text-[10px] text-emerald-700/70 ml-0.5 font-normal">{p.unit}</span>
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>

                              {/* Col 7: Net Production Need */}
                              <td className="p-3 align-top text-center border-r border-purple-100 bg-purple-50/30">
                                {custProducts.length > 0 ? (
                                  <div className="space-y-2">
                                    {custProducts.map((p) => {
                                      if (p.remaining <= 0) {
                                        return (
                                          <div key={p.productId} className="py-0.5">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                              ✅ <span className="font-extrabold">{p.shortName}</span>: Kota Doldu
                                            </span>
                                          </div>
                                        );
                                      }
                                      if (p.netNeeded > 0) {
                                        return (
                                          <div key={p.productId} className="py-0.5">
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-black bg-rose-100 text-rose-900 border border-rose-300 shadow-xs">
                                              <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse shrink-0" />
                                              <span>
                                                ⚠️ <span className="font-extrabold underline decoration-rose-400">{p.shortName}</span>: {Number(p.netNeeded).toLocaleString('tr-TR')} {p.unit} Üretilmeli
                                              </span>
                                            </span>
                                          </div>
                                        );
                                      }
                                      return (
                                        <div key={p.productId} className="py-0.5">
                                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10.5px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                                            ✅ <span className="font-extrabold">{p.shortName}</span>: Stok Yeterli (+{Number(p.surplus).toLocaleString('tr-TR')} {p.unit})
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-xs italic">Planlama Yok</span>
                                )}
                              </td>

                              {/* Col 8: Pallet Tahta */}
                              <td className="p-3 align-top text-right font-mono font-bold text-amber-950 bg-amber-50/50 border-r border-amber-100">
                                {cPallet.tahta ? cPallet.tahta.toLocaleString('tr-TR') : '-'}
                              </td>

                              {/* Col 9: Pallet Üretim / Sevk */}
                              <td className="p-3 align-top text-right font-mono font-bold text-orange-950 bg-orange-50/50">
                                {cPallet.uretimSevkiyat ? cPallet.uretimSevkiyat.toLocaleString('tr-TR') : '-'}
                              </td>
                            </tr>

                            {/* Child Sites Rows (Only rendered if isExpanded is true!) */}
                            {isExpanded && childSites.map((site) => {
                              const sQuota = siteQuotaMap[cust.id]?.[site.id];
                              const sPallet = sitePalletMap[`${cust.id}_${site.id}`] || { tahta: 0, uretimSevkiyat: 0 };
                              const siteProducts = getSiteQuotaProducts(site, sQuota);

                              return (
                                <tr key={site.id} className="bg-slate-50/90 hover:bg-slate-100/90 transition-colors border-l-4 border-l-teal-500">
                                  <td className="p-2.5 pl-8 text-xs font-semibold text-slate-700 border-r border-slate-200">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-teal-600 font-black">↳</span>
                                      <span>{site.isUnassigned ? '🏢 Merkez / Şantiyesiz' : `🏗️ ${site.name}`}</span>
                                    </div>
                                  </td>
                                  <td className="p-2.5 text-xs text-slate-600 border-r border-slate-200">
                                    {siteProducts.length > 0 ? (
                                      <div className="space-y-1">
                                        {siteProducts.map((sp) => (
                                          <div key={sp.productId} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                                            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
                                            <span>{sp.productName}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400 italic">Şantiye Dökümü</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-right font-mono text-xs text-slate-700 border-r border-slate-200">
                                    {siteProducts.length > 0 ? (
                                      <div className="space-y-1">
                                        {siteProducts.map((sp) => (
                                          <div key={sp.productId}>
                                            {sp.target ? Number(sp.target).toLocaleString('tr-TR') : '-'}
                                            <span className="text-[10px] text-slate-400 ml-0.5 font-normal">{sp.unit}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span>{sQuota?.totalTarget ? Number(sQuota.totalTarget).toLocaleString('tr-TR') : '-'}</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-right font-mono text-xs text-blue-800 border-r border-slate-200">
                                    {siteProducts.length > 0 ? (
                                      <div className="space-y-1">
                                        {siteProducts.map((sp) => (
                                          <div key={sp.productId} className="font-bold">
                                            {sp.shipped ? Number(sp.shipped).toLocaleString('tr-TR') : '0'}
                                            <span className="text-[10px] text-slate-400 ml-0.5 font-normal">{sp.unit}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="font-bold">{sQuota?.totalShipped ? Number(sQuota.totalShipped).toLocaleString('tr-TR') : '-'}</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-right font-mono text-xs font-bold text-rose-800 border-r border-slate-200 bg-rose-50/30">
                                    {siteProducts.length > 0 ? (
                                      <div className="space-y-1">
                                        {siteProducts.map((sp) => (
                                          <div key={sp.productId} className="font-black text-rose-900">
                                            {sp.remaining > 0 ? Number(sp.remaining).toLocaleString('tr-TR') : '0'}
                                            <span className="text-[10px] text-rose-600/70 ml-0.5 font-normal">{sp.unit}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="font-black text-rose-900">{sQuota?.totalRemaining ? Number(sQuota.totalRemaining).toLocaleString('tr-TR') : '-'}</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-right font-mono text-xs text-emerald-800 border-r border-slate-200">
                                    {siteProducts.length > 0 ? (
                                      <div className="space-y-1">
                                        {siteProducts.map((sp) => (
                                          <div key={sp.productId} className="text-emerald-900 font-bold">
                                            {sp.stock ? Number(sp.stock).toLocaleString('tr-TR') : '0'}
                                            <span className="text-[10px] text-emerald-600/70 ml-0.5 font-normal">{sp.unit}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-center text-xs border-r border-slate-200">
                                    {siteProducts.length > 0 ? (
                                      <div className="space-y-1">
                                        {siteProducts.map((sp) => {
                                          if (sp.remaining <= 0) {
                                            return (
                                              <div key={sp.productId}>
                                                <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                                  Kota Doldu
                                                </span>
                                              </div>
                                            );
                                          }
                                          if (sp.netNeeded > 0) {
                                            return (
                                              <div key={sp.productId}>
                                                <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                                                  ⚠️ {sp.shortName}: {Number(sp.netNeeded).toLocaleString('tr-TR')} {sp.unit} Açık
                                                </span>
                                              </div>
                                            );
                                          }
                                          return (
                                            <div key={sp.productId}>
                                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                                ✅ {sp.shortName}: Stok Var
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </td>
                                  <td className="p-2.5 text-right font-mono text-xs text-amber-800 border-r border-slate-200 bg-amber-50/30">
                                    {sPallet.tahta ? sPallet.tahta.toLocaleString('tr-TR') : '-'}
                                  </td>
                                  <td className="p-2.5 text-right font-mono text-xs text-orange-800 bg-orange-50/30">
                                    {sPallet.uretimSevkiyat ? sPallet.uretimSevkiyat.toLocaleString('tr-TR') : '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot className="bg-slate-100 text-slate-900 font-black text-xs border-t-2 border-slate-300">
                    <tr>
                      <td className="p-3" colSpan={2}>
                        GENEL TOPLAM ({filteredCustomers.length} Müşteri)
                      </td>
                      <td className="p-3 text-right font-mono">
                        {totalQuotaTargetSum ? totalQuotaTargetSum.toLocaleString('tr-TR') : '-'}
                      </td>
                      <td className="p-3 text-right font-mono text-blue-900">
                        {totalQuotaShippedSum ? totalQuotaShippedSum.toLocaleString('tr-TR') : '-'}
                      </td>
                      <td className="p-3 text-right font-mono text-rose-950 bg-rose-200/80">
                        {totalQuotaRemainingSum ? totalQuotaRemainingSum.toLocaleString('tr-TR') : '-'}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-950 bg-emerald-200/80">
                        {totalFactoryStock.toLocaleString('tr-TR')}
                      </td>
                      <td className="p-3 text-center text-purple-950 bg-purple-200/80">
                        Net Açık: {totalNetProductionDemandSum.toLocaleString('tr-TR')} m²
                      </td>
                      <td className="p-3 text-right font-mono text-amber-950 bg-amber-200/90">
                        {grandTotalTahtaPallet ? grandTotalTahtaPallet.toLocaleString('tr-TR') : '-'}
                      </td>
                      <td className="p-3 text-right font-mono text-orange-950 bg-orange-200/90">
                        {grandTotalUretimSevkiyatPallet ? grandTotalUretimSevkiyatPallet.toLocaleString('tr-TR') : '-'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {/* Quick Scroll Navigation Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-100 border-b border-slate-200 text-xs no-print">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-700 text-xs">Tablo Navigasyonu:</span>
                <button
                  type="button"
                  onClick={() => matrixScrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' })}
                  className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg shadow-xs hover:bg-slate-50 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  title="Tabloyu en sola (müşteri isimlerine) kaydır"
                >
                  <ChevronLeft size={14} className="text-slate-500" />
                  <span>Müşteriler (Sol)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (matrixScrollRef.current) {
                      matrixScrollRef.current.scrollTo({ left: matrixScrollRef.current.scrollWidth, behavior: 'smooth' });
                    }
                  }}
                  className="px-2.5 py-1 bg-blue-50 border border-blue-300 rounded-lg shadow-xs hover:bg-blue-100 text-blue-900 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  title="Tabloyu en sağa (toplam sütunlarına) kaydır"
                >
                  <span>Sağ Toplamlar</span>
                  <ChevronRight size={14} className="text-blue-700" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (matrixScrollRef.current) {
                      matrixScrollRef.current.scrollTo({ top: matrixScrollRef.current.scrollHeight, behavior: 'smooth' });
                    }
                  }}
                  className="px-2.5 py-1 bg-emerald-50 border border-emerald-300 rounded-lg shadow-xs hover:bg-emerald-100 text-emerald-900 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  title="Tabloyu en alta (fabrika stok ve gün sonu toplamlarına) kaydır"
                >
                  <ChevronDown size={14} className="text-emerald-700" />
                  <span>Alt Toplamlar (Fabrika/Stok)</span>
                </button>
              </div>
              <div className="text-[11px] text-slate-500 hidden sm:block">
                💡 İpucu: Sağa kaydırırken müşteri sütunu sol tarafta sabit kalır.
              </div>
            </div>

            <div
              ref={matrixScrollRef}
              className="matrix-scroll-wrapper overflow-x-auto max-h-[750px] pb-24 relative print:overflow-visible print:max-h-none print:h-auto print:static"
            >
              <table className="matrix-table w-full text-xs text-left border-collapse select-text print:text-[8px] print:w-full">
                <colgroup>
                  <col className="matrix-col-cust print-col-cust" />
                  {filteredProducts.map((prod) => (
                    <col key={prod.id} className="matrix-col-product" style={{ width: `${productColWidthPct}%` }} />
                  ))}
                  <col className="matrix-col-daily print-col-daily" />
                  <col className="matrix-col-quota print-col-quota" />
                  <col className="matrix-col-cum print-col-cum" />
                  <col className="matrix-col-rem print-col-rem" />
                  <col className="matrix-col-pallet-tahta print-col-pallet-tahta" />
                  <col className="matrix-col-pallet-uretim print-col-pallet-uretim" />
                </colgroup>
                {/* ── TABLE HEADER: PRODUCTS & SUMMARY COLUMNS ── */}
                <thead className="matrix-thead sticky top-0 z-20 bg-slate-100 shadow-xs print:static print:table-header-group">
                  <tr className="border-b border-slate-300 text-slate-700 font-bold">
                    {/* Sticky Column A: Customer Header */}
                    <th
                      className="p-2.5 matrix-col-cust print-col-cust sticky left-0 z-30 bg-slate-200 border-r border-slate-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-500"
                    >
                      <div className="flex items-center gap-1.5">
                        <Building2 size={13} className="text-slate-600 print:hidden" />
                        <span className="print:text-[8.5px] print:font-black print:uppercase">Müşteri & Şantiyeler</span>
                      </div>
                    </th>

                    {/* Product Columns */}
                    {filteredProducts.map((prod) => (
                      <th
                        key={prod.id}
                        style={{ width: `${productColWidthPct}%` }}
                        className="p-2 text-right matrix-col-product border-r border-slate-200 bg-slate-100 print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[7.5px] print:text-center"
                        title={`${prod.name} (${prod.thickness || ''} ${prod.color || ''})`}
                      >
                        <div className="font-bold text-slate-900 text-[11px] leading-tight line-clamp-2 print:text-[7.5px] print:font-black print:leading-tight print:line-clamp-none break-words">
                          {prod.name}
                        </div>
                        <div className="text-[10px] text-slate-500 font-normal flex items-center justify-end gap-1 mt-0.5 print:text-[7px] print:justify-center print:mt-0 print:font-medium">
                          <span>{prod.thickness ? `${prod.thickness}` : ''}</span>
                          {prod.color && <span>• {prod.color}</span>}
                          <span className="font-semibold text-slate-700">({prod.unit || 'm²'})</span>
                        </div>
                        <div className="text-[9px] font-bold text-blue-700 mt-0.5 print:hidden">
                          {matrixCellMode === 'daily' ? '📅 Günlük' : '📈 Toplam Sevk'}
                        </div>
                      </th>
                    ))}

                    {/* Far Right 6 Columns: Planning, Balance & Pallet Tracking */}
                    <th
                      className="p-2 matrix-col-daily print-col-daily text-right bg-blue-100 text-blue-950 font-black border-l border-slate-300 print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[7.5px]"
                    >
                      <div className="text-[10px] uppercase print:text-[7.5px] print:leading-tight">
                        <div>GÜNLÜK</div>
                        <div>SEVK</div>
                      </div>
                      <div className="text-[9px] text-blue-700 font-normal print:hidden">Bu Gün / Aralık</div>
                    </th>
                    <th
                      className="p-2 matrix-col-quota print-col-quota text-right bg-purple-100 text-purple-950 font-black border-l border-purple-200 print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[7.5px]"
                    >
                      <div className="text-[10px] uppercase print:text-[7.5px] print:leading-tight">
                        <div>SİPARİŞ</div>
                        <div>/ KOTA</div>
                      </div>
                      <div className="text-[9px] text-purple-700 font-normal print:hidden">Taahhüt</div>
                    </th>
                    <th
                      className="p-2 matrix-col-cum print-col-cum text-right bg-amber-100 text-amber-950 font-black border-l border-amber-200 print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[7.5px]"
                    >
                      <div className="text-[10px] uppercase print:text-[7.5px] print:leading-tight">
                        <div>KÜMÜLATİF</div>
                        <div>SEVK</div>
                      </div>
                      <div className="text-[9px] text-amber-700 font-normal print:hidden">Tüm Çekilen</div>
                    </th>
                    <th
                      className="p-2 matrix-col-rem print-col-rem text-right bg-emerald-100 text-emerald-950 font-black border-l border-emerald-200 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[7.5px]"
                    >
                      <div className="text-[10px] uppercase print:text-[7.5px] print:leading-tight">
                        <div>KALAN</div>
                        <div>BAKİYE</div>
                      </div>
                      <div className="text-[9px] text-emerald-700 font-normal print:hidden">Açık İhtiyaç</div>
                    </th>
                    <th
                      className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-right bg-amber-100/90 text-amber-950 font-black border-l border-amber-200 print:p-0.5 print:pr-1 print:min-w-0 print:border-slate-500 print:text-[7.5px]"
                    >
                      <div className="text-[10px] uppercase print:text-[7px] print:leading-tight">
                        <div>TAHTA</div>
                        <div>PALET</div>
                      </div>
                      <div className="text-[9px] text-amber-800 font-normal print:hidden">Bakiye</div>
                    </th>
                    <th
                      className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-right bg-orange-100/90 text-orange-950 font-black border-l border-orange-200 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[7.5px]"
                    >
                      <div className="text-[10px] uppercase print:text-[7px] print:leading-tight">
                        <div>ÜRETİM / SEVK.</div>
                        <div>PALETİ</div>
                      </div>
                      <div className="text-[9px] text-orange-800 font-normal print:hidden">Bakiye</div>
                    </th>
                  </tr>
                </thead>

              {/* ── TABLE BODY: CUSTOMERS (ROWS) & CHILD SITES (SUB-ROWS) ── */}
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={filteredProducts.length + 7}
                      className="py-12 text-center text-slate-400 bg-slate-50"
                    >
                      <Layers size={32} className="mx-auto text-slate-300 mb-2 opacity-60" />
                      Seçilen filtre kriterlerine uygun müşteri kaydı bulunamadı.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((cust, idx) => {
                    const custDailyTotal = customerTotals[cust.id] || 0;
                    const qSummary = customerQuotaMap[cust.id];
                    const childSites = getCustomerChildSites(cust.id);
                    const hasChildSites = childSites.length > 0;
                    const isExpanded = expandedCustomerIds.has(cust.id);
                    const custPallet = customerPalletMap[cust.id] || { total: 0, tahta: 0, sevkiyat: 0, uretim: 0, uretimSevkiyat: 0 };

                    return (
                      <React.Fragment key={cust.id}>
                        {/* ── MAIN CUSTOMER ROW ── */}
                        <tr
                          className={`transition-colors hover:bg-slate-50 ${
                            isExpanded ? 'bg-slate-50/70 border-b border-teal-200' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                          }`}
                        >
                          {/* Sticky Customer Name Cell with Expand/Collapse & Quota Summary */}
                          <td
                            className="p-2 matrix-col-cust print-col-cust sticky left-0 z-10 bg-inherit border-r border-slate-200 font-bold text-slate-900 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-400"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {hasChildSites ? (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleCustomerExpanded(cust.id)}
                                    className="p-0.5 rounded-md hover:bg-slate-200 text-slate-600 transition-colors print:hidden shrink-0 cursor-pointer"
                                    title={isExpanded ? 'Şantiyeleri Daralt' : 'Şantiyeleri Genişlet'}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown size={15} className="text-teal-700" />
                                    ) : (
                                      <ChevronRight size={15} className="text-slate-500" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-4 shrink-0 print:hidden" />
                                )}
                                <div className="truncate max-w-[150px] print:max-w-none print:whitespace-normal print:text-[8.5px] print:font-bold print:leading-tight print:text-slate-950 break-words" title={cust.name}>
                                  {cust.name}
                                  {qSummary?.hasUnassignedProductQuota && Object.keys(qSummary.productQuotas).length === 0 && (
                                    <span className="print-only text-[7px] font-semibold text-purple-800 ml-1">(Genel Kota)</span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {hasChildSites && (
                                  <span
                                    onClick={() => handleToggleCustomerExpanded(cust.id)}
                                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md cursor-pointer transition-colors print:hidden ${
                                      isExpanded ? 'bg-teal-100 text-teal-800 border border-teal-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                    title="Tıklayarak alt şantiyeleri açıp kapatabilirsiniz"
                                  >
                                    {childSites.length} Şantiye
                                  </span>
                                )}
                                {qSummary?.hasQuota ? (
                                  <span
                                    className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 border border-purple-200 shrink-0 print:hidden"
                                    title={qSummary.hasUnassignedProductQuota && Object.keys(qSummary.productQuotas).length === 0 ? 'Bu cariye spesifik bir taş seçilmemiş, genel metrekare kotası tanımlanmış.' : undefined}
                                  >
                                    {qSummary.hasUnassignedProductQuota && Object.keys(qSummary.productQuotas).length === 0 ? 'Genel Kota' : 'Kotalı'}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-normal px-1 py-0.2 rounded bg-slate-100 text-slate-500 shrink-0 print:hidden">
                                    Serbest
                                  </span>
                                )}
                              </div>
                            </div>
                            {cust.phone && (
                              <div className="text-[10px] text-slate-400 font-normal font-mono mt-0.5 print:text-[7px] print:text-slate-600 print:mt-0">
                                {cust.phone}
                              </div>
                            )}
                            {qSummary?.hasQuota && (
                              <div className="text-[9.5px] text-slate-500 font-normal mt-0.5 flex items-center gap-1 print:hidden">
                                <span className="text-purple-700 font-semibold">Hedef: {qSummary.totalTarget.toLocaleString('tr-TR')}</span>
                                <span>•</span>
                                <span className={qSummary.totalRemaining > 0 ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                                  Kal: {qSummary.totalRemaining.toLocaleString('tr-TR')}
                                </span>
                                {qSummary.hasUnassignedProductQuota && Object.keys(qSummary.productQuotas).length === 0 && (
                                  <span className="text-[8.5px] text-purple-600 font-semibold">(Taş Seçilmemiş)</span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Product Cells ("NE KADAR GİTTİ" / TOPLAM SEVKİYAT + ÜRÜN KOTA BAKİYESİ) */}
                          {filteredProducts.map((prod) => {
                            const dailyShipped = matrix[cust.id]?.[prod.id] || 0;
                            const cumShipped = cumulativeProductMatrix[cust.id]?.[prod.id] || 0;
                            const pQuota = qSummary?.productQuotas?.[prod.id];

                            const displayVal = matrixCellMode === 'daily' ? dailyShipped : cumShipped;
                            const hasValue = displayVal > 0;

                            return (
                              <td
                                key={prod.id}
                                style={{ width: `${productColWidthPct}%` }}
                                className={`p-1.5 text-right font-mono matrix-col-product border-r border-slate-100 print:p-0.5 print:min-w-0 print:border-slate-400 ${
                                  hasValue ? 'font-bold text-slate-900 bg-amber-50/20' : 'text-slate-300'
                                }`}
                              >
                                {matrixCellMode === 'both' ? (
                                  <div>
                                    <div className={cumShipped > 0 ? 'text-slate-900 font-bold text-xs print:text-[8px] print:font-bold' : 'text-slate-300 print:text-slate-400 print:text-[7.5px]'}>
                                      {cumShipped ? Number(cumShipped).toLocaleString('tr-TR') : '-'}
                                    </div>
                                    {dailyShipped > 0 && (
                                      <div className="text-[9.5px] font-bold text-blue-700 print:text-[6.5px] print:text-blue-900">
                                        +{Number(dailyShipped).toLocaleString('tr-TR')} gün
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <div className={hasValue ? 'text-slate-900 font-bold text-xs print:text-[8px] print:font-bold' : 'text-slate-300 print:text-slate-400 print:text-[7.5px]'}>
                                      {hasValue ? Number(displayVal).toLocaleString('tr-TR') : '-'}
                                    </div>
                                    {matrixCellMode === 'cumulative' && dailyShipped > 0 && (
                                      <div className="text-[9.5px] font-bold text-blue-700 print:text-[6.5px] print:text-blue-900">
                                        +{Number(dailyShipped).toLocaleString('tr-TR')} gün
                                      </div>
                                    )}
                                  </div>
                                )}

                                {pQuota && (
                                  <div className="text-[9px] font-sans font-medium mt-0.5 print:hidden">
                                    {pQuota.remaining > 0 ? (
                                      <span
                                        className="text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200 inline-block"
                                        title={`Bu taştan kalan taahhüt: ${pQuota.remaining.toLocaleString('tr-TR')} ${pQuota.unit}`}
                                      >
                                        Kal: {pQuota.remaining.toLocaleString('tr-TR')}
                                      </span>
                                    ) : (
                                      <span className="text-rose-700 bg-rose-50 px-1 py-0.2 rounded border border-rose-200 font-bold inline-block">
                                        Doldu
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}

                          {/* 1. Günlük Sevk Toplamı */}
                          <td
                            className="p-2 matrix-col-daily print-col-daily text-right font-mono font-black text-blue-900 bg-blue-50/60 border-l border-slate-200 print:p-0.5 print:min-w-0 print:border-slate-400 print:text-[8px]"
                          >
                            {custDailyTotal ? Number(custDailyTotal).toLocaleString('tr-TR') : '-'}
                          </td>

                          {/* 2. Toplam Sipariş / Kota */}
                          <td
                            className="p-2 matrix-col-quota print-col-quota text-right font-mono font-bold text-purple-900 bg-purple-50/40 border-l border-purple-100 print:p-0.5 print:min-w-0 print:border-slate-400 print:text-[8px]"
                          >
                            {qSummary?.hasQuota ? Number(qSummary.totalTarget).toLocaleString('tr-TR') : '-'}
                          </td>

                          {/* 3. Kümülatif Çekilen */}
                          <td
                            className="p-2 matrix-col-cum print-col-cum text-right font-mono font-semibold text-amber-900 bg-amber-50/40 border-l border-amber-100 print:p-0.5 print:min-w-0 print:border-slate-400 print:text-[8px]"
                          >
                            {qSummary?.hasQuota ? (
                              <div>
                                <div>{Number(qSummary.totalShipped).toLocaleString('tr-TR')}</div>
                                <div className="text-[9px] text-amber-700 font-normal print:text-[7px]">%{qSummary.completionPct}</div>
                              </div>
                            ) : cumulativeCustomerTotals[cust.id] > 0 ? (
                              <div>
                                <div>{Number(cumulativeCustomerTotals[cust.id]).toLocaleString('tr-TR')}</div>
                                <div className="text-[8.5px] text-slate-400 font-normal print:hidden">Serbest</div>
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>

                          {/* 4. Kalan Açık İhtiyaç Bakiyesi */}
                          <td
                            className="p-2 matrix-col-rem print-col-rem text-right font-mono font-black bg-emerald-50/60 border-l border-emerald-100 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-400 print:text-[8px]"
                          >
                            {qSummary?.hasQuota ? (
                              qSummary.totalRemaining > 0 ? (
                                <span className="text-emerald-800 font-black">+{Number(qSummary.totalRemaining).toLocaleString('tr-TR')}</span>
                              ) : qSummary.netBalance < 0 ? (
                                <span className="text-rose-700 font-bold" title="Sözleşme kotasından fazla sevk yapıldı">
                                  {Number(qSummary.netBalance).toLocaleString('tr-TR')}
                                </span>
                              ) : (
                                <span className="text-blue-700 font-bold">Tamam</span>
                              )
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* 5. Zimmetli Tahta Palet Sayısı */}
                          <td
                            className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-right font-mono font-bold bg-amber-50/50 border-l border-amber-100 print:p-0.5 print:pr-1 print:min-w-0 print:border-slate-400 print:text-[8px]"
                          >
                            {custPallet.tahta !== 0 ? (
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${
                                custPallet.tahta > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'
                              }`}>
                                {custPallet.tahta.toLocaleString('tr-TR')}
                              </span>
                            ) : (
                              <span className="text-slate-300 font-normal">-</span>
                            )}
                          </td>

                          {/* 6. Zimmetli Üretim ve Sevkiyat Paleti */}
                          <td
                            className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-right font-mono font-bold bg-orange-50/50 border-l border-orange-100 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-400 print:text-[8px]"
                          >
                            {custPallet.uretimSevkiyat !== 0 ? (
                              <div title={`Üretim: ${custPallet.uretim}, Sevkiyat: ${custPallet.sevkiyat}`}>
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${
                                  custPallet.uretimSevkiyat > 0 ? 'bg-orange-100 text-orange-900 border border-orange-300' : 'text-slate-400'
                                }`}>
                                  {custPallet.uretimSevkiyat.toLocaleString('tr-TR')}
                                </span>
                                {custPallet.uretim > 0 && custPallet.sevkiyat > 0 && (
                                  <div className="text-[8.5px] text-orange-800 font-semibold print:hidden">
                                    {custPallet.uretim} ü / {custPallet.sevkiyat} s
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-300 font-normal">-</span>
                            )}
                          </td>
                        </tr>

                        {/* ── CHILD SITES SUB-ROWS (RENDERED WHEN EXPANDED) ── */}
                        {isExpanded && childSites.map((site) => {
                          const siteDailyTotal = siteTotals[cust.id]?.[site.id] || 0;
                          const siteCumTotal = cumulativeSiteTotals[cust.id]?.[site.id] || 0;
                          const sitePalletKey = `${cust.id}_${site.id}`;
                          const sitePallet = sitePalletMap[sitePalletKey] || { total: 0, tahta: 0, sevkiyat: 0, uretim: 0, uretimSevkiyat: 0 };
                          const sQuota = siteQuotaMap[cust.id]?.[site.id];

                          return (
                            <tr
                              key={`${cust.id}_${site.id}`}
                              className="bg-slate-50/90 hover:bg-slate-100/90 transition-colors border-l-4 border-l-teal-500/70"
                            >
                              {/* Site Name with indentation */}
                              <td
                                className="p-2 pl-6 matrix-col-cust print-col-cust sticky left-0 z-10 bg-slate-100/95 border-r border-slate-200 font-medium text-slate-800 shadow-xs print:static print:left-auto print:shadow-none print:p-0.5 print:pl-3 print:min-w-0 print:border-slate-400"
                              >
                                <div className="flex items-center gap-1.5 text-xs print:text-[7.5px]">
                                  <span className="text-teal-600 font-bold shrink-0">↳</span>
                                  <span className="text-[11px] print:text-[7.5px] shrink-0">{site.isUnassigned ? '🏢' : '🏗️'}</span>
                                  <span className="font-semibold truncate text-slate-900" title={site.name}>
                                    {site.name}
                                  </span>
                                  {site.isUnassigned && (
                                    <span className="text-[8.5px] text-slate-500 bg-slate-200 px-1 py-0.2 rounded print:hidden shrink-0">
                                      Şantiyesiz
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Site Product Cells */}
                              {filteredProducts.map((prod) => {
                                const siteDailyShipped = siteMatrix[cust.id]?.[site.id]?.[prod.id] || 0;
                                const siteCumShipped = cumulativeSiteProductMatrix[cust.id]?.[site.id]?.[prod.id] || 0;
                                const sitePQuota = sQuota?.productQuotas?.[prod.id];
                                const sDisplayVal = matrixCellMode === 'daily' ? siteDailyShipped : siteCumShipped;
                                const hasSiteVal = sDisplayVal > 0;

                                return (
                                  <td
                                    key={prod.id}
                                    style={{ width: `${productColWidthPct}%` }}
                                    className={`p-1.5 text-right font-mono matrix-col-product border-r border-slate-200/80 print:p-0.5 print:min-w-0 print:border-slate-400 ${
                                      hasSiteVal ? 'font-semibold text-slate-800 bg-teal-50/30' : 'text-slate-300'
                                    }`}
                                  >
                                    {matrixCellMode === 'both' ? (
                                      <div>
                                        <div className={siteCumShipped > 0 ? 'text-slate-800 font-semibold text-xs print:text-[7.5px]' : 'text-slate-300 print:text-[7px]'}>
                                          {siteCumShipped ? Number(siteCumShipped).toLocaleString('tr-TR') : '-'}
                                        </div>
                                        {siteDailyShipped > 0 && (
                                          <div className="text-[9px] font-semibold text-teal-700 print:text-[6.5px]">
                                            +{Number(siteDailyShipped).toLocaleString('tr-TR')} gün
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div>
                                        <div className={hasSiteVal ? 'text-slate-800 font-semibold text-xs print:text-[7.5px]' : 'text-slate-300 print:text-[7px]'}>
                                          {hasSiteVal ? Number(sDisplayVal).toLocaleString('tr-TR') : '-'}
                                        </div>
                                        {matrixCellMode === 'cumulative' && siteDailyShipped > 0 && (
                                          <div className="text-[9px] font-semibold text-teal-700 print:text-[6.5px]">
                                            +{Number(siteDailyShipped).toLocaleString('tr-TR')} gün
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {sitePQuota && (
                                      <div className="text-[8.5px] font-sans font-medium mt-0.5 print:hidden">
                                        <span className="text-teal-700 bg-teal-50 px-1 py-0.2 rounded border border-teal-200 inline-block">
                                          Kal: {sitePQuota.remaining.toLocaleString('tr-TR')}
                                        </span>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}

                              {/* Site Günlük Sevk */}
                              <td
                                className="p-2 matrix-col-daily print-col-daily text-right font-mono font-bold text-teal-900 bg-teal-50/40 border-l border-slate-200 print:p-0.5 print:min-w-0 print:border-slate-400 print:text-[7.5px]"
                              >
                                {siteDailyTotal ? Number(siteDailyTotal).toLocaleString('tr-TR') : '-'}
                              </td>

                              {/* Site Sipariş / Kota */}
                              <td
                                className="p-2 matrix-col-quota print-col-quota text-right font-mono font-medium text-purple-900 bg-purple-50/30 border-l border-purple-100 print:p-0.5 print:min-w-0 print:border-slate-400 print:text-[7.5px]"
                              >
                                {sQuota?.hasQuota ? Number(sQuota.totalTarget).toLocaleString('tr-TR') : '-'}
                              </td>

                              {/* Site Kümülatif Sevk */}
                              <td
                                className="p-2 matrix-col-cum print-col-cum text-right font-mono font-medium text-amber-900 bg-amber-50/30 border-l border-amber-100 print:p-0.5 print:min-w-0 print:border-slate-400 print:text-[7.5px]"
                              >
                                {siteCumTotal ? Number(siteCumTotal).toLocaleString('tr-TR') : '-'}
                              </td>

                              {/* Site Kalan Bakiye */}
                              <td
                                className="p-2 matrix-col-rem print-col-rem text-right font-mono font-bold bg-emerald-50/40 border-l border-emerald-100 print:p-0.5 print:min-w-0 print:border-slate-400 print:text-[7.5px]"
                              >
                                {sQuota?.hasQuota ? (
                                  sQuota.totalRemaining > 0 ? (
                                    <span className="text-emerald-800 font-bold">+{Number(sQuota.totalRemaining).toLocaleString('tr-TR')}</span>
                                  ) : sQuota.netBalance < 0 ? (
                                    <span className="text-rose-700 font-bold" title="Kotadan fazla sevk yapıldı">
                                      {Number(sQuota.netBalance).toLocaleString('tr-TR')}
                                    </span>
                                  ) : (
                                    <span className="text-blue-700 font-medium">Tamam</span>
                                  )
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>

                              {/* Site Zimmetli Tahta Palet */}
                              <td
                                className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-right font-mono font-medium bg-amber-50/40 border-l border-amber-100 print:p-0.5 print:pr-1 print:min-w-0 print:border-slate-400 print:text-[7.5px]"
                              >
                                {sitePallet.tahta !== 0 ? (
                                  <span className="inline-block px-1 py-0.2 rounded text-[10.5px] font-bold bg-amber-100/80 text-amber-900 border border-amber-200">
                                    {sitePallet.tahta.toLocaleString('tr-TR')}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>

                              {/* Site Zimmetli Üretim ve Sevkiyat Paleti */}
                              <td
                                className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-right font-mono font-medium bg-orange-50/40 border-l border-orange-100 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-400 print:text-[7.5px]"
                              >
                                {sitePallet.uretimSevkiyat !== 0 ? (
                                  <span className="inline-block px-1 py-0.2 rounded text-[10.5px] font-bold bg-orange-100/80 text-orange-900 border border-orange-200" title={`Üretim: ${sitePallet.uretim}, Sevkiyat: ${sitePallet.sevkiyat}`}>
                                    {sitePallet.uretimSevkiyat.toLocaleString('tr-TR')}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>

              {/* ── TABLE FOOTER: TOTALS, STOCK, DAILY PRODUCTION & OPEN ORDER DEMAND ── */}
              <tfoot className="border-t-2 border-slate-400 font-bold divide-y divide-slate-200 text-xs print:text-[8px] print:static">
                {/* 1. TOPLAM GİDEN (KÜMÜLATİF SEVKİYAT) */}
                <tr className="bg-blue-100/90 text-blue-950 font-black">
                  <td
                    className="p-2 matrix-col-cust print-col-cust sticky left-0 z-10 bg-blue-200/90 border-r border-blue-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-500"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate">
                        <Package size={14} className="text-blue-800 print:hidden shrink-0" />
                        <span className="print:text-[8px] print:font-black truncate">
                          {matrixCellMode === 'daily' ? 'TOPLAM GİDEN' : 'TOPLAM GİDEN (KÜMÜLATİF)'}
                        </span>
                      </div>
                      <span className="text-[9.5px] text-blue-700 bg-blue-100 px-1.5 py-0.2 rounded print:hidden font-semibold shrink-0">
                        {matrixCellMode === 'daily' ? 'Seçili Gün' : 'Genel Toplam'}
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const cumTotal = cumulativeProductTotals[prod.id] || 0;
                    const dailyTotal = productTotals[prod.id] || 0;
                    const pVal = matrixCellMode === 'daily' ? dailyTotal : cumTotal;

                    return (
                      <td
                        key={prod.id}
                        style={{ width: `${productColWidthPct}%` }}
                        className="p-1.5 text-right font-mono font-black border-r border-blue-200 text-blue-950 text-sm matrix-col-product print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                      >
                        <div>{pVal ? Number(pVal).toLocaleString('tr-TR') : '-'}</div>
                        {matrixCellMode !== 'daily' && dailyTotal > 0 && (
                          <div className="text-[9px] font-bold text-blue-800 print:text-[6.5px]">
                            (+{Number(dailyTotal).toLocaleString('tr-TR')} gün)
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className="p-2 matrix-col-daily print-col-daily text-right font-mono text-sm font-black text-blue-950 bg-blue-300/80 border-l border-blue-300 print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                  >
                    {grandTotalShipped.toLocaleString('tr-TR')}
                  </td>
                  <td
                    className="p-2 matrix-col-quota print-col-quota text-right font-mono text-xs font-black text-purple-950 bg-purple-200/80 border-l border-purple-300 print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                  >
                    {totalQuotaTargetSum ? totalQuotaTargetSum.toLocaleString('tr-TR') : '-'}
                  </td>
                  <td
                    className="p-2 matrix-col-cum print-col-cum text-right font-mono text-xs font-black text-amber-950 bg-amber-200/80 border-l border-amber-300 print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[7.5px]"
                  >
                    {grandTotalCumulativeShipped ? grandTotalCumulativeShipped.toLocaleString('tr-TR') : (totalQuotaShippedSum ? totalQuotaShippedSum.toLocaleString('tr-TR') : '-')}
                  </td>
                  <td
                    className="p-2 matrix-col-rem print-col-rem text-right font-mono text-sm font-black text-emerald-950 bg-emerald-200/90 border-l border-emerald-300 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                  >
                    {totalQuotaRemainingSum ? totalQuotaRemainingSum.toLocaleString('tr-TR') : '-'}
                  </td>
                  <td
                    className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-right font-mono text-sm font-black text-amber-950 bg-amber-200/90 border-l border-amber-300 print:p-0.5 print:pr-1 print:min-w-0 print:border-slate-500 print:text-[8px]"
                  >
                    {grandTotalTahtaPallet ? grandTotalTahtaPallet.toLocaleString('tr-TR') : '-'}
                  </td>
                  <td
                    className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-right font-mono text-sm font-black text-orange-950 bg-orange-200/90 border-l border-orange-300 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                  >
                    <div>{grandTotalUretimSevkiyatPallet ? grandTotalUretimSevkiyatPallet.toLocaleString('tr-TR') : '-'}</div>
                    {grandTotalUretimPallet > 0 && grandTotalSevkiyatPallet > 0 && (
                      <div className="text-[9px] font-semibold text-orange-900 print:hidden">
                        {grandTotalUretimPallet} ü • {grandTotalSevkiyatPallet} s
                      </div>
                    )}
                  </td>
                </tr>

                {/* 1. GÜNE BAŞLANGIÇ STOĞU (DEVİR) */}
                <tr className="bg-slate-100/90 text-slate-950 border-t border-slate-300">
                  <td
                    className="p-2 matrix-col-cust print-col-cust sticky left-0 z-10 bg-slate-200/90 border-r border-slate-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-500"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 print:text-[8px] print:font-black truncate">GÜNE BAŞLANGIÇ STOĞU</span>
                      <span className="text-[10px] text-slate-700 bg-slate-300/60 px-1.5 py-0.5 rounded font-normal print:hidden shrink-0">
                        Sabah Devir
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const stk = stockMap[prod.id] || 0;
                    const prd = dailyProductionMap[prod.id] || 0;
                    const gdn = productTotals[prod.id] || 0;
                    const openStk = stk - prd + gdn;
                    return (
                      <td
                        key={prod.id}
                        style={{ width: `${productColWidthPct}%` }}
                        className="p-1.5 text-right font-mono font-bold border-r border-slate-200 text-slate-900 text-xs matrix-col-product print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                      >
                        {openStk ? openStk.toLocaleString('tr-TR') : '0'}
                      </td>
                    );
                  })}
                  <td colSpan={3} className="p-2 text-right text-slate-800 bg-slate-200/50 border-l border-slate-300 font-mono text-xs font-bold print:p-0.5 print:text-[7.5px] print:border-slate-500">
                    Güne Başlangıç Devir Stoğu:
                  </td>
                  <td className="p-2 matrix-col-rem print-col-rem text-right font-mono text-sm font-black text-slate-950 bg-slate-300/90 border-l border-slate-300 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[8px]">
                    {totalOpeningStock.toLocaleString('tr-TR')}
                  </td>
                  <td className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-center text-slate-400 bg-slate-100/30 border-l border-slate-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                  <td className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-center text-slate-400 bg-slate-100/30 border-l border-slate-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                </tr>

                {/* 2. GÜNLÜK ÜRETİM MİKTARI (OTOMATİK - SİSTEM İMALAT VERİSİ) */}
                <tr className="bg-amber-50/90 text-amber-950">
                  <td
                    className="p-2 matrix-col-cust print-col-cust sticky left-0 z-10 bg-amber-100/90 border-r border-amber-200 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-500"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-900 print:text-[8px] print:font-black truncate">(+) GÜNLÜK ÜRETİM</span>
                      <span className="text-[10px] text-amber-700 bg-amber-200/60 px-1.5 py-0.5 rounded font-normal print:hidden shrink-0">
                        İmalat
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const prd = dailyProductionMap[prod.id] || 0;
                    return (
                      <td
                        key={prod.id}
                        style={{ width: `${productColWidthPct}%` }}
                        className="p-1.5 text-right font-mono font-bold border-r border-amber-200 bg-amber-50/40 text-amber-950 text-xs matrix-col-product print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                      >
                        {prd ? Number(prd).toLocaleString('tr-TR') : '-'}
                      </td>
                    );
                  })}
                  <td colSpan={3} className="p-2 text-right text-amber-800 bg-amber-100/50 border-l border-amber-200 font-mono text-xs font-bold print:p-0.5 print:text-[7.5px] print:border-slate-500">
                    Toplam Günlük İmalat:
                  </td>
                  <td className="p-2 matrix-col-rem print-col-rem text-right font-mono text-sm font-black text-amber-950 bg-amber-200/90 border-l border-amber-300 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[8px]">
                    {totalDailyProduction.toLocaleString('tr-TR')}
                  </td>
                  <td className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-center text-slate-400 bg-amber-100/30 border-l border-amber-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                  <td className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-center text-slate-400 bg-amber-100/30 border-l border-amber-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                </tr>

                {/* 3. GÜNLÜK SEVKİYAT (SEVK) */}
                <tr className="bg-sky-50/90 text-sky-950">
                  <td
                    className="p-2 matrix-col-cust print-col-cust sticky left-0 z-10 bg-sky-100/90 border-r border-sky-200 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-500"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sky-900 print:text-[8px] print:font-black truncate">(-) GÜNLÜK SEVKİYAT</span>
                      <span className="text-[10px] text-sky-700 bg-sky-200/60 px-1.5 py-0.5 rounded font-normal print:hidden shrink-0">
                        Sevk
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const dailyTotal = productTotals[prod.id] || 0;
                    return (
                      <td
                        key={prod.id}
                        style={{ width: `${productColWidthPct}%` }}
                        className="p-1.5 text-right font-mono font-bold border-r border-sky-100 text-sky-900 text-xs matrix-col-product print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px]"
                      >
                        {dailyTotal ? Number(dailyTotal).toLocaleString('tr-TR') : '-'}
                      </td>
                    );
                  })}
                  <td colSpan={3} className="p-2 text-right text-sky-800 bg-sky-100/50 border-l border-sky-200 font-mono text-xs font-bold print:p-0.5 print:text-[7.5px] print:border-slate-500">
                    Toplam Günlük Sevkiyat:
                  </td>
                  <td className="p-2 matrix-col-rem print-col-rem text-right font-mono text-sm font-black text-sky-950 bg-sky-200/90 border-l border-sky-300 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[8px]">
                    {grandTotalShipped.toLocaleString('tr-TR')}
                  </td>
                  <td className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-center text-slate-400 bg-sky-100/30 border-l border-sky-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                  <td className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-center text-slate-400 bg-sky-100/30 border-l border-sky-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                </tr>

                {/* 4. GÜN SONU / MEVCUT DEPO STOĞU */}
                <tr className="bg-emerald-100/90 text-emerald-950 font-black">
                  <td
                    className="p-2 matrix-col-cust print-col-cust sticky left-0 z-10 bg-emerald-200/90 border-r border-emerald-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-500"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-emerald-950 print:text-[8px] truncate">(=) GÜN SONU DEPO STOĞU</span>
                      <span className="text-[10px] text-emerald-800 font-normal print:hidden shrink-0">
                        Mevcut Stok
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const stk = stockMap[prod.id] || 0;
                    return (
                      <td
                        key={prod.id}
                        style={{ width: `${productColWidthPct}%` }}
                        className={`p-1.5 text-right font-mono font-black border-r border-emerald-200 text-xs matrix-col-product print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px] ${
                          stk < 0
                            ? 'text-rose-700 bg-rose-100/70'
                            : stk > 0
                            ? 'text-emerald-950 bg-emerald-50'
                            : 'text-slate-400'
                        }`}
                      >
                        {stk ? Number(stk).toLocaleString('tr-TR') : '0'}
                      </td>
                    );
                  })}
                  <td colSpan={3} className="p-2 text-right text-emerald-900 bg-emerald-200/60 border-l border-emerald-300 font-mono text-xs font-bold print:p-0.5 print:text-[7.5px] print:border-slate-500">
                    Gün Sonu Net Depo Stoğu:
                  </td>
                  <td className={`p-2 matrix-col-rem print-col-rem text-right font-mono text-sm font-black bg-emerald-200/90 border-l border-emerald-300 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[8px] ${totalFactoryStock < 0 ? 'text-rose-700' : 'text-emerald-950'}`}>
                    {totalFactoryStock.toLocaleString('tr-TR')}
                  </td>
                  <td className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-center text-slate-400 bg-emerald-100/30 border-l border-emerald-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                  <td className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-center text-slate-400 bg-emerald-100/30 border-l border-emerald-200 font-mono text-xs print:p-0.5">
                    -
                  </td>
                </tr>

                {/* 5. TOPLAM AÇIK SİPARİŞ / KOTA İHTİYACI (ÜRETİM PLANLAMA KILAVUZU) */}
                <tr className="bg-rose-100/80 text-rose-950 font-black">
                  <td
                    className="p-2 matrix-col-cust print-col-cust sticky left-0 z-10 bg-rose-200/90 border-r border-rose-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:pl-2 print:min-w-0 print:border-slate-500"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-black text-rose-950 uppercase print:text-[8px] truncate">AÇIK KOTA İHTİYACI</span>
                        <div className="text-[10px] text-rose-800 font-normal print:hidden">Planlanacak Üretim Talebi</div>
                      </div>
                      <Target size={14} className="text-rose-800 print:hidden shrink-0" />
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const demand = productQuotaDemands[prod.id] || 0;
                    return (
                      <td
                        key={prod.id}
                        style={{ width: `${productColWidthPct}%` }}
                        className={`p-1.5 text-right font-mono font-black border-r border-rose-200 text-xs matrix-col-product print:p-0.5 print:min-w-0 print:border-slate-500 print:text-[8px] ${
                          demand > 0 ? 'text-rose-900 bg-rose-50' : 'text-slate-300'
                        }`}
                        title={`${prod.name} için teslim edilmesi gereken toplam açık taahhüt`}
                      >
                        {demand ? Number(demand).toLocaleString('tr-TR') : '-'}
                      </td>
                    );
                  })}
                  <td colSpan={3} className="p-2 text-right text-rose-900 bg-rose-200/60 border-l border-rose-300 font-mono text-xs font-bold print:p-0.5 print:text-[7.5px] print:border-slate-500">
                    <div className="leading-tight">
                      <div className="font-black">TÜM AÇIK SİPARİŞ BAKİYESİ:</div>
                      {totalUnassignedQuotaRemainingSum > 0 && (
                        <div className="text-[9px] text-rose-800 font-medium print:text-[6.5px]">
                          (Ürünlü: {Number(totalProductQuotaDemandSum).toLocaleString('tr-TR')} + Genel: {Number(totalUnassignedQuotaRemainingSum).toLocaleString('tr-TR')})
                        </div>
                      )}
                    </div>
                  </td>
                  <td
                    className="p-2 matrix-col-rem print-col-rem text-right font-mono text-sm font-black text-rose-950 bg-rose-300/80 border-l border-rose-300 print:p-0.5 print:pr-1.5 print:min-w-0 print:border-slate-500 print:text-[8.5px]"
                    title={
                      totalUnassignedQuotaRemainingSum > 0
                        ? `Taş Tanımlı Açık İhtiyaç: ${Number(totalProductQuotaDemandSum).toLocaleString('tr-TR')} m²\nGenel (Taşsız) Kotalar: ${Number(totalUnassignedQuotaRemainingSum).toLocaleString('tr-TR')} m² [${unassignedCustomerNames.join(', ')}]`
                        : undefined
                    }
                  >
                    {totalQuotaRemainingSum ? Number(totalQuotaRemainingSum).toLocaleString('tr-TR') : '-'}
                  </td>
                  <td className="p-2 matrix-col-pallet-tahta print-col-pallet-tahta text-center text-slate-400 bg-rose-200/40 border-l border-rose-300 font-mono text-xs print:p-0.5">
                    -
                  </td>
                  <td className="p-2 matrix-col-pallet-uretim print-col-pallet-uretim text-center text-slate-400 bg-rose-200/40 border-l border-rose-300 font-mono text-xs print:p-0.5">
                    -
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>

      {/* ── PRINT-ONLY 3-COLUMN OFFICIAL SIGNATURE BLOCK ── */}
      <div className="signature-block print-only mt-4 pt-2 border-t-2 border-slate-700">
        <div className="grid grid-cols-3 gap-4 text-center text-xs">
          <div className="border border-slate-300 rounded p-1.5">
            <div className="font-bold text-slate-900 text-[9px]">Raporu Hazırlayan</div>
            <div className="text-[8px] text-slate-500 mt-0.5">Saha / Sevkiyat Sorumlusu</div>
            <div className="mt-5 pt-1 border-t border-slate-400 font-mono text-[8px] text-slate-600">İmza & Tarih</div>
          </div>

          <div className="border border-slate-300 rounded p-1.5">
            <div className="font-bold text-slate-900 text-[9px]">Kantar & Lojistik Yetkilisi</div>
            <div className="text-[8px] text-slate-500 mt-0.5">Kantar Sevkiyat Kontrol</div>
            <div className="mt-5 pt-1 border-t border-slate-400 font-mono text-[8px] text-slate-600">İmza & Tarih</div>
          </div>

          <div className="border border-slate-300 rounded p-1.5">
            <div className="font-bold text-slate-900 text-[9px]">Fabrika / Üretim Müdürü</div>
            <div className="text-[8px] text-slate-500 mt-0.5">Onay & Tasdik</div>
            <div className="mt-5 pt-1 border-t border-slate-400 font-mono text-[8px] text-slate-600">İmza & Kaşe</div>
          </div>
        </div>
      </div>
    </div>
  );
}
