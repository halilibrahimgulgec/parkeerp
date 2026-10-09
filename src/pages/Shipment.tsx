import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shipment, Customer, Site, Product, Company } from '../types';
import Modal from '../components/Modal';
import {
  Plus,
  Truck,
  Search,
  Filter,
  AlertCircle,
  Trash2,
  Eye,
  Pencil,
  PackageX,
  Target,
  ShoppingBag,
  Lock,
  Camera,
  Image,
  Loader2,
  Sparkles,
  X,
  Check,
  RotateCcw,
  Printer,
  Boxes,
  Phone,
  CheckCircle2,
  ArrowRight,
  Calendar,
  FileText,
  ArrowUp,
  Building2,
} from 'lucide-react';
import {
  scanWaybillImageForShipment,
  ParsedShipmentOCRData,
  smartMatchProduct,
  normalizeDateToISO,
  normalizePalletType
} from '../utils/aiVisionOCREngine';

const getLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().split('T')[0];
};

export function predictNextInvoiceNo(existingShipments: Shipment[]): string {
  if (!existingShipments || existingShipments.length === 0) {
    return '2401';
  }

  let maxNum = 0;
  let detectedPrefix = '';

  for (const s of existingShipments) {
    const inv = s.invoice_no?.trim();
    if (!inv) continue;

    // Pattern 1: Pure number like "2453"
    if (/^\d+$/.test(inv)) {
      const num = parseInt(inv, 10);
      if (num > maxNum) maxNum = num;
    } else {
      // Pattern 2: Prefix + number like "İRS-2024-001" or "İRS-2453"
      const match = inv.match(/^(.*?)(\d+)$/);
      if (match && match[2]) {
        const num = parseInt(match[2], 10);
        if (num > maxNum) {
          maxNum = num;
          detectedPrefix = match[1];
        }
      }
    }
  }

  if (maxNum > 0) {
    if (detectedPrefix) {
      return `${detectedPrefix}${maxNum + 1}`;
    }
    return String(maxNum + 1);
  }

  return '2401';
}

export function getQuotaUnitPrice(q: any): number {
  if (q?.unit_price !== undefined && q?.unit_price !== null && Number(q.unit_price) > 0) {
    return Number(q.unit_price);
  }
  try {
    const local = JSON.parse(localStorage.getItem('parke_quota_unit_prices') || '{}');
    if (q?.id && local[q.id] && Number(local[q.id]) > 0) return Number(local[q.id]);
  } catch (e) {}

  if (q?.notes) {
    const match = q.notes.match(/\[F[Iİ]YAT:\s*([0-9.,]+)\s*₺?\]/i);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
}

export function getSupplierInfo(shipment: any): {
  isExternal: boolean;
  supplierName: string;
  supplierInvoiceNo?: string;
  unitPrice?: number;
} {
  if (!shipment) return { isExternal: false, supplierName: '' };

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

export function parseItemPricesFromNotes(notes?: string): Record<string, number> {
  if (!notes) return {};
  const match = notes.match(/\[KALEM_F[Iİ]YATLAR:\s*([^\]]+)\]/i);
  if (!match || !match[1]) return {};
  const map: Record<string, number> = {};
  const parts = match[1].split(';');
  for (const part of parts) {
    const [pid, priceStr] = part.split(':');
    if (pid && priceStr) {
      const p = parseFloat(priceStr.replace(',', '.'));
      if (!isNaN(p) && p > 0) map[pid.trim()] = p;
    }
  }
  return map;
}

export interface VehicleMemory {
  plate: string;
  driver_name: string;
  driver_phone: string;
  tare_weight: number;
  last_used_date: string;
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
    unit_price: number;
    is_custom_price?: boolean;
  }[];
}

const getEmptyForm = (defaultInvoiceNo: string = ''): ShipmentFormData => ({
  invoice_no: defaultInvoiceNo,
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
  items: [{ product_id: '', pallets: 0, pallet_type: 'sevkiyat', m2: 0, unit: 'm2', unit_price: 0, is_custom_price: false }],
});

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
      badges: [
        {
          text: `${rawVal.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`,
          unit: 'm²',
          color: 'text-blue-700 bg-blue-50 border-blue-200',
        },
      ],
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
    const effectiveUnit =
      prodUnit === 'metre' || it.unit === 'metre'
        ? 'metre'
        : prodUnit === 'adet' || it.unit === 'adet'
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
      color: 'text-blue-700 bg-blue-50 border-blue-200',
    });
  }
  if (metreTotal > 0) {
    badges.push({
      text: `${metreTotal.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre`,
      unit: 'metre',
      color: 'text-amber-800 bg-amber-50 border-amber-200',
    });
  }
  if (adetTotal > 0) {
    badges.push({
      text: `${adetTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} Adet`,
      unit: 'adet',
      color: 'text-purple-700 bg-purple-50 border-purple-200',
    });
  }

  const primaryUnit = metreTotal > 0 && m2Total === 0 ? 'm' : adetTotal > 0 && m2Total === 0 ? 'adet' : 'm²';

  return {
    badges,
    displayText: badges.map((b) => b.text).join(' + ') || '0 m²',
    m2: m2Total,
    metre: metreTotal,
    adet: adetTotal,
    priceUnit: primaryUnit,
  };
}

// ── PRINTABLE WAYBILL & WEIGHBRIDGE SLIP MODAL ──
export function PrintWaybillModal({
  shipment,
  products,
  onClose,
}: {
  shipment: Shipment;
  products: Product[];
  onClose: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from('shipment_items')
      .select('*, products(*)')
      .eq('shipment_id', shipment.id)
      .then(({ data }) => setItems(data || []));
  }, [shipment.id]);

  const notesPrices = parseItemPricesFromNotes(shipment.notes);
  let localSavedPrices: Record<string, number> = {};
  try {
    const allSaved = JSON.parse(localStorage.getItem('parke_shipment_item_prices') || '{}');
    localSavedPrices = allSaved[shipment.id] || {};
  } catch {}

  const getItemPrice = (it: any) => {
    if (it.unit_price && Number(it.unit_price) > 0) return Number(it.unit_price);
    if (notesPrices[it.product_id]) return notesPrices[it.product_id];
    if (localSavedPrices[it.product_id]) return localSavedPrices[it.product_id];
    return Number(shipment.sale_price_per_m2) || 0;
  };

  const calculatedItemsTotal = items.reduce((sum, it) => {
    const p = getItemPrice(it);
    return sum + p * (Number(it.m2) || 0);
  }, 0);

  const totalPallets = items.reduce((sum, it) => sum + (Number(it.pallets) || 0), 0);
  const qInfo = getShipmentDisplayQuantity({ ...shipment, shipment_items: items });
  const supInfo = getSupplierInfo(shipment);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      {/* Embedded print CSS */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-slip, #printable-slip * {
            visibility: visible !important;
          }
          #printable-slip {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 15mm !important;
            background: white !important;
            border: none !important;
            box-shadow: none !important;
            z-index: 999999 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Top Actions (Hidden in Print) */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <Printer size={18} className="text-slate-700" />
            <h3 className="font-bold text-slate-800 text-sm">Resmi Kantar & Sevk Fişi Çıktısı</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              <Printer size={14} />
              <span>Yazdır / PDF Kaydet</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Waybill Slip Content */}
        <div id="printable-slip" className="p-6 sm:p-8 overflow-y-auto flex-1 font-sans text-slate-900 bg-white">
          {/* Slip Header */}
          <div className="border-b-2 border-slate-900 pb-4 mb-4">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 uppercase">
                  PARKE VE BETON YAPI ELEMANLARI
                </h1>
                <p className="text-xs text-slate-600 font-medium">Sanayi ve Ticaret A.Ş. — Fabrika Üretim & Kantar Şefliği</p>
                <p className="text-[11px] text-slate-500">Organize Sanayi Bölgesi / Tel: 0344 000 00 00</p>
              </div>
              <div className="text-right">
                <span className="inline-block bg-slate-900 text-white font-mono text-xs px-3 py-1 rounded-md font-bold uppercase tracking-wider">
                  SEVK & KANTAR FİŞİ
                </span>
                <div className="mt-1 text-sm font-mono font-bold text-slate-900">
                  İrsaliye No: <span className="text-blue-700 font-black">{shipment.invoice_no}</span>
                </div>
                <div className="text-xs text-slate-600">
                  Tarih: <strong>{new Date(shipment.shipment_date).toLocaleDateString('tr-TR')}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Customer and Vehicle Info Grid */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-300 rounded-lg text-xs mb-4">
            <div>
              <span className="text-slate-500 font-semibold block text-[10px] uppercase">Alıcı Firma (Müşteri)</span>
              <span className="font-bold text-sm text-slate-900">{shipment.customers?.name || '-'}</span>
              {shipment.sites?.name && (
                <div className="text-slate-600 mt-0.5">
                  <span className="font-medium">Şantiye:</span> <strong>🏗️ {shipment.sites.name}</strong>
                </div>
              )}
              {supInfo.isExternal && (
                <div className="text-amber-800 font-bold text-[11px] mt-1">
                  📦 Dış Tedarikçi / Transit Sevk: {supInfo.supplierName}
                </div>
              )}
            </div>
            <div>
              <span className="text-slate-500 font-semibold block text-[10px] uppercase">Taşıyıcı & Araç Bilgileri</span>
              <div className="font-mono font-bold text-sm text-slate-900">
                Plaka: <span className="bg-white px-1.5 py-0.5 border border-slate-300 rounded">{shipment.vehicle_plate}</span>
              </div>
              <div className="text-slate-700 mt-0.5">
                Sürücü: <strong>{shipment.driver_name || '-'}</strong>
                {shipment.driver_phone && <span className="text-slate-500 ml-1.5 font-mono">({shipment.driver_phone})</span>}
              </div>
            </div>
          </div>

          {/* Weighbridge Scales Box */}
          <div className="border border-slate-300 rounded-lg overflow-hidden mb-4">
            <div className="bg-slate-100 px-3 py-1.5 font-bold text-xs text-slate-800 border-b border-slate-300 flex justify-between items-center">
              <span>⚖️ Kantar Tartım Değerleri</span>
              <span className="text-[11px] font-mono text-slate-600">Birim: Kilogram (kg)</span>
            </div>
            <div className="grid grid-cols-3 text-center divide-x divide-slate-200 p-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block">BRÜT AĞIRLIK</span>
                <span className="font-mono font-bold text-sm text-slate-800">
                  {Number(shipment.gross_weight || 0).toLocaleString('tr-TR')} kg
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-semibold block">DARA (BOŞ ARAÇ)</span>
                <span className="font-mono font-bold text-sm text-slate-800">
                  {Number(shipment.tare_weight || 0).toLocaleString('tr-TR')} kg
                </span>
              </div>
              <div className="bg-blue-50/50">
                <span className="text-[10px] text-blue-800 font-bold block">NET MALZEME TONAJI</span>
                <span className="font-mono font-black text-sm text-blue-900">
                  {Number(shipment.net_weight || 0).toLocaleString('tr-TR')} kg
                  <span className="text-xs font-semibold text-blue-700 block">
                    ({(Number(shipment.net_weight || 0) / 1000).toFixed(2)} Ton)
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Product Items Table */}
          <div className="border border-slate-300 rounded-lg overflow-hidden mb-4">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                  <th className="py-2 px-2.5 w-8 text-center">#</th>
                  <th className="py-2 px-2.5">Ürün Cinsi & Tanımı</th>
                  <th className="py-2 px-2.5 text-center">Palet / Paket</th>
                  <th className="py-2 px-2.5 text-right">Sevk Miktarı</th>
                  <th className="py-2 px-2.5 text-right">Birim Fiyat</th>
                  <th className="py-2 px-2.5 text-right">Satır Tutarı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-400">
                      Kalem yükleniyor...
                    </td>
                  </tr>
                ) : (
                  items.map((it, idx) => {
                    const price = getItemPrice(it);
                    const lineTotal = price * (Number(it.m2) || 0);
                    const prodUnit = it.products?.unit;
                    const uLabel =
                      prodUnit === 'metre' || it.unit === 'metre'
                        ? 'Metre'
                        : prodUnit === 'adet' || it.unit === 'adet'
                        ? 'Adet'
                        : 'm²';

                    return (
                      <tr key={it.id || idx}>
                        <td className="py-2 px-2.5 text-center font-mono text-slate-500">{idx + 1}</td>
                        <td className="py-2 px-2.5 font-bold text-slate-900">
                          {it.products?.name || 'Ürün'}
                          <span className="text-slate-500 font-normal ml-1">
                            ({it.products?.thickness}/{it.products?.color})
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-center font-medium">
                          {it.pallet_type === 'dokme'
                            ? 'Dökme'
                            : `${it.pallets} ${PALLET_LABELS[it.pallet_type] || 'Palet'}`}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900">
                          {Number(it.m2 || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} {uLabel}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono">
                          {price > 0 ? `₺${price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-blue-900">
                          {lineTotal > 0 ? `₺${lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-300 font-bold">
                <tr>
                  <td colSpan={2} className="py-2 px-2.5 text-slate-700">
                    TOPLAM SEVKİYAT
                  </td>
                  <td className="py-2 px-2.5 text-center font-mono">{totalPallets} Palet</td>
                  <td className="py-2 px-2.5 text-right font-mono text-blue-900">{qInfo.displayText}</td>
                  <td className="py-2 px-2.5 text-right text-slate-500">Toplam:</td>
                  <td className="py-2 px-2.5 text-right font-mono text-blue-900 text-sm">
                    ₺{calculatedItemsTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Notes and Disclaimers */}
          {shipment.notes && (
            <div className="p-2.5 border border-slate-200 rounded-lg bg-slate-50/50 text-[11px] mb-4">
              <span className="font-bold text-slate-700 mr-1">Sevkiyat Notu:</span>
              <span className="text-slate-800">{shipment.notes}</span>
            </div>
          )}

          <p className="text-[10px] text-slate-500 text-center italic mb-8">
            Bu belge sevkiyat ve kantar tartım teyit belgesidir. Malzemeler eksiksiz, sağlam ve şartnameye uygun olarak teslim edilmiştir.
          </p>

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-8 text-center pt-2">
            <div className="border-t border-slate-400 pt-2">
              <span className="block text-xs font-bold text-slate-800">TESLİM EDEN</span>
              <span className="text-[11px] text-slate-500">Fabrika Yetkilisi / Kantar Memuru</span>
              <div className="h-12 flex items-end justify-center text-slate-400 text-[10px] italic">İmza / Kaşe</div>
            </div>
            <div className="border-t border-slate-400 pt-2">
              <span className="block text-xs font-bold text-slate-800">TESLİM ALAN</span>
              <span className="text-[11px] text-slate-500">
                Taşıyıcı / Şoför ({shipment.driver_name || shipment.vehicle_plate})
              </span>
              <div className="h-12 flex items-end justify-center text-slate-400 text-[10px] italic">İmza</div>
            </div>
          </div>
        </div>

        {/* Modal Bottom Footer (Hidden in Print) */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center no-print">
          <span className="text-xs text-slate-500">A4 veya A5 boyutunda doğrudan termal/lazer yazıcıya basılabilir.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

// ── QUICK EMPTY PALLET RETURN MODAL ──
export function QuickPalletReturnModal({
  customers,
  initialCustomerId,
  initialSiteId,
  targetCompanyId,
  onSave,
  onClose,
}: {
  customers: Customer[];
  initialCustomerId?: string;
  initialSiteId?: string;
  targetCompanyId?: string | null;
  onSave: (returnedInfo: { customerName: string; quantity: number; palletType: string }) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [customerId, setCustomerId] = useState<string>(initialCustomerId || (customers[0]?.id || ''));
  const [siteId, setSiteId] = useState<string>(initialSiteId || '');
  const [sites, setSites] = useState<Site[]>([]);
  const [palletType, setPalletType] = useState<'sevkiyat' | 'tahta' | 'uretim'>('sevkiyat');
  const [quantity, setQuantity] = useState<number>(16);
  const [returnDate, setReturnDate] = useState<string>(getLocalDateString());
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (customerId) {
      const q = supabase
        .from('sites')
        .select('*')
        .eq('customer_id', customerId)
        .order('name');
      q.then(({ data }) => {
        const list = data || [];
        setSites(list);
        if (targetCompanyId) {
          list.filter((s) => !s.company_id).forEach((s) => {
            supabase.from('sites').update({ company_id: targetCompanyId }).eq('id', s.id).then();
          });
        }
      });
    } else {
      setSites([]);
    }
  }, [customerId, targetCompanyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      setError('Lütfen müşteri seçiniz.');
      return;
    }
    if (quantity <= 0) {
      setError('Lütfen geçerli bir iade palet adedi giriniz.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const { error: insErr } = await supabase.from('pallet_transactions').insert({
        date: returnDate,
        customer_id: customerId,
        site_id: siteId || null,
        transaction_type: 'returned',
        pallet_type: palletType,
        quantity: Number(quantity),
        notes: notes.trim() ? `Kantar iadesi: ${notes.trim()}` : 'Kantarda boş palet teslim alındı.',
        created_by: user?.id,
        ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
      });

      if (insErr) throw insErr;

      const custName = customers.find((c) => c.id === customerId)?.name || 'Müşteri';
      onSave({ customerName: custName, quantity: Number(quantity), palletType: PALLET_LABELS[palletType] || palletType });
    } catch (err: any) {
      setError(err?.message || 'Palet iadesi kaydedilirken hata oluştu.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Boxes size={18} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Hızlı Boş Palet İadesi Al</h3>
              <p className="text-[11px] text-slate-500">Müşterinin zimmetli palet bakiyesinden anında düşer</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Müşteri *</label>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setSiteId('');
              }}
              required
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            >
              <option value="">Müşteri Seçin...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Şantiye</label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            >
              <option value="">Merkez / Şantiyesiz</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Palet Tipi</label>
              <select
                value={palletType}
                onChange={(e) => setPalletType(e.target.value as any)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                <option value="sevkiyat">Sevkiyat Paleti</option>
                <option value="tahta">Tahta Palet</option>
                <option value="uretim">Üretim Paleti</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">İade Adedi *</label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-center font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">İade Tarihi</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Araç / Plaka / Not</label>
              <input
                type="text"
                placeholder="Örn: 34 ABC 123 ile geldi"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>
          </div>

          {error && (
            <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-xl flex items-center gap-1.5">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />}
              <span>İadeyi Onayla & Kaydet</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── SAVED SUCCESS DIALOG MODAL ──
function ShipmentSavedSuccessModal({
  shipment,
  onPrint,
  onPalletReturn,
  onNewShipment,
  onClose,
}: {
  shipment: Shipment;
  onPrint: () => void;
  onPalletReturn: () => void;
  onNewShipment: () => void;
  onClose: () => void;
}) {
  const qInfo = getShipmentDisplayQuantity(shipment);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm animate-bounce">
            <CheckCircle2 size={36} />
          </div>

          <div>
            <h2 className="text-xl font-black text-slate-900">Sevkiyat Başarıyla Kaydedildi!</h2>
            <p className="text-xs text-slate-500 mt-1">
              İrsaliye <strong>#{shipment.invoice_no}</strong> veritabanına ve kantar kütüğüne işlendi.
            </p>
          </div>

          {/* Quick Summary Pill Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-left grid grid-cols-2 gap-2.5">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Müşteri / Şantiye</span>
              <span className="font-bold text-slate-900 truncate block">{shipment.customers?.name || '-'}</span>
              {shipment.sites?.name && <span className="text-slate-600 text-[11px]">🏗️ {shipment.sites.name}</span>}
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Araç / Sürücü</span>
              <span className="font-mono font-bold text-slate-900 block">{shipment.vehicle_plate}</span>
              <span className="text-slate-600 text-[11px]">{shipment.driver_name || '-'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Sevk Edilen Miktar</span>
              <span className="font-bold text-blue-700">{qInfo.displayText}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Net Kantar Tonajı</span>
              <span className="font-mono font-bold text-slate-800">
                {(Number(shipment.net_weight || 0) / 1000).toFixed(2)} Ton
              </span>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={onPrint}
              className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer"
            >
              <Printer size={18} />
              <span>🖨️ Kantar / Sevk Fişini Yazdır</span>
            </button>

            <button
              type="button"
              onClick={onPalletReturn}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <Boxes size={16} />
              <span>🔄 Araçtan Boş Palet İadesi Al</span>
            </button>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onNewShipment}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                + Yeni Sevkiyata Devam Et
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ENHANCED SHIPMENT FORM ──
function ShipmentForm({
  customers,
  products,
  initial,
  prefilledData,
  predictedInvoiceNo,
  vehicleMemoryList,
  targetCompanyId,
  onSaveSuccess,
  onClose,
}: {
  customers: Customer[];
  products: Product[];
  initial?: Shipment;
  prefilledData?: Partial<ShipmentFormData>;
  predictedInvoiceNo?: string;
  vehicleMemoryList?: VehicleMemory[];
  targetCompanyId?: string | null;
  onSaveSuccess: (savedShipment: Shipment) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<ShipmentFormData>(() => {
    if (initial) {
      const sup = getSupplierInfo(initial);
      const notesPrices = parseItemPricesFromNotes(initial.notes);
      let localSavedPrices: Record<string, number> = {};
      try {
        const allSaved = JSON.parse(localStorage.getItem('parke_shipment_item_prices') || '{}');
        localSavedPrices = allSaved[initial.id] || {};
      } catch {}

      const existingItems = (initial as any).shipment_items || [];
      let initialFormItems = existingItems.map((x: any) => {
        const itemPrice =
          Number(x.unit_price) > 0
            ? Number(x.unit_price)
            : notesPrices[x.product_id] || localSavedPrices[x.product_id] || initial.sale_price_per_m2 || 0;
        return {
          product_id: x.product_id,
          pallets: Number(x.pallets) || 0,
          pallet_type: (x.pallet_type || 'sevkiyat') as any,
          m2: Number(x.m2) || 0,
          unit: x.unit || (products.find((p) => p.id === x.product_id)?.unit) || 'm2',
          unit_price: itemPrice,
          is_custom_price: itemPrice > 0,
        };
      });

      // Akıllı Geri Kazanım: Eğer hafızada shipment_items boşsa fakat notlarda KALEM_FİYATLAR varsa
      if (initialFormItems.length === 0 && initial.notes) {
        const pids = Object.keys(notesPrices);
        if (pids.length > 0) {
          initialFormItems = pids.map((pid) => {
            const prod = products.find((p) => p.id === pid);
            const m2Val = Number(initial.total_m2) || 0;
            const palletsVal = prod?.m2_per_pallet ? Math.round((m2Val / prod.m2_per_pallet) * 10) / 10 : 0;
            return {
              product_id: pid,
              pallets: palletsVal,
              pallet_type: 'sevkiyat' as any,
              m2: m2Val,
              unit: prod?.unit || 'm2',
              unit_price: notesPrices[pid] || initial.sale_price_per_m2 || 0,
              is_custom_price: true,
            };
          });
        }
      }

      // Eğer hala boşsa (eski tip kayıtlarda), en azından total_m2 ve fiyatı içeren 1 düzenlenebilir kalem sun
      if (initialFormItems.length === 0) {
        initialFormItems = [
          {
            product_id: '',
            pallets: 0,
            pallet_type: 'sevkiyat',
            m2: Number(initial.total_m2) || 0,
            unit: 'm2',
            unit_price: Number(initial.sale_price_per_m2) || 0,
            is_custom_price: false,
          },
        ];
      }

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
        items: initialFormItems,
      };
    }
    if (prefilledData) {
      return {
        ...getEmptyForm(predictedInvoiceNo || ''),
        ...prefilledData,
      };
    }
    return getEmptyForm(predictedInvoiceNo || '');
  });

  const [sites, setSites] = useState<Site[]>([]);
  const [showQuickSiteModal, setShowQuickSiteModal] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [addingSite, setAddingSite] = useState(false);
  const [customerQuotas, setCustomerQuotas] = useState<any[]>([]);
  const [lastShipmentPriceMap, setLastShipmentPriceMap] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  // OCR Scanning states
  const [isScanning, setIsScanning] = useState(false);
  const [scanStepMessage, setScanStepMessage] = useState('');
  const [scanNotice, setScanNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-fill from Plate Memory
  const handlePlateChange = (val: string) => {
    const cleanInput = val.trim().toUpperCase();
    const matched = (vehicleMemoryList || []).find(
      (v) => v.plate.replace(/\s+/g, '') === cleanInput.replace(/\s+/g, '')
    );

    setForm((f) => {
      const next = { ...f, vehicle_plate: val.toUpperCase() };
      if (matched) {
        if (!f.driver_name && matched.driver_name) next.driver_name = matched.driver_name;
        if (!f.driver_phone && matched.driver_phone) next.driver_phone = matched.driver_phone;
        if ((!f.tare_weight || f.tare_weight === 0) && matched.tare_weight > 0) next.tare_weight = matched.tare_weight;
      }
      return next;
    });
  };

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

      setForm((prev) => {
        const next = { ...prev };
        if (ocr.invoice_no) next.invoice_no = ocr.invoice_no;
        if (ocr.date) next.shipment_date = normalizeDateToISO(ocr.date);
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

        if (ocr.items && ocr.items.length > 0) {
          next.items = ocr.items.map((it) => {
            let prodId = it.product_id;
            if (!prodId) {
              const matched =
                smartMatchProduct(it.product_name, products) ||
                products.find((p) => p.name.toLowerCase().includes(it.product_name.toLowerCase()));
              prodId = matched?.id || products[0]?.id || '';
            }
            const pObj = products.find((p) => p.id === prodId);
            return {
              product_id: prodId,
              pallets: it.pallets,
              pallet_type: it.pallet_type || 'uretim',
              m2: it.m2,
              unit: it.unit || 'm2',
              unit_price: Number(pObj?.unit_price || (pObj as any)?.price || 0),
            };
          });
        }

        return next;
      });

      const firstItem = ocr.items?.[0];
      const pTypeLabel = firstItem?.pallet_type ? PALLET_LABELS[firstItem.pallet_type] || firstItem.pallet_type : 'Üretim Paleti';
      const formattedDate = ocr.date ? new Date(normalizeDateToISO(ocr.date)).toLocaleDateString('tr-TR') : '';

      setScanNotice({
        type: 'success',
        text: `✅ İrsaliye (#${ocr.invoice_no || '-'} / ${ocr.customer_name || 'Müşteri'}) başarıyla okundu! ${formattedDate ? `Tarih: ${formattedDate} | ` : ''}Palet: ${firstItem?.pallets || 0} (${pTypeLabel})`,
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
      const sitesQuery = supabase
        .from('sites')
        .select('*')
        .eq('customer_id', form.customer_id)
        .order('name');
      sitesQuery.then(({ data }) => {
        const list = data || [];
        setSites(list);
        if (targetCompanyId) {
          list.filter((s) => !s.company_id).forEach((s) => {
            supabase.from('sites').update({ company_id: targetCompanyId }).eq('id', s.id).then();
          });
        }
      });

      // Fetch customer quotas
      const quotasQuery = supabase
        .from('customer_quotas')
        .select('*, products(*), sites(*)')
        .eq('customer_id', form.customer_id)
        .eq('is_active', true);

      quotasQuery.then(async ({ data: qData }) => {
        if (!qData || qData.length === 0) {
          setCustomerQuotas([]);
          return;
        }

        const shipItemsQuery = supabase
          .from('shipment_items')
          .select('product_id, m2, unit, shipments!inner(id, shipment_date, customer_id, site_id, status)')
          .eq('shipments.customer_id', form.customer_id)
          .eq('shipments.status', 'completed');

        const { data: shipData } = await shipItemsQuery;

        const calculated = qData.map((quota) => {
          const matching = (shipData || []).filter((item) => {
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
            unit_price: getQuotaUnitPrice(quota),
            shipped,
            remaining,
            pct,
          };
        });
        setCustomerQuotas(calculated);
      });

      // Fetch recent shipments to get last price memory (Priority 3)
      const pastShipsQuery = supabase
        .from('shipments')
        .select('id, sale_price_per_m2, notes, shipment_items(product_id, unit_price)')
        .eq('customer_id', form.customer_id)
        .eq('status', 'completed')
        .order('shipment_date', { ascending: false })
        .limit(30);

      pastShipsQuery.then(({ data: pastShips }) => {
        const map: Record<string, number> = {};
        if (pastShips) {
          for (const s of pastShips) {
            const notesPrices = parseItemPricesFromNotes(s.notes);
            const items = (s as any).shipment_items || [];
            for (const it of items) {
              if (it.product_id && !map[it.product_id]) {
                const itemPrice =
                  (Number(it.unit_price) > 0 ? Number(it.unit_price) : 0) ||
                  notesPrices[it.product_id] ||
                  (Number(s.sale_price_per_m2) > 0 ? Number(s.sale_price_per_m2) : 0);
                if (itemPrice > 0) {
                  map[it.product_id] = itemPrice;
                }
              }
            }
          }
        }
        setLastShipmentPriceMap(map);
      });
    } else {
      setSites([]);
      setCustomerQuotas([]);
      setLastShipmentPriceMap({});
    }
  }, [form.customer_id, initial, targetCompanyId]);

  useEffect(() => {
    const fetchStock = async () => {
      // 1. Stok görünümü
      let stockQuery = supabase.from('v_product_stock').select('*');
      if (targetCompanyId) {
        stockQuery = stockQuery.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
      }
      const stockRes = await stockQuery;
      const map: Record<string, number> = {};
      for (const p of products) {
        const stockRow = (stockRes.data || []).find((x: any) => x.product_id === p.id);
        map[p.id] = stockRow ? stockRow.current_stock : 0;
      }
      setStockMap(map);

      // 2. Eğer initial varsa ve veritabanından kalemleri tazelemek gerekirse
      if (initial) {
        let dbItems: any[] = [];
        try {
          // Güvenli sorgu: Eksik sütun hatası vermemesi için '*' kullanılır
          const res = await supabase
            .from('shipment_items')
            .select('*')
            .eq('shipment_id', initial.id);

          if (!res.error && res.data && res.data.length > 0) {
            dbItems = res.data;
          } else {
            // Yedek sorgu
            const fb = await supabase
              .from('shipment_items')
              .select('product_id, m2, pallets, unit')
              .eq('shipment_id', initial.id);
            if (!fb.error && fb.data && fb.data.length > 0) {
              dbItems = fb.data;
            }
          }
        } catch (err) {
          console.warn('shipment_items yüklenirken hata:', err);
        }

        if (dbItems.length > 0) {
          for (const row of dbItems) {
            map[row.product_id] = (map[row.product_id] || 0) + (Number(row.m2) || 0);
          }
          setStockMap({ ...map });

          const notesPrices = parseItemPricesFromNotes(initial.notes);
          let localSavedPrices: Record<string, number> = {};
          try {
            const allSaved = JSON.parse(localStorage.getItem('parke_shipment_item_prices') || '{}');
            localSavedPrices = allSaved[initial.id] || {};
          } catch {}

          setForm((f) => ({
            ...f,
            items: dbItems.map((x: any) => {
              const itemPrice =
                Number(x.unit_price) > 0
                  ? Number(x.unit_price)
                  : notesPrices[x.product_id] || localSavedPrices[x.product_id] || initial.sale_price_per_m2 || 0;
              return {
                product_id: x.product_id,
                pallets: Number(x.pallets) || 0,
                pallet_type: (x.pallet_type || 'sevkiyat') as any,
                m2: Number(x.m2) || 0,
                unit: x.unit || (products.find((p) => p.id === x.product_id)?.unit) || 'm2',
                unit_price: itemPrice,
                is_custom_price: itemPrice > 0,
              };
            }),
          }));
        }
      }
    };
    fetchStock();
  }, [products, initial]);

  // Unified Smart Pricing Resolution
  const resolveSmartPriceForItem = (productId: string) => {
    if (!form.customer_id || !productId) {
      return { price: 0, source: 'none' as const, label: 'Fiyat Tanımsız', detail: '' };
    }

    // 1. Quota / Sözleşme Fiyatı (Priority 1)
    if (customerQuotas.length > 0) {
      const siteAndProdQuota = customerQuotas.find(
        (q) =>
          q.is_active !== false &&
          q.product_id === productId &&
          form.site_id &&
          q.site_id === form.site_id &&
          Number(q.unit_price) > 0
      );
      if (siteAndProdQuota) {
        return {
          price: Number(siteAndProdQuota.unit_price),
          source: 'quota' as const,
          label: 'Sözleşme / Kota Fiyatı',
          detail: `${siteAndProdQuota.sites?.name || ''} şantiye kotası`,
        };
      }

      const prodQuota = customerQuotas.find(
        (q) => q.is_active !== false && q.product_id === productId && Number(q.unit_price) > 0
      );
      if (prodQuota) {
        return {
          price: Number(prodQuota.unit_price),
          source: 'quota' as const,
          label: 'Sözleşme / Kota Fiyatı',
          detail: 'Müşteri ürün taahhüt anlaşması',
        };
      }

      const generalQuota = customerQuotas.find(
        (q) => q.is_active !== false && !q.product_id && Number(q.unit_price) > 0
      );
      if (generalQuota) {
        return {
          price: Number(generalQuota.unit_price),
          source: 'quota' as const,
          label: 'Sözleşme / Kota Fiyatı',
          detail: 'Müşteri genel taahhüt anlaşması',
        };
      }
    }

    // 2. Fabrika Standart Liste Fiyatı (Priority 2)
    const prod = products.find((p) => p.id === productId);
    if (prod?.unit_price && Number(prod.unit_price) > 0) {
      return {
        price: Number(prod.unit_price),
        source: 'product_list' as const,
        label: 'Fabrika Liste Fiyatı',
        detail: `${prod.name} fabrika liste fiyatı`,
      };
    }

    // 3. Son Sevk Fiyatı Hafızası (Priority 3)
    if (lastShipmentPriceMap[productId] && lastShipmentPriceMap[productId] > 0) {
      return {
        price: Number(lastShipmentPriceMap[productId]),
        source: 'last_shipment' as const,
        label: 'Son Sevk Fiyatı',
        detail: 'Bu müşteriye yapılan en son sevk fiyatı',
      };
    }

    return { price: 0, source: 'none' as const, label: 'Fiyat Tanımsız', detail: '' };
  };

  // Auto-resolve prices for un-overridden items when customer, site or quotas change
  useEffect(() => {
    if (initial) return;
    setForm((f) => {
      let changed = false;
      const newItems = f.items.map((item) => {
        if (!item.product_id || item.is_custom_price) return item;
        const sp = resolveSmartPriceForItem(item.product_id);
        if (sp.price > 0 && sp.price !== item.unit_price) {
          changed = true;
          return { ...item, unit_price: sp.price };
        }
        return item;
      });
      return changed ? { ...f, items: newItems } : f;
    });
  }, [form.customer_id, form.site_id, customerQuotas, products, lastShipmentPriceMap, initial]);

  // Hızlı Yeni Şantiye Ekleme
  const handleQuickAddSite = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.customer_id || !newSiteName.trim()) return;
    setAddingSite(true);
    try {
      const { data, error: siteErr } = await supabase
        .from('sites')
        .insert({
          customer_id: form.customer_id,
          name: newSiteName.trim(),
          is_active: true,
          ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
        })
        .select()
        .single();

      if (siteErr) throw siteErr;

      // Güncel şantiye listesini tekrar yükle
      const { data: updatedSites } = await supabase
        .from('sites')
        .select('*')
        .eq('customer_id', form.customer_id)
        .order('name');

      setSites(updatedSites || []);

      // Yeni eklenen şantiyeyi otomatik seç
      if (data?.id) {
        setForm((f) => ({ ...f, site_id: data.id }));
      }

      setNewSiteName('');
      setShowQuickSiteModal(false);
    } catch (err: any) {
      console.error('Hızlı şantiye ekleme hatası:', err);
      alert('Şantiye eklenirken hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
    } finally {
      setAddingSite(false);
    }
  };

  // Çift Yönlü Palet / Metraj & Akıllı Fiyat Hesaplayıcı
  const setItem = (idx: number, field: string, value: any) => {
    setForm((f) => {
      const items = [...f.items];
      const cur = { ...items[idx], [field]: value };

      if (field === 'pallet_type' && value === 'dokme') {
        cur.pallets = 0;
      }

      // Palet veya Ürün değiştiğinde m² hesapla
      if (field === 'pallets' || field === 'product_id') {
        const p = products.find((x) => x.id === (field === 'product_id' ? value : cur.product_id));
        if (p) {
          cur.m2 = Math.round(cur.pallets * p.m2_per_pallet * 100) / 100;
          if (field === 'product_id' && p.unit) {
            cur.unit = p.unit;
          }
        }
      }

      // Ürün seçildiğinde akıllı fiyatı otomatik ata
      if (field === 'product_id') {
        const sp = resolveSmartPriceForItem(value);
        cur.unit_price = sp.price > 0 ? sp.price : 0;
        cur.is_custom_price = false;
      }

      // Manuel fiyat değiştirilirse özel fiyat olarak işaretle
      if (field === 'unit_price') {
        cur.unit_price = Number(value);
        cur.is_custom_price = true;
      }

      items[idx] = cur;
      return { ...f, items };
    });
  };

  const revertItemPrice = (idx: number) => {
    const item = form.items[idx];
    if (!item?.product_id) return;
    const sp = resolveSmartPriceForItem(item.product_id);
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], unit_price: sp.price, is_custom_price: false };
      return { ...f, items };
    });
  };

  const addItem = () =>
    setForm((f) => ({
      ...f,
      items: [
        ...f.items,
        {
          product_id: '',
          pallets: 0,
          pallet_type: f.items[f.items.length - 1]?.pallet_type || 'sevkiyat',
          m2: 0,
          unit: 'm2',
          unit_price: 0,
          is_custom_price: false,
        },
      ],
    }));

  const removeItem = (idx: number) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const totalM2 = form.items.reduce((s, i) => s + i.m2, 0);
  const totalRevenue = form.items.reduce(
    (s, i) => s + (Number(i.m2) || 0) * (Number(i.unit_price) || 0),
    0
  );
  const weightedAveragePrice =
    totalM2 > 0 ? Math.round((totalRevenue / totalM2) * 100) / 100 : form.items[0]?.unit_price || 0;
  const netWeight = Math.max(form.gross_weight - form.tare_weight, 0);
  const netRevenue = totalRevenue - (Number(form.logistics_cost) || 0);

  // Matched Vehicle Memory for Plate
  const matchedVehicle = useMemo(() => {
    if (!form.vehicle_plate) return null;
    const clean = form.vehicle_plate.replace(/\s+/g, '');
    return (vehicleMemoryList || []).find((v) => v.plate.replace(/\s+/g, '') === clean);
  }, [form.vehicle_plate, vehicleMemoryList]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id) {
      setError('Lütfen müşteri seçiniz.');
      return;
    }
    if (!initial && form.items.some((i) => !i.product_id)) {
      setError('Lütfen tüm kalemlerde ürün seçiniz.');
      return;
    }

    // Depo Stok Kontrolü: Doğrudan tedarikçi transit sevkiyatı değilse hem yeni sevkiyatta hem düzenlemede kesinlikle stok kontrol edilir
    const isTransit = Boolean(form.is_external && form.supplier_name.trim());
    if (!isTransit) {
      for (const item of form.items) {
        if (!item.product_id) continue;
        const available = stockMap[item.product_id] ?? 0;
        const requested = Number(item.m2) || 0;
        if (requested > available) {
          const p = products.find((x) => x.id === item.product_id);
          const u = item.unit === 'metre' ? 'Metre' : item.unit === 'adet' ? 'Adet' : 'm²';
          setError(
            `🚫 İŞLEM ENGELLENDİ: "${p?.name ?? 'Ürün'}" için depoda yeterli stok yok!\n` +
            `Depodaki Mevcut Hazır Stok: ${available.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ${u}\n` +
            `Çıkılmak İstenen Miktar: ${requested.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ${u}\n` +
            `Stok sıfır veya yetersizken sevkiyat kaydedilemez. Lütfen önce "Günlük Üretim Girişi"nden üretim fişi oluşturunuz.`
          );
          setSaving(false);
          return;
        }
      }
    }

    // Quota warning check
    if (customerQuotas.length > 0) {
      for (const q of customerQuotas) {
        const formItemsMatching = form.items.filter((item) => {
          if (q.product_id && item.product_id !== q.product_id) return false;
          if (form.site_id && q.site_id && form.site_id !== q.site_id) return false;
          const itemUnit = item.unit || 'm2';
          if (itemUnit !== q.unit) return false;
          return true;
        });
        const formQty = formItemsMatching.reduce((acc, i) => acc + (Number(i.m2) || 0), 0);
        if (formQty > 0 && formQty > q.remaining) {
          const exceededBy = Math.round(formQty - q.remaining);
          const custName = customers.find((c) => c.id === form.customer_id)?.name || 'Müşteri';
          const confirmMsg = `⚠️ MÜŞTERİ KOTASI UYARISI:\n\n"${custName}" için tanımlanan ${Number(q.target_quantity).toLocaleString('tr-TR')} ${q.unit} taahhüt kotası bu sevkiyat ile ${exceededBy.toLocaleString('tr-TR')} ${q.unit} aşılacaktır!\n\nMevcut Kalan Kota: ${Number(q.remaining).toLocaleString('tr-TR')} ${q.unit}\nBu Sevkiyat: ${formQty.toLocaleString('tr-TR')} ${q.unit}\n\nSevkiyat işlemine devam etmek istiyor musunuz?`;
          if (!window.confirm(confirmMsg)) {
            return;
          }
        }
      }
    }

    setSaving(true);
    setError('');

    const itemPriceTags = form.items
      .filter((i) => i.product_id && i.unit_price > 0)
      .map((i) => `${i.product_id}:${i.unit_price}`)
      .join(';');
    let updatedNotes = form.notes;
    if (form.is_external && form.supplier_name.trim() && !updatedNotes.includes('Tedarikçi:')) {
      updatedNotes = `Doğrudan Transit Sevk (Tedarikçi: ${form.supplier_name.trim()}) ${updatedNotes ? '— ' + updatedNotes : ''}`;
    }
    if (itemPriceTags) {
      updatedNotes = updatedNotes.replace(/\[KALEM_F[Iİ]YATLAR:[^\]]*\]/gi, '').trim();
      updatedNotes = updatedNotes ? `${updatedNotes} [KALEM_FİYATLAR: ${itemPriceTags}]` : `[KALEM_FİYATLAR: ${itemPriceTags}]`;
    }

    const shipPayload = {
      invoice_no: form.invoice_no,
      customer_id: form.customer_id,
      site_id: form.site_id || null,
      vehicle_plate: form.vehicle_plate,
      driver_name: form.driver_name,
      driver_phone: form.driver_phone,
      gross_weight: form.gross_weight,
      tare_weight: form.tare_weight,
      sale_price_per_m2: weightedAveragePrice,
      logistics_cost: form.logistics_cost,
      total_m2: totalM2,
      shipment_date: form.shipment_date,
      supplier_name: form.is_external ? form.supplier_name.trim() || 'Dış Tedarikçi' : null,
      notes: updatedNotes,
      ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
    };

    let resultShipment: any = null;

    if (initial) {
      const { error: shipErr } = await supabase.from('shipments').update(shipPayload).eq('id', initial.id);
      if (shipErr) {
        setError(shipErr.message);
        setSaving(false);
        return;
      }
      resultShipment = { ...initial, ...shipPayload };

      // Update shipment items
      await supabase.from('shipment_items').delete().eq('shipment_id', initial.id);
      const itemsToInsertWithPrice = form.items
        .filter((i) => i.product_id)
        .map((i) => ({
          shipment_id: initial.id,
          product_id: i.product_id,
          pallets: i.pallets,
          pallet_type: i.pallet_type,
          m2: i.m2,
          unit: i.unit,
          unit_price: Number(i.unit_price) || 0,
          total_price: (Number(i.unit_price) || 0) * (Number(i.m2) || 0),
          ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
        }));

      let { error: itemsErr } = await supabase.from('shipment_items').insert(itemsToInsertWithPrice);
      if (itemsErr) {
        const itemsPlain = form.items
          .filter((i) => i.product_id)
          .map((i) => ({
            shipment_id: initial.id,
            product_id: i.product_id,
            pallets: i.pallets,
            pallet_type: i.pallet_type,
            m2: i.m2,
            unit: i.unit,
            ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
          }));
        const fallbackRes = await supabase.from('shipment_items').insert(itemsPlain);
        itemsErr = fallbackRes.error;
      }
      if (itemsErr) {
        setError(itemsErr.message);
        setSaving(false);
        return;
      }

      // Update pallet transactions
      await supabase.from('pallet_transactions').delete().eq('shipment_id', initial.id);
      const palletGroups: Record<string, number> = {};
      form.items.forEach((i) => {
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
        ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
      }));

      if (palletTransactions.length > 0) {
        await supabase.from('pallet_transactions').insert(palletTransactions);
      }

      // Store local item prices cache
      try {
        const localPricesMap = JSON.parse(localStorage.getItem('parke_shipment_item_prices') || '{}');
        const thisShipMap: Record<string, number> = {};
        form.items.forEach((i) => {
          if (i.product_id) thisShipMap[i.product_id] = Number(i.unit_price) || 0;
        });
        localPricesMap[initial.id] = thisShipMap;
        localStorage.setItem('parke_shipment_item_prices', JSON.stringify(localPricesMap));
      } catch {}
    } else {
      const { data: shipData, error: shipErr } = await supabase
        .from('shipments')
        .insert({
          ...shipPayload,
          status: 'completed',
          created_by: user?.id,
        })
        .select('*, customers(*), sites(*)')
        .single();

      if (shipErr) {
        setError(shipErr.message);
        setSaving(false);
        return;
      }
      resultShipment = shipData;

      const itemsToInsertWithPrice = form.items
        .filter((i) => i.product_id)
        .map((i) => ({
          shipment_id: shipData.id,
          product_id: i.product_id,
          pallets: i.pallets,
          pallet_type: i.pallet_type,
          m2: i.m2,
          unit: i.unit,
          unit_price: Number(i.unit_price) || 0,
          total_price: (Number(i.unit_price) || 0) * (Number(i.m2) || 0),
          ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
        }));

      let { error: itemsErr } = await supabase.from('shipment_items').insert(itemsToInsertWithPrice);
      if (itemsErr) {
        const itemsPlain = form.items
          .filter((i) => i.product_id)
          .map((i) => ({
            shipment_id: shipData.id,
            product_id: i.product_id,
            pallets: i.pallets,
            pallet_type: i.pallet_type,
            m2: i.m2,
            unit: i.unit,
            ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
          }));
        const fallbackRes = await supabase.from('shipment_items').insert(itemsPlain);
        itemsErr = fallbackRes.error;
      }
      if (itemsErr) {
        await supabase.from('shipments').delete().eq('id', shipData.id);
        setError(itemsErr.message);
        setSaving(false);
        return;
      }

      // Pallet transactions
      const palletGroups: Record<string, number> = {};
      form.items.forEach((i) => {
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
        ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
      }));

      if (palletTransactions.length > 0) {
        await supabase.from('pallet_transactions').insert(palletTransactions);
      }

      // Store local item prices cache
      try {
        const localPricesMap = JSON.parse(localStorage.getItem('parke_shipment_item_prices') || '{}');
        const thisShipMap: Record<string, number> = {};
        form.items.forEach((i) => {
          if (i.product_id) thisShipMap[i.product_id] = Number(i.unit_price) || 0;
        });
        localPricesMap[shipData.id] = thisShipMap;
        localStorage.setItem('parke_shipment_item_prices', JSON.stringify(localPricesMap));
      } catch {}
    }

    setSaving(false);
    onSaveSuccess(resultShipment);
  };

  return (
    <>
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
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                  Vision AI
                </span>
              </div>
              <p className="text-slate-500 text-[11px] leading-tight">
                İrsaliye veya kantar fişinin fotoğrafını yükleyin; müşteri, şantiye, plaka ve ürünler anında dolsun.
              </p>
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
          <div
            className={`mt-3 pt-2 border-t text-xs font-medium flex items-center justify-between gap-2 ${
              scanNotice.type === 'success' ? 'text-emerald-800 border-emerald-200' : 'text-amber-800 border-amber-200'
            }`}
          >
            <span>{scanNotice.text}</span>
            <button type="button" onClick={() => setScanNotice(null)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ── İRSALİYE NO & TARİH ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-slate-700">İrsaliye No *</label>
            {!initial && predictedInvoiceNo && (
              <span className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-bold border border-blue-200">
                ✨ Otomatik Öneri
              </span>
            )}
          </div>
          <input
            type="text"
            value={form.invoice_no}
            onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="İRS-2024-001"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tarih *</label>
          <input
            type="date"
            value={form.shipment_date}
            onChange={(e) => setForm((f) => ({ ...f, shipment_date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            required
          />
        </div>
      </div>

      {/* ── MÜŞTERİ & ŞANTİYE ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Müşteri *</label>
          <select
            value={form.customer_id}
            onChange={(e) => {
              setForm((f) => ({ ...f, customer_id: e.target.value, site_id: '' }));
            }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 font-semibold"
            required
          >
            <option value="">Müşteri seçin...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-slate-700">Şantiye</label>
            {form.customer_id && (
              <button
                type="button"
                onClick={() => setShowQuickSiteModal(true)}
                className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                title="Bu müşteriye yeni bir şantiye ekle"
              >
                <Plus size={13} />
                <span>+ Şantiye Ekle</span>
              </button>
            )}
          </div>
          <select
            value={form.site_id}
            onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium bg-white cursor-pointer"
          >
            <option value="">
              {sites.length === 0 ? 'Merkez / Şantiyesiz (Tanımlı şantiye yok)' : 'Merkez / Şantiyesiz'}
            </option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                🏗️ {s.name}
              </option>
            ))}
          </select>
          {sites.length === 0 && form.customer_id && (
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>Bu müşteriye ait kayıtlı şantiye yok.</span>
              <button
                type="button"
                onClick={() => setShowQuickSiteModal(true)}
                className="font-bold underline text-blue-600 hover:text-blue-800 cursor-pointer ml-1"
              >
                + Şantiye Ekle
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── MALZEME KAYNAĞI (TRANSİT / FABRİKA) ── */}
      <div
        className={`p-3.5 rounded-xl border transition-all ${
          form.is_external ? 'bg-amber-50/70 border-amber-300' : 'bg-slate-50/70 border-slate-200'
        }`}
      >
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setForm((f) => ({ ...f, is_external: !f.is_external }))}
        >
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_external_shipment"
              checked={form.is_external}
              onChange={(e) => setForm((f) => ({ ...f, is_external: e.target.checked }))}
              className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 cursor-pointer"
            />
            <div>
              <label
                htmlFor="is_external_shipment"
                className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5"
              >
                <ShoppingBag size={14} className="text-amber-600" />
                Dış Tedarikçiden Transit Sevk (Dış Fabrikadan Alım)
              </label>
              <p className="text-[11px] text-slate-500">
                Bu malzeme fabrikamızda üretilmediyse, dış fabrikadan direkt müşteriye sevk edildiyse işaretleyin.
              </p>
            </div>
          </div>
          <span
            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
              form.is_external ? 'bg-amber-200 text-amber-900 border-amber-300' : 'bg-slate-200 text-slate-600 border-slate-300'
            }`}
          >
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
              onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
          </div>
        )}
      </div>

      {/* ── MÜŞTERİ KOTA BİLGİ KARTI ── */}
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
            {customerQuotas.map((q) => {
              const isExceeded = q.pct >= 100;
              const isApproaching = q.pct >= (q.alert_threshold_pct || 85) && !isExceeded;

              return (
                <div
                  key={q.id}
                  className="bg-white/90 rounded-lg p-2.5 border border-amber-100/80 shadow-xs space-y-1 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                      <span>{q.products?.name ? `${q.products.name} (${q.products.thickness})` : 'Tüm Ürünler (Genel)'}</span>
                      {q.sites?.name && <span className="text-slate-500 font-normal">• {q.sites.name}</span>}
                      {q.unit_price && q.unit_price > 0 && (
                        <span className="text-emerald-800 bg-emerald-100 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-emerald-300">
                          🏷️ {Number(q.unit_price).toLocaleString('tr-TR')} ₺/{q.unit}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-bold text-[11px] px-2 py-0.5 rounded-full ${
                          isExceeded
                            ? 'bg-red-100 text-red-800 font-black'
                            : isApproaching
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        %{q.pct} {isExceeded ? 'Doldu / Aşıldı' : isApproaching ? 'Yaklaştı' : 'Normal'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>
                      Sevk Edilen: <strong>{q.shipped.toLocaleString('tr-TR')} {q.unit}</strong> / {q.target_quantity.toLocaleString('tr-TR')} {q.unit}
                    </span>
                    <span className={q.remaining < 0 ? 'text-red-600 font-bold' : 'text-slate-700 font-medium'}>
                      {q.remaining >= 0
                        ? `Kalan: ${q.remaining.toLocaleString('tr-TR')} ${q.unit}`
                        : `+${Math.abs(q.remaining).toLocaleString('tr-TR')} ${q.unit} Kota Aşıldı`}
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

      {/* ── ARAÇ PLAKASI (HAFIZALI), ŞOFÖR ADI & TELEFONU ── */}
      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Truck size={15} className="text-blue-600" />
            <span>Araç & Şoför Bilgileri</span>
          </label>
          {matchedVehicle && (
            <span className="text-[10px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full font-bold border border-blue-200">
              💡 Kayıtlı Araç: {matchedVehicle.driver_name || 'Şoför'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Araç Plaka *</label>
            <input
              type="text"
              list="vehicle-plate-options"
              value={form.vehicle_plate}
              onChange={(e) => handlePlateChange(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 uppercase bg-white"
              placeholder="34 ABC 123"
              required
            />
            {/* Datalist for Plate Auto-Suggestion */}
            <datalist id="vehicle-plate-options">
              {(vehicleMemoryList || []).map((vm) => (
                <option key={vm.plate} value={vm.plate}>
                  {vm.driver_name ? `${vm.driver_name} ${vm.tare_weight > 0 ? `(Dara: ${vm.tare_weight} kg)` : ''}` : ''}
                </option>
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Şoför Adı</label>
            <input
              type="text"
              value={form.driver_name}
              onChange={(e) => setForm((f) => ({ ...f, driver_name: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-sm"
              placeholder="Ahmet Yılmaz"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Şoför Telefon</label>
            <div className="relative">
              <Phone size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={form.driver_phone}
                onChange={(e) => setForm((f) => ({ ...f, driver_phone: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white font-mono text-sm"
                placeholder="0532 000 00 00"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── KANTAR TARTIM BİLGİLERİ ── */}
      <div className="border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Kantar Bilgileri</h3>
          {matchedVehicle && matchedVehicle.tare_weight > 0 && form.tare_weight !== matchedVehicle.tare_weight && (
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, tare_weight: matchedVehicle.tare_weight }))}
              className="text-[11px] text-blue-600 hover:text-blue-800 font-bold underline cursor-pointer"
            >
              Son Darayı Doldur ({matchedVehicle.tare_weight.toLocaleString('tr-TR')} kg)
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Brüt Ağırlık (kg)', key: 'gross_weight' },
            { label: 'Dara (kg)', key: 'tare_weight' },
          ].map(({ label, key }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form[key as keyof ShipmentFormData] as number}
                onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm font-mono font-bold"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Net Ağırlık (kg)</label>
            <div className="w-full border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-sm font-black font-mono text-blue-900">
              {netWeight.toLocaleString('tr-TR')}
              <span className="text-xs font-normal text-slate-500 ml-1">({(netWeight / 1000).toFixed(2)} t)</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── YÜKLENEN ÜRÜNLER (ÇİFT YÖNLÜ PALET & AKILLI FİYAT) ── */}
      <div className="border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Yüklenen Ürünler</h3>
            <p className="text-[11px] text-slate-500">
              Palet girildiğinde standart m²/metre otomatik hesaplanır. Farklı sıra/adet yüklemelerinde miktar elle değiştirildiğinde <span className="font-semibold text-blue-700">palet sayısı sabit kalır</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={addItem}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-semibold cursor-pointer"
          >
            <Plus size={14} /> Kalem Ekle
          </button>
        </div>
        <div className="space-y-3">
          {form.items.map((item, idx) => {
            const stock = item.product_id ? stockMap[item.product_id] ?? 0 : null;
            const unitLabel = item.unit === 'm2' ? 'm²' : item.unit === 'adet' ? 'Adet' : item.unit === 'metre' ? 'Metre' : item.unit;
            const stockExceeded = !form.is_external && stock !== null && item.m2 > 0 && item.unit === 'm2' && item.m2 > stock;
            const sp = resolveSmartPriceForItem(item.product_id);
            const isOverridden = item.is_custom_price && item.unit_price !== sp.price;
            const lineTotal = (Number(item.m2) || 0) * (Number(item.unit_price) || 0);

            return (
              <div key={idx} className="bg-slate-50/70 border border-slate-200/90 rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Ürün</label>
                    <select
                      value={item.product_id}
                      onChange={(e) => setItem(idx, 'product_id', e.target.value)}
                      className="w-full border border-slate-200 bg-white rounded-lg px-2.5 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium"
                    >
                      <option value="">Ürün Seçiniz...</option>
                      {products.map((p) => {
                        const s = stockMap[p.id] ?? 0;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.thickness}/{p.color})
                            {form.is_external
                              ? ' — Transit Sevk'
                              : s <= 0
                              ? ' — Stok yok'
                              : ` — ${s.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="col-span-3 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Palet</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={item.pallets}
                      onChange={(e) => setItem(idx, 'pallets', Number(e.target.value))}
                      disabled={item.pallet_type === 'dokme'}
                      className="w-full border border-slate-200 bg-white rounded-lg px-2 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-slate-100 disabled:text-slate-400 text-center font-semibold"
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Palet Tipi</label>
                    <select
                      value={item.pallet_type}
                      onChange={(e) => setItem(idx, 'pallet_type', e.target.value as any)}
                      className="w-full border border-slate-200 bg-white rounded-lg px-2 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="sevkiyat">Sevkiyat Paleti</option>
                      <option value="tahta">Tahta Palet</option>
                      <option value="uretim">Üretim Paleti</option>
                      <option value="dokme">Dökme (Paletsiz)</option>
                    </select>
                  </div>
                  <div className="col-span-4 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Birim</label>
                    <select
                      value={item.unit}
                      onChange={(e) => setItem(idx, 'unit', e.target.value)}
                      className="w-full border border-slate-200 bg-white rounded-lg px-1.5 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 font-semibold text-center"
                    >
                      <option value="m2">m²</option>
                      <option value="adet">Adet</option>
                      <option value="metre">Metre</option>
                    </select>
                  </div>
                  <div className="col-span-5 sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Miktar ({unitLabel})</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.m2}
                      onChange={(e) => setItem(idx, 'm2', Number(e.target.value))}
                      className={`w-full border rounded-lg px-2.5 py-2 text-xs sm:text-sm font-bold font-mono focus:outline-none focus:ring-2 ${
                        stockExceeded
                          ? 'border-red-400 focus:ring-red-400 bg-red-50 text-red-700'
                          : 'border-slate-200 bg-white focus:ring-blue-400'
                      }`}
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Birim Fiyat (₺/{unitLabel})
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => setItem(idx, 'unit_price', Number(e.target.value))}
                        placeholder="0.00"
                        className={`w-full border rounded-lg px-2.5 py-2 text-xs sm:text-sm font-bold font-mono focus:outline-none focus:ring-2 bg-white ${
                          isOverridden
                            ? 'border-amber-300 focus:ring-amber-400 text-amber-900'
                            : sp.source === 'quota'
                            ? 'border-emerald-300 focus:ring-emerald-400 text-emerald-900'
                            : sp.source === 'product_list'
                            ? 'border-blue-300 focus:ring-blue-400 text-blue-900'
                            : sp.source === 'last_shipment'
                            ? 'border-purple-300 focus:ring-purple-400 text-purple-900'
                            : 'border-slate-200 focus:ring-blue-400'
                        }`}
                      />
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-center pb-1">
                    {form.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Kalemi Sil"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Row Sub-bar: Badges, Satır Tutarı & Stock Info */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Smart Price Badge */}
                    {isOverridden ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                        <span>✏️</span> Özel Fiyat ({item.unit_price} ₺)
                      </span>
                    ) : sp.source === 'quota' ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300"
                        title={sp.detail}
                      >
                        <span>🏷️</span> Sözleşme / Kota Fiyatı ({sp.price} ₺)
                      </span>
                    ) : sp.source === 'product_list' ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-900 border border-blue-300"
                        title={sp.detail}
                      >
                        <span>📋</span> Fabrika Liste Fiyatı ({sp.price} ₺)
                      </span>
                    ) : sp.source === 'last_shipment' ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-900 border border-purple-300"
                        title={sp.detail}
                      >
                        <span>⏱️</span> Son Sevk Fiyatı ({sp.price} ₺)
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">Fiyat tanımsız</span>
                    )}

                    {/* Revert button if overridden */}
                    {isOverridden && sp.price > 0 && (
                      <button
                        type="button"
                        onClick={() => revertItemPrice(idx)}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-800 underline flex items-center gap-1 cursor-pointer"
                        title="Önerilen akıllı fiyata dön"
                      >
                        <RotateCcw size={11} /> Önerilen {sp.price} ₺ Yap
                      </button>
                    )}

                    {/* Stock info or Transit Badge */}
                    {form.is_external ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                        <span>🚚</span>
                        <span>Transit Sevk: <strong>{form.supplier_name.trim() || 'Dış Tedarikçi'}</strong> (Fabrika stoğundan düşmez)</span>
                        {stock !== null && (
                          <span className="text-amber-800/70 font-normal ml-1 hidden sm:inline">
                            • Fabrika: {stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
                          </span>
                        )}
                      </span>
                    ) : (
                      stock !== null && item.product_id && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            stockExceeded ? 'text-red-600 font-bold' : 'text-slate-500'
                          }`}
                        >
                          {stockExceeded ? <PackageX size={12} /> : null}
                          {stockExceeded
                            ? `⚠️ Stok aşıldı! (Mevcut: ${stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²)`
                            : `• Stok: ${stock.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`}
                        </span>
                      )
                    )}

                    {/* Özel Sıra / Palet İçi Yükleme Bilgisi */}
                    {(() => {
                      const prod = products.find((p) => p.id === item.product_id);
                      if (!prod || !prod.m2_per_pallet || !item.pallets || item.pallets <= 0 || item.pallet_type === 'dokme') return null;
                      const standardM2 = Math.round(item.pallets * prod.m2_per_pallet * 100) / 100;
                      const isCustomRow = Math.abs(item.m2 - standardM2) > 0.05;
                      if (!isCustomRow) return null;

                      const perPalletActual = (Number(item.m2) / item.pallets).toFixed(2);
                      return (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-900 border border-amber-200">
                          <span>📦</span>
                          <span>Özel Yükleme: <strong>{perPalletActual} {unitLabel}/Palet</strong></span>
                          <span className="text-amber-600 font-normal hidden sm:inline">(Standart: {prod.m2_per_pallet})</span>
                          <button
                            type="button"
                            onClick={() => setItem(idx, 'm2', standardM2)}
                            className="ml-1 text-[10px] text-blue-700 hover:text-blue-900 font-bold underline cursor-pointer"
                            title="Standart palet katsayısına dön"
                          >
                            Standarda Dön ({standardM2} {unitLabel})
                          </button>
                        </span>
                      );
                    })()}
                  </div>

                  {/* Line item total */}
                  <div className="font-mono text-xs font-semibold text-slate-700 bg-white px-2.5 py-0.5 rounded-lg border border-slate-200 shadow-2xs">
                    <span className="text-slate-400 font-normal mr-1.5">Satır Tutarı:</span>
                    <strong className="text-blue-700 text-sm">
                      ₺{lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            Toplam <strong className="text-slate-800">{form.items.length}</strong> kalem ürün
          </div>
          <div className="text-sm font-bold text-blue-800 font-mono">
            Toplam Sevk Miktarı: {totalM2.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* ── SEVKİYAT FİNANSMANI & LOJİSTİK ── */}
      <div className="bg-gradient-to-r from-slate-50 to-blue-50/50 border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span>💰</span> Sevkiyat Finansmanı & Lojistik
          </span>
          <span className="text-[11px] text-slate-500">
            Tüm ürün kalemlerinin fiyatları baz alınarak anlık hesaplanır
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-500 block mb-0.5">Toplam Ürün Tutarı (Ciro)</span>
            <div className="text-lg font-black text-blue-700 font-mono">
              ₺{totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Ort. {totalM2 > 0 ? (totalRevenue / totalM2).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : 0} ₺ / birim
            </p>
          </div>

          <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-2xs">
            <label className="text-[11px] font-semibold text-slate-700 block mb-1">Lojistik / Nakliye Gideri (₺)</label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.logistics_cost}
                onChange={(e) => setForm((f) => ({ ...f, logistics_cost: Number(e.target.value) }))}
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                placeholder="0.00"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                ₺
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Araç sefer maliyeti</p>
          </div>

          <div className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-500 block mb-0.5">Net Gelir (Ciro - Lojistik)</span>
            <div className={`text-lg font-black font-mono ${netRevenue >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              ₺{netRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">Tahmini net kazanç</p>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notlar</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          rows={2}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Yetersiz Stok Uyarısı ve Buton Kilidi */}
      {(() => {
        const isTransit = Boolean(form.is_external && form.supplier_name.trim());
        const insufficientItem = !isTransit
          ? form.items.find((item) => {
              if (!item.product_id) return false;
              const available = stockMap[item.product_id] ?? 0;
              return (Number(item.m2) || 0) > available;
            })
          : null;

        if (!insufficientItem) return null;

        const p = products.find((x) => x.id === insufficientItem.product_id);
        const avail = stockMap[insufficientItem.product_id] ?? 0;
        const u = insufficientItem.unit === 'metre' ? 'Metre' : insufficientItem.unit === 'adet' ? 'Adet' : 'm²';

        return (
          <div className="p-3.5 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-2.5 text-xs text-red-900 font-medium">
            <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <strong className="text-red-950 block font-bold text-sm mb-0.5">🚫 Yetersiz Stok Nedeniyle Kayıt Kilitlendi:</strong>
              "{p?.name ?? 'Seçili Ürün'}" için depodaki mevcut hazır stok <strong>{avail.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {u}</strong> olup, çıkılmak istenen miktar <strong>{Number(insufficientItem.m2) || 0} {u}</strong> seviyesindedir. Depo stoğunun eksiye düşmemesi için sevkiyat işlemi engellenmiştir.
              <span className="block mt-1 text-[11px] text-red-700">Lütfen miktarı düşürünüz veya önce <strong>"Günlük Üretim Girişi"</strong> yapınız.</span>
            </div>
          </div>
        );
      })()}

      {(() => {
        const isTransit = Boolean(form.is_external && form.supplier_name.trim());
        const hasInsufficientStock = !isTransit && form.items.some((item) => {
          if (!item.product_id) return false;
          const available = stockMap[item.product_id] ?? 0;
          return (Number(item.m2) || 0) > available;
        });

        return (
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm cursor-pointer"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving || hasInsufficientStock}
              className={`px-6 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2 shadow-sm ${
                hasInsufficientStock
                  ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed opacity-70'
                  : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
              }`}
              title={hasInsufficientStock ? 'Depoda yeterli stok olmadığı için sevkiyat kaydedilemez' : undefined}
            >
              {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {hasInsufficientStock ? '🚫 Yetersiz Stok (Kayıt Engellendi)' : initial ? 'Güncelle' : 'Sevkiyatı Kaydet'}
            </button>
          </div>
        );
      })()}
    </form>

    {/* ── HIZLI YENİ ŞANTİYE EKLEME MODALI ── */}
    {showQuickSiteModal && (
      <Modal
        title={`Yeni Şantiye Ekle — ${customers.find((c) => c.id === form.customer_id)?.name || 'Müşteri'}`}
        onClose={() => {
          setShowQuickSiteModal(false);
          setNewSiteName('');
        }}
        size="sm"
      >
        <form onSubmit={handleQuickAddSite} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Şantiye Adı / Proje Tanımı <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newSiteName}
              onChange={(e) => setNewSiteName(e.target.value)}
              placeholder="Örn: Hastane Şantiyesi, TOKİ 2. Etap..."
              className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              required
              autoFocus
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Eklenen şantiye otomatik olarak seçilecek ve bu müşterinin şantiye listesine kaydedilecektir.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setShowQuickSiteModal(false);
                setNewSiteName('');
              }}
              className="px-3.5 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={addingSite || !newSiteName.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
            >
              {addingSite ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Kaydediliyor...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Şantiyeyi Kaydet</span>
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
    )}
  </>
  );
}

// ── SHIPMENT DETAIL MODAL ──
function ShipmentDetail({
  shipment,
  onPrintSlip,
  onClose,
}: {
  shipment: Shipment;
  onPrintSlip: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from('shipment_items')
      .select('*, products(*)')
      .eq('shipment_id', shipment.id)
      .then(({ data }) => setItems(data || []));
  }, [shipment.id]);

  const notesPrices = parseItemPricesFromNotes(shipment.notes);
  let localSavedPrices: Record<string, number> = {};
  try {
    const allSaved = JSON.parse(localStorage.getItem('parke_shipment_item_prices') || '{}');
    localSavedPrices = allSaved[shipment.id] || {};
  } catch {}

  const getItemUnitPrice = (it: any) => {
    if (it.unit_price && Number(it.unit_price) > 0) return Number(it.unit_price);
    if (notesPrices[it.product_id]) return notesPrices[it.product_id];
    if (localSavedPrices[it.product_id]) return localSavedPrices[it.product_id];
    return Number(shipment.sale_price_per_m2) || 0;
  };

  const calculatedItemsTotal = items.reduce((sum, it) => {
    const p = getItemUnitPrice(it);
    return sum + p * (Number(it.m2) || 0);
  }, 0);

  const totalRevenue = calculatedItemsTotal > 0 ? calculatedItemsTotal : shipment.sale_price_per_m2 * (shipment.total_m2 || 0);
  const logisticsCost = Number(shipment.logistics_cost) || 0;
  const netRevenue = totalRevenue - logisticsCost;

  const qInfo = getShipmentDisplayQuantity({ ...shipment, shipment_items: items });
  const supInfo = getSupplierInfo(shipment);

  return (
    <div className="space-y-4">
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
        <div>
          <span className="text-slate-500">İrsaliye No:</span> <span className="font-bold text-slate-900">{shipment.invoice_no}</span>
        </div>
        <div>
          <span className="text-slate-500">Tarih:</span>{' '}
          <span className="font-medium">{new Date(shipment.shipment_date).toLocaleDateString('tr-TR')}</span>
        </div>
        <div>
          <span className="text-slate-500">Müşteri:</span> <span className="font-bold text-slate-900">{shipment.customers?.name}</span>
        </div>
        <div>
          <span className="text-slate-500">Şantiye:</span> <span className="font-medium">{shipment.sites?.name || '-'}</span>
        </div>
        <div>
          <span className="text-slate-500">Araç:</span> <span className="font-mono font-semibold text-slate-800">{shipment.vehicle_plate}</span>
        </div>
        <div>
          <span className="text-slate-500">Şoför:</span>{' '}
          <span className="font-medium">
            {shipment.driver_name || '-'} {shipment.driver_phone ? `(${shipment.driver_phone})` : ''}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Brüt / Dara / Net:</span>{' '}
          <span className="font-medium">
            {shipment.gross_weight} / {shipment.tare_weight} / {shipment.net_weight} kg
          </span>
        </div>
        <div>
          <span className="text-slate-500">Toplam Miktar:</span> <span className="font-bold text-blue-700">{qInfo.displayText}</span>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Ürün</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Palet</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Miktar</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Birim Fiyat</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Satır Tutarı</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const prodUnit = item.products?.unit;
              const effectiveUnit =
                prodUnit === 'metre' || item.unit === 'metre'
                  ? 'Metre'
                  : prodUnit === 'adet' || item.unit === 'adet'
                  ? 'Adet'
                  : 'm²';
              const price = getItemUnitPrice(item);
              const lineTotal = price * (Number(item.m2) || 0);

              return (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {item.products?.name} ({item.products?.thickness}/{item.products?.color})
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs">
                    {item.pallet_type === 'dokme' ? 'Dökme' : `${item.pallets} ${PALLET_LABELS[item.pallet_type] || 'Sevkiyat'}`}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">
                    {item.m2} {effectiveUnit}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium text-slate-700">
                    {price > 0 ? `₺${price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-blue-700">
                    {lineTotal > 0 ? `₺${lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-4 text-sm grid grid-cols-3 gap-4">
        <div>
          <p className="text-slate-500 text-xs font-medium">Toplam Ürün Bedeli (Ciro)</p>
          <p className="font-black text-blue-700 text-base font-mono">
            ₺{totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-slate-500 text-xs font-medium">Lojistik Gideri</p>
          <p className="font-bold text-slate-900 text-base font-mono">
            ₺{logisticsCost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div>
          <p className="text-slate-500 text-xs font-medium">Net Gelir</p>
          <p className={`font-black text-base font-mono ${netRevenue >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            ₺{netRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {shipment.notes && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 space-y-1">
          <span className="font-bold text-slate-900 block">Sevkiyat Notu / Açıklama:</span>
          <p className="whitespace-pre-wrap font-medium text-slate-800">{shipment.notes}</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onPrintSlip}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
        >
          <Printer size={15} />
          <span>Kantar / Sevk Fişini Yazdır</span>
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
        >
          Kapat
        </button>
      </div>
    </div>
  );
}

// ── MAIN SHIPMENT PAGE COMPONENT ──
export default function ShipmentPage() {
  const { isAdmin, isSuperAdmin, profile } = useAuth();

  // Multi-Tenant Isolation & Super Admin Company Switching (Senkronize Matris & Rapor Seçimi)
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    return localStorage.getItem('parke_matrix_selected_company') || '';
  });

  // Fetch all companies if Super Admin to enable tenant switching
  useEffect(() => {
    if (isSuperAdmin()) {
      supabase
        .from('companies')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setCompanies(data);
            if (!selectedCompanyId) {
              const defaultId = profile?.company_id || data[0].id;
              setSelectedCompanyId(defaultId);
            }
          }
        });
    }
  }, [profile?.is_super_admin, profile?.company_id]);

  // Target Company ID: strictly isolates queries by company
  const targetCompanyId = useMemo(() => {
    if (isSuperAdmin()) {
      return selectedCompanyId || profile?.company_id || (companies[0]?.id ?? null);
    }
    return profile?.company_id || null;
  }, [isSuperAdmin, selectedCompanyId, profile?.company_id, companies]);

  const activeCompanyName = useMemo(() => {
    if (isSuperAdmin() && companies.length > 0) {
      const found = companies.find((c) => c.id === targetCompanyId);
      if (found) return found.name;
    }
    return profile?.company?.name || 'Parke ERP';
  }, [isSuperAdmin, companies, targetCompanyId, profile?.company?.name]);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showModal, setShowModal] = useState(false);
  const [detailShipment, setDetailShipment] = useState<Shipment | undefined>();
  const [editShipment, setEditShipment] = useState<Shipment | undefined>();
  const [printSlipShipment, setPrintSlipShipment] = useState<Shipment | undefined>();
  const [savedSuccessShipment, setSavedSuccessShipment] = useState<Shipment | null>(null);
  const [showQuickPalletModal, setShowQuickPalletModal] = useState(false);
  const [quickPalletInitialCustomer, setQuickPalletInitialCustomer] = useState<string | undefined>();
  const [quickPalletInitialSite, setQuickPalletInitialSite] = useState<string | undefined>();
  const [palletReturnSuccessToast, setPalletReturnSuccessToast] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');

  // Scroll to Top & Table Scrolling State
  const [showScrollTop, setShowScrollTop] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const handleTableScroll = () => {
    if (tableContainerRef.current) {
      setShowScrollTop(tableContainerRef.current.scrollTop > 150);
    }
  };

  const scrollToTop = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const handleWinScroll = () => {
      if (window.scrollY > 250) {
        setShowScrollTop(true);
      } else if (tableContainerRef.current && tableContainerRef.current.scrollTop <= 150) {
        setShowScrollTop(false);
      }
    };
    window.addEventListener('scroll', handleWinScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWinScroll);
  }, []);

  const load = async () => {
    setLoading(true);
    let shipList: Shipment[] = [];
    try {
      const isDefaultCompany =
        !targetCompanyId ||
        targetCompanyId === companies[0]?.id ||
        targetCompanyId === profile?.company_id;

      let custQuery = supabase.from('customers').select('*').eq('is_active', true).order('name');
      let prodQuery = supabase.from('products').select('*').eq('is_active', true).order('name');
      let shipQuery = supabase
        .from('shipments')
        .select('*, customers(*), sites(*), shipment_items(*, products(*)), external_purchases(*)')
        .order('shipment_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (targetCompanyId) {
        if (isDefaultCompany) {
          custQuery = custQuery.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
          prodQuery = prodQuery.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
          shipQuery = shipQuery.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
        } else {
          custQuery = custQuery.eq('company_id', targetCompanyId);
          prodQuery = prodQuery.eq('company_id', targetCompanyId);
          shipQuery = shipQuery.eq('company_id', targetCompanyId);
        }
      }

      const [custRes, prodRes, shipRes] = await Promise.all([
        custQuery,
        prodQuery,
        shipQuery,
      ]);
      setCustomers(custRes.data || []);
      const localPrices = (() => {
        try {
          return JSON.parse(localStorage.getItem('parke_product_list_prices') || '{}');
        } catch {
          return {};
        }
      })();
      const enrichedProducts = (prodRes.data || []).map((p: any) => ({
        ...p,
        unit_price:
          p.unit_price !== undefined && p.unit_price !== null && Number(p.unit_price) > 0
            ? Number(p.unit_price)
            : Number(localPrices[p.id]) || 0,
      }));
      setProducts(enrichedProducts);

      if (shipRes.error) {
        let fallbackQuery = supabase
          .from('shipments')
          .select('*, customers(*), sites(*), shipment_items(*, products(*))')
          .order('shipment_date', { ascending: false })
          .order('created_at', { ascending: false });
        if (targetCompanyId) {
          if (isDefaultCompany) {
            fallbackQuery = fallbackQuery.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
          } else {
            fallbackQuery = fallbackQuery.eq('company_id', targetCompanyId);
          }
        }
        const fallbackRes = await fallbackQuery;
        shipList = (fallbackRes.data || []) as Shipment[];
      } else {
        shipList = (shipRes.data || []) as Shipment[];
      }

      // Air-tight multi-tenant isolation: exclude any record whose customer or company belongs to another tenant
      if (targetCompanyId) {
        shipList = shipList.filter((s: any) => {
          if (s.company_id && s.company_id !== targetCompanyId) return false;
          if (s.customers?.company_id && s.customers.company_id !== targetCompanyId) return false;
          if (!s.company_id && !s.customers?.company_id && !isDefaultCompany) return false;
          return true;
        });
      }

      // Auto-backfill unassigned shipments in background so company_id stays permanently populated
      if (isSuperAdmin() && shipList.length > 0) {
        const unassigned = shipList.filter((s: any) => !s.company_id);
        if (unassigned.length > 0) {
          const defaultCompId = profile?.company_id || companies[0]?.id;
          unassigned.slice(0, 100).forEach((s: any) => {
            const compId = s.customers?.company_id || defaultCompId;
            if (compId) {
              supabase.from('shipments').update({ company_id: compId }).eq('id', s.id).then();
            }
          });
        }
      }
    } catch (err) {
      console.error('Sevkiyat verisi yüklenirken hata:', err);
    }
    setShipments(shipList);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [targetCompanyId]);

  // Predicted Next Waybill Number
  const predictedInvoiceNo = useMemo(() => predictNextInvoiceNo(shipments), [shipments]);

  // Vehicle Memory (Plate, Driver Name, Phone, Tare Weight)
  const vehicleMemoryList = useMemo(() => {
    const map: Record<string, VehicleMemory> = {};
    for (const s of shipments) {
      const pl = (s.vehicle_plate || '').trim().toUpperCase();
      if (!pl) continue;
      if (!map[pl] || (s.shipment_date && s.shipment_date > map[pl].last_used_date)) {
        map[pl] = {
          plate: pl,
          driver_name: s.driver_name || '',
          driver_phone: s.driver_phone || '',
          tare_weight: Number(s.tare_weight) || 0,
          last_used_date: s.shipment_date || '',
        };
      }
    }
    return Object.values(map);
  }, [shipments]);

  const handleDelete = async (s: Shipment) => {
    if (!confirm(`"${s.invoice_no}" numaralı sevkiyatı silmek istediğinize emin misiniz?\nBu işlem geri alınamaz.`))
      return;
    setDeleting(s.id);
    await supabase.from('pallet_transactions').delete().eq('shipment_id', s.id);
    await supabase.from('shipment_items').delete().eq('shipment_id', s.id);
    await supabase.from('shipments').delete().eq('id', s.id);
    setDeleting(null);
    load();
  };

  const handleSaveSuccess = (savedShipment: Shipment) => {
    setShowModal(false);
    setEditShipment(undefined);
    load();
    setSavedSuccessShipment(savedShipment);
  };

  const handlePalletReturnSuccess = (info: { customerName: string; quantity: number; palletType: string }) => {
    setShowQuickPalletModal(false);
    setPalletReturnSuccessToast(
      `✅ ${info.quantity} Adet ${info.palletType} (${info.customerName}) başarıyla iade alındı ve zimmetten düşüldü!`
    );
    setTimeout(() => setPalletReturnSuccessToast(null), 6000);
  };

  const filtered = shipments.filter((s) => {
    const q = search.toLowerCase();
    const sup = getSupplierInfo(s);
    const match =
      !search ||
      s.invoice_no.toLowerCase().includes(q) ||
      s.customers?.name?.toLowerCase().includes(q) ||
      s.vehicle_plate.toLowerCase().includes(q) ||
      (s.driver_name && s.driver_name.toLowerCase().includes(q)) ||
      (sup.isExternal && sup.supplierName.toLowerCase().includes(q)) ||
      (s.notes && s.notes.toLowerCase().includes(q)) ||
      (s.shipment_items && s.shipment_items.some((it: any) => it.products?.name?.toLowerCase().includes(q)));
    const dateMatch = !filterDate || s.shipment_date === filterDate;
    return match && dateMatch;
  });

  let totalTonnage = 0;
  let totalM2 = 0;
  let totalMetre = 0;
  let totalAdet = 0;

  filtered.forEach((s) => {
    totalTonnage += Number(s.net_weight) || 0;
    const qInfo = getShipmentDisplayQuantity(s);
    totalM2 += qInfo.m2;
    totalMetre += qInfo.metre;
    totalAdet += qInfo.adet;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ── TOP HEADER & ACTIONS ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <Truck size={26} className="text-blue-600" /> Sevkiyat & Kantar Şefliği
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-bold bg-slate-100 text-slate-700 rounded-full border border-slate-200 flex items-center gap-1.5 shadow-2xs">
              <Building2 size={13} className="text-slate-500" />
              {activeCompanyName}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-0.5">
            Otomatik akıllı fiyatlandırma, plaka hafızası, kantar tartımı ve anlık sevk fişi çıktısı
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Super Admin Firma Değiştirme Seçici */}
          {isSuperAdmin() && companies.length > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 rounded-xl px-2.5 py-1 shadow-2xs">
              <Building2 size={15} className="text-amber-700 shrink-0" />
              <span className="text-[11px] font-bold text-amber-900 shrink-0">Firma:</span>
              <select
                value={targetCompanyId || ''}
                onChange={(e) => {
                  const newId = e.target.value;
                  setSelectedCompanyId(newId);
                  localStorage.setItem('parke_matrix_selected_company', newId);
                }}
                className="text-xs font-bold text-slate-800 bg-white border border-amber-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setQuickPalletInitialCustomer(undefined);
              setQuickPalletInitialSite(undefined);
              setShowQuickPalletModal(true);
            }}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-sm cursor-pointer"
          >
            <Boxes size={18} />
            <span>🔄 Boş Palet İadesi Al</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditShipment(undefined);
              setShowModal(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-md shadow-blue-500/20 cursor-pointer"
          >
            <Plus size={18} />
            <span>Yeni Sevkiyat Girişi</span>
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {palletReturnSuccessToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-xs font-bold flex items-center justify-between animate-in fade-in duration-200">
          <span>{palletReturnSuccessToast}</span>
          <button type="button" onClick={() => setPalletReturnSuccessToast(null)} className="text-emerald-500 hover:text-emerald-700">
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── METRIC CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-slate-100">
          <span className="text-xs text-slate-500 font-semibold block mb-1">Toplam Net Ağırlık</span>
          <p className="text-xl sm:text-2xl font-black text-blue-700 font-mono">
            {(totalTonnage / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}{' '}
            <span className="text-sm font-semibold text-slate-500">Ton</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-1">{totalTonnage.toLocaleString('tr-TR')} kg kantar tartımı</p>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-slate-100">
          <span className="text-xs text-slate-500 font-semibold block mb-1">Toplam Sevk (m² Parke)</span>
          <p className="text-xl sm:text-2xl font-black text-slate-900 font-mono">
            {totalM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}{' '}
            <span className="text-sm font-semibold text-slate-500">m²</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Standart parke taşları</p>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-slate-100">
          <span className="text-xs text-slate-500 font-semibold block mb-1">Toplam Sevk (Metre Bordür)</span>
          <p className="text-xl sm:text-2xl font-black text-amber-700 font-mono">
            {totalMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}{' '}
            <span className="text-sm font-semibold text-slate-500">Metre</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Yol ve bahçe bordürleri</p>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs border border-slate-100">
          <span className="text-xs text-slate-500 font-semibold block mb-1">Toplam Sefer Sayısı</span>
          <p className="text-xl sm:text-2xl font-black text-slate-800 font-mono">{filtered.length} Sefer</p>
          <p className="text-[11px] text-slate-400 mt-1">Düzenlenen irsaliye adedi</p>
        </div>
      </div>

      {/* ── SHIPMENTS TABLE & SEARCH ── */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-100 overflow-hidden relative">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex-1 relative w-full sm:w-auto">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="İrsaliye no, müşteri, şantiye, plaka veya şoför ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between flex-wrap">
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1.5 rounded-xl border border-slate-200">
              {filtered.length} İrsaliye
            </span>
            <div className="flex items-center gap-1.5">
              <Filter size={15} className="text-slate-400" />
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            </div>
            {filterDate && (
              <button
                type="button"
                onClick={() => setFilterDate('')}
                className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-lg border border-red-200 text-xs transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                title="Tarih filtresini kaldır ve tüm irsaliyeleri göster"
              >
                <span>✕</span>
                <span>Filtreyi Temizle</span>
              </button>
            )}
            {showScrollTop && (
              <button
                type="button"
                onClick={scrollToTop}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-all border border-blue-200 shadow-2xs cursor-pointer animate-in fade-in"
                title="Tablonun en başına çık"
              >
                <ArrowUp size={13} />
                <span className="hidden sm:inline">Yukarı Çık</span>
              </button>
            )}
          </div>
        </div>

        {/* ── ACTIVE FILTER NOTICE BANNER ── */}
        {(filterDate || search) && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 animate-in fade-in">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold flex items-center gap-1 text-amber-800">
                <span>⚠️</span> Filtre Aktif:
              </span>
              {filterDate && (
                <span className="bg-white/80 px-2 py-0.5 rounded border border-amber-300 font-medium">
                  Tarih: <strong className="font-bold text-amber-950">{filterDate.split('-').reverse().join('.')}</strong>
                </span>
              )}
              {search && (
                <span className="bg-white/80 px-2 py-0.5 rounded border border-amber-300 font-medium">
                  Arama: <strong className="font-bold text-amber-950">"{search}"</strong>
                </span>
              )}
              <span className="text-amber-700 text-[11px]">
                ({filtered.length} irsaliye listeleniyor — diğer tarihlerdeki irsaliyeler gizlendi)
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setFilterDate('');
                setSearch('');
              }}
              className="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold rounded-lg text-xs transition-colors cursor-pointer border border-amber-300 shadow-2xs"
            >
              Filtreleri Sıfırla (Tüm İrsaliyeleri Göster)
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div
              ref={tableContainerRef}
              onScroll={handleTableScroll}
              className="overflow-x-auto overflow-y-auto max-h-[620px] custom-scrollbar border-b border-slate-100 relative"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#94a3b8 #f1f5f9',
              }}
            >
            <table className="w-full text-xs text-left border-collapse relative">
              <thead className="sticky top-0 z-20 shadow-xs">
                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                  <th className="px-3.5 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">İrsaliye</th>
                  <th className="px-3 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Tarih</th>
                  <th className="px-3.5 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Müşteri / Şantiye</th>
                  <th className="px-3 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Araç / Sürücü</th>
                  <th className="px-3 py-3 text-right sticky top-0 bg-slate-100/95 backdrop-blur-xs">Net Tonaj</th>
                  <th className="px-3.5 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Sevk Edilen Ürünler</th>
                  <th className="px-3 py-3 text-right sticky top-0 bg-slate-100/95 backdrop-blur-xs">Birim Fiyat</th>
                  <th className="px-3 py-3 text-center sticky top-0 bg-slate-100/95 backdrop-blur-xs">Durum</th>
                  <th className="px-3 py-3 text-center w-28 sticky top-0 bg-slate-100/95 backdrop-blur-xs">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-slate-400">
                      Sevkiyat kaydı bulunamadı.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => {
                    const qInfo = getShipmentDisplayQuantity(s);
                    const sup = getSupplierInfo(s);

                    return (
                      <tr
                        key={s.id}
                        className={`transition-colors ${
                          sup.isExternal ? 'bg-amber-50/20 hover:bg-amber-50/40' : 'hover:bg-blue-50/20'
                        }`}
                      >
                        <td className="px-3.5 py-3 font-mono">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900">{s.invoice_no}</span>
                            {sup.isExternal && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs"
                                title={`Doğrudan Transit Sevk (Tedarikçi: ${sup.supplierName})`}
                              >
                                <ShoppingBag size={10} className="text-amber-700" /> Transit
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">
                          {new Date(s.shipment_date).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="font-bold text-slate-900">{s.customers?.name || '-'}</div>
                          {s.sites?.name && <div className="text-[11px] text-slate-500 font-medium">🏗️ {s.sites.name}</div>}
                          {sup.isExternal && (
                            <div className="text-[10px] font-semibold text-amber-800 mt-0.5">
                              Tedarikçi: <span className="font-bold text-amber-950">{sup.supplierName}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 block w-fit">
                            {s.vehicle_plate}
                          </span>
                          {s.driver_name && <span className="text-[11px] text-slate-500 block mt-0.5">{s.driver_name}</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-slate-800">
                          {(s.net_weight / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} t
                        </td>
                        <td className="px-3.5 py-3 font-semibold font-mono">
                          <div className="flex flex-wrap items-center gap-1">
                            {qInfo.badges.map((b, bIdx) => (
                              <span key={bIdx} className={`px-2 py-0.5 rounded text-[11px] font-bold border ${b.color}`}>
                                {b.text}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs font-semibold">
                          {s.sale_price_per_m2 && Number(s.sale_price_per_m2) > 0 ? (
                            <span className="text-slate-800">
                              ₺{Number(s.sale_price_per_m2).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal italic">Fiyatsız</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              s.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : s.status === 'cancelled'
                                ? 'bg-red-100 text-red-800 border border-red-200'
                                : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {s.status === 'completed' ? 'Tamamlandı' : s.status === 'cancelled' ? 'İptal' : 'Bekliyor'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {/* 🖨️ Tek Tıkla Kantar Fişi Yazdır */}
                            <button
                              type="button"
                              onClick={() => setPrintSlipShipment(s)}
                              className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                              title="Kantar / Sevk Fişini Yazdır"
                            >
                              <Printer size={15} />
                            </button>

                            <button
                              type="button"
                              onClick={() => setDetailShipment(s)}
                              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                              title="Sevkiyat Detayı"
                            >
                              <Eye size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setEditShipment(s);
                                setShowModal(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                              title="Düzenle"
                            >
                              <Pencil size={14} />
                            </button>

                            {isAdmin() && (
                              <button
                                type="button"
                                onClick={() => handleDelete(s)}
                                disabled={deleting === s.id}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                title="Sil"
                              >
                                {deleting === s.id ? (
                                  <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Trash2 size={14} />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer Bar with Record Count & Quick Scroll */}
          <div className="p-3 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 font-medium">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800">{filtered.length} İrsaliye Kaydı</span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500">Kantar & Sevkiyat Çıkış Kütüğü</span>
            </div>
            {filtered.length > 5 && (
              <button
                type="button"
                onClick={scrollToTop}
                className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-blue-700 font-bold rounded-lg border border-slate-200 transition-colors shadow-2xs cursor-pointer"
                title="Listenin en başına dön"
              >
                <ArrowUp size={13} />
                <span>En Başa Çık</span>
              </button>
            )}
          </div>
        </>
      )}
      </div>

      {/* ── CREATE / EDIT SHIPMENT MODAL ── */}
      {showModal && (
        <Modal
          title={editShipment ? `Sevkiyat Düzenle — ${editShipment.invoice_no}` : 'Yeni Sevkiyat & Kantar Çıkış Kaydı'}
          onClose={() => {
            setShowModal(false);
            setEditShipment(undefined);
          }}
          size="xl"
        >
          <ShipmentForm
            key={editShipment ? editShipment.id : 'new-shipment'}
            customers={customers}
            products={products}
            initial={editShipment}
            predictedInvoiceNo={predictedInvoiceNo}
            vehicleMemoryList={vehicleMemoryList}
            targetCompanyId={targetCompanyId}
            onSaveSuccess={handleSaveSuccess}
            onClose={() => {
              setShowModal(false);
              setEditShipment(undefined);
            }}
          />
        </Modal>
      )}

      {/* ── VIEW SHIPMENT DETAIL MODAL ── */}
      {detailShipment && (
        <Modal
          title={`Sevkiyat Detayı — ${detailShipment.invoice_no}`}
          onClose={() => setDetailShipment(undefined)}
          size="lg"
        >
          <ShipmentDetail
            shipment={detailShipment}
            onPrintSlip={() => {
              const current = detailShipment;
              setDetailShipment(undefined);
              setPrintSlipShipment(current);
            }}
            onClose={() => setDetailShipment(undefined)}
          />
        </Modal>
      )}

      {/* ── PRINT WAYBILL / WEIGHBRIDGE SLIP MODAL ── */}
      {printSlipShipment && (
        <PrintWaybillModal
          shipment={printSlipShipment}
          products={products}
          onClose={() => setPrintSlipShipment(undefined)}
        />
      )}

      {/* ── QUICK EMPTY PALLET RETURN MODAL ── */}
      {showQuickPalletModal && (
        <QuickPalletReturnModal
          customers={customers}
          initialCustomerId={quickPalletInitialCustomer}
          initialSiteId={quickPalletInitialSite}
          targetCompanyId={targetCompanyId}
          onSave={handlePalletReturnSuccess}
          onClose={() => setShowQuickPalletModal(false)}
        />
      )}

      {/* ── SUCCESSFUL SHIPMENT NOTIFICATION DIALOG ── */}
      {savedSuccessShipment && (
        <ShipmentSavedSuccessModal
          shipment={savedSuccessShipment}
          onPrint={() => {
            const cur = savedSuccessShipment;
            setSavedSuccessShipment(null);
            setPrintSlipShipment(cur);
          }}
          onPalletReturn={() => {
            const custId = savedSuccessShipment.customer_id;
            const sId = savedSuccessShipment.site_id || undefined;
            setSavedSuccessShipment(null);
            setQuickPalletInitialCustomer(custId);
            setQuickPalletInitialSite(sId);
            setShowQuickPalletModal(true);
          }}
          onNewShipment={() => {
            setSavedSuccessShipment(null);
            setEditShipment(undefined);
            setShowModal(true);
          }}
          onClose={() => setSavedSuccessShipment(null)}
        />
      )}

      {/* ── FLOATING QUICK SCROLL TO TOP BUTTON ── */}
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl hover:shadow-blue-500/50 transition-all duration-300 transform hover:-translate-y-1 active:scale-95 cursor-pointer font-bold text-xs animate-in fade-in zoom-in-90 border-2 border-white"
          title="Listenin en başına çık"
        >
          <ArrowUp size={16} className="animate-bounce" />
          <span>Yukarı Çık</span>
        </button>
      )}

      {/* ── CUSTOM SCROLLBAR STYLES ── */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f8fafc;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #94a3b8;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #64748b;
        }
      `}</style>
    </div>
  );
}
