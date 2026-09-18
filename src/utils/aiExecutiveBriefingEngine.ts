import { FactorySnapshot } from './aiFactoryBrain';
import { WatchdogScanResult } from '../types/aiWatchdogTypes';
import { FACTORY_CORE_RULES } from './aiFactorySelfLearningEngine';

export interface ExecutiveMessagingConfig {
  whatsappPhone?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

/**
 * Formats a clean, high-impact executive summary optimized for WhatsApp & Telegram
 */
export function formatExecutiveReportForMessaging(
  snapshot: FactorySnapshot,
  watchdog?: WatchdogScanResult | null
): string {
  const lines: string[] = [];

  lines.push(`🏭 *PARKE ERP - GÜN SONU YÖNETİCİ BRİFİNGİ*`);
  lines.push(`📅 *Tarih:* ${snapshot.todayDate}`);
  lines.push(`⏰ *Rapor Saati:* ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}\n`);

  // 1. ÜRETİM & FİRE
  const totalProd = snapshot.todayProductionTotalM2 || 0;
  const scrapM2 = snapshot.todayScrapTotalM2 || 0;
  const totalWithScrap = totalProd + scrapM2;
  const wastePct = totalWithScrap > 0 ? ((scrapM2 / totalWithScrap) * 100).toFixed(1) : '0.0';
  const targetM2 = FACTORY_CORE_RULES.DAILY_PRODUCTION_TARGET_M2;
  const targetPct = targetM2 > 0 ? ((totalProd / targetM2) * 100).toFixed(0) : '0';

  lines.push(`📊 *1. ÜRETİM & VARDİYA PERFORMANSI*`);
  lines.push(`• Net Üretim: *${totalProd.toLocaleString('tr-TR')} m²* (Hedef: ${targetM2.toLocaleString('tr-TR')} m² - %${targetPct})`);
  if (snapshot.todayProductionParkeM2 > 0) {
    lines.push(`• Parke Taşı: *${snapshot.todayProductionParkeM2.toLocaleString('tr-TR')} m²*`);
  }
  if (snapshot.todayProductionBordurMetre > 0) {
    lines.push(`• Bordür: *${snapshot.todayProductionBordurMetre.toLocaleString('tr-TR')} Metre*`);
  }
  lines.push(`• Fire / Iskarta: *${scrapM2.toLocaleString('tr-TR')} m²* (Fire Oranı: *%${wastePct}*)`);
  lines.push(`• Makine 1: ${snapshot.todayMachine1Output || 'Aktif'}`);
  lines.push(`• Makine 2: ${snapshot.todayMachine2Output || 'Aktif'}\n`);

  // 2. KANTAR & SEVKİYAT
  lines.push(`🚚 *2. KANTAR & SEVKİYAT DURUMU*`);
  lines.push(`• Toplam Sevk: *${snapshot.todayShipmentsCount} Araç / İrsaliye*`);
  lines.push(`• Kantar Net Tonajı: *${snapshot.todayShipmentTonnage > 0 ? `${snapshot.todayShipmentTonnage.toFixed(2)} Ton` : 'Tartım bekleniyor'}*`);
  if (snapshot.todayShipmentParkeM2 > 0) {
    lines.push(`• Sevk Edilen Parke: *${snapshot.todayShipmentParkeM2.toLocaleString('tr-TR')} m²*`);
  }
  if (snapshot.todayShipmentBordurMetre > 0) {
    lines.push(`• Sevk Edilen Bordür: *${snapshot.todayShipmentBordurMetre.toLocaleString('tr-TR')} Metre*`);
  }

  // Top destination sites
  if (snapshot.todayRecentShipments && snapshot.todayRecentShipments.length > 0) {
    const sites = Array.from(new Set(snapshot.todayRecentShipments.map((s) => `${s.customer} (${s.site})`))).slice(0, 3);
    lines.push(`• Ana Şantiyeler: ${sites.join(' • ')}`);
  }
  lines.push('');

  // 3. PALET ALACAKLARI & RİSK
  const totalPallets = snapshot.totalUnreturnedPallets || 0;
  const uretimPallets = snapshot.totalUnreturnedUretim || 0;
  const tahtaPallets = snapshot.totalUnreturnedTahta || 0;
  const totalRiskTL =
    uretimPallets * FACTORY_CORE_RULES.PALLET_PRICES.uretim +
    tahtaPallets * FACTORY_CORE_RULES.PALLET_PRICES.tahta;

  lines.push(`🪵 *3. ŞANTİYE PALET REHİN RİSKİ*`);
  lines.push(`• Şantiyelerdeki Palet: *${totalPallets.toLocaleString('tr-TR')} Adet*`);
  lines.push(`  - Üretim Paleti: *${uretimPallets.toLocaleString('tr-TR')} Adet* (₺${(uretimPallets * FACTORY_CORE_RULES.PALLET_PRICES.uretim).toLocaleString('tr-TR')})`);
  lines.push(`  - Tahta Palet: *${tahtaPallets.toLocaleString('tr-TR')} Adet* (₺${(tahtaPallets * FACTORY_CORE_RULES.PALLET_PRICES.tahta).toLocaleString('tr-TR')})`);
  lines.push(`• Toplam Finansal Risk: *₺${totalRiskTL.toLocaleString('tr-TR')}*`);

  if (snapshot.palletDebtors && snapshot.palletDebtors.length > 0) {
    const topDebtors = snapshot.palletDebtors.slice(0, 2).map((d) => `${d.customer}: ${d.unreturned} adet`);
    lines.push(`• En Yüksek Cariler: ${topDebtors.join(' • ')}`);
  }
  lines.push('');

  // 4. BEKÇİ ANOMALİLERİ
  if (watchdog && watchdog.totalAnomalies > 0) {
    lines.push(`🚨 *4. FABRİKA BEKÇİSİ UYARILARI (${watchdog.totalAnomalies} Aktif)*`);
    watchdog.anomalies.slice(0, 3).forEach((a) => {
      lines.push(`• [${a.severity === 'critical' ? 'KRİTİK' : 'UYARI'}] *${a.title}*: ${a.metric}`);
    });
    lines.push('');
  } else {
    lines.push(`✅ *4. GÖZETİM:* Kantar, fire ve stoklarda kritik anomali yok.\n`);
  }

  // 5. FİNANSAL BİRİM MALİYET
  if (snapshot.estimatedUnitCost > 0) {
    lines.push(`💰 *5. FİNANSAL VERİLER*`);
    lines.push(`• Tahmini 1 m² Üretim Maliyeti: *₺${snapshot.estimatedUnitCost.toFixed(2)}*`);
    if (snapshot.monthlyRevenue > 0) {
      lines.push(`• Aylık Kümülatif Ciro: *₺${snapshot.monthlyRevenue.toLocaleString('tr-TR')}*`);
    }
    lines.push('');
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🤖 _Parke ERP Otonom Saha Direktörü tarafından otomatik oluşturulmuştur._`);

  return lines.join('\n');
}

/**
 * Dispatches the executive report directly to WhatsApp
 */
export function sendBriefingViaWhatsApp(reportText: string, phoneNumber?: string): void {
  const cleanPhone = (phoneNumber || '').replace(/[^0-9]/g, '');
  const encodedText = encodeURIComponent(reportText);

  let url = '';
  if (cleanPhone) {
    url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
  } else {
    url = `https://api.whatsapp.com/send?text=${encodedText}`;
  }

  window.open(url, '_blank');
}

/**
 * Dispatches the executive report directly via Telegram Bot API
 */
export async function sendBriefingViaTelegram(
  reportText: string,
  botToken: string,
  chatId: string
): Promise<{ success: boolean; message: string }> {
  if (!botToken.trim() || !chatId.trim()) {
    return {
      success: false,
      message: 'Telegram Bot Token veya Chat ID eksik. Lütfen Ayarlar panelinden tanımlayınız.',
    };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: reportText,
        parse_mode: 'Markdown',
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      // Fallback without parse_mode if markdown characters caused formatting issues
      const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: reportText.replace(/[*_`]/g, ''),
        }),
      });
      const fallbackData = await fallbackRes.json();
      if (!fallbackRes.ok || !fallbackData.ok) {
        throw new Error(fallbackData.description || 'Telegram API mesajı kabul etmedi.');
      }
    }

    return {
      success: true,
      message: 'Gün sonu yönetici raporu Telegram kanalına başarıyla iletildi!',
    };
  } catch (err: any) {
    console.error('Telegram gönderim hatası:', err);
    return {
      success: false,
      message: err.message || 'Telegram sunucusuna bağlanılamadı.',
    };
  }
}
