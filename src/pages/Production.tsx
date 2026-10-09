import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ProductionEntry, Product, Company } from '../types';
import Modal from '../components/Modal';
import {
  Plus, Factory, Search, Filter, Calendar, CreditCard as Edit2,
  AlertCircle, Trash2, Sparkles, Download, Layers, Package,
  ChevronDown, ChevronUp, RotateCcw, Printer, CheckCircle2, TrendingUp, X, Target,
  BookOpen, ArrowRight, Check, ArrowUp, Building2
} from 'lucide-react';

export const generateDefaultLot = (dateStr: string, machine: string, shift: string) => {
  const cleanDate = (dateStr || new Date().toISOString().split('T')[0]).replace(/-/g, '');
  const shiftChar = shift === 'Gece' ? 'GEC' : 'GUN';
  return `LOT-${cleanDate}-M${machine}-${shiftChar}`;
};

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
  lot_number: generateDefaultLot(new Date().toISOString().split('T')[0], '1', 'Gündüz'),
  notes: '',
  plan_item_id: null,
};

function ProductionForm({ products, onSave, onClose, initial, targetCompanyId }: {
  products: Product[];
  onSave: (savedInfo?: any) => void;
  onClose: () => void;
  initial?: ProductionEntry;
  targetCompanyId?: string | null;
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
  const [bomItems, setBomItems] = useState<any[]>([]);

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

  // Load Reçete (BOM) items for the selected product
  useEffect(() => {
    if (!form.product_id) {
      setBomItems([]);
      return;
    }
    supabase
      .from('bom_items')
      .select('*, raw_materials(*)')
      .eq('product_id', form.product_id)
      .then(({ data }) => setBomItems(data || []))
      .catch(() => setBomItems([]));
  }, [form.product_id]);

  const selectedProduct = products.find(p => p.id === form.product_id);

  const handleProductChange = (productId: string) => {
    const p = products.find(x => x.id === productId);
    let m2 = form.total_m2;
    if (p && form.total_pallets > 0) {
      m2 = parseFloat((form.total_pallets * p.m2_per_pallet).toFixed(2));
    }
    setForm(f => ({ ...f, product_id: productId, total_m2: m2 }));
  };

  const handlePalletsChange = (pallets: number) => {
    const m2 = selectedProduct ? parseFloat((pallets * selectedProduct.m2_per_pallet).toFixed(2)) : 0;
    setForm(f => ({ ...f, total_pallets: pallets, total_m2: m2 }));
  };

  const handleM2Change = (m2Val: number) => {
    const pallets = (selectedProduct && selectedProduct.m2_per_pallet > 0)
      ? Math.round(m2Val / selectedProduct.m2_per_pallet)
      : form.total_pallets;
    setForm(f => ({ ...f, total_m2: m2Val, total_pallets: pallets }));
  };

  const handleQuickWaste = (pct: number) => {
    const waste = parseFloat(((form.total_m2 * pct) / 100).toFixed(2));
    setForm(f => ({ ...f, waste_m2: waste }));
  };

  const handleDateChange = (newDate: string) => {
    setForm(f => {
      const isAutoLot = !initial && (!f.lot_number || f.lot_number.startsWith('LOT-'));
      return {
        ...f,
        date: newDate,
        lot_number: isAutoLot ? generateDefaultLot(newDate, f.machine_no, f.shift) : f.lot_number,
      };
    });
  };

  const handleShiftChange = (newShift: 'Gündüz' | 'Gece') => {
    setForm(f => {
      const isAutoLot = !initial && (!f.lot_number || f.lot_number.startsWith('LOT-'));
      return {
        ...f,
        shift: newShift,
        lot_number: isAutoLot ? generateDefaultLot(f.date, f.machine_no, newShift) : f.lot_number,
      };
    });
  };

  const handleMachineChange = (newMachine: string) => {
    setForm(f => {
      const isAutoLot = !initial && (!f.lot_number || f.lot_number.startsWith('LOT-'));
      return {
        ...f,
        machine_no: newMachine,
        lot_number: isAutoLot ? generateDefaultLot(f.date, newMachine, f.shift) : f.lot_number,
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.product_id) { setError('Lütfen üretilen ürünü seçiniz.'); return; }
    if (form.total_pallets <= 0 && form.total_m2 <= 0) {
      setError('Lütfen üretilen palet veya metraj miktarını giriniz.');
      return;
    }
    if (form.waste_m2 > form.total_m2) { setError('Fire miktarı toplam miktardan fazla olamaz.'); return; }
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      created_by: user?.id,
      ...(targetCompanyId ? { company_id: targetCompanyId } : {}),
    };
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

    const savedInfo = {
      productName: selectedProduct?.name || 'Ürün',
      lotNumber: form.lot_number,
      machineNo: form.machine_no,
      shift: form.shift,
      pallets: form.total_pallets,
      netM2: Math.max(0, form.total_m2 - form.waste_m2),
      unit: selectedProduct?.unit || 'm²',
      date: form.date,
      isEdit: !!initial,
    };

    onSave(savedInfo);
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
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            İş Emrini Yükle
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Tarih *</label>
          <input type="date" value={form.date} onChange={e => handleDateChange(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm font-medium" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Vardiya *</label>
          <select value={form.shift} onChange={e => handleShiftChange(e.target.value as any)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-semibold text-sm">
            <option value="Gündüz">☀️ Gündüz Vardiyası</option>
            <option value="Gece">🌙 Gece Vardiyası</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Makine / Hat *</label>
          <select value={form.machine_no} onChange={e => handleMachineChange(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold text-sm">
            <option value="1">1 Nolu Parke Makinesi (Hat 1)</option>
            <option value="2">2 Nolu Parke & Bordür Makinesi (Hat 2)</option>
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-slate-700">Lot Numarası *</label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, lot_number: generateDefaultLot(f.date, f.machine_no, f.shift) }))}
              className="text-[11px] text-amber-600 hover:text-amber-800 font-semibold cursor-pointer"
              title="Standart lot kodunu yeniden oluştur"
            >
              🔄 Otomatik Doldur
            </button>
          </div>
          <input type="text" value={form.lot_number} onChange={e => setForm(f => ({ ...f, lot_number: e.target.value }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono text-sm"
            placeholder="LOT-20260927-M1-GUN" required />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Üretilen Ürün *</label>
        <select value={form.product_id} onChange={e => handleProductChange(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 font-medium text-sm" required>
          <option value="">Ürün seçiniz...</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.product_type} / {p.thickness} / {p.color} ({p.unit === 'metre' ? 'Metre' : p.unit === 'adet' ? 'Adet' : 'm²'})
            </option>
          ))}
        </select>
        {selectedProduct && (
          <div className="flex items-center justify-between mt-1 text-xs text-slate-500">
            <span>📦 1 Palet = <strong>{selectedProduct.m2_per_pallet}</strong> {selectedProduct.unit === 'metre' ? 'Metre' : selectedProduct.unit === 'adet' ? 'Adet' : 'm²'}</span>
            <span className="text-amber-600 font-medium">Birim: {selectedProduct.unit || 'm²'}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Toplam Palet *</label>
          <input type="number" min="0" step="1" value={form.total_pallets || ''}
            onChange={e => handlePalletsChange(Number(e.target.value))}
            placeholder="0"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold text-slate-900" required />
          <p className="text-[10px] text-slate-400 mt-0.5">Palet girince m² otomatik hesaplanır</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Toplam {selectedProduct?.unit === 'metre' ? 'Metre' : selectedProduct?.unit === 'adet' ? 'Adet' : 'm²'}
          </label>
          <input type="number" min="0" step="0.01" value={form.total_m2 || ''}
            onChange={e => handleM2Change(Number(e.target.value))}
            placeholder="0.00"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-amber-50/30 font-semibold" />
          <p className="text-[10px] text-slate-400 mt-0.5">Metraj girince palet güncellenir</p>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-slate-700">
              Fire ({selectedProduct?.unit === 'metre' ? 'm' : selectedProduct?.unit === 'adet' ? 'ad.' : 'm²'})
            </label>
          </div>
          <input type="number" min="0" step="0.01" value={form.waste_m2}
            onChange={e => setForm(f => ({ ...f, waste_m2: Number(e.target.value) }))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 text-red-600 font-semibold" />
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {[0, 1, 2, 3].map(pct => (
              <button
                key={pct}
                type="button"
                onClick={() => handleQuickWaste(pct)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors cursor-pointer ${
                  form.total_m2 > 0 && form.waste_m2 === parseFloat(((form.total_m2 * pct) / 100).toFixed(2))
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                %{pct} Fire
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-sm">
        <span className="font-semibold text-amber-900">
          Net Üretim ({selectedProduct?.unit === 'metre' ? 'Metre' : selectedProduct?.unit === 'adet' ? 'Adet' : 'm²'}):
        </span>
        <span className="text-base font-bold text-amber-800">
          {Math.max(form.total_m2 - form.waste_m2, 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}{' '}
          {selectedProduct?.unit === 'metre' ? 'Metre' : selectedProduct?.unit === 'adet' ? 'Adet' : 'm²'}
        </span>
      </div>

      {/* 🧪 Reçeteye Göre Canlı Hammadde Sarfiyat Önizlemesi */}
      {bomItems.length > 0 && Math.max(0, form.total_m2 - form.waste_m2) > 0 && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
              <BookOpen size={14} className="text-emerald-600" />
              🧪 Reçeteye Göre Tahmini Hammadde Sarfiyatı (Net {Math.max(0, form.total_m2 - form.waste_m2).toLocaleString('tr-TR')} {selectedProduct?.unit || 'm²'} için):
            </span>
            <span className="text-[10px] bg-emerald-200 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
              {bomItems.length} Hammadde
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            {bomItems.map((item: any) => {
              const netQty = Math.max(0, form.total_m2 - form.waste_m2);
              const totalRaw = item.quantity_per_m2 * netQty;
              const isTon = item.raw_materials?.unit === 'kg' && totalRaw >= 1000;
              return (
                <div key={item.id} className="bg-white/95 rounded-lg p-2 border border-emerald-100 shadow-2xs">
                  <span className="text-[11px] font-semibold text-slate-700 block truncate">
                    {item.raw_materials?.name || 'Hammadde'}
                  </span>
                  <span className="text-xs font-bold text-emerald-700">
                    {totalRaw.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {item.raw_materials?.unit || 'kg'}
                    {isTon && (
                      <span className="text-[10px] text-slate-500 font-normal ml-1">
                        ({(totalRaw / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} Ton)
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Birim: {item.quantity_per_m2} {item.raw_materials?.unit || 'kg'} / {selectedProduct?.unit || 'm²'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notlar</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none text-sm"
          rows={2} placeholder="Opsiyonel vardiya notları..." />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium cursor-pointer">
          İptal
        </button>
        <button type="submit" disabled={saving}
          className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold text-sm transition-colors disabled:opacity-60 flex items-center gap-2 cursor-pointer shadow-xs">
          {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {initial ? 'Güncelle' : 'Kaydet'}
        </button>
      </div>
    </form>
  );
}

const getLocalDateStr = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface ProductionProps {
  onNavigate?: (page: any) => void;
}

export default function Production({ onNavigate }: ProductionProps = {}) {
  const { isSuperAdmin, profile } = useAuth();

  // Multi-Tenant Isolation & Super Admin Company Switching (Senkronize Matris & Sevkiyat Seçimi)
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    return localStorage.getItem('parke_matrix_selected_company') || '';
  });

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

  const [entries, setEntries] = useState<ProductionEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState<ProductionEntry | undefined>();
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  const [savedSuccessInfo, setSavedSuccessInfo] = useState<any | null>(null);

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

  // Filters
  const [search, setSearch] = useState('');
  const [dateFilterMode, setDateFilterMode] = useState<'this_month' | 'this_week' | 'today' | 'custom' | 'all'>('this_month');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => getLocalDateStr(new Date()));
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [selectedShift, setSelectedShift] = useState<'all' | 'Gündüz' | 'Gece'>('all');
  const [selectedMachine, setSelectedMachine] = useState<'all' | '1' | '2'>('all');

  // Breakdown accordion toggle
  const [showProductBreakdown, setShowProductBreakdown] = useState<boolean>(true);

  const load = async () => {
    setLoading(true);
    const isDefaultCompany =
      !targetCompanyId ||
      targetCompanyId === companies[0]?.id ||
      targetCompanyId === profile?.company_id;

    let prodQuery = supabase.from('products').select('*').eq('is_active', true).order('name');
    let prodListQuery = supabase
      .from('production_entries')
      .select('*, products(*)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (targetCompanyId) {
      if (isDefaultCompany) {
        prodQuery = prodQuery.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
        prodListQuery = prodListQuery.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
      } else {
        prodQuery = prodQuery.eq('company_id', targetCompanyId);
        prodListQuery = prodListQuery.eq('company_id', targetCompanyId);
      }
    }

    const [prodRes, prodListRes] = await Promise.all([
      prodQuery,
      prodListQuery,
    ]);

    let productList = (prodRes.data || []) as Product[];
    let prodEntries = (prodListRes.data || []) as ProductionEntry[];

    // Air-tight multi-tenant isolation:
    if (targetCompanyId) {
      productList = productList.filter((p: any) => {
        if (p.company_id && p.company_id !== targetCompanyId) return false;
        if (!p.company_id && !isDefaultCompany) return false;
        return true;
      });

      prodEntries = prodEntries.filter((e: any) => {
        // If entry explicitly belongs to another company, drop it
        if (e.company_id && e.company_id !== targetCompanyId) return false;
        // If product explicitly belongs to another company, drop it
        if (e.products?.company_id && e.products.company_id !== targetCompanyId) return false;
        // If neither has company_id, only keep if viewing default company
        if (!e.company_id && !e.products?.company_id && !isDefaultCompany) return false;
        return true;
      });
    }

    // Auto-backfill unassigned production entries in background
    if (isSuperAdmin() && prodEntries.length > 0) {
      const unassigned = prodEntries.filter((e: any) => !e.company_id);
      if (unassigned.length > 0) {
        const defaultCompId = profile?.company_id || companies[0]?.id;
        unassigned.slice(0, 50).forEach((e: any) => {
          const compId = e.products?.company_id || defaultCompId;
          if (compId) {
            supabase.from('production_entries').update({ company_id: compId }).eq('id', e.id).then();
          }
        });
      }
    }

    setProducts(productList);
    setEntries(prodEntries);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [targetCompanyId]);

  const handleDatePreset = (preset: 'today' | 'this_week' | 'this_month' | 'all') => {
    setDateFilterMode(preset);
    const now = new Date();
    const todayStr = getLocalDateStr(now);

    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'this_week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const monday = new Date(now.setDate(diff));
      setStartDate(getLocalDateStr(monday));
      setEndDate(todayStr);
    } else if (preset === 'this_month') {
      const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      setStartDate(firstDay);
      setEndDate(todayStr);
    } else if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    }
  };

  const filtered = useMemo(() => {
    return entries.filter(e => {
      // 1. Text search
      const q = search.trim().toLowerCase();
      const searchMatch = !q ||
        (e.products?.name && e.products.name.toLowerCase().includes(q)) ||
        (e.lot_number && e.lot_number.toLowerCase().includes(q)) ||
        (e.notes && e.notes.toLowerCase().includes(q)) ||
        e.machine_no.includes(q);

      // 2. Date range
      let dateMatch = true;
      if (startDate && endDate) {
        dateMatch = e.date >= startDate && e.date <= endDate;
      } else if (startDate) {
        dateMatch = e.date >= startDate;
      } else if (endDate) {
        dateMatch = e.date <= endDate;
      }

      // 3. Product filter
      const productMatch = selectedProductId === 'all' || e.product_id === selectedProductId;

      // 4. Shift filter
      const shiftMatch = selectedShift === 'all' || e.shift === selectedShift;

      // 5. Machine filter
      const machineMatch = selectedMachine === 'all' || e.machine_no === selectedMachine;

      return searchMatch && dateMatch && productMatch && shiftMatch && machineMatch;
    });
  }, [entries, search, startDate, endDate, selectedProductId, selectedShift, selectedMachine]);

  // Overall totals across filtered entries
  let totalParkeM2 = 0;
  let totalBordurMetre = 0;
  let totalAdet = 0;
  let totalWasteM2 = 0;
  let totalWasteMetre = 0;
  let totalPalletsSum = 0;

  filtered.forEach(e => {
    const u = e.products?.unit;
    const net = Number(e.net_m2) || 0;
    const waste = Number(e.waste_m2) || 0;
    const pallets = Number(e.total_pallets) || 0;
    totalPalletsSum += pallets;

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

  // Product-based aggregation summary list for the selected period
  const productSummaryList = useMemo(() => {
    const map: Record<string, {
      product: Product;
      totalNet: number;
      totalPallets: number;
      totalWaste: number;
      totalGross: number;
      entryCount: number;
      machine1Net: number;
      machine2Net: number;
      unit: string;
    }> = {};

    filtered.forEach(e => {
      if (!e.product_id || !e.products) return;
      if (!map[e.product_id]) {
        map[e.product_id] = {
          product: e.products,
          totalNet: 0,
          totalPallets: 0,
          totalWaste: 0,
          totalGross: 0,
          entryCount: 0,
          machine1Net: 0,
          machine2Net: 0,
          unit: e.products.unit || 'm²',
        };
      }
      const net = Number(e.net_m2) || 0;
      const gross = Number(e.total_m2) || 0;
      const waste = Number(e.waste_m2) || 0;
      const pallets = Number(e.total_pallets) || 0;

      map[e.product_id].totalNet += net;
      map[e.product_id].totalGross += gross;
      map[e.product_id].totalWaste += waste;
      map[e.product_id].totalPallets += pallets;
      map[e.product_id].entryCount += 1;
      if (e.machine_no === '1') {
        map[e.product_id].machine1Net += net;
      } else {
        map[e.product_id].machine2Net += net;
      }
    });

    return Object.values(map).sort((a, b) => b.totalNet - a.totalNet);
  }, [filtered]);

  // If a single product is selected
  const selectedProductObj = products.find(p => p.id === selectedProductId);
  const selectedProductStats = productSummaryList.find(p => p.product.id === selectedProductId);

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

  const handleExportExcel = () => {
    const prodTitle = selectedProductObj ? selectedProductObj.name : 'TUM_URUNLER';
    const dateRangeStr = `${startDate || 'BASLANGIC'}_${endDate || 'BUGUN'}`;

    let html = `
      <table border="1">
        <thead>
          <tr style="background-color: #1e293b; color: #ffffff; font-weight: bold; font-size: 14px;">
            <th colspan="12" style="padding: 10px; text-align: center;">
              PARKE ERP - ÜRETİM RAPORU (${dateRangeStr}) - ${prodTitle}
            </th>
          </tr>
          <tr style="background-color: #f1f5f9; font-weight: bold;">
            <th>Tarih</th>
            <th>Vardiya</th>
            <th>Makine</th>
            <th>Ürün Adı</th>
            <th>Kalınlık</th>
            <th>Renk</th>
            <th>Birim</th>
            <th>Palet</th>
            <th>Toplam Miktar</th>
            <th>Fire</th>
            <th>Net Üretim</th>
            <th>Lot No</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(e => `
            <tr>
              <td>${e.date}</td>
              <td>${e.shift}</td>
              <td>${e.machine_no} Nolu Hat</td>
              <td>${e.products?.name || ''}</td>
              <td>${e.products?.thickness || ''}</td>
              <td>${e.products?.color || ''}</td>
              <td>${e.products?.unit || 'm²'}</td>
              <td style="text-align: right;">${e.total_pallets}</td>
              <td style="text-align: right;">${Number(e.total_m2).toLocaleString('tr-TR')}</td>
              <td style="text-align: right; color: red;">${Number(e.waste_m2).toLocaleString('tr-TR')}</td>
              <td style="text-align: right; font-weight: bold; color: green;">${Number(e.net_m2).toLocaleString('tr-TR')}</td>
              <td>${e.lot_number}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="background-color: #fef3c7; font-weight: bold;">
            <td colspan="7">TOPLAM</td>
            <td style="text-align: right;">${totalPalletsSum}</td>
            <td style="text-align: right;">${(totalParkeM2 + totalBordurMetre + totalAdet + totalWasteM2 + totalWasteMetre).toLocaleString('tr-TR')}</td>
            <td style="text-align: right; color: red;">${(totalWasteM2 + totalWasteMetre).toLocaleString('tr-TR')}</td>
            <td style="text-align: right; color: green;">${(totalParkeM2 + totalBordurMetre + totalAdet).toLocaleString('tr-TR')}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    `;

    const uri = 'data:application/vnd.ms-excel;base64,';
    const template = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta http-equiv="content-type" content="text/plain; charset=UTF-8"/></head>
      <body>${html}</body>
    </html>`;
    const base64 = (s: string) => window.btoa(unescape(encodeURIComponent(s)));
    const link = document.createElement('a');
    link.href = uri + base64(template);
    link.download = `URETIM_RAPORU_${prodTitle}_${dateRangeStr}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ── TOP HEADER & ACTIONS ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Factory size={24} className="text-amber-500" /> Üretim Kayıtları & Dönemsel Analiz
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-bold bg-slate-100 text-slate-700 rounded-full border border-slate-200 flex items-center gap-1.5 shadow-2xs">
              <Building2 size={13} className="text-slate-500" />
              {activeCompanyName}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Tarih aralığı ve ürün bazlı filtreleme, vardiya üretim girişleri ve dönem analizi
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl font-bold text-xs transition-colors shadow-xs cursor-pointer"
            title="Seçilen tarih aralığı ve filtreye göre Excel (.xls) indir"
          >
            <Download size={15} /> Excel İndir
          </button>
          <button
            onClick={() => { setEditEntry(undefined); setShowModal(true); }}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-bold text-xs transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Yeni Üretim Girişi
          </button>
        </div>
      </div>

      {/* ── FILTER & DATE RANGE CONTROL PANEL ── */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4">
        {/* Row 1: Fast Date Presets & Range Inputs */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
              <Calendar size={14} className="text-amber-500" />
              Tarih Filtresi:
            </span>
            <button
              type="button"
              onClick={() => handleDatePreset('this_month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'this_month' ? 'bg-amber-500 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              📅 Bu Ay
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('this_week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'this_week' ? 'bg-amber-500 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              📅 Bu Hafta
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('today')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'today' ? 'bg-amber-500 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              📅 Bugün
            </button>
            <button
              type="button"
              onClick={() => handleDatePreset('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'all' ? 'bg-amber-500 text-white shadow-xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              🌐 Tüm Zamanlar
            </button>
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">Başlangıç:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  setDateFilterMode('custom');
                }}
                className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <span className="text-slate-400 font-bold">→</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">Bitiş:</span>
              <input
                type="date"
                value={endDate}
                onChange={e => {
                  setEndDate(e.target.value);
                  setDateFilterMode('custom');
                }}
                className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setDateFilterMode('all');
                }}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                title="Tarih filtresini kaldır"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Product, Machine, Shift Dropdowns & Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Product Dropdown Filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
              <Package size={13} className="text-amber-500" />
              Ürün Seçimi:
            </label>
            <select
              value={selectedProductId}
              onChange={e => setSelectedProductId(e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                selectedProductId !== 'all'
                  ? 'border-amber-400 bg-amber-50/60 text-amber-950 ring-1 ring-amber-300'
                  : 'border-slate-200 bg-white text-slate-800'
              }`}
            >
              <option value="all">Tüm Ürünler ({products.length} Ürün)</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.thickness ? `(${p.thickness})` : ''} {p.color ? `• ${p.color}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Machine Filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
              <Layers size={13} className="text-slate-400" />
              Üretim Makinesi:
            </label>
            <select
              value={selectedMachine}
              onChange={e => setSelectedMachine(e.target.value as any)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">Tüm Makineler</option>
              <option value="1">1 Nolu Makine (Hat 1)</option>
              <option value="2">2 Nolu Makine (Hat 2)</option>
            </select>
          </div>

          {/* Shift Filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
              <TrendingUp size={13} className="text-slate-400" />
              Vardiya:
            </label>
            <select
              value={selectedShift}
              onChange={e => setSelectedShift(e.target.value as any)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">Tüm Vardiyalar</option>
              <option value="Gündüz">Sadece Gündüz</option>
              <option value="Gece">Sadece Gece</option>
            </select>
          </div>

          {/* Text Search */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
              <Search size={13} className="text-slate-400" />
              Arama (Lot, Not):
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Lot no, açıklama..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>
      </div>

      {/* ── SELECTED SINGLE PRODUCT HERO BANNER (KULLANICI BELİRLİ BİR ÜRÜN SEÇTİĞİNDE) ── */}
      {selectedProductObj && (
        <div className="bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 rounded-2xl p-5 sm:p-6 text-white shadow-md relative overflow-hidden animate-fadeIn">
          <div className="absolute right-4 -bottom-6 opacity-10 pointer-events-none">
            <Package size={160} />
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-white text-[11px] font-bold backdrop-blur-xs flex items-center gap-1">
                  <Target size={12} /> Seçili Ürün İncelemesi
                </span>
                <span className="text-amber-100 text-xs font-mono">
                  {startDate && endDate ? `${startDate} → ${endDate}` : 'Tüm Zamanlar'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
                {selectedProductObj.name}
                <span className="text-xs font-medium px-2 py-0.5 bg-black/20 rounded-lg">
                  {selectedProductObj.thickness || ''} {selectedProductObj.color ? `• ${selectedProductObj.color}` : ''}
                </span>
              </h2>
              <p className="text-amber-100 text-xs mt-1">
                1 Palet = {selectedProductObj.m2_per_pallet} {selectedProductObj.unit || 'm²'} • Seçilen tarih aralığındaki toplam üretim performansı
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedProductId('all')}
              className="self-start md:self-auto px-3.5 py-2 bg-white/20 hover:bg-white/30 text-white text-xs font-bold rounded-xl backdrop-blur-xs transition-colors cursor-pointer border border-white/30 flex items-center gap-1.5"
            >
              <RotateCcw size={14} /> Tüm Ürünlere Dön
            </button>
          </div>

          {/* 4 Metric Counters for this specific product */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/20 relative z-10">
            <div className="bg-white/10 rounded-xl p-3 backdrop-blur-xs">
              <p className="text-2xl sm:text-3xl font-black tracking-tight">
                {selectedProductStats ? selectedProductStats.totalNet.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : 0}{' '}
                <span className="text-sm font-semibold opacity-90">{selectedProductObj.unit || 'm²'}</span>
              </p>
              <p className="text-amber-100 text-xs mt-0.5 font-medium">Toplam Net Üretim</p>
            </div>

            <div className="bg-white/10 rounded-xl p-3 backdrop-blur-xs">
              <p className="text-2xl sm:text-3xl font-black tracking-tight">
                {selectedProductStats ? selectedProductStats.totalPallets : 0}
                <span className="text-sm font-semibold opacity-90"> Palet</span>
              </p>
              <p className="text-amber-100 text-xs mt-0.5 font-medium">Toplam Üretilen Palet</p>
            </div>

            <div className="bg-white/10 rounded-xl p-3 backdrop-blur-xs">
              <p className="text-2xl sm:text-3xl font-black tracking-tight">
                {selectedProductStats ? selectedProductStats.totalWaste.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : 0}{' '}
                <span className="text-sm font-semibold opacity-90">{selectedProductObj.unit || 'm²'}</span>
              </p>
              <p className="text-amber-100 text-xs mt-0.5 font-medium">
                Fire ({selectedProductStats && selectedProductStats.totalGross > 0 ? ((selectedProductStats.totalWaste / selectedProductStats.totalGross) * 100).toFixed(1) : 0}%)
              </p>
            </div>

            <div className="bg-white/10 rounded-xl p-3 backdrop-blur-xs">
              <p className="text-2xl sm:text-3xl font-black tracking-tight">
                {selectedProductStats ? selectedProductStats.entryCount : 0}
                <span className="text-sm font-semibold opacity-90"> Vardiya</span>
              </p>
              <p className="text-amber-100 text-xs mt-0.5 font-medium">
                Hat 1: {selectedProductStats?.machine1Net.toLocaleString('tr-TR') || 0} • Hat 2: {selectedProductStats?.machine2Net.toLocaleString('tr-TR') || 0}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── GENERAL KPI SUMMARY (TÜM FİLTRELENEN VERİLER) ── */}
      {selectedProductId === 'all' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xl font-bold text-amber-600">
              {totalParkeM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
            </p>
            <p className="text-xs text-slate-500 mt-1">Dönem Net Parke</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xl font-bold text-amber-800">
              {totalBordurMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Metre
            </p>
            <p className="text-xs text-slate-500 mt-1">Dönem Net Bordür</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xl font-bold text-red-500">
              {totalWasteM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
              {totalWasteMetre > 0 && ` + ${totalWasteMetre.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m`}
            </p>
            <p className="text-xs text-slate-500 mt-1">Toplam Fire</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xl font-bold text-slate-700">
              {totalPalletsSum} Palet
              <span className="text-xs text-slate-400 font-normal ml-1">({filtered.length} Vardiya)</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">Toplam Üretim Hacmi</p>
          </div>
        </div>
      )}

      {/* ── PRODUCT BREAKDOWN TABLE (DÖNEM İÇİ TÜM ÜRÜNLERİN ÜRETİM DAĞILIMI) ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
              <Package size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                Dönem İçi Ürün Bazlı Üretim Dağılımı
                <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-800 rounded-full">
                  {productSummaryList.length} Farklı Ürün
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Seçilen tarih aralığında ({startDate || 'Başlangıç'} → {endDate || 'Bugün'}) hangi üründen ne kadar üretildi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowProductBreakdown(!showProductBreakdown)}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            title={showProductBreakdown ? 'Özeti Gizle' : 'Özeti Göster'}
          >
            {showProductBreakdown ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>

        {showProductBreakdown && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-4">Ürün Adı & Özellikleri</th>
                  <th className="py-2.5 px-4 text-center">Birim</th>
                  <th className="py-2.5 px-4 text-right">Üretilen Palet</th>
                  <th className="py-2.5 px-4 text-right">Net Üretim</th>
                  <th className="py-2.5 px-4 text-right">Fire</th>
                  <th className="py-2.5 px-4 text-right">Fire %</th>
                  <th className="py-2.5 px-4 text-center">Vardiya</th>
                  <th className="py-2.5 px-4 text-right">Makine 1 / 2</th>
                  <th className="py-2.5 px-4 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {productSummaryList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-slate-400 font-medium">
                      Seçilen tarih aralığında üretim kaydı bulunamadı.
                    </td>
                  </tr>
                ) : (
                  productSummaryList.map(item => {
                    const isSelected = selectedProductId === item.product.id;
                    const fireRate = item.totalGross > 0 ? ((item.totalWaste / item.totalGross) * 100).toFixed(1) : '0';
                    const unitLabel = item.product.unit === 'metre' ? 'Metre' : item.product.unit === 'adet' ? 'Adet' : 'm²';

                    return (
                      <tr
                        key={item.product.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-amber-100/50 font-semibold' : 'hover:bg-amber-50/30'
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            {isSelected && <CheckCircle2 size={14} className="text-amber-600" />}
                            <span>{item.product.name}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.product.thickness || ''} {item.product.color ? `• ${item.product.color}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-center font-medium text-slate-600">
                          {unitLabel}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-800">
                          {item.totalPallets}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-black text-amber-700 text-sm">
                          {item.totalNet.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {unitLabel}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-rose-600">
                          {item.totalWaste ? item.totalWaste.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                          %{fireRate}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono text-slate-700">
                          {item.entryCount}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-500 text-[11px]">
                          Hat 1: {item.machine1Net.toLocaleString('tr-TR')} | Hat 2: {item.machine2Net.toLocaleString('tr-TR')}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {isSelected ? (
                            <button
                              type="button"
                              onClick={() => setSelectedProductId('all')}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold transition-colors cursor-pointer"
                            >
                              Tümü
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSelectedProductId(item.product.id)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-900 rounded-lg text-[10px] font-bold border border-slate-200 transition-colors cursor-pointer"
                            >
                              Filtrele
                            </button>
                          )}
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

      {/* ── SHIFT-BY-SHIFT PRODUCTION ENTRIES TABLE ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Factory size={16} className="text-amber-500" />
            Vardiya Üretim Detay Kayıtları
            <span className="text-xs text-slate-400 font-normal">({filtered.length} Kayıt Listeleniyor)</span>
          </h3>
          <div className="flex items-center gap-2">
            {selectedProductId !== 'all' && (
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold">
                Filtre: {selectedProductObj?.name}
              </span>
            )}
            {showScrollTop && (
              <button
                type="button"
                onClick={scrollToTop}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-xs font-bold transition-all border border-amber-200 shadow-2xs cursor-pointer animate-in fade-in"
                title="Tablonun en başına çık"
              >
                <ArrowUp size={13} />
                <span className="hidden sm:inline">Yukarı Çık</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div
              ref={tableContainerRef}
              onScroll={handleTableScroll}
              className="overflow-x-auto overflow-y-auto max-h-[600px] custom-scrollbar border-b border-slate-100 relative"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#d97706 #f8fafc',
              }}
            >
              <table className="w-full text-sm border-collapse relative">
                <thead className="sticky top-0 z-20 shadow-xs">
                  <tr className="text-left text-slate-700 bg-slate-100 border-b border-slate-200 font-bold uppercase tracking-wider text-[11px]">
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Tarih</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Vardiya</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs font-mono">Makine</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Ürün</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Palet</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Toplam Miktar</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs text-red-500">Fire</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs text-amber-700">Net Üretim</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs">Lot No</th>
                    <th className="px-4 py-3 sticky top-0 bg-slate-100/95 backdrop-blur-xs text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
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
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditEntry(entry); setShowModal(true); }}
                            className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleDelete(entry)} disabled={deleting === entry.id}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
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

            {/* Table Footer Bar with Record Count & Quick Scroll */}
            <div className="p-3 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 font-medium">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800">{filtered.length} Vardiya Kaydı</span>
                <span className="text-slate-400">|</span>
                <span className="text-slate-500">Üretim & Fire Takip Kütüğü</span>
              </div>
              {filtered.length > 5 && (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-100 text-amber-700 font-bold rounded-lg border border-slate-200 transition-colors shadow-2xs cursor-pointer"
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

      {showModal && (
        <Modal
          title={editEntry ? 'Üretim Kaydını Düzenle' : 'Yeni Üretim Girişi'}
          onClose={() => setShowModal(false)}
          size="lg"
        >
          <ProductionForm
            products={products}
            targetCompanyId={targetCompanyId}
            onSave={(savedInfo) => {
              setShowModal(false);
              load();
              if (savedInfo && !savedInfo.isEdit) {
                setSavedSuccessInfo(savedInfo);
              }
            }}
            onClose={() => setShowModal(false)}
            initial={editEntry}
          />
        </Modal>
      )}

      {/* Kayıt Sonrası Başarı ve Hızlı Aksiyon Modalı */}
      {savedSuccessInfo && (
        <Modal
          title="Üretim Kaydı Başarılı"
          onClose={() => setSavedSuccessInfo(null)}
          size="md"
        >
          <div className="text-center py-2 space-y-4">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 size={36} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Üretim Kaydı Sisteme İşlendi!</h3>
              <p className="text-xs text-slate-500 mt-1">
                Günlük fabrika sahası hazır ürün stoğuna ve vardiya istatistiklerine yansıtıldı.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2 text-xs">
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">Üretilen Ürün:</span>
                <span className="font-bold text-slate-800">{savedSuccessInfo.productName}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">Lot Numarası:</span>
                <span className="font-mono font-bold text-amber-700">{savedSuccessInfo.lotNumber}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-1.5">
                <span className="text-slate-500">Makine / Hat:</span>
                <span className="font-semibold text-slate-700">{savedSuccessInfo.machineNo} Nolu Makine ({savedSuccessInfo.shift})</span>
              </div>
              <div className="flex justify-between pt-0.5">
                <span className="text-slate-500">Toplam Miktar:</span>
                <span className="font-bold text-emerald-700 text-sm">
                  {savedSuccessInfo.pallets} Palet • {savedSuccessInfo.netM2.toLocaleString('tr-TR')} {savedSuccessInfo.unit}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
              <button
                onClick={() => {
                  setSavedSuccessInfo(null);
                  setEditEntry(undefined);
                  setShowModal(true);
                }}
                className="w-full sm:flex-1 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <Plus size={15} /> + Yeni Üretim Gir
              </button>

              {onNavigate && (
                <button
                  onClick={() => {
                    setSavedSuccessInfo(null);
                    onNavigate('shipment');
                  }}
                  className="w-full sm:flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <ArrowRight size={15} /> Sevkiyata Git
                </button>
              )}

              <button
                onClick={() => setSavedSuccessInfo(null)}
                className="w-full sm:w-auto py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── FLOATING QUICK SCROLL TO TOP BUTTON ── */}
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-full shadow-2xl hover:shadow-amber-500/50 transition-all duration-300 transform hover:-translate-y-1 active:scale-95 cursor-pointer font-bold text-xs animate-in fade-in zoom-in-90 border-2 border-white"
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
          background: #d97706;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #b45309;
        }
      `}</style>
    </div>
  );
}
