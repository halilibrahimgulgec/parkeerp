import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ProductionEntry, Product } from '../types';
import Modal from '../components/Modal';
import { Plus, Factory, Search, Filter, Calendar, CreditCard as Edit2, AlertCircle, Trash2, Sparkles } from 'lucide-react';

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
  plan_item_id?: string | null;
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
  plan_item_id: null,
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
    plan_item_id: initial.plan_item_id || null,
  } : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [matchedPlanItem, setMatchedPlanItem] = useState<any | null>(null);

  // Auto detect active scheduled plan item for date + machine + shift
  useEffect(() => {
    supabase
      .from('production_plan_items')
      .select('*, products(*)')
      .eq('planned_date', form.date)
      .eq('machine_no', form.machine_no)
      .eq('shift', form.shift)
      .neq('status', 'completed')
      .maybeSingle()
      .then(
        ({ data }) => setMatchedPlanItem(data || null),
        () => setMatchedPlanItem(null)
      );
  }, [form.date, form.machine_no, form.shift]);

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

    // If linked to a plan item, update its produced quantity & status
    if (form.plan_item_id) {
      try {
        const netProduced = Math.max(0, form.total_m2 - form.waste_m2);
        const { data: curItem } = await supabase
          .from('production_plan_items')
          .select('produced_m2, planned_m2')
          .eq('id', form.plan_item_id)
          .single();

        if (curItem) {
          const newProduced = Number(curItem.produced_m2 || 0) + netProduced;
          const isCompleted = newProduced >= Number(curItem.planned_m2);
          await supabase
            .from('production_plan_items')
            .update({
              produced_m2: newProduced,
              status: isCompleted ? 'completed' : 'in_progress',
            })
            .eq('id', form.plan_item_id);
        }
      } catch (planErr) {
        console.error('Plan ilerlemesi güncellenemedi:', planErr);
      }
    }

    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Planned Work Order Detected Alert Banner */}
      {matchedPlanItem && !initial && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-center justify-between text-xs shadow-xs">
          <div>
            <span className="font-bold text-amber-900 flex items-center gap-1">
              <Sparkles size={13} className="text-amber-600" />
              Bu vardiya için planlanan iş emri tespit edildi:
            </span>
            <span className="text-amber-800 mt-0.5 block">
              <strong>{matchedPlanItem.products?.name}</strong> • Hedef: {Number(matchedPlanItem.planned_m2).toLocaleString('tr-TR')} {matchedPlanItem.products?.unit || 'm²'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              handleProductChange(matchedPlanItem.product_id);
              setForm(f => ({ ...f, plan_item_id: matchedPlanItem.id }));
            }}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-xs transition-colors shrink-0"
          >
            İş Emrini Yükle
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tarih *</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vardiya *</label>
          <select value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value as any }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-semibold">
            <option value="Gündüz">Gündüz Vardiyası</option>
            <option value="Gece">Gece Vardiyası</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Makine *</label>
          <select value={form.machine_no} onChange={e => setForm(f => ({ ...f, machine_no: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold">
            <option value="1">1 Nolu Parke Makinesi (Hat 1)</option>
            <option value="2">2 Nolu Parke & Bordür Makinesi (Hat 2)</option>
          </select>
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
          <p className="text-xs text-slate-400 mt-1">1 Palet = {selectedProduct.m2_per_pallet} {selectedProduct.unit === 'metre' ? 'Metre' : selectedProduct.unit === 'adet' ? 'Adet' : 'm²'}</p>
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
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Toplam {selectedProduct?.unit === 'metre' ? 'Metre' : selectedProduct?.unit === 'adet' ? 'Adet' : 'm²'}
          </label>
          <input type="number" min="0" step="0.01" value={form.total_m2}
            onChange={e => setForm(f => ({ ...f, total_m2: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Fire {selectedProduct?.unit === 'metre' ? 'Metre' : selectedProduct?.unit === 'adet' ? 'Adet' : 'm²'}
          </label>
          <input type="number" min="0" step="0.01" value={form.waste_m2}
            onChange={e => setForm(f => ({ ...f, waste_m2: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
        <span className="font-semibold text-amber-800">
          Net {selectedProduct?.unit === 'metre' ? 'Metre' : selectedProduct?.unit === 'adet' ? 'Adet' : 'm²'}: 
        </span>{' '}
        <span className="text-amber-700">
          {Math.max(form.total_m2 - form.waste_m2, 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}{' '}
          {selectedProduct?.unit === 'metre' ? 'Metre' : selectedProduct?.unit === 'adet' ? 'Adet' : 'm²'}
        </span>
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
  const [deleting, setDeleting] = useState<string | undefined>(undefined);

  const load = async () => {
    setLoading(true);
    const [prodRes, prodListRes] = await Promise.all([
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('production_entries').select('*, products(*)').order('date', { ascending: false }).order('created_at', { ascending: false }),
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

  let totalParkeM2 = 0;
  let totalBordurMetre = 0;
  let totalAdet = 0;
  let totalWasteM2 = 0;
  let totalWasteMetre = 0;

  filtered.forEach(e => {
    const u = e.products?.unit;
    const net = Number(e.net_m2) || 0;
    const waste = Number(e.waste_m2) || 0;
    if (u === 'metre') {
      totalBordurMetre += net;
      totalWasteMetre += waste;
    } else if (u === 'adet') {
      totalAdet += net;
    } else {
      totalParkeM2 += net;
      totalWasteM2 += waste;
    }
  });

  const handleDelete = async (entry: ProductionEntry) => {
    if (!confirm(`${entry.products?.name} için ${entry.date} tarihli üretim kaydını silmek istediğinize emin misiniz?`)) return;
    setDeleting(entry.id);
    try {
      const { error } = await supabase.from('production_entries').delete().eq('id', entry.id);
      if (error) throw error;
      await load();
    } catch (err: any) {
      alert(`Silme hatası: ${err.message}`);
    } finally {
      setDeleting(undefined);
    }
  };

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-amber-600">
            {totalParkeM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
          </p>
          <p className="text-xs text-slate-500 mt-1">Toplam Net Parke</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-amber-800">
            {totalBordurMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre
          </p>
          <p className="text-xs text-slate-500 mt-1">Toplam Net Bordür</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-red-500">
            {totalWasteM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
            {totalWasteMetre > 0 && ` + ${totalWasteMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m`}
          </p>
          <p className="text-xs text-slate-500 mt-1">Toplam Fire</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-xl font-bold text-slate-700">{filtered.length} Kayıt</p>
          <p className="text-xs text-slate-500 mt-1">Vardiya Üretim Sayısı</p>
        </div>
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
                  {['Tarih', 'Vardiya', 'Makine', 'Ürün', 'Palet', 'Toplam Miktar', 'Fire', 'Net Üretim', 'Lot No', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-12 text-slate-400">Kayıt bulunamadı.</td></tr>
                ) : filtered.map(entry => {
                  const entryUnit = entry.products?.unit === 'metre' ? 'm' : entry.products?.unit === 'adet' ? 'ad.' : 'm²';
                  return (
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
                    <td className="px-4 py-3 text-slate-700 font-medium">
                      {entry.total_m2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {entryUnit}
                    </td>
                    <td className="px-4 py-3 text-red-500 font-medium">
                      {entry.waste_m2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {entryUnit}
                    </td>
                    <td className="px-4 py-3 font-semibold text-amber-700">
                      {entry.net_m2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {entryUnit}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-xs">{entry.lot_number}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditEntry(entry); setShowModal(true); }}
                          className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(entry)} disabled={deleting === entry.id}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Sil">
                          {deleting === entry.id
                            ? <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                            : <Trash2 size={14} />}
                        </button>
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
