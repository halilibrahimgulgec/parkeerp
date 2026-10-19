import { supabase } from '../lib/supabase';
import { ActionDraftPayload, ShipmentItemDraft } from '../types/aiActionTypes';
import { FactorySnapshot, normalizeTurkish } from './aiFactoryBrain';
import { smartMatchProduct, normalizePlateNumber, normalizePalletType } from './aiVisionOCREngine';

/**
 * Türkçe sesli plaka hecelemesini (Örn: "aleye" -> "ALY", "alje" -> "ALJ", "keye" -> "KY", "hene" -> "HN") harfe dönüştürür.
 */
function decodePhoneticLetters(s: string): string {
  let text = s.toLowerCase().trim();
  const syllables: [RegExp, string][] = [
    [/aleye|ale\s*ye|a\s*le\s*ye|a\s*ley/g, 'ALY'],
    [/alje|ale\s*je|a\s*le\s*je/g, 'ALJ'],
    [/anele|ane\s*le|a\s*ne\s*le/g, 'ANL'],
    [/keye|ke\s*ye|k\s*eye/g, 'KY'],
    [/hene|he\s*ne/g, 'HN'],
    [/bejeke|be\s*je\s*ke/g, 'BJK'],
    [/gese|ge\s*se/g, 'GS'],
    [/febe|fe\s*be/g, 'FB'],
    [/be\b/g, 'B'], [/ce\b/g, 'C'], [/de\b/g, 'D'], [/fe\b/g, 'F'],
    [/ge\b/g, 'G'], [/he\b/g, 'H'], [/je\b/g, 'J'], [/ke\b/g, 'K'],
    [/le\b/g, 'L'], [/me\b/g, 'M'], [/ne\b/g, 'N'], [/pe\b/g, 'P'],
    [/re\b/g, 'R'], [/se\b/g, 'S'], [/te\b/g, 'T'], [/ve\b/g, 'V'],
    [/ye\b/g, 'Y'], [/ze\b/g, 'Z'],
  ];
  for (const [re, rep] of syllables) {
    text = text.replace(re, rep);
  }
  return text.replace(/[^A-Z]/gi, '').toUpperCase();
}

/**
 * Sesli komut metninden plaka, ürün ve miktar kelimelerini ayıklayarak müşteri / cari adını tespit eder.
 */
function extractCustomerCandidate(query: string, detectedPlate?: string): string {
  let text = query;
  if (detectedPlate) {
    const parts = detectedPlate.split(/\s+/);
    for (const part of parts) {
      if (part) {
        text = text.replace(new RegExp('\\b' + part + '\\b', 'gi'), ' ');
      }
    }
  }
  // Yaygın fonetik plaka kelimelerini ve sayıları temizle
  text = text.replace(/\b(aleye|alje|aleje|anele|anle|keye|hene)\b/gi, ' ');
  text = text.replace(/\b(0[1-9]|[1-7][0-9]|8[01])\b/g, ' ');
  text = text.replace(/\b\d{2,4}\b/g, ' ');

  // Ürün isimlerini temizle
  const pWords = [
    'bahce', 'bahçe', 'bordur', 'bordür', 'karayolu', 'karayollari', 'karayolları',
    'ankara', 'kilit', 'parke', 'tasi', 'taşı', 'tas', 'taş', 'oluk', 'prizma', 'begonit',
    'cimen', 'çimen', 'limonluk', 'briket', 'naturel'
  ];
  for (const pw of pWords) {
    text = text.replace(new RegExp('\\b' + pw + '\\b', 'gi'), ' ');
  }

  // Miktar ve eylem kelimelerini temizle
  text = text.replace(/\b\d+(\s*(?:metre|metretul|metretül|mt|m2|metrekare|m²|adet|tane|palet))?\b/gi, ' ');
  text = text.replace(/\b(palet|tahta|uretim|üretim|sevkiyat|metre|adet|m2|metrekare|ton)\b/gi, ' ');
  text = text.replace(/\b(sevk|fisi|fişi|irsaliye|irsaliyeyi|bas|kes|hazirla|hazırla|yaz|kantar|cikis|çıkış|yukle|yükle|gonder|gönder)\b/gi, ' ');

  // Noktalama ve boşlukları toparla
  text = text.replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const words = text.split(/\s+/).filter(w => w.length >= 2);
  if (words.length > 0) {
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
  return 'Müşteri';
}

/**
 * 1. PARSE ACTION INTENT FROM OPERATOR QUERY
 * Analyzes natural language commands to detect actionable intents and builds draft previews.
 */
export async function parseActionIntentFromQuery(
  query: string,
  factoryData: FactorySnapshot,
  companyId?: string
): Promise<ActionDraftPayload | null> {
  const qNorm = normalizeTurkish(query);
  if (!qNorm) return null;

  // -------------------------------------------------------------------------
  // A. INTENT: SHIPMENT & WEIGHBRIDGE SLIP (Kantar & Sevkiyat Fişi Hazırlama)
  // -------------------------------------------------------------------------
  const hasPlatePattern =
    /\b(0[1-9]|[1-7][0-9]|8[01])\s*(?:[A-Za-z]{1,4}|[a-zA-ZçğıöşüÇĞİÖŞÜ]{2,10})\s*\d{2,4}\b/i.test(query);

  const hasProduct =
    qNorm.includes('parke') ||
    qNorm.includes('bordur') ||
    qNorm.includes('oluk') ||
    qNorm.includes('prizma') ||
    qNorm.includes('begonit') ||
    qNorm.includes('tas') ||
    qNorm.includes('tasi');

  const hasQty =
    qNorm.includes('palet') ||
    qNorm.includes('metre') ||
    qNorm.includes('metretul') ||
    qNorm.includes('m2') ||
    qNorm.includes('metrekare') ||
    qNorm.includes('adet');

  const isProductionIntentCheck =
    qNorm.includes('uretim') ||
    qNorm.includes('baski') ||
    qNorm.includes('basildi') ||
    qNorm.includes('vardiya');

  const isShipmentIntent =
    !isProductionIntentCheck &&
    (
      qNorm.includes('sevk fisi') ||
      qNorm.includes('sevk irsaliye') ||
      qNorm.includes('sevk irsaliyesi') ||
      qNorm.includes('kantar fisi') ||
      qNorm.includes('kantar') ||
      qNorm.includes('sevkiyat olustur') ||
      qNorm.includes('sevk et') ||
      qNorm.includes('sevk yap') ||
      qNorm.includes('sevk') ||
      qNorm.includes('kamyona yukle') ||
      qNorm.includes('araca yukle') ||
      qNorm.includes('araba yukle') ||
      qNorm.includes('irsaliye kes') ||
      qNorm.includes('irsaliye hazirla') ||
      qNorm.includes('irsaliye bas') ||
      qNorm.includes('irsaliyeyi bas') ||
      qNorm.includes('irsaliye') ||
      qNorm.includes('fisi hazirla') ||
      qNorm.includes('fis kes') ||
      qNorm.includes('fis hazirla') ||
      qNorm.includes('fis yaz') ||
      qNorm.includes('cikis yap') ||
      (qNorm.includes('palet') && (qNorm.includes('yukle') || qNorm.includes('gonder') || qNorm.includes('sevk'))) ||
      (qNorm.includes('kamyon') && (qNorm.includes('yukle') || qNorm.includes('gonder') || qNorm.includes('sevk'))) ||
      (qNorm.includes('arac') && (qNorm.includes('yukle') || qNorm.includes('gonder') || qNorm.includes('sevk'))) ||
      (hasPlatePattern && (hasProduct || hasQty || qNorm.length > 8)) ||
      (hasProduct && hasQty)
    );

  if (isShipmentIntent) {
    // 1. Veritabanından kayıtlı son araç plakalarını çek (Sesli algılamadaki harf kaymalarını eşlemek için)
    let knownPlates: string[] = [];
    try {
      let shipQ = supabase.from('shipments').select('vehicle_plate').order('created_at', { ascending: false }).limit(60);
      if (companyId) {
        shipQ = shipQ.or(`company_id.eq.${companyId},company_id.is.null`);
      }
      const { data: recShips } = await shipQ;
      if (recShips && recShips.length > 0) {
        knownPlates = [...new Set(recShips.map(s => (s.vehicle_plate || '').trim()).filter(Boolean))];
      }
    } catch {}

    // 2. Extract Vehicle Plate (Türk plaka formatı, fonetik heceleme ve temizliği)
    let detectedPlate: string | undefined = undefined;

    // A. Doğrudan standart plaka deseni (Örn: "46 ALY 455", "46 KY 189", "46ky 189")
    const plateMatch = query.match(/\b(0[1-9]|[1-7][0-9]|8[01])\s*([A-Za-z]{1,4})\s*(\d{2,4})\b/i);
    if (plateMatch && plateMatch[2].length <= 3) {
      detectedPlate = `${plateMatch[1]} ${plateMatch[2].toUpperCase()} ${plateMatch[3]}`;
    }

    // B. Ayrı ayrı hecelenmiş harfler (Örn: "46 a l y 455" veya "46 al y 455")
    if (!detectedPlate) {
      const spacedMatch = query.match(/\b(0[1-9]|[1-7][0-9]|8[01])\s+([A-Za-z](?:\s+[A-Za-z]){1,3})\s+(\d{2,4})\b/i);
      if (spacedMatch) {
        const letters = spacedMatch[2].replace(/\s+/g, '').toUpperCase();
        detectedPlate = `${spacedMatch[1]} ${letters} ${spacedMatch[3]}`;
      }
    }

    // C. Fonetik Türkçe seslendirme ve kayıtlı plaka eşleme (Örn: "46 aleye 455" -> 46 ALY 455, "46 hene 616" -> 46 HN 616)
    if (!detectedPlate) {
      const phoneticMatch = query.match(/\b(0[1-9]|[1-7][0-9]|8[01])\s+([a-zA-ZçğıöşüÇĞİÖŞÜ]{2,10})\s+(\d{2,4})\b/i);
      if (phoneticMatch) {
        const city = phoneticMatch[1];
        const rawLetters = phoneticMatch[2];
        const digits = phoneticMatch[3];

        // Fabrikanın kayıtlı araç plakaları arasında il ve rakamları uyuşan plakayı bul
        if (knownPlates.length > 0) {
          const found = knownPlates.find(p => {
            const pClean = p.replace(/\s+/g, '').toUpperCase();
            return pClean.startsWith(city) && pClean.endsWith(digits);
          });
          if (found) {
            detectedPlate = found;
          }
        }

        // Kayıtlı plaka bulunamadıysa fonetik hece çözücüyü çalıştır
        if (!detectedPlate) {
          const decoded = decodePhoneticLetters(rawLetters);
          if (decoded && decoded.length >= 1 && decoded.length <= 4) {
            detectedPlate = `${city} ${decoded} ${digits}`;
          }
        }
      }
    }

    // D. normalizePlateNumber yedek kontrolü
    if (!detectedPlate) {
      const cleanP = normalizePlateNumber(query);
      if (cleanP && cleanP.length >= 7 && cleanP.length <= 12 && /^[0-9A-Z\s]+$/.test(cleanP)) {
        detectedPlate = cleanP;
      }
    }

    // Güvenlik ve Kesin Doğrulama: Plaka asla 12 karakterden uzun olamaz ve Türk plaka formatına uymalıdır
    if (detectedPlate && (detectedPlate.length > 12 || !/^(0[1-9]|[1-7][0-9]|8[01])\s+[A-Z]{1,4}\s+\d{2,4}$/.test(detectedPlate))) {
      detectedPlate = undefined;
    }

    // 2. Match Customer (Aktif firmanın kayıtlı cari listesi)
    let matchedCustomer: { id: string; name: string } | null = null;
    try {
      let custQ = supabase.from('customers').select('id, name, company_id').eq('is_active', true);
      if (companyId) {
        custQ = custQ.or(`company_id.eq.${companyId},company_id.is.null`);
      }
      const { data: custList } = await custQ;
      if (custList && custList.length > 0) {
        // Tam eşleşme veya kelime bazlı eşleşme
        for (const c of custList) {
          const cNorm = normalizeTurkish(c.name);
          const words = cNorm.split(/\s+/).filter(w => w.length >= 3);
          if (qNorm.includes(cNorm) || words.some(w => qNorm.includes(w))) {
            matchedCustomer = c;
            break;
          }
        }
      }
    } catch {}

    // Fallback match from factory data debtors/shipments if offline
    if (!matchedCustomer) {
      const debtor = factoryData.palletDebtors.find(d => {
        const dNorm = normalizeTurkish(d.customer);
        return dNorm.length >= 3 && qNorm.includes(dNorm);
      });
      if (debtor) {
        matchedCustomer = { id: '', name: debtor.customer };
      }
    }

    // Default customer if none matched: ses metninden ayıklanan müşteri adayı (Örn: "Ökkeş Kamalak")
    const candidateCustomer = extractCustomerCandidate(query, detectedPlate);
    const customerName = matchedCustomer?.name || candidateCustomer || 'Müşteri';

    // 3. Match Site (Aktif firmanın ve müşterinin şantiyeleri)
    let siteName: string | undefined = undefined;
    let siteId: string | undefined = undefined;
    try {
      let siteQ = supabase.from('sites').select('id, name, customer_id, company_id').eq('is_active', true);
      if (matchedCustomer?.id) {
        siteQ = siteQ.eq('customer_id', matchedCustomer.id);
      } else if (companyId) {
        siteQ = siteQ.or(`company_id.eq.${companyId},company_id.is.null`);
      }
      const { data: siteList } = await siteQ;
      if (siteList && siteList.length > 0) {
        for (const s of siteList) {
          const sNorm = normalizeTurkish(s.name);
          const words = sNorm.split(/\s+/).filter(w => w.length >= 3);
          if (qNorm.includes(sNorm) || words.some(w => qNorm.includes(w))) {
            siteName = s.name;
            siteId = s.id;
            break;
          }
        }
      }
    } catch {}

    if (!siteName) {
      const knownSites = ['Altınova', 'Hacı Kel', 'Mustafa Kaya', 'Mustafa Yılmaz', 'Merkez', 'Şantiye'];
      for (const s of knownSites) {
        if (qNorm.includes(normalizeTurkish(s))) {
          siteName = s;
          break;
        }
      }
    }

    // 4. Extract Pallet or Metric (Metre / m² / Adet) quantity from voice
    let pallets = 0;
    const palletMatch =
      query.match(/(\d+)\s*(?:adet)?\s*(?:tahta|uretim|üretim|sevkiyat|ahsap|ahşap)?\s*palet/i) ||
      query.match(/palet\s*(?:adedi|sayisi|sayısı)?\s*[:=-]?\s*(\d+)/i);
    if (palletMatch) {
      pallets = parseInt(palletMatch[1], 10);
    }

    let metricQty = 0;
    let explicitUnit: 'm²' | 'Metre' | 'Adet' | null = null;

    // Metre / Metretül / Mt / M
    const metreMatch = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:metre|metretul|metretül|mt\b|m\b)/i);
    // Metrekare / m2 / m²
    const m2Match = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:m2|metrekare|m²)/i);
    // Adet / Tane
    const adetMatch = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:adet|tane)/i);

    if (metreMatch) {
      metricQty = parseFloat(metreMatch[1].replace(',', '.'));
      explicitUnit = 'Metre';
    } else if (m2Match) {
      metricQty = parseFloat(m2Match[1].replace(',', '.'));
      explicitUnit = 'm²';
    } else if (adetMatch) {
      metricQty = parseFloat(adetMatch[1].replace(',', '.'));
      explicitUnit = 'Adet';
    }

    // 5. Sesli Komutta Palet Cinsi Tespiti (Üretim / Tahta / Dökme / Sevkiyat)
    const detectedPalletType = normalizePalletType(query);

    // 6. Match Product from database or snapshot
    let productName = "8'lik Kilit Parke Gri";
    let productId = '';
    let unit = explicitUnit || 'm²';
    let m2PerPallet = 10.66;

    try {
      let prodQ = supabase.from('products').select('id, name, unit, thickness, color, price, m2_per_pallet, company_id').eq('is_active', true);
      if (companyId) {
        prodQ = prodQ.or(`company_id.eq.${companyId},company_id.is.null`);
      }
      const { data: prodList } = await prodQ;
      if (prodList && prodList.length > 0) {
        const best = smartMatchProduct(query, prodList);
        if (best) {
          productName = best.name;
          productId = best.id;
          unit = explicitUnit || (best.unit === 'metre' ? 'Metre' : (best.unit === 'adet' ? 'Adet' : 'm²'));
          if (best.m2_per_pallet && Number(best.m2_per_pallet) > 0) {
            m2PerPallet = Number(best.m2_per_pallet);
          } else if (best.name.includes('10')) {
            m2PerPallet = 8.5;
          } else if (best.name.includes('6')) {
            m2PerPallet = 12.0;
          } else if (best.name.toLowerCase().includes('bordür') || best.unit === 'metre') {
            m2PerPallet = 15.0;
          }
        }
      }
    } catch {}

    if (!productId) {
      if (qNorm.includes('karayol')) {
        productName = "75x30x15 Karayolu Bordürü";
        unit = explicitUnit || 'Metre';
        m2PerPallet = 15.0;
      } else if (qNorm.includes('bahce')) {
        productName = "50x20x10 Bahçe Bordürü";
        unit = explicitUnit || 'Metre';
        m2PerPallet = 15.0;
      } else if (qNorm.includes('ankara')) {
        productName = "50x25x20 Ankara Bordürü";
        unit = explicitUnit || 'Metre';
        m2PerPallet = 15.0;
      } else if (qNorm.includes('bordur')) {
        productName = "50x25x20 Ankara Bordürü";
        unit = explicitUnit || 'Metre';
        m2PerPallet = 15.0;
      } else if (qNorm.includes('oluk') || qNorm.includes('yagmur')) {
        productName = "50x25x10 Yağmur Oluğu";
        unit = explicitUnit || 'Metre';
        m2PerPallet = 15.0;
      } else if (qNorm.includes('10 luk') || qNorm.includes('10\'luk') || qNorm.includes('10luk')) {
        productName = "10'luk Naturel Parke Taşı";
        unit = explicitUnit || 'm²';
        m2PerPallet = 8.5;
      } else if (qNorm.includes('6 lik') || qNorm.includes('6\'lik') || qNorm.includes('6lik')) {
        productName = "6'lık Kilit Parke Gri";
        unit = explicitUnit || 'm²';
        m2PerPallet = 12.0;
      } else if (qNorm.includes('prizma') || qNorm.includes('20x10')) {
        productName = "20x10x6 Prizma Parke Gri";
        unit = explicitUnit || 'm²';
        m2PerPallet = 10.0;
      } else if (qNorm.includes('begonit')) {
        productName = "Begonit Taş Grubu";
        unit = explicitUnit || 'm²';
        m2PerPallet = 10.0;
      }
    }

    // Calculate totals
    let totalQty = metricQty;
    if (pallets > 0 && totalQty === 0) {
      totalQty = Math.round(pallets * m2PerPallet);
    } else if (totalQty > 0 && pallets === 0) {
      pallets = Math.ceil(totalQty / m2PerPallet);
    } else if (pallets === 0 && totalQty === 0) {
      pallets = 15;
      totalQty = Math.round(15 * m2PerPallet);
    }

    // Estimated weight:
    // Parke: ~180 kg/m²
    // Bordür: ~85 kg/metre (Karayolu bordürü 75x30x15 is ~85-90 kg/m)
    // Adet / Briket: ~20 kg/adet
    let weightPerUnit = 180;
    if (unit === 'Metre' || productName.toLowerCase().includes('bordür') || productName.toLowerCase().includes('oluk')) {
      weightPerUnit = 85;
    } else if (unit === 'Adet') {
      weightPerUnit = 20;
    }
    const estimatedTonnage = Number(((totalQty * weightPerUnit) / 1000).toFixed(2));

    const itemDraft: ShipmentItemDraft = {
      product_id: productId || 'prod-auto-match',
      product_name: productName,
      pallets,
      pallet_type: detectedPalletType,
      m2: totalQty,
      unit,
    };

    return {
      id: `draft-ship-${Date.now()}`,
      type: 'create_shipment',
      status: 'draft',
      title: 'Sesli Sevk & Kantar Fişi',
      description: `${customerName} için ${pallets} ${detectedPalletType} paleti (${totalQty} ${unit}) sevk fişi hazırlandı.`,
      createdAt: new Date().toISOString(),
      shipmentData: {
        customer_id: matchedCustomer?.id || '',
        customer_name: customerName,
        site_id: siteId || '',
        site_name: siteName || 'Ana Şantiye / Merkez',
        vehicle_plate: detectedPlate || '',
        driver_name: 'Kayıtlı Sürücü',
        shipment_date: new Date().toISOString().split('T')[0],
        company_id: companyId,
        items: [itemDraft],
        total_m2: totalQty,
        total_pallets: pallets,
        estimated_tonnage: 0,
        notes: `AI Saha Asistanı ile sesli komutla oluşturuldu. [${detectedPalletType} palet]`,
      },
    };
  }

  // -------------------------------------------------------------------------
  // B. INTENT: PRODUCTION ENTRY (Vardiya İmalat Girişi)
  // -------------------------------------------------------------------------
  const isProductionIntent =
    qNorm.includes('uretim girisi') ||
    qNorm.includes('uretim kaydet') ||
    qNorm.includes('baski yapildi') ||
    qNorm.includes('makinede basildi') ||
    (qNorm.includes('makine') && qNorm.includes('basil')) ||
    (qNorm.includes('vardiya') && qNorm.includes('uret'));

  if (isProductionIntent) {
    let machineNo = '1';
    let machineName = '1 Nolu Parke Pres Makinesi';
    if (qNorm.includes('2 nolu') || qNorm.includes('makine 2') || qNorm.includes('bordur')) {
      machineNo = '2';
      machineName = '2 Nolu Bordür Pres Makinesi';
    }

    let pallets = 0;
    const palletMatch = query.match(/(\d+)\s*(?:adet)?\s*palet/i);
    if (palletMatch) pallets = parseInt(palletMatch[1], 10);

    let m2 = 0;
    let prodUnit = 'm²';
    const prodMetreMatch = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:metre|metretul|metretül|mt\b|m\b)/i);
    const prodM2Match = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:m2|metrekare|m²)/i);
    const prodAdetMatch = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:adet|tane)/i);

    if (prodMetreMatch) {
      m2 = parseFloat(prodMetreMatch[1].replace(',', '.'));
      prodUnit = 'Metre';
    } else if (prodM2Match) {
      m2 = parseFloat(prodM2Match[1].replace(',', '.'));
      prodUnit = 'm²';
    } else if (prodAdetMatch) {
      m2 = parseFloat(prodAdetMatch[1].replace(',', '.'));
      prodUnit = 'Adet';
    }

    let wasteM2 = 0;
    const wasteMatch = query.match(/(\d+(?:[\.,]\d+)?)\s*(?:m2|metrekare|metre|adet)?\s*(?:fire|iskarta)/i);
    if (wasteMatch) wasteM2 = parseFloat(wasteMatch[1].replace(',', '.'));

    let productName = machineNo === '1' ? "8'lik Kilit Parke Gri" : "50x25x20 Ankara Bordürü";
    if (machineNo === '2' && qNorm.includes('karayol')) {
      productName = "75x30x15 Karayolu Bordürü";
      prodUnit = 'Metre';
    } else if (machineNo === '2' && qNorm.includes('bahce')) {
      productName = "50x20x10 Bahçe Bordürü";
      prodUnit = 'Metre';
    }

    const ratio = machineNo === '2' ? 15.0 : 10.66;
    if (m2 === 0 && pallets > 0) m2 = Math.round(pallets * ratio);
    if (m2 === 0) m2 = machineNo === '2' ? 300 : 500;
    if (pallets === 0) pallets = Math.ceil(m2 / ratio);

    const netM2 = Math.max(0, m2 - wasteM2);

    return {
      id: `draft-prod-${Date.now()}`,
      type: 'create_production',
      status: 'draft',
      title: 'Taslak Vardiya Üretim Girişi',
      description: `${machineName} için ${netM2} ${prodUnit} net üretim kaydı hazırlandı.`,
      createdAt: new Date().toISOString(),
      productionData: {
        product_id: '',
        product_name: productName,
        machine_id: machineNo,
        machine_name: machineName,
        date: factoryData.todayDate,
        shift: 'Gündüz',
        total_pallets: pallets,
        total_m2: m2,
        waste_m2: wasteM2,
        net_m2: netM2,
        notes: 'AI Saha Asistanı ile hızlı üretim girişi.',
      },
    };
  }

  // -------------------------------------------------------------------------
  // C. INTENT: PALLET RETURN (Palet İadesi Alma)
  // -------------------------------------------------------------------------
  const isPalletReturnIntent =
    qNorm.includes('palet iade') ||
    qNorm.includes('iade geldi') ||
    qNorm.includes('bos palet geldi') ||
    qNorm.includes('iade alindi') ||
    qNorm.includes('palet getirdi');

  if (isPalletReturnIntent) {
    let qty = 0;
    const qtyMatch = query.match(/(\d+)\s*(?:adet)?\s*(?:palet|tahta|uretim)/i);
    if (qtyMatch) qty = parseInt(qtyMatch[1], 10);
    if (qty === 0) qty = 40;

    let palletType: 'tahta' | 'uretim' | 'sevkiyat' = 'tahta';
    if (qNorm.includes('uretim') || qNorm.includes('celik')) {
      palletType = 'uretim';
    } else if (qNorm.includes('sevkiyat')) {
      palletType = 'sevkiyat';
    }

    let customerName = 'MEDİKENT';
    const debtor = factoryData.palletDebtors.find(d => {
      const dNorm = normalizeTurkish(d.customer);
      return dNorm.length >= 3 && qNorm.includes(dNorm);
    });
    if (debtor) customerName = debtor.customer;

    return {
      id: `draft-pallet-${Date.now()}`,
      type: 'return_pallet',
      status: 'draft',
      title: 'Taslak Boş Palet İade Girişi',
      description: `${customerName} şantiyesinden ${qty} adet ${palletType === 'uretim' ? 'Üretim' : 'Tahta'} Palet iadesi alındı.`,
      createdAt: new Date().toISOString(),
      palletReturnData: {
        customer_id: '',
        customer_name: customerName,
        date: factoryData.todayDate,
        pallet_type: palletType,
        quantity: qty,
        notes: 'AI Saha Asistanı ile oluşturulan boş palet iade kabulü.',
      },
    };
  }

  return null;
}

/**
 * 2. EXECUTE APPROVED ACTION
 * Writes the operator-approved draft to the Supabase database.
 */
export async function executeApprovedAction(
  draft: ActionDraftPayload,
  currentUser: any
): Promise<{ success: boolean; message: string; recordId?: string; invoiceNo?: string }> {
  try {
    // -----------------------------------------------------------------------
    // 1. SHIPMENT EXECUTION
    // -----------------------------------------------------------------------
    if (draft.type === 'create_shipment' && draft.shipmentData) {
      const d = draft.shipmentData;

      // Find or resolve customer ID
      let customerId = d.customer_id;
      if (!customerId) {
        const { data: custs } = await supabase
          .from('customers')
          .select('id, name')
          .ilike('name', `%${d.customer_name}%`)
          .limit(1);
        customerId = custs?.[0]?.id || '';
      }

      if (!customerId && d.customer_name && d.customer_name !== 'Müşteri') {
        try {
          const { data: newCust } = await supabase.from('customers').insert({
            name: d.customer_name,
            company_id: targetCompanyId,
            is_active: true,
          }).select('id').single();
          if (newCust?.id) customerId = newCust.id;
        } catch {}
      }

      if (!customerId) {
        // Find any active customer or create/fallback
        const { data: anyCust } = await supabase.from('customers').select('id').limit(1);
        customerId = anyCust?.[0]?.id || '';
      }

      // Generate invoice number (Use draft invoice_no if provided by OCR, else find latest and increment)
      let nextInvNo = d.invoice_no || '';
      if (!nextInvNo) {
        const { data: lastShipment } = await supabase
          .from('shipments')
          .select('invoice_no')
          .order('created_at', { ascending: false })
          .limit(1);

        nextInvNo = '2458';
        if (lastShipment && lastShipment[0]?.invoice_no) {
          const parsed = parseInt(lastShipment[0].invoice_no, 10);
          if (!isNaN(parsed) && parsed > 0) {
            nextInvNo = String(parsed + 1);
          }
        }
      }

      // Kantar tartımı fiilen yapılana kadar brüt ve dara 0 kg olarak kaydedilir (Listede 0 t görünür)
      const gross = Number(d.gross_weight) || 0;
      const tare = Number(d.tare_weight) || 0;

      const targetCompanyId = d.company_id || (currentUser as any)?.company_id || null;
      const targetDate = d.shipment_date || new Date().toISOString().split('T')[0];

      // A. Insert Shipment
      const { data: newShipment, error: shipErr } = await supabase
        .from('shipments')
        .insert({
          invoice_no: nextInvNo,
          customer_id: customerId,
          site_id: d.site_id || null,
          vehicle_plate: d.vehicle_plate || '46 K 1234',
          driver_name: d.driver_name || 'Kayıtlı Şoför',
          gross_weight: gross,
          tare_weight: tare,
          total_m2: d.total_m2,
          status: 'completed',
          shipment_date: targetDate,
          notes: `${d.notes || ''} [İrsaliye No: ${nextInvNo}]`,
          created_by: currentUser?.id,
          company_id: targetCompanyId,
        })
        .select()
        .single();

      if (shipErr || !newShipment) {
        throw new Error(shipErr?.message || 'Sevkiyat kaydı oluşturulamadı.');
      }

      // B. Insert Shipment Items
      if (d.items && d.items.length > 0) {
        // Resolve a valid product_id
        let validProductId = d.items[0].product_id;
        if (!validProductId || validProductId.includes('auto')) {
          let prodQ = supabase.from('products').select('id').limit(1);
          if (targetCompanyId) {
            prodQ = prodQ.or(`company_id.eq.${targetCompanyId},company_id.is.null`);
          }
          const { data: prods } = await prodQ;
          validProductId = prods?.[0]?.id || '';
        }

        const itemsToInsert = d.items.map(it => ({
          shipment_id: newShipment.id,
          product_id: it.product_id && !it.product_id.includes('auto') ? it.product_id : validProductId,
          pallets: it.pallets,
          pallet_type: it.pallet_type || 'sevkiyat',
          m2: it.m2,
          unit: it.unit || 'm2',
          company_id: targetCompanyId,
        }));

        await supabase.from('shipment_items').insert(itemsToInsert);

        // C. Record Sent Pallets
        if (d.total_pallets > 0) {
          await supabase.from('pallet_transactions').insert({
            date: targetDate,
            customer_id: customerId,
            site_id: d.site_id || null,
            shipment_id: newShipment.id,
            transaction_type: 'sent',
            pallet_type: d.items[0]?.pallet_type || 'sevkiyat',
            quantity: d.total_pallets,
            notes: `${nextInvNo} no'lu sevkiyat ile şantiyeye sevk edildi.`,
            created_by: currentUser?.id,
            company_id: targetCompanyId,
          });
        }
      }

      return {
        success: true,
        message: `İrsaliye No: ${nextInvNo} ile kantar sevkiyatı başarıyla kaydedildi!`,
        recordId: newShipment.id,
        invoiceNo: nextInvNo,
      };
    }

    // -----------------------------------------------------------------------
    // 2. PRODUCTION ENTRY EXECUTION
    // -----------------------------------------------------------------------
    if (draft.type === 'create_production' && draft.productionData) {
      const p = draft.productionData;

      let validProdId = p.product_id;
      if (!validProdId) {
        const { data: prods } = await supabase.from('products').select('id').limit(1);
        validProdId = prods?.[0]?.id || '';
      }

      const { data: newProd, error: prodErr } = await supabase
        .from('production_entries')
        .insert({
          date: p.date,
          shift: p.shift,
          machine_no: p.machine_id || '1',
          product_id: validProdId,
          total_pallets: p.total_pallets,
          total_m2: p.total_m2,
          waste_m2: p.waste_m2,
          net_m2: p.net_m2,
          lot_number: `LOT-${Date.now().toString().slice(-6)}`,
          notes: p.notes || 'AI Saha Asistanı Vardiya Girişi',
          created_by: currentUser?.id,
        })
        .select()
        .single();

      if (prodErr || !newProd) {
        throw new Error(prodErr?.message || 'Üretim kaydı oluşturulamadı.');
      }

      return {
        success: true,
        message: `${p.machine_name} için ${p.net_m2} m² net üretim başarıyla kaydedildi!`,
        recordId: newProd.id,
      };
    }

    // -----------------------------------------------------------------------
    // 3. PALLET RETURN EXECUTION
    // -----------------------------------------------------------------------
    if (draft.type === 'return_pallet' && draft.palletReturnData) {
      const pal = draft.palletReturnData;

      let customerId = pal.customer_id;
      if (!customerId) {
        const { data: custs } = await supabase
          .from('customers')
          .select('id, name')
          .ilike('name', `%${pal.customer_name}%`)
          .limit(1);
        customerId = custs?.[0]?.id || '';
      }

      if (!customerId) {
        const { data: anyCust } = await supabase.from('customers').select('id').limit(1);
        customerId = anyCust?.[0]?.id || '';
      }

      const { data: newPalletTrans, error: palErr } = await supabase
        .from('pallet_transactions')
        .insert({
          date: pal.date,
          customer_id: customerId,
          site_id: pal.site_id || null,
          transaction_type: 'returned',
          pallet_type: pal.pallet_type,
          quantity: pal.quantity,
          notes: `${pal.notes || 'Boş palet iadesi kabul edildi.'} [Plaka: ${pal.vehicle_plate || 'Sahadan teslim'}]`,
          created_by: currentUser?.id,
        })
        .select()
        .single();

      if (palErr || !newPalletTrans) {
        throw new Error(palErr?.message || 'Palet iadesi kaydedilemedi.');
      }

      return {
        success: true,
        message: `${pal.customer_name} hesabından ${pal.quantity} adet ${pal.pallet_type} palet iadesi kaydedildi!`,
        recordId: newPalletTrans.id,
      };
    }

    // -----------------------------------------------------------------------
    // 4. RAW MATERIAL & EXTERNAL PURCHASE EXECUTION (From Photo Vision OCR)
    // -----------------------------------------------------------------------
    if (draft.type === 'create_purchase' && draft.purchaseData) {
      const pur = draft.purchaseData;
      const today = new Date().toISOString().split('T')[0];
      const month = new Date().getMonth() + 1;
      const year = new Date().getFullYear();

      // A. Insert into cost_entries (Hammadde gideri ve silolar)
      const { data: newCost, error: costErr } = await supabase
        .from('cost_entries')
        .insert({
          date: today,
          period_month: month,
          period_year: year,
          cost_type: 'hammadde',
          sub_type: pur.material_type || 'cimento',
          description: `${pur.supplier_name} - ${pur.material_name || pur.product_name} [İrsaliye: ${pur.invoice_no || pur.supplier_invoice_no}] [Plaka: ${pur.vehicle_plate || '-'}]`,
          quantity: pur.quantity,
          unit: pur.unit,
          unit_price: pur.unit_price || 0,
          transport_cost: 0,
          total_amount: pur.total_amount || (pur.unit_price ? pur.quantity * pur.unit_price : 0),
          created_by: currentUser?.id,
        })
        .select()
        .single();

      // B. Also record into external_purchases if available
      try {
        await supabase.from('external_purchases').insert({
          date: today,
          supplier_name: pur.supplier_name,
          supplier_invoice_no: pur.invoice_no || pur.supplier_invoice_no,
          vehicle_plate: pur.vehicle_plate || '46 K 1234',
          driver_name: pur.driver_name || 'Kayıtlı Sürücü',
          quantity: pur.quantity,
          unit: pur.unit === 'kg' ? 'adet' : (pur.unit as any),
          notes: `${pur.notes || ''} [Optik Vision OCR ile okundu]`,
          created_by: currentUser?.id,
        });
      } catch (epErr) {
        console.warn('external_purchases log:', epErr);
      }

      if (costErr && !newCost) {
        throw new Error(costErr?.message || 'Hammadde girişi kaydedilemedi.');
      }

      return {
        success: true,
        message: `${pur.supplier_name} firmasından ${pur.quantity.toLocaleString('tr-TR')} ${pur.unit} ${pur.material_name || pur.product_name} hammadde stoğuna başarıyla işlendi! [İrsaliye: ${pur.invoice_no || pur.supplier_invoice_no}]`,
        recordId: newCost?.id,
        invoiceNo: pur.invoice_no || pur.supplier_invoice_no,
      };
    }

    throw new Error('Tanımlanmamış aksiyon türü.');
  } catch (err: any) {
    console.error('executeApprovedAction hatası:', err);
    return {
      success: false,
      message: err?.message || 'İşlem gerçekleştirilirken bir hata oluştu.',
    };
  }
}
