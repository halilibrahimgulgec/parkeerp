import { supabase } from '../lib/supabase';

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
  todayRecentShipments: { customer: string; site: string; qty: string; invoice: string }[];
  // Orders & Quotas
  pendingOrdersCount: number;
  criticalOrders: { orderNo: string; customer: string; product: string; qty: string; dueDate?: string }[];
  activeQuotasCount: number;
  lowQuotaAlerts: { customer: string; product: string; remaining: number; unit: string }[];
  // Pallets
  palletDebtors: { customer: string; balance: number }[];
  totalUnreturnedPallets: number;
  // Financial
  monthlyRevenue: number;
  monthlyProductionM2: number;
  monthlyCostsTotal: number;
  estimatedUnitCost: number;
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
      supabase.from('pallet_tracking').select('*, customers(name)'),
      supabase.from('cost_entries').select('cost_type, total_amount').eq('period_month', currentMonth).eq('period_year', currentYear),
      supabase.from('production_entries').select('net_m2').gte('date', startOfMonth),
      supabase.from('shipments').select('total_m2, sale_price_per_m2').gte('shipment_date', startOfMonth).eq('status', 'completed'),
    ]);

    const stocks = stockRes.data || [];
    const prodToday = prodTodayRes.data || [];
    const shipToday = shipTodayRes.data || [];
    const orders = ordersRes.data || [];
    const quotas = quotasRes.data || [];
    const pallets = palletRes.data || [];
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
    let todayScrap = 0;
    let m1M2 = 0;
    let m2M2 = 0;

    prodToday.forEach((p: any) => {
      const u = p.products?.unit || 'm2';
      const net = Number(p.net_m2 || 0);
      todayScrap += Number(p.scrap_m2 || 0);
      if (u === 'metre') todayProdMetre += net;
      else if (u === 'adet') todayProdAdet += net;
      else todayProdM2 += net;

      if (p.machine_no === '1') m1M2 += net;
      else m2M2 += net;
    });

    // Today Shipments
    let todayShipM2 = 0;
    let todayShipMetre = 0;
    let todayShipAdet = 0;
    let todayShipTonnage = 0;
    const todayRecent: FactorySnapshot['todayRecentShipments'] = [];

    shipToday.forEach((s: any) => {
      todayShipTonnage += (Number(s.net_weight || 0)) / 1000;
      const items = s.shipment_items || [];
      let shipmentDesc = '';
      if (items.length > 0) {
        items.forEach((it: any) => {
          const u = it.products?.unit || it.unit || 'm2';
          const q = Number(it.m2 || 0);
          if (u === 'metre') todayShipMetre += q;
          else if (u === 'adet') todayShipAdet += q;
          else todayShipM2 += q;
        });
        shipmentDesc = items.map((it: any) => `${it.m2} ${it.products?.unit || 'm²'} ${it.products?.name || ''}`).join(', ');
      } else {
        todayShipM2 += Number(s.total_m2 || 0);
        shipmentDesc = `${s.total_m2} m²`;
      }

      todayRecent.push({
        customer: s.customers?.name || 'Belirtilmemiş Müşteri',
        site: s.sites?.name || 'Ana Şantiye',
        qty: shipmentDesc,
        invoice: s.invoice_no || '-',
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

    // Pallets
    const customerPalletMap: Record<string, number> = {};
    let totalUnreturnedPallets = 0;
    pallets.forEach((p: any) => {
      const cName = p.customers?.name || 'Müşteri';
      const balance = (Number(p.given_pallets) || 0) - (Number(p.returned_pallets) || 0);
      if (balance > 0) {
        customerPalletMap[cName] = (customerPalletMap[cName] || 0) + balance;
        totalUnreturnedPallets += balance;
      }
    });

    const palletDebtors = Object.entries(customerPalletMap)
      .map(([customer, balance]) => ({ customer, balance }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);

    // Financial
    const monthlyCostsTotal = costs.reduce((s: number, c: any) => s + (Number(c.total_amount) || 0), 0);
    const monthlyProdRows = prodMonthRes.data || [];
    const monthlyProductionM2 = monthlyProdRows.reduce((s: number, r: any) => s + (Number(r.net_m2) || 0), 0);
    const estimatedUnitCost = monthlyProductionM2 > 0 ? monthlyCostsTotal / monthlyProductionM2 : 0;
    const monthlyRevenue = (shipMonthRes.data || []).reduce((s: number, r: any) => s + (Number(r.total_m2 || 0) * Number(r.sale_price_per_m2 || 0)), 0);

    return {
      timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      todayDate,
      totalProductsCount: stocks.length,
      lowStockItems,
      totalStockParkeM2: Math.round(totalStockParkeM2),
      totalStockBordurMetre: Math.round(totalStockBordurMetre),
      totalStockAdet: Math.round(totalStockAdet),
      todayProductionTotalM2: Math.round(todayProdM2 + todayProdMetre),
      todayProductionParkeM2: Math.round(todayProdM2),
      todayProductionBordurMetre: Math.round(todayProdMetre),
      todayProductionAdet: Math.round(todayProdAdet),
      todayMachine1Output: `${Math.round(m1M2)} m²`,
      todayMachine2Output: `${Math.round(m2M2)} m²/m`,
      todayScrapTotalM2: Math.round(todayScrap),
      todayEntriesCount: prodToday.length,
      todayShipmentsCount: shipToday.length,
      todayShipmentParkeM2: Math.round(todayShipM2),
      todayShipmentBordurMetre: Math.round(todayShipMetre),
      todayShipmentAdet: Math.round(todayShipAdet),
      todayShipmentTonnage: parseFloat(todayShipTonnage.toFixed(1)),
      todayRecentShipments: todayRecent,
      pendingOrdersCount: orders.length,
      criticalOrders,
      activeQuotasCount: quotas.length,
      lowQuotaAlerts,
      palletDebtors,
      totalUnreturnedPallets,
      monthlyRevenue: Math.round(monthlyRevenue),
      monthlyProductionM2: Math.round(monthlyProductionM2),
      monthlyCostsTotal: Math.round(monthlyCostsTotal),
      estimatedUnitCost: parseFloat(estimatedUnitCost.toFixed(2)),
    };
  } catch (err) {
    console.error('Snapshot alınırken hata:', err);
    return {
      timestamp: new Date().toLocaleTimeString('tr-TR'),
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
      todayMachine2Output: '0 m²',
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
      palletDebtors: [],
      totalUnreturnedPallets: 0,
      monthlyRevenue: 0,
      monthlyProductionM2: 0,
      monthlyCostsTotal: 0,
      estimatedUnitCost: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Built-in Smart Factory Intelligence Engine (Zero-Config Fallback)
// ---------------------------------------------------------------------------
export function runLocalFactoryIntelligence(query: string, data: FactorySnapshot): string {
  const q = query.toLowerCase().trim();

  // 1. Executive Summary / Gün Sonu Özeti
  if (q.includes('gün sonu') || q.includes('özet') || q.includes('röntgen') || q.includes('brifing') || q.includes('durum raporu')) {
    return generateExecutiveBriefingText(data);
  }

  // 2. Production
  if (q.includes('üretim') || q.includes('pres') || q.includes('makine') || q.includes('baskı') || q.includes('kaç m2 basıldı')) {
    let text = `🏭 **Bugünkü Üretim Raporu (${data.todayDate})**\n\n`;
    if (data.todayEntriesCount === 0) {
      text += `Bugün sisteme henüz tamamlanmış bir üretim vardiyası girişi yapılmamış.\n\n`;
    } else {
      text += `* **Toplam Net Üretim:** **${data.todayProductionTotalM2.toLocaleString('tr-TR')}** birim (${data.todayEntriesCount} vardiya)\n`;
      if (data.todayProductionParkeM2 > 0) text += `  • 🧱 Parke Taşları: **${data.todayProductionParkeM2.toLocaleString('tr-TR')} m²**\n`;
      if (data.todayProductionBordurMetre > 0) text += `  • 📏 Bordür Taşları: **${data.todayProductionBordurMetre.toLocaleString('tr-TR')} metre**\n`;
      if (data.todayProductionAdet > 0) text += `  • 📦 Parça/Oluk: **${data.todayProductionAdet.toLocaleString('tr-TR')} adet**\n`;
      text += `* **1 Nolu Makine (Parke):** ${data.todayMachine1Output}\n`;
      text += `* **2 Nolu Makine (Bordür):** ${data.todayMachine2Output}\n`;
      text += `* **Fire / Iskarta:** ${data.todayScrapTotalM2} m² (%${data.todayProductionTotalM2 > 0 ? ((data.todayScrapTotalM2 / data.todayProductionTotalM2) * 100).toFixed(1) : 0})\n\n`;
    }
    text += `📈 **Aylık Kümülatif Üretim:** ${data.monthlyProductionM2.toLocaleString('tr-TR')} m²\n`;
    text += `💡 *Tavsiye: 10 saatlik çalışma esasına göre günlük fabrika hedefi 2.000 m²'dir.*`;
    return text;
  }

  // 3. Shipment / Kantar
  if (q.includes('sevk') || q.includes('kantar') || q.includes('kamyon') || q.includes('tonaj') || q.includes('irsaliye')) {
    let text = `🚚 **Bugünkü Sevkiyat & Kantar Durumu**\n\n`;
    text += `* **Tamamlanan Çıkış:** **${data.todayShipmentsCount} araç/irsaliye**\n`;
    text += `* **Kantar Net Tonajı:** **${data.todayShipmentTonnage.toLocaleString('tr-TR')} Ton**\n`;
    if (data.todayShipmentParkeM2 > 0) text += `* **Parke Çıkışı:** ${data.todayShipmentParkeM2.toLocaleString('tr-TR')} m²\n`;
    if (data.todayShipmentBordurMetre > 0) text += `* **Bordür Çıkışı:** ${data.todayShipmentBordurMetre.toLocaleString('tr-TR')} Metre\n`;
    if (data.todayShipmentAdet > 0) text += `* **Adetli Çıkış:** ${data.todayShipmentAdet.toLocaleString('tr-TR')} Adet\n\n`;

    if (data.todayRecentShipments.length > 0) {
      text += `📋 **Son Sevkiyatlar:**\n`;
      data.todayRecentShipments.forEach(s => {
        text += `• **${s.customer}** (${s.site}) ➔ ${s.qty} [İrs: ${s.invoice}]\n`;
      });
    } else {
      text += `*Bugün henüz tamamlanmış kantar sevkiyatı bulunmuyor.*\n`;
    }
    return text;
  }

  // 4. Critical Stock
  if (q.includes('stok') || q.includes('kritik') || q.includes('azalan') || q.includes('depo')) {
    let text = `📦 **Stok Durumu & Kritik Alarm Röntgeni**\n\n`;
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

  // 5. Pallets
  if (q.includes('palet') || q.includes('iade') || q.includes('tahta') || q.includes('ahşap')) {
    let text = `🪵 **Palet Takibi & Şantiye Borç Durumu**\n\n`;
    text += `* **Şantiyelerde Bekleyen Toplam Palet:** **${data.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet**\n`;
    const val = data.totalUnreturnedPallets * 300; // ~300 TL per pallet
    text += `* **Tahmini Rehin / Maliyet Değeri:** **₺${val.toLocaleString('tr-TR')}**\n\n`;

    if (data.palletDebtors.length > 0) {
      text += `⚠️ **En Çok Palet Borcu Olan İlk 5 Müşteri:**\n`;
      data.palletDebtors.forEach((d, idx) => {
        text += `${idx + 1}. **${d.customer}**: **${d.balance} Adet Palet**\n`;
      });
      text += `\n💡 *Tavsiye: Yeni sevkiyat yaparken boş palet getirmeyen araçlara palet teslim tutanağı imzalattırınız.*`;
    } else {
      text += `*Aktif palet açığı bulunmuyor.*`;
    }
    return text;
  }

  // 6. Orders & Quotas
  if (q.includes('sipariş') || q.includes('kota') || q.includes('müşteri') || q.includes('bekleyen')) {
    let text = `🎯 **Siparişler & Müşteri Kotaları**\n\n`;
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
    let text = `💰 **Aylık Finans & Birim Maliyet Röntgeni**\n\n`;
    text += `* **Bu Ay Toplam Ciro:** **₺${data.monthlyRevenue.toLocaleString('tr-TR')}**\n`;
    text += `* **Bu Ay Toplam Gider:** **₺${data.monthlyCostsTotal.toLocaleString('tr-TR')}**\n`;
    text += `* **Ortalama Birim Maliyet:** **₺${data.estimatedUnitCost}/m²**\n`;
    const grossProfit = data.monthlyRevenue - data.monthlyCostsTotal;
    text += `* **Brüt Karlılık:** **${grossProfit >= 0 ? '+' : ''}₺${grossProfit.toLocaleString('tr-TR')}**\n\n`;
    text += `💡 *Önemli: Minimum satış fiyatınızı birim maliyet (₺${data.estimatedUnitCost}) + %25 kar marjı olarak belirlemeniz önerilir.*`;
    return text;
  }

  // Default Greeting / Help
  return `👋 **Merhaba! Ben Parke ERP Yapay Zeka Fabrika Danışmanınızım.**

Fabrikanızın tüm canlı veritabanına bağlıyım. Bana fabrikanızla ilgili her şeyi sorabilirsiniz:

* 📊 *"Bugünkü üretim ve sevkiyat durumu nedir?"*
* 🚨 *"Kritik stokta hangi taşlar var?"*
* ⚖️ *"Kantar ve tonaj çıkışları nasıl?"*
* 🪵 *"Hangi müşteride kaç paletimiz kaldı?"*
* 🎯 *"Bekleyen acil siparişler neler?"*
* 💰 *"Aylık ciro ve birim maliyetimiz kaç TL?"*
* 📋 *"Bana gün sonu yöneticisi özeti çıkar"*`;
}

// ---------------------------------------------------------------------------
// 3. Generate Executive Briefing (Gün Sonu Özeti)
// ---------------------------------------------------------------------------
export function generateExecutiveBriefingText(d: FactorySnapshot): string {
  const dateFormatted = new Date(d.todayDate).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  let report = `📋 **YÖNETİCİ GÜN SONU RÖNTGEN ÖZETİ**\n📅 *${dateFormatted} | Saat: ${d.timestamp}*\n\n`;

  // Üretim
  report += `### 1. 🏭 Üretim Performansı\n`;
  if (d.todayEntriesCount === 0) {
    report += `• Bugün sisteme henüz üretim vardiya kaydı girilmedi.\n`;
  } else {
    report += `• Toplam Üretim: **${d.todayProductionTotalM2.toLocaleString('tr-TR')}** birim (${d.todayProductionParkeM2} m² Parke, ${d.todayProductionBordurMetre} m Bordür, ${d.todayProductionAdet} ad. Oluk)\n`;
    report += `• Makine 1 Çıkışı: **${d.todayMachine1Output}** | Makine 2 Çıkışı: **${d.todayMachine2Output}**\n`;
    report += `• Günlük Fire Oranı: **${d.todayScrapTotalM2} m²** (%${d.todayProductionTotalM2 > 0 ? ((d.todayScrapTotalM2 / d.todayProductionTotalM2) * 100).toFixed(1) : 0})\n`;
  }
  report += `\n`;

  // Sevkiyat & Kantar
  report += `### 2. 🚚 Sevkiyat & Kantar Çıkışları\n`;
  report += `• Sevk Edilen Araç: **${d.todayShipmentsCount} Kamyon/İrsaliye**\n`;
  report += `• Net Kantar Tonajı: **${d.todayShipmentTonnage.toLocaleString('tr-TR')} Ton**\n`;
  report += `• Sevk Miktarı: **${d.todayShipmentParkeM2} m² Parke** + **${d.todayShipmentBordurMetre} m Bordür**\n`;
  report += `\n`;

  // Stok & Riskler
  report += `### 3. 🚨 Kritik Stok & Risk Radarı\n`;
  if (d.lowStockItems.length > 0) {
    report += `• **${d.lowStockItems.length} ürün emniyet stokunun altına indi:** ` +
      d.lowStockItems.map(it => `${it.name} (${it.current} ${it.unit})`).join(', ') + `\n`;
  } else {
    report += `• Tüm kritik ürünlerin stok seviyeleri emniyet eşiğinin üzerindedir.\n`;
  }
  report += `• Şantiyelerdeki Toplam Palet: **${d.totalUnreturnedPallets} adet** (Değeri: ₺${(d.totalUnreturnedPallets * 300).toLocaleString('tr-TR')})\n`;
  report += `\n`;

  // Yarın İçin Tavsiyeler
  report += `### 4. 💡 Yarınki Vardiya İçin AI Tavsiyeleri\n`;
  if (d.lowStockItems.length > 0) {
    report += `1. **Öncelikli Kalıp:** 1 Nolu makinede stok açığı veren **${d.lowStockItems[0]?.name}** kalıbı takılmalıdır.\n`;
  } else {
    report += `1. **Planlı Üretim:** Mevcut üretim planına göre devam edilebilir.\n`;
  }
  if (d.palletDebtors.length > 0) {
    report += `2. **Palet Toplama:** **${d.palletDebtors[0]?.customer}** şantiyesine gidecek araçların dönüşte boş palet alması talimatlandırılmalıdır.\n`;
  }
  report += `3. **Sevkiyat Hazırlığı:** Bekleyen ${d.pendingOrdersCount} sipariş için sevkiyat sahası palet düzeni kontrol edilmelidir.`;

  return report;
}

// ---------------------------------------------------------------------------
// 4. Query External LLM (Google Gemini Flash) with Fallback
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

  const geminiKey = apiKey || localStorage.getItem('parke_erp_gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY;

  // If no Gemini key is provided, use deterministic factory intelligence engine
  if (!geminiKey || geminiKey.trim() === '') {
    return runLocalFactoryIntelligence(query, data);
  }

  // System context prompt for Gemini
  const systemPrompt = `Sen "Parke ERP" beton parke, bordür ve altyapı elemanları fabrikasının kıdemli Yapay Zeka Fabrika Direktörü ve Başdenetçisisin.
Görevin fabrikanın üretim, kantar, sevkiyat, hammadde, palet ve maliyet verilerini analiz etmek, sorulara net, veriye dayalı, nazik ve profesyonel Türkçe yanıtlar vermektir.
Cevaplarında kalın yazılar, emojiler, maddeler ve net sayılar kullan.

AŞAĞIDA FABRİKANIN ŞU ANKİ CANLI VERİTABANI RÖNTGENİ YER ALMAKTADIR:
- Tarih: ${data.todayDate}, Saat: ${data.timestamp}
- Bugünkü Üretim: Toplam ${data.todayProductionTotalM2} birim (Parke: ${data.todayProductionParkeM2} m², Bordür: ${data.todayProductionBordurMetre} m, Oluk: ${data.todayProductionAdet} adet). Makine 1: ${data.todayMachine1Output}, Makine 2: ${data.todayMachine2Output}. Fire: ${data.todayScrapTotalM2} m². Toplam ${data.todayEntriesCount} vardiya girişi.
- Bugünkü Sevkiyat & Kantar: Toplam ${data.todayShipmentsCount} kamyon çıkışı, Net Tonaj: ${data.todayShipmentTonnage} Ton, Sevk: ${data.todayShipmentParkeM2} m² parke, ${data.todayShipmentBordurMetre} m bordür.
- Mevcut Depo Stoku: Parke: ${data.totalStockParkeM2} m², Bordür: ${data.totalStockBordurMetre} m, Adet: ${data.totalStockAdet} adet.
- Kritik Stok Emniyet Altında Olan Ürünler: ${data.lowStockItems.map(i => `${i.name}: ${i.current} ${i.unit} (Min: ${i.min})`).join(', ') || 'Yok'}
- Bekleyen Siparişler: ${data.pendingOrdersCount} adet. Acil siparişler: ${data.criticalOrders.map(o => `${o.customer} (${o.product} ${o.qty})`).join(', ') || 'Yok'}.
- Müşteri Kotaları: ${data.activeQuotasCount} aktif sözleşme. Kalan kotası 500 m2 altı: ${data.lowQuotaAlerts.map(q => `${q.customer} (${q.remaining} ${q.unit})`).join(', ') || 'Yok'}.
- Palet Durumu: Şantiyelerde dönmeyen ${data.totalUnreturnedPallets} adet palet (Değeri: ₺${data.totalUnreturnedPallets * 300}). En çok borçlu: ${data.palletDebtors.map(p => `${p.customer}: ${p.balance} ad`).join(', ') || 'Yok'}.
- Finans: Aylık Ciro: ₺${data.monthlyRevenue}, Aylık Gider: ₺${data.monthlyCostsTotal}, Tahmini Birim Maliyet: ₺${data.estimatedUnitCost}/m².

Kullanıcının sorusunu bu canlı verileri referans alarak eksiksiz yanıtla.`;

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
          temperature: 0.3,
          maxOutputTokens: 1000,
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
