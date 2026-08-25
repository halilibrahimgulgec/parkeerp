import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shipment, ShipmentItem, Customer, Site, Product } from '../types';
import Modal from '../components/Modal';
import { Plus, Truck, Search, Filter, AlertCircle, Trash2, Eye, Pencil, PackageX } from 'lucide-react';

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
  items: { product_id: string; pallets: number; m2: number; unit: string }[];
}

const EMPTY_FORM: ShipmentFormData = {
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
  shipment_date: new Date().toISOString().split('T')[0],
  notes: '',
  items: [{ product_id: '', pallets: 0, m2: 0, unit: 'm2' }],
};

function ShipmentForm({ customers, products, initial, onSave, onClose }: {
  customers: Customer[];
  products: Product[];
  initial?: Shipment;
  onSave: () => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<ShipmentFormData>(initial ? {
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
    items: [],
  } : { ...EMPTY_FORM });
  const [sites, setSites] = useState<Site[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stockMap, setStockMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (form.customer_id) {
      supabase.from('sites').select('*').eq('customer_id', form.customer_id).eq('is_active', true)
        .then(({ data }) => setSites(data || []));
    } else {
      setSites([]);
    }
  }, [form.customer_id]);

  useEffect(() => {
    const fetchStock = async () => {
      const [stockRes, initialItemsRes] = await Promise.all([
        supabase.from('v_product_stock').select('*'),
        initial ? supabase.from('shipment_items').select('product_id, m2').eq('shipment_id', initial.id) : Promise.resolve({ data: [] }),
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
      }
      setStockMap(map);
    };
    fetchStock();
  }, [products]);

  const setItem = (idx: number, field: string, value: any) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === 'pallets' || field === 'product_id') {
        const p = products.find(x => x.id === (field === 'product_id' ? value : items[idx].product_id));
        if (p) items[idx].m2 = items[idx].pallets * p.m2_per_pallet;
      }
      return { ...f, items };
    });
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { product_id: '', pallets: 0, m2: 0, unit: 'm2' }] }));
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
      notes: form.notes,
    };

    if (initial) {
      const { error: shipErr } = await supabase.from('shipments').update(shipPayload).eq('id', initial.id);
      if (shipErr) { setError(shipErr.message); setSaving(false); return; }
    } else {
      const { data: shipData, error: shipErr } = await supabase.from('shipments').insert({
        ...shipPayload, status: 'completed', created_by: user?.id,
      }).select().single();
      if (shipErr) { setError(shipErr.message); setSaving(false); return; }

      const itemsToInsert = form.items.map(i => ({
        shipment_id: shipData.id,
        product_id: i.product_id,
        pallets: i.pallets,
        m2: i.m2,
        unit: i.unit,
      }));
      const { error: itemsErr } = await supabase.from('shipment_items').insert(itemsToInsert);
      if (itemsErr) { setError(itemsErr.message); setSaving(false); return; }
    }

    setSaving(false);
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
              <div className="col-span-4">
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
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
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
              <div className="col-span-3">
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

function ShipmentDetail({ shipment, onClose }: { shipment: Shipment; onClose: () => void }) {
  const [items, setItems] = useState<ShipmentItem[]>([]);

  useEffect(() => {
    supabase.from('shipment_items').select('*, products(*)').eq('shipment_id', shipment.id)
      .then(({ data }) => setItems((data || []) as ShipmentItem[]));
  }, [shipment.id]);

  const totalRevenue = shipment.sale_price_per_m2 * shipment.total_m2;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-slate-500">İrsaliye No:</span> <span className="font-medium">{shipment.invoice_no}</span></div>
        <div><span className="text-slate-500">Tarih:</span> <span className="font-medium">{new Date(shipment.shipment_date).toLocaleDateString('tr-TR')}</span></div>
        <div><span className="text-slate-500">Müşteri:</span> <span className="font-medium">{shipment.customers?.name}</span></div>
        <div><span className="text-slate-500">Şantiye:</span> <span className="font-medium">{shipment.sites?.name || '-'}</span></div>
        <div><span className="text-slate-500">Araç:</span> <span className="font-medium">{shipment.vehicle_plate}</span></div>
        <div><span className="text-slate-500">Şoför:</span> <span className="font-medium">{shipment.driver_name || '-'}</span></div>
        <div><span className="text-slate-500">Brüt / Dara / Net:</span> <span className="font-medium">{shipment.gross_weight} / {shipment.tare_weight} / {shipment.net_weight} kg</span></div>
        <div><span className="text-slate-500">Toplam m²:</span> <span className="font-semibold text-blue-700">{shipment.total_m2} m²</span></div>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-slate-600">Ürün</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">Palet</th>
              <th className="px-4 py-2 text-right font-medium text-slate-600">m²</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(item => (
              <tr key={item.id}>
                <td className="px-4 py-2">{item.products?.name} ({item.products?.thickness}/{item.products?.color})</td>
                <td className="px-4 py-2 text-right">{item.pallets}</td>
                <td className="px-4 py-2 text-right font-semibold">{item.m2}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-blue-50 rounded-xl p-4 text-sm grid grid-cols-3 gap-4">
        <div><p className="text-slate-500">Satış Fiyatı</p><p className="font-bold text-slate-900">₺{shipment.sale_price_per_m2}/m²</p></div>
        <div><p className="text-slate-500">Lojistik</p><p className="font-bold text-slate-900">₺{shipment.logistics_cost}</p></div>
        <div><p className="text-slate-500">Tahmini Ciro</p><p className="font-bold text-blue-700">₺{totalRevenue.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</p></div>
      </div>

      <div className="flex justify-end">
        <button onClick={onClose} className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-300 transition-colors">Kapat</button>
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
    const [custRes, prodRes, shipRes] = await Promise.all([
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('shipments').select('*, customers(*), sites(*)').order('shipment_date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    ]);
    setCustomers(custRes.data || []);
    setProducts(prodRes.data || []);
    setShipments((shipRes.data || []) as Shipment[]);
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
    const match = !search || s.invoice_no.toLowerCase().includes(q) || s.customers?.name.toLowerCase().includes(q) || s.vehicle_plate.toLowerCase().includes(q);
    const dateMatch = !filterDate || s.shipment_date === filterDate;
    return match && dateMatch;
  });

  const totalTonnage = filtered.reduce((acc, s) => acc + s.net_weight, 0);
  const totalM2 = filtered.reduce((acc, s) => acc + s.total_m2, 0);

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

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Toplam Net Ağırlık (Filtrelenmiş)', value: `${(totalTonnage / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} Ton`, color: 'text-blue-600' },
          { label: 'Toplam Sevk Edilen m²', value: `${totalM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`, color: 'text-slate-700' },
          { label: 'Sevkiyat Sayısı', value: String(filtered.length), color: 'text-slate-700' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="İrsaliye no, müşteri, plaka ara..."
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
                  {['İrsaliye', 'Tarih', 'Müşteri / Şantiye', 'Plaka', 'Net Ağırlık', 'Toplam m²', 'Satış Fiyatı', 'Durum', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-slate-400">Kayıt bulunamadı.</td></tr>
                ) : filtered.map(s => (
                  <tr key={s.id} className="hover:bg-blue-50/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-slate-700">{s.invoice_no}</td>
                    <td className="px-4 py-3 text-slate-600">{new Date(s.shipment_date).toLocaleDateString('tr-TR')}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{s.customers?.name}</div>
                      {s.sites?.name && <div className="text-xs text-slate-400">{s.sites.name}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{s.vehicle_plate}</td>
                    <td className="px-4 py-3 text-slate-700">{(s.net_weight / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} t</td>
                    <td className="px-4 py-3 font-semibold text-blue-700">{s.total_m2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²</td>
                    <td className="px-4 py-3 text-slate-600">₺{s.sale_price_per_m2}/m²</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'completed' ? 'bg-green-100 text-green-700' : s.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {s.status === 'completed' ? 'Tamamlandı' : s.status === 'cancelled' ? 'İptal' : 'Bekliyor'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setDetailShipment(s)}
                          className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>
                        <button onClick={() => { setEditShipment(s); setShowModal(true); }}
                          className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Pencil size={14} />
                        </button>
                        {isAdmin() && (
                          <button onClick={() => handleDelete(s)} disabled={deleting === s.id}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            {deleting === s.id
                              ? <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                              : <Trash2 size={14} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
