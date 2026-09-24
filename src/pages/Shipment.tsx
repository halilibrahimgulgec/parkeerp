import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shipment, Customer, Site, Product } from '../types';
import Modal from '../components/Modal';
import { Plus, Truck, Search, Filter, AlertCircle, Trash2, Eye, Pencil, PackageX, Target, ShoppingBag, Lock, Camera, Image, Loader2, Sparkles, X, Check } from 'lucide-react';
import { scanWaybillImageForShipment, ParsedShipmentOCRData, smartMatchProduct } from '../utils/aiVisionOCREngine';

const getLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

export function getSupplierInfo(shipment: any): { 
  isExternal: boolean; 
  supplierName: string; 
  supplierInvoiceNo?: string; 
  unitPrice?: number;
} {
  if (!shipment) return { isExternal: false, supplierName: '' };

  // 1. Direct column on shipment
  if (shipment.supplier_name && shipment.supplier_name.trim()) {
    let invNo = shipment.supplier_invoice_no;
    if (!invNo && shipment.notes) {
      const invMatch = shipment.notes.match(/Alış İrsaliye:\s*([^)\—\-,]+)/i);
      if (invMatch && invMatch[1]) invNo = invMatch[1].trim();
    }
    return { 
      isExternal: true, 
      supplierName: shipment.supplier_name.trim(),
      supplierInvoiceNo: invNo,
    };
  }

  // 2. Linked external_purchases
  if (shipment.external_purchases) {
    const ep = Array.isArray(shipment.external_purchases) ? shipment.external_purchases[0] : shipment.external_purchases;
    if (ep?.supplier_name) {
      return {
        isExternal: true,
        supplierName: ep.supplier_name.trim(),
        supplierInvoiceNo: ep.supplier_invoice_no,
        unitPrice: ep.unit_price,
      };
    }
  }

  // 3. Extracted from notes
  if (shipment.notes) {
    const match = shipment.notes.match(/Tedarikçi:\s*([^)\—\-,]+)/i);
    const invMatch = shipment.notes.match(/Alış İrsaliye:\s*([^)\—\-,]+)/i);
    if (match && match[1]) {
      return { 
        isExternal: true, 
        supplierName: match[1].trim(),
        supplierInvoiceNo: invMatch && invMatch[1] ? invMatch[1].trim() : undefined,
      };
    }
    if (shipment.notes.toLowerCase().includes('transit sevk') || shipment.notes.toLowerCase().includes('dış alım')) {
      return { isExternal: true, supplierName: 'Dış Tedarikçi' };
    }
  }

  return { isExternal: false, supplierName: '' };
}

interface ShipmentFormData {
  invoice_no: string;
  customer_id: string;
  site_id: string;
  vehicle_plate: string;
  driver_name: string;
  driver_phone: string;
  gross_weight: number;
  tare_weight: number;
  sale_price_per_m2: number;
  logistics_cost: number;
  shipment_date: string;
  notes: string;
  is_external: boolean;
  supplier_name: string;
  items: { 
    product_id: string; 
    pallets: number; 
    pallet_type: 'tahta' | 'sevkiyat' | 'uretim' | 'dokme';
    m2: number; 
    unit: string;
  }[];
}

const getEmptyForm = (): ShipmentFormData => ({
  invoice_no: '',
  customer_id: '',
  site_id: '',
  vehicle_plate: '',
  driver_name: '',
  driver_phone: '',
  gross_weight: 0,
  tare_weight: 0,
  sale_price_per_m2: 0,
  logistics_cost: 0,
  shipment_date: getLocalDateString(),
  notes: '',
  is_external: false,
  supplier_name: '',
  items: [{ product_id: '', pallets: 0, pallet_type: 'sevkiyat', m2: 0, unit: 'm2' }],
});

function ShipmentForm({ customers, products, initial, prefilledData, onSave, onClose }: {
  customers: Customer[];
  products: Product[];
  initial?: Shipment;
  prefilledData?: Partial<ShipmentFormData>;
  onSave: () => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<ShipmentFormData>(() => {
    if (initial) {
      const sup = getSupplierInfo(initial);
      return {
        invoice_no: initial.invoice_no,
        customer_id: initial.customer_id,
        site_id: initial.site_id || '',
        vehicle_plate: initial.vehicle_plate,
        driver_name: initial.driver_name || '',
        driver_phone: initial.driver_phone || '',
        gross_weight: initial.gross_weight,
        tare_weight: initial.tare_weight,
        sale_price_per_m2: initial.sale_price_per_m2,
        logistics_cost: initial.logistics_cost,
        shipment_date: initial.shipment_date,
        notes: initial.notes || '',
        is_external: sup.isExternal,
        supplier_name: sup.supplierName,
        items: [],
      };
    }
    if (prefilledData) {
      return {
        ...getEmptyForm(),
        ...prefilledData,
      };
    }
    return getEmptyForm();
  });
  const [sites, setSites] = useState<Site[]>([]);
  const [customerQuotas, setCustomerQuotas] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  // OCR Scanning states
  const [isScanning, setIsScanning] = useState(false);
  const [scanStepMessage, setScanStepMessage] = useState('');
  const [scanNotice, setScanNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleScanImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setScanStepMessage('📷 [1/3] Görüntü netleştiriliyor ve kontrast ayarlanıyor...');
    setScanNotice(null);

    try {
      setScanStepMessage('🧠 [2/3] Gemini Vision AI ile irsaliye ve el yazıları okunuyor...');
      const res = await scanWaybillImageForShipment(file);

      if (!res.success) {
        if (res.needsApiKey) {
          setScanNotice({
            type: 'error',
            text: '⚠️ Google Gemini Vision API anahtarı ayarlanmamış. Lütfen Asistan Ayarları (⚙️) menüsünden anahtarınızı giriniz.',
          });
        } else {
          setScanNotice({
            type: 'error',
            text: res.message || 'İrsaliye okunamadı. Lütfen fotoğrafın netliğini kontrol edin.',
          });
        }
        setIsScanning(false);
        return;
      }

      setScanStepMessage('📋 [3/3] Veritabanı müşterisi ve ürünler eşleştiriliyor...');
      const ocr = res.data;
      if (!ocr) {
        setIsScanning(false);
        return;
      }

      // Populate Form
      setForm(prev => {
        const next = { ...prev };
        if (ocr.invoice_no) next.invoice_no = ocr.invoice_no;
        if (ocr.date) next.shipment_date = ocr.date;
        if (ocr.matched_customer_id) next.customer_id = ocr.matched_customer_id;
        if (ocr.matched_site_id) next.site_id = ocr.matched_site_id;
        if (ocr.vehicle_plate) next.vehicle_plate = ocr.vehicle_plate;
        if (ocr.driver_name) next.driver_name = ocr.driver_name;
        if (ocr.driver_phone) next.driver_phone = ocr.driver_phone;
        if (ocr.gross_weight) next.gross_weight = ocr.gross_weight;
        if (ocr.tare_weight) next.tare_weight = ocr.tare_weight;
        if (ocr.is_external) {
          next.is_external = true;
          if (ocr.supplier_name) next.supplier_name = ocr.supplier_name;
        }
        if (ocr.notes) {
          next.notes = ocr.notes;
        }

        // Populate items
        if (ocr.items && ocr.items.length > 0) {
          next.items = ocr.items.map(it => {
            let prodId = it.product_id;
            if (!prodId) {
              const matched = smartMatchProduct(it.product_name, products) || products.find(p => p.name.toLowerCase().includes(it.product_name.toLowerCase()));
              prodId = matched?.id || products[0]?.id || '';
            }
            return {
              product_id: prodId,
              pallets: it.pallets,
              pallet_type: it.pallet_type || 'tahta',
              m2: it.m2,
              unit: it.unit || 'm2',
            };
          });
        }

        return next;
      });

      setScanNotice({
        type: 'success',
        text: `✅ İrsaliye (#${ocr.invoice_no || '-'} / ${ocr.customer_name || 'Müşteri'}) başarıyla okundu ve form dolduruldu!`,
      });
    } catch (err: any) {
      console.error('OCR Error:', err);
      setScanNotice({
        type: 'error',
        text: `Okuma hatası: ${err?.message || 'Bilinmeyen hata'}`,
      });
    } finally {
      setIsScanning(false);
      e.target.value = '';
    }
  };

  useEffect(() => {
    if (form.customer_id) {
      supabase.from('sites').select('*').eq('customer_id', form.customer_id).eq('is_active', true)
        .then(({ data }) => setSites(data || []));

      // Fetch customer quotas and shipment history for this customer
      supabase.from('customer_quotas')
        .select('*, products(*), sites(*)')
        .eq('customer_id', form.customer_id)
        .eq('is_active', true)
        .then(async ({ data: qData }) => {
          if (!qData || qData.length === 0) {
            setCustomerQuotas([]);
            return;
          }

          const { data: shipData } = await supabase
            .from('shipment_items')
            .select('product_id, m2, unit, shipments!inner(id, shipment_date, customer_id, site_id, status)')
            .eq('shipments.customer_id', form.customer_id)
            .eq('shipments.status', 'completed');

          const calculated = qData.map(quota => {
            const matching = (shipData || []).filter(item => {
              const s: any = Array.isArray(item.shipments) ? item.shipments[0] : item.shipments;
              if (!s) return false;
              if (initial && s.id === initial.id) return false;
              if (quota.site_id && s.site_id !== quota.site_id) return false;
              if (quota.product_id && item.product_id !== quota.product_id) return false;
              if (quota.start_date && s.shipment_date < quota.start_date) return false;
              if (quota.end_date && s.shipment_date > quota.end_date) return false;
              const itemUnit = item.unit || 'm2';
              if (!quota.product_id && itemUnit !== quota.unit) return false;
              return true;
            });
            const shipped = matching.reduce((acc, cur) => acc + (Number(cur.m2) || 0), 0);
            const remaining = Number(quota.target_quantity) - shipped;
            const pct = Math.round((shipped / Number(quota.target_quantity)) * 100);
            return {
              ...quota,
              shipped,
              remaining,
              pct,
            };
          });
          setCustomerQuotas(calculated);
        });
    } else {
      setSites([]);
      setCustomerQuotas([]);
    }
  }, [form.customer_id, initial]);

  useEffect(() => {
    const fetchStock = async () => {
      const [stockRes, initialItemsRes] = await Promise.all([
        supabase.from('v_product_stock').select('*'),
        initial ? supabase.from('shipment_items').select('product_id, m2, pallets, unit, pallet_type').eq('shipment_id', initial.id) : Promise.resolve({ data: [] }),
      ]);
      const map: Record<string, number> = {};
      for (const p of products) {
        const stockRow = (stockRes.data || []).find((x: any) => x.product_id === p.id);
        map[p.id] = stockRow ? stockRow.current_stock : 0;
      }
      if (initialItemsRes.data) {
        for (const row of initialItemsRes.data) {
          map[row.product_id] = (map[row.product_id] || 0) + (row.m2 || 0);
        }
        if (initial) {
          setForm(f => ({
            ...f,
            items: initialItemsRes.data.map((x: any) => ({
              product_id: x.product_id,
              pallets: Number(x.pallets) || 0,
              pallet_type: (x.pallet_type || 'sevkiyat') as any,
              m2: Number(x.m2) || 0,
              unit: x.unit || 'm2',
            }))
          }));
        }
      }
      setStockMap(map);
    };
    fetchStock();
  }, [products, initial]);

  const setItem = (idx: number, field: string, value: any) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === 'pallet_type' && value === 'dokme') {
        items[idx].pallets = 0;
      }
      if (field === 'pallets' || field === 'product_id') {
        const p = products.find(x => x.id === (field === 'product_id' ? value : items[idx].product_id));
        if (p) {
          items[idx].m2 = items[idx].pallets * p.m2_per_pallet;
          if (field === 'product_id' && p.unit) {
            items[idx].unit = p.unit;
          }
        }
      }
      return { ...f, items };
    });
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { product_id: '', pallets: 0, pallet_type: f.items[f.items.length - 1]?.pallet_type || 'sevkiyat', m2: 0, unit: 'm2' }] }));
  const removeItem = (idx: number) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const totalM2 = form.items.reduce((s, i) => s + i.m2, 0);
  const netWeight = Math.max(form.gross_weight - form.tare_weight, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id) { setError('Müşteri seçiniz.'); return; }
    if (!initial && form.items.some(i => !i.product_id)) { setError('Tüm kalemlerde ürün seçiniz.'); return; }

    if (!initial) {
      for (const item of form.items) {
        if (!item.product_id) continue;
        const available = stockMap[item.product_id] ?? 0;
        if (item.m2 > available) {
          const p = products.find(x => x.id === item.product_id);
          setError(`"${p?.name ?? 'Ürün'}" için yeterli stok yok. Mevcut: ${available.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m², İstenen: ${item.m2} m²`);
          return;
        }
      }
    }

    // Quota warning and confirmation check
    if (customerQuotas.length > 0) {
      for (const q of customerQuotas) {
        const formItemsMatching = form.items.filter(item => {
          if (q.product_id && item.product_id !== q.product_id) return false;
          if (form.site_id && q.site_id && form.site_id !== q.site_id) return false;
          const itemUnit = item.unit || 'm2';
          if (itemUnit !== q.unit) return false;
          return true;
        });
        const formQty = formItemsMatching.reduce((acc, i) => acc + (Number(i.m2) || 0), 0);
        if (formQty > 0 && formQty > q.remaining) {
          const exceededBy = Math.round(formQty - q.remaining);
          const custName = customers.find(c => c.id === form.customer_id)?.name || 'Müşteri';
          const confirmMsg = `⚠️ MÜŞTERİ KOTASI UYARISI:\n\n"${custName}" için tanımlanan ${Number(q.target_quantity).toLocaleString('tr-TR')} ${q.unit} taahhüt kotası bu sevkiyat ile ${exceededBy.toLocaleString('tr-TR')} ${q.unit} aşılacaktır!\n\nMevcut Kalan Kota: ${Number(q.remaining).toLocaleString('tr-TR')} ${q.unit}\nBu Sevkiyat: ${formQty.toLocaleString('tr-TR')} ${q.unit}\n\nSevkiyat işlemine devam etmek istiyor musunuz?`;
          if (!window.confirm(confirmMsg)) {
            return;
          }
        }
      }
    }

    setSaving(true); setError('');

    const shipPayload = {
      invoice_no: form.invoice_no,
      customer_id: form.customer_id,
      site_id: form.site_id || null,
      vehicle_plate: form.vehicle_plate,
      driver_name: form.driver_name,
      driver_phone: form.driver_phone,
      gross_weight: form.gross_weight,
      tare_weight: form.tare_weight,
      sale_price_per_m2: form.sale_price_per_m2,
      logistics_cost: form.logistics_cost,
      total_m2: totalM2,
      shipment_date: form.shipment_date,
      supplier_name: form.is_external ? (form.supplier_name.trim() || 'Dış Tedarikçi') : null,
      notes: form.is_external && form.supplier_name.trim() && !form.notes.includes('Tedarikçi:')
        ? `Doğrudan Transit Sevk (Tedarikçi: ${form.supplier_name.trim()}) ${form.notes ? '— ' + form.notes : ''}`
        : form.notes,
    };

    if (initial) {
      const { error: shipErr } = await supabase.from('shipments').update(shipPayload).eq('id', initial.id);
      if (shipErr) { setError(shipErr.message); setSaving(false); return; }

      // Update shipment items (Delete and re-insert)
      await supabase.from('shipment_items').delete().eq('shipment_id', initial.id);
      const itemsToInsert = form.items.filter(i => i.product_id).map(i => ({
        shipment_id: initial.id,
        product_id: i.product_id,
        pallets: i.pallets,
        pallet_type: i.pallet_type,
        m2: i.m2,
        unit: i.unit,
      }));
      const { error: itemsErr } = await supabase.from('shipment_items').insert(itemsToInsert);
      if (itemsErr) { setError(itemsErr.message); setSaving(false); return; }

      // Update pallet transactions (Delete and re-insert)
      await supabase.from('pallet_transactions').delete().eq('shipment_id', initial.id);
      
      const palletGroups: Record<string, number> = {};
      form.items.forEach(i => {
        if (!i.product_id || (Number(i.pallets) || 0) <= 0 || i.pallet_type === 'dokme') return;
        palletGroups[i.pallet_type] = (palletGroups[i.pallet_type] || 0) + Number(i.pallets);
      });

      const palletTransactions = Object.entries(palletGroups).map(([type, qty]) => ({
        date: form.shipment_date,
        customer_id: form.customer_id,
        site_id: form.site_id || null,
        shipment_id: initial.id,
        transaction_type: 'sent',
        pallet_type: type,
        quantity: qty,
        notes: `${form.invoice_no} no'lu sevkiyat ile gönderildi.`,
        created_by: user?.id,
      }));

      if (palletTransactions.length > 0) {
        const { error: transErr } = await supabase.from('pallet_transactions').insert(palletTransactions);
        if (transErr) { setError(transErr.message); setSaving(false); return; }
      }
    } else {
      const { data: shipData, error: shipErr } = await supabase.from('shipments').insert({
        ...shipPayload, status: 'completed', created_by: user?.id,
      }).select().single();
      if (shipErr) { setError(shipErr.message); setSaving(false); return; }

      const itemsToInsert = form.items.filter(i => i.product_id).map(i => ({
        shipment_id: shipData.id,
        product_id: i.product_id,
        pallets: i.pallets,
        pallet_type: i.pallet_type,
        m2: i.m2,
        unit: i.unit,
      }));
      const { error: itemsErr } = await supabase.from('shipment_items').insert(itemsToInsert);
      if (itemsErr) {
        // CLEANUP: Delete the created shipment row if items insertion fails
        await supabase.from('shipments').delete().eq('id', shipData.id);
        setError(itemsErr.message);
        setSaving(false);
        return;
      }

      // Insert pallet transactions
      const palletGroups: Record<string, number> = {};
      form.items.forEach(i => {
        if (!i.product_id || (Number(i.pallets) || 0) <= 0 || i.pallet_type === 'dokme') return;
        palletGroups[i.pallet_type] = (palletGroups[i.pallet_type] || 0) + Number(i.pallets);
      });

      const palletTransactions = Object.entries(palletGroups).map(([type, qty]) => ({
        date: form.shipment_date,
        customer_id: form.customer_id,
        site_id: form.site_id || null,
        shipment_id: shipData.id,
        transaction_type: 'sent',
        pallet_type: type,
        quantity: qty,
        notes: `${form.invoice_no} no'lu sevkiyat ile gönderildi.`,
        created_by: user?.id,
      }));

      if (palletTransactions.length > 0) {
        const { error: transErr } = await supabase.from('pallet_transactions').insert(palletTransactions);
        if (transErr) {
          setError(transErr.message);
          setSaving(false);
          return;
        }
      }
    }

    setSaving(false);
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── OPTICAL OCR SCANNER BANNER ── */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-3.5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Camera size={20} />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                <span>Fotoğraftan / Fişten Otomatik Doldur</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">Vision AI</span>
              </div>
              <p className="text-slate-500 text-[11px] leading-tight">İrsaliye veya kantar fişinin fotoğrafını yükleyin; müşteri, şantiye, plaka ve ürünler anında dolsun.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              id="shipment-camera-input"
              className="hidden"
              onChange={handleScanImageFile}
            />
            <input
              type="file"
              accept="image/*"
              id="shipment-gallery-input"
              className="hidden"
              onChange={handleScanImageFile}
            />
            <button
              type="button"
              onClick={() => document.getElementById('shipment-camera-input')?.click()}
              disabled={isScanning}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
            >
              <Camera size={14} />
              <span>Fotoğraf Çek</span>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('shipment-gallery-input')?.click()}
              disabled={isScanning}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
            >
              <Image size={14} />
              <span>Galeriden Seç</span>
            </button>
          </div>
        </div>

        {/* Live Scanning Progress HUD */}
        {isScanning && (
          <div className="mt-3 pt-3 border-t border-blue-200/60 flex items-center gap-2 text-xs font-semibold text-blue-900 animate-pulse">
            <Loader2 size={16} className="animate-spin text-blue-600" />
            <span>{scanStepMessage || 'İrsaliye analiz ediliyor (Gemini Vision AI)...'}</span>
          </div>
        )}

        {/* OCR Result Success / Info Notice */}
        {scanNotice && (
          <div className={`mt-3 pt-2 border-t text-xs font-medium flex items-center justify-between gap-2 ${
            scanNotice.type === 'success' ? 'text-emerald-800 border-emerald-200' : 'text-amber-800 border-amber-200'
          }`}>
            <span>{scanNotice.text}</span>
            <button type="button" onClick={() => setScanNotice(null)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">İrsaliye No *</label>
          <input type="text" value={form.invoice_no} onChange={e => setForm(f => ({ ...f, invoice_no: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="İRS-2024-001" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tarih *</label>
          <input type="date" value={form.shipment_date} onChange={e => setForm(f => ({ ...f, shipment_date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Müşteri *</label>
          <select value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, site_id: '' }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" required>
            <option value="">Müşteri seçin...</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Şantiye</label>
          <select value={form.site_id} onChange={e => setForm(f => ({ ...f, site_id: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" disabled={sites.length === 0}>
            <option value="">Şantiye seçin...</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Malzeme Kaynağı: Fabrika Üretimi mi, Dış Tedarikçi Transit Sevk mi? */}
      <div className={`p-3.5 rounded-xl border transition-all ${form.is_external ? 'bg-amber-50/70 border-amber-300' : 'bg-slate-50/70 border-slate-200'}`}>
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setForm(f => ({ ...f, is_external: !f.is_external }))}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_external_shipment"
              checked={form.is_external}
              onChange={e => setForm(f => ({ ...f, is_external: e.target.checked }))}
              className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 cursor-pointer"
            />
            <div>
              <label htmlFor="is_external_shipment" className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5">
                <ShoppingBag size={14} className="text-amber-600" />
                Dış Tedarikçiden Transit Sevk (Dış Fabrikadan Alım)
              </label>
              <p className="text-[11px] text-slate-500">
                Bu malzeme fabrikamızda üretilmediyse, dış fabrikadan direkt müşteriye sevk edildiyse işaretleyin.
              </p>
            </div>
          </div>
          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${form.is_external ? 'bg-amber-200 text-amber-900 border-amber-300' : 'bg-slate-200 text-slate-600 border-slate-300'}`}>
            {form.is_external ? 'Dış Alım / Transit' : 'Fabrika Üretimi'}
          </span>
        </div>

        {form.is_external && (
          <div className="mt-3 pt-3 border-t border-amber-200/80">
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tedarikçi (Dış Fabrika) Adı *</label>
            <input
              type="text"
              required={form.is_external}
              placeholder="Örn: Doğan Parke Fabrikası"
              value={form.supplier_name}
              onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
          </div>
        )}
      </div>

      {/* Müşteri Kota Durumu Bilgi Kartı */}
      {customerQuotas.length > 0 && (
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-amber-900">
            <span className="flex items-center gap-1.5">
              <Target size={15} className="text-amber-600" />
              Müşteri Malzeme Kotası / Taahhüt Durumu
            </span>
            <span className="text-[10px] bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full font-semibold">
              {customerQuotas.length} Aktif Kota
            </span>
          </div>

          <div className="space-y-1.5">
            {customerQuotas.map(q => {
              const isExceeded = q.pct >= 100;
              const isApproaching = q.pct >= (q.alert_threshold_pct || 85) && !isExceeded;

              return (
                <div key={q.id} className="bg-white/90 rounded-lg p-2.5 border border-amber-100/80 shadow-xs space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">
                      {q.products?.name ? `${q.products.name} (${q.products.thickness})` : 'Tüm Ürünler (Genel)'}
                      {q.sites?.name && <span className="text-slate-500 font-normal ml-1">• {q.sites.name}</span>}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold text-[11px] px-2 py-0.5 rounded-full ${
                        isExceeded
                          ? 'bg-red-100 text-red-800 font-black'
                          : isApproaching
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        %{q.pct} {isExceeded ? 'Doldu / Aşıldı' : isApproaching ? 'Yaklaştı' : 'Normal'}
                      </span>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const pName = q.products?.name ? `${q.products.name} (${q.products.thickness || ''})` : 'bu kotayı';
                          if (window.confirm(`"${pName}" (${Number(q.target_quantity).toLocaleString('tr-TR')} ${q.unit}) kotasını/bağlantısını TAMAMLANDI olarak kapatmak istiyor musunuz?\n\nKapatıldığında bu kantar ekranından kaldırılacak ve yeni sevkiyatlar sadece yeni açılan aktif kotaya sayılacaktır.`)) {
                            try {
                              const todayStr = getLocalDateString();
                              const { error } = await supabase.from('customer_quotas').update({
                                is_active: false,
                                end_date: q.end_date || todayStr,
                                updated_at: new Date().toISOString()
                              }).eq('id', q.id);
                              if (error) throw error;
                              setCustomerQuotas(prev => prev.filter(item => item.id !== q.id));
                            } catch (err: any) {
                              alert('Kota kapatılırken hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
                            }
                          }
                        }}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded text-[10px] font-semibold border border-slate-200 transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                        title="Bu bağlantıyı tamamlandı olarak kapat ve ekrandan kaldır"
                      >
                        <Lock size={10} className="text-slate-500" />
                        Kotayı Kapat
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>Sevk Edilen: <strong>{q.shipped.toLocaleString('tr-TR')} {q.unit}</strong> / {q.target_quantity.toLocaleString('tr-TR')} {q.unit}</span>
                    <span className={q.remaining < 0 ? 'text-red-600 font-bold' : 'text-slate-700 font-medium'}>
                      {q.remaining >= 0 ? `Kalan: ${q.remaining.toLocaleString('tr-TR')} ${q.unit}` : `+${Math.abs(q.remaining).toLocaleString('tr-TR')} ${q.unit} Kota Aşıldı`}
                    </span>
                  </div>

                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isExceeded ? 'bg-red-500' : isApproaching ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(q.pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Araç Plaka *</label>
          <input type="text" value={form.vehicle_plate} onChange={e => setForm(f => ({ ...f, vehicle_plate: e.target.value.toUpperCase() }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase"
            placeholder="34 ABC 123" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Şoför Adı</label>
          <input type="text" value={form.driver_name} onChange={e => setForm(f => ({ ...f, driver_name: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Ad Soyad" />
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Kantar Bilgileri</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Brüt Ağırlık (kg)', key: 'gross_weight' },
            { label: 'Dara (kg)', key: 'tare_weight' },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input type="number" min="0" step="0.01"
                value={form[key as keyof ShipmentFormData] as number}
                onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm" />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Net Ağırlık (kg)</label>
            <div className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-sm font-semibold text-slate-700">
              {netWeight.toLocaleString('tr-TR')}
            </div>
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Yüklenen Ürünler</h3>
          <button type="button" onClick={addItem}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <Plus size={14} /> Kalem Ekle
          </button>
        </div>
        <div className="space-y-3">
          {form.items.map((item, idx) => {
            const stock = item.product_id ? (stockMap[item.product_id] ?? 0) : null;
            const unitLabel = item.unit === 'm2' ? 'm²' : item.unit === 'adet' ? 'Adet' : item.unit === 'metre' ? 'Metre' : item.unit;
            const stockExceeded = stock !== null && item.m2 > 0 && item.unit === 'm2' && item.m2 > stock;
            return (
            <div key={idx} className="space-y-1">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Ürün</label>}
                <select value={item.product_id} onChange={e => setItem(idx, 'product_id', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">Seçin...</option>
                  {products.map(p => {
                    const s = stockMap[p.id] ?? 0;
                    return <option key={p.id} value={p.id}>{p.name} ({p.thickness}/{p.color}){s <= 0 ? ' — Stok yok' : ` — ${s.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`}</option>;
                  })}
                </select>
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Palet</label>}
                <input type="number" min="0" value={item.pallets}
                  onChange={e => setItem(idx, 'pallets', Number(e.target.value))}
                  disabled={item.pallet_type === 'dokme'}
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-slate-100 disabled:text-slate-400" />
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Palet Tipi</label>}
                <select value={item.pallet_type} onChange={e => setItem(idx, 'pallet_type', e.target.value as any)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="sevkiyat">Sevkiyat Paleti</option>
                  <option value="tahta">Tahta Palet</option>
                  <option value="uretim">Üretim Paleti</option>
                  <option value="dokme">Dökme (Paletsiz)</option>
                </select>
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Birim</label>}
                <select value={item.unit} onChange={e => setItem(idx, 'unit', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="m2">m²</option>
                  <option value="adet">Adet</option>
                  <option value="metre">Metre</option>
                </select>
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Miktar ({unitLabel})</label>}
                <input type="number" min="0" step="0.01" value={item.m2}
                  onChange={e => setItem(idx, 'm2', Number(e.target.value))}
                  className={`w-full border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 ${stockExceeded ? 'border-red-400 focus:ring-red-400 bg-red-50' : 'border-slate-200 focus:ring-blue-400'}`} />
              </div>
              <div className="col-span-1 flex justify-center">
                {form.items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            {stock !== null && item.product_id && (
              <div className={`flex items-center gap-1.5 text-xs px-1 ${stockExceeded ? 'text-red-600' : 'text-slate-400'}`}>
                {stockExceeded ? <PackageX size={12} /> : null}
                {stockExceeded
                  ? `Stok aşıldı! Mevcut: ${stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`
                  : `Mevcut stok: ${stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`}
              </div>
            )}
            </div>
          ); })}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
          <div className="text-sm font-semibold text-blue-700">
            Toplam: {totalM2.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} (karma birim)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Satış Fiyatı (₺/m²)</label>
          <input type="number" min="0" step="0.01" value={form.sale_price_per_m2}
            onChange={e => setForm(f => ({ ...f, sale_price_per_m2: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Lojistik Gideri (₺)</label>
          <input type="number" min="0" step="0.01" value={form.logistics_cost}
            onChange={e => setForm(f => ({ ...f, logistics_cost: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notlar</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          rows={2} />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm">
          İptal
        </button>
        <button type="submit" disabled={saving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-60 flex items-center gap-2">
          {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {initial ? 'Güncelle' : 'Sevkiyatı Kaydet'}
        </button>
      </div>
    </form>
  );
}

const PALLET_LABELS: Record<string, string> = {
  sevkiyat: 'Sevkiyat Paleti',
  tahta: 'Tahta Palet',
  uretim: 'Üretim Paleti',
  dokme: 'Dökme (Paletsiz)',
};

export function getShipmentDisplayQuantity(s: any) {
  const items = s.shipment_items || [];
  if (items.length === 0) {
    const rawVal = Number(s.total_m2 || 0);
    return {
      badges: [{
        text: `${rawVal.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`,
        unit: 'm²',
        color: 'text-blue-700 bg-blue-50 border-blue-200',
      }],
      displayText: `${rawVal.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`,
      m2: rawVal,
      metre: 0,
      adet: 0,
      priceUnit: 'm²',
    };
  }

  let m2Total = 0;
  let metreTotal = 0;
  let adetTotal = 0;

  items.forEach((it: any) => {
    const prodUnit = it.products?.unit;
    const effectiveUnit = (prodUnit === 'metre' || it.unit === 'metre')
      ? 'metre'
      : (prodUnit === 'adet' || it.unit === 'adet')
      ? 'adet'
      : 'm2';

    const qty = Number(it.m2) || 0;
    if (effectiveUnit === 'metre') metreTotal += qty;
    else if (effectiveUnit === 'adet') adetTotal += qty;
    else m2Total += qty;
  });

  const badges: { text: string; unit: string; color: string }[] = [];
  if (m2Total > 0) {
    badges.push({
      text: `${m2Total.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`,
      unit: 'm²',
      color: 'text-blue-700 bg-blue-50 border-blue-200'
    });
  }
  if (metreTotal > 0) {
    badges.push({
      text: `${metreTotal.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre`,
      unit: 'metre',
      color: 'text-amber-800 bg-amber-50 border-amber-200'
    });
  }
  if (adetTotal > 0) {
    badges.push({
      text: `${adetTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} Adet`,
      unit: 'adet',
      color: 'text-purple-700 bg-purple-50 border-purple-200'
    });
  }

  const primaryUnit = metreTotal > 0 && m2Total === 0 ? 'm' : adetTotal > 0 && m2Total === 0 ? 'adet' : 'm²';

  return {
    badges,
    displayText: badges.map(b => b.text).join(' + ') || '0 m²',
    m2: m2Total,
    metre: metreTotal,
    adet: adetTotal,
    priceUnit: primaryUnit,
  };
}

function ShipmentDetail({ shipment, onClose }: { shipment: Shipment; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('shipment_items').select('*, products(*)').eq('shipment_id', shipment.id)
      .then(({ data }) => setItems(data || []));
  }, [shipment.id]);

  const qInfo = getShipmentDisplayQuantity({ ...shipment, shipment_items: items });
  const totalRevenue = shipment.sale_price_per_m2 * (shipment.total_m2 || 0);
  const supInfo = getSupplierInfo(shipment);

  return (
    <div className="space-y-4">
      {/* Dış Tedarikçi / Transit Sevk Bilgilendirme Kartı */}
      {supInfo.isExternal ? (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
            <ShoppingBag size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-900 border border-amber-300 uppercase tracking-wider">
                Doğrudan Transit Sevk (Dış Alım)
              </span>
            </div>
            <div className="text-sm font-bold text-slate-900 mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 font-medium">Tedarikçi (Dış Fabrika):</span>
              <span className="text-amber-950 font-black text-base">{supInfo.supplierName}</span>
            </div>
            {supInfo.supplierInvoiceNo && (
              <div className="text-xs text-slate-600 mt-0.5">
                Alış İrsaliye No: <span className="font-mono font-semibold text-slate-900">{supInfo.supplierInvoiceNo}</span>
              </div>
            )}
            <p className="text-[11px] text-amber-800/90 mt-1">
              Bu malzeme fabrikamızda üretilmemiş olup, dış tedarikçiden satın alınarak doğrudan müşteriye sevk edilmiştir.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium">Malzeme Kaynağı:</span>
          <span className="font-bold text-slate-700 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
            🏭 Fabrika Kendi Üretimi
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50/60 p-4 rounded-xl border border-slate-100">
        <div><span className="text-slate-500">İrsaliye No:</span> <span className="font-bold text-slate-900">{shipment.invoice_no}</span></div>
        <div><span className="text-slate-500">Tarih:</span> <span className="font-medium">{new Date(shipment.shipment_date).toLocaleDateString('tr-TR')}</span></div>
        <div><span className="text-slate-500">Müşteri:</span> <span className="font-bold text-slate-900">{shipment.customers?.name}</span></div>
        <div><span className="text-slate-500">Şantiye:</span> <span className="font-medium">{shipment.sites?.name || '-'}</span></div>
        <div><span className="text-slate-500">Araç:</span> <span className="font-mono font-semibold text-slate-800">{shipment.vehicle_plate}</span></div>
        <div><span className="text-slate-500">Şoför:</span> <span className="font-medium">{shipment.driver_name || '-'}</span></div>
        <div><span className="text-slate-500">Brüt / Dara / Net:</span> <span className="font-medium">{shipment.gross_weight} / {shipment.tare_weight} / {shipment.net_weight} kg</span></div>
        <div><span className="text-slate-500">Toplam Miktar:</span> <span className="font-bold text-blue-700">{qInfo.displayText}</span></div>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Ürün</th>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Palet Tipi</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Palet Sayısı</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Miktar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(item => {
              const prodUnit = item.products?.unit;
              const effectiveUnit = (prodUnit === 'metre' || item.unit === 'metre')
                ? 'Metre'
                : (prodUnit === 'adet' || item.unit === 'adet')
                ? 'Adet'
                : 'm²';

              return (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-medium text-slate-800">{item.products?.name} ({item.products?.thickness}/{item.products?.color})</td>
                  <td className="px-4 py-2 text-slate-600 text-xs">{PALLET_LABELS[item.pallet_type] || 'Sevkiyat Paleti'}</td>
                  <td className="px-4 py-2 text-right">{item.pallet_type === 'dokme' ? '-' : `${item.pallets} adet`}</td>
                  <td className="px-4 py-2 text-right font-bold text-slate-900">
                    {item.m2} {effectiveUnit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-blue-50 rounded-xl p-4 text-sm grid grid-cols-3 gap-4">
        <div><p className="text-slate-500">Satış Fiyatı</p><p className="font-bold text-slate-900">₺{shipment.sale_price_per_m2} / {qInfo.priceUnit}</p></div>
        <div><p className="text-slate-500">Lojistik</p><p className="font-bold text-slate-900">₺{shipment.logistics_cost}</p></div>
        <div><p className="text-slate-500">Tahmini Ciro</p><p className="font-bold text-blue-700">₺{totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</p></div>
      </div>

      {/* Not / Açıklama */}
      {shipment.notes && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1">
          <span className="font-bold text-slate-900 block">Sevkiyat Notu / Açıklama:</span>
          <p className="whitespace-pre-wrap font-medium text-slate-800">{shipment.notes}</p>
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onClose} className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold transition-colors">
          Kapat
        </button>
      </div>
    </div>
  );
}

export default function ShipmentPage() {
  const { isAdmin } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [detailShipment, setDetailShipment] = useState<Shipment | undefined>();
  const [editShipment, setEditShipment] = useState<Shipment | undefined>();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');

  const load = async () => {
    setLoading(true);
    let shipList: Shipment[] = [];
    try {
      const [custRes, prodRes, shipRes] = await Promise.all([
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('shipments').select('*, customers(*), sites(*), shipment_items(*, products(*)), external_purchases(*)').order('shipment_date', { ascending: false }).order('created_at', { ascending: false }),
      ]);
      setCustomers(custRes.data || []);
      setProducts(prodRes.data || []);
      if (shipRes.error) {
        // Fallback without external_purchases if relation is not in PostgREST cache
        const fallbackRes = await supabase.from('shipments').select('*, customers(*), sites(*), shipment_items(*, products(*))').order('shipment_date', { ascending: false }).order('created_at', { ascending: false });
        shipList = (fallbackRes.data || []) as Shipment[];
      } else {
        shipList = (shipRes.data || []) as Shipment[];
      }
    } catch (err) {
      console.error('Sevkiyat verisi yüklenirken hata:', err);
    }
    setShipments(shipList);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (s: Shipment) => {
    if (!confirm(`"${s.invoice_no}" numaralı sevkiyatı silmek istediğinize emin misiniz?\nBu işlem geri alınamaz.`)) return;
    setDeleting(s.id);
    await supabase.from('shipment_items').delete().eq('shipment_id', s.id);
    await supabase.from('shipments').delete().eq('id', s.id);
    setDeleting(null);
    load();
  };

  const filtered = shipments.filter(s => {
    const q = search.toLowerCase();
    const sup = getSupplierInfo(s);
    const match = !search || 
      s.invoice_no.toLowerCase().includes(q) || 
      s.customers?.name.toLowerCase().includes(q) || 
      s.vehicle_plate.toLowerCase().includes(q) ||
      (sup.isExternal && sup.supplierName.toLowerCase().includes(q)) ||
      (s.notes && s.notes.toLowerCase().includes(q));
    const dateMatch = !filterDate || s.shipment_date === filterDate;
    return match && dateMatch;
  });

  let totalTonnage = 0;
  let totalM2 = 0;
  let totalMetre = 0;
  let totalAdet = 0;

  filtered.forEach(s => {
    totalTonnage += Number(s.net_weight) || 0;
    const qInfo = getShipmentDisplayQuantity(s);
    totalM2 += qInfo.m2;
    totalMetre += qInfo.metre;
    totalAdet += qInfo.adet;
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Truck size={24} className="text-blue-600" /> Sevkiyat / Kantar
          </h1>
          <p className="text-slate-500 text-sm mt-1">İrsaliye ve kantar kayıt modülü</p>
        </div>
        <button
          onClick={() => { setEditShipment(undefined); setShowModal(true); }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm"
        >
          <Plus size={18} /> Yeni Sevkiyat
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-blue-600">
            {(totalTonnage / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} Ton
          </p>
          <p className="text-xs text-slate-500 mt-1">Toplam Net Ağırlık</p>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-slate-800">
            {totalM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
          </p>
          <p className="text-xs text-slate-500 mt-1">Toplam Sevk (m² Parke)</p>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-amber-700">
            {totalMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m
          </p>
          <p className="text-xs text-slate-500 mt-1">Toplam Sevk (Metre Bordür)</p>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-slate-700">
            {filtered.length} Sefer
          </p>
          <p className="text-xs text-slate-500 mt-1">Sevkiyat Sayısı</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="İrsaliye no, müşteri, plaka, dış tedarikçi ara..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <Filter size={16} className="text-slate-400" />
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          {filterDate && <button onClick={() => setFilterDate('')} className="text-xs text-slate-500 hover:text-red-500">Temizle</button>}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                  {['İrsaliye', 'Tarih', 'Müşteri / Şantiye', 'Plaka', 'Net Ağırlık', 'Sevk Miktarı', 'Satış Fiyatı', 'Durum', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-slate-400">Kayıt bulunamadı.</td></tr>
                ) : filtered.map(s => {
                  const qInfo = getShipmentDisplayQuantity(s);
                  const sup = getSupplierInfo(s);
                  return (
                    <tr key={s.id} className={`transition-colors ${sup.isExternal ? 'bg-amber-50/20 hover:bg-amber-50/40' : 'hover:bg-blue-50/20'}`}>
                      <td className="px-4 py-3 font-mono text-slate-700">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold">{s.invoice_no}</span>
                          {sup.isExternal && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs" title={`Doğrudan Transit Sevk (Tedarikçi: ${sup.supplierName})`}>
                              <ShoppingBag size={10} className="text-amber-700" /> Transit
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{new Date(s.shipment_date).toLocaleDateString('tr-TR')}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{s.customers?.name}</div>
                        {s.sites?.name && <div className="text-xs text-slate-400">{s.sites.name}</div>}
                        {sup.isExternal && (
                          <div className="text-[11px] font-semibold text-amber-800 mt-0.5 flex items-center gap-1">
                            <span className="text-slate-400 font-normal">Tedarikçi:</span>
                            <span className="text-amber-950 font-bold bg-amber-100/60 px-1 rounded">{sup.supplierName}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">{s.vehicle_plate}</td>
                      <td className="px-4 py-3 text-slate-700">{(s.net_weight / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} t</td>
                      <td className="px-4 py-3 font-semibold font-mono">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {qInfo.badges.map((b, bIdx) => (
                            <span key={bIdx} className={`px-2 py-0.5 rounded-md text-xs font-bold border ${b.color}`}>
                              {b.text}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        ₺{Number(s.sale_price_per_m2 || 0).toLocaleString('tr-TR')} / {qInfo.priceUnit}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'completed' ? 'bg-green-100 text-green-700' : s.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {s.status === 'completed' ? 'Tamamlandı' : s.status === 'cancelled' ? 'İptal' : 'Bekliyor'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setDetailShipment(s)}
                            className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Sevkiyat Detayı">
                            <Eye size={14} />
                          </button>
                          <button onClick={() => { setEditShipment(s); setShowModal(true); }}
                            className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="Düzenle">
                            <Pencil size={14} />
                          </button>
                          {isAdmin() && (
                            <button onClick={() => handleDelete(s)} disabled={deleting === s.id}
                              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Sil">
                              {deleting === s.id
                                ? <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                : <Trash2 size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <Modal title={editShipment ? `Sevkiyat Düzenle — ${editShipment.invoice_no}` : 'Yeni Sevkiyat / Kantar Kaydı'} onClose={() => { setShowModal(false); setEditShipment(undefined); }} size="xl">
          <ShipmentForm customers={customers} products={products} initial={editShipment}
            onSave={() => { setShowModal(false); setEditShipment(undefined); load(); }}
            onClose={() => { setShowModal(false); setEditShipment(undefined); }} />
        </Modal>
      )}

      {detailShipment && (
        <Modal title={`Sevkiyat Detayı — ${detailShipment.invoice_no}`} onClose={() => setDetailShipment(undefined)} size="lg">
          <ShipmentDetail shipment={detailShipment} onClose={() => setDetailShipment(undefined)} />
        </Modal>
      )}
    </div>
  );
}
