import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Product, Customer } from '../types';
import {
  Table, ChevronLeft, ChevronRight, Download, Printer,
  RefreshCw, Layers, Building2, Package, Check, AlertTriangle
} from 'lucide-react';

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function DailyShipmentStockMatrixReport() {
  const { user } = useAuth();

  // Mode: 'single' (tek gün - Excel'deki gibi) or 'range' (tarih aralığı)
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single');
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr(new Date()));
  const [startDate, setStartDate] = useState<string>(getLocalDateStr(new Date()));
  const [endDate, setEndDate] = useState<string>(getLocalDateStr(new Date()));

  // Filters
  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'parke' | 'bordur' | 'diger'>('all');
  const [showOnlyShippedCustomers, setShowOnlyShippedCustomers] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Raw Database Data
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shipmentItems, setShipmentItems] = useState<any[]>([]);
  const [productionEntries, setProductionEntries] = useState<any[]>([]);
  const [stockViewData, setStockViewData] = useState<any[]>([]);
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

      const [prodRes, custRes, shipRes, prodEntriesRes, stockRes, latestShipRes] = await Promise.all([
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
      ]);

      if (prodRes.data) setProducts(prodRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (stockRes.data) setStockViewData(stockRes.data);
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
        // Pre-fill in-line editing map for the active day
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

  // Matrix Map: matrix[customerId][productId] = totalShipped
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

  // Filtered Customers (Rows)
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      if (showOnlyShippedCustomers && !activeCustomerIds.has(c.id)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [customers, showOnlyShippedCustomers, activeCustomerIds, searchQuery]);

  // Current Stock Map: stockMap[productId] = current_stock
  const stockMap = useMemo(() => {
    const sm: { [prodId: string]: number } = {};
    stockViewData.forEach((s) => {
      sm[s.product_id] = Number(s.current_stock || 0);
    });
    return sm;
  }, [stockViewData]);

  // Daily Production Map: prodMap[productId] = totalProduced
  const dailyProductionMap = useMemo(() => {
    const pm: { [prodId: string]: number } = {};
    productionEntries.forEach((pe) => {
      pm[pe.product_id] = (pm[pe.product_id] || 0) + (Number(pe.net_m2 || pe.total_m2) || 0);
    });
    return pm;
  }, [productionEntries]);

  // Save in-line edited production to Supabase
  const handleSaveProduction = async (productId: string) => {
    const rawVal = editingProduction[productId];
    const qty = Number(rawVal);
    if (isNaN(qty) || qty < 0) {
      alert('Lütfen geçerli bir üretim miktarı giriniz.');
      return;
    }

    setSavingProduction(true);
    try {
      const targetDate = dateMode === 'single' ? selectedDate : endDate;
      const targetProd = products.find((p) => p.id === productId);

      // Check if existing record for this date and product exists
      const existing = productionEntries.find((pe) => pe.product_id === productId && pe.date === targetDate);

      if (existing) {
        const { error } = await supabase
          .from('production_entries')
          .update({
            total_m2: qty,
            net_m2: qty,
            total_pallets: targetProd?.m2_per_pallet ? Math.ceil(qty / targetProd.m2_per_pallet) : 1,
            notes: (existing.notes ? existing.notes + ' ' : '') + '[Matris Hızlı Güncelleme]',
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else if (qty > 0) {
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
            <th colspan="${filteredProducts.length + 2}" style="font-size: 14px; padding: 10px;">
              PARKE ERP • ${reportTitle}
            </th>
          </tr>
          <tr style="background-color: #f1f5f9; font-weight: bold;">
            <th style="padding: 8px; text-align: left; min-width: 180px;">MÜŞTERİ / CARİ</th>
            ${filteredProducts.map((p) => `<th style="padding: 8px; text-align: right; min-width: 110px;">${p.name} ${p.thickness ? `(${p.thickness})` : ''}</th>`).join('')}
            <th style="padding: 8px; text-align: right; background-color: #e2e8f0;">TOPLAM SEVK</th>
          </tr>
        </thead>
        <tbody>
          ${filteredCustomers.map((c) => {
            const cTotal = customerTotals[c.id] || 0;
            return `
              <tr>
                <td style="padding: 6px; font-weight: bold; background-color: #f8fafc;">${c.name}</td>
                ${filteredProducts.map((p) => {
                  const val = matrix[c.id]?.[p.id];
                  return `<td style="padding: 6px; text-align: right;">${val ? val.toLocaleString('tr-TR') : '-'}</td>`;
                }).join('')}
                <td style="padding: 6px; text-align: right; font-weight: bold; background-color: #e0f2fe;">${cTotal ? cTotal.toLocaleString('tr-TR') : '-'}</td>
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
          </tr>

          <!-- STOK -->
          <tr style="background-color: #dcfce7; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #166534;">MEVCUT DEPO STOK</td>
            ${filteredProducts.map((p) => {
              const stk = stockMap[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #166534;">${stk.toLocaleString('tr-TR')}</td>`;
            }).join('')}
            <td style="padding: 8px; text-align: right; color: #166534;">-</td>
          </tr>

          <!-- ÜRETİM MİKTARI -->
          <tr style="background-color: #fef3c7; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #92400e;">GÜNLÜK ÜRETİM MİKTARI</td>
            ${filteredProducts.map((p) => {
              const prd = editingProduction[p.id] || dailyProductionMap[p.id] || 0;
              return `<td style="padding: 8px; text-align: right; color: #92400e;">${prd ? Number(prd).toLocaleString('tr-TR') : '-'}</td>`;
            }).join('')}
            <td style="padding: 8px; text-align: right; color: #92400e;">-</td>
          </tr>

          <!-- NET GÜN SONU DENGE -->
          <tr style="background-color: #f3e8ff; font-weight: bold; font-size: 12px;">
            <td style="padding: 8px; color: #6b21a8;">GÜN SONU / NET KALAN DENGE</td>
            ${filteredProducts.map((p) => {
              const stk = stockMap[p.id] || 0;
              const prd = Number(editingProduction[p.id] || dailyProductionMap[p.id] || 0);
              const gdn = productTotals[p.id] || 0;
              const balance = stk + prd - gdn;
              return `<td style="padding: 8px; text-align: right; color: #6b21a8;">${balance.toLocaleString('tr-TR')}</td>`;
            }).join('')}
            <td style="padding: 8px; text-align: right; color: #6b21a8;">-</td>
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
    link.download = `RAPOR_111_SEVK_STOK_MATRIS_${dateMode === 'single' ? selectedDate : `${startDate}_${endDate}`}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print Report (A4 Landscape)
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* ── PRINT CSS STYLES ── */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 0.6cm 0.8cm !important;
          }
          aside, header, nav, .no-print, button, input, select {
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
          .overflow-x-auto {
            overflow: visible !important;
            width: 100% !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-size: 8.5px !important;
          }
          th {
            background-color: #f1f5f9 !important;
            color: #0f172a !important;
            border: 1px solid #94a3b8 !important;
            padding: 4px 6px !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          td {
            border: 1px solid #cbd5e1 !important;
            padding: 3px 5px !important;
            vertical-align: middle !important;
          }
          .print-exact {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
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
                Günlük Sevk, Üretim & Stok Denge Matrisi
                <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">
                  Excel Görünümü
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Taş cinsleri bazında müşterilere giden sevk miktarları, mevcut stok ve günlük üretim dengesi
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
          <div className="flex items-center gap-3 flex-wrap w-full md:w-auto justify-end">
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

            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200">
              <input
                type="checkbox"
                checked={showOnlyShippedCustomers}
                onChange={(e) => setShowOnlyShippedCustomers(e.target.checked)}
                className="rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span>Yalnızca Sevk Gören Cariler ({activeCustomerIds.size})</span>
            </label>
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

      {/* ── PRINT-ONLY OFFICIAL DOCUMENT HEADER ── */}
      <div className="print-only border-b-2 border-slate-800 pb-3 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">PARKE ERP • FABRİKA YÖNETİM SİSTEMİ</h1>
            <h2 className="text-sm font-bold text-emerald-800 uppercase mt-0.5">
              📋 GÜNLÜK MÜŞTERİ SEVKİYAT, ÜRETİM & STOK DENGE MATRİSİ
            </h2>
          </div>
          <div className="text-right text-[10px] text-slate-600 font-mono">
            <div><strong>Rapor Tarihi:</strong> {new Date().toLocaleString('tr-TR')}</div>
            <div>
              <strong>Rapor Dönemi:</strong> {dateMode === 'single' ? selectedDate : `${startDate} → ${endDate}`}
            </div>
            <div><strong>Ürün Kapsamı:</strong> {productTypeFilter === 'all' ? 'Tüm Ürünler' : productTypeFilter}</div>
          </div>
        </div>
      </div>

      {/* ── THE EXCEL-STYLE MATRIX TABLE (RESPONSIVE SCROLL WITH STICKY HEADERS) ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400 space-y-3">
            <RefreshCw size={32} className="mx-auto animate-spin text-emerald-600" />
            <p className="text-xs font-semibold">Matris verileri ve stoklar hesaplanıyor...</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[720px] relative">
            <table className="w-full text-xs text-left border-collapse select-text">
              {/* ── TABLE HEADER: PRODUCTS (COLUMNS) ── */}
              <thead className="sticky top-0 z-20 bg-slate-100 shadow-xs">
                <tr className="border-b border-slate-300 text-slate-700 font-bold">
                  {/* Sticky Column A: Customer Header */}
                  <th className="p-3 sticky left-0 z-30 bg-slate-200 min-w-[200px] border-r border-slate-300 shadow-xs">
                    <div className="flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-600" />
                      <span>Müşteri / Cari Ünvanı</span>
                    </div>
                  </th>

                  {/* Product Columns */}
                  {filteredProducts.map((prod) => (
                    <th
                      key={prod.id}
                      className="p-2.5 text-right min-w-[130px] border-r border-slate-200 bg-slate-100"
                      title={`${prod.name} (${prod.thickness || ''} ${prod.color || ''})`}
                    >
                      <div className="font-bold text-slate-900 text-[11px] leading-tight line-clamp-2">
                        {prod.name}
                      </div>
                      <div className="text-[10px] text-slate-500 font-normal flex items-center justify-end gap-1 mt-0.5">
                        <span>{prod.thickness ? `${prod.thickness}` : ''}</span>
                        {prod.color && <span>• {prod.color}</span>}
                        <span className="font-semibold text-slate-700">({prod.unit || 'm²'})</span>
                      </div>
                    </th>
                  ))}

                  {/* Far Right Column: Customer Total */}
                  <th className="p-3 text-right min-w-[120px] bg-blue-100 text-blue-950 font-black border-l border-blue-200">
                    Toplam Sevk
                  </th>
                </tr>
              </thead>

              {/* ── TABLE BODY: CUSTOMERS (ROWS) ── */}
              <tbody className="divide-y divide-slate-100">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={filteredProducts.length + 2}
                      className="py-12 text-center text-slate-400 bg-slate-50"
                    >
                      <Layers size={32} className="mx-auto text-slate-300 mb-2 opacity-60" />
                      Seçilen tarih ({dateMode === 'single' ? selectedDate : `${startDate} → ${endDate}`}) için sevkiyat hareketi bulunamadı.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((cust, idx) => {
                    const custTotal = customerTotals[cust.id] || 0;
                    return (
                      <tr
                        key={cust.id}
                        className={`transition-colors hover:bg-slate-50 ${
                          idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                        }`}
                      >
                        {/* Sticky Customer Name Cell */}
                        <td className="p-3 sticky left-0 z-10 bg-inherit border-r border-slate-200 font-bold text-slate-900 shadow-xs">
                          <div className="truncate max-w-[190px]" title={cust.name}>
                            {cust.name}
                          </div>
                          {cust.phone && (
                            <div className="text-[10px] text-slate-400 font-normal font-mono">
                              {cust.phone}
                            </div>
                          )}
                        </td>

                        {/* Product Cells ("NE KADAR GİTTİ") */}
                        {filteredProducts.map((prod) => {
                          const shipped = matrix[cust.id]?.[prod.id];
                          return (
                            <td
                              key={prod.id}
                              className={`p-2.5 text-right font-mono border-r border-slate-100 ${
                                shipped ? 'font-bold text-slate-900 bg-amber-50/30' : 'text-slate-300'
                              }`}
                            >
                              {shipped ? Number(shipped).toLocaleString('tr-TR') : '-'}
                            </td>
                          );
                        })}

                        {/* Customer Row Total */}
                        <td className="p-3 text-right font-mono font-black text-blue-900 bg-blue-50/60 border-l border-blue-200">
                          {custTotal ? Number(custTotal).toLocaleString('tr-TR') : '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* ── TABLE FOOTER: TOTALS, STOCK, DAILY PRODUCTION & BALANCE ── */}
              <tfoot className="border-t-2 border-slate-400 font-bold divide-y divide-slate-200 text-xs">
                {/* 1. TOPLAM GİDEN (SEVKİYAT) */}
                <tr className="bg-blue-100/90 text-blue-950 font-black">
                  <td className="p-3 sticky left-0 z-10 bg-blue-200/90 border-r border-blue-300 shadow-xs">
                    <div className="flex items-center gap-1.5">
                      <Package size={14} className="text-blue-800" />
                      <span>TOPLAM GİDEN (SEVKİYAT)</span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const pTotal = productTotals[prod.id] || 0;
                    return (
                      <td key={prod.id} className="p-2.5 text-right font-mono font-black border-r border-blue-200 text-blue-950 text-sm">
                        {pTotal ? Number(pTotal).toLocaleString('tr-TR') : '-'}
                      </td>
                    );
                  })}
                  <td className="p-3 text-right font-mono text-sm font-black text-blue-950 bg-blue-300/80 border-l border-blue-300">
                    {grandTotalShipped.toLocaleString('tr-TR')}
                  </td>
                </tr>

                {/* 2. GÜNCEL MEVCUT STOK */}
                <tr className="bg-emerald-50 text-emerald-950">
                  <td className="p-3 sticky left-0 z-10 bg-emerald-100/90 border-r border-emerald-200 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-900">MEVCUT FABRİKA STOĞU</span>
                      <span className="text-[9px] bg-emerald-200 text-emerald-900 px-1.5 py-0.5 rounded font-bold">
                        Stok
                      </span>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const stk = stockMap[prod.id] || 0;
                    return (
                      <td key={prod.id} className="p-2.5 text-right font-mono font-bold border-r border-emerald-100 text-emerald-900 text-xs">
                        {stk.toLocaleString('tr-TR')}
                      </td>
                    );
                  })}
                  <td className="p-3 text-right font-mono text-xs text-emerald-800 bg-emerald-100/70 border-l border-emerald-200">
                    -
                  </td>
                </tr>

                {/* 3. GÜNLÜK ÜRETİM MİKTARI (HÜCREDEN ELLE GİRİLEBİLECEK) */}
                <tr className="bg-amber-50 text-amber-950">
                  <td className="p-3 sticky left-0 z-10 bg-amber-100/90 border-r border-amber-200 shadow-xs">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-950">GÜNLÜK ÜRETİM MİKTARI</span>
                        <span className="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold">
                          Elle Giriş
                        </span>
                      </div>
                      <div className="no-print flex items-center gap-1 text-[10px] text-amber-800 font-normal">
                        <span>Hücreye yazıp</span>
                        <button
                          type="button"
                          onClick={handleSaveAllProductions}
                          disabled={savingProduction}
                          className="font-bold text-amber-900 underline hover:text-amber-700 cursor-pointer"
                        >
                          Tümünü Kaydet
                        </button>
                      </div>
                    </div>
                  </td>
                  {filteredProducts.map((prod) => {
                    const currentVal = editingProduction[prod.id] ?? '';
                    return (
                      <td key={prod.id} className="p-1.5 text-right border-r border-amber-100 bg-amber-50/70">
                        {/* Interactive Input for Screen */}
                        <div className="no-print flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            placeholder="0"
                            value={currentVal}
                            onChange={(e) =>
                              setEditingProduction((prev) => ({
                                ...prev,
                                [prod.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveProduction(prod.id);
                              }
                            }}
                            className="w-20 px-1.5 py-1 text-right font-mono font-bold text-xs bg-white border border-amber-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveProduction(prod.id)}
                            disabled={savingProduction}
                            className="p-1 bg-amber-500 hover:bg-amber-600 text-white rounded cursor-pointer transition-colors shadow-2xs"
                            title="Bu ürünün üretimini kaydet"
                          >
                            <Check size={12} />
                          </button>
                        </div>
                        {/* Clean Text for Print Output */}
                        <div className="print-only font-mono font-bold text-amber-950 text-right">
                          {currentVal ? Number(currentVal).toLocaleString('tr-TR') : '-'}
                        </div>
                      </td>
                    );
                  })}
                  <td className="p-3 text-right font-mono text-xs text-amber-900 bg-amber-100/70 border-l border-amber-200">
                    -
                  </td>
                </tr>

                {/* 4. GÜN SONU / NET KALAN DENGE */}
                <tr className="bg-purple-100/90 text-purple-950 font-black">
                  <td className="p-3 sticky left-0 z-10 bg-purple-200/90 border-r border-purple-300 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-purple-950">GÜN SONU KALAN / DENGE</span>
                      <span className="text-[9px] bg-purple-300 text-purple-950 px-1.5 py-0.5 rounded font-bold">
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
                        className={`p-2.5 text-right font-mono font-black border-r border-purple-200 text-xs ${
                          balance < 0 ? 'text-red-700 bg-red-100/60' : 'text-purple-950'
                        }`}
                      >
                        {balance.toLocaleString('tr-TR')}
                      </td>
                    );
                  })}
                  <td className="p-3 text-right font-mono text-xs text-purple-950 bg-purple-300/80 border-l border-purple-300">
                    -
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── PRINT-ONLY SIGNATURE FOOTER ── */}
      <div className="print-only mt-8 pt-4 border-t border-slate-300">
        <div className="grid grid-cols-3 gap-8 text-center text-xs">
          <div>
            <div className="font-bold text-slate-800">Raporu Hazırlayan</div>
            <div className="text-slate-500 text-[10px] mt-0.5">Saha / Sevkiyat Sorumlusu</div>
            <div className="mt-12 border-b border-dashed border-slate-400 mx-8"></div>
            <div className="text-[10px] text-slate-400 mt-1">İmza</div>
          </div>
          <div>
            <div className="font-bold text-slate-800">Kantar & Lojistik Şefi</div>
            <div className="text-slate-500 text-[10px] mt-0.5">Sevk & Tartım Kontrol</div>
            <div className="mt-12 border-b border-dashed border-slate-400 mx-8"></div>
            <div className="text-[10px] text-slate-400 mt-1">İmza</div>
          </div>
          <div>
            <div className="font-bold text-slate-800">Fabrika / İşletme Müdürü</div>
            <div className="text-slate-500 text-[10px] mt-0.5">Onay & Tasdik</div>
            <div className="mt-12 border-b border-dashed border-slate-400 mx-8"></div>
            <div className="text-[10px] text-slate-400 mt-1">İmza / Kaşe</div>
          </div>
        </div>
        <div className="text-center text-[9px] text-slate-400 mt-6">
          Bu resmi döküm Parke ERP Fabrika Otomasyon Sistemi tarafından üretilmiştir.
        </div>
      </div>
    </div>
  );
}
