import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Product, Customer, Site, BOMItem, RawMaterial } from '../types';
import Modal from '../components/Modal';
import { Package, Users, MapPin, BookOpen, Plus, CreditCard as Edit2, Trash2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';

type Tab = 'products' | 'customers' | 'bom';

function InputField({ label, value, onChange, type = 'text', placeholder = '', required = false, children }: any) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}{required && ' *'}</label>
      {children || (
        <input type={type} value={value} onChange={onChange} placeholder={placeholder} required={required}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm" />
      )}
    </div>
  );
}

function ProductFormComp({ initial, onSave, onClose }: { initial?: Product; onSave: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    product_type: initial?.product_type || 'Kilitli',
    thickness: initial?.thickness || '6cm',
    color: initial?.color || 'Gri',
    unit: initial?.unit || 'm2',
    m2_per_pallet: initial?.m2_per_pallet || 10,
    min_stock_alert: initial?.min_stock_alert || 100,
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    let err;
    if (initial) {
      ({ error: err } = await supabase.from('products').update(form).eq('id', initial.id));
    } else {
      ({ error: err } = await supabase.from('products').insert(form));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Ürün Adı" value={form.name} onChange={(e: any) => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Parke Taşı 6cm" />
        <InputField label="Ürün Tipi" value={form.product_type} onChange={(e: any) => setForm(f => ({ ...f, product_type: e.target.value }))}>
          <select value={form.product_type} onChange={e => setForm(f => ({ ...f, product_type: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm">
            {['Kilitli', 'Begonit', 'Bordür', 'Küp Taşı', 'Tretuar', 'Arnavut Kaldırımı', 'Diğer'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </InputField>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <InputField label="Kalınlık" value={form.thickness} onChange={() => {}}>
          <select value={form.thickness} onChange={e => setForm(f => ({ ...f, thickness: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm">
            {['4cm', '5cm', '6cm', '7cm', '8cm', '10cm', '12cm'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </InputField>
        <InputField label="Renk" value={form.color} onChange={(e: any) => setForm(f => ({ ...f, color: e.target.value }))} placeholder="Gri, Sarı..." />
        <InputField label="Birim" value={form.unit} onChange={() => {}}>
          <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm">
            <option value="m2">m²</option>
            <option value="adet">Adet</option>
            <option value="metre">Metre</option>
          </select>
        </InputField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="Palet Başına m²" type="number" value={form.m2_per_pallet} onChange={(e: any) => setForm(f => ({ ...f, m2_per_pallet: Number(e.target.value) }))} required />
        <InputField label="Min. Stok Uyarı (m²)" type="number" value={form.min_stock_alert} onChange={(e: any) => setForm(f => ({ ...f, min_stock_alert: Number(e.target.value) }))} />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
        <label htmlFor="is_active" className="text-sm text-slate-700">Aktif Ürün</label>
      </div>
      {error && <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm"><AlertCircle size={16} />{error}</div>}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm">İptal</button>
        <button type="submit" disabled={saving} className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm disabled:opacity-60 flex items-center gap-2">
          {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {initial ? 'Güncelle' : 'Kaydet'}
        </button>
      </div>
    </form>
  );
}

function CustomerFormComp({ initial, onSave, onClose }: { initial?: Customer; onSave: (customer: Customer) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    tax_number: initial?.tax_number || '',
    address: initial?.address || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedCustomer, setSavedCustomer] = useState<Customer | null>(initial || null);
  const [sites, setSites] = useState<Site[]>([]);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [siteForm, setSiteForm] = useState({ name: '', address: '', contact_person: '', contact_phone: '' });

  const activeCustomerId = savedCustomer?.id || initial?.id;

  useEffect(() => {
    if (activeCustomerId) {
      supabase.from('sites').select('*').eq('customer_id', activeCustomerId).then(({ data }) => setSites(data || []));
    }
  }, [activeCustomerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    if (initial) {
      const { error: err } = await supabase.from('customers').update(form).eq('id', initial.id);
      if (err) { setError(err.message); setSaving(false); return; }
      setSaving(false);
      onSave({ ...initial, ...form });
    } else {
      const { data, error: err } = await supabase.from('customers').insert(form).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setSaving(false);
      setSavedCustomer(data as Customer);
    }
  };

  const addSite = async () => {
    if (!activeCustomerId || !siteForm.name) return;
    await supabase.from('sites').insert({ ...siteForm, customer_id: activeCustomerId });
    setSiteForm({ name: '', address: '', contact_person: '', contact_phone: '' });
    setShowSiteForm(false);
    supabase.from('sites').select('*').eq('customer_id', activeCustomerId).then(({ data }) => setSites(data || []));
  };

  const isNewlySaved = !initial && !!savedCustomer;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isNewlySaved && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          <span className="font-medium">Musteri kaydedildi.</span> Simdi santiye ekleyebilirsiniz.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Musteri Adi" value={form.name} onChange={(e: any) => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Firma Adi" />
        <InputField label="Telefon" value={form.phone} onChange={(e: any) => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0212 xxx xx xx" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <InputField label="E-posta" type="email" value={form.email} onChange={(e: any) => setForm(f => ({ ...f, email: e.target.value }))} placeholder="info@firma.com" />
        <InputField label="Vergi Numarasi" value={form.tax_number} onChange={(e: any) => setForm(f => ({ ...f, tax_number: e.target.value }))} placeholder="1234567890" />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Adres</label>
        <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm resize-none" rows={2} />
      </div>

      {activeCustomerId && (
        <div className="border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><MapPin size={15} /> Santiyeler ({sites.length})</h3>
            <button type="button" onClick={() => setShowSiteForm(!showSiteForm)}
              className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1">
              <Plus size={14} /> Santiye Ekle
            </button>
          </div>
          {showSiteForm && (
            <div className="mb-3 p-3 bg-slate-50 rounded-lg space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Santiye adi *" value={siteForm.name} onChange={e => setSiteForm(f => ({ ...f, name: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <input type="text" placeholder="Yetkili kisi" value={siteForm.contact_person} onChange={e => setSiteForm(f => ({ ...f, contact_person: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <input type="text" placeholder="Adres" value={siteForm.address} onChange={e => setSiteForm(f => ({ ...f, address: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <div className="flex gap-2">
                <button type="button" onClick={addSite} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium">Ekle</button>
                <button type="button" onClick={() => setShowSiteForm(false)} className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs">Iptal</button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {sites.map(site => (
              <div key={site.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-sm">
                <div>
                  <span className="font-medium text-slate-700">{site.name}</span>
                  {site.address && <span className="text-slate-400 ml-2 text-xs">{site.address}</span>}
                </div>
              </div>
            ))}
            {sites.length === 0 && <p className="text-xs text-slate-400 text-center py-2">Henuz santiye eklenmemis.</p>}
          </div>
        </div>
      )}

      {error && <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm"><AlertCircle size={16} />{error}</div>}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={() => { if (savedCustomer) onSave(savedCustomer); else onClose(); }}
          className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm">
          {isNewlySaved ? 'Kapat' : 'Iptal'}
        </button>
        {!isNewlySaved && (
          <button type="submit" disabled={saving} className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm disabled:opacity-60 flex items-center gap-2">
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {initial ? 'Guncelle' : 'Kaydet'}
          </button>
        )}
      </div>
    </form>
  );
}

function BOMSection({ products, rawMaterials }: { products: Product[]; rawMaterials: RawMaterial[] }) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [bomItems, setBomItems] = useState<BOMItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ raw_material_id: '', quantity_per_m2: 0 });
  const [saving, setSaving] = useState(false);

  const loadBOM = async (productId: string) => {
    const { data } = await supabase.from('bom_items').select('*, raw_materials(*)').eq('product_id', productId);
    setBomItems((data || []) as BOMItem[]);
  };

  const selectProduct = (p: Product) => {
    setSelectedProduct(p);
    loadBOM(p.id);
  };

  const addBOMItem = async () => {
    if (!selectedProduct || !newItem.raw_material_id) return;
    setSaving(true);
    await supabase.from('bom_items').upsert({
      product_id: selectedProduct.id,
      raw_material_id: newItem.raw_material_id,
      quantity_per_m2: newItem.quantity_per_m2,
    }, { onConflict: 'product_id,raw_material_id' });
    setNewItem({ raw_material_id: '', quantity_per_m2: 0 });
    setAdding(false);
    setSaving(false);
    loadBOM(selectedProduct.id);
  };

  const deleteBOMItem = async (id: string) => {
    await supabase.from('bom_items').delete().eq('id', id);
    if (selectedProduct) loadBOM(selectedProduct.id);
  };

  return (
    <div className="grid grid-cols-5 gap-6">
      <div className="col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Ürün Seçin</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {products.map(p => (
            <button key={p.id} onClick={() => selectProduct(p)}
              className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center justify-between ${selectedProduct?.id === p.id ? 'bg-amber-50 border-l-2 border-amber-500' : 'hover:bg-slate-50'}`}>
              <div>
                <div className="font-medium text-slate-800">{p.name}</div>
                <div className="text-xs text-slate-400">{p.product_type} / {p.thickness} / {p.color}</div>
              </div>
              {selectedProduct?.id === p.id ? <ChevronDown size={14} className="text-amber-500" /> : <ChevronRight size={14} className="text-slate-300" />}
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-3">
        {!selectedProduct ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            Reçete görüntülemek için sol taraftan ürün seçin.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">{selectedProduct.name} — Reçete (BOM)</h3>
                <p className="text-xs text-slate-400">m² başına kullanılan hammadde miktarları</p>
              </div>
              <button onClick={() => setAdding(true)}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800">
                <Plus size={14} /> Ekle
              </button>
            </div>
            <div className="p-4">
              {adding && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Hammadde</label>
                      <select value={newItem.raw_material_id} onChange={e => setNewItem(f => ({ ...f, raw_material_id: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                        <option value="">Seçin...</option>
                        {rawMaterials.map(r => <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Miktar / m²</label>
                      <input type="number" min="0" step="0.001" value={newItem.quantity_per_m2}
                        onChange={e => setNewItem(f => ({ ...f, quantity_per_m2: Number(e.target.value) }))}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={addBOMItem} disabled={saving}
                      className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium disabled:opacity-60">Kaydet</button>
                    <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs">İptal</button>
                  </div>
                </div>
              )}

              {bomItems.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">Bu ürün için reçete tanımlı değil.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-100">
                      <th className="pb-2 font-medium">Hammadde</th>
                      <th className="pb-2 font-medium text-right">Miktar / m²</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {bomItems.map(item => (
                      <tr key={item.id}>
                        <td className="py-2 text-slate-700">{item.raw_materials?.name}</td>
                        <td className="py-2 text-right font-semibold text-amber-700">{item.quantity_per_m2} {item.raw_materials?.unit}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => deleteBOMItem(item.id)}
                            className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Definitions() {
  const [tab, setTab] = useState<Tab>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    const [prodRes, custRes, rawRes] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
      supabase.from('raw_materials').select('*').order('name'),
    ]);
    setProducts(prodRes.data || []);
    setCustomers(custRes.data || []);
    setRawMaterials(rawRes.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const TABS = [
    { id: 'products' as Tab, label: 'Ürün Kartları', icon: Package, count: products.length },
    { id: 'customers' as Tab, label: 'Müşteriler', icon: Users, count: customers.length },
    { id: 'bom' as Tab, label: 'Reçete (BOM)', icon: BookOpen, count: rawMaterials.length },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tanımlamalar</h1>
          <p className="text-slate-500 text-sm mt-1">Ürün, müşteri ve reçete yönetimi</p>
        </div>
        {tab !== 'bom' && (
          <button onClick={() => { setEditItem(null); setShowModal(true); }}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm">
            <Plus size={18} /> {tab === 'products' ? 'Yeni Ürün' : 'Yeni Müşteri'}
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6 w-fit">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon size={16} />
              {t.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tab === 'bom' ? (
        <BOMSection products={products} rawMaterials={rawMaterials} />
      ) : tab === 'products' ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                {['Ürün Adı', 'Tip', 'Kalınlık', 'Renk', 'Birim', 'm²/Palet', 'Min. Stok', 'Durum', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {products.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-400">Henüz ürün tanımı yok.</td></tr>
              ) : products.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                  <td className="px-4 py-3 text-slate-600">{p.product_type}</td>
                  <td className="px-4 py-3 text-slate-600">{p.thickness}</td>
                  <td className="px-4 py-3 text-slate-600">{p.color}</td>
                  <td className="px-4 py-3 text-slate-600">{p.unit}</td>
                  <td className="px-4 py-3 font-semibold text-amber-700">{p.m2_per_pallet}</td>
                  <td className="px-4 py-3 text-slate-600">{p.min_stock_alert} m²</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {p.is_active ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setEditItem(p); setShowModal(true); }}
                      className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors">
                      <Edit2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                {['Müşteri Adı', 'Telefon', 'E-posta', 'Vergi No', 'Durum', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {customers.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">Henüz müşteri tanımı yok.</td></tr>
              ) : customers.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.phone || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email || '-'}</td>
                  <td className="px-4 py-3 font-mono text-slate-500 text-xs">{c.tax_number || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {c.is_active ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setEditItem(c); setShowModal(true); }}
                      className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors">
                      <Edit2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal title={tab === 'products' ? (editItem ? 'Ürün Düzenle' : 'Yeni Ürün') : (editItem ? 'Müşteri Düzenle' : 'Yeni Müşteri')}
          onClose={() => setShowModal(false)} size="lg">
          {tab === 'products' ? (
            <ProductFormComp initial={editItem} onSave={() => { setShowModal(false); load(); }} onClose={() => setShowModal(false)} />
          ) : (
            <CustomerFormComp initial={editItem} onSave={(_c) => { setShowModal(false); load(); }} onClose={() => setShowModal(false)} />
          )}
        </Modal>
      )}
    </div>
  );
}
