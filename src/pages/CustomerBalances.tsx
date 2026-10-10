import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Customer, CustomerPayment, CustomerBalanceSummary, CariStatementItem, Company, Site } from '../types';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  RefreshCw,
  FileSpreadsheet,
  Printer,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  X,
  Building2,
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  FileText,
  Clock,
  Eye,
  Phone,
  Wallet,
  Pencil,
  Trash2,
  Receipt,
  Users
} from 'lucide-react';

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  havale: 'Banka Havalesi / EFT',
  nakit: 'Nakit Tahsilat',
  cek: 'Çek',
  kredi_karti: 'Kredi Kartı',
  diger: 'Diğer',
};

const PAYMENT_TYPE_COLORS: Record<string, string> = {
  havale: 'bg-blue-100 text-blue-800 border-blue-200',
  nakit: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  cek: 'bg-purple-100 text-purple-800 border-purple-200',
  kredi_karti: 'bg-amber-100 text-amber-800 border-amber-200',
  diger: 'bg-slate-100 text-slate-800 border-slate-200',
};

export default function CustomerBalancesPage() {
  const { user, profile, isSuperAdmin } = useAuth();

  // Multi-tenant isolation
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    return localStorage.getItem('parke_cust_balances_selected_company') || '';
  });

  const targetCompanyId = useMemo(() => {
    if (isSuperAdmin()) {
      return selectedCompanyId || profile?.company_id || '';
    }
    return profile?.company_id || '';
  }, [isSuperAdmin, selectedCompanyId, profile?.company_id]);

  useEffect(() => {
    if (isSuperAdmin()) {
      supabase
        .from('companies')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setCompanies(data);
            if (!selectedCompanyId) {
              const defaultId = profile?.company_id || data[0].id;
              setSelectedCompanyId(defaultId);
              localStorage.setItem('parke_cust_balances_selected_company', defaultId);
            }
          }
        });
    }
  }, [isSuperAdmin, profile?.company_id, selectedCompanyId]);

  // Data states
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<CustomerBalanceSummary[]>([]);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);

  // Main Tab (Customers / Payments)
  const [activeMainTab, setActiveMainTab] = useState<'customers' | 'payments'>('customers');

  // Filters
  const [search, setSearch] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'debtor' | 'settled' | 'creditor'>('all');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<string>('all');

  // Modals & Editing State
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<CustomerPayment | null>(null);
  const [selectedCustomerIdForPayment, setSelectedCustomerIdForPayment] = useState<string>('');

  const [isStatementOpen, setIsStatementOpen] = useState(false);
  const [selectedCustomerForStatement, setSelectedCustomerForStatement] = useState<CustomerBalanceSummary | null>(null);
  const [statementItems, setStatementItems] = useState<CariStatementItem[]>([]);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [statementFilterDate, setStatementFilterDate] = useState<'all' | 'this_month' | 'this_year'>('all');

  // Payment Form State
  const [paymentForm, setPaymentForm] = useState({
    customer_id: '',
    date: new Date().toISOString().split('T')[0],
    payment_type: 'havale' as 'havale' | 'nakit' | 'cek' | 'kredi_karti' | 'diger',
    amount: '',
    document_no: '',
    bank_name: '',
    due_date: '',
    notes: '',
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // 1. Fetch Customers, Shipments & Payments to compute balances reliably
  const loadData = async () => {
    setLoading(true);
    try {
      // 1a. Customers
      let custQ = supabase.from('customers').select('*').eq('is_active', true).order('name', { ascending: true });
      if (targetCompanyId) custQ = custQ.eq('company_id', targetCompanyId);
      const { data: custData, error: custErr } = await custQ;
      if (custErr) throw custErr;
      const rawCustomers = custData || [];
      setCustomers(rawCustomers);

      // 1b. Payments
      let payQ = supabase
        .from('customer_payments')
        .select('*')
        .order('date', { ascending: false });
      if (targetCompanyId) payQ = payQ.eq('company_id', targetCompanyId);
      const { data: payData, error: payErr } = await payQ;

      if (payErr) {
        if (payErr.code === 'PGRST205' || payErr.message?.includes('customer_payments')) {
          setSchemaMissing(true);
        }
      } else {
        setSchemaMissing(false);
      }
      const rawPayments = payData || [];
      setPayments(rawPayments);

      // 1c. Completed Shipments with shipment_items
      let shipQ = supabase
        .from('shipments')
        .select('id, customer_id, invoice_no, shipment_date, sale_price_per_m2, total_m2, shipment_items(m2, unit_price, total_price)')
        .eq('status', 'completed');
      if (targetCompanyId) shipQ = shipQ.eq('company_id', targetCompanyId);
      const { data: shipData, error: shipErr } = await shipQ;
      if (shipErr) throw shipErr;
      const rawShipments = shipData || [];

      // Calculate totals per customer
      const debitByCustomer: Record<string, { total: number; lastDate: string | null }> = {};
      rawShipments.forEach((s: any) => {
        if (!s.customer_id) return;
        if (!debitByCustomer[s.customer_id]) {
          debitByCustomer[s.customer_id] = { total: 0, lastDate: null };
        }
        // Calculate shipment monetary total
        let shipAmount = 0;
        const items = s.shipment_items || [];
        if (items.length > 0) {
          items.forEach((it: any) => {
            const itTotal = Number(it.total_price) || (Number(it.m2) || 0) * (Number(it.unit_price) || 0);
            shipAmount += itTotal;
          });
        }
        // Fallback to average sale price
        if (shipAmount === 0 && Number(s.sale_price_per_m2) > 0) {
          shipAmount = (Number(s.total_m2) || 0) * Number(s.sale_price_per_m2);
        }

        debitByCustomer[s.customer_id].total += shipAmount;
        if (!debitByCustomer[s.customer_id].lastDate || s.shipment_date > debitByCustomer[s.customer_id].lastDate!) {
          debitByCustomer[s.customer_id].lastDate = s.shipment_date;
        }
      });

      const creditByCustomer: Record<string, { total: number; lastDate: string | null }> = {};
      rawPayments.forEach((p: any) => {
        if (!p.customer_id) return;
        if (!creditByCustomer[p.customer_id]) {
          creditByCustomer[p.customer_id] = { total: 0, lastDate: null };
        }
        creditByCustomer[p.customer_id].total += Number(p.amount) || 0;
        if (!creditByCustomer[p.customer_id].lastDate || p.date > creditByCustomer[p.customer_id].lastDate!) {
          creditByCustomer[p.customer_id].lastDate = p.date;
        }
      });

      const calculatedBalances: CustomerBalanceSummary[] = rawCustomers.map((c) => {
        const d = debitByCustomer[c.id] || { total: 0, lastDate: null };
        const cr = creditByCustomer[c.id] || { total: 0, lastDate: null };
        const totalDebit = Math.round(d.total * 100) / 100;
        const totalCredit = Math.round(cr.total * 100) / 100;
        const bal = Math.round((totalDebit - totalCredit) * 100) / 100;

        return {
          ...c,
          total_debit: totalDebit,
          total_credit: totalCredit,
          balance: bal,
          last_shipment_date: d.lastDate,
          last_payment_date: cr.lastDate,
        };
      });

      setBalances(calculatedBalances);
    } catch (err: any) {
      console.error('Cari bakiye verileri yüklenirken hata:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [targetCompanyId]);

  // KPI Calculations
  const stats = useMemo(() => {
    let totalMarketReceivables = 0; // Borçlu müşterilerin toplam bakiyesi
    let totalSettledCount = 0;
    let totalDebtorCount = 0;
    let thisMonthPayments = 0;
    let thisMonthShipmentsRevenue = 0;

    const currentYearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    balances.forEach((b) => {
      if (b.balance > 0.01) {
        totalMarketReceivables += b.balance;
        totalDebtorCount++;
      } else {
        totalSettledCount++;
      }
    });

    payments.forEach((p) => {
      if (p.date && p.date.startsWith(currentYearMonth)) {
        thisMonthPayments += Number(p.amount) || 0;
      }
    });

    return {
      totalMarketReceivables: Math.round(totalMarketReceivables),
      totalDebtorCount,
      totalSettledCount,
      thisMonthPayments: Math.round(thisMonthPayments),
    };
  }, [balances, payments]);

  // Filtered List
  const filteredBalances = useMemo(() => {
    let list = [...balances];

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.phone?.toLowerCase().includes(q) ||
          b.tax_number?.toLowerCase().includes(q)
      );
    }

    if (balanceFilter === 'debtor') {
      list = list.filter((b) => b.balance > 0.01);
    } else if (balanceFilter === 'settled') {
      list = list.filter((b) => Math.abs(b.balance) <= 0.01);
    } else if (balanceFilter === 'creditor') {
      list = list.filter((b) => b.balance < -0.01);
    }

    // Sort by largest debt first
    list.sort((a, b) => b.balance - a.balance);

    return list;
  }, [balances, search, balanceFilter]);

  // Filtered Payments List
  const filteredPayments = useMemo(() => {
    let list = [...payments];

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((p) => {
        const custName = customers.find((c) => c.id === p.customer_id)?.name?.toLowerCase() || '';
        return (
          custName.includes(q) ||
          p.document_no?.toLowerCase().includes(q) ||
          p.bank_name?.toLowerCase().includes(q) ||
          p.notes?.toLowerCase().includes(q) ||
          String(p.amount).includes(q)
        );
      });
    }

    if (paymentTypeFilter !== 'all') {
      list = list.filter((p) => p.payment_type === paymentTypeFilter);
    }

    return list;
  }, [payments, search, paymentTypeFilter, customers]);

  const filteredPaymentsTotal = useMemo(() => {
    return filteredPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [filteredPayments]);

  // Open Payment Modal (New or Edit)
  const handleOpenPayment = (customerId?: string, paymentToEdit?: CustomerPayment) => {
    if (paymentToEdit) {
      setEditingPayment(paymentToEdit);
      setSelectedCustomerIdForPayment(paymentToEdit.customer_id);
      setPaymentForm({
        customer_id: paymentToEdit.customer_id,
        date: paymentToEdit.date,
        payment_type: paymentToEdit.payment_type,
        amount: String(paymentToEdit.amount),
        document_no: paymentToEdit.document_no || '',
        bank_name: paymentToEdit.bank_name || '',
        due_date: paymentToEdit.due_date ? paymentToEdit.due_date.slice(0, 10) : '',
        notes: paymentToEdit.notes || '',
      });
    } else {
      setEditingPayment(null);
      setSelectedCustomerIdForPayment(customerId || (customers[0]?.id || ''));
      setPaymentForm({
        customer_id: customerId || (customers[0]?.id || ''),
        date: new Date().toISOString().split('T')[0],
        payment_type: 'havale',
        amount: '',
        document_no: '',
        bank_name: '',
        due_date: '',
        notes: '',
      });
    }
    setPaymentError('');
    setIsPaymentOpen(true);
  };

  // Save / Update Payment
  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.customer_id) {
      setPaymentError('Lütfen müşteri seçiniz.');
      return;
    }
    const amt = parseFloat(paymentForm.amount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) {
      setPaymentError('Lütfen geçerli bir tahsilat tutarı giriniz.');
      return;
    }

    setSavingPayment(true);
    setPaymentError('');

    try {
      const payload = {
        customer_id: paymentForm.customer_id,
        company_id: targetCompanyId || null,
        date: paymentForm.date,
        payment_type: paymentForm.payment_type,
        amount: amt,
        document_no: paymentForm.document_no.trim(),
        bank_name: paymentForm.bank_name.trim(),
        due_date: paymentForm.payment_type === 'cek' && paymentForm.due_date ? paymentForm.due_date : null,
        notes: paymentForm.notes.trim(),
        updated_at: new Date().toISOString(),
      };

      if (editingPayment) {
        const { error } = await supabase
          .from('customer_payments')
          .update(payload)
          .eq('id', editingPayment.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('customer_payments')
          .insert({
            ...payload,
            created_by: user?.id,
          });
        if (error) throw error;
      }

      setIsPaymentOpen(false);
      setEditingPayment(null);
      await loadData();

      // If statement modal was open, reload it
      if (isStatementOpen && selectedCustomerForStatement) {
        const updatedCust = balances.find((b) => b.id === selectedCustomerForStatement.id) || selectedCustomerForStatement;
        handleOpenStatement(updatedCust);
      }
    } catch (err: any) {
      setPaymentError(`Kayıt hatası: ${err.message}`);
    } finally {
      setSavingPayment(false);
    }
  };

  // Delete Payment with confirmation
  const handleDeletePayment = async (paymentId: string, amount: number, customerName?: string) => {
    const confirmMsg =
      `Bu tahsilat kaydını silmek istediğinizden emin misiniz?\n\n` +
      (customerName ? `Müşteri: ${customerName}\n` : '') +
      `Tutar: ${amount.toLocaleString('tr-TR')} ₺\n\n` +
      `Silindiğinde müşterinin cari bakiyesi otomatik olarak düzeltilecektir.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      const { error } = await supabase
        .from('customer_payments')
        .delete()
        .eq('id', paymentId);
      if (error) throw error;

      if (isPaymentOpen && editingPayment?.id === paymentId) {
        setIsPaymentOpen(false);
        setEditingPayment(null);
      }

      await loadData();

      // If statement modal was open, reload it
      if (isStatementOpen && selectedCustomerForStatement) {
        const updatedCust = balances.find((b) => b.id === selectedCustomerForStatement.id) || selectedCustomerForStatement;
        handleOpenStatement(updatedCust);
      }
    } catch (err: any) {
      alert(`Tahsilat silinirken hata oluştu: ${err.message}`);
    }
  };

  // Open Statement (Cari Ekstre) Modal
  const handleOpenStatement = async (cust: CustomerBalanceSummary) => {
    setSelectedCustomerForStatement(cust);
    setIsStatementOpen(true);
    setLoadingStatement(true);

    try {
      // 1. Fetch all shipments for this customer
      let sQ = supabase
        .from('shipments')
        .select('id, invoice_no, shipment_date, vehicle_plate, sale_price_per_m2, total_m2, notes, shipment_items(m2, unit, unit_price, total_price, products(name, thickness, color))')
        .eq('customer_id', cust.id)
        .eq('status', 'completed')
        .order('shipment_date', { ascending: true });
      if (targetCompanyId) sQ = sQ.eq('company_id', targetCompanyId);
      const { data: sData } = await sQ;

      // 2. Fetch all payments for this customer
      let pQ = supabase
        .from('customer_payments')
        .select('*')
        .eq('customer_id', cust.id)
        .order('date', { ascending: true });
      if (targetCompanyId) pQ = pQ.eq('company_id', targetCompanyId);
      const { data: pData } = await pQ;

      // Merge & sort chronologically
      const events: { date: string; type: 'shipment' | 'payment'; docNo: string; desc: string; debit: number; credit: number; raw: any }[] = [];

      (sData || []).forEach((s: any) => {
        let shipAmount = 0;
        const itemSummaries: string[] = [];
        (s.shipment_items || []).forEach((it: any) => {
          const itTot = Number(it.total_price) || (Number(it.m2) || 0) * (Number(it.unit_price) || 0);
          shipAmount += itTot;
          const pName = it.products?.name || 'Ürün';
          const pThick = it.products?.thickness ? ` (${it.products.thickness})` : '';
          itemSummaries.push(`${it.m2} ${it.unit || 'm²'} ${pName}${pThick}`);
        });

        if (shipAmount === 0 && Number(s.sale_price_per_m2) > 0) {
          shipAmount = (Number(s.total_m2) || 0) * Number(s.sale_price_per_m2);
        }

        const desc = `İrsaliyeli Sevk ${s.vehicle_plate ? `(Plaka: ${s.vehicle_plate})` : ''}${itemSummaries.length > 0 ? ` — [${itemSummaries.join(', ')}]` : ''}`;

        events.push({
          date: s.shipment_date,
          type: 'shipment',
          docNo: s.invoice_no || '-',
          desc,
          debit: shipAmount,
          credit: 0,
          raw: s,
        });
      });

      (pData || []).forEach((p: any) => {
        const typeLabel = PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type;
        const bankInfo = p.bank_name ? ` (${p.bank_name})` : '';
        const dueInfo = p.due_date ? ` [Vade: ${new Date(p.due_date).toLocaleDateString('tr-TR')}]` : '';
        const noteInfo = p.notes ? ` — ${p.notes}` : '';
        const desc = `Tahsilat: ${typeLabel}${bankInfo}${dueInfo}${noteInfo}`;

        events.push({
          date: p.date,
          type: 'payment',
          docNo: p.document_no || '-',
          desc,
          debit: 0,
          credit: Number(p.amount) || 0,
          raw: p,
        });
      });

      // Sort by date ascending
      events.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

      // Calculate running balance
      let running = 0;
      const statementList: CariStatementItem[] = events.map((ev, idx) => {
        running += ev.debit - ev.credit;
        return {
          id: `ev-${idx}`,
          date: ev.date,
          type: ev.type,
          document_no: ev.docNo,
          description: ev.desc,
          debit: ev.debit,
          credit: ev.credit,
          running_balance: Math.round(running * 100) / 100,
          raw_data: ev.raw,
        };
      });

      setStatementItems(statementList);
    } catch (err: any) {
      console.error('Ekstre yükleme hatası:', err);
    } finally {
      setLoadingStatement(false);
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    const headers = ['Müşteri Adı', 'Telefon', 'Vergi No', 'Toplam Sevk (Borç TL)', 'Toplam Tahsilat (Alacak TL)', 'Kalan Bakiye (TL)', 'Son Sevk', 'Son Tahsilat'];
    const rows = filteredBalances.map((b) => [
      `"${b.name}"`,
      `"${b.phone || ''}"`,
      `"${b.tax_number || ''}"`,
      b.total_debit.toFixed(2),
      b.total_credit.toFixed(2),
      b.balance.toFixed(2),
      b.last_shipment_date || '-',
      b.last_payment_date || '-',
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Musteri_Cari_Bakiyeleri_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* ── TOP HEADER & ACTIONS ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-600">
              <CreditCard size={26} />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Müşteri Cari Hesap & Bakiye Takibi
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Sevkiyat irsaliye tutarları (borç), banka/kasa tahsilatları (alacak) ve net bakiye ekstresi
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin() && companies.length > 0 && (
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
              <Building2 size={15} className="text-indigo-600" />
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  setSelectedCompanyId(e.target.value);
                  localStorage.setItem('parke_cust_balances_selected_company', e.target.value);
                }}
                className="text-xs font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
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
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Yenile</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={filteredBalances.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet size={14} className="text-emerald-600" />
            <span>Excel / CSV</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenPayment()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-emerald-600/20"
          >
            <Plus size={16} />
            <span>+ Tahsilat / Ödeme Ekle</span>
          </button>
        </div>
      </div>

      {/* ⚠️ Migration Schema Alert */}
      {schemaMissing && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 text-amber-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="p-2 bg-amber-200/60 rounded-xl text-amber-800 shrink-0">
              <AlertTriangle size={20} />
            </span>
            <div>
              <h4 className="font-bold text-sm sm:text-base">Tahsilat Veritabanı Tablosu Henüz Kurulmamış</h4>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                Müşteri tahsilatlarını kaydedebilmek için Supabase Dashboard SQL Editor alanında şu migration dosyasını çalıştırmanız gerekmektedir:
                <code className="ml-1 bg-amber-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-amber-900 font-bold">
                  supabase/migrations/20261010150000_create_caris_and_customer_balances.sql
                </code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer shadow-sm"
          >
            Tabloyu Tekrar Kontrol Et
          </button>
        </div>
      )}

      {/* ── KPI STATS CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Toplam Piyasa Alacağı */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Toplam Piyasa Alacağı</span>
            <span className="p-2 rounded-xl bg-red-50 text-red-600">
              <DollarSign size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {stats.totalMarketReceivables.toLocaleString('tr-TR')} ₺
            </span>
          </div>
          <div className="mt-2 text-xs font-semibold text-red-600 flex items-center gap-1.5">
            <span>🔴 {stats.totalDebtorCount} Müşteri Borçlu Durumda</span>
          </div>
        </div>

        {/* Card 2: Bu Ayki Tahsilat */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Bu Ay Yapılan Tahsilat</span>
            <span className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <TrendingUp size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {stats.thisMonthPayments.toLocaleString('tr-TR')} ₺
            </span>
          </div>
          <div className="mt-2 text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
            <span>💳 Banka & Nakit Kasa Girişleri</span>
          </div>
        </div>

        {/* Card 3: Borcu Olmayan / Kapalı Müşteriler */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Hesabı Kapalı Müşteri</span>
            <span className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <CheckCircle2 size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{stats.totalSettledCount}</span>
            <span className="text-xs font-bold text-slate-500">Firma</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-blue-600 flex items-center gap-1.5">
            <span>✅ Bakiyesi 0 TL veya Avans</span>
          </div>
        </div>

        {/* Card 4: Toplam Müşteri Portföyü */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Toplam Müşteri Portföyü</span>
            <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Wallet size={18} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">{customers.length}</span>
            <span className="text-xs font-bold text-slate-500">Kayıtlı Müşteri</span>
          </div>
          <div className="mt-2 text-xs font-semibold text-slate-600 flex items-center gap-1.5">
            <span>👥 Aktif Ticari İlişki</span>
          </div>
        </div>
      </div>

      {/* ── MAIN TABS: MÜŞTERİ BAKİYELERİ / TAHSİLAT HAREKETLERİ ── */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveMainTab('customers')}
          className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeMainTab === 'customers'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users size={16} />
          <span>Müşteri Cari Bakiyeleri ({filteredBalances.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMainTab('payments')}
          className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
            activeMainTab === 'payments'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Receipt size={16} />
          <span>Tahsilat Hareketleri & Geçmişi ({filteredPayments.length})</span>
        </button>
      </div>

      {activeMainTab === 'customers' ? (
        <>
          {/* ── FILTER & SEARCH BAR (CUSTOMERS) ── */}
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Müşteri adı, telefon veya vergi numarası ile ara..."
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-slate-50/50"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
              <span className="text-xs font-bold text-slate-400 flex items-center gap-1 pl-1 shrink-0">
                <Filter size={13} /> Durum:
              </span>
              {[
                { id: 'all', label: 'Tümü' },
                { id: 'debtor', label: 'Borçlular' },
                { id: 'settled', label: 'Hesabı Kapalı' },
                { id: 'creditor', label: 'Alacaklı / Avans' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBalanceFilter(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    balanceFilter === tab.id
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── CUSTOMER BALANCES TABLE ── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredBalances.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Wallet size={36} className="mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="text-sm font-semibold text-slate-600">Aradığınız kriterlere uygun müşteri kaydı bulunamadı.</p>
                <p className="text-xs text-slate-400 mt-1">Filtreleri sıfırlayarak tekrar deneyebilirsiniz.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Müşteri Ünvanı</th>
                      <th className="py-3 px-4">İletişim</th>
                      <th className="py-3 px-4 text-right">Toplam Sevk (Borç)</th>
                      <th className="py-3 px-4 text-right text-emerald-700">Toplam Tahsilat</th>
                      <th className="py-3 px-4 text-right">Kalan Bakiye</th>
                      <th className="py-3 px-4">Son İşlemler</th>
                      <th className="py-3 px-4 text-right">Hızlı İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredBalances.map((cust) => {
                      const isDebtor = cust.balance > 0.01;
                      const isCreditor = cust.balance < -0.01;

                      return (
                        <tr key={cust.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 text-sm">{cust.name}</div>
                            {cust.tax_number && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">VN: {cust.tax_number}</div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600">
                            {cust.phone ? (
                              <span className="flex items-center gap-1 font-mono">
                                <Phone size={12} className="text-slate-400" />
                                {cust.phone}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800">
                            {cust.total_debit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-700">
                            {cust.total_credit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isDebtor ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-red-100 text-red-800 border border-red-200 font-mono">
                                <ArrowDownRight size={13} className="text-red-600" />
                                {cust.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ Borçlu
                              </span>
                            ) : isCreditor ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-blue-100 text-blue-800 border border-blue-200 font-mono">
                                <ArrowUpRight size={13} className="text-blue-600" />
                                {Math.abs(cust.balance).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ Avans
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono">
                                <CheckCircle2 size={13} className="text-emerald-600" />
                                0,00 ₺ (Kapalı)
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-[11px] text-slate-500 space-y-0.5">
                            {cust.last_shipment_date && (
                              <div>Sevk: {new Date(cust.last_shipment_date).toLocaleDateString('tr-TR')}</div>
                            )}
                            {cust.last_payment_date && (
                              <div className="text-emerald-600">
                                Tahsilat: {new Date(cust.last_payment_date).toLocaleDateString('tr-TR')}
                              </div>
                            )}
                            {!cust.last_shipment_date && !cust.last_payment_date && (
                              <span className="text-slate-400">Hareket yok</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenPayment(cust.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-[11px] border border-emerald-200 transition-colors flex items-center gap-1 cursor-pointer"
                                title="Bu müşteriye yeni tahsilat kaydet"
                              >
                                <Plus size={12} />
                                <span>Tahsilat Al</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenStatement(cust)}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition-colors flex items-center gap-1 cursor-pointer"
                                title="Müşteri Cari Ekstresi"
                              >
                                <FileText size={12} />
                                <span>Ekstre</span>
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
        </>
      ) : (
        <>
          {/* ── FILTER & SEARCH BAR (PAYMENTS) ── */}
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tahsilat ara (Müşteri, banka, dekont no, not, tutar)..."
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-slate-50/50"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
              <span className="text-xs font-bold text-slate-400 flex items-center gap-1 pl-1 shrink-0">
                <Filter size={13} /> Tür:
              </span>
              {[
                { id: 'all', label: 'Tümü' },
                { id: 'havale', label: 'Havale / EFT' },
                { id: 'nakit', label: 'Nakit' },
                { id: 'cek', label: 'Çek' },
                { id: 'kredi_karti', label: 'Kredi Kartı' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPaymentTypeFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    paymentTypeFilter === tab.id
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="px-3.5 py-1.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 text-xs font-bold shrink-0">
              Toplam: {filteredPaymentsTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
            </div>
          </div>

          {/* ── PAYMENTS HISTORY & MANAGEMENT TABLE ── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredPayments.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Receipt size={36} className="mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="text-sm font-semibold text-slate-600">Kayıtlı tahsilat hareketi bulunamadı.</p>
                <p className="text-xs text-slate-400 mt-1">Yeni tahsilat ekleyerek başlayabilirsiniz.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Tarih</th>
                      <th className="py-3 px-4">Müşteri</th>
                      <th className="py-3 px-4">Ödeme Türü</th>
                      <th className="py-3 px-4 text-right">Tutar (₺)</th>
                      <th className="py-3 px-4">Dekont / Belge No</th>
                      <th className="py-3 px-4">Banka / Vade</th>
                      <th className="py-3 px-4">Açıklama / Not</th>
                      <th className="py-3 px-4 text-right">İşlemler (Düzelt / Sil)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {filteredPayments.map((p) => {
                      const customer = customers.find((c) => c.id === p.customer_id);
                      const typeLabel = PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type;
                      const typeColor = PAYMENT_TYPE_COLORS[p.payment_type] || 'bg-slate-100 text-slate-800';

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4 whitespace-nowrap text-slate-700 font-mono font-medium">
                            {new Date(p.date).toLocaleDateString('tr-TR')}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-900">
                            <button
                              type="button"
                              onClick={() => {
                                const custBalance = balances.find((b) => b.id === p.customer_id);
                                if (custBalance) handleOpenStatement(custBalance);
                              }}
                              className="text-left hover:text-indigo-600 hover:underline cursor-pointer"
                              title="Müşteri ekstresini görüntüle"
                            >
                              {customer?.name || 'Müşteri'}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${typeColor}`}>
                              {typeLabel}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-700 text-sm">
                            {Number(p.amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-700">
                            {p.document_no || <span className="text-slate-400">-</span>}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600">
                            {p.bank_name && <div className="font-semibold text-slate-800">{p.bank_name}</div>}
                            {p.due_date && (
                              <div className="text-[11px] text-amber-700 font-mono">
                                Vade: {new Date(p.due_date).toLocaleDateString('tr-TR')}
                              </div>
                            )}
                            {!p.bank_name && !p.due_date && <span className="text-slate-400">-</span>}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 max-w-xs truncate" title={p.notes || ''}>
                            {p.notes || <span className="text-slate-400">-</span>}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenPayment(p.customer_id, p)}
                                className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] border border-indigo-200 transition-colors flex items-center gap-1 cursor-pointer"
                                title="Bu tahsilatı düzenle / düzelt"
                              >
                                <Pencil size={12} />
                                <span>Düzenle</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePayment(p.id, p.amount, customer?.name)}
                                className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold text-[11px] border border-red-200 transition-colors flex items-center gap-1 cursor-pointer"
                                title="Bu tahsilat kaydını sil"
                              >
                                <Trash2 size={12} />
                                <span>Sil</span>
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
        </>
      )}

      {/* ── MODAL: TAHSİLAT EKLE ── */}
      {isPaymentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                  <CreditCard size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {editingPayment ? 'Tahsilat Kaydını Düzenle / Düzelt' : 'Yeni Müşteri Tahsilatı Kaydet'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {editingPayment
                      ? 'Tahsilat tutarını veya bilgilerini güncelleyin / silin'
                      : 'Müşterinin cari bakiyesinden anında düşer'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsPaymentOpen(false);
                  setEditingPayment(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSavePayment} className="p-5 space-y-4">
              {paymentError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{paymentError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Müşteri *</label>
                <select
                  value={paymentForm.customer_id}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, customer_id: e.target.value }))}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tahsilat Tarihi *</label>
                  <input
                    type="date"
                    value={paymentForm.date}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tahsilat Tutarı (₺) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ödeme Türü *</label>
                  <select
                    value={paymentForm.payment_type}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, payment_type: e.target.value as any }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    <option value="havale">Banka Havalesi / EFT</option>
                    <option value="nakit">Nakit (Kasa Girişi)</option>
                    <option value="cek">Çek</option>
                    <option value="kredi_karti">Kredi Kartı</option>
                    <option value="diger">Diğer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Dekont / Makbuz / Çek No</label>
                  <input
                    type="text"
                    placeholder="Örn: DKT-849302"
                    value={paymentForm.document_no}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, document_no: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Banka Adı</label>
                  <input
                    type="text"
                    placeholder="Örn: Garanti BBVA"
                    value={paymentForm.bank_name}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, bank_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                {paymentForm.payment_type === 'cek' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Çek Vade Tarihi</label>
                    <input
                      type="date"
                      value={paymentForm.due_date}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, due_date: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Not / Açıklama</label>
                    <input
                      type="text"
                      placeholder="Tahsilat açıklaması..."
                      value={paymentForm.notes}
                      onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
                {editingPayment ? (
                  <button
                    type="button"
                    onClick={() =>
                      handleDeletePayment(
                        editingPayment.id,
                        editingPayment.amount,
                        customers.find((c) => c.id === editingPayment.customer_id)?.name
                      )
                    }
                    className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 border border-red-200"
                  >
                    <Trash2 size={13} />
                    <span>Tahsilatı Sil</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPaymentOpen(false);
                      setEditingPayment(null);
                    }}
                    className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={savingPayment}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {savingPayment ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Kaydediliyor...</span>
                      </>
                    ) : (
                      <span>{editingPayment ? 'Güncellemeyi Kaydet' : 'Tahsilatı Kaydet'}</span>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: CARİ HESAP EKSTRESİ ── */}
      {isStatementOpen && selectedCustomerForStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs print:p-0 print:bg-white">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 print:border-none print:shadow-none print:max-w-none print:max-h-none print:rounded-none">
            {/* Modal Top Header (Hidden on Print) */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between no-print">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                  <FileText size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm">{selectedCustomerForStatement.name} — Cari Hesap Ekstresi</h3>
                  <p className="text-[11px] text-slate-400">İrsaliye ve tahsilat hareketleri dökümü</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer size={13} />
                  <span>Yazdır (A4)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsStatementOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Printable Statement Document Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 print:p-8">
              {/* Document Header for Print */}
              <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">MÜŞTERİ CARİ HESAP EKSTRESİ</h2>
                  <div className="text-xs font-bold text-slate-700 mt-1">{selectedCustomerForStatement.name}</div>
                  {selectedCustomerForStatement.tax_number && (
                    <div className="text-[11px] text-slate-500 font-mono">Vergi No: {selectedCustomerForStatement.tax_number}</div>
                  )}
                  {selectedCustomerForStatement.phone && (
                    <div className="text-[11px] text-slate-500">Telefon: {selectedCustomerForStatement.phone}</div>
                  )}
                </div>
                <div className="text-right sm:text-right text-xs space-y-1">
                  <div className="font-bold text-slate-500">Ekstre Tarihi: {new Date().toLocaleDateString('tr-TR')}</div>
                  <div className="text-sm font-black text-slate-900 font-mono">
                    Net Bakiye: {selectedCustomerForStatement.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺{' '}
                    <span className={selectedCustomerForStatement.balance > 0 ? 'text-red-600' : 'text-emerald-600'}>
                      ({selectedCustomerForStatement.balance > 0 ? 'Borçlu' : 'Kapalı'})
                    </span>
                  </div>
                </div>
              </div>

              {/* Statement KPI Strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Toplam Sevk (Borç)</div>
                  <div className="text-base font-black text-slate-900 font-mono mt-0.5">
                    {selectedCustomerForStatement.total_debit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </div>
                </div>
                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase">Toplam Tahsilat (Alacak)</div>
                  <div className="text-base font-black text-emerald-800 font-mono mt-0.5">
                    {selectedCustomerForStatement.total_credit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </div>
                </div>
                <div className={`p-3 rounded-xl border ${selectedCustomerForStatement.balance > 0 ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                  <div className={`text-[10px] font-bold uppercase ${selectedCustomerForStatement.balance > 0 ? 'text-red-700' : 'text-blue-700'}`}>
                    Kalan Bakiye
                  </div>
                  <div className={`text-base font-black font-mono mt-0.5 ${selectedCustomerForStatement.balance > 0 ? 'text-red-800' : 'text-blue-800'}`}>
                    {selectedCustomerForStatement.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </div>
                </div>
              </div>

              {/* Statement Table */}
              {loadingStatement ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : statementItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  Bu müşteriye ait tamamlanmış irsaliye veya tahsilat hareketi bulunmuyor.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase text-[10px]">
                        <th className="py-2.5 px-3">Tarih</th>
                        <th className="py-2.5 px-3">Tür</th>
                        <th className="py-2.5 px-3">Evrak / İrsaliye No</th>
                        <th className="py-2.5 px-3">Açıklama</th>
                        <th className="py-2.5 px-3 text-right">Borç (₺)</th>
                        <th className="py-2.5 px-3 text-right text-emerald-700">Alacak (₺)</th>
                        <th className="py-2.5 px-3 text-right">Bakiye (₺)</th>
                        <th className="py-2.5 px-3 text-center no-print">İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {statementItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-700">
                            {new Date(item.date).toLocaleDateString('tr-TR')}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {item.type === 'shipment' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                🚚 İrsaliye
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                💰 Tahsilat
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{item.document_no}</td>
                          <td className="py-2.5 px-3 text-slate-600 max-w-xs">{item.description}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {item.debit > 0 ? `${item.debit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                            {item.credit > 0 ? `${item.credit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                            {item.running_balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                          </td>
                          <td className="py-2.5 px-3 text-center whitespace-nowrap no-print">
                            {item.type === 'payment' && item.raw_data && (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenPayment(selectedCustomerForStatement.id, item.raw_data)}
                                  className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                  title="Bu tahsilatı düzenle / düzelt"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeletePayment(
                                      item.raw_data.id,
                                      item.credit,
                                      selectedCustomerForStatement.name
                                    )
                                  }
                                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                  title="Bu tahsilatı sil"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Bottom Footer (Hidden on Print) */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between no-print">
              <span className="text-xs text-slate-500">Müşteriye doğrudan PDF olarak iletilebilir veya A4 yazıcıdan basılabilir.</span>
              <button
                type="button"
                onClick={() => setIsStatementOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
