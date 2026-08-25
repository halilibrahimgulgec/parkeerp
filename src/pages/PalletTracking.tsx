import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Customer, Site } from '../types';
import { 
  Boxes, Plus, Printer, RefreshCw, Save, Trash2, Calendar, ClipboardList, FileText
} from 'lucide-react';

interface PalletBalance {
  customer_id: string;
  customer_name: string;
  site_id: string | null;
  site_name: string | null;
  pallet_type: 'tahta' | 'sevkiyat' | 'uretim';
  total_sent: number;
  total_returned: number;
  balance: number;
}

interface PalletTransaction {
  id: string;
  date: string;
  customer_id: string;
  site_id: string | null;
  transaction_type: 'sent' | 'returned';
  pallet_type: 'tahta' | 'sevkiyat' | 'uretim';
  quantity: number;
  notes: string;
  customers?: { name: string };
  sites?: { name: string };
  shipments?: {
    invoice_no: string;
    shipment_items: {
      m2: number;
      unit: string;
      products: { name: string };
    }[];
  } | null;
}

const PALLET_LABELS: Record<string, string> = {
  tahta: 'Tahta Palet',
  sevkiyat: 'Sevkiyat Paleti',
  uretim: 'Üretim Paleti',
};

const PALLET_COLORS: Record<string, string> = {
  tahta: 'bg-amber-100 text-amber-800',
  sevkiyat: 'bg-blue-100 text-blue-800',
  uretim: 'bg-emerald-100 text-emerald-800',
};

export default function PalletTracking() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<PalletBalance[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [transactions, setTransactions] = useState<PalletTransaction[]>([]);
  
  // Date range filter for the Report
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Tab State
  const [activeTab, setActiveTab] = useState<'tracking' | 'reconciliation'>('tracking');

  // Reconciliation Report State
  const [reconCustomer, setReconCustomer] = useState('');
  const [reconSite, setReconSite] = useState('');
  const [reconStartDate, setReconStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [reconEndDate, setReconEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [reconProducts, setReconProducts] = useState<{ name: string; quantity: number; unit: string; pallets: number }[]>([]);
  const [reconPallets, setReconPallets] = useState<Record<string, { opening: number; sent: number; returned: number; ending: number }>>({
    tahta: { opening: 0, sent: 0, returned: 0, ending: 0 },
    sevkiyat: { opening: 0, sent: 0, returned: 0, ending: 0 },
    uretim: { opening: 0, sent: 0, returned: 0, ending: 0 },
  });
  const [reconLoading, setReconLoading] = useState(false);

  // Form State
  const [form, setForm] = useState({
    customer_id: '',
    site_id: '',
    pallet_type: 'sevkiyat' as 'tahta' | 'sevkiyat' | 'uretim',
    transaction_type: 'returned' as 'sent' | 'returned',
    quantity: '',
    notes: '',
    date: new Date().toISOString().split('T')[0],
  });

  const fetchReconciliation = useCallback(async () => {
    if (!reconCustomer) {
      setReconProducts([]);
      setReconPallets({
        tahta: { opening: 0, sent: 0, returned: 0, ending: 0 },
        sevkiyat: { opening: 0, sent: 0, returned: 0, ending: 0 },
        uretim: { opening: 0, sent: 0, returned: 0, ending: 0 },
      });
      return;
    }
    setReconLoading(true);

    try {
      // 1. Shipped products
      const shipQuery = supabase.from('shipments')
        .select('id, shipment_items(product_id, pallets, m2, unit, products(name))')
        .eq('customer_id', reconCustomer)
        .gte('shipment_date', reconStartDate)
        .lte('shipment_date', reconEndDate);
      
      if (reconSite) {
        shipQuery.eq('site_id', reconSite);
      }
      
      const { data: shipmentsData } = await shipQuery;

      const productMap: Record<string, { name: string; quantity: number; unit: string; pallets: number }> = {};
      shipmentsData?.forEach(s => {
        s.shipment_items?.forEach((item: any) => {
          const key = `${item.product_id}-${item.unit}`;
          if (!productMap[key]) {
            productMap[key] = {
              name: item.products?.name || 'Bilinmeyen Ürün',
              quantity: 0,
              unit: item.unit === 'm2' ? 'm²' : item.unit === 'adet' ? 'Adet' : item.unit === 'metre' ? 'Metre' : item.unit,
              pallets: 0
            };
          }
          productMap[key].quantity += item.m2 || 0;
          productMap[key].pallets += item.pallets || 0;
        });
      });
      setReconProducts(Object.values(productMap));

      // 2. Pallet balances (opening, period sent, period returned, ending)
      const transQuery = supabase.from('pallet_transactions')
        .select('*')
        .eq('customer_id', reconCustomer);
        
      if (reconSite) {
        transQuery.eq('site_id', reconSite);
      }
      
      const { data: allTrans } = await transQuery;

      const palletSummary: Record<string, { opening: number; sent: number; returned: number; ending: number }> = {
        tahta: { opening: 0, sent: 0, returned: 0, ending: 0 },
        sevkiyat: { opening: 0, sent: 0, returned: 0, ending: 0 },
        uretim: { opening: 0, sent: 0, returned: 0, ending: 0 },
      };
      
      allTrans?.forEach(t => {
        const qty = t.quantity || 0;
        const isBefore = t.date < reconStartDate;
        
        if (isBefore) {
          if (t.transaction_type === 'sent') {
            palletSummary[t.pallet_type].opening += qty;
          } else {
            palletSummary[t.pallet_type].opening -= qty;
          }
        } else if (t.date <= reconEndDate) {
          if (t.transaction_type === 'sent') {
            palletSummary[t.pallet_type].sent += qty;
          } else {
            palletSummary[t.pallet_type].returned += qty;
          }
        }
      });
      
      Object.keys(palletSummary).forEach(type => {
        const item = palletSummary[type];
        item.ending = item.opening + item.sent - item.returned;
      });

      setReconPallets(palletSummary);
    } catch (err) {
      console.error(err);
    } finally {
      setReconLoading(false);
    }
  }, [reconCustomer, reconSite, reconStartDate, reconEndDate]);

  useEffect(() => {
    fetchReconciliation();
  }, [fetchReconciliation]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [balRes, custRes, sitesRes, transRes] = await Promise.all([
      supabase.from('v_pallet_balances').select('*'),
      supabase.from('customers').select('*').eq('is_active', true).order('name'),
      supabase.from('sites').select('*').eq('is_active', true).order('name'),
      supabase.from('pallet_transactions')
        .select(`
          *, 
          customers(name), 
          sites(name),
          shipments (
            invoice_no,
            shipment_items (
              m2,
              unit,
              products (name)
            )
          )
        `)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);

    setBalances(balRes.data || []);
    setCustomers(custRes.data || []);
    setSites(sitesRes.data || []);
    setTransactions(transRes.data || []);
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load sites filtered by customer in the return form
  const activeSites = sites.filter(s => s.customer_id === form.customer_id);

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id || !form.quantity) return;
    setSubmitting(true);

    const { error } = await supabase.from('pallet_transactions').insert({
      date: form.date,
      customer_id: form.customer_id,
      site_id: form.site_id || null,
      transaction_type: form.transaction_type,
      pallet_type: form.pallet_type,
      quantity: parseInt(form.quantity),
      notes: form.notes || (form.transaction_type === 'sent' ? 'Manuel palet çıkışı / Devir' : 'Palet iade girişi'),
      created_by: user?.id,
    });

    if (error) {
      alert(`İşlem kaydedilirken hata oluştu: ${error.message}`);
    } else {
      setForm(f => ({ ...f, quantity: '', notes: '' }));
      await loadData();
    }
    setSubmitting(false);
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!confirm('Bu işlemi silmek istediğinize emin misiniz?')) return;
    const { error } = await supabase.from('pallet_transactions').delete().eq('id', id);
    if (error) {
      alert(`İşlem silinirken hata oluştu: ${error.message}`);
    } else {
      await loadData();
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const totalSummary = transactions.reduce((acc, t) => {
    const qty = t.quantity || 0;
    if (!acc[t.pallet_type]) {
      acc[t.pallet_type] = { sent: 0, returned: 0 };
    }
    if (t.transaction_type === 'sent') {
      acc[t.pallet_type].sent += qty;
    } else {
      acc[t.pallet_type].returned += qty;
    }
    return acc;
  }, {} as Record<string, { sent: number; returned: number }>);

  return (
    <div className="p-8 space-y-6">
      {/* ── STYLE TAG FOR A4 PRINTING ── */}
      <style>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
            font-size: 11px !important;
          }
          aside, button, form, .no-print, header, nav {
            display: none !important;
          }
          main, .print-container {
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            width: 100% !important;
          }
          table {
            width: 100% !important;
            table-layout: auto !important;
          }
          th, td {
            padding: 5px 6px !important;
            font-size: 10px !important;
            word-break: break-word !important;
          }
          .print-only {
            display: block !important;
          }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
            <Boxes size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Palet Zimmet & İade Takibi</h1>
            <p className="text-slate-500 text-sm">Şantiye bazlı palet çıkış ve iade kayıtları</p>
          </div>
        </div>
        <button
          onClick={activeTab === 'tracking' ? loadData : fetchReconciliation}
          className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors text-sm font-medium"
        >
          <RefreshCw size={16} /> Yenile
        </button>
      </div>

      {/* Tabs (no-print) */}
      <div className="flex border-b border-slate-200 no-print">
        <button
          onClick={() => setActiveTab('tracking')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'tracking'
              ? 'border-amber-500 text-amber-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-1.5"><ClipboardList size={16} /> Zimmet & İade Kaydı</span>
        </button>
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'reconciliation'
              ? 'border-amber-500 text-amber-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-1.5"><FileText size={16} /> Müşteri Hesaplaşma / Mutabakat Raporu</span>
        </button>
      </div>

      {activeTab === 'tracking' ? (
        loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              
              {/* ── SECTION 1: PALLET ENTRY FORM (no-print) ── */}
              <div className="space-y-6 xl:col-span-1 no-print">
                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                  <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Plus size={18} className="text-emerald-500" /> Manuel Palet & Devir Girişi
                  </h2>
                  <form onSubmit={handleSubmitReturn} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">İşlem Tipi *</label>
                      <select
                        value={form.transaction_type}
                        onChange={e => setForm(f => ({ ...f, transaction_type: e.target.value as any }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold"
                        required
                      >
                        <option value="returned">İADE GİRİŞİ (Müşteriden Bize Gelen)</option>
                        <option value="sent">ZİMMET / ÇIKIŞ / DEVİR (Bizden Müşteriye Giden)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Müşteri *</label>
                      <select
                        value={form.customer_id}
                        onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, site_id: '' }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        required
                      >
                        <option value="">Seçin...</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Şantiye / Saha</label>
                      <select
                        value={form.site_id}
                        onChange={e => setForm(f => ({ ...f, site_id: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        disabled={!form.customer_id || activeSites.length === 0}
                      >
                        <option value="">Müşteri sahası seçin...</option>
                        {activeSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Palet Tipi *</label>
                        <select
                          value={form.pallet_type}
                          onChange={e => setForm(f => ({ ...f, pallet_type: e.target.value as any }))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                          required
                        >
                          <option value="sevkiyat">Sevkiyat Paleti</option>
                          <option value="tahta">Tahta Palet</option>
                          <option value="uretim">Üretim Paleti</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Miktar (Adet) *</label>
                        <input
                          type="number"
                          min="1"
                          value={form.quantity}
                          onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                          placeholder="Örn: 50"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">İşlem Tarihi *</label>
                        <input
                          type="date"
                          value={form.date}
                          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Açıklama</label>
                      <input
                        type="text"
                        value={form.notes}
                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Örn: Geçmişten devir bakiyesi"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      <Save size={16} /> Kaydı Tamamla
                    </button>
                  </form>
                </div>
              </div>

              {/* ── SECTION 2: PALLET BALANCES per CLIENT & SITE ── */}
              <div className="space-y-6 xl:col-span-2 no-print">
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-200">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                      <ClipboardList size={18} className="text-amber-500" /> Güncel Palet Bakiyeleri
                    </h2>
                    <p className="text-slate-400 text-xs mt-1">Müşterilerdeki kalan net palet borçları</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead>
                        <tr className="text-slate-500 bg-slate-50 border-b border-slate-100 text-xs uppercase font-medium">
                          <th className="px-6 py-3">Müşteri / Şantiye</th>
                          <th className="px-6 py-3">Palet Tipi</th>
                          <th className="px-6 py-3 text-right">Gönderilen</th>
                          <th className="px-6 py-3 text-right">İade Edilen</th>
                          <th className="px-6 py-3 text-right">Net Bakiye</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {balances.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-slate-400">Palet hareket kaydı bulunmuyor.</td>
                          </tr>
                        ) : (
                          balances.map((b, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50">
                              <td className="px-6 py-4">
                                <p className="font-semibold text-slate-800">{b.customer_name}</p>
                                <p className="text-xs text-slate-400">{b.site_name || 'Direkt Sevkiyat'}</p>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PALLET_COLORS[b.pallet_type]}`}>
                                  {PALLET_LABELS[b.pallet_type]}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right font-medium text-slate-600">{b.total_sent}</td>
                              <td className="px-6 py-4 text-right font-medium text-slate-600">{b.total_returned}</td>
                              <td className="px-6 py-4 text-right">
                                <span className={`font-bold ${b.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                  {b.balance} adet
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>

            {/* ── SECTION 3: DAILY REPORT & PRINT VIEW ── */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 print-container">
              
              {/* Filter Controls */}
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-6 no-print">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Calendar size={18} className="text-blue-500" /> Palet Sevkiyat & İade Raporu
                  </h2>
                  <p className="text-slate-400 text-xs mt-1">Seçilen tarih aralığına ait tüm palet hareketleri ve sevk edilen malzemeler</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-500">Başlangıç:</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-500">Bitiş:</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-md ml-auto md:ml-0"
                  >
                    <Printer size={16} /> Yazdır / PDF
                  </button>
                </div>
              </div>

              {/* PRINT ONLY HEADER */}
              <div className="hidden print-only mb-6 text-center border-b-2 border-slate-800 pb-4">
                <h1 className="text-2xl font-bold text-slate-900">PARKE ERP — PALET VE SEVKİYAT RAPORU</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Rapor Tarih Aralığı: {new Date(startDate).toLocaleDateString('tr-TR')} - {new Date(endDate).toLocaleDateString('tr-TR')}
                </p>
              </div>

              {/* Daily Report Data Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-slate-500 bg-slate-50 border-b border-slate-200 text-xs uppercase font-medium">
                      <th className="px-4 py-3">Tarih</th>
                      <th className="px-4 py-3">Müşteri</th>
                      <th className="px-4 py-3">Şantiye/Saha</th>
                      <th className="px-4 py-3">Palet Tipi</th>
                      <th className="px-4 py-3">Hareket</th>
                      <th className="px-4 py-3 text-right">Adet</th>
                      <th className="px-4 py-3">Giden Ürünler</th>
                      <th className="px-4 py-3">Açıklama</th>
                      <th className="px-4 py-3 text-right no-print">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-slate-400">Seçilen tarih aralığında herhangi bir palet hareketi bulunmamaktadır.</td>
                      </tr>
                    ) : (
                      transactions.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50/30">
                          <td className="px-4 py-3.5 text-slate-600 whitespace-nowrap">{new Date(t.date).toLocaleDateString('tr-TR')}</td>
                          <td className="px-4 py-3.5 font-semibold text-slate-800">{t.customers?.name || '-'}</td>
                          <td className="px-4 py-3.5 text-slate-600">{t.sites?.name || 'Direkt Sevkiyat'}</td>
                          <td className="px-4 py-3.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PALLET_COLORS[t.pallet_type]}`}>
                              {PALLET_LABELS[t.pallet_type]}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                              t.transaction_type === 'sent' 
                                ? 'bg-red-50 text-red-700' 
                                : 'bg-green-50 text-green-700'
                            }`}>
                              {t.transaction_type === 'sent' ? 'ZİMMET (ÇIKIŞ)' : 'İADE (GİRİŞ)'}
                            </span>
                          </td>
                          <td className={`px-4 py-3.5 text-right font-bold ${
                            t.transaction_type === 'sent' ? 'text-red-600' : 'text-green-600'
                          }`}>
                            {t.transaction_type === 'sent' ? '+' : '-'}{t.quantity}
                          </td>
                          <td className="px-4 py-3.5">
                            {t.shipments?.shipment_items && t.shipments.shipment_items.length > 0 ? (
                              <div className="flex flex-col gap-1 max-w-[250px]">
                                {t.shipments.shipment_items.map((item, i) => (
                                  <span key={i} className="text-xs text-slate-700 bg-slate-100 rounded px-1.5 py-0.5 w-max font-medium truncate">
                                    {item.m2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {item.unit} - {item.products?.name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 text-xs italic">{t.notes}</td>
                          <td className="px-4 py-3.5 text-right no-print">
                            <button
                              onClick={() => handleDeleteTransaction(t.id)}
                              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                              title="İşlemi Sil"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Rapor Toplamları */}
              <div className="mt-6 border-t border-slate-300 pt-4">
                <h3 className="text-sm font-bold text-slate-800 mb-3">Seçilen Dönem Toplam Hareket Özeti</h3>
                <div className="grid grid-cols-3 gap-4">
                  {['sevkiyat', 'tahta', 'uretim'].map((type) => {
                    const sent = totalSummary[type]?.sent || 0;
                    const returned = totalSummary[type]?.returned || 0;
                    const net = sent - returned;
                    return (
                      <div key={type} className="border border-slate-300 rounded-xl p-3 bg-slate-50 text-xs">
                        <p className="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-1.5 uppercase tracking-wide">
                          {PALLET_LABELS[type]}
                        </p>
                        <div className="flex justify-between text-slate-600 font-medium">
                          <span>Toplam Giden (Zimmet):</span>
                          <span className="text-red-600">+{sent}</span>
                        </div>
                        <div className="flex justify-between text-slate-600 font-medium mt-1">
                          <span>Toplam Gelen (İade):</span>
                          <span className="text-green-600">-{returned}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-300 mt-2 pt-1.5 font-bold text-slate-900 text-sm">
                          <span>Net Değişim:</span>
                          <span className={net >= 0 ? 'text-red-700' : 'text-green-700'}>
                            {net >= 0 ? `+${net}` : net} adet
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer print layout info */}
              <div className="hidden print-only mt-12 flex justify-between text-xs text-slate-400 border-t border-slate-100 pt-4">
                <p>Sistem çıktısı: {new Date().toLocaleDateString('tr-TR')} {new Date().toLocaleTimeString('tr-TR')}</p>
                <p>Sayfa 1 / 1</p>
              </div>

            </div>
          </div>
        )
      ) : (
        /* ── SECTION 4: CUSTOMER RECONCILIATION REPORT ( Hesaplaşma Raporu ) ── */
        <div className="space-y-6">
          {/* Filter Controls (no-print) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 no-print space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FileText size={18} className="text-amber-500" /> Hesaplaşma & Mutabakat Raporu Oluştur
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Müşteri *</label>
                <select
                  value={reconCustomer}
                  onChange={e => { setReconCustomer(e.target.value); setReconSite(''); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Müşteri seçin...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Şantiye / Saha</label>
                <select
                  value={reconSite}
                  onChange={e => setReconSite(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  disabled={!reconCustomer}
                >
                  <option value="">Tüm Şantiyeler</option>
                  {sites.filter(s => s.customer_id === reconCustomer).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Başlangıç Tarihi</label>
                <input
                  type="date"
                  value={reconStartDate}
                  onChange={e => setReconStartDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Bitiş Tarihi</label>
                <input
                  type="date"
                  value={reconEndDate}
                  onChange={e => setReconEndDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handlePrint}
                disabled={!reconCustomer}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-md disabled:opacity-60"
              >
                <Printer size={16} /> Yazdır / PDF Al
              </button>
            </div>
          </div>

          {/* Rapor Çıktı Alanı */}
          {!reconCustomer ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 no-print">
              Lütfen raporunu oluşturmak istediğiniz firmayı yukarıdan seçiniz.
            </div>
          ) : reconLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 print-container space-y-6">
              
              {/* PRINT ONLY HEADER */}
              <div className="text-center border-b-2 border-slate-800 pb-4">
                <h1 className="text-2xl font-bold text-slate-900">MÜŞTERİ PALET & SEVKİYAT MUTABAKAT RAPORU</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Müşteri: <strong className="text-slate-800">{customers.find(c => c.id === reconCustomer)?.name}</strong>
                  {reconSite && <> | Şantiye: <strong className="text-slate-800">{sites.find(s => s.id === reconSite)?.name}</strong></>}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Rapor Dönemi: {new Date(reconStartDate).toLocaleDateString('tr-TR')} - {new Date(reconEndDate).toLocaleDateString('tr-TR')}
                </p>
              </div>

              {/* ── BÖLÜM 1: SEVK EDİLEN ÜRÜNLER (Ürün Ürün Malzeme) ── */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-1.5 mb-3 uppercase tracking-wide">
                  1. DÖNEM İÇİ SEVK EDİLEN ÜRÜNLER (MALZEME DETAYI)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-slate-500 bg-slate-50 border-b border-slate-200 font-medium">
                        <th className="px-4 py-2 w-1/2">Ürün Adı</th>
                        <th className="px-4 py-2 text-right w-1/4">Sevk Edilen Palet</th>
                        <th className="px-4 py-2 text-right w-1/4">Toplam Sevk Miktarı</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconProducts.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-4 py-4 text-center text-slate-400">Bu dönemde sevk edilmiş ürün bulunmamaktadır.</td>
                        </tr>
                      ) : (
                        reconProducts.map((p, i) => (
                          <tr key={i} className="hover:bg-slate-50/30">
                            <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                            <td className="px-4 py-2 text-right font-semibold text-slate-600">{p.pallets} adet</td>
                            <td className="px-4 py-2 text-right font-bold text-slate-700">{p.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {p.unit}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── BÖLÜM 2: PALET DETAYLARI (Giden, Dönen, Kalan) ── */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-1.5 mb-3 uppercase tracking-wide">
                  2. PALET HESAP CETVELİ (ZİMMET DURUMU)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-slate-500 bg-slate-50 border-b border-slate-200 font-medium text-center">
                        <th className="px-4 py-2 text-left">Palet Tipi</th>
                        <th className="px-4 py-2 text-right">Dönem Başı Devir</th>
                        <th className="px-4 py-2 text-right">Dönem İçi Giden (+ Zimmet)</th>
                        <th className="px-4 py-2 text-right">Dönem İçi Dönen (- İade)</th>
                        <th className="px-4 py-2 text-right font-bold">Kalan Bakiye (Zimmetli)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-right">
                      {['sevkiyat', 'tahta', 'uretim'].map((type) => {
                        const row = reconPallets[type] || { opening: 0, sent: 0, returned: 0, ending: 0 };
                        return (
                          <tr key={type} className="hover:bg-slate-50/30">
                            <td className="px-4 py-2 text-left font-semibold text-slate-800">{PALLET_LABELS[type]}</td>
                            <td className="px-4 py-2 text-slate-600 font-medium">{row.opening} adet</td>
                            <td className="px-4 py-2 text-red-600 font-medium">+{row.sent} adet</td>
                            <td className="px-4 py-2 text-green-600 font-medium">-{row.returned} adet</td>
                            <td className={`px-4 py-2 font-bold text-sm ${row.ending > 0 ? 'text-red-700' : 'text-green-700'}`}>
                              {row.ending} adet
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Rapor Alt Bilgi & İmza Alanı */}
              <div className="mt-12 grid grid-cols-2 gap-8 text-xs text-slate-500 pt-8 border-t border-slate-200">
                <div className="text-center space-y-12">
                  <p className="font-semibold text-slate-700">MÜŞTERİ / TESLİM ALAN</p>
                  <div className="border-b border-dashed border-slate-300 w-48 mx-auto mt-8"></div>
                  <p className="text-[10px] text-slate-400">Ad Soyad / İmza</p>
                </div>
                <div className="text-center space-y-12">
                  <p className="font-semibold text-slate-700">TESLİM EDEN / SEVKİYAT SORUMLUSU</p>
                  <div className="border-b border-dashed border-slate-300 w-48 mx-auto mt-8"></div>
                  <p className="text-[10px] text-slate-400">{user?.email?.split('@')[0]} / İmza</p>
                </div>
              </div>

              {/* Print Info Footer */}
              <div className="hidden print-only mt-8 flex justify-between text-[10px] text-slate-400 pt-4">
                <p>Sistem çıktısı: {new Date().toLocaleDateString('tr-TR')} {new Date().toLocaleTimeString('tr-TR')}</p>
                <p>Sayfa 1 / 1</p>
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}
