import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Product, Customer } from '../types';
import {
  Table, ChevronLeft, ChevronRight, Download, Printer,
  RefreshCw, Layers, Building2, Package, Check, AlertTriangle,
  Filter, CheckSquare, Square, Users, Target, X, Search
} from 'lucide-react';

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface QuotaMetric {
  target: number;
  shipped: number;
  remaining: number;
  unit: string;
}

interface CustomerQuotaSummary {
  hasQuota: boolean;
  totalTarget: number;
  totalShipped: number;
  totalRemaining: number;
  completionPct: number;
  productQuotas: Record<string, QuotaMetric>;
}

export default function DailyShipmentStockMatrixReport() {
  const { user } = useAuth();

  // Mode: 'single' (tek gün - Excel'deki gibi) or 'range' (tarih aralığı)
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single');
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr(new Date()));
  const [startDate, setStartDate] = useState<string>(getLocalDateStr(new Date()));
  const [endDate, setEndDate] = useState<string>(getLocalDateStr(new Date()));

  // Filters
  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'parke' | 'bordur' | 'diger'>('all');
  const [customerFilterMode, setCustomerFilterMode] = useState<'all' | 'with_quota' | 'shipped_only' | 'custom'>('all');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);
  const [customerModalSearch, setCustomerModalSearch] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Raw Database Data
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shipmentItems, setShipmentItems] = useState<any[]>([]);
  const [productionEntries, setProductionEntries] = useState<any[]>([]);
  const [stockViewData, setStockViewData] = useState<any[]>([]);
  const [quotas, setQuotas] = useState<any[]>([]);
  const [cumulativeShipmentItems, setCumulativeShipmentItems] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [latestShipmentDate, setLatestShipmentDate] = useState<string | null>(null);

  // In-line Quick Production Editing State: { [productId: string]: string }
  const [editingProduction, setEditingProduction] = useState<{ [productId: string]: string }>({});
  const [savingProduction, setSavingProduction] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Load Data
  const loadData = async () => {
    setLoading(true);
    try {
      const qStart = dateMode === 'single' ? selectedDate : startDate;
      const qEnd = dateMode === 'single' ? selectedDate : endDate;

      const [prodRes, custRes, shipRes, prodEntriesRes, stockRes, latestShipRes, quotasRes, cumShipItemsRes] = await Promise.all([
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
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
        const pMap: { [id: string]: string } = {};
        prodEntriesRes.data.forEach((pe: any) => {
          const prev = Number(pMap[pe.product_id] || 0);
          pMap[pe.product_id] = String(prev + (Number(pe.net_m2 || pe.total_m2) || 0));
        });
        setEditingProduction(pMap);
      } else {
        setProductionEntries([]);
        setEditingProduction({});
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

  // Matrix Map: matrix[customerId][productId] = totalShipped on selected date/range
  const { matrix, customerTotals, productTotals, grandTotalShipped, activeCustomerIds } = useMemo(() => {
    const mat: { [cust: string]: { [prod: string]: number } } = {};
    const cTotals: { [cust: string]: number } = {};
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
      const prodId = item.product_id;
      const qty = Number(item.m2 || 0);

      if (!custId || !prodId || qty <= 0) return;

      activeSet.add(custId);

      if (!mat[custId]) mat[custId] = {};
      mat[custId][prodId] = (mat[custId][prodId] || 0) + qty;

      cTotals[custId] = (cTotals[custId] || 0) + qty;
      pTotals[prodId] = (pTotals[prodId] || 0) + qty;
      grandTotal += qty;
    });

    return {
      matrix: mat,
      customerTotals: cTotals,
      productTotals: pTotals,
      grandTotalShipped: grandTotal,
      activeCustomerIds: activeSet,
    };
  }, [shipmentItems, dateMode, selectedDate, startDate, endDate]);

  // Customer Quota & Cumulative Shipment Calculations
  const customerQuotaMap = useMemo(() => {
    const map: Record<string, CustomerQuotaSummary> = {};

    customers.forEach((cust) => {
      const custQuotas = quotas.filter((q) => q.customer_id === cust.id);
      if (custQuotas.length === 0) {
        map[cust.id] = {
          hasQuota: false,
          totalTarget: 0,
          totalShipped: 0,
          totalRemaining: 0,
          completionPct: 0,
          productQuotas: {},
        };
        return;
      }

      let totalTarget = 0;
      let totalShipped = 0;
      const productQuotas: Record<string, QuotaMetric> = {};

      custQuotas.forEach((q) => {
        totalTarget += Number(q.target_quantity) || 0;

        // Matching items across history for this quota
        const matching = cumulativeShipmentItems.filter((item) => {
          const s = item.shipments;
          if (!s) return false;
          if (s.customer_id !== q.customer_id) return false;
          if (q.site_id && s.site_id !== q.site_id) return false;
          if (q.product_id && item.product_id !== q.product_id) return false;
          if (q.start_date && s.shipment_date < q.start_date) return false;
          if (q.end_date && s.shipment_date > q.end_date) return false;

          const prod = products.find((p) => p.id === item.product_id);
          const u = prod?.unit === 'metre' || item.unit === 'metre' ? 'metre' : prod?.unit === 'adet' || item.unit === 'adet' ? 'adet' : 'm2';
          if (!q.product_id && u !== q.unit) return false;
          return true;
        });

        const qShipped = matching.reduce((acc, cur) => acc + (Number(cur.m2) || 0), 0);
        totalShipped += qShipped;

        if (q.product_id) {
          const prev = productQuotas[q.product_id];
          const t = (prev?.target || 0) + (Number(q.target_quantity) || 0);
          const sh = (prev?.shipped || 0) + qShipped;
          productQuotas[q.product_id] = {
            target: t,
            shipped: sh,
            remaining: t - sh,
            unit: q.unit || 'm²',
          };
        }
      });

      const totalRemaining = totalTarget - totalShipped;
      const completionPct = totalTarget > 0 ? Math.round((totalShipped / totalTarget) * 100) : 0;

      map[cust.id] = {
        hasQuota: true,
        totalTarget,
        totalShipped,
        totalRemaining,
        completionPct,
        productQuotas,
      };
    });

    return map;
  }, [customers, quotas, cumulativeShipmentItems, products]);

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

  // Save single product production entry
  const handleSaveProduction = async (productId: string) => {
    const qtyStr = editingProduction[productId];
    if (qtyStr === undefined || qtyStr === '') return;

    const qty = Number(qtyStr);
    if (isNaN(qty) || qty < 0) {
      alert('Lütfen geçerli bir üretim miktarı giriniz.');
      return;
    }

    setSavingProduction(true);
    try {
      const targetDate = dateMode === 'single' ? selectedDate : endDate;
      const targetProd = products.find((p) => p.id === productId);

      const existing = productionEntries.find(
        (pe) => pe.product_id === productId && pe.date === targetDate
      );

      if (existing) {
        const { error } = await supabase
          .from('production_entries')
          .update({
            total_m2: qty,
            net_m2: qty,
            total_pallets: targetProd?.m2_per_pallet ? Math.ceil(qty / targetProd.m2_per_pallet) : 1,
            notes: 'Günlük Matris Hızlı Üretim Girişi',
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('production_entries').insert([
          {
            date: targetDate,
            shift: 'Gündüz',
            machine_no: '1',
            product_id: productId,
            total_pallets: targetProd?.m2_per_pallet ? Math.ceil(qty / targetProd.m2_per_pallet) : 1,
            total_m2: qty,
            waste_m2: 0,
            net_m2: qty,
            lot_number: `LOT-${targetDate.replace(/-/g, '')}`,
            notes: 'Günlük Matris Hızlı Üretim Girişi',
            created_by: user?.id || null,
          },
        ]);
        if (error) throw error;
      }

      setSaveSuccessMsg(`"${targetProd?.name || 'Ürün'}" üretimi başarıyla kaydedildi!`);
      setTimeout(() => setSaveSuccessMsg(null), 3500);
      await loadData();
    } catch (err: any) {
      console.error('Üretim kaydetme hatası:', err);
      alert('Üretim kaydedilirken hata oluştu: ' + (err?.message || 'Bilinmeyen hata'));
    } finally {
      setSavingProduction(false);
    }
  };

  // Save all non-empty edited productions at once
  const handleSaveAllProductions = async () => {
    setSavingProduction(true);
    try {
      const targetDate = dateMode === 'single' ? selectedDate : endDate;

      for (const prod of filteredProducts) {
        const valStr = editingProduction[prod.id];
        if (valStr !== undefined && valStr !== '') {
          const qty = Number(valStr);
          if (!isNaN(qty) && qty >= 0) {
            const existing = productionEntries.find((pe) => pe.product_id === prod.id && pe.date === targetDate);
            if (existing) {
              await supabase
                .from('production_entries')
                .update({
                  total_m2: qty,
                  net_m2: qty,
                  total_pallets: prod.m2_per_pallet ? Math.ceil(qty / prod.m2_per_pallet) : 1,
                })
                .eq('id', existing.id);
            } else if (qty > 0) {
              await supabase.from('production_entries').insert([
                {
                  date: targetDate,
                  shift: 'Gündüz',
                  machine_no: '1',
                  product_id: prod.id,
                  total_pallets: prod.m2_per_pallet ? Math.ceil(qty / prod.m2_per_pallet) : 1,
                  total_m2: qty,
                  waste_m2: 0,
                  net_m2: qty,
                  lot_number: `LOT-${targetDate.replace(/-/g, '')}`,
                  notes: 'Günlük Matris Toplu Üretim Girişi',
                  created_by: user?.id || null,
                },
              ]);
            }
          }
        }
      }

      setSaveSuccessMsg('Tüm girilen günlük üretim miktarları başarıyla kaydedildi!');
      setTimeout(() => setSaveSuccessMsg(null), 3500);
      await loadData();
    } catch (err: any) {
      console.error('Toplu üretim kaydetme hatası:', err);
      alert('Üretimler kaydedilirken hata oluştu: ' + err.message);
    } finally {
      setSavingProduction(false);
    }
  };

  // Export to Excel (.xls)
  const handleExportExcel = () => {
    const reportTitle = dateMode === 'single'
      ? `GÜNLÜK SEVKİYAT VE STOK MATRİSİ (${selectedDate})`
      : `SEVKİYAT VE STOK MATRİSİ (${startDate} - ${endDate})`;

    let html = `
      <table border="1" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11px;">
        <thead>
          <tr style="background-color: #1e3a8a; color: #ffffff; font-weight: bold; text-align: center;">
            <th colspan="${filteredProducts.length + 5}" style="font-size: 14px; padding: 10px;">
              PARKE ERP • ${reportTitle}
            </th>
          </tr>
          <tr style="background-color: #f1f5f9; font-weight: bold;">
            <th style="padding: 8px; text-align: left; min-width: 180px;">MÜŞTERİ / CARİ</th>
            ${filteredProducts.map((p) => `<th style="padding: 8px; text-align: right; min-width: 110px;">${p.name} ${p.thickness ? `(${p.thickness})` : ''}</th>`).join('')}
            <th style="padding: 8px; text-align: right; background-color: #dbeafe;">GÜNLÜK SEVK</th>
            <th style="padding: 8px; text-align: right; background-color: #f3e8ff;">SİPARİŞ / KOTA</th>
            <th style="padding: 8px; text-align: right; background-color: #fef3c7;">KÜMÜLATİF SEVK</th>
            <th style="padding: 8px; text-align: right; background-color: #dcfce7;">KALAN BAKİYE</th>
          </tr>
        </thead>
        <tbody>
          ${filteredCustomers.map((c) => {
            const cTotal = customerTotals[c.id] || 0;
            const qSummary = customerQuotaMap[c.id];
            return `
              <tr>
                <td style="padding: 6px; font-weight: bold; background-color: #f8fafc;">
                  ${c.name} ${qSummary?.hasQuota ? '(Kotalı)' : ''}
                </td>
                ${filteredProducts.map((p) => {
                  const val = matrix[c.id]?.[p.id];
                  const pQ = qSummary?.productQuotas?.[p.id];
                  return `<td style="padding: 6px; text-align: right;">
                    ${val ? val.toLocaleString('tr-TR') : '-'}
                    ${pQ ? `<br/><small style="color: #047857;">[Kal: ${pQ.remaining.toLocaleString('tr-TR')}]</small>` : ''}
                  </td>`;
                }).join('')}
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #eff6ff;">
                  ${cTotal ? cTotal.toLocaleString('tr-TR') : '-'}
                </td>
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #faf5ff;">
                  ${qSummary?.hasQuota ? qSummary.totalTarget.toLocaleString('tr-TR') : '-'}
                </td>
                <td style="padding: 6px; text-align: right; background-color: #fffbeb;">
                  ${qSummary?.hasQuota ? `${qSummary.totalShipped.toLocaleString('tr-TR')} (%${qSummary.completionPct})` : '-'}
                </td>
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #f0fdf4; color: ${qSummary?.totalRemaining < 0 ? '#b91c1c' : '#15803d'};">
                  ${qSummary?.hasQuota ? qSummary.totalRemaining.toLocaleString('tr-TR') : '-'}
                </td>
              </tr>
            `;
          }).join('')}

          <!-- TOPLAM GİDEN -->
          <tr style="background-color: #dbeafe; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px;">TOPLAM GİDEN (SEVKİYAT)</td>
            ${filteredProducts.map((p) => {
              const pTot = productTotals[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #1e40af;">${pTot ? pTot.toLocaleString('tr-TR') : '-'}</td>`;
            }).join('')}
            <td style="padding: 8px; text-align: right; color: #1e40af;">${grandTotalShipped.toLocaleString('tr-TR')}</td>
            <td style="padding: 8px; text-align: right; color: #6b21a8;">${totalQuotaTargetSum ? totalQuotaTargetSum.toLocaleString('tr-TR') : '-'}</td>
            <td style="padding: 8px; text-align: right; color: #b45309;">${totalQuotaShippedSum ? totalQuotaShippedSum.toLocaleString('tr-TR') : '-'}</td>
            <td style="padding: 8px; text-align: right; color: #15803d;">${totalQuotaRemainingSum ? totalQuotaRemainingSum.toLocaleString('tr-TR') : '-'}</td>
          </tr>

          <!-- MEVCUT DEPO STOK -->
          <tr style="background-color: #dcfce7; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #166534;">MEVCUT DEPO STOK</td>
            ${filteredProducts.map((p) => {
              const stk = stockMap[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #166534;">${stk.toLocaleString('tr-TR')}</td>`;
            }).join('')}
            <td colspan="4" style="padding: 8px; text-align: center; color: #166534;">-</td>
          </tr>

          <!-- GÜNLÜK ÜRETİM MİKTARI -->
          <tr style="background-color: #fef3c7; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #92400e;">GÜNLÜK ÜRETİM MİKTARI</td>
            ${filteredProducts.map((p) => {
              const prd = editingProduction[p.id] || dailyProductionMap[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #92400e;">${prd ? Number(prd).toLocaleString('tr-TR') : '-'}</td>`;
            }).join('')}
            <td colspan="4" style="padding: 8px; text-align: center; color: #92400e;">-</td>
          </tr>

          <!-- GÜN SONU DENGE -->
          <tr style="background-color: #f3e8ff; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #6b21a8;">GÜN SONU / NET KALAN DENGE</td>
            ${filteredProducts.map((p) => {
              const stk = stockMap[p.id] || 0;
              const prd = Number(editingProduction[p.id] || dailyProductionMap[p.id] || 0);
              const gdn = productTotals[p.id] || 0;
              const balance = stk + prd - gdn;
              return `<td style="padding: 8px; text-align: right; color: #6b21a8;">${balance.toLocaleString('tr-TR')}</td>`;
            }).join('')}
            <td colspan="4" style="padding: 8px; text-align: center; color: #6b21a8;">-</td>
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
    <div className="space-y-4">
      {/* ── PRINT MEDIA STYLES (A4 LANDSCAPE & MULTI-PAGE THEAD REPEAT) ── */}
      <style>{`
        @media print {
          @page {
            size: landscape;
            margin: 5mm 4mm 5mm 4mm;
          }
          html, body, #root, main {
            background: white !important;
            color: black !important;
            overflow: visible !important;
            overflow-x: visible !important;
            overflow-y: visible !important;
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            min-height: 0 !important;
            position: static !important;
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
          }

          table.matrix-table {
            display: table !important;
            width: 100% !important;
            max-width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse !important;
            border-spacing: 0 !important;
            page-break-after: auto;
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
            border: 0.5pt solid #475569 !important;
            padding: 2.5px 1.5px !important;
            font-size: 6.5px !important;
            line-height: 1.15 !important;
            white-space: normal !important;
            word-break: break-word !important;
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
            border: 0.5pt solid #94a3b8 !important;
            padding: 1.5px 1.5px !important;
            font-size: 7px !important;
            line-height: 1.15 !important;
            word-break: break-word !important;
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
            border: 0.5pt solid #475569 !important;
            padding: 2px 1.5px !important;
            font-size: 6.5px !important;
            line-height: 1.15 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Reset min-widths so table strictly fits 100% of A4 landscape width */
          th, td, div {
            min-width: 0 !important;
            max-width: none !important;
          }

          .print-col-cust {
            width: 14% !important;
            min-width: 75px !important;
          }
          .print-col-daily {
            width: 5% !important;
            min-width: 26px !important;
          }
          .print-col-quota {
            width: 5.5% !important;
            min-width: 30px !important;
          }
          .print-col-cum {
            width: 5.5% !important;
            min-width: 30px !important;
          }
          .print-col-rem {
            width: 6% !important;
            min-width: 34px !important;
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
                Müşteri kotaları ve açık sipariş bakiyeleriyle entegre fabrika üretim ve sevkiyat denge tablosu
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

          {/* Product Type Filter & Show Options */}
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
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

        {/* Success Alert */}
        {saveSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs font-semibold flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <Check size={16} className="text-emerald-600" />
              <span>{saveSuccessMsg}</span>
            </div>
            <span className="text-[10px] text-emerald-700">Veritabanı güncellendi</span>
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
      <div className="print-only border-b-2 border-slate-800 pb-3 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">PARKE ERP • FABRİKA YÖNETİM SİSTEMİ</h1>
            <h2 className="text-sm font-bold text-emerald-800 uppercase mt-0.5">
              📋 GÜNLÜK MÜŞTERİ SEVKİYAT, ÜRETİM & STOK PLANLAMA MATRİSİ
            </h2>
          </div>
          <div className="text-right text-[10px] text-slate-600 font-mono">
            <div><strong>Rapor Tarihi:</strong> {new Date().toLocaleString('tr-TR')}</div>
            <div>
              <strong>Rapor Dönemi:</strong> {dateMode === 'single' ? selectedDate : `${startDate} → ${endDate}`}
            </div>
            <div><strong>Cari Filtresi:</strong> {customerFilterMode === 'all' ? 'Tüm Aktif Cariler' : customerFilterMode === 'with_quota' ? 'Sadece Kotalı Cariler' : customerFilterMode === 'shipped_only' ? 'Bugün Sevk Görenler' : 'Özel Seçim'} ({filteredCustomers.length} Cari)</div>
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
        ) : (
          <div className="matrix-scroll-wrapper overflow-x-auto max-h-[720px] relative print:overflow-visible print:max-h-none print:h-auto print:static">
            <table className="matrix-table w-full text-xs text-left border-collapse select-text print:text-[7px] print:w-full">
              {/* ── TABLE HEADER: PRODUCTS & SUMMARY COLUMNS ── */}
              <thead className="matrix-thead sticky top-0 z-20 bg-slate-100 shadow-xs print:static print:table-header-group">
                <tr className="border-b border-slate-300 text-slate-700 font-bold">
                  {/* Sticky Column A: Customer Header */}
                  <th className="p-3 print-col-cust sticky left-0 z-30 bg-slate-200 min-w-[210px] border-r border-slate-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-600 print:hidden" />
                      <span>Müşteri / Cari Ünvanı</span>
                    </div>
                  </th>

                  {/* Product Columns */}
                  {filteredProducts.map((prod) => (
                    <th
                      key={prod.id}
                      className="p-2.5 text-right min-w-[125px] border-r border-slate-200 bg-slate-100 print:p-1 print:min-w-0 print:border-slate-400 print:text-[7px]"
                      title={`${prod.name} (${prod.thickness || ''} ${prod.color || ''})`}
                    >
                      <div className="font-bold text-slate-900 text-[11px] leading-tight line-clamp-2 print:text-[7px] print:leading-none print:line-clamp-none">
                        {prod.name}
                      </div>
                      <div className="text-[10px] text-slate-500 font-normal flex items-center justify-end gap-1 mt-0.5 print:text-[6px] print:mt-0">
                        <span>{prod.thickness ? `${prod.thickness}` : ''}</span>
                        {prod.color && <span>• {prod.color}</span>}
                        <span className="font-semibold text-slate-700">({prod.unit || 'm²'})</span>
                      </div>
                    </th>
                  ))}

                  {/* Far Right 4 Columns: Planning & Balance Tracking */}
                  <th className="p-2.5 print-col-daily text-right min-w-[95px] bg-blue-100 text-blue-950 font-black border-l border-slate-300 print:p-1 print:min-w-0 print:border-slate-400 print:text-[7px]">
                    <div className="text-[10px] uppercase print:text-[7px] print:leading-none">GÜNLÜK SEVK</div>
                    <div className="text-[9px] text-blue-700 font-normal print:hidden">Bu Gün / Aralık</div>
                  </th>
                  <th className="p-2.5 print-col-quota text-right min-w-[105px] bg-purple-100 text-purple-950 font-black border-l border-purple-200 print:p-1 print:min-w-0 print:border-slate-400 print:text-[7px]">
                    <div className="text-[10px] uppercase print:text-[7px] print:leading-none">SİPARİŞ / KOTA</div>
                    <div className="text-[9px] text-purple-700 font-normal print:hidden">Taahhüt</div>
                  </th>
                  <th className="p-2.5 print-col-cum text-right min-w-[105px] bg-amber-100 text-amber-950 font-black border-l border-amber-200 print:p-1 print:min-w-0 print:border-slate-400 print:text-[7px]">
                    <div className="text-[10px] uppercase print:text-[7px] print:leading-none">KÜMÜLATİF SEVK</div>
                    <div className="text-[9px] text-amber-700 font-normal print:hidden">Tüm Çekilen</div>
                  </th>
                  <th className="p-2.5 print-col-rem text-right min-w-[110px] bg-emerald-100 text-emerald-950 font-black border-l border-emerald-200 print:p-1 print:min-w-0 print:border-slate-400 print:text-[7px]">
                    <div className="text-[10px] uppercase print:text-[7px] print:leading-none">KALAN BAKİYE</div>
                    <div className="text-[9px] text-emerald-700 font-normal print:hidden">Açık İhtiyaç</div>
                  </th>
                </tr>
              </thead>

              {/* ── TABLE BODY: CUSTOMERS (ROWS) ── */}
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={filteredProducts.length + 5}
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

                    return (
                      <tr
                        key={cust.id}
                        className={`transition-colors hover:bg-slate-50 ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                        }`}
                      >
                        {/* Sticky Customer Name Cell with Quota Summary */}
                        <td className="p-2.5 print-col-cust sticky left-0 z-10 bg-inherit border-r border-slate-200 font-bold text-slate-900 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className="truncate max-w-[160px] print:max-w-none print:whitespace-normal print:text-[7px] print:leading-tight" title={cust.name}>
                              {cust.name}
                            </div>
                            {qSummary?.hasQuota ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 border border-purple-200 shrink-0 print:text-[6px] print:px-1 print:py-0">
                                Kotalı
                              </span>
                            ) : (
                              <span className="text-[9px] font-normal px-1 py-0.2 rounded bg-slate-100 text-slate-500 shrink-0 print:hidden">
                                Serbest
                              </span>
                            )}
                          </div>
                          {cust.phone && (
                            <div className="text-[10px] text-slate-400 font-normal font-mono mt-0.5 print:text-[6px] print:mt-0">
                              {cust.phone}
                            </div>
                          )}
                          {qSummary?.hasQuota && (
                            <div className="text-[9.5px] text-slate-500 font-normal mt-0.5 flex items-center gap-1 print:text-[6px] print:mt-0">
                              <span className="text-purple-700 font-semibold">Hedef: {qSummary.totalTarget.toLocaleString('tr-TR')}</span>
                              <span>•</span>
                              <span className={qSummary.totalRemaining > 0 ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                                Kal: {qSummary.totalRemaining.toLocaleString('tr-TR')}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Product Cells ("NE KADAR GİTTİ" + ÜRÜN KOTA BAKİYESİ) */}
                        {filteredProducts.map((prod) => {
                          const shipped = matrix[cust.id]?.[prod.id];
                          const pQuota = qSummary?.productQuotas?.[prod.id];

                          return (
                            <td
                              key={prod.id}
                              className={`p-2 text-right font-mono border-r border-slate-100 print:p-1 print:min-w-0 ${
                                shipped ? 'font-bold text-slate-900 bg-amber-50/30' : 'text-slate-300'
                              }`}
                            >
                              <div className={shipped ? 'text-slate-900 font-bold text-xs print:text-[7px]' : 'text-slate-300 print:text-[6.5px]'}>
                                {shipped ? Number(shipped).toLocaleString('tr-TR') : '-'}
                              </div>
                              {pQuota && (
                                <div className="text-[9px] font-sans font-medium mt-0.5 print:text-[5.5px] print:mt-0">
                                  {pQuota.remaining > 0 ? (
                                    <span
                                      className="text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200 inline-block print:border-none print:bg-transparent print:p-0"
                                      title={`Bu taştan kalan taahhüt: ${pQuota.remaining.toLocaleString('tr-TR')} ${pQuota.unit}`}
                                    >
                                      Kal: {pQuota.remaining.toLocaleString('tr-TR')}
                                    </span>
                                  ) : (
                                    <span className="text-rose-700 bg-rose-50 px-1 py-0.2 rounded border border-rose-200 font-bold inline-block print:border-none print:bg-transparent print:p-0">
                                      Doldu
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}

                        {/* 1. Günlük Sevk Toplamı */}
                        <td className="p-2.5 print-col-daily text-right font-mono font-black text-blue-900 bg-blue-50/60 border-l border-slate-200 print:p-1 print:min-w-0 print:text-[7px]">
                          {custDailyTotal ? Number(custDailyTotal).toLocaleString('tr-TR') : '-'}
                        </td>

                        {/* 2. Toplam Sipariş / Kota */}
                        <td className="p-2.5 print-col-quota text-right font-mono font-bold text-purple-900 bg-purple-50/40 border-l border-purple-100 print:p-1 print:min-w-0 print:text-[7px]">
                          {qSummary?.hasQuota ? Number(qSummary.totalTarget).toLocaleString('tr-TR') : '-'}
                        </td>

                        {/* 3. Kümülatif Çekilen */}
                        <td className="p-2.5 print-col-cum text-right font-mono font-semibold text-amber-900 bg-amber-50/40 border-l border-amber-100 print:p-1 print:min-w-0 print:text-[7px]">
                          {qSummary?.hasQuota ? (
                            <div>
                              <div>{Number(qSummary.totalShipped).toLocaleString('tr-TR')}</div>
                              <div className="text-[9px] text-amber-700 font-normal print:text-[6px]">%{qSummary.completionPct}</div>
                            </div>
                          ) : (
                            '-'
                          )}
                        </td>

                        {/* 4. Kalan Açık İhtiyaç Bakiyesi */}
                        <td className="p-2.5 print-col-rem text-right font-mono font-black bg-emerald-50/60 border-l border-emerald-100 print:p-1 print:min-w-0 print:text-[7px]">
                          {qSummary?.hasQuota ? (
                            qSummary.totalRemaining > 0 ? (
                              <span className="text-emerald-700">+{Number(qSummary.totalRemaining).toLocaleString('tr-TR')}</span>
                            ) : qSummary.totalRemaining === 0 ? (
                              <span className="text-blue-700">Tamam</span>
                            ) : (
                              <span className="text-rose-600">{Number(qSummary.totalRemaining).toLocaleString('tr-TR')}</span>
                            )
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* ── TABLE FOOTER: TOTALS, STOCK, DAILY PRODUCTION & OPEN ORDER DEMAND ── */}
              <tfoot className="border-t-2 border-slate-400 font-bold divide-y divide-slate-200 text-xs print:text-[7px] print:static">
                {/* 1. TOPLAM GİDEN (SEVKİYAT) */}
                <tr className="bg-blue-100/90 text-blue-950 font-black">
                  <td className="p-2.5 print-col-cust sticky left-0 z-10 bg-blue-200/90 border-r border-blue-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Package size={14} className="text-blue-800 print:hidden" />
                      <span>TOPLAM GİDEN (SEVKİYAT)</span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const pTotal = productTotals[prod.id] || 0;
                    return (
                      <td key={prod.id} className="p-2 text-right font-mono font-black border-r border-blue-200 text-blue-950 text-sm print:p-1 print:min-w-0 print:text-[7px]">
                        {pTotal ? Number(pTotal).toLocaleString('tr-TR') : '-'}
                      </td>
                    );
                  })}
                  <td className="p-2.5 print-col-daily text-right font-mono text-sm font-black text-blue-950 bg-blue-300/80 border-l border-blue-300 print:p-1 print:min-w-0 print:text-[7px]">
                    {grandTotalShipped.toLocaleString('tr-TR')}
                  </td>
                  <td className="p-2.5 print-col-quota text-right font-mono text-xs font-black text-purple-950 bg-purple-200/80 border-l border-purple-300 print:p-1 print:min-w-0 print:text-[7px]">
                    {totalQuotaTargetSum ? totalQuotaTargetSum.toLocaleString('tr-TR') : '-'}
                  </td>
                  <td className="p-2.5 print-col-cum text-right font-mono text-xs font-black text-amber-950 bg-amber-200/80 border-l border-amber-300 print:p-1 print:min-w-0 print:text-[7px]">
                    {totalQuotaShippedSum ? totalQuotaShippedSum.toLocaleString('tr-TR') : '-'}
                  </td>
                  <td className="p-2.5 print-col-rem text-right font-mono text-sm font-black text-emerald-950 bg-emerald-200/90 border-l border-emerald-300 print:p-1 print:min-w-0 print:text-[7px]">
                    {totalQuotaRemainingSum ? totalQuotaRemainingSum.toLocaleString('tr-TR') : '-'}
                  </td>
                </tr>

                {/* 2. MEVCUT FABRİKA STOĞU */}
                <tr className="bg-emerald-50/90 text-emerald-950">
                  <td className="p-2.5 print-col-cust sticky left-0 z-10 bg-emerald-100/90 border-r border-emerald-200 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-900">MEVCUT FABRİKA STOĞU</span>
                      <span className="text-[10px] text-emerald-700 bg-emerald-200/60 px-1.5 py-0.5 rounded font-normal print:hidden">
                        Depo
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const stk = stockMap[prod.id] || 0;
                    return (
                      <td key={prod.id} className="p-2 text-right font-mono font-bold border-r border-emerald-100 text-emerald-900 text-xs print:p-1 print:min-w-0 print:text-[7px]">
                        {stk ? stk.toLocaleString('tr-TR') : '-'}
                      </td>
                    );
                  })}
                  <td colSpan={4} className="p-2.5 text-center text-emerald-800 bg-emerald-100/50 border-l border-emerald-200 font-mono text-xs font-bold print:p-1 print:text-[6.5px]">
                    Fabrika Sahasındaki Hazır Mamul Rezervi
                  </td>
                </tr>

                {/* 3. GÜNLÜK ÜRETİM MİKTARI (HÜCRE İÇİ DÜZENLENEBİLİR) */}
                <tr className="bg-amber-50/90 text-amber-950">
                  <td className="p-2.5 print-col-cust sticky left-0 z-10 bg-amber-100/90 border-r border-amber-200 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:min-w-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-amber-900">GÜNLÜK ÜRETİM MİKTARI</span>
                        <div className="text-[10px] text-amber-700 font-normal print:hidden">Hücreye yazıp kaydedin</div>
                      </div>
                      <button
                        onClick={handleSaveAllProductions}
                        disabled={savingProduction}
                        className="no-print px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-bold shadow-xs cursor-pointer transition-colors"
                        title="Tüm girilen üretimleri veritabanına kaydet"
                      >
                        {savingProduction ? '...' : 'Tümünü Kaydet'}
                      </button>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const currentVal = editingProduction[prod.id] !== undefined
                      ? editingProduction[prod.id]
                      : dailyProductionMap[prod.id]
                      ? String(dailyProductionMap[prod.id])
                      : '';

                    return (
                      <td key={prod.id} className="p-1 text-right font-mono border-r border-amber-200 bg-amber-50/40 print:p-1 print:min-w-0 print:text-[7px]">
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="number"
                            placeholder="0"
                            value={currentVal}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditingProduction((prev) => ({ ...prev, [prod.id]: val }));
                            }}
                            className="w-16 bg-white border border-amber-300 rounded px-1.5 py-0.5 text-right font-mono text-xs font-bold text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-500 no-print"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveProduction(prod.id)}
                            className="no-print text-amber-700 hover:text-amber-950 hover:bg-amber-200/70 p-1 rounded cursor-pointer"
                            title="Bu üretimi kaydet"
                          >
                            <Check size={13} />
                          </button>
                          <span className="print-only text-right font-bold text-amber-950">
                            {currentVal ? Number(currentVal).toLocaleString('tr-TR') : '-'}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td colSpan={4} className="p-2.5 text-center text-amber-800 bg-amber-100/50 border-l border-amber-200 font-mono text-xs font-bold print:p-1 print:text-[6.5px]">
                    Vibropres Bantlarından Çıkan Günlük Üretim
                  </td>
                </tr>

                {/* 4. GÜN SONU / NET KALAN DENGE */}
                <tr className="bg-purple-100/80 text-purple-950 font-black">
                  <td className="p-2.5 print-col-cust sticky left-0 z-10 bg-purple-200/90 border-r border-purple-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-purple-950">GÜN SONU KALAN / DENGE</span>
                      <span className="text-[10px] text-purple-800 font-normal print:hidden">
                        Stok+Üretim-Sevk
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const stk = stockMap[prod.id] || 0;
                    const prd = Number(editingProduction[prod.id] || dailyProductionMap[prod.id] || 0);
                    const gdn = productTotals[prod.id] || 0;
                    const balance = stk + prd - gdn;

                    return (
                      <td
                        key={prod.id}
                        className={`p-2 text-right font-mono font-black border-r border-purple-200 text-xs print:p-1 print:min-w-0 print:text-[7px] ${
                          balance < 0
                            ? 'text-rose-700 bg-rose-100/70'
                            : balance > 0
                            ? 'text-purple-950 bg-purple-50'
                            : 'text-slate-400'
                        }`}
                      >
                        {balance ? Number(balance).toLocaleString('tr-TR') : '0'}
                      </td>
                    );
                  })}
                  <td colSpan={4} className="p-2.5 text-center text-purple-900 bg-purple-200/60 border-l border-purple-300 font-mono text-xs font-bold print:p-1 print:text-[6.5px]">
                    Gün Sonu Net Stok Bakiyesi
                  </td>
                </tr>

                {/* 5. TOPLAM AÇIK SİPARİŞ / KOTA İHTİYACI (ÜRETİM PLANLAMA KILAVUZU) */}
                <tr className="bg-rose-100/80 text-rose-950 font-black">
                  <td className="p-2.5 print-col-cust sticky left-0 z-10 bg-rose-200/90 border-r border-rose-300 shadow-xs print:static print:left-auto print:shadow-none print:p-1 print:min-w-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-black text-rose-950 uppercase">AÇIK KOTA İHTİYACI</span>
                        <div className="text-[10px] text-rose-800 font-normal print:hidden">Planlanacak Üretim Talebi</div>
                      </div>
                      <Target size={14} className="text-rose-800 print:hidden" />
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const demand = productQuotaDemands[prod.id] || 0;
                    return (
                      <td
                        key={prod.id}
                        className={`p-2 text-right font-mono font-black border-r border-rose-200 text-xs print:p-1 print:min-w-0 print:text-[7px] ${
                          demand > 0 ? 'text-rose-900 bg-rose-50' : 'text-slate-300'
                        }`}
                        title={`${prod.name} için teslim edilmesi gereken toplam açık taahhüt`}
                      >
                        {demand ? Number(demand).toLocaleString('tr-TR') : '-'}
                      </td>
                    );
                  })}
                  <td colSpan={3} className="p-2.5 text-right text-rose-900 bg-rose-200/60 border-l border-rose-300 font-mono text-xs font-bold print:p-1 print:text-[6.5px]">
                    TÜM AÇIK SİPARİŞ BAKİYESİ:
                  </td>
                  <td className="p-2.5 print-col-rem text-right font-mono text-sm font-black text-rose-950 bg-rose-300/80 border-l border-rose-300 print:p-1 print:min-w-0 print:text-[7px]">
                    {totalQuotaRemainingSum ? Number(totalQuotaRemainingSum).toLocaleString('tr-TR') : '-'}
                  </td>
                </tr>
              </tfoot>
            </table>
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
