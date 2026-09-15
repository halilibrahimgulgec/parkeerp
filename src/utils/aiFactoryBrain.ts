import { supabase } from '../lib/supabase';
import { getLearnedRules, formatRulesForPrompt, AILearnedRule } from './aiTrainingKnowledge';

export interface CustomerPalletDetail {
  customer: string;
  site: string;
  palletType: 'uretim' | 'tahta' | 'sevkiyat' | string;
  sent: number;
  returned: number;
  balance: number;
}

export interface CustomerPalletDebtor {
  customer: string;
  balance: number;
  uretim: number;
  tahta: number;
  sevkiyat: number;
}

export interface TodayShipmentDetail {
  customer: string;
  site: string;
  qty: string;
  invoice: string;
  plate?: string;
  driver?: string;
  items: { name: string; m2: number; unit: string }[];
  totalM2: number;
  totalMetre: number;
  totalAdet: number;
  netWeight: number;
}

export interface FactorySnapshot {
  timestamp: string;
  todayDate: string;
  // Stocks
  totalProductsCount: number;
  lowStockItems: { name: string; current: number; min: number; unit: string; thickness?: string }[];
  totalStockParkeM2: number;
  totalStockBordurMetre: number;
  totalStockAdet: number;
  // Today Production
  todayProductionTotalM2: number;
  todayProductionParkeM2: number;
  todayProductionBordurMetre: number;
  todayProductionAdet: number;
  todayMachine1Output: string;
  todayMachine2Output: string;
  todayScrapTotalM2: number;
  todayEntriesCount: number;
  // Today Shipments
  todayShipmentsCount: number;
  todayShipmentParkeM2: number;
  todayShipmentBordurMetre: number;
  todayShipmentAdet: number;
  todayShipmentTonnage: number;
  todayRecentShipments: TodayShipmentDetail[];
  // Orders & Quotas
  pendingOrdersCount: number;
  criticalOrders: { orderNo: string; customer: string; product: string; qty: string; dueDate?: string }[];
  activeQuotasCount: number;
  lowQuotaAlerts: { customer: string; product: string; remaining: number; unit: string }[];
  // Pallets (Detailed)
  palletBalances: CustomerPalletDetail[];
  palletDebtors: CustomerPalletDebtor[];
  totalUnreturnedPallets: number;
  totalUnreturnedUretim: number;
  totalUnreturnedTahta: number;
  // Financial
  monthlyRevenue: number;
  monthlyProductionM2: number;
  monthlyCostsTotal: number;
  estimatedUnitCost: number;
}

export function normalizeTurkish(str: string): string {
  return (str || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/i̇/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

// ---------------------------------------------------------------------------
// 1. Fetch Fresh Live Factory Snapshot
// ---------------------------------------------------------------------------
export async function getLiveFactorySnapshot(): Promise<FactorySnapshot> {
  const todayDate = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const startOfMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;

  try {
    const [
      stockRes,
      prodTodayRes,
      shipTodayRes,
      ordersRes,
      quotasRes,
      palletRes,
      costsRes,
      prodMonthRes,
      shipMonthRes
    ] = await Promise.all([
      supabase.from('v_product_stock').select('*'),
      supabase.from('production_entries').select('*, products(name, unit, thickness, color)').eq('date', todayDate),
      supabase.from('shipments').select('*, customers(name), sites(name), shipment_items(*, products(name, unit))').eq('shipment_date', todayDate).eq('status', 'completed'),
      supabase.from('production_orders').select('*, customers(name), products(name, unit)').in('status', ['pending', 'planned']),
      supabase.from('customer_quotas').select('*, customers(name), sites(name), products(name, unit)').eq('is_active', true),
      supabase.from('v_pallet_balances').select('*'),
      supabase.from('cost_entries').select('cost_type, total_amount').eq('period_month', currentMonth).eq('period_year', currentYear),
      supabase.from('production_entries').select('net_m2').gte('date', startOfMonth),
      supabase.from('shipments').select('total_m2, sale_price_per_m2').gte('shipment_date', startOfMonth).eq('status', 'completed'),
    ]);

    const stocks = stockRes.data || [];
    const prodToday = prodTodayRes.data || [];
    const shipToday = shipTodayRes.data || [];
    const orders = ordersRes.data || [];
    const quotas = quotasRes.data || [];
    const rawPallets = palletRes.data || [];
    const costs = costsRes.data || [];

    // Stocks
    let totalStockParkeM2 = 0;
    let totalStockBordurMetre = 0;
    let totalStockAdet = 0;
    const lowStockItems: FactorySnapshot['lowStockItems'] = [];

    stocks.forEach((s: any) => {
      const u = s.unit || 'm2';
      const cur = Number(s.current_stock || 0);
      const min = Number(s.min_stock_alert || 0);
      if (u === 'metre') totalStockBordurMetre += cur;
      else if (u === 'adet') totalStockAdet += cur;
      else totalStockParkeM2 += cur;

      if (cur <= min && min > 0) {
        lowStockItems.push({
          name: s.product_name || 'İsimsiz Ürün',
          current: cur,
          min: min,
          unit: u,
          thickness: s.thickness,
        });
      }
    });

    // Today Production
    let todayProdM2 = 0;
    let todayProdMetre = 0;
    let todayProdAdet = 0;
    let todayScrapM2 = 0;
    let m1Parke = 0;
    let m2Bordur = 0;

    prodToday.forEach((p: any) => {
      const net = Number(p.net_m2 || 0);
      const scrap = Number(p.scrap_m2 || 0);
      const unit = p.products?.unit || 'm2';
      todayScrapM2 += scrap;

      if (unit === 'metre') {
        todayProdMetre += net;
        m2Bordur += net;
      } else if (unit === 'adet') {
        todayProdAdet += net;
      } else {
        todayProdM2 += net;
        m1Parke += net;
      }
    });

    // Today Shipments
    let todayShipM2 = 0;
    let todayShipMetre = 0;
    let todayShipAdet = 0;
    let todayShipTonnage = 0;
    const todayRecent: FactorySnapshot['todayRecentShipments'] = [];

    shipToday.forEach((s: any) => {
      const actualNet = Number(s.net_weight || 0) || (Number(s.gross_weight || 0) && Number(s.tare_weight || 0) ? Number(s.gross_weight) - Number(s.tare_weight) : 0);
      todayShipTonnage += actualNet / 1000;

      const items = s.shipment_items || [];
      const itemDescriptions: string[] = [];
      const parsedItems: { name: string; m2: number; unit: string }[] = [];
      let sM2 = 0;
      let sMetre = 0;
      let sAdet = 0;

      if (items.length > 0) {
        items.forEach((it: any) => {
          const u = it.products?.unit || it.unit || 'm2';
          const q = Number(it.m2 || 0);
          const pName = it.products?.name || 'Ürün';
          parsedItems.push({ name: pName, m2: q, unit: u });

          if (u === 'metre') {
            todayShipMetre += q;
            sMetre += q;
            itemDescriptions.push(`${q} metre ${pName}`);
          } else if (u === 'adet') {
            todayShipAdet += q;
            sAdet += q;
            itemDescriptions.push(`${q} adet ${pName}`);
          } else {
            todayShipM2 += q;
            sM2 += q;
            itemDescriptions.push(`${q} m² ${pName}`);
          }
        });
      } else {
        const fallbackM2 = Number(s.total_m2 || 0);
        todayShipM2 += fallbackM2;
        sM2 += fallbackM2;
        itemDescriptions.push(`${fallbackM2} m²`);
        parsedItems.push({ name: 'Parke Taşı', m2: fallbackM2, unit: 'm²' });
      }

      todayRecent.push({
        customer: s.customers?.name || 'Belirtilmemiş Müşteri',
        site: s.sites?.name || 'Ana Şantiye / Merkez',
        qty: itemDescriptions.join(', '),
        invoice: s.invoice_no || '-',
        plate: s.vehicle_plate || '',
        driver: s.driver_name || '',
        items: parsedItems,
        totalM2: sM2,
        totalMetre: sMetre,
        totalAdet: sAdet,
        netWeight: actualNet,
      });
    });

    // Critical Orders
    const criticalOrders = orders
      .filter((o: any) => o.priority === 'critical' || o.priority === 'high')
      .slice(0, 5)
      .map((o: any) => ({
        orderNo: o.order_no,
        customer: o.customers?.name || '-',
        product: o.products?.name || '-',
        qty: `${o.quantity} ${o.unit}`,
        dueDate: o.due_date,
      }));

    // Quotas
    const lowQuotaAlerts = quotas
      .filter((q: any) => Number(q.remaining_m2) < 500)
      .map((q: any) => ({
        customer: q.customers?.name || '-',
        product: q.products?.name || '-',
        remaining: Number(q.remaining_m2 || 0),
        unit: q.products?.unit || 'm²',
      }));

    // Pallets (Real data from v_pallet_balances)
    const palletBalances: CustomerPalletDetail[] = [];
    const customerPalletMap: Record<string, { uretim: number; tahta: number; sevkiyat: number; total: number }> = {};
    let totalUnreturnedPallets = 0;
    let totalUnreturnedUretim = 0;
    let totalUnreturnedTahta = 0;

    rawPallets.forEach((p: any) => {
      const cName = (p.customer_name || 'Müşteri').trim();
      const bal = Number(p.balance) || 0;
      const pType = (p.pallet_type || 'tahta').toLowerCase();

      palletBalances.push({
        customer: cName,
        site: p.site_name || '',
        palletType: pType,
        sent: Number(p.total_sent) || 0,
        returned: Number(p.total_returned) || 0,
        balance: bal,
      });

      if (!customerPalletMap[cName]) {
        customerPalletMap[cName] = { uretim: 0, tahta: 0, sevkiyat: 0, total: 0 };
      }

      if (bal > 0) {
        totalUnreturnedPallets += bal;
        if (pType === 'uretim') {
          totalUnreturnedUretim += bal;
          customerPalletMap[cName].uretim += bal;
        } else if (pType === 'tahta') {
          totalUnreturnedTahta += bal;
          customerPalletMap[cName].tahta += bal;
        } else {
          customerPalletMap[cName].sevkiyat += bal;
        }
        customerPalletMap[cName].total += bal;
      }
    });

    const palletDebtors: CustomerPalletDebtor[] = Object.entries(customerPalletMap)
      .map(([customer, stats]) => ({
        customer,
        balance: stats.total,
        uretim: stats.uretim,
        tahta: stats.tahta,
        sevkiyat: stats.sevkiyat,
      }))
      .filter((d) => d.balance > 0)
      .sort((a, b) => b.balance - a.balance);

    // Financial
    const monthlyCostsTotal = costs.reduce((sum: number, c: any) => sum + Number(c.total_amount || 0), 0);
    const monthlyProdRows = prodMonthRes.data || [];
    const monthlyProductionM2 = monthlyProdRows.reduce((sum: number, p: any) => sum + Number(p.net_m2 || 0), 0);
    const monthlyShipRows = shipMonthRes.data || [];
    const monthlyRevenue = monthlyShipRows.reduce(
      (sum: number, s: any) => sum + (Number(s.total_m2 || 0) * Number(s.sale_price_per_m2 || 0)),
      0
    );
    const estimatedUnitCost = monthlyProductionM2 > 0 ? Math.round(monthlyCostsTotal / monthlyProductionM2) : 0;

    return {
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      todayDate,
      totalProductsCount: stocks.length,
      lowStockItems,
      totalStockParkeM2,
      totalStockBordurMetre,
      totalStockAdet,
      todayProductionTotalM2: todayProdM2 + todayProdMetre + todayProdAdet,
      todayProductionParkeM2: todayProdM2,
      todayProductionBordurMetre: todayProdMetre,
      todayProductionAdet: todayProdAdet,
      todayMachine1Output: `${m1Parke} m² (Parke)`,
      todayMachine2Output: `${m2Bordur} m (Bordür)`,
      todayScrapTotalM2: todayScrapM2,
      todayEntriesCount: prodToday.length,
      todayShipmentsCount: shipToday.length,
      todayShipmentParkeM2: todayShipM2,
      todayShipmentBordurMetre: todayShipMetre,
      todayShipmentAdet: todayShipAdet,
      todayShipmentTonnage: Number(todayShipTonnage.toFixed(1)),
      todayRecentShipments: todayRecent,
      pendingOrdersCount: orders.length,
      criticalOrders,
      activeQuotasCount: quotas.length,
      lowQuotaAlerts,
      palletBalances,
      palletDebtors,
      totalUnreturnedPallets,
      totalUnreturnedUretim,
      totalUnreturnedTahta,
      monthlyRevenue,
      monthlyProductionM2,
      monthlyCostsTotal,
      estimatedUnitCost,
    };
  } catch (error) {
    console.error('getLiveFactorySnapshot hatası:', error);
    return {
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      todayDate,
      totalProductsCount: 0,
      lowStockItems: [],
      totalStockParkeM2: 0,
      totalStockBordurMetre: 0,
      totalStockAdet: 0,
      todayProductionTotalM2: 0,
      todayProductionParkeM2: 0,
      todayProductionBordurMetre: 0,
      todayProductionAdet: 0,
      todayMachine1Output: '0 m²',
      todayMachine2Output: '0 m',
      todayScrapTotalM2: 0,
      todayEntriesCount: 0,
      todayShipmentsCount: 0,
      todayShipmentParkeM2: 0,
      todayShipmentBordurMetre: 0,
      todayShipmentAdet: 0,
      todayShipmentTonnage: 0,
      todayRecentShipments: [],
      pendingOrdersCount: 0,
      criticalOrders: [],
      activeQuotasCount: 0,
      lowQuotaAlerts: [],
      palletBalances: [],
      palletDebtors: [],
      totalUnreturnedPallets: 0,
      totalUnreturnedUretim: 0,
      totalUnreturnedTahta: 0,
      monthlyRevenue: 0,
      monthlyProductionM2: 0,
      monthlyCostsTotal: 0,
      estimatedUnitCost: 0,
    };
  }
}

export function extractPalletPricesFromLearnedRules(rules: AILearnedRule[]): { tahtaPrice: number; uretimPrice: number } {
  let tahtaPrice = 300;
  let uretimPrice = 600;

  for (const r of rules) {
    const text = normalizeTurkish(r.rule);
    const mTahta = text.match(/tahta[^\d]*(\d+[\d\.\,]*)\s*(?:tl|lira)/i) || text.match(/(\d+[\d\.\,]*)\s*(?:tl|lira)[^\.\,]*tahta/i);
    if (mTahta) {
      const val = parseFloat(mTahta[1].replace(/\./g, '').replace(',', '.'));
      if (!isNaN(val) && val > 0) tahtaPrice = val;
    }

    const mUretim = text.match(/uretim[^\d]*(\d+[\d\.\,]*)\s*(?:tl|lira)/i) || text.match(/(\d+[\d\.\,]*)\s*(?:tl|lira)[^\.\,]*uretim/i);
    if (mUretim) {
      const val = parseFloat(mUretim[1].replace(/\./g, '').replace(',', '.'));
      if (!isNaN(val) && val > 0) uretimPrice = val;
    }
  }

  return { tahtaPrice, uretimPrice };
}

// ---------------------------------------------------------------------------
// 2. Deterministic / Zero-Config Factory Intelligence Engine (Instant Answer)
// ---------------------------------------------------------------------------
export function runLocalFactoryIntelligence(query: string, data: FactorySnapshot): string {
  const q = (query || '').toLowerCase();
  const qNorm = normalizeTurkish(query);

  // Check learned rules for matches
  const learnedRules = getLearnedRules();
  const { tahtaPrice, uretimPrice } = extractPalletPricesFromLearnedRules(learnedRules);

  let matchingRuleBanner = '';
  const matchedRule = learnedRules.find(r => {
    if (r.originalQuery && qNorm.includes(normalizeTurkish(r.originalQuery))) return true;
    return false;
  });
  if (matchedRule) {
    matchingRuleBanner = `🎓 **Öğrenilmiş Fabrika Kuralı:** *${matchedRule.rule}*\n\n`;
  }

  // 1. Executive Briefing Request
  if (q.includes('özet') || q.includes('rapor') || q.includes('gün sonu') || q.includes('durum nedir')) {
    return generateExecutiveBriefingText(data);
  }

  // 2. Production
  if (q.includes('üretim') || q.includes('imalat') || q.includes('makine') || q.includes('fire') || q.includes('döküm')) {
    let text = `${matchingRuleBanner}🏭 **Bugünkü Üretim Röntgeni (${data.todayDate})**\n\n`;
    text += `* **Toplam Net Üretim:** **${data.todayProductionTotalM2.toLocaleString('tr-TR')} birim**\n`;
    text += `  - 🧱 Parke: **${data.todayProductionParkeM2.toLocaleString('tr-TR')} m²**\n`;
    text += `  - 📏 Bordür: **${data.todayProductionBordurMetre.toLocaleString('tr-TR')} Metre**\n`;
    if (data.todayProductionAdet > 0) text += `  - 🔘 Oluk / Kapak: **${data.todayProductionAdet.toLocaleString('tr-TR')} Adet**\n`;
    text += `\n* **Vardiya Giriş Sayısı:** ${data.todayEntriesCount} kayıt\n`;
    if (data.todayEntriesCount > 0) {
      text += `* **1 Nolu Makine (Parke):** ${data.todayMachine1Output}\n`;
      text += `* **2 Nolu Makine (Bordür):** ${data.todayMachine2Output}\n`;
      text += `* **Fire / Iskarta:** ${data.todayScrapTotalM2} m² (%${data.todayProductionTotalM2 > 0 ? ((data.todayScrapTotalM2 / data.todayProductionTotalM2) * 100).toFixed(1) : 0})\n\n`;
    }
    text += `📈 **Aylık Kümülatif Üretim:** ${data.monthlyProductionM2.toLocaleString('tr-TR')} m²\n`;
    text += `💡 *Tavsiye: 10 saatlik çalışma esasına göre günlük fabrika hedefi 2.000 m²'dir.*`;
    return text;
  }

  // 3. Shipment / Kantar
  if (q.includes('sevk') || q.includes('kantar') || q.includes('kamyon') || q.includes('tonaj') || q.includes('irsaliye') || qNorm.includes('sevk')) {
    // 1. Check if query mentions a specific site (e.g. "HACI KEL", "ALTINOVA", "MUSTAFA KAYA", "MUSTAFA YILMAZ")
    const matchedSite = data.todayRecentShipments.find(s => {
      const sNorm = normalizeTurkish(s.site);
      return sNorm.length >= 3 && qNorm.includes(sNorm);
    });

    // 2. Check if query mentions a specific customer (e.g. "ONİKİŞUBAT", "MEDİKENT")
    const matchedCustomer = data.todayRecentShipments.find(s => {
      const cNorm = normalizeTurkish(s.customer);
      return cNorm.length >= 3 && qNorm.includes(cNorm);
    });

    // Case A: Query is for a specific site (or site + customer)
    if (matchedSite) {
      const sNorm = normalizeTurkish(matchedSite.site);
      const siteShipments = data.todayRecentShipments.filter(s => normalizeTurkish(s.site) === sNorm);
      const custName = matchedSite.customer;
      const siteName = matchedSite.site;

      let totalSiteM2 = 0;
      let totalSiteMetre = 0;
      let totalSiteAdet = 0;
      let totalSiteWeight = 0;

      siteShipments.forEach(s => {
        totalSiteM2 += s.totalM2;
        totalSiteMetre += s.totalMetre;
        totalSiteAdet += s.totalAdet;
        totalSiteWeight += s.netWeight;
      });

      let text = `${matchingRuleBanner}🚚 **${custName.toUpperCase()} - ${siteName.toUpperCase()} ŞANTİYESİ SEVKİYATI**\n\n`;
      text += `Bugün **${siteName}** şantiyesine tamamlanan toplam **${siteShipments.length} sefer/çıkış** yapılmıştır:\n\n`;

      siteShipments.forEach((s, idx) => {
        text += `📄 **${idx + 1}. Sefer [İrsaliye No: ${s.invoice}]**\n`;
        if (s.plate || s.driver) {
          text += `   🚛 Araç: ${s.plate || '-'} ${s.driver ? `| Şoför: ${s.driver}` : ''}\n`;
        }
        if (s.items && s.items.length > 0) {
          s.items.forEach(it => {
            text += `   • **${it.m2} ${it.unit === 'metre' ? 'Metre' : it.unit === 'adet' ? 'Adet' : 'm²'}** ${it.name}\n`;
          });
        } else {
          text += `   • ${s.qty}\n`;
        }
        text += `\n`;
      });

      text += `📊 **${siteName} Şantiyesi Günlük Toplamı:**\n`;
      if (totalSiteM2 > 0) text += `• **Toplam Parke Taşı:** **${totalSiteM2.toLocaleString('tr-TR')} m²**\n`;
      if (totalSiteMetre > 0) text += `• **Toplam Bordür / Hat:** **${totalSiteMetre.toLocaleString('tr-TR')} Metre**\n`;
      if (totalSiteAdet > 0) text += `• **Toplam Adetli Ürün:** **${totalSiteAdet.toLocaleString('tr-TR')} Adet**\n`;
      text += `• **Toplam İrsaliye / Kamyon:** **${siteShipments.length} Sefer**\n`;
      if (totalSiteWeight > 0) {
        text += `• **Net Kantar Tonajı:** **${(totalSiteWeight / 1000).toFixed(1)} Ton**\n`;
      }

      return text;
    }

    // Case B: Query is for a specific customer without a specific site
    if (matchedCustomer) {
      const cNorm = normalizeTurkish(matchedCustomer.customer);
      const custShipments = data.todayRecentShipments.filter(s => normalizeTurkish(s.customer) === cNorm);
      const custName = matchedCustomer.customer;

      let totalCustM2 = 0;
      let totalCustMetre = 0;
      let totalCustAdet = 0;

      const siteGroups: Record<string, typeof custShipments> = {};
      custShipments.forEach(s => {
        totalCustM2 += s.totalM2;
        totalCustMetre += s.totalMetre;
        totalCustAdet += s.totalAdet;
        if (!siteGroups[s.site]) siteGroups[s.site] = [];
        siteGroups[s.site].push(s);
      });

      let text = `${matchingRuleBanner}🚚 **${custName.toUpperCase()} - BUGÜNKÜ SEVKİYAT RAPORU**\n\n`;
      text += `Bugün **${custName}** adına toplam **${custShipments.length} araç/irsaliye** çıkışı yapılmıştır:\n\n`;

      Object.entries(siteGroups).forEach(([sName, sList]) => {
        text += `📍 **${sName} Şantiyesi (${sList.length} Sefer):**\n`;
        sList.forEach(s => {
          text += `• [İrs: ${s.invoice}] ${s.qty}${s.plate ? ` (Plaka: ${s.plate})` : ''}\n`;
        });
        text += `\n`;
      });

      text += `📊 **${custName} Günlük Toplamı:**\n`;
      if (totalCustM2 > 0) text += `• Toplam Parke: **${totalCustM2.toLocaleString('tr-TR')} m²**\n`;
      if (totalCustMetre > 0) text += `• Toplam Bordür: **${totalCustMetre.toLocaleString('tr-TR')} Metre**\n`;
      if (totalCustAdet > 0) text += `• Toplam Adet: **${totalCustAdet.toLocaleString('tr-TR')} Adet**\n`;
      text += `• Toplam Çıkış: **${custShipments.length} Sefer**\n`;

      return text;
    }

    // Case C: General shipment overview (all factory)
    let text = `${matchingRuleBanner}🚚 **Bugünkü Genel Sevkiyat & Kantar Durumu**\n\n`;
    text += `* **Tamamlanan Çıkış:** **${data.todayShipmentsCount} araç/irsaliye**\n`;
    if (data.todayShipmentTonnage > 0) {
      text += `* **Kantar Net Tonajı:** **${data.todayShipmentTonnage.toLocaleString('tr-TR')} Ton**\n`;
    } else {
      const estimatedWeight = Math.round(((data.todayShipmentParkeM2 * 180) + (data.todayShipmentBordurMetre * 90)) / 1000);
      text += `* **Kantar Net Tonajı:** Kantar tartım fişi girilmemiş (Tahmini: **~${estimatedWeight} Ton**)\n`;
    }
    if (data.todayShipmentParkeM2 > 0) text += `* **Parke Çıkışı:** ${data.todayShipmentParkeM2.toLocaleString('tr-TR')} m²\n`;
    if (data.todayShipmentBordurMetre > 0) text += `* **Bordür Çıkışı:** ${data.todayShipmentBordurMetre.toLocaleString('tr-TR')} Metre\n`;
    if (data.todayShipmentAdet > 0) text += `* **Adetli Çıkış:** ${data.todayShipmentAdet.toLocaleString('tr-TR')} Adet\n\n`;

    if (data.todayRecentShipments.length > 0) {
      text += `📋 **Günün Sevkiyat Listesi (${data.todayRecentShipments.length} İrsaliye):**\n`;
      data.todayRecentShipments.forEach(s => {
        text += `• **${s.customer}** (${s.site}) ➔ ${s.qty} [İrs: ${s.invoice}]\n`;
      });
      text += `\n💡 *Örnek: "Hacı Kel şantiyesine ne kadar gitti?" veya "Mustafa Yılmaz'a kaç metre bordür gitti?" şeklinde özel şantiye sorgulayabilirsiniz.*`;
    } else {
      text += `*Bugün henüz tamamlanmış kantar sevkiyatı bulunmuyor.*\n`;
    }
    return text;
  }

  // 4. Critical Stock
  if (q.includes('stok') || q.includes('kritik') || q.includes('azalan') || q.includes('depo')) {
    let text = `${matchingRuleBanner}📦 **Stok Durumu & Kritik Alarm Röntgeni**\n\n`;
    text += `* **Mevcut Parke Stoku:** **${data.totalStockParkeM2.toLocaleString('tr-TR')} m²**\n`;
    text += `* **Mevcut Bordür Stoku:** **${data.totalStockBordurMetre.toLocaleString('tr-TR')} Metre**\n`;
    text += `* **Mevcut Parça Stoku:** **${data.totalStockAdet.toLocaleString('tr-TR')} Adet**\n\n`;

    if (data.lowStockItems.length > 0) {
      text += `🚨 **Emniyet Stoğunun Altındaki Kritik Ürünler (${data.lowStockItems.length} Kalem):**\n`;
      data.lowStockItems.forEach(item => {
        text += `• ⚠️ **${item.name}**: Mevcut **${item.current.toLocaleString('tr-TR')} ${item.unit}** (Kritik Eşik: ${item.min} ${item.unit})\n`;
      });
      text += `\n💡 *Öneri: Bu ürünleri AI Üretim Planlama menüsünden öncelikli iş emri olarak atayınız.*`;
    } else {
      text += `✅ *Tüm ürün stok seviyeleri emniyet eşiğinin üzerinde ve güvendedir.*`;
    }
    return text;
  }

  // 5. Pallets (Smart Customer + Pallet Type Lookup)
  if (q.includes('palet') || q.includes('iade') || q.includes('tahta') || q.includes('ahşap') || qNorm.includes('palet')) {
    // Check if a specific customer is mentioned
    const targetDebtor = data.palletDebtors.find(d => {
      const cNorm = normalizeTurkish(d.customer);
      return cNorm.length >= 3 && qNorm.includes(cNorm);
    }) || data.palletBalances.find(p => {
      const cNorm = normalizeTurkish(p.customer);
      return cNorm.length >= 3 && qNorm.includes(cNorm);
    });

    if (targetDebtor) {
      const custName = targetDebtor.customer;
      const custRecords = data.palletBalances.filter(p => normalizeTurkish(p.customer) === normalizeTurkish(custName));
      
      let totalUretimSent = 0, totalUretimRet = 0, uretimBal = 0;
      let totalTahtaSent = 0, totalTahtaRet = 0, tahtaBal = 0;
      let totalSevkSent = 0, totalSevkRet = 0, sevkiyatBal = 0;

      // Group by site for breakdown
      const siteMap: Record<string, { uretim: number; tahta: number }> = {};

      custRecords.forEach(r => {
        const sName = r.site || 'Merkez / Genel';
        if (!siteMap[sName]) siteMap[sName] = { uretim: 0, tahta: 0 };

        if (r.palletType === 'uretim') {
          totalUretimSent += r.sent;
          totalUretimRet += r.returned;
          uretimBal += r.balance;
          siteMap[sName].uretim += r.balance;
        } else if (r.palletType === 'tahta') {
          totalTahtaSent += r.sent;
          totalTahtaRet += r.returned;
          tahtaBal += r.balance;
          siteMap[sName].tahta += r.balance;
        } else {
          totalSevkSent += r.sent;
          totalSevkRet += r.returned;
          sevkiyatBal += r.balance;
        }
      });

      const totalCustBal = uretimBal + tahtaBal + sevkiyatBal;

      let text = `${matchingRuleBanner}🪵 **${custName.toUpperCase()} - Palet Zimmet & Alacak Durumu**\n\n`;

      const isUretimSpecific = qNorm.includes('uretim');
      const isTahtaSpecific = qNorm.includes('tahta') || qNorm.includes('ahsap');

      if (isUretimSpecific) {
        text += `🎯 **ÜRETİM PALETİ ALACAĞI: ${uretimBal} Adet**\n`;
        text += `• **Toplam Sevk Edilen:** ${totalUretimSent} Adet\n`;
        text += `• **İade Alınan:** ${totalUretimRet} Adet\n`;
        text += `• **Kalan Net Alacak:** **${uretimBal} Adet Üretim Paleti**\n\n`;
        text += `ℹ️ *Ayrıca bu müşteride **${tahtaBal} Adet Tahta Palet** bulunmaktadır (Genel Toplam: **${totalCustBal} Adet**).*\n\n`;
      } else if (isTahtaSpecific) {
        text += `🎯 **TAHTA PALET ALACAĞI: ${tahtaBal} Adet**\n`;
        text += `• **Toplam Sevk Edilen:** ${totalTahtaSent} Adet\n`;
        text += `• **İade Alınan:** ${totalTahtaRet} Adet\n`;
        text += `• **Kalan Net Alacak:** **${tahtaBal} Adet Tahta Palet**\n\n`;
        text += `ℹ️ *Ayrıca bu müşteride **${uretimBal} Adet Üretim Paleti** bulunmaktadır (Genel Toplam: **${totalCustBal} Adet**).*\n\n`;
      } else {
        text += `* 🏭 **Üretim Paleti:** **${uretimBal} Adet** (Sevk: ${totalUretimSent}, İade: ${totalUretimRet})\n`;
        text += `* 🪵 **Tahta Palet:** **${tahtaBal} Adet** (Sevk: ${totalTahtaSent}, İade: ${totalTahtaRet})\n`;
        if (sevkiyatBal > 0) text += `* 📦 **Sevkiyat Paleti:** **${sevkiyatBal} Adet**\n`;
        text += `\n🎯 **Toplam Kalan Palet Alacağı:** **${totalCustBal} Adet**\n\n`;
      }

      // Site Breakdown if multiple sites
      const sitesList = Object.entries(siteMap).filter(([_, s]) => (s.uretim + s.tahta) > 0);
      if (sitesList.length > 1) {
        text += `📍 **Şantiye Bazlı Dağılım:**\n`;
        sitesList.forEach(([sName, s]) => {
          text += `• **${sName}:** ${s.uretim} Üretim Paleti, ${s.tahta} Tahta Palet (Toplam: ${s.uretim + s.tahta} ad)\n`;
        });
        text += `\n`;
      }

      const estValue = (uretimBal * uretimPrice) + (tahtaBal * tahtaPrice);
      text += `💰 **Tahmini Palet Teminatı / Değeri:** **~₺${estValue.toLocaleString('tr-TR')}** *(Üretim: ₺${uretimPrice}, Tahta: ₺${tahtaPrice})*\n`;
      text += `💡 *Tavsiye: Sıradaki sevkiyatta aracın ${custName} şantiyesinden boş paletleri toplaması için kantar fişine not düşünüz.*`;
      return text;
    }

    // General Pallet Summary & Valuation
    const totalUretimVal = data.totalUnreturnedUretim * uretimPrice;
    const totalTahtaVal = data.totalUnreturnedTahta * tahtaPrice;
    const totalPalletVal = totalUretimVal + totalTahtaVal;

    const isValueQuery = qNorm.includes('deger') || qNorm.includes('fiyat') || qNorm.includes('tutar') || qNorm.includes('kac tl') || qNorm.includes('para');

    if (isValueQuery) {
      let text = `${matchingRuleBanner}💰 **Şantiyelerdeki Paletlerin Finansal Değer Raporu**\n\n`;
      text += `• 🏭 **Üretim Paletleri:** **${data.totalUnreturnedUretim.toLocaleString('tr-TR')} Adet** x ₺${uretimPrice.toLocaleString('tr-TR')} = **₺${totalUretimVal.toLocaleString('tr-TR')}**\n`;
      text += `• 🪵 **Tahta Paletler:** **${data.totalUnreturnedTahta.toLocaleString('tr-TR')} Adet** x ₺${tahtaPrice.toLocaleString('tr-TR')} = **₺${totalTahtaVal.toLocaleString('tr-TR')}**\n`;
      text += `════════════════════════════════════════════════\n`;
      text += `💵 **TOPLAM ŞANTİYE PALET REHİN DEĞERİ:** **₺${totalPalletVal.toLocaleString('tr-TR')}**\n\n`;

      text += `📦 **Toplam Bekleyen:** **${data.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet Palet** şantiyelerdedir.\n\n`;

      if (data.palletDebtors.length > 0) {
        text += `⚠️ **Müşteri Bazlı Palet Finansal Riski:**\n`;
        data.palletDebtors.slice(0, 6).forEach((d, idx) => {
          const dVal = (d.uretim * uretimPrice) + (d.tahta * tahtaPrice);
          text += `${idx + 1}. **${d.customer}**: **${d.balance} Adet** (Üretim: ${d.uretim} ad, Tahta: ${d.tahta} ad) ➔ **~₺${dVal.toLocaleString('tr-TR')}**\n`;
        });
      }
      return text;
    }

    let text = `${matchingRuleBanner}🪵 **Palet Takibi & Genel Şantiye Borç Durumu**\n\n`;
    text += `* **Şantiyelerde Bekleyen Toplam Palet:** **${data.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet**\n`;
    text += `  - 🏭 **Üretim Paleti:** **${data.totalUnreturnedUretim.toLocaleString('tr-TR')} Adet** (Değer: ₺${totalUretimVal.toLocaleString('tr-TR')})\n`;
    text += `  - 🪵 **Tahta Palet:** **${data.totalUnreturnedTahta.toLocaleString('tr-TR')} Adet** (Değer: ₺${totalTahtaVal.toLocaleString('tr-TR')})\n`;
    text += `* **Tahmini Rehin / Maliyet Değeri:** **~₺${totalPalletVal.toLocaleString('tr-TR')}** *(Üretim: ₺${uretimPrice}, Tahta: ₺${tahtaPrice})*\n\n`;

    if (data.palletDebtors.length > 0) {
      text += `⚠️ **En Çok Palet Borcu Olan Müşteriler:**\n`;
      data.palletDebtors.slice(0, 6).forEach((d, idx) => {
        text += `${idx + 1}. **${d.customer}**: **${d.balance} Adet** (Üretim: ${d.uretim} ad, Tahta: ${d.tahta} ad)\n`;
      });
      text += `\n💡 *Tavsiye: Yeni sevkiyat yaparken boş palet getirmeyen araçlara palet teslim tutanağı imzalattırınız.*`;
    } else {
      text += `*Aktif palet açığı bulunmuyor.*`;
    }
    return text;
  }

  // 6. Orders & Quotas
  if (q.includes('sipariş') || q.includes('kota') || q.includes('müşteri') || q.includes('bekleyen')) {
    let text = `${matchingRuleBanner}🎯 **Siparişler & Müşteri Kotaları**\n\n`;
    text += `* **Bekleyen Sipariş Sayısı:** **${data.pendingOrdersCount} Adet**\n`;
    text += `* **Aktif Müşteri Kotası:** **${data.activeQuotasCount} Sözleşme**\n\n`;

    if (data.criticalOrders.length > 0) {
      text += `🔥 **Öncelikli / Acil Siparişler:**\n`;
      data.criticalOrders.forEach(o => {
        text += `• **${o.customer}**: ${o.product} (${o.qty}) ${o.dueDate ? `[Termin: ${new Date(o.dueDate).toLocaleDateString('tr-TR')}]` : ''}\n`;
      });
      text += `\n`;
    }

    if (data.lowQuotaAlerts.length > 0) {
      text += `⚠️ **Tükenmek Üzere Olan Müşteri Kotaları (<500 m²):**\n`;
      data.lowQuotaAlerts.forEach(q => {
        text += `• **${q.customer}** (${q.product}): Kalan **${q.remaining} ${q.unit}**\n`;
      });
      text += `\n💡 *Satış ekibinin bu müşterilerle yeni sözleşme görüşmesi yapması önerilir.*`;
    }
    return text;
  }

  // 7. Finance & Costs
  if (q.includes('ciro') || q.includes('maliyet') || q.includes('kar') || q.includes('para') || q.includes('fiyat') || q.includes('gider')) {
    let text = `${matchingRuleBanner}💰 **Aylık Finans & Birim Maliyet Röntgeni**\n\n`;
    text += `* **Bu Ay Toplam Ciro:** **₺${data.monthlyRevenue.toLocaleString('tr-TR')}**\n`;
    text += `* **Bu Ay Toplam Gider:** **₺${data.monthlyCostsTotal.toLocaleString('tr-TR')}**\n`;
    text += `* **Ortalama Birim Maliyet:** **₺${data.estimatedUnitCost}/m²**\n`;
    const grossProfit = data.monthlyRevenue - data.monthlyCostsTotal;
    text += `* **Brüt Karlılık:** **${grossProfit >= 0 ? '+' : ''}₺${grossProfit.toLocaleString('tr-TR')}**\n\n`;
    text += `💡 *Önemli: Minimum satış fiyatınızı birim maliyet (₺${data.estimatedUnitCost}) + %25 kar marjı olarak belirlemeniz önerilir.*`;
    return text;
  }

  // Default Greeting / Help
  return `${matchingRuleBanner}👋 **Merhaba! Ben Parke ERP Yapay Zeka Fabrika Danışmanınızım.**

Fabrikanızın tüm canlı veritabanına bağlıyım. Bana fabrikanızla ilgili her şeyi sorabilirsiniz:

* 📊 *"Bugünkü üretim ve sevkiyat durumu nedir?"*
* 🚨 *"Kritik stokta hangi taşlar var?"*
* ⚖️ *"Kantar ve tonaj çıkışları nasıl?"*
* 🪵 *"Medikent'in ne kadar üretim paleti alacağı var?"*
* 🪵 *"Hangi müşteride kaç paletimiz kaldı?"*
* 🎯 *"Bekleyen acil siparişler neler?"*
* 💰 *"Aylık ciro ve birim maliyetimiz kaç TL?"*
* 📋 *"Bana gün sonu yöneticisi özeti çıkar"*

*💡 Eğer bana yanlış veya eksik bilgi verdiğimi düşünürseniz, cevabın altındaki "🎓 Eğit / Düzelt" butonuna tıklayarak bana doğrusunu öğretebilirsiniz.*`;
}

// ---------------------------------------------------------------------------
// 3. Generate Executive Briefing (Gün Sonu Özeti)
// ---------------------------------------------------------------------------
export function generateExecutiveBriefingText(d: FactorySnapshot): string {
  const { tahtaPrice, uretimPrice } = extractPalletPricesFromLearnedRules(getLearnedRules());
  const dateFormatted = new Date(d.todayDate).toLocaleDateString('tr-TR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const grossProfit = d.monthlyRevenue - d.monthlyCostsTotal;

  return `🏭 GÜN SONU YÖNETİCİ ÖZETİ (EXECUTIVE BRIEFING)
══════════════════════════════════════════════════════
Tarih: ${dateFormatted} | Hazırlayan: Parke AI Direktörü

1. 🧱 ÜRETİM & İMALAT PERFORMANSI
------------------------------------------------------
• Toplam Net Üretim: ${d.todayProductionTotalM2.toLocaleString('tr-TR')} birim
  - Parke Üretimi (1 Nolu Makine): ${d.todayProductionParkeM2.toLocaleString('tr-TR')} m²
  - Bordür Üretimi (2 Nolu Makine): ${d.todayProductionBordurMetre.toLocaleString('tr-TR')} Metre
  - Yağmur Oluğu / Parça: ${d.todayProductionAdet.toLocaleString('tr-TR')} Adet
• Fire & Iskarta: ${d.todayScrapTotalM2} m² (%${d.todayProductionTotalM2 > 0 ? ((d.todayScrapTotalM2 / d.todayProductionTotalM2) * 100).toFixed(1) : 0})
• Aylık Kümülatif Üretim: ${d.monthlyProductionM2.toLocaleString('tr-TR')} m²

2. 🚚 SEVKİYAT & KANTAR RAPORU
------------------------------------------------------
• Tamamlanan İrsaliyeli Çıkış: ${d.todayShipmentsCount} Sefer
• Kantar Net Sevk Tonajı: ${d.todayShipmentTonnage.toLocaleString('tr-TR')} Ton
• Sevk Edilen Parke: ${d.todayShipmentParkeM2.toLocaleString('tr-TR')} m²
• Sevk Edilen Bordür: ${d.todayShipmentBordurMetre.toLocaleString('tr-TR')} Metre

3. 📦 KRİTİK STOK & EMNİYET EŞİĞİ ALARMLARI
------------------------------------------------------
${
  d.lowStockItems.length > 0
    ? d.lowStockItems.map(i => `⚠️ ALARM: ${i.name} -> Kalan: ${i.current} ${i.unit} (Emniyet Stoğu: ${i.min})`).join('\n')
    : '✅ Emniyet stoğu altına inen kritik ürün bulunmamaktadır.'
}

4. 🪵 PALET TAKİBİ & ŞANTİYE RİSKİ
------------------------------------------------------
• Dışarıda Kalan Toplam Palet: ${d.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet
  - Üretim Paleti: ${d.totalUnreturnedUretim.toLocaleString('tr-TR')} Adet
  - Tahta Palet: ${d.totalUnreturnedTahta.toLocaleString('tr-TR')} Adet
• Tahmini Depozito Değeri: ~₺${((d.totalUnreturnedUretim * uretimPrice) + (d.totalUnreturnedTahta * tahtaPrice)).toLocaleString('tr-TR')} (Üretim: ₺${uretimPrice}, Tahta: ₺${tahtaPrice})
• En Çok Palet Borcu Olanlar:
${
  d.palletDebtors.slice(0, 4).map(p => `  - ${p.customer}: ${p.balance} Adet (Üretim: ${p.uretim}, Tahta: ${p.tahta})`).join('\n') || '  - Riskli bakiye yok.'
}

5. 🎯 SİPARİŞ & MÜŞTERİ KOTA ALARMLARI
------------------------------------------------------
• Bekleyen İş Emri Sayısı: ${d.pendingOrdersCount} Adet
${
  d.lowQuotaAlerts.length > 0
    ? d.lowQuotaAlerts.map(q => `  - ${q.customer} (${q.product}): Kalan ${q.remaining} ${q.unit}`).join('\n')
    : '  - Krita seviyede kota tükenmesi bulunmuyor.'
}

6. 💰 AYLIK FİNANSAL GÖRÜNÜM
------------------------------------------------------
• Bu Ay Toplam Ciro: ₺${d.monthlyRevenue.toLocaleString('tr-TR')}
• Bu Ay Toplam Gider: ₺${d.monthlyCostsTotal.toLocaleString('tr-TR')}
• Tahmini Birim Üretim Maliyeti: ₺${d.estimatedUnitCost}/m²
• Brüt Karlılık: ${grossProfit >= 0 ? '+' : ''}₺${grossProfit.toLocaleString('tr-TR')}

══════════════════════════════════════════════════════
Rapor Sonu. İmzalı onay için kopyalayabilir veya yazdırabilirsiniz.`;
}

// ---------------------------------------------------------------------------
// 4. Query External LLM (Google Gemini Flash) with Fallback & Learned Rules
// ---------------------------------------------------------------------------
export async function askFactoryAI({
  query,
  apiKey,
  chatHistory = [],
}: {
  query: string;
  apiKey?: string;
  chatHistory?: { role: 'user' | 'assistant'; text: string }[];
}): Promise<string> {
  const data = await getLiveFactorySnapshot();
  const learnedRulesText = formatRulesForPrompt();

  const geminiKey = apiKey || localStorage.getItem('parke_gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY;

  // If no Gemini key is provided, use deterministic factory intelligence engine
  if (!geminiKey || geminiKey.trim() === '') {
    return runLocalFactoryIntelligence(query, data);
  }

  // System context prompt for Gemini with injected learned rules
  const systemPrompt = `Sen "Parke ERP" beton parke, bordür ve altyapı elemanları fabrikasının kıdemli Yapay Zeka Fabrika Direktörü ve Başdenetçisisin.
Görevin fabrikanın üretim, kantar, sevkiyat, hammadde, palet ve maliyet verilerini analiz etmek, sorulara net, veriye dayalı, nazik ve profesyonel Türkçe yanıtlar vermektir.
Cevaplarında kalın yazılar, emojiler, maddeler ve net sayılar kullan.

AŞAĞIDA FABRİKA YÖNETİCİSİNİN SANA ÖĞRETTİĞİ FABRİKAYA ÖZEL KURALLAR VE DÜZELTMELER BULUNMAKTADIR. BU KURALLARA VE TALİMATLARA KESİNLİKLE VE ÖNCELİKLE UY:
${learnedRulesText || 'Henüz ek kural girilmedi.'}

AŞAĞIDA FABRİKANIN ŞU ANKİ CANLI VERİTABANI RÖNTGENİ YER ALMAKTADIR:
- Tarih: ${data.todayDate}, Saat: ${data.timestamp}
- Bugünkü Üretim: Toplam ${data.todayProductionTotalM2} birim (Parke: ${data.todayProductionParkeM2} m², Bordür: ${data.todayProductionBordurMetre} m, Oluk: ${data.todayProductionAdet} adet). Makine 1: ${data.todayMachine1Output}, Makine 2: ${data.todayMachine2Output}. Fire: ${data.todayScrapTotalM2} m². Toplam ${data.todayEntriesCount} vardiya girişi.
- Bugünkü Sevkiyat & Kantar: Toplam ${data.todayShipmentsCount} kamyon çıkışı, Net Tonaj: ${data.todayShipmentTonnage} Ton, Sevk: ${data.todayShipmentParkeM2} m² parke, ${data.todayShipmentBordurMetre} m bordür.
- BUGÜNKÜ ŞANTİYE BAZLI SEVKİYAT VE İRSALİYE LİSTESİ:
${data.todayRecentShipments.map(s => `  * Müşteri: ${s.customer} | Şantiye: ${s.site} | İrsaliye: ${s.invoice} | Ürünler: ${s.qty} (Plaka: ${s.plate || '-'}, Şoför: ${s.driver || '-'})`).join('\n') || '  * Bugün sevkiyat yok.'}
- SEVKİYAT SORULARI İÇİN TALİMAT: Kullanıcı belirli bir müşteri veya şantiye sevkiyatını sorduğunda (Örn: "Onikişubat Hacı Kel şantiyesine ne kadar gitti?"), kesinlikle tüm fabrikanın sevkiyat özetini sıralama! Yalnızca o şantiyeye/müşteriye ait çıkışları, irsaliye numaralarını ve o şantiyeye giden ürün toplamını net olarak listele.
- Mevcut Depo Stoku: Parke: ${data.totalStockParkeM2} m², Bordür: ${data.totalStockBordurMetre} m, Adet: ${data.totalStockAdet} adet.
- Kritik Stok Emniyet Altında Olan Ürünler: ${data.lowStockItems.map(i => `${i.name}: ${i.current} ${i.unit} (Min: ${i.min})`).join(', ') || 'Yok'}
- Bekleyen Siparişler: ${data.pendingOrdersCount} adet. Acil siparişler: ${data.criticalOrders.map(o => `${o.customer} (${o.product} ${o.qty})`).join(', ') || 'Yok'}.
- Müşteri Kotaları: ${data.activeQuotasCount} aktif sözleşme. Kalan kotası 500 m2 altı: ${data.lowQuotaAlerts.map(q => `${q.customer} (${q.remaining} ${q.unit})`).join(', ') || 'Yok'}.
- Palet Durumu: Şantiyelerde dönmeyen ${data.totalUnreturnedPallets} adet palet (Üretim: ${data.totalUnreturnedUretim} ad, Tahta: ${data.totalUnreturnedTahta} ad).
- MÜŞTERİ PALET BORÇLARI DETAYI: ${data.palletDebtors.map(p => `${p.customer}: Toplam ${p.balance} ad (Üretim Paleti: ${p.uretim} ad, Tahta Palet: ${p.tahta} ad)`).join('; ') || 'Yok'}.
- Finans: Aylık Ciro: ₺${data.monthlyRevenue}, Aylık Gider: ₺${data.monthlyCostsTotal}, Tahmini Birim Maliyet: ₺${data.estimatedUnitCost}/m².

Kullanıcının sorusunu bu canlı verileri ve öğretilmiş kuralları referans alarak eksiksiz, samimi ve net yanıtla.`;

  try {
    const contents = [
      ...chatHistory.slice(-4).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
      { role: 'user', parts: [{ text: query }] }
    ];

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1200,
        }
      })
    });

    if (!response.ok) {
      console.warn('Gemini API HTTP hatası, yerel motora geçiliyor:', response.status);
      return runLocalFactoryIntelligence(query, data);
    }

    const resJson = await response.json();
    const candidateText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) {
      return candidateText;
    }
    return runLocalFactoryIntelligence(query, data);
  } catch (apiErr) {
    console.warn('Gemini API çağrısında hata, yerel motora geçildi:', apiErr);
    return runLocalFactoryIntelligence(query, data);
  }
}
