import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Employee, AttendanceRecord, PayrollTransaction, PayrollPayment } from '../types';
import Modal from '../components/Modal';
import {
  Users, Calendar, Clock, DollarSign, Plus, Search,
  Edit2, Trash2, CheckCircle2, AlertCircle, Printer,
  FileSpreadsheet, ArrowRight, Wallet, TrendingUp,
  ChevronLeft, ChevronRight, UserPlus, Save, RefreshCw
} from 'lucide-react';

type Tab = 'puantaj' | 'bordro' | 'avans' | 'personel';
type PuantajViewMode = 'matrix' | 'daily';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAYS_OF_WEEK = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

const STATUS_CONFIG: Record<string, { label: string; short: string; bg: string; text: string; value: number }> = {
  full_day: { label: 'Tam Gün Çalıştı', short: 'G', bg: 'bg-emerald-100 border-emerald-300', text: 'text-emerald-800', value: 1.0 },
  half_day: { label: 'Yarım Gün', short: 'Y', bg: 'bg-amber-100 border-amber-300', text: 'text-amber-800', value: 0.5 },
  leave: { label: 'Ücretli İzin / Rapor', short: 'İ', bg: 'bg-blue-100 border-blue-300', text: 'text-blue-800', value: 1.0 },
  absent: { label: 'Devamsız / Gelmedi', short: 'X', bg: 'bg-red-100 border-red-300', text: 'text-red-800', value: 0.0 },
  holiday: { label: 'Hafta Tatili', short: 'H', bg: 'bg-slate-100 border-slate-300', text: 'text-slate-600', value: 1.0 },
};

export default function LaborTracking() {
  const { isAdmin, isFieldManager } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('puantaj');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  // Core data states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [transactions, setTransactions] = useState<PayrollTransaction[]>([]);
  const [payments, setPayments] = useState<PayrollPayment[]>([]);
  const [loading, setLoading] = useState(true);

  // UI modal states
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [editEmp, setEditEmp] = useState<Employee | undefined>(undefined);
  const [showTxModal, setShowTxModal] = useState(false);
  const [selectedSlipEmp, setSelectedSlipEmp] = useState<any | null>(null);

  // Puantaj view states
  const [puantajView, setPuantajView] = useState<PuantajViewMode>('matrix');
  const [selectedDailyDate, setSelectedDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [dailyForm, setDailyForm] = useState<Record<string, { status: string; overtime_hours: number; overtime_multiplier: number; notes: string }>>({});
  const [savingDaily, setSavingDaily] = useState(false);

  // Cell quick edit modal for matrix
  const [cellEdit, setCellEdit] = useState<{ empId: string; date: string; empName: string; status: string; overtime_hours: number; overtime_multiplier: number; notes: string } | null>(null);

  // Cost integration state
  const [transferringCost, setTransferringCost] = useState(false);

  // Search & Filter
  const [empSearch, setEmpSearch] = useState('');

  // 1. Fetch data
  const loadData = async () => {
    setLoading(true);
    const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const endDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    try {
      const [empRes, attRes, txRes, payRes] = await Promise.all([
        supabase.from('employees').select('*').order('full_name'),
        supabase.from('attendance_records').select('*').gte('date', startDate).lte('date', endDate),
        supabase.from('payroll_transactions').select('*').eq('period_month', selectedMonth).eq('period_year', selectedYear).order('date', { ascending: false }),
        supabase.from('payroll_payments').select('*').eq('period_month', selectedMonth).eq('period_year', selectedYear),
      ]);

      if (empRes.data) setEmployees(empRes.data);
      if (attRes.data) setAttendance(attRes.data);
      if (txRes.data) setTransactions(txRes.data);
      if (payRes.data) setPayments(payRes.data);
    } catch (err) {
      console.error('Error loading labor data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedMonth, selectedYear]);

  // Days in selected month
  const daysInMonth = useMemo(() => {
    const totalDays = new Date(selectedYear, selectedMonth, 0).getDate();
    return Array.from({ length: totalDays }, (_, i) => {
      const day = i + 1;
      const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const d = new Date(selectedYear, selectedMonth - 1, day);
      const dayOfWeek = DAYS_OF_WEEK[d.getDay()];
      const isSunday = d.getDay() === 0;
      return { day, dateStr, dayOfWeek, isSunday };
    });
  }, [selectedYear, selectedMonth]);

  // Attendance lookup map: employee_id -> date -> AttendanceRecord
  const attMap = useMemo(() => {
    const map: Record<string, Record<string, AttendanceRecord>> = {};
    attendance.forEach(rec => {
      if (!map[rec.employee_id]) map[rec.employee_id] = {};
      map[rec.employee_id][rec.date] = rec;
    });
    return map;
  }, [attendance]);

  // Populate daily form when daily date changes or employees change
  useEffect(() => {
    const initial: Record<string, any> = {};
    employees.filter(e => e.is_active).forEach(emp => {
      const existing = attMap[emp.id]?.[selectedDailyDate];
      initial[emp.id] = {
        status: existing?.status || 'full_day',
        overtime_hours: existing?.overtime_hours || 0,
        overtime_multiplier: existing?.overtime_multiplier || emp.overtime_multiplier || 1.5,
        notes: existing?.notes || '',
      };
    });
    setDailyForm(initial);
  }, [selectedDailyDate, employees, attMap]);

  // 2. Calculations for Payroll & Summary
  const payrollSummary = useMemo(() => {
    return employees.map(emp => {
      const empAtt = attMap[emp.id] || {};
      let fullDays = 0;
      let halfDays = 0;
      let leaves = 0;
      let holidays = 0;
      let absents = 0;
      let totalOvertimeHours = 0;
      let totalOvertimeAmount = 0;

      // Calculate hourly wage for overtime
      const divisor = emp.monthly_hours_divisor || 225;
      const hourlyRate = emp.wage_type === 'monthly'
        ? (emp.base_wage / divisor)
        : (emp.base_wage / 7.5); // Daily wage assumes 7.5 hour workday

      Object.values(empAtt).forEach(rec => {
        if (rec.status === 'full_day') fullDays++;
        else if (rec.status === 'half_day') halfDays++;
        else if (rec.status === 'leave') leaves++;
        else if (rec.status === 'holiday') holidays++;
        else if (rec.status === 'absent') absents++;

        if (rec.overtime_hours > 0) {
          totalOvertimeHours += Number(rec.overtime_hours);
          const mult = Number(rec.overtime_multiplier) || 1.5;
          totalOvertimeAmount += Number(rec.overtime_hours) * (hourlyRate * mult);
        }
      });

      // Total days worked calculation
      const workedDays = fullDays + (halfDays * 0.5) + leaves + holidays;

      // Base earned wage calculation
      let earnedBaseWage = 0;
      if (emp.wage_type === 'monthly') {
        if (absents === 0 && workedDays > 0) {
          earnedBaseWage = emp.base_wage;
        } else if (workedDays > 0) {
          // Deduct absent days proportionally based on 30-day month standard
          const dailyRate = emp.base_wage / 30;
          earnedBaseWage = Math.max(emp.base_wage - (dailyRate * absents), 0);
        }
      } else {
        earnedBaseWage = (fullDays + (halfDays * 0.5)) * emp.base_wage;
      }

      // Transactions (Advances, Bonuses, Deductions)
      const empTxs = transactions.filter(t => t.employee_id === emp.id);
      const advances = empTxs.filter(t => t.type === 'advance').reduce((s, t) => s + Number(t.amount), 0);
      const bonuses = empTxs.filter(t => t.type === 'bonus').reduce((s, t) => s + Number(t.amount), 0);
      const deductions = empTxs.filter(t => t.type === 'deduction').reduce((s, t) => s + Number(t.amount), 0);

      // Total Net Payable Salary
      const netSalary = Math.round(earnedBaseWage + totalOvertimeAmount + bonuses - deductions - advances);

      // Payment record if exists
      const paymentRec = payments.find(p => p.employee_id === emp.id);
      const isPaid = paymentRec ? paymentRec.is_paid : false;

      return {
        emp,
        fullDays,
        halfDays,
        leaves,
        holidays,
        absents,
        workedDays,
        hourlyRate,
        earnedBaseWage,
        totalOvertimeHours,
        totalOvertimeAmount: Math.round(totalOvertimeAmount),
        advances,
        bonuses,
        deductions,
        netSalary,
        isPaid,
        paymentRec,
      };
    });
  }, [employees, attMap, transactions, payments]);

  // Totals for the whole factory
  const factoryTotals = useMemo(() => {
    return payrollSummary.reduce(
      (acc, row) => ({
        baseWage: acc.baseWage + row.earnedBaseWage,
        overtime: acc.overtime + row.totalOvertimeAmount,
        bonuses: acc.bonuses + row.bonuses,
        deductions: acc.deductions + row.deductions,
        advances: acc.advances + row.advances,
        netSalary: acc.netSalary + row.netSalary,
        overtimeHours: acc.overtimeHours + row.totalOvertimeHours,
      }),
      { baseWage: 0, overtime: 0, bonuses: 0, deductions: 0, advances: 0, netSalary: 0, overtimeHours: 0 }
    );
  }, [payrollSummary]);

  // 3. Handlers
  // Save daily attendance
  const handleSaveDaily = async () => {
    setSavingDaily(true);
    try {
      const recordsToUpsert = Object.entries(dailyForm).map(([empId, data]) => ({
        employee_id: empId,
        date: selectedDailyDate,
        status: data.status,
        overtime_hours: Number(data.overtime_hours) || 0,
        overtime_multiplier: Number(data.overtime_multiplier) || 1.5,
        notes: data.notes || '',
      }));

      const { error } = await supabase.from('attendance_records').upsert(recordsToUpsert, { onConflict: 'employee_id,date' });
      if (error) throw error;
      await loadData();
      alert('Günlük puantaj başarıyla kaydedildi.');
    } catch (err: any) {
      alert('Puantaj kaydedilirken hata: ' + err.message);
    } finally {
      setSavingDaily(false);
    }
  };

  // Save single cell attendance from matrix
  const handleSaveCell = async () => {
    if (!cellEdit) return;
    try {
      const { error } = await supabase.from('attendance_records').upsert({
        employee_id: cellEdit.empId,
        date: cellEdit.date,
        status: cellEdit.status,
        overtime_hours: Number(cellEdit.overtime_hours) || 0,
        overtime_multiplier: Number(cellEdit.overtime_multiplier) || 1.5,
        notes: cellEdit.notes || '',
      }, { onConflict: 'employee_id,date' });

      if (error) throw error;
      await loadData();
      setCellEdit(null);
    } catch (err: any) {
      alert('Kayıt hatası: ' + err.message);
    }
  };

  // Toggle paid status for payroll
  const handleTogglePaid = async (row: any) => {
    try {
      const newPaid = !row.isPaid;
      const payload = {
        employee_id: row.emp.id,
        period_year: selectedYear,
        period_month: selectedMonth,
        base_salary: row.emp.base_wage,
        days_worked: row.workedDays,
        earned_base_wage: row.earnedBaseWage,
        overtime_hours: row.totalOvertimeHours,
        overtime_amount: row.totalOvertimeAmount,
        bonus_amount: row.bonuses,
        deduction_amount: row.deductions,
        advance_amount: row.advances,
        net_salary: row.netSalary,
        is_paid: newPaid,
        payment_date: newPaid ? new Date().toISOString().split('T')[0] : null,
      };

      const { error } = await supabase.from('payroll_payments').upsert(payload, { onConflict: 'employee_id,period_year,period_month' });
      if (error) throw error;
      await loadData();
    } catch (err: any) {
      alert('Ödeme durumu güncellenirken hata: ' + err.message);
    }
  };

  // Transfer total payroll to Cost Entries (Maliyet Giderleri)
  const handleTransferToCosts = async () => {
    if (factoryTotals.netSalary <= 0) {
      alert('Aktarılacak net işçilik tutarı bulunamadı.');
      return;
    }

    const confirmMsg = `${MONTHS[selectedMonth - 1]} ${selectedYear} dönemine ait toplam ₺${factoryTotals.netSalary.toLocaleString('tr-TR')} tutarındaki işçilik gideri, Maliyet Giderleri (Personel Maaşları) ekranına aktarılacaktır.\nOnaylıyor musunuz?`;
    if (!confirm(confirmMsg)) return;

    setTransferringCost(true);
    try {
      // Check if already exists
      const { data: existingCosts } = await supabase
        .from('cost_entries')
        .select('id')
        .eq('period_year', selectedYear)
        .eq('period_month', selectedMonth)
        .eq('cost_type', 'operasyonel')
        .eq('sub_type', 'personel');

      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const costPayload = {
        date: startDate,
        period_month: selectedMonth,
        period_year: selectedYear,
        cost_type: 'operasyonel' as const,
        sub_type: 'personel',
        description: `${MONTHS[selectedMonth - 1]} ${selectedYear} Ayı Personel Maaş, Mesai ve İşçilik Bordrosu`,
        quantity: employees.filter(e => e.is_active).length,
        unit: 'kişi',
        unit_price: factoryTotals.netSalary / Math.max(employees.filter(e => e.is_active).length, 1),
        transport_cost: 0,
        total_amount: factoryTotals.netSalary,
      };

      if (existingCosts && existingCosts.length > 0) {
        await supabase.from('cost_entries').update(costPayload).eq('id', existingCosts[0].id);
      } else {
        await supabase.from('cost_entries').insert(costPayload);
      }

      alert('İşçilik maliyeti Maliyet Giderleri ekranına başarıyla aktarıldı!\nRaporlar ekranında birim maliyetiniz güncellenecektir.');
    } catch (err: any) {
      alert('Maliyete aktarılırken hata oluştu: ' + err.message);
    } finally {
      setTransferringCost(false);
    }
  };

  return (
    <div className="p-8">
      {/* ── HEADER ── */}
      <div className="no-print flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users size={26} className="text-amber-500" /> İşçilik, Puantaj & Maaş Yönetimi
          </h1>
          <p className="text-slate-500 text-sm mt-1">Personel devam takibi, fazla mesai, avans ve aylık maaş bordrosu</p>
        </div>

        {/* Period Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(Number(e.target.value))}
              className="px-3 py-1.5 text-sm font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <span className="text-slate-300">|</span>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="px-3 py-1.5 text-sm font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
            >
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => { setEditEmp(undefined); setShowEmpModal(true); }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <UserPlus size={15} /> Personel Ekle
          </button>
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="no-print flex border-b border-slate-200 mb-6 gap-2">
        {[
          { id: 'puantaj', label: 'Puantaj Cetveli', icon: Calendar },
          { id: 'bordro', label: 'Maaş & Bordro', icon: FileSpreadsheet },
          { id: 'avans', label: 'Avans & Ek Ödemeler', icon: Wallet },
          { id: 'personel', label: 'Personel Listesi', icon: Users },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all ${
                isActive
                  ? 'border-amber-500 text-amber-600 bg-white rounded-t-xl shadow-sm'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* 1. PUANTAJ CETVELİ                                              */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'puantaj' && (
            <div className="space-y-4">
              {/* Puantaj Top Bar */}
              <div className="no-print bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl w-fit">
                  <button
                    onClick={() => setPuantajView('matrix')}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      puantajView === 'matrix' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Aylık Tablo Görünümü
                  </button>
                  <button
                    onClick={() => setPuantajView('daily')}
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      puantajView === 'daily' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Günlük Hızlı Giriş
                  </button>
                </div>

                {/* Status Legend */}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
                    <div key={k} className="flex items-center gap-1.5">
                      <span className={`w-5 h-5 flex items-center justify-center rounded border font-bold text-[10px] ${cfg.bg} ${cfg.text}`}>
                        {cfg.short}
                      </span>
                      <span className="text-slate-600 text-[11px]">{cfg.label}</span>
                    </div>
                  ))}
                  <span className="text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    +s: Mesai Saati
                  </span>
                </div>
              </div>

              {/* View 1: AYLIK MATRİS TABLOSU */}
              {puantajView === 'matrix' ? (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <div className="overflow-x-auto max-w-full pb-3">
                    <table className="w-full text-xs text-center border-collapse">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                          <th className="px-3 py-3 text-left font-bold min-w-[180px] sticky left-0 bg-slate-100 z-10">
                            Personel ({employees.filter(e => e.is_active).length})
                          </th>
                          {daysInMonth.map(d => (
                            <th
                              key={d.day}
                              className={`px-1 py-2 min-w-[34px] border-r border-slate-200 font-bold ${
                                d.isSunday ? 'bg-amber-50/70 text-amber-800' : ''
                              }`}
                            >
                              <div className="text-[10px] text-slate-400 font-normal">{d.dayOfWeek}</div>
                              <div className="text-xs">{d.day}</div>
                            </th>
                          ))}
                          <th className="px-2 py-2 font-bold min-w-[60px] bg-slate-200/60 text-slate-800">Çalışma</th>
                          <th className="px-2 py-2 font-bold min-w-[60px] bg-amber-100/60 text-amber-900">Mesai</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {employees.filter(e => e.is_active).map(emp => {
                          const empAtt = attMap[emp.id] || {};
                          let totalWorkDays = 0;
                          let totalOtHours = 0;

                          return (
                            <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="px-3 py-2 text-left font-medium text-slate-800 sticky left-0 bg-white z-10 shadow-sm">
                                <div className="font-semibold text-slate-900 truncate">{emp.full_name}</div>
                                <div className="text-[10px] text-slate-400 truncate">{emp.role_title}</div>
                              </td>
                              {daysInMonth.map(d => {
                                const rec = empAtt[d.dateStr];
                                const status = rec?.status || (d.isSunday ? 'holiday' : 'full_day');
                                const ot = rec?.overtime_hours || 0;
                                const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.full_day;

                                if (status === 'full_day') totalWorkDays += 1;
                                else if (status === 'half_day') totalWorkDays += 0.5;
                                else if (status === 'leave') totalWorkDays += 1;
                                else if (status === 'holiday') totalWorkDays += 1;
                                totalOtHours += Number(ot);

                                return (
                                  <td
                                    key={d.day}
                                    onClick={() => setCellEdit({
                                      empId: emp.id,
                                      empName: emp.full_name,
                                      date: d.dateStr,
                                      status: rec?.status || (d.isSunday ? 'holiday' : 'full_day'),
                                      overtime_hours: ot,
                                      overtime_multiplier: rec?.overtime_multiplier || emp.overtime_multiplier || 1.5,
                                      notes: rec?.notes || '',
                                    })}
                                    className={`p-1 border-r border-slate-100 cursor-pointer transition-transform hover:scale-105 ${
                                      d.isSunday ? 'bg-amber-50/30' : ''
                                    }`}
                                    title={`${emp.full_name} - ${d.dateStr}: ${cfg.label} ${ot > 0 ? `(+${ot} saat mesai)` : ''}`}
                                  >
                                    <div className={`w-full h-8 flex flex-col items-center justify-center rounded border ${cfg.bg} ${cfg.text}`}>
                                      <span className="font-bold text-[11px] leading-none">{cfg.short}</span>
                                      {ot > 0 && (
                                        <span className="text-[9px] font-black text-amber-900 leading-none mt-0.5">
                                          +{ot}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                              <td className="px-2 py-2 font-bold text-slate-900 bg-slate-50/50">
                                {totalWorkDays}g
                              </td>
                              <td className="px-2 py-2 font-bold text-amber-700 bg-amber-50/40">
                                {totalOtHours > 0 ? `${totalOtHours}s` : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* View 2: GÜNLÜK HIZLI GİRİŞ */
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-semibold text-slate-700">Tarih Seçiniz:</label>
                      <input
                        type="date"
                        value={selectedDailyDate}
                        onChange={e => setSelectedDailyDate(e.target.value)}
                        className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { ...dailyForm };
                          Object.keys(updated).forEach(id => {
                            updated[id].status = 'full_day';
                          });
                          setDailyForm(updated);
                        }}
                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-semibold transition-colors"
                      >
                        Tümünü Tam Gün Yap
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { ...dailyForm };
                          Object.keys(updated).forEach(id => {
                            updated[id].status = 'holiday';
                          });
                          setDailyForm(updated);
                        }}
                        className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-semibold transition-colors"
                      >
                        Tümünü Tatil Yap
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {employees.filter(e => e.is_active).map(emp => {
                      const item = dailyForm[emp.id] || { status: 'full_day', overtime_hours: 0, overtime_multiplier: 1.5, notes: '' };
                      return (
                        <div key={emp.id} className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/60 rounded-xl px-3 transition-colors">
                          <div className="w-48">
                            <h4 className="font-semibold text-slate-900 text-sm">{emp.full_name}</h4>
                            <p className="text-xs text-slate-400">{emp.role_title}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <div>
                              <label className="block text-[10px] text-slate-400 font-medium mb-1">Durum</label>
                              <select
                                value={item.status}
                                onChange={e => setDailyForm(df => ({
                                  ...df,
                                  [emp.id]: { ...df[emp.id], status: e.target.value }
                                }))}
                                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
                              >
                                {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
                                  <option key={k} value={k}>{cfg.label}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[10px] text-slate-400 font-medium mb-1">Fazla Mesai (Saat)</label>
                              <input
                                type="number"
                                min="0"
                                max="24"
                                step="0.5"
                                value={item.overtime_hours}
                                onChange={e => setDailyForm(df => ({
                                  ...df,
                                  [emp.id]: { ...df[emp.id], overtime_hours: Number(e.target.value) }
                                }))}
                                className="w-20 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] text-slate-400 font-medium mb-1">Mesai Katsayısı</label>
                              <input
                                type="number"
                                min="1"
                                max="5"
                                step="0.1"
                                value={item.overtime_multiplier}
                                onChange={e => setDailyForm(df => ({
                                  ...df,
                                  [emp.id]: { ...df[emp.id], overtime_multiplier: Number(e.target.value) }
                                }))}
                                className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                              />
                            </div>

                            <div className="flex-1 min-w-[160px]">
                              <label className="block text-[10px] text-slate-400 font-medium mb-1">Not</label>
                              <input
                                type="text"
                                placeholder="Örn: Gece vardiyası"
                                value={item.notes}
                                onChange={e => setDailyForm(df => ({
                                  ...df,
                                  [emp.id]: { ...df[emp.id], notes: e.target.value }
                                }))}
                                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end pt-4 border-t border-slate-100">
                    <button
                      onClick={handleSaveDaily}
                      disabled={savingDaily}
                      className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-colors"
                    >
                      {savingDaily ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                      Günün Puantajını Kaydet
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* 2. MAAŞ & HAKEDİŞ BORDROSU                                     */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'bordro' && (
            <div className="space-y-6">
              {/* Top KPI Cards */}
              <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                  <span className="text-xs text-slate-400 font-medium block mb-1">Toplam Taban Maaş Hak</span>
                  <p className="text-2xl font-bold text-slate-900">
                    ₺{factoryTotals.baseWage.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                  <span className="text-xs text-slate-400 font-medium block mb-1">
                    Toplam Fazla Mesai ({factoryTotals.overtimeHours} Saat)
                  </span>
                  <p className="text-2xl font-bold text-amber-600">
                    ₺{factoryTotals.overtime.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                  <span className="text-xs text-slate-400 font-medium block mb-1">Verilen Avanslar (-)</span>
                  <p className="text-2xl font-bold text-red-600">
                    -₺{factoryTotals.advances.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-5 shadow-sm">
                  <span className="text-xs text-emerald-800 font-bold block mb-1">GENEL NET ÖDENECEK</span>
                  <p className="text-2xl font-black text-emerald-950">
                    ₺{factoryTotals.netSalary.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>

              {/* Action Bar */}
              <div className="no-print bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-sm">
                    {MONTHS[selectedMonth - 1]} {selectedYear} Dönemi Maaş Bordrosu
                  </h3>
                  <span className="text-xs text-slate-400">({payrollSummary.length} Personel)</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Printer size={14} /> Bordroyu Yazdır (A4)
                  </button>

                  <button
                    onClick={handleTransferToCosts}
                    disabled={transferringCost}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                  >
                    {transferringCost ? <RefreshCw size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                    Maliyet Giderlerine Otomatik Aktar
                  </button>
                </div>
              </div>

              {/* Payroll Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                        <th className="px-4 py-3">Personel</th>
                        <th className="px-3 py-3">Görev</th>
                        <th className="px-3 py-3">Ücret Tipi</th>
                        <th className="px-3 py-3 text-right">Taban Ücret</th>
                        <th className="px-3 py-3 text-center">Çalışılan Gün</th>
                        <th className="px-3 py-3 text-right">Hakediş</th>
                        <th className="px-3 py-3 text-center">Mesai (Saat)</th>
                        <th className="px-3 py-3 text-right">Mesai Tutarı</th>
                        <th className="px-3 py-3 text-right">Prim (+)</th>
                        <th className="px-3 py-3 text-right text-red-600">Avans (-)</th>
                        <th className="px-4 py-3 text-right font-extrabold text-slate-900 bg-slate-100/50">NET MAAŞ</th>
                        <th className="px-3 py-3 text-center no-print">Durum</th>
                        <th className="px-3 py-3 text-center no-print">İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payrollSummary.map(row => (
                        <tr key={row.emp.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.emp.full_name}</td>
                          <td className="px-3 py-3 text-slate-500">{row.emp.role_title}</td>
                          <td className="px-3 py-3 text-slate-600">
                            {row.emp.wage_type === 'monthly' ? 'Aylık Maaş' : 'Günlük Yevmiye'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-slate-700">
                            ₺{row.emp.base_wage.toLocaleString('tr-TR')}
                          </td>
                          <td className="px-3 py-3 text-center font-bold text-slate-800">
                            {row.workedDays} gün
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900 font-mono">
                            ₺{row.earnedBaseWage.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-3 py-3 text-center font-bold text-amber-700">
                            {row.totalOvertimeHours > 0 ? `${row.totalOvertimeHours}s` : '-'}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-amber-700 font-mono">
                            {row.totalOvertimeAmount > 0 ? `₺${row.totalOvertimeAmount.toLocaleString('tr-TR')}` : '-'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-emerald-600">
                            {row.bonuses > 0 ? `+₺${row.bonuses.toLocaleString('tr-TR')}` : '-'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-red-600 font-semibold">
                            {row.advances > 0 ? `-₺${row.advances.toLocaleString('tr-TR')}` : '-'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-800 text-sm bg-slate-50 font-mono">
                            ₺{row.netSalary.toLocaleString('tr-TR')}
                          </td>
                          <td className="px-3 py-3 text-center no-print">
                            <button
                              onClick={() => handleTogglePaid(row)}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                                row.isPaid
                                  ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                  : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                              }`}
                            >
                              {row.isPaid ? 'ÖDENDİ' : 'BEKLİYOR'}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-center no-print">
                            <button
                              onClick={() => setSelectedSlipEmp(row)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-slate-100 transition-colors"
                              title="Hesap Pusulası Yazdır"
                            >
                              <Printer size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-300 bg-slate-100 font-bold text-xs">
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-slate-800">GENEL FABRİKA TOPLAMI</td>
                        <td className="px-3 py-3 text-right font-mono text-slate-900">
                          ₺{factoryTotals.baseWage.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-3 text-center text-amber-900">{factoryTotals.overtimeHours}s</td>
                        <td className="px-3 py-3 text-right font-mono text-amber-900">
                          ₺{factoryTotals.overtime.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-emerald-700">
                          ₺{factoryTotals.bonuses.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-red-700">
                          -₺{factoryTotals.advances.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-950 text-sm">
                          ₺{factoryTotals.netSalary.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </td>
                        <td colSpan={2} className="no-print"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* 3. AVANS & EK ÖDEMELER                                          */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'avans' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {MONTHS[selectedMonth - 1]} {selectedYear} Dönemi Avans, Prim ve Kesintiler
                  </h3>
                  <p className="text-xs text-slate-400">Personele verilen nakit avanslar ve özel hakedişler</p>
                </div>
                <button
                  onClick={() => setShowTxModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                >
                  <Plus size={15} /> Yeni Hareket Ekle
                </button>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="px-4 py-3">Tarih</th>
                      <th className="px-4 py-3">Personel</th>
                      <th className="px-3 py-3">İşlem Türü</th>
                      <th className="px-4 py-3">Açıklama</th>
                      <th className="px-4 py-3 text-right">Tutar</th>
                      <th className="px-3 py-3 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-slate-400">Bu dönemde kayıtlı avans veya ek ödeme yok.</td>
                      </tr>
                    ) : (
                      transactions.map(tx => {
                        const emp = employees.find(e => e.id === tx.employee_id);
                        return (
                          <tr key={tx.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3 text-slate-500 font-mono">
                              {new Date(tx.date).toLocaleDateString('tr-TR')}
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-900">{emp?.full_name || '-'}</td>
                            <td className="px-3 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                tx.type === 'advance' ? 'bg-red-100 text-red-800' :
                                tx.type === 'bonus' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'
                              }`}>
                                {tx.type === 'advance' ? 'Avans' : tx.type === 'bonus' ? 'Prim / İkramiye' : 'Kesinti'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{tx.description || '-'}</td>
                            <td className={`px-4 py-3 text-right font-bold font-mono text-sm ${
                              tx.type === 'advance' ? 'text-red-600' : 'text-emerald-600'
                            }`}>
                              ₺{Number(tx.amount).toLocaleString('tr-TR')}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <button
                                onClick={async () => {
                                  if (!confirm('Bu işlemi silmek istediğinize emin misiniz?')) return;
                                  await supabase.from('payroll_transactions').delete().eq('id', tx.id);
                                  await loadData();
                                }}
                                className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* 4. PERSONEL LİSTESİ & TANIMLARI                                  */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {activeTab === 'personel' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Personel ara..."
                    value={empSearch}
                    onChange={e => setEmpSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <button
                  onClick={() => { setEditEmp(undefined); setShowEmpModal(true); }}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors self-start sm:self-auto"
                >
                  <Plus size={15} /> Yeni Personel Tanımla
                </button>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="px-4 py-3">Personel Adı Soyadı</th>
                      <th className="px-3 py-3">Görev / Pozisyon</th>
                      <th className="px-3 py-3">Telefon</th>
                      <th className="px-3 py-3">Ücret Modeli</th>
                      <th className="px-3 py-3 text-right">Taban Ücret</th>
                      <th className="px-3 py-3 text-center">Mesai Çarpanı</th>
                      <th className="px-3 py-3 text-center">Durum</th>
                      <th className="px-3 py-3 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employees
                      .filter(e => !empSearch || e.full_name.toLowerCase().includes(empSearch.toLowerCase()) || e.role_title.toLowerCase().includes(empSearch.toLowerCase()))
                      .map(emp => (
                        <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-900">{emp.full_name}</td>
                          <td className="px-3 py-3 text-slate-600">{emp.role_title}</td>
                          <td className="px-3 py-3 text-slate-500 font-mono">{emp.phone || '-'}</td>
                          <td className="px-3 py-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700">
                              {emp.wage_type === 'monthly' ? 'Aylık Sabit' : 'Günlük Yevmiye'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900 font-mono">
                            ₺{Number(emp.base_wage).toLocaleString('tr-TR')}
                          </td>
                          <td className="px-3 py-3 text-center font-bold text-amber-700">
                            {emp.overtime_multiplier}x
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              emp.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {emp.is_active ? 'Aktif' : 'Ayrıldı'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              onClick={() => { setEditEmp(emp); setShowEmpModal(true); }}
                              className="p-1.5 text-slate-400 hover:text-amber-600 rounded transition-colors"
                            >
                              <Edit2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODALS                                                          */}
      {/* ═════════════════════════════════════════════════════════════════ */}

      {/* 1. Personel Form Modal */}
      {showEmpModal && (
        <EmployeeModal
          initial={editEmp}
          onClose={() => { setShowEmpModal(false); setEditEmp(undefined); }}
          onSave={async () => {
            setShowEmpModal(false);
            setEditEmp(undefined);
            await loadData();
          }}
        />
      )}

      {/* 2. Avans & İşlem Modal */}
      {showTxModal && (
        <TransactionModal
          employees={employees.filter(e => e.is_active)}
          periodMonth={selectedMonth}
          periodYear={selectedYear}
          onClose={() => setShowTxModal(false)}
          onSave={async () => {
            setShowTxModal(false);
            await loadData();
          }}
        />
      )}

      {/* 3. Cell Quick Edit Modal (Matrix View) */}
      {cellEdit && (
        <Modal title={`Puantaj Güncelle — ${cellEdit.empName}`} onClose={() => setCellEdit(null)} size="sm">
          <div className="space-y-4">
            <p className="text-xs text-slate-400">Tarih: {new Date(cellEdit.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}</p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Katılım Durumu</label>
              <select
                value={cellEdit.status}
                onChange={e => setCellEdit({ ...cellEdit, status: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 font-medium"
              >
                {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
                  <option key={k} value={k}>{cfg.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Fazla Mesai (Saat)</label>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  value={cellEdit.overtime_hours}
                  onChange={e => setCellEdit({ ...cellEdit, overtime_hours: Number(e.target.value) })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold text-center"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mesai Katsayısı</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.1"
                  value={cellEdit.overtime_multiplier}
                  onChange={e => setCellEdit({ ...cellEdit, overtime_multiplier: Number(e.target.value) })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 font-semibold text-center"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Not</label>
              <input
                type="text"
                placeholder="İsteğe bağlı not..."
                value={cellEdit.notes}
                onChange={e => setCellEdit({ ...cellEdit, notes: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCellEdit(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSaveCell}
                className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-sm transition-colors"
              >
                Kaydet
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 4. Single Employee Salary Slip Print Modal */}
      {selectedSlipEmp && (
        <Modal title="Personel Maaş Hesap Pusulası" onClose={() => setSelectedSlipEmp(null)} size="md">
          <div className="space-y-4">
            <div id="salary-slip" className="p-4 border border-slate-200 rounded-xl space-y-4 bg-white text-xs">
              <div className="text-center border-b pb-2">
                <h2 className="font-bold text-base text-slate-900">PARKE ÜRETİM FABRİKASI</h2>
                <p className="text-slate-500 text-[11px]">ÜCRET HESAP PUSULASI — {MONTHS[selectedMonth - 1]} {selectedYear}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg">
                <div><span className="text-slate-500">Personel:</span> <strong className="text-slate-900">{selectedSlipEmp.emp.full_name}</strong></div>
                <div><span className="text-slate-500">Görevi:</span> <strong className="text-slate-900">{selectedSlipEmp.emp.role_title}</strong></div>
                <div><span className="text-slate-500">T.C. Kimlik:</span> <span className="font-mono">{selectedSlipEmp.emp.tc_no || '-'}</span></div>
                <div><span className="text-slate-500">Ücret Tipi:</span> <span>{selectedSlipEmp.emp.wage_type === 'monthly' ? 'Aylık Sabit' : 'Günlük Yevmiye'}</span></div>
              </div>

              <table className="w-full text-xs border-collapse">
                <tbody>
                  <tr className="border-b"><td className="py-1 text-slate-600">Taban Ücret:</td><td className="text-right font-mono font-bold">₺{selectedSlipEmp.emp.base_wage.toLocaleString('tr-TR')}</td></tr>
                  <tr className="border-b"><td className="py-1 text-slate-600">Fiili Çalışılan Gün:</td><td className="text-right font-bold">{selectedSlipEmp.workedDays} gün</td></tr>
                  <tr className="border-b"><td className="py-1 text-slate-600">Taban Hakediş Tutarı:</td><td className="text-right font-mono">₺{selectedSlipEmp.earnedBaseWage.toLocaleString('tr-TR')}</td></tr>
                  <tr className="border-b"><td className="py-1 text-slate-600">Fazla Mesai ({selectedSlipEmp.totalOvertimeHours} Saat):</td><td className="text-right font-mono text-amber-700 font-bold">+₺{selectedSlipEmp.totalOvertimeAmount.toLocaleString('tr-TR')}</td></tr>
                  {selectedSlipEmp.bonuses > 0 && <tr className="border-b"><td className="py-1 text-slate-600">Prim / İkramiye:</td><td className="text-right font-mono text-emerald-700 font-bold">+₺{selectedSlipEmp.bonuses.toLocaleString('tr-TR')}</td></tr>}
                  {selectedSlipEmp.advances > 0 && <tr className="border-b"><td className="py-1 text-slate-600">Alınan Avanslar (-):</td><td className="text-right font-mono text-red-600 font-bold">-₺{selectedSlipEmp.advances.toLocaleString('tr-TR')}</td></tr>}
                  {selectedSlipEmp.deductions > 0 && <tr className="border-b"><td className="py-1 text-slate-600">Kesintiler (-):</td><td className="text-right font-mono text-red-600 font-bold">-₺{selectedSlipEmp.deductions.toLocaleString('tr-TR')}</td></tr>}
                  <tr className="bg-slate-100 font-bold text-sm"><td className="py-2 px-1 text-slate-900">ÖDENECEK NET MAAŞ:</td><td className="py-2 px-1 text-right text-emerald-900 font-mono">₺{selectedSlipEmp.netSalary.toLocaleString('tr-TR')}</td></tr>
                </tbody>
              </table>

              <div className="pt-8 flex justify-between text-center text-[11px] text-slate-600">
                <div>
                  <p className="font-semibold">İşveren / Yetkili</p>
                  <p className="mt-8">İmza</p>
                </div>
                <div>
                  <p className="font-semibold">Personel</p>
                  <p className="mt-8">Teslim Aldım (İmza)</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
              >
                <Printer size={14} /> Yazdır
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── PRINT STYLES ── */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .no-print, header, aside {
            display: none !important;
          }
          #salary-slip, #salary-slip * {
            visibility: visible;
          }
          #salary-slip {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE MODAL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
function EmployeeModal({ initial, onClose, onSave }: { initial?: Employee; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    full_name: initial?.full_name || '',
    role_title: initial?.role_title || 'İşçi',
    phone: initial?.phone || '',
    tc_no: initial?.tc_no || '',
    start_date: initial?.start_date || new Date().toISOString().split('T')[0],
    wage_type: initial?.wage_type || 'monthly',
    base_wage: initial?.base_wage || 0,
    overtime_multiplier: initial?.overtime_multiplier || 1.5,
    monthly_hours_divisor: initial?.monthly_hours_divisor || 225,
    iban: initial?.iban || '',
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (initial) {
        const { error } = await supabase.from('employees').update(form).eq('id', initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employees').insert(form);
        if (error) throw error;
      }
      onSave();
    } catch (err: any) {
      alert('Kayıt hatası: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? 'Personel Düzenle' : 'Yeni Personel Tanımla'} onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Ad Soyad *</label>
            <input
              type="text"
              required
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Ahmet Yılmaz"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Görevi / Pozisyon *</label>
            <input
              type="text"
              required
              value={form.role_title}
              onChange={e => setForm({ ...form, role_title: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Makine Operatörü, Forkliftçi..."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Telefon</label>
            <input
              type="text"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="05XX XXX XX XX"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">T.C. Kimlik No</label>
            <input
              type="text"
              maxLength={11}
              value={form.tc_no}
              onChange={e => setForm({ ...form, tc_no: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Ücret Modeli *</label>
            <select
              value={form.wage_type}
              onChange={e => setForm({ ...form, wage_type: e.target.value as any })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 font-medium"
            >
              <option value="monthly">Aylık Sabit Maaş</option>
              <option value="daily">Günlük Yevmiye</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {form.wage_type === 'monthly' ? 'Aylık Taban Maaş (₺) *' : 'Günlük Yevmiye Tutarı (₺) *'}
            </label>
            <input
              type="number"
              min="0"
              required
              value={form.base_wage}
              onChange={e => setForm({ ...form, base_wage: Number(e.target.value) })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 font-bold"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 bg-amber-50/50 p-3 rounded-xl border border-amber-100">
          <div>
            <label className="block text-xs font-semibold text-amber-900 mb-1">Mesai Katsayısı</label>
            <input
              type="number"
              min="1"
              max="5"
              step="0.1"
              value={form.overtime_multiplier}
              onChange={e => setForm({ ...form, overtime_multiplier: Number(e.target.value) })}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
            <span className="text-[10px] text-slate-500">Standart mesai: 1.5x</span>
          </div>
          <div>
            <label className="block text-xs font-semibold text-amber-900 mb-1">Aylık Saat Böleni</label>
            <input
              type="number"
              min="100"
              max="300"
              value={form.monthly_hours_divisor}
              onChange={e => setForm({ ...form, monthly_hours_divisor: Number(e.target.value) })}
              className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
            <span className="text-[10px] text-slate-500">İş kanunu: 225 saat</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">IBAN / Banka Hesabı</label>
          <input
            type="text"
            value={form.iban}
            onChange={e => setForm({ ...form, iban: e.target.value })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
            placeholder="TRXX XXXX XXXX XXXX XXXX XXXX XX"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="is_active"
            checked={form.is_active}
            onChange={e => setForm({ ...form, is_active: e.target.checked })}
            className="w-4 h-4 text-amber-500 rounded focus:ring-amber-400"
          />
          <label htmlFor="is_active" className="text-xs font-semibold text-slate-700 cursor-pointer">
            Personel Aktif Olarak Çalışıyor
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-sm transition-colors"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION MODAL (AVANS, PRİM, KESİNTİ)
// ═══════════════════════════════════════════════════════════════════════════════
function TransactionModal({
  employees,
  periodMonth,
  periodYear,
  onClose,
  onSave
}: {
  employees: Employee[];
  periodMonth: number;
  periodYear: number;
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    employee_id: employees[0]?.id || '',
    date: new Date().toISOString().split('T')[0],
    type: 'advance' as 'advance' | 'bonus' | 'deduction',
    amount: 0,
    description: '',
    period_month: periodMonth,
    period_year: periodYear,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employee_id) {
      alert('Lütfen bir personel seçiniz.');
      return;
    }
    if (form.amount <= 0) {
      alert('Lütfen geçerli bir tutar giriniz.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('payroll_transactions').insert(form);
      if (error) throw error;
      onSave();
    } catch (err: any) {
      alert('İşlem kaydedilirken hata: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Avans / Ek Ödeme Kaydı" onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Personel *</label>
          <select
            required
            value={form.employee_id}
            onChange={e => setForm({ ...form, employee_id: e.target.value })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium"
          >
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.role_title})</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">İşlem Türü *</label>
            <select
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value as any })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 font-bold"
            >
              <option value="advance">Avans (Maaştan Düşer)</option>
              <option value="bonus">Prim / İkramiye (Maaşa Ekler)</option>
              <option value="deduction">Kesinti (Maaştan Düşer)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tutar (₺) *</label>
            <input
              type="number"
              min="1"
              required
              value={form.amount}
              onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 font-bold font-mono text-right"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">İşlem Tarihi *</label>
          <input
            type="date"
            required
            value={form.date}
            onChange={e => setForm({ ...form, date: e.target.value })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Açıklama</label>
          <input
            type="text"
            placeholder="Örn: Elden nakit avans verildi"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-colors"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
