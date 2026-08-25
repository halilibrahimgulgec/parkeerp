import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ProductionEntry, Product } from '../types';
import Modal from '../components/Modal';
import { Plus, Factory, Search, Filter, Calendar, CreditCard as Edit2, AlertCircle } from 'lucide-react';

interface ProductionFormData {
  date: string;
  shift: 'Gündüz' | 'Gece';
  machine_no: string;
  product_id: string;
  total_pallets: number;
  total_m2: number;
  waste_m2: number;
  lot_number: string;
  notes: string;
}

const EMPTY_FORM: ProductionFormData = {
  date: new Date().toISOString().split('T')[0],
  shift: 'Gündüz',
  machine_no: '1',
  product_id: '',
  total_pallets: 0,
  total_m2: 0,
  waste_m2: 0,
  lot_number: '',
  notes: '',
};

function ProductionForm({ products, onSave, onClose, initial }: {
  products: Product[];
  onSave: () => void;
  onClose: () => void;
  initial?: ProductionEntry;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<ProductionFormData>(initial ? {
    date: initial.date,
    shift: initial.shift,
    machine_no: initial.machine_no,
    product_id: initial.product_id,
    total_pallets: initial.total_pallets,
    total_m2: initial.total_m2,
    waste_m2: initial.waste_m2,
    lot_number: initial.lot_number,
    notes: initial.notes,
  } : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedProduct = products.find(p => p.id === form.product_id);

  const handleProductChange = (productId: string) => {
    const p = products.find(x => x.id === productId);
    const m2 = p ? form.total_pallets * p.m2_per_pallet : 0;
    setForm(f => ({ ...f, product_id: productId, total_m2: m2 }));
  };

  const handlePalletsChange = (pallets: number) => {
    const m2 = selectedProduct ? pallets * selectedProduct.m2_per_pallet : 0;
    setForm(f => ({ ...f, total_pallets: pallets, total_m2: m2 }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.product_id) { setError('Ürün seçiniz.'); return; }
    if (form.waste_m2 > form.total_m2) { setError('Fire miktarı toplam m2\'den fazla olamaz.'); return; }
    setSaving(true);
    setError('');
    const payload = { ...form, created_by: user?.id };
    let err;
    if (initial) {
      ({ error: err } = await supabase.from('production_entries').update(payload).eq('id', initial.id));
    } else {
      ({ error: err } = await supabase.from('production_entries').insert(payload));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tarih *</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vardiya *</label>
          <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value as any }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400">
            <option value="Gündüz">Gündüz</option>
            <option value="Gece">Gece</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Makine No *</label>
          <input type="text" value={form.machine_no} onChange={e => setForm(f => ({ ...f, machine_no: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
            placeholder="1" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Lot Numarası *</label>
          <input type="text" value={form.lot_number} onChange={e => setForm(f => ({ ...f, lot_number: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
            placeholder="LOT-2024-001" required />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Ürün *</label>
        <select value={form.product_id} onChange={e => handleProductChange(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" required>
          <option value="">Ürün seçin...</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.product_type} / {p.thickness} / {p.color}
            </option>
          ))}
        </select>
        {selectedProduct && (
          <p className="text-xs text-slate-400 mt-1">1 Palet = {selectedProduct.m2_per_pallet} m²</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Toplam Palet *</label>
          <input type="number" min="0" step="1" value={form.total_pallets}
            onChange={e => handlePalletsChange(Number(e.target.value))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Toplam m²</label>
          <input type="number" min="0" step="0.01" value={form.total_m2}
            onChange={e => setForm(f => ({ ...f, total_m2: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Fire m²</label>
          <input type="number" min="0" step="0.01" value={form.waste_m2}
            onChange={e => setForm(f => ({ ...f, waste_m2: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
        <span className="font-semibold text-amber-800">Net m²: </span>
        <span className="text-amber-700">{Math.max(form.total_m2 - form.waste_m2, 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} m²</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notlar</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          rows={2} placeholder="Opsiyonel notlar..." />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm">
          İptal
        </button>
        <button type="submit" disabled={saving}
          className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-60 flex items-center gap-2">
          {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {initial ? 'Güncelle' : 'Kaydet'}
        </button>
      </div>
    </form>
  );
}

export default function Production() {
  const [entries, setEntries] = useState<ProductionEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState<ProductionEntry | undefined>();
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');

  const load = async () => {
    setLoading(true);
    const [prodRes, prodListRes] = await Promise.all([
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('production_entries').select('*, products(*)').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    ]);
    setProducts(prodRes.data || []);
    setEntries((prodListRes.data || []) as ProductionEntry[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = entries.filter(e => {
    const searchMatch = search === '' ||
      e.products?.name.toLowerCase().includes(search.toLowerCase()) ||
      e.lot_number.toLowerCase().includes(search.toLowerCase()) ||
      e.machine_no.includes(search);
    const dateMatch = !filterDate || e.date === filterDate;
    return searchMatch && dateMatch;
  });

  const totalProduced = filtered.reduce((s, e) => s + e.net_m2, 0);
  const totalWaste = filtered.reduce((s, e) => s + e.waste_m2, 0);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Factory size={24} className="text-amber-500" /> Üretim Kayıtları
          </h1>
          <p className="text-slate-500 text-sm mt-1">Vardiya bazlı üretim giriş ve takip modülü</p>
        </div>
        <button
          onClick={() => { setEditEntry(undefined); setShowModal(true); }}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm"
        >
          <Plus size={18} /> Yeni Üretim Girişi
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Toplam Net m² (Filtrelenmiş)', value: `${totalProduced.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`, color: 'text-amber-600' },
          { label: 'Toplam Fire (Filtrelenmiş)', value: `${totalWaste.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²`, color: 'text-red-500' },
          { label: 'Kayıt Sayısı', value: String(filtered.length), color: 'text-slate-700' },
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
            <input
              type="text"
              placeholder="Ürün adı, lot no, makine ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-400" />
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {filterDate && (
              <button onClick={() => setFilterDate('')} className="text-xs text-slate-500 hover:text-red-500">Temizle</button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                  {['Tarih', 'Vardiya', 'Makine', 'Ürün', 'Palet', 'Toplam m²', 'Fire m²', 'Net m²', 'Lot No', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-slate-400">Kayıt bulunamadı.</td></tr>
                ) : filtered.map(entry => (
                  <tr key={entry.id} className="hover:bg-amber-50/30 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Calendar size={13} className="text-slate-400" />
                        {new Date(entry.date).toLocaleDateString('tr-TR')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entry.shift === 'Gündüz' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'}`}>
                        {entry.shift}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-mono">{entry.machine_no}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{entry.products?.name}</div>
                      <div className="text-xs text-slate-400">{entry.products?.thickness} / {entry.products?.color}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{entry.total_pallets}</td>
                    <td className="px-4 py-3 text-slate-700">{entry.total_m2.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-red-500">{entry.waste_m2.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 font-semibold text-amber-700">{entry.net_m2.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-xs">{entry.lot_number}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => { setEditEntry(entry); setShowModal(true); }}
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
      </div>

      {showModal && (
        <Modal
          title={editEntry ? 'Üretim Kaydını Düzenle' : 'Yeni Üretim Girişi'}
          onClose={() => setShowModal(false)}
          size="lg"
        >
          <ProductionForm
            products={products}
            onSave={() => { setShowModal(false); load(); }}
            onClose={() => setShowModal(false)}
            initial={editEntry}
          />
        </Modal>
      )}
    </div>
  );
}
