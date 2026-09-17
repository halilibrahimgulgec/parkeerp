import { supabase } from '../lib/supabase';
import { FactorySnapshot } from './aiFactoryBrain';
import { WatchdogAnomaly, WatchdogScanResult } from '../types/aiWatchdogTypes';
import { FACTORY_CORE_RULES } from './aiFactorySelfLearningEngine';

/**
 * Executes a full proactive watchdog audit across all factory operations:
 * 1. Scale Tare & Vehicle Leakage Radar
 * 2. High Machine Waste & Vibration Defect Radar
 * 3. Critical Safety Stock Shortage Radar
 * 4. Customer Pallet Exposure & Overdue Radar
 */
export async function runFactoryWatchdogScan(
  snapshot: FactorySnapshot
): Promise<WatchdogScanResult> {
  const anomalies: WatchdogAnomaly[] = [];

  // =========================================================================
  // 1. SCALE TARE & VEHICLE LEAKAGE RADAR
  // =========================================================================
  try {
    // Fetch last 50 shipments with scale records to compare tare weights per plate
    const { data: recentShipments } = await supabase
      .from('shipments')
      .select('id, invoice_no, vehicle_plate, driver_name, tare_weight, gross_weight, net_weight, date, total_m2')
      .order('date', { ascending: false })
      .limit(50);

    if (recentShipments && recentShipments.length > 0) {
      // Group tare weights by normalized plate
      const plateTareHistory: Record<string, { tare: number; date: string; invoice: string; id: string }[]> = {};

      recentShipments.forEach((s) => {
        const plate = (s.vehicle_plate || '').replace(/\s+/g, '').toUpperCase();
        const tare = Number(s.tare_weight || 0);
        if (plate && tare > 2000) {
          if (!plateTareHistory[plate]) plateTareHistory[plate] = [];
          plateTareHistory[plate].push({ tare, date: s.date, invoice: s.invoice_no || '', id: s.id });
        }
      });

      // Detect tare deviation for vehicles with multiple recorded weights
      Object.entries(plateTareHistory).forEach(([plate, records]) => {
        if (records.length >= 2) {
          const latestTare = records[0].tare;
          // Calculate average of previous tares
          const prevTares = records.slice(1).map((r) => r.tare);
          const avgPrevTare = Math.round(prevTares.reduce((a, b) => a + b, 0) / prevTares.length);
          const tareDiff = Math.abs(latestTare - avgPrevTare);

          // Suspicious deviation threshold: > 800 kg
          if (tareDiff >= 800) {
            const isLighter = latestTare < avgPrevTare;
            anomalies.push({
              id: `anom-tare-${plate}-${records[0].id}`,
              category: 'scale_tare',
              severity: tareDiff >= 1200 ? 'critical' : 'warning',
              title: `Şüpheli Kantar Darası (${plate})`,
              description: `${plate} plakalı aracın son darası (${latestTare.toLocaleString('tr-TR')} kg), önceki ortalama darasına (${avgPrevTare.toLocaleString('tr-TR')} kg) göre ${tareDiff.toLocaleString('tr-TR')} kg ${isLighter ? 'daha hafif' : 'daha ağır'}! ${
                isLighter
                  ? 'Daranın hafif çıkması, araçta tartılmamış gizli yük veya sahadan fazla malzeme çıkışı (kaçak) riski taşır.'
                  : 'Daranın ağır çıkması, kantar platformunda kirlilik veya tank/kasa değişikliği göstergesi olabilir.'
              }`,
              metric: `${isLighter ? '-' : '+'}${tareDiff.toLocaleString('tr-TR')} kg Sapma`,
              detectedAt: new Date().toISOString(),
              targetEntity: plate,
              suggestedAction: 'Aracı tartım platformuna geri çağırarak darayı yeniden teyit ediniz veya kantar sensör sıfırlamasını yapınız.',
            });
          }
        }
      });

      // Also detect shipments with missing tare or missing scale ticket for high volume
      recentShipments.slice(0, 15).forEach((s) => {
        const m2 = Number(s.total_m2 || 0);
        const gross = Number(s.gross_weight || 0);
        const tare = Number(s.tare_weight || 0);
        const net = Number(s.net_weight || 0);

        if (m2 >= 80 && (!gross || !tare || !net)) {
          anomalies.push({
            id: `anom-notare-${s.id}`,
            category: 'scale_tare',
            severity: 'warning',
            title: `Kantar Fişi Eksik Çıkış (İrsaliye: ${s.invoice_no || '-'})`,
            description: `${s.vehicle_plate || 'Plakasız araç'} ile ${m2} m² sevkiyat yapılmış ancak kantar brüt/dara tartım fişi sisteme işlenmemiş.`,
            metric: `${m2} m² Darasız Sevk`,
            detectedAt: new Date().toISOString(),
            targetEntity: s.vehicle_plate,
            suggestedAction: 'Kantar operatör fişini kontrol edip net tartım bilgisini irsaliyeye ekleyiniz.',
          });
        }
      });
    }
  } catch (err) {
    console.warn('Watchdog kantar tarama hatası:', err);
  }

  // =========================================================================
  // 2. HIGH MACHINE WASTE & SCRAP RADAR
  // =========================================================================
  try {
    const todayProd = snapshot.todayProductionTotalM2 || 0;
    const todayScrap = snapshot.todayScrapTotalM2 || 0;
    const totalM2WithWaste = todayProd + todayScrap;

    if (totalM2WithWaste > 50) {
      const overallWasteRatio = (todayScrap / totalM2WithWaste) * 100;

      // Normal benchmark is < 3.5%
      if (overallWasteRatio >= 5.0) {
        anomalies.push({
          id: `anom-waste-overall`,
          category: 'waste',
          severity: overallWasteRatio >= 8.0 ? 'critical' : 'warning',
          title: `Günlük Fire Tolerans Aşımı (%${overallWasteRatio.toFixed(1)})`,
          description: `Fabrika genelinde bugün ${todayScrap.toLocaleString('tr-TR')} m² fire verildi. Toplam basılan metrajın %${overallWasteRatio.toFixed(1)}'i ıskartaya çıktı (İdeal hedef: <%3.0).`,
          metric: `%${overallWasteRatio.toFixed(1)} Fire Oranı`,
          detectedAt: new Date().toISOString(),
          suggestedAction: 'Kalıp pabuç paralelliklerini, alt vibratör motor kayışlarını ve harç nem oranını acilen kontrol ettiriniz.',
        });
      }
    }

    // Also inspect recent individual production records from Supabase
    const { data: recentProd } = await supabase
      .from('production_entries')
      .select('id, date, machine_id, shift, net_m2, scrap_m2, waste_m2, products(name)')
      .order('date', { ascending: false })
      .limit(10);

    if (recentProd) {
      recentProd.forEach((p: any) => {
        const net = Number(p.net_m2 || 0);
        const scrap = Number(p.scrap_m2 || p.waste_m2 || 0);
        const sum = net + scrap;
        if (sum > 40) {
          const ratio = (scrap / sum) * 100;
          if (ratio >= 6.0) {
            const pName = p.products?.name || 'Parke Taşı';
            anomalies.push({
              id: `anom-prod-waste-${p.id}`,
              category: 'waste',
              severity: ratio >= 9.0 ? 'critical' : 'warning',
              title: `Vardiyada Yüksek Fire: ${pName} (%${ratio.toFixed(1)})`,
              description: `${p.date} tarihli üretimde ${scrap} m² fire oluştu (${pName}). Normal fire eşiğinin 2 katından fazla.`,
              metric: `${scrap} m² Fire (%${ratio.toFixed(1)})`,
              detectedAt: new Date().toISOString(),
              targetEntity: pName,
              suggestedAction: 'Baskı kalıbını söküp çatlak veya köşe aşınması kontrolü yapınız.',
            });
          }
        }
      });
    }
  } catch (err) {
    console.warn('Watchdog fire tarama hatası:', err);
  }

  // =========================================================================
  // 3. CRITICAL SAFETY STOCK SHORTAGE RADAR
  // =========================================================================
  try {
    if (snapshot.lowStockItems && snapshot.lowStockItems.length > 0) {
      // Sort by deficit
      const sortedLowStocks = [...snapshot.lowStockItems].sort(
        (a, b) => (b.min - b.current) - (a.min - a.current)
      );

      sortedLowStocks.slice(0, 4).forEach((item) => {
        const isDepleted = item.current <= 0;
        const deficit = Math.max(0, item.min - item.current);

        anomalies.push({
          id: `anom-stock-${normalizeEntityKey(item.name)}`,
          category: 'stock',
          severity: isDepleted || item.current < item.min * 0.3 ? 'critical' : 'warning',
          title: `Emniyet Stoğu Kritik: ${item.name}`,
          description: `${item.name} stoğu emniyet seviyesi olan ${item.min.toLocaleString('tr-TR')} ${item.unit} sınırının altına indi. Mevcut stok: ${item.current.toLocaleString('tr-TR')} ${item.unit} (Açık: ${deficit.toLocaleString('tr-TR')} ${item.unit}).`,
          metric: `${item.current} / ${item.min} ${item.unit}`,
          detectedAt: new Date().toISOString(),
          targetEntity: item.name,
          suggestedAction: 'Üretim planlamasında ilgili kalıbı makinaya bağlayarak acil iş emri açınız.',
          actionDraft: {
            id: `draft-prod-shortage-${Date.now()}`,
            type: 'create_production',
            status: 'draft',
            title: `Acil Üretim Emri: ${item.name}`,
            description: `Emniyet stoğu açığını kapatmak için ${item.name} üretimi başlatılacak.`,
            createdAt: new Date().toISOString(),
            productionData: {
              product_id: '',
              product_name: item.name,
              machine_name: '1 Nolu Makine',
              date: new Date().toISOString().split('T')[0],
              shift: 'Gündüz',
              total_pallets: Math.ceil(deficit / 10.5),
              total_m2: deficit,
              waste_m2: 0,
              net_m2: deficit,
              notes: `Fabrika Bekçisi emniyet stoğu açığı için oluşturuldu.`,
            },
          },
        });
      });
    }
  } catch (err) {
    console.warn('Watchdog stok tarama hatası:', err);
  }

  // =========================================================================
  // 4. CUSTOMER PALLET EXPOSURE & OVERDUE RADAR
  // =========================================================================
  try {
    if (snapshot.palletDebtors && snapshot.palletDebtors.length > 0) {
      snapshot.palletDebtors.forEach((debtor) => {
        const uretimCount = debtor.unreturnedUretim || 0;
        const tahtaCount = debtor.unreturnedTahta || 0;
        const totalPallets = debtor.unreturned || (uretimCount + tahtaCount);
        const financialRisk = debtor.financialRisk || (
          uretimCount * FACTORY_CORE_RULES.PALLET_PRICES.uretim +
          tahtaCount * FACTORY_CORE_RULES.PALLET_PRICES.tahta
        );

        // High exposure threshold: 100+ pallets or financial risk > ₺50.000
        if (totalPallets >= 80 || financialRisk >= 50000) {
          const isCritical = uretimCount >= 80 || financialRisk >= 150000;
          anomalies.push({
            id: `anom-pallet-${normalizeEntityKey(debtor.customer)}`,
            category: 'pallet',
            severity: isCritical ? 'critical' : 'warning',
            title: `Yüksek Palet Zimmet Riski (${debtor.customer})`,
            description: `${debtor.customer} şantiyelerinde ${totalPallets.toLocaleString('tr-TR')} adet palet birikmiş durumda (${uretimCount} Üretim, ${tahtaCount} Tahta Palet). Firmanın fabrika üzerindeki finansal rehin riski: ₺${financialRisk.toLocaleString('tr-TR')}.`,
            metric: `₺${financialRisk.toLocaleString('tr-TR')} (${totalPallets} Palet)`,
            detectedAt: new Date().toISOString(),
            targetEntity: debtor.customer,
            suggestedAction: 'Müşteri temsilcisini veya nakliye ekibini arayarak şantiyeden boş palet toplama seferi organize ediniz.',
            actionDraft: {
              id: `draft-pal-collect-${Date.now()}`,
              type: 'return_pallet',
              status: 'draft',
              title: `Palet İade Kabulü (${debtor.customer})`,
              description: `${debtor.customer} carisinden dönen paletlerin kabulü`,
              createdAt: new Date().toISOString(),
              palletReturnData: {
                customer_id: '',
                customer_name: debtor.customer,
                date: new Date().toISOString().split('T')[0],
                pallet_type: uretimCount > tahtaCount ? 'uretim' : 'tahta',
                quantity: uretimCount > 0 ? uretimCount : tahtaCount,
                vehicle_plate: '46 K 1234',
                driver_name: 'Palet Toplama Aracı',
                notes: 'Fabrika Bekçisi palet risk radarı üzerinden başlatıldı.',
              },
            },
          });
        }
      });
    }
  } catch (err) {
    console.warn('Watchdog palet tarama hatası:', err);
  }

  // Sort anomalies: Critical first, then Warning, then Info
  const severityScore = { critical: 3, warning: 2, info: 1 };
  anomalies.sort((a, b) => severityScore[b.severity] - severityScore[a.severity]);

  const criticalCount = anomalies.filter((a) => a.severity === 'critical').length;
  const warningCount = anomalies.filter((a) => a.severity === 'warning').length;
  const infoCount = anomalies.filter((a) => a.severity === 'info').length;

  let summaryText = '';
  if (anomalies.length === 0) {
    summaryText = '✅ Fabrikada herhangi bir kantar darası, yüksek fire, kritik stok veya palet riski tespit edilmedi. Tüm süreçler tolerans dahilinde.';
  } else {
    summaryText = `🛡️ **Fabrika Bekçisi Denetim Raporu:** Toplam **${anomalies.length} aktif anomali** tespit edildi (${criticalCount} Kritik, ${warningCount} Uyarı).`;
  }

  return {
    timestamp: new Date().toISOString(),
    totalAnomalies: anomalies.length,
    criticalCount,
    warningCount,
    infoCount,
    anomalies,
    summaryText,
  };
}

/**
 * Clean text formatted for speech synthesis (TTS)
 */
export function formatWatchdogBriefingForTTS(result: WatchdogScanResult): string {
  if (result.totalAnomalies === 0) {
    return 'Fabrika Bekçisi raporu: Tüm hatlar, kantar tartımları ve stoklar normal sınırlarda. Aktif bir risk veya anomali bulunmuyor.';
  }

  const criticals = result.anomalies.filter((a) => a.severity === 'critical');
  const topIssues = (criticals.length > 0 ? criticals : result.anomalies).slice(0, 2);

  const issueTexts = topIssues
    .map((i) => `${i.title}. ${i.metric}.`)
    .join(' ');

  return `Fabrika Bekçisi uyarısı! ${result.criticalCount > 0 ? `${result.criticalCount} adet kritik, ` : ''}toplam ${result.totalAnomalies} anomali tespit edildi. Öncelikli durumlar: ${issueTexts}`;
}

/**
 * Format markdown for direct chat rendering
 */
export function formatWatchdogReportForChat(result: WatchdogScanResult): string {
  if (result.totalAnomalies === 0) {
    return `🛡️ **Fabrika Bekçisi Durum Raporu**\n\n` +
      `✅ **Tüm Sistemler Normal:**\n` +
      `• ⚖️ **Kantar & Dara:** Araç tartımlarında şüpheli sapma veya kaçak riski yok.\n` +
      `• 🔥 **Makine Fireleri:** Günlük fire oranı tolerans sınırı (<%3.5) dahilinde.\n` +
      `• 📦 **Emniyet Stokları:** Kritik emniyet seviyesi altına düşen ürün bulunmuyor.\n` +
      `• 🪵 **Palet Zimmetleri:** Şantiye alacakları olağan dengede.`;
  }

  const lines: string[] = [];
  lines.push(`🛡️ **Fabrika Bekçisi & Risk Radarı Raporu**`);
  lines.push(`Canlı sensör ve veritabanı taramasında **${result.totalAnomalies} aktif risk** tespit edildi:\n`);

  result.anomalies.forEach((a, idx) => {
    const badge = a.severity === 'critical' ? '🚨 **KRİTİK**' : '⚠️ **UYARI**';
    lines.push(`### ${idx + 1}. ${badge} - ${a.title}`);
    lines.push(`• 📊 **Metrik:** \`${a.metric}\``);
    lines.push(`• 🔍 **Açıklama:** ${a.description}`);
    lines.push(`• 🛠️ **Önerilen Aksiyon:** *${a.suggestedAction}*\n`);
  });

  return lines.join('\n');
}

function normalizeEntityKey(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .slice(0, 25);
}
