import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CostEntry } from '../types';
import Modal from '../components/Modal';
import { Plus, DollarSign, Search, AlertCircle, Trash2 } from 'lucide-react';

type CostType = 'hammadde' | 'operasyonel' | 'genel';

interface CostFormData {
  date: string;
  period_month: number;
  period_year: number;
  cost_type: CostType;
  sub_type: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  transport_cost: number;
  total_amount: number;
}

const CURRENT_MONTH = new Date().getMonth() + 1;
const CURRENT_YEAR = new Date().getFullYear();

const EMPTY_FORM: CostFormData = {
  date: new Date().toISOString().split('T')[0],
  period_month: CURRENT_MONTH,
  period_year: CURRENT_YEAR,
  cost_type: 'hammadde',
  sub_type: '',
  description: '',
  quantity: 0,
  unit: '',
  unit_price: 0,
  transport_cost: 0,
  total_amount: 0,
};

const SUB_TYPES: Record<CostType, { value: string; label: string; unit?: string }[]> = {
  hammadde: [
    { value: 'cimento', label: 'Çimento', unit: 'kg' },
    { value: 'agrega', label: 'Agrega / Kum', unit: 'kg' },
    { value: 'boya', label: 'Boya', unit: 'gr' },
    { value: 'katki', label: 'Katkı Maddesi', unit: 'kg' },
    { value: 'diger_hammadde', label: 'Diğer Hammadde' },
  ],
  operasyonel: [
    { value: 'elektrik', label: 'Elektrik', unit: 'kWh' },
    { value: 'yakit', label: 'Genel Yakıt / Mazot', unit: 'litre' },
    { value: 'forklift_mazot', label: 'Forklift Mazot Gideri', unit: 'litre' },
    { value: 'personel', label: 'Personel Maaşları', unit: 'kişi' },
    { value: 'iscilik', label: 'İşçilik Giderleri' },
    { value: 'bakim', label: 'Bakım - Onarım' },
    { value: 'diger_operasyonel', label: 'Diğer Operasyonel' },
  ],
  genel: [
    { value: 'kira', label: 'Kira' },
    { value: 'ofis', label: 'Ofis Giderleri' },
    { value: 'amortisman', label: 'Amortisman' },
    { value: 'diger_genel', label: 'Diğer Genel' },
  ],
};

const COST_TYPE_LABELS: Record<CostType, { label: string; color: string; bg: string }> = {
  hammadde: { label: 'Hammadde', color: 'text-amber-700', bg: 'bg-amber-100' },
  operasyonel: { label: 'Operasyonel', color: 'text-blue-700', bg: 'bg-blue-100' },
  genel: { label: 'Genel', color: 'text-emerald-700', bg: 'bg-emerald-100' },
};

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function CostForm({ onSave, onClose }: { onSave: () => void; onClose: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState<CostFormData>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [autoCalc, setAutoCalc] = useState(true);

  const subTypes = SUB_TYPES[form.cost_type];

  const handleTypeChange = (type: CostType) => {
    setForm(f => ({ ...f, cost_type: type, sub_type: '', unit: '' }));
  };

  const handleSubTypeChange = (value: string) => {
    const st = subTypes.find(s => s.value === value);
    setForm(f => ({ ...f, sub_type: value, unit: st?.unit || f.unit }));
  };

  useEffect(() => {
    if (autoCalc && form.quantity > 0 && form.unit_price > 0) {
      const total = form.quantity * form.unit_price + form.transport_cost;
      setForm(f => ({ ...f, total_amount: total }));
    }
  }, [form.quantity, form.unit_price, form.transport_cost, autoCalc]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sub_type) { setError('Gider türü seçiniz.'); return; }
    if (form.total_amount <= 0) { setError('Toplam tutar 0 olamaz.'); return; }
    setSaving(true); setError('');
    const { error: err } = await supabase.from('cost_entries').insert({ ...form, created_by: user?.id });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tarih *</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Dönem Ay</label>
          <select value={form.period_month} onChange={e => setForm(f => ({ ...f, period_month: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Dönem Yıl</label>
          <input type="number" min="2020" max="2099" value={form.period_year}
            onChange={e => setForm(f => ({ ...f, period_year: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Gider Kategorisi *</label>
        <div className="flex gap-2">
          {(Object.keys(COST_TYPE_LABELS) as CostType[]).map(type => {
            const info = COST_TYPE_LABELS[type];
            return (
              <button key={type} type="button"
                onClick={() => handleTypeChange(type)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${form.cost_type === type ? `${info.bg} ${info.color} border-current` : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                {info.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Gider Türü *</label>
        <select value={form.sub_type} onChange={e => handleSubTypeChange(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" required>
          <option value="">Tür seçin...</option>
          {subTypes.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Açıklama</label>
        <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          placeholder="Fatura no, tedarikçi adı vb." />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Miktar</label>
          <input type="number" min="0" step="0.001" value={form.quantity}
            onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Birim</label>
          <input type="text" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
            placeholder="kg, litre..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Birim Fiyat (₺)</label>
          <input type="number" min="0" step="0.01" value={form.unit_price}
            onChange={e => setForm(f => ({ ...f, unit_price: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Nakliye (₺)</label>
          <input type="number" min="0" step="0.01" value={form.transport_cost}
            onChange={e => setForm(f => ({ ...f, transport_cost: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-700 mb-1">Toplam Tutar (₺) *</label>
          <input type="number" min="0" step="0.01" value={form.total_amount}
            onChange={e => { setAutoCalc(false); setForm(f => ({ ...f, total_amount: Number(e.target.value) })); }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-lg font-semibold" required />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" id="autoCalc" checked={autoCalc} onChange={e => setAutoCalc(e.target.checked)} className="rounded" />
          <label htmlFor="autoCalc" className="text-xs text-slate-500">Otomatik hesapla</label>
        </div>
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
          className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-60 flex items-center gap-2">
          {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Kaydet
        </button>
      </div>
    </form>
  );
}

export default function Costs() {
  const { isAdmin } = useAuth();
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState(CURRENT_MONTH);
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('cost_entries')
      .select('*')
      .eq('period_month', filterMonth)
      .eq('period_year', filterYear)
      .order('date', { ascending: false });
    setEntries(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterMonth, filterYear]);

  const handleDelete = async (id: string) => {
    if (!confirm('Bu gider kaydını silmek istediğinize emin misiniz?')) return;
    setDeleting(id);
    await supabase.from('cost_entries').delete().eq('id', id);
    setDeleting(null);
    load();
  };

  const filtered = entries.filter(e => {
    const typeMatch = filterType === 'all' || e.cost_type === filterType;
    const q = search.toLowerCase();
    const searchMatch = !search || e.description?.toLowerCase().includes(q) || e.sub_type.toLowerCase().includes(q);
    return typeMatch && searchMatch;
  });

  const totals = filtered.reduce((acc, e) => {
    acc[e.cost_type] = (acc[e.cost_type] || 0) + e.total_amount;
    acc.total = (acc.total || 0) + e.total_amount;
    return acc;
  }, {} as Record<string, number>);

  const SUB_LABELS: Record<string, string> = {
    cimento: 'Çimento', agrega: 'Agrega/Kum', boya: 'Boya', katki: 'Katkı Maddesi',
    elektrik: 'Elektrik', yakit: 'Yakıt', personel: 'Personel', bakim: 'Bakım-Onarım',
    kira: 'Kira', ofis: 'Ofis', amortisman: 'Amortisman',
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <DollarSign size={24} className="text-emerald-600" /> Maliyet Giderleri
          </h1>
          <p className="text-slate-500 text-sm mt-1">Hammadde, operasyonel ve genel gider takip modülü</p>
        </div>
        {isAdmin() && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm">
            <Plus size={18} /> Yeni Gider Girişi
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Toplam Gider', value: totals.total || 0, color: 'text-slate-900', bg: 'bg-white' },
          { label: 'Hammadde', value: totals.hammadde || 0, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'Operasyonel', value: totals.operasyonel || 0, color: 'text-blue-700', bg: 'bg-blue-50' },
          { label: 'Genel', value: totals.genel || 0, color: 'text-emerald-700', bg: 'bg-emerald-50' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} rounded-xl p-4 shadow-sm border border-slate-100`}>
            <p className={`text-lg font-bold ${s.color}`}>₺{(s.value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-48 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Açıklama veya tür ara..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>

          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
            <option value="all">Tüm Kategoriler</option>
            <option value="hammadde">Hammadde</option>
            <option value="operasyonel">Operasyonel</option>
            <option value="genel">Genel</option>
          </select>

          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>

          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 bg-slate-50 border-b border-slate-100">
                  {['Tarih', 'Kategori', 'Tür', 'Açıklama', 'Miktar', 'Birim Fiyat', 'Nakliye', 'Toplam', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-medium text-xs uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-slate-400">Kayıt bulunamadı.</td></tr>
                ) : filtered.map(entry => {
                  const typeInfo = COST_TYPE_LABELS[entry.cost_type];
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-slate-600">{new Date(entry.date).toLocaleDateString('tr-TR')}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo?.bg} ${typeInfo?.color}`}>{typeInfo?.label}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{SUB_LABELS[entry.sub_type] || entry.sub_type}</td>
                      <td className="px-4 py-3 text-slate-500 max-w-48 truncate">{entry.description || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.quantity > 0 ? `${entry.quantity} ${entry.unit}` : '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.unit_price > 0 ? `₺${entry.unit_price}` : '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.transport_cost > 0 ? `₺${entry.transport_cost}` : '-'}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">₺{entry.total_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3">
                        {isAdmin() && (
                          <button onClick={() => handleDelete(entry.id)} disabled={deleting === entry.id}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            {deleting === entry.id
                              ? <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                              : <Trash2 size={14} />}
                          </button>
                        )}
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
        <Modal title="Yeni Gider Girişi" onClose={() => setShowModal(false)} size="lg">
          <CostForm onSave={() => { setShowModal(false); load(); }} onClose={() => setShowModal(false)} />
        </Modal>
      )}
    </div>
  );
}
