import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Product, Customer, Site, ExternalPurchase, Supplier } from '../types';
import Modal from '../components/Modal';
import {
  ShoppingBag, Plus, Truck, Search, Filter,
  DollarSign, AlertCircle, Trash2, Edit2, Boxes,
  Printer, BarChart3, Calendar, FileText, FileSpreadsheet,
  Building2, X, ChevronRight, Check
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
  const { user, isAdmin } = useAuth();
  const [purchases, setPurchases] = useState<ExternalPurchase[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // Quick Supplier Modal State
  const [showQuickSupplierModal, setShowQuickSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [addingSupplier, setAddingSupplier] = useState(false);

  // Modal & Form State
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ExternalPurchase | null>(null);
  const [form, setForm] = useState<PurchaseFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('all');
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'this_month' | 'last_month' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'warehouse' | 'direct'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Active View Tab (İrsaliye Listesi / Malzeme Dağılımı / Tarih Dağılımı)
  const [activeViewTab, setActiveViewTab] = useState<'list' | 'materials' | 'dates'>('list');

  // Supplier Statement / Report Modal State
  const [showSupplierReportModal, setShowSupplierReportModal] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [purchRes, prodRes, custRes, siteRes, supRes] = await Promise.all([
        supabase
          .from('external_purchases')
          .select('*, products(*), shipments(*, customers(*), sites(*))')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('products').select('*').eq('is_active', true).order('name'),
        supabase.from('customers').select('*').eq('is_active', true).order('name'),
        supabase.from('sites').select('*').eq('is_active', true).order('name'),
        supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      ]);

      if (purchRes.data) setPurchases(purchRes.data as any);
      if (prodRes.data) setProducts(prodRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (siteRes.data) setSites(siteRes.data);
      if (supRes.data) setSuppliers(supRes.data);
    } catch (err) {
      console.error('Veri yükleme hatası:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuickSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) return;
    setAddingSupplier(true);
    try {
      const { data, error: supErr } = await supabase.from('suppliers').insert({
        name: newSupplierName.trim(),
        phone: newSupplierPhone.trim(),
        is_active: true,
      }).select().single();
      if (supErr) throw supErr;
      if (data) {
        setSuppliers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        setForm((f) => ({ ...f, supplier_name: data.name }));
      }
      setNewSupplierName('');
      setNewSupplierPhone('');
      setShowQuickSupplierModal(false);
    } catch (err: any) {
      alert(`Tedarikçi eklenirken hata: ${err?.message || 'Bilinmeyen hata'}`);
    } finally {
      setAddingSupplier(false);
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
          supplier_name: form.supplier_name.trim(),
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

  // Supplier options for filter dropdown
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((s) => {
      if (s.name?.trim()) set.add(s.name.trim());
    });
    purchases.forEach((p) => {
      if (p.supplier_name?.trim()) set.add(p.supplier_name.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [suppliers, purchases]);

  const { currentMonthStr, lastMonthStr, currentMonthLabel } = useMemo(() => {
    const d = new Date();
    const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const prevD = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const prev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    return { currentMonthStr: cur, lastMonthStr: prev, currentMonthLabel: label };
  }, []);

  // Filtered purchases
  const filtered = useMemo(() => {
    return purchases.filter((p) => {
      const s = search.toLowerCase().trim();
      const sup = (p.supplier_name || '').toLowerCase();
      const inv = (p.supplier_invoice_no || '').toLowerCase();
      const plate = (p.vehicle_plate || '').toLowerCase();
      const driver = (p.driver_name || '').toLowerCase();
      const prodName = p.products?.name?.toLowerCase() || '';

      const matchSearch =
        !s ||
        sup.includes(s) ||
        inv.includes(s) ||
        plate.includes(s) ||
        driver.includes(s) ||
        prodName.includes(s);

      const matchSupplier =
        filterSupplier === 'all' ||
        (p.supplier_name || '').trim().toLowerCase() === filterSupplier.trim().toLowerCase();

      let matchPeriod = true;
      if (filterPeriod === 'this_month') {
        matchPeriod = p.date.startsWith(currentMonthStr);
      } else if (filterPeriod === 'last_month') {
        matchPeriod = p.date.startsWith(lastMonthStr);
      } else if (filterPeriod === 'custom') {
        if (startDate && p.date < startDate) matchPeriod = false;
        if (endDate && p.date > endDate) matchPeriod = false;
      }

      const matchSingleDate = !filterDate || p.date === filterDate;
      const matchProduct = filterProduct === 'all' || p.product_id === filterProduct;
      const matchType =
        filterType === 'all' ||
        (filterType === 'warehouse' && !p.is_direct_shipment) ||
        (filterType === 'direct' && p.is_direct_shipment);

      return matchSearch && matchSupplier && matchPeriod && matchSingleDate && matchProduct && matchType;
    });
  }, [
    purchases,
    search,
    filterSupplier,
    filterPeriod,
    currentMonthStr,
    lastMonthStr,
    startDate,
    endDate,
    filterDate,
    filterProduct,
    filterType,
  ]);

  // Aggregate KPIs
  const kpis = useMemo(() => {
    let totalParkeM2 = 0;
    let totalBordurMetre = 0;
    let totalAdet = 0;
    let directShipmentQty = 0;
    let totalPurchaseCost = 0;

    filtered.forEach((p) => {
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

  // Material Summary (Malzeme Bazında Dağılım)
  const materialSummary = useMemo(() => {
    const map: Record<
      string,
      {
        productId: string;
        productName: string;
        thickness: string;
        color: string;
        unit: string;
        quantity: number;
        pallets: number;
        trips: number;
        totalCost: number;
      }
    > = {};

    filtered.forEach((p) => {
      const key = p.product_id || p.products?.name || 'diger';
      const pName = p.products?.name || 'Ürün';
      const thickness = p.products?.thickness || '';
      const color = p.products?.color || '';
      const unit = p.unit || p.products?.unit || 'm²';
      const qty = Number(p.quantity) || 0;
      const pallets = Number(p.pallets) || 0;
      const cost = qty * (Number(p.unit_price) || 0);

      if (!map[key]) {
        map[key] = {
          productId: key,
          productName: pName,
          thickness,
          color,
          unit,
          quantity: 0,
          pallets: 0,
          trips: 0,
          totalCost: 0,
        };
      }

      map[key].quantity += qty;
      map[key].pallets += pallets;
      map[key].trips += 1;
      map[key].totalCost += cost;
    });

    return Object.values(map).sort((a, b) => b.quantity - a.quantity);
  }, [filtered]);

  // Date Summary (Tarih Bazında Dağılım)
  const dateSummary = useMemo(() => {
    const map: Record<
      string,
      {
        date: string;
        quantity: number;
        pallets: number;
        trips: number;
        plates: Set<string>;
        productsMap: Record<string, { name: string; qty: number; unit: string }>;
      }
    > = {};

    filtered.forEach((p) => {
      const d = p.date;
      const qty = Number(p.quantity) || 0;
      const pallets = Number(p.pallets) || 0;
      const pName = p.products?.name || 'Ürün';
      const unit = p.unit || p.products?.unit || 'm²';

      if (!map[d]) {
        map[d] = {
          date: d,
          quantity: 0,
          pallets: 0,
          trips: 0,
          plates: new Set<string>(),
          productsMap: {},
        };
      }

      map[d].quantity += qty;
      map[d].pallets += pallets;
      map[d].trips += 1;
      if (p.vehicle_plate) map[d].plates.add(p.vehicle_plate);

      if (!map[d].productsMap[pName]) {
        map[d].productsMap[pName] = { name: pName, qty: 0, unit };
      }
      map[d].productsMap[pName].qty += qty;
    });

    return Object.values(map)
      .map((item) => ({
        ...item,
        platesList: Array.from(item.plates),
        productsList: Object.values(item.productsMap),
      }))
      .sort((a, b) => (b.date > a.date ? 1 : -1));
  }, [filtered]);

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Tarih',
      'Tedarikçi (Fabrika)',
      'İrsaliye No',
      'Araç / Plaka',
      'Şoför',
      'Ürün',
      'Kalınlık',
      'Renk',
      'Miktar',
      'Birim',
      'Palet',
      'Sevk Türü',
      'Alış Birim Fiyatı (TL)',
      'Toplam Tutar (TL)',
    ];

    const rows = filtered.map((p) => [
      p.date,
      `"${p.supplier_name || ''}"`,
      `"${p.supplier_invoice_no || ''}"`,
      `"${p.vehicle_plate || ''}"`,
      `"${p.driver_name || ''}"`,
      `"${p.products?.name || ''}"`,
      `"${p.products?.thickness || ''}"`,
      `"${p.products?.color || ''}"`,
      p.quantity,
      p.unit,
      p.pallets || 0,
      p.is_direct_shipment ? 'Transit' : 'Depo Girişi',
      p.unit_price || 0,
      (Number(p.quantity) * (Number(p.unit_price) || 0)).toFixed(2),
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const supplierSlug = filterSupplier !== 'all' ? `_${filterSupplier}` : '';
    link.setAttribute('download', `Dis_Alim_Raporu${supplierSlug}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSupplierReportModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
            title="Tedarikçi bazında detaylı malzeme ve sevkiyat icmali"
          >
            <BarChart3 size={15} className="text-amber-400" />
            Tedarikçi Malzeme Raporu & İcmal
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
            title="Filtrelenmiş listeyi Excel uyumlu CSV olarak indir"
          >
            <FileSpreadsheet size={15} className="text-emerald-600" />
            Excel / CSV
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Printer size={15} /> Yazdır / PDF
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl font-bold text-xs transition-colors shadow-sm"
          >
            <Plus size={16} /> Yeni Dış Alım Girişi
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
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Genel Arama */}
          <div className="md:col-span-4 relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Firma, irsaliye no, plaka, şoför veya ürün ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 font-medium"
            />
          </div>

          {/* Tedarikçi Seçimi */}
          <div className="md:col-span-3">
            <div className="relative">
              <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500 pointer-events-none" />
              <select
                value={filterSupplier}
                onChange={(e) => setFilterSupplier(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              >
                <option value="all">🏭 Tüm Tedarikçiler ({supplierOptions.length})</option>
                {supplierOptions.map((s) => (
                  <option key={s} value={s}>
                    🏭 {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dönem Seçimi */}
          <div className="md:col-span-3">
            <div className="relative">
              <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
              <select
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value as any)}
                className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              >
                <option value="all">📅 Tüm Zamanlar</option>
                <option value="this_month">📅 Bu Ay ({currentMonthLabel})</option>
                <option value="last_month">📅 Geçen Ay</option>
                <option value="custom">🗓️ Özel Tarih Aralığı...</option>
              </select>
            </div>
          </div>

          {/* Giriş Türü */}
          <div className="md:col-span-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            >
              <option value="all">Tüm Girişler</option>
              <option value="warehouse">Sadece Depo Girişi</option>
              <option value="direct">Sadece Transit (Müşteriye)</option>
            </select>
          </div>
        </div>

        {/* İkincil Filtreler */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {filterPeriod === 'custom' && (
              <div className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200">
                <span className="text-[11px] font-semibold text-amber-900">Aralık:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs"
                />
                <span className="text-slate-400">-</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Ürün:</span>
              <select
                value={filterProduct}
                onChange={(e) => setFilterProduct(e.target.value)}
                className="border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              >
                <option value="all">Tüm Ürünler ({products.length})</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.thickness})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Tek Gün:</span>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="border border-slate-200 rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {(filterSupplier !== 'all' ||
            filterPeriod !== 'all' ||
            filterProduct !== 'all' ||
            filterType !== 'all' ||
            filterDate ||
            search) && (
            <button
              onClick={() => {
                setSearch('');
                setFilterSupplier('all');
                setFilterPeriod('all');
                setStartDate('');
                setEndDate('');
                setFilterDate('');
                setFilterProduct('all');
                setFilterType('all');
              }}
              className="text-xs font-bold text-red-600 hover:text-red-800 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
            >
              <X size={13} /> Filtreleri Temizle
            </button>
          )}
        </div>
      </div>

      {/* ── SEÇİLİ TEDARİKÇİ & DÖNEM BİLGİ ŞERİDİ ── */}
      {(filterSupplier !== 'all' || filterPeriod !== 'all') && (
        <div className="no-print mb-6 p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-blue-500/10 to-indigo-500/10 border border-amber-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-lg shadow-xs">
              🏢
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-black text-slate-900">
                  {filterSupplier !== 'all' ? filterSupplier : 'Tüm Tedarikçiler'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  {filterPeriod === 'this_month'
                    ? `Bu Ay (${currentMonthLabel})`
                    : filterPeriod === 'last_month'
                    ? 'Geçen Ay'
                    : filterPeriod === 'custom'
                    ? `${startDate || '...'} / ${endDate || '...'}`
                    : 'Tüm Dönem'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Seçili filtreye göre toplam <strong className="text-slate-900">{kpis.count} sefer / irsaliye</strong> ve{' '}
                <strong className="text-blue-900 font-mono">
                  {kpis.totalParkeM2.toLocaleString('tr-TR')} m²
                </strong>{' '}
                parke girişi tespit edildi.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowSupplierReportModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <FileText size={14} /> Bu Seçimin İcmal Raporunu Aç
          </button>
        </div>
      )}

      {/* ── GÖRÜNÜM SEKME DEĞİŞTİRİCİ ── */}
      <div className="no-print flex items-center gap-2 border-b border-slate-200 mb-6 bg-slate-100/70 p-1.5 rounded-2xl">
        <button
          onClick={() => setActiveViewTab('list')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeViewTab === 'list'
              ? 'bg-white text-amber-900 shadow-xs border border-slate-200/80 font-black'
              : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
          }`}
        >
          <FileText size={15} className={activeViewTab === 'list' ? 'text-amber-500' : 'text-slate-400'} />
          İrsaliye & Sefer Listesi ({filtered.length})
        </button>
        <button
          onClick={() => setActiveViewTab('materials')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeViewTab === 'materials'
              ? 'bg-white text-amber-900 shadow-xs border border-slate-200/80 font-black'
              : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
          }`}
        >
          <Boxes size={15} className={activeViewTab === 'materials' ? 'text-blue-500' : 'text-slate-400'} />
          Malzeme Bazında Dağılım ({materialSummary.length} Çeşit Ürün)
        </button>
        <button
          onClick={() => setActiveViewTab('dates')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeViewTab === 'dates'
              ? 'bg-white text-amber-900 shadow-xs border border-slate-200/80 font-black'
              : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
          }`}
        >
          <Calendar size={15} className={activeViewTab === 'dates' ? 'text-emerald-500' : 'text-slate-400'} />
          Tarih Bazında Dağılım ({dateSummary.length} Gün Dökümü)
        </button>
      </div>

      {/* ── TAB 1: İRSALİYE VE SEFER LİSTESİ ── */}
      {activeViewTab === 'list' && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-100 overflow-hidden print-clean">
          <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag size={16} className="text-amber-500" />
              <h2 className="font-bold text-slate-900 text-sm">Dış Alım & Transit Mal Kabul Listesi</h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">{filtered.length} Kayıt Listeleniyor</span>
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
                        Seçilen kriterlere uygun dış alım bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((p) => {
                      const linkedShipment = (p as any).shipments;
                      const unitLabel = p.unit === 'metre' ? 'Metre' : p.unit === 'adet' ? 'Adet' : 'm²';
                      const unitColor =
                        p.unit === 'metre'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : p.unit === 'adet'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200';
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
                            <div className="text-[10px] text-slate-400">
                              {p.products?.thickness} / {p.products?.color}
                            </div>
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
                            {Number(p.unit_price) > 0
                              ? `₺${Number(p.unit_price).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`
                              : '-'}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900">
                            {totalCost > 0 ? `₺${totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : '-'}
                          </td>
                          <td className="px-4 py-3.5 text-right no-print">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenEdit(p)}
                                className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                title="Düzenle"
                              >
                                <Edit2 size={14} />
                              </button>
                              {isAdmin() && (
                                <button
                                  onClick={() => handleDelete(p)}
                                  disabled={deletingId === p.id}
                                  className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
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
      )}

      {/* ── TAB 2: MALZEME BAZINDA DAĞILIM ── */}
      {activeViewTab === 'materials' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-xs border border-slate-100 overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes size={16} className="text-blue-500" />
                <h2 className="font-bold text-slate-900 text-sm">
                  Malzeme Bazında Toplam Döküm {filterSupplier !== 'all' ? `(${filterSupplier})` : ''}
                </h2>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {materialSummary.length} Farklı Ürün Çeşidi
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="px-4 py-3">Ürün Adı</th>
                    <th className="px-3 py-3">Kalınlık & Renk</th>
                    <th className="px-3 py-3 text-center">Sefer Sayısı</th>
                    <th className="px-3 py-3 text-right">Toplam Palet</th>
                    <th className="px-3 py-3 text-right">Toplam Miktar</th>
                    <th className="px-3 py-3 text-right">Ortalama / Sefer</th>
                    <th className="px-3 py-3 text-right">Toplam Alış Tutarı</th>
                    <th className="px-4 py-3 text-center">% Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {materialSummary.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        Kayıtlı malzeme bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    materialSummary.map((m, idx) => {
                      const totalQtyAll = materialSummary.reduce((acc, curr) => acc + curr.quantity, 0);
                      const pct = totalQtyAll > 0 ? (m.quantity / totalQtyAll) * 100 : 0;
                      const avgPerTrip = m.trips > 0 ? m.quantity / m.trips : 0;

                      return (
                        <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3.5 font-bold text-slate-900">
                            {m.productName}
                          </td>
                          <td className="px-3 py-3.5 text-slate-500">
                            {m.thickness ? `${m.thickness} / ` : ''}{m.color || 'Standart'}
                          </td>
                          <td className="px-3 py-3.5 text-center font-bold text-slate-700">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                              {m.trips} Sefer
                            </span>
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono font-medium text-slate-600">
                            {m.pallets > 0 ? `${m.pallets} Palet` : '-'}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono">
                            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-900 border border-blue-200 font-bold text-sm">
                              {m.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {m.unit}
                            </span>
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono text-slate-600">
                            {avgPerTrip.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {m.unit}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900">
                            {m.totalCost > 0 ? `₺${m.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : '-'}
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                                <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                              <span className="text-[11px] font-bold text-slate-600 font-mono">%{pct.toFixed(0)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: TARİH BAZINDA DAĞILIM ── */}
      {activeViewTab === 'dates' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-xs border border-slate-100 overflow-hidden">
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-emerald-500" />
                <h2 className="font-bold text-slate-900 text-sm">
                  Tarih Bazında Alım ve Sevkiyat Dökümü {filterSupplier !== 'all' ? `(${filterSupplier})` : ''}
                </h2>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {dateSummary.length} Farklı Tarihte Sevkiyat
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-3 py-3 text-center">Sefer (Kamyon)</th>
                    <th className="px-3 py-3">Gelen Araç Plakaları</th>
                    <th className="px-3 py-3">Gelen Malzemeler ve Miktarları</th>
                    <th className="px-3 py-3 text-right">Toplam Palet</th>
                    <th className="px-4 py-3 text-right">Günlük Toplam Miktar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dateSummary.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        Kayıtlı tarih verisi bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    dateSummary.map((d, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3.5 font-bold text-slate-900 whitespace-nowrap">
                          {new Date(d.date).toLocaleDateString('tr-TR', {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold font-mono">
                            {d.trips} Sefer
                          </span>
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {d.platesList.length > 0 ? (
                              d.platesList.map((pl, pIdx) => (
                                <span
                                  key={pIdx}
                                  className="px-2 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-bold text-slate-700 border border-slate-200"
                                >
                                  {pl}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="space-y-1">
                            {d.productsList.map((prod, pIdx) => (
                              <div key={pIdx} className="flex items-center justify-between gap-3 text-slate-700">
                                <span className="font-medium">{prod.name}:</span>
                                <span className="font-mono font-bold text-slate-900">
                                  {prod.qty.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {prod.unit}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono font-medium text-slate-600">
                          {d.pallets > 0 ? `${d.pallets} Palet` : '-'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono">
                          <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-900 border border-blue-200 font-bold text-sm">
                            {d.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
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
      )}

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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">Tedarikçi Carisi *</label>
                    <button
                      type="button"
                      onClick={() => setShowQuickSupplierModal(true)}
                      className="text-[11px] text-amber-700 hover:text-amber-900 font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus size={12} /> + Yeni Tedarikçi
                    </button>
                  </div>
                  <select
                    required
                    value={form.supplier_name}
                    onChange={e => setForm({ ...form, supplier_name: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  >
                    <option value="">Tedarikçi Seçin...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.name}>
                        🏭 {s.name} {s.phone ? `(${s.phone})` : ''}
                      </option>
                    ))}
                    {form.supplier_name && !suppliers.some(s => s.name === form.supplier_name) && (
                      <option value={form.supplier_name}>
                        🏭 {form.supplier_name}
                      </option>
                    )}
                  </select>
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

      {/* ── HIZLI YENİ TEDARİKÇİ EKLEME MODALI ── */}
      {showQuickSupplierModal && (
        <Modal
          title="Yeni Tedarikçi (Dış Fabrika) Ekle"
          onClose={() => {
            setShowQuickSupplierModal(false);
            setNewSupplierName('');
            setNewSupplierPhone('');
          }}
          size="sm"
        >
          <form onSubmit={handleAddQuickSupplier} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tedarikçi / Fabrika Ünvanı <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Örn: Doğan Parke ve Beton Elemanları"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Telefon (Opsiyonel)
              </label>
              <input
                type="text"
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder="Örn: 0532 xxx xx xx"
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowQuickSupplierModal(false);
                  setNewSupplierName('');
                  setNewSupplierPhone('');
                }}
                className="px-3.5 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={addingSupplier || !newSupplierName.trim()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
              >
                {addingSupplier ? 'Kaydediliyor...' : 'Kaydet ve Seç'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── TEDARİKÇİ MALZEME ALIM İCMALİ & RAPOR MODALI ── */}
      {showSupplierReportModal && (
        <Modal
          title={`Tedarikçi Malzeme Alım İcmali ${filterSupplier !== 'all' ? `— ${filterSupplier}` : ''}`}
          onClose={() => setShowSupplierReportModal(false)}
          size="xl"
        >
          <div className="space-y-6">
            {/* Modal Üst Hızlı Kontrolleri */}
            <div className="no-print flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Building2 size={15} className="text-amber-500" />
                  <span>Tedarikçi:</span>
                  <select
                    value={filterSupplier}
                    onChange={(e) => setFilterSupplier(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold bg-white"
                  >
                    <option value="all">Tüm Tedarikçiler</option>
                    {supplierOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Calendar size={15} className="text-blue-500" />
                  <span>Dönem:</span>
                  <select
                    value={filterPeriod}
                    onChange={(e) => setFilterPeriod(e.target.value as any)}
                    className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold bg-white"
                  >
                    <option value="all">Tüm Zamanlar</option>
                    <option value="this_month">Bu Ay ({currentMonthLabel})</option>
                    <option value="last_month">Geçen Ay</option>
                    <option value="custom">Özel Tarih Aralığı</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg text-xs font-bold text-slate-700 transition-colors shadow-xs cursor-pointer"
                >
                  <FileSpreadsheet size={14} className="text-emerald-600" /> Excel İndir
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
                >
                  <Printer size={14} /> Yazdır / PDF
                </button>
              </div>
            </div>

            {/* Rapor Belgesi (Yazdırılabilir Alan) */}
            <div className="p-6 bg-white border border-slate-200 rounded-xl space-y-6 text-slate-800 shadow-xs">
              {/* Belge Başlığı */}
              <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-wide">
                    PARKEM PARKE & BETON ELEMANLARI
                  </h2>
                  <p className="text-xs text-slate-500">Dış Fabrika Malzeme Alım ve Sevk İcmal Raporu</p>
                </div>
                <div className="text-right text-xs space-y-0.5">
                  <div>
                    <span className="text-slate-400">Rapor Tarihi: </span>
                    <span className="font-bold font-mono">{new Date().toLocaleDateString('tr-TR')}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Rapor Dönemi: </span>
                    <span className="font-bold text-amber-700">
                      {filterPeriod === 'this_month'
                        ? `Bu Ay (${currentMonthLabel})`
                        : filterPeriod === 'last_month'
                        ? 'Geçen Ay'
                        : filterPeriod === 'custom'
                        ? `${startDate || '...'} - ${endDate || '...'}`
                        : 'Tüm Dönemler'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Raporlanan Tedarikçi Kutusu */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase">Tedarikçi Firma</div>
                  <div className="font-black text-slate-900 text-sm mt-0.5">
                    {filterSupplier !== 'all' ? filterSupplier : 'TÜM TEDARİKÇİLER'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase">Toplam Sefer Sayısı</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5 font-mono">
                    {filtered.length} Sefer
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase">Toplam Parke</div>
                  <div className="font-bold text-blue-900 text-sm mt-0.5 font-mono">
                    {kpis.totalParkeM2.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} m²
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase">Toplam Alış Tutarı</div>
                  <div className="font-bold text-slate-900 text-sm mt-0.5 font-mono">
                    ₺{kpis.totalPurchaseCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>

              {/* BÖLÜM 1: Malzeme Bazında Özet İcmal Tablosu */}
              <div>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Boxes size={14} className="text-blue-500" />
                  1. Malzeme Bazında Alım İcmali
                </h3>
                <table className="w-full text-xs text-left border border-slate-200">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 border-r border-slate-200">#</th>
                      <th className="px-3 py-2 border-r border-slate-200">Malzeme Adı</th>
                      <th className="px-3 py-2 border-r border-slate-200">Kalınlık / Renk</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-center">Sefer</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-right">Palet</th>
                      <th className="px-3 py-2 border-r border-slate-200 text-right">Toplam Miktar</th>
                      <th className="px-3 py-2 text-right">Toplam Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {materialSummary.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-slate-400">
                          Kayıt bulunamadı.
                        </td>
                      </tr>
                    ) : (
                      materialSummary.map((m, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2 border-r border-slate-200 font-mono text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2 border-r border-slate-200 font-bold text-slate-900">
                            {m.productName}
                          </td>
                          <td className="px-3 py-2 border-r border-slate-200 text-slate-600">
                            {m.thickness ? `${m.thickness} / ` : ''}{m.color || 'Standart'}
                          </td>
                          <td className="px-3 py-2 border-r border-slate-200 text-center font-bold font-mono">
                            {m.trips}
                          </td>
                          <td className="px-3 py-2 border-r border-slate-200 text-right font-mono">
                            {m.pallets > 0 ? m.pallets : '-'}
                          </td>
                          <td className="px-3 py-2 border-r border-slate-200 text-right font-mono font-bold text-blue-900">
                            {m.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} {m.unit}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                            {m.totalCost > 0 ? `₺${m.totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {materialSummary.length > 0 && (
                    <tfoot className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-right border-r border-slate-200">
                          GENEL TOPLAM:
                        </td>
                        <td className="px-3 py-2 text-center border-r border-slate-200 font-mono">
                          {materialSummary.reduce((acc, c) => acc + c.trips, 0)} Sefer
                        </td>
                        <td className="px-3 py-2 text-right border-r border-slate-200 font-mono">
                          {materialSummary.reduce((acc, c) => acc + c.pallets, 0)}
                        </td>
                        <td className="px-3 py-2 text-right border-r border-slate-200 font-mono text-blue-900">
                          {materialSummary.reduce((acc, c) => acc + c.quantity, 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          ₺{materialSummary.reduce((acc, c) => acc + c.totalCost, 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* BÖLÜM 2: Tarih & İrsaliye Bazında Sevkiyat Listesi */}
              <div>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Calendar size={14} className="text-emerald-500" />
                  2. Tarih ve İrsaliye Bazında Sefer Dökümü ({filtered.length} Sefer)
                </h3>
                <div className="max-h-[360px] overflow-y-auto border border-slate-200">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 border-r border-slate-200">Tarih</th>
                        <th className="px-3 py-2 border-r border-slate-200">İrsaliye No</th>
                        <th className="px-3 py-2 border-r border-slate-200">Plaka / Şoför</th>
                        <th className="px-3 py-2 border-r border-slate-200">Ürün</th>
                        <th className="px-3 py-2 border-r border-slate-200">Sevk Şekli</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-right">Miktar</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-right">Palet</th>
                        <th className="px-3 py-2 text-right">Tutar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map((p) => {
                        const total = Number(p.quantity) * (Number(p.unit_price) || 0);
                        return (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 border-r border-slate-200 whitespace-nowrap font-medium">
                              {new Date(p.date).toLocaleDateString('tr-TR')}
                            </td>
                            <td className="px-3 py-2 border-r border-slate-200 font-mono text-slate-600">
                              {p.supplier_invoice_no || '-'}
                            </td>
                            <td className="px-3 py-2 border-r border-slate-200 font-mono">
                              <span className="font-bold">{p.vehicle_plate || '-'}</span>
                              {p.driver_name && <span className="text-slate-400 text-[10px] ml-1">({p.driver_name})</span>}
                            </td>
                            <td className="px-3 py-2 border-r border-slate-200">
                              <div className="font-semibold">{p.products?.name}</div>
                              <div className="text-[10px] text-slate-400">
                                {p.products?.thickness} / {p.products?.color}
                              </div>
                            </td>
                            <td className="px-3 py-2 border-r border-slate-200">
                              {p.is_direct_shipment ? (
                                <span className="text-emerald-700 font-bold text-[10px]">Transit (Şantiye)</span>
                              ) : (
                                <span className="text-slate-600 text-[10px]">Depo Girişi</span>
                              )}
                            </td>
                            <td className="px-3 py-2 border-r border-slate-200 text-right font-mono font-bold text-slate-900">
                              {Number(p.quantity).toLocaleString('tr-TR')} {p.unit}
                            </td>
                            <td className="px-3 py-2 border-r border-slate-200 text-right font-mono text-slate-500">
                              {p.pallets || '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                              {total > 0 ? `₺${total.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Belge İmzaları */}
              <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-200 text-xs">
                <div className="border border-slate-200 rounded-lg p-3 text-center">
                  <div className="text-slate-400 mb-8 font-semibold">Raporu Düzenleyen</div>
                  <div className="font-bold text-slate-700">Kaşe / İmza</div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 text-center">
                  <div className="text-slate-400 mb-8 font-semibold">Tedarikçi Yetkilisi Onayı</div>
                  <div className="font-bold text-slate-700">Kaşe / İmza</div>
                </div>
              </div>
            </div>

            {/* Modal Kapat Butonu */}
            <div className="no-print flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowSupplierReportModal(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
