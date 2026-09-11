import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Product, Customer, Site, ExternalPurchase } from '../types';
import Modal from '../components/Modal';
import {
  ShoppingBag, Plus, Truck, ArrowRight, Search, Filter,
  Calendar, DollarSign, AlertCircle, Trash2, Edit2, Boxes,
  FileText, CheckCircle2, Printer, Building2, Eye, RefreshCw,
  TrendingUp, ArrowDownLeft, ShieldCheck, ArrowUpRight
} from 'lucide-react';

const getLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

interface PurchaseFormData {
  date: string;
  supplier_name: string;
  supplier_invoice_no: string;
  vehicle_plate: string;
  driver_name: string;
  product_id: string;
  quantity: number;
  unit: 'm2' | 'metre' | 'adet';
  pallets: number;
  pallet_type: 'sevkiyat' | 'tahta' | 'uretim' | 'dokme';
  unit_price: number;
  notes: string;
  // Transit Sevk Alanları
  is_direct_shipment: boolean;
  customer_id: string;
  site_id: string;
  customer_invoice_no: string;
  sale_price_per_m2: number;
  logistics_cost: number;
}

const EMPTY_FORM: PurchaseFormData = {
  date: getLocalDateString(),
  supplier_name: '',
  supplier_invoice_no: '',
  vehicle_plate: '',
  driver_name: '',
  product_id: '',
  quantity: 0,
  unit: 'm2',
  pallets: 0,
  pallet_type: 'sevkiyat',
  unit_price: 0,
  notes: '',
  is_direct_shipment: false,
  customer_id: '',
  site_id: '',
  customer_invoice_no: '',
  sale_price_per_m2: 0,
  logistics_cost: 0,
};

export default function Purchases() {
  const { user, isAdmin, isWeighbridge, isFieldManager } = useAuth();
  const [purchases, setPurchases] = useState<ExternalPurchase[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal & Form State
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ExternalPurchase | null>(null);
  const [form, setForm] = useState<PurchaseFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'warehouse' | 'direct'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [purchRes, prodRes, custRes, siteRes] = await Promise.all([
        supabase
          .from('external_purchases')
          .select('*, products(*), shipments(*, customers(*), sites(*))')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('sites').select('*').eq('is_active', true).order('name'),
      ]);

      if (purchRes.data) setPurchases(purchRes.data as any);
      if (prodRes.data) setProducts(prodRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (siteRes.data) setSites(siteRes.data);
    } catch (err) {
      console.error('Veri yükleme hatası:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter sites when customer changes in form
  const availableSites = useMemo(() => {
    if (!form.customer_id) return [];
    return sites.filter(s => s.customer_id === form.customer_id);
  }, [form.customer_id, sites]);

  const selectedProduct = products.find(p => p.id === form.product_id);

  // Handle product change in form
  const handleProductChange = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    const unit = (prod?.unit || 'm2') as any;
    const qty = prod ? form.pallets * Number(prod.m2_per_pallet || 0) : form.quantity;
    setForm(f => ({
      ...f,
      product_id: productId,
      unit,
      quantity: qty > 0 ? qty : f.quantity,
    }));
  };

  // Handle pallets change
  const handlePalletsChange = (pallets: number) => {
    const qty = selectedProduct && selectedProduct.m2_per_pallet > 0
      ? pallets * Number(selectedProduct.m2_per_pallet)
      : form.quantity;
    setForm(f => ({
      ...f,
      pallets,
      quantity: qty > 0 ? qty : f.quantity,
    }));
  };

  // Open add modal
  const handleOpenAdd = () => {
    setEditingItem(null);
    setForm({
      ...EMPTY_FORM,
      date: getLocalDateString(),
      customer_id: customers[0]?.id || '',
    });
    setError('');
    setShowModal(true);
  };

  // Save (Create or Update)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supplier_name.trim()) {
      setError('Lütfen tedarikçi / fabrika adını giriniz.');
      return;
    }
    if (!form.product_id) {
      setError('Lütfen ürün seçiniz.');
      return;
    }
    if (form.quantity <= 0) {
      setError('Lütfen geçerli bir miktar giriniz.');
      return;
    }

    if (form.is_direct_shipment && !form.customer_id) {
      setError('Doğrudan sevk (transit) için lütfen müşteri seçiniz.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let linkedShipmentId: string | null = editingItem?.linked_shipment_id || null;

      // If Direct Shipment is checked, create/update the customer shipment
      if (form.is_direct_shipment) {
        const shipmentPayload = {
          invoice_no: form.customer_invoice_no.trim() || form.supplier_invoice_no.trim() || `TR-${Date.now().toString().slice(-6)}`,
          customer_id: form.customer_id,
          site_id: form.site_id || null,
          vehicle_plate: form.vehicle_plate.trim().toUpperCase(),
          driver_name: form.driver_name.trim(),
          sale_price_per_m2: Number(form.sale_price_per_m2) || 0,
          logistics_cost: Number(form.logistics_cost) || 0,
          total_m2: Number(form.quantity),
          status: 'completed',
          shipment_date: form.date,
          notes: `Doğrudan Transit Sevk (Tedarikçi: ${form.supplier_name.trim()}) ${form.notes ? '— ' + form.notes : ''}`,
        };

        if (linkedShipmentId) {
          // Update existing linked shipment
          await supabase.from('shipments').update(shipmentPayload).eq('id', linkedShipmentId);
          // Update item
          await supabase.from('shipment_items').delete().eq('shipment_id', linkedShipmentId);
          await supabase.from('shipment_items').insert({
            shipment_id: linkedShipmentId,
            product_id: form.product_id,
            pallets: Number(form.pallets) || 0,
            pallet_type: form.pallet_type,
            m2: Number(form.quantity),
            unit: form.unit,
          });
          // Update customer pallet transaction
          await supabase.from('pallet_transactions').delete().eq('shipment_id', linkedShipmentId);
          if (Number(form.pallets) > 0 && form.pallet_type !== 'dokme') {
            await supabase.from('pallet_transactions').insert({
              date: form.date,
              customer_id: form.customer_id,
              site_id: form.site_id || null,
              shipment_id: linkedShipmentId,
              transaction_type: 'sent',
              pallet_type: form.pallet_type,
              quantity: Number(form.pallets),
              notes: `${form.customer_invoice_no.trim() || form.supplier_invoice_no.trim() || 'Transit'} no'lu transit sevk ile teslim edildi.`,
              created_by: user?.id,
            });
          }
        } else {
          // Create new shipment
          const { data: newShipment, error: shipErr } = await supabase
            .from('shipments')
            .insert(shipmentPayload)
            .select()
            .single();

          if (shipErr) throw shipErr;
          linkedShipmentId = newShipment.id;

          // Insert shipment item
          const { error: itemErr } = await supabase.from('shipment_items').insert({
            shipment_id: newShipment.id,
            product_id: form.product_id,
            pallets: Number(form.pallets) || 0,
            pallet_type: form.pallet_type,
            m2: Number(form.quantity),
            unit: form.unit,
          });

          if (itemErr) throw itemErr;

          // Insert customer pallet transaction
          if (Number(form.pallets) > 0 && form.pallet_type !== 'dokme') {
            await supabase.from('pallet_transactions').insert({
              date: form.date,
              customer_id: form.customer_id,
              site_id: form.site_id || null,
              shipment_id: newShipment.id,
              transaction_type: 'sent',
              pallet_type: form.pallet_type,
              quantity: Number(form.pallets),
              notes: `${form.customer_invoice_no.trim() || form.supplier_invoice_no.trim() || 'Transit'} no'lu transit sevk ile teslim edildi.`,
              created_by: user?.id,
            });
          }
        }
      } else if (linkedShipmentId && !form.is_direct_shipment) {
        // If user unchecked direct shipment on edit, remove linked shipment and pallet records
        await supabase.from('pallet_transactions').delete().eq('shipment_id', linkedShipmentId);
        await supabase.from('shipment_items').delete().eq('shipment_id', linkedShipmentId);
        await supabase.from('shipments').delete().eq('id', linkedShipmentId);
        linkedShipmentId = null;
      }

      // Save External Purchase Record
      const purchasePayload = {
        date: form.date,
        supplier_name: form.supplier_name.trim(),
        supplier_invoice_no: form.supplier_invoice_no.trim(),
        vehicle_plate: form.vehicle_plate.trim().toUpperCase(),
        driver_name: form.driver_name.trim(),
        product_id: form.product_id,
        quantity: Number(form.quantity),
        unit: form.unit,
        pallets: Number(form.pallets) || 0,
        pallet_type: form.pallet_type,
        unit_price: Number(form.unit_price) || 0,
        is_direct_shipment: form.is_direct_shipment,
        linked_shipment_id: linkedShipmentId,
        notes: form.notes.trim(),
        created_by: user?.id,
      };

      let savedPurchaseId = editingItem?.id;

      if (editingItem) {
        const { error: updErr } = await supabase
          .from('external_purchases')
          .update(purchasePayload)
          .eq('id', editingItem.id);
        if (updErr) throw updErr;
      } else {
        const { data: insData, error: insErr } = await supabase
          .from('external_purchases')
          .insert(purchasePayload)
          .select('id')
          .single();
        if (insErr) throw insErr;
        savedPurchaseId = insData.id;
      }

      // Update supplier pallet transactions (Tedarikçi Palet Borcu)
      if (savedPurchaseId) {
        await supabase.from('supplier_pallet_transactions').delete().eq('purchase_id', savedPurchaseId);
        if (Number(form.pallets) > 0 && form.pallet_type !== 'dokme') {
          await supabase.from('supplier_pallet_transactions').insert({
            date: form.date,
            supplier_name: form.supplier_name.trim(),
            purchase_id: savedPurchaseId,
            transaction_type: 'received',
            pallet_type: form.pallet_type,
            quantity: Number(form.pallets),
            vehicle_plate: form.vehicle_plate.trim().toUpperCase(),
            driver_name: form.driver_name.trim(),
            notes: `${form.supplier_invoice_no.trim() ? form.supplier_invoice_no.trim() + ' no irsaliyeli ' : ''}dış alım ile teslim alındı.`,
            created_by: user?.id,
          });
        }
      }

      setShowModal(false);
      await loadData();
    } catch (err: any) {
      setError(`Kaydetme hatası: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Delete handler
  const handleDelete = async (item: ExternalPurchase) => {
    let msg = `${item.supplier_name} firmasından yapılan ${item.quantity} ${item.unit} alım kaydını silmek istediğinize emin misiniz?`;
    if (item.is_direct_shipment && item.linked_shipment_id) {
      msg += '\n\nNOT: Bu işlem bağlı transit müşteri sevkiyatını ve palet kayıtlarını da silecektir.';
    }

    if (!confirm(msg)) return;

    setDeletingId(item.id);
    try {
      if (item.linked_shipment_id) {
        await supabase.from('pallet_transactions').delete().eq('shipment_id', item.linked_shipment_id);
        await supabase.from('shipment_items').delete().eq('shipment_id', item.linked_shipment_id);
        await supabase.from('shipments').delete().eq('id', item.linked_shipment_id);
      }
      await supabase.from('supplier_pallet_transactions').delete().eq('purchase_id', item.id);
      const { error: delErr } = await supabase.from('external_purchases').delete().eq('id', item.id);
      if (delErr) throw delErr;
      await loadData();
    } catch (err: any) {
      alert(`Silme hatası: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // Open edit modal
  const handleOpenEdit = (item: ExternalPurchase) => {
    setEditingItem(item);
    const linkedShipment = (item as any).shipments;

    setForm({
      date: item.date,
      supplier_name: item.supplier_name,
      supplier_invoice_no: item.supplier_invoice_no || '',
      vehicle_plate: item.vehicle_plate || '',
      driver_name: item.driver_name || '',
      product_id: item.product_id,
      quantity: item.quantity,
      unit: item.unit,
      pallets: item.pallets,
      pallet_type: (item.pallet_type as any) || 'sevkiyat',
      unit_price: item.unit_price || 0,
      notes: item.notes || '',
      is_direct_shipment: item.is_direct_shipment,
      customer_id: linkedShipment?.customer_id || customers[0]?.id || '',
      site_id: linkedShipment?.site_id || '',
      customer_invoice_no: linkedShipment?.invoice_no || '',
      sale_price_per_m2: linkedShipment?.sale_price_per_m2 || 0,
      logistics_cost: linkedShipment?.logistics_cost || 0,
    });
    setError('');
    setShowModal(true);
  };

  // Filtered purchases
  const filtered = useMemo(() => {
    return purchases.filter(p => {
      const s = search.toLowerCase().trim();
      const sup = p.supplier_name.toLowerCase();
      const inv = (p.supplier_invoice_no || '').toLowerCase();
      const plate = (p.vehicle_plate || '').toLowerCase();
      const driver = (p.driver_name || '').toLowerCase();
      const prodName = p.products?.name?.toLowerCase() || '';

      const matchSearch = !s ||
        sup.includes(s) ||
        inv.includes(s) ||
        plate.includes(s) ||
        driver.includes(s) ||
        prodName.includes(s);

      const matchDate = !filterDate || p.date === filterDate;
      const matchProduct = filterProduct === 'all' || p.product_id === filterProduct;
      const matchType = filterType === 'all' ||
        (filterType === 'warehouse' && !p.is_direct_shipment) ||
        (filterType === 'direct' && p.is_direct_shipment);

      return matchSearch && matchDate && matchProduct && matchType;
    });
  }, [purchases, search, filterDate, filterProduct, filterType]);

  // Aggregate KPIs
  const kpis = useMemo(() => {
    let totalParkeM2 = 0;
    let totalBordurMetre = 0;
    let totalAdet = 0;
    let directShipmentQty = 0;
    let totalPurchaseCost = 0;

    filtered.forEach(p => {
      const u = p.unit || p.products?.unit || 'm2';
      const qty = Number(p.quantity) || 0;
      const cost = qty * (Number(p.unit_price) || 0);

      if (u === 'metre') totalBordurMetre += qty;
      else if (u === 'adet') totalAdet += qty;
      else totalParkeM2 += qty;

      if (p.is_direct_shipment) directShipmentQty += qty;
      totalPurchaseCost += cost;
    });

    return {
      totalParkeM2,
      totalBordurMetre,
      totalAdet,
      directShipmentQty,
      totalPurchaseCost,
      count: filtered.length,
    };
  }, [filtered]);

  // Calculations for transit preview in form
  const transitCalc = useMemo(() => {
    if (!form.is_direct_shipment) return null;
    const qty = Number(form.quantity) || 0;
    const pPrice = Number(form.unit_price) || 0;
    const sPrice = Number(form.sale_price_per_m2) || 0;
    const logistics = Number(form.logistics_cost) || 0;

    const purchaseTotal = qty * pPrice;
    const salesTotal = qty * sPrice;
    const profit = salesTotal - purchaseTotal - logistics;
    const marginPct = salesTotal > 0 ? (profit / salesTotal) * 100 : 0;

    return {
      purchaseTotal,
      salesTotal,
      profit,
      marginPct,
    };
  }, [form.is_direct_shipment, form.quantity, form.unit_price, form.sale_price_per_m2, form.logistics_cost]);

  return (
    <div className="p-8">
      {/* ── HEADER ── */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
              <ShoppingBag size={22} />
            </div>
            Dış Alım & Transit Sevk Modülü
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Dış fabrikalardan hazır alınan taşların mal kabulü ve doğrudan şantiyeye sevk takibi
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Printer size={15} /> Yazdır / PDF
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm"
          >
            <Plus size={18} /> Yeni Dış Alım Girişi
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="no-print grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-100">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold text-slate-500">Dış Alım Parke</span>
            <Boxes size={16} className="text-blue-500" />
          </div>
          <p className="text-2xl font-black text-blue-900 font-mono">
            {kpis.totalParkeM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Stoka veya şantiyeye giren parke</p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-100">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold text-slate-500">Dış Alım Bordür</span>
            <Boxes size={16} className="text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-800 font-mono">
            {kpis.totalBordurMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Hazır alınan bordür metrajı</p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-100">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold text-slate-500">Transit (Doğrudan) Sevk</span>
            <Truck size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-emerald-800 font-mono">
            {kpis.directShipmentQty.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Depoya inmeden direkt şantiyeye giden</p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-100">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-semibold text-slate-500">Toplam Alış Tutarı</span>
            <DollarSign size={16} className="text-slate-600" />
          </div>
          <p className="text-2xl font-black text-slate-900 font-mono">
            ₺{kpis.totalPurchaseCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">{kpis.count} Alım İrsaliyesi</p>
        </div>
      </div>

      {/* ── FILTER & SEARCH BAR ── */}
      <div className="no-print bg-white rounded-2xl shadow-xs border border-slate-100 p-4 mb-6 space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="flex-1 relative w-full">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tedarikçi firma, alış irsaliye no, plaka, şoför veya ürün ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-slate-400" />
              <select
                value={filterProduct}
                onChange={e => setFilterProduct(e.target.value)}
                className="border border-slate-200 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">Tüm Ürünler</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.thickness})</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as any)}
                className="border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">Tüm Girişler</option>
                <option value="warehouse">Sadece Depo Girişi</option>
                <option value="direct">Sadece Transit (Direkt Müşteriye)</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={filterDate}
                onChange={e => setFilterDate(e.target.value)}
                className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              {filterDate && (
                <button
                  onClick={() => setFilterDate('')}
                  className="text-xs text-red-500 hover:text-red-700 font-semibold"
                >
                  Temizle
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── PURCHASES TABLE ── */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-100 overflow-hidden print-clean">
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag size={16} className="text-amber-500" />
            <h2 className="font-bold text-slate-900 text-sm">Dış Alım & Transit Mal Kabul Listesi</h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {filtered.length} Kayıt Listeleniyor
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                  <th className="px-4 py-3">Tarih</th>
                  <th className="px-3 py-3">Tedarikçi (Fabrika)</th>
                  <th className="px-3 py-3">Alış İrsaliye No</th>
                  <th className="px-3 py-3">Araç / Plaka</th>
                  <th className="px-3 py-3">Ürün</th>
                  <th className="px-3 py-3">Sevk Şekli</th>
                  <th className="px-3 py-3 text-right">Alınan Miktar</th>
                  <th className="px-3 py-3 text-right">Alış Fiyatı</th>
                  <th className="px-3 py-3 text-right">Toplam Tutar</th>
                  <th className="px-4 py-3 text-right no-print">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      Kayıtlı dış alım bulunamadı.
                    </td>
                  </tr>
                ) : (
                  filtered.map(p => {
                    const linkedShipment = (p as any).shipments;
                    const unitLabel = p.unit === 'metre' ? 'Metre' : p.unit === 'adet' ? 'Adet' : 'm²';
                    const unitColor = p.unit === 'metre' ? 'bg-amber-50 text-amber-800 border-amber-200' : p.unit === 'adet' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200';
                    const totalCost = Number(p.quantity) * (Number(p.unit_price) || 0);

                    return (
                      <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3.5 font-medium text-slate-700 whitespace-nowrap">
                          {new Date(p.date).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-3 py-3.5 font-bold text-slate-900">
                          {p.supplier_name}
                        </td>
                        <td className="px-3 py-3.5 font-mono text-slate-600">
                          {p.supplier_invoice_no || '-'}
                        </td>
                        <td className="px-3 py-3.5 font-mono">
                          <span className="font-bold text-slate-800">{p.vehicle_plate || '-'}</span>
                          {p.driver_name && <div className="text-[10px] text-slate-400">{p.driver_name}</div>}
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="font-semibold text-slate-800">{p.products?.name}</div>
                          <div className="text-[10px] text-slate-400">{p.products?.thickness} / {p.products?.color}</div>
                        </td>
                        <td className="px-3 py-3.5">
                          {p.is_direct_shipment ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <Truck size={11} /> Transit Doğrudan Sevk
                              </span>
                              {linkedShipment?.customers?.name && (
                                <div className="text-[10px] text-slate-600 font-semibold truncate max-w-[150px]">
                                  → {linkedShipment.customers.name}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              <Boxes size={11} /> Depoya Giriş (Stok)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border ${unitColor}`}>
                            {Number(p.quantity).toLocaleString('tr-TR')} {unitLabel}
                          </span>
                          {Number(p.pallets) > 0 && (
                            <div className="text-[10px] text-slate-400">{p.pallets} palet</div>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-slate-600">
                          {Number(p.unit_price) > 0 ? `₺${Number(p.unit_price).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900">
                          {totalCost > 0 ? `₺${totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : '-'}
                        </td>
                        <td className="px-4 py-3.5 text-right no-print">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleOpenEdit(p)}
                              className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                              title="Düzenle"
                            >
                              <Edit2 size={14} />
                            </button>
                            {isAdmin() && (
                              <button
                                onClick={() => handleDelete(p)}
                                disabled={deletingId === p.id}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Sil"
                              >
                                {deletingId === p.id ? (
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
        )}
      </div>

      {/* ── MODAL: YENİ DIŞ ALIM & TRANSİT SEVK FORMU ── */}
      {showModal && (
        <Modal
          title={editingItem ? 'Dış Alım Kaydını Düzenle' : 'Yeni Dış Alım & Transit Sevk Girişi'}
          onClose={() => setShowModal(false)}
          size="lg"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {/* Temel Alım Bilgileri */}
            <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <ShoppingBag size={14} className="text-amber-500" />
                Tedarikçi & Alış Bilgileri
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tarih *</label>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tedarikçi (Fabrika) Adı *</label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: Doğan Parke Fabrikası"
                    value={form.supplier_name}
                    onChange={e => setForm({ ...form, supplier_name: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Alış İrsaliye No</label>
                  <input
                    type="text"
                    placeholder="Örn: İRS-2026-081"
                    value={form.supplier_invoice_no}
                    onChange={e => setForm({ ...form, supplier_invoice_no: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Araç Plakası</label>
                  <input
                    type="text"
                    placeholder="46 AB 123"
                    value={form.vehicle_plate}
                    onChange={e => setForm({ ...form, vehicle_plate: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Şoför Adı</label>
                  <input
                    type="text"
                    placeholder="Ahmet Yılmaz"
                    value={form.driver_name}
                    onChange={e => setForm({ ...form, driver_name: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            </div>

            {/* Ürün ve Miktar */}
            <div className="bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 space-y-3">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Boxes size={14} className="text-blue-500" />
                Ürün, Palet & Miktar
              </h3>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ürün Seçiniz *</label>
                <select
                  required
                  value={form.product_id}
                  onChange={e => handleProductChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">-- Ürün Seçin --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.thickness} / {p.color} ({p.unit === 'metre' ? 'Metre' : p.unit === 'adet' ? 'Adet' : 'm²'})
                    </option>
                  ))}
                </select>
                {selectedProduct && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Standart: 1 Palet = {selectedProduct.m2_per_pallet} {selectedProduct.unit === 'metre' ? 'Metre' : selectedProduct.unit === 'adet' ? 'Adet' : 'm²'}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Palet Sayısı</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.pallets}
                    onChange={e => handlePalletsChange(Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Palet Tipi</label>
                  <select
                    value={form.pallet_type}
                    onChange={e => setForm({ ...form, pallet_type: e.target.value as any })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="sevkiyat">Sevkiyat Paleti</option>
                    <option value="tahta">Tahta Palet</option>
                    <option value="uretim">Üretim Paleti</option>
                    <option value="dokme">Dökme</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Miktar ({form.unit === 'metre' ? 'Metre' : form.unit === 'adet' ? 'Adet' : 'm²'}) *
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.01"
                    required
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: Number(e.target.value) })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold font-mono text-blue-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Alış Fiyatı (₺/birim)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="₺0.00"
                    value={form.unit_price}
                    onChange={e => setForm({ ...form, unit_price: Number(e.target.value) })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            </div>

            {/* ── TRANSİT (DOĞRUDAN ŞANTİYEYE SEVK) BLOKU ── */}
            <div className={`p-4 rounded-xl border transition-all ${form.is_direct_shipment ? 'bg-emerald-50/60 border-emerald-300' : 'bg-slate-50/60 border-slate-200'}`}>
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setForm({ ...form, is_direct_shipment: !form.is_direct_shipment })}>
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="is_direct_shipment"
                    checked={form.is_direct_shipment}
                    onChange={e => setForm({ ...form, is_direct_shipment: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                  />
                  <div>
                    <label htmlFor="is_direct_shipment" className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5">
                      <Truck size={15} className="text-emerald-600" />
                      Kamyon Doğrudan Müşteriye Sevk Edilecek (Transit Çıkış)
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Mal depoya inmeden direkt şantiyeye gidiyorsa işaretleyin; otomatik müşteri sevkiyatı oluşturulur.
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${form.is_direct_shipment ? 'bg-emerald-200/70 text-emerald-900 border-emerald-300' : 'bg-slate-200 text-slate-600 border-slate-300'}`}>
                  {form.is_direct_shipment ? 'Transit Aktif' : 'Depo Girişi'}
                </span>
              </div>

              {form.is_direct_shipment && (
                <div className="mt-4 pt-3 border-t border-emerald-200 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Sevk Edilecek Müşteri *</label>
                      <select
                        required={form.is_direct_shipment}
                        value={form.customer_id}
                        onChange={e => setForm({ ...form, customer_id: e.target.value, site_id: '' })}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      >
                        <option value="">-- Müşteri Seçin --</option>
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Şantiye (Opsiyonel)</label>
                      <select
                        value={form.site_id}
                        onChange={e => setForm({ ...form, site_id: e.target.value })}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      >
                        <option value="">Genel / Şantiye Belirtilmemiş</option>
                        {availableSites.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Müşteri Satış İrsaliye No</label>
                      <input
                        type="text"
                        placeholder="Örn: IRS-2026-099"
                        value={form.customer_invoice_no}
                        onChange={e => setForm({ ...form, customer_invoice_no: e.target.value })}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Satış Birim Fiyatı (₺)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="₺180.00"
                        value={form.sale_price_per_m2}
                        onChange={e => setForm({ ...form, sale_price_per_m2: Number(e.target.value) })}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Lojistik / Nakliye Gideri (₺)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="₺0.00"
                        value={form.logistics_cost}
                        onChange={e => setForm({ ...form, logistics_cost: Number(e.target.value) })}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                      />
                    </div>
                  </div>

                  {/* Anlık Karlılık Önizlemesi */}
                  {transitCalc && (
                    <div className="bg-white/90 rounded-xl p-3 border border-emerald-200 grid grid-cols-4 gap-2 text-center text-xs">
                      <div>
                        <div className="text-[10px] text-slate-400">Alış Maliyeti</div>
                        <div className="font-bold text-slate-700">₺{transitCalc.purchaseTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Satış Cirosu</div>
                        <div className="font-bold text-blue-700">₺{transitCalc.salesTotal.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Tahmini Kar</div>
                        <div className={`font-bold ${transitCalc.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {transitCalc.profit >= 0 ? '+' : ''}₺{transitCalc.profit.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Kar Marjı</div>
                        <div className={`font-bold ${transitCalc.marginPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          %{transitCalc.marginPct.toFixed(1)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Notlar */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Açıklama & Notlar</label>
              <textarea
                rows={2}
                placeholder="Alım veya transit sevk ile ilgili detaylar..."
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {editingItem ? 'Güncelle' : form.is_direct_shipment ? 'Transit Sevk & Alımı Kaydet' : 'Dış Alımı Kaydet'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
