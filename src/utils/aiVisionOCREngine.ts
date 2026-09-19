import { supabase } from '../lib/supabase';
import { ActionDraftPayload, ShipmentItemDraft } from '../types/aiActionTypes';
import { normalizeTurkish } from './aiFactoryBrain';

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * GÖRÜNTÜ ÖN İŞLEME & BİLGİSAYARLI GÖRÜ (CANVAS PRE-PROCESSING)
 * ══════════════════════════════════════════════════════════════════════════════
 * Otokopili (pembe/sarı) sevk fişlerindeki ve kantar kağıtlarındaki silik
 * tükenmez kalem ve kurşun kalem yazılarını netleştiren kontrast ve keskinlik filtresi.
 */
export async function preprocessImageForOCR(
  file: File,
  maxWidth = 1600,
  quality = 0.88
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Metinlerin okunabilirliği için çözünürlüğü yüksek tut (min 1400 - max 1600)
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const rawBase64 = (e.target?.result as string).split(',')[1];
          resolve({
            base64: rawBase64,
            mimeType: file.type || 'image/jpeg',
            previewUrl: e.target?.result as string,
          });
          return;
        }

        // Kontrast ve netlik filtresi: Silik el yazılarını ve matris nokta vuruşlarını belirginleştirir
        try {
          ctx.filter = 'contrast(1.22) brightness(1.04) saturate(1.1)';
        } catch {}

        ctx.drawImage(img, 0, 0, width, height);

        // Reset filter
        try {
          ctx.filter = 'none';
        } catch {}

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const parts = dataUrl.split(',');

        resolve({
          base64: parts[1],
          mimeType: 'image/jpeg',
          previewUrl: dataUrl,
        });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Backward-compatible alias
export const compressImageFile = preprocessImageForOCR;

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TİP TANIMLARI (TYPES)
 * ══════════════════════════════════════════════════════════════════════════════
 */
export interface ParsedShipmentOCRItem {
  product_name: string;
  product_id?: string;
  pallets: number;
  pallet_type: 'uretim' | 'tahta' | 'sevkiyat' | 'dokme';
  m2: number;
  unit: string;
  thickness?: string;
  color?: string;
}

export interface ParsedShipmentOCRData {
  invoice_no?: string;
  customer_name?: string;
  matched_customer_id?: string;
  site_name?: string;
  matched_site_id?: string;
  vehicle_plate?: string;
  driver_name?: string;
  driver_phone?: string;
  date?: string;
  items: ParsedShipmentOCRItem[];
  total_m2: number;
  total_pallets: number;
  gross_weight?: number;
  tare_weight?: number;
  net_weight?: number;
  estimated_tonnage: number;
  notes?: string;
  supplier_name?: string;
  is_external?: boolean;
  raw_text?: string;
}

export interface VisionAnalysisResult {
  textResponse: string;
  description: string;
  detectedType?: 'document_ocr' | 'defect_inspection' | 'other';
  actionDraft?: ActionDraftPayload;
  parsedShipment?: ParsedShipmentOCRData;
  needsApiKey?: boolean;
  error?: string;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * EN İYİ VISION AI MODELLERİ KASKADI (MULTI-MODEL CASCADE)
 * ══════════════════════════════════════════════════════════════════════════════
 * 1. Google Gemini 2.0 Flash (En güncel, en hızlı ve el yazısı/tablo okumada en başarılı)
 * 2. Google Gemini 1.5 Flash (Yüksek erişilebilirlik ve güvenilir yedek)
 * 3. Google Gemini 1.5 Pro (Derin akıl yürütme ve karmaşık belge okuma yedeği)
 */
const VISION_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

/**
 * Kapsamlı Optik Belge, İrsaliye ve Kalite Kontrol Sistem İstemi
 */
function buildVisionPrompt(userNote = ''): string {
  return `Sen "Parke ERP" fabrikasının Üst Düzey Optik Karakter Tanıma (OCR) ve Belge/Kalite Yapay Zekasısın.
Sana gönderilen görsel bir SEVKİYAT İRSALİYESİ, KANTAR ÇIKIŞ FİŞİ, HAMMADDE GİRİŞ İRSALİYESİ veya BOZUK TAŞ FOTOĞRAFIDIR.
Görseli en yüksek dikkatle incele. Hem matbaa/yazıcı yazılarını hem de elle yazılmış (tükenmez/kurşun kalem) notları eksiksiz oku.

Belgeler çoğunlukla şu 3 sınıftan birine aittir:

SINIF 1: PARKE / BORDÜR SEVKİYAT FORMU VEYA SEVK İRSALİYESİ (ÇIKIŞ)
Özellikle şu alanları bul ve ayıkla:
- İrsaliye No / Form No (örn: 2468, 10542 vb.)
- Müşteri / Firma Ünvanı (Alıcı: örn. ASİLSA, Kaya İnşaat, Aksoy Ltd. vb.)
- Teslim Şantiyesi / Sevk Yeri (örn. Hacıbaba, Altınova, Merkez vb.)
- Araç Plakası (örn. 31 AHG 622, 46 K 1234, 06 BC 789)
- Şoför Adı veya Teslim Alan (örn. Mehmet Kaya, Ali vb.)
- Tarih
- Sevk Edilen Malzemeler (Her bir satır için: Taş cinsi örn. "8'lik Kilit Parke", "50x25 Bordür", Miktar, Birim m² veya Metre/Adet, Palet Sayısı, Palet Türü örn: üretim/tahta/dokme)
- Kantar Tartımı varsa (Brüt kg, Dara kg, Net kg)
- Varsa dış tedarikçi/transit firma adı

SINIF 2: HAMMADDE / ÇİMENTO / AGREGA / MICIR GİRİŞİ VEYA KANTAR FİŞİ
- Tedarikçi Adı (örn. Kahramanmaraş Çimento A.Ş., Taş Ocağı vb.)
- İrsaliye No
- Malzeme Adı (örn. CEM I 42.5 R Dökme Çimento, 0-5 Kalker Tozu vb.)
- Tartım Miktarı (Net kg veya Ton)
- Plaka ve Şoför

SINIF 3: BOZUK / HATALI PARKE VEYA BORDÜR TAŞI (KALİTE KONTROL)
- Hata Tipi (Kenar kırığı, yüzey çatlağı, kalıp pabuç çizgisi, harç dağılması)
- Hatanın şiddeti ve operatöre tavsiye

ÇOK ÖNEMLİ KURALLAR:
1. Yanıtının EN BAŞINA mutlaka aşağıdaki JSON formatında \`\`\`json ... \`\`\` kod bloğu koy.
2. JSON'dan sonra Türkçe, nazik ve maddeli bir özet rapor yaz.

Eğer SINIF 1 (Parke Sevkiyat Formu / İrsaliyesi) ise JSON Şablonu:
\`\`\`json
{
  "analysis_type": "document_shipment",
  "invoice_no": "2468",
  "customer_name": "ASİLSA İNŞAAT",
  "site_name": "Hacıbaba Şantiyesi",
  "vehicle_plate": "31 AHG 622",
  "driver_name": "Mehmet Kaya",
  "shipment_date": "2026-09-19",
  "items": [
    {
      "product_name": "8'lik Kilit Parke Taşı",
      "pallets": 20,
      "pallet_type": "uretim",
      "m2": 144,
      "unit": "m²",
      "thickness": "8 cm",
      "color": "Gri"
    }
  ],
  "total_m2": 144,
  "total_pallets": 20,
  "gross_weight": 40000,
  "tare_weight": 14080,
  "net_weight": 25920,
  "estimated_tonnage": 25.92,
  "supplier_name": "",
  "is_external": false,
  "summary": "ASİLSA Hacıbaba şantiyesine 144 m2 8'lik kilit parke sevk irsaliyesi"
}
\`\`\`

Eğer SINIF 2 (Hammadde Giriş İrsaliyesi) ise JSON Şablonu:
\`\`\`json
{
  "analysis_type": "document_purchase",
  "supplier_name": "Kahramanmaraş Çimento A.Ş.",
  "invoice_no": "98421",
  "vehicle_plate": "46 K 1234",
  "driver_name": "Ali Veli",
  "material_name": "CEM I 42.5 R Dökme Çimento",
  "material_category": "cimento",
  "quantity": 28400,
  "unit": "kg",
  "summary": "28.400 kg dökme çimento kantar fişi"
}
\`\`\`

Eğer SINIF 3 (Bozuk Taş Kalite Kontrolü) ise JSON Şablonu:
\`\`\`json
{
  "analysis_type": "quality_defect",
  "defect_type": "Kenar Kırığı & Yüzey Dağılması",
  "severity": "orta",
  "detected_product": "8'lik Kilit Parke",
  "root_cause": "Kalıp pabucundaki aşınma veya harcın vibrasyon süresinin az olması",
  "recommendation": "Alt vibrasyonu 0.4 sn artırınız ve kalıp paralelliğini kontrol ediniz"
}
\`\`\`
${userNote ? `Kullanıcının ilettiği ek not: "${userNote}"` : ''}`;
}

/**
 * Multi-Model Vision API Caller with Automated Failover Cascade
 */
export async function callVisionCascade(
  base64Image: string,
  mimeType = 'image/jpeg',
  userNote = '',
  apiKey?: string
): Promise<{ candidateText: string; usedModel: string }> {
  const savedKey = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('parke_gemini_api_key') : null;
  const envKey = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env?.VITE_GEMINI_API_KEY : null;
  const geminiKey = (apiKey || savedKey || envKey || '').trim();

  if (!geminiKey) {
    throw new Error('API_KEY_MISSING');
  }

  const prompt = buildVisionPrompt(userNote);
  let lastError: any = null;

  for (const model of VISION_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`Vision AI [${model}] HTTP ${response.status}:`, errText);
        lastError = new Error(`Model ${model} hatası: HTTP ${response.status}`);
        // If it's a 404 (model not available) or 429 (rate limit), continue to next model in cascade
        continue;
      }

      const resJson = await response.json();
      const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim().length > 0) {
        return { candidateText: text, usedModel: model };
      }
    } catch (err: any) {
      console.warn(`Vision AI [${model}] çağrısı başarısız oldu:`, err?.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Tüm Vision AI modelleri başarısız oldu.');
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * VERİTABANI VARLIK ÇÖZÜMLEME (DATABASE ENTITY RESOLUTION)
 * ══════════════════════════════════════════════════════════════════════════════
 * Fotoğraftan okunan metindeki Müşteri, Şantiye ve Ürün adlarını Supabase'deki
 * gerçek kayıtlarla eşleştirir ve `customer_id`, `site_id`, `product_id` bağlar.
 */
export async function resolveEntitiesWithDatabase(rawShipment: any): Promise<ParsedShipmentOCRData> {
  const norm = (s: string) => normalizeTurkish(s || '').toLowerCase().trim();

  let customerId = '';
  let customerName = rawShipment.customer_name || '';
  let siteId = '';
  let siteName = rawShipment.site_name || '';

  // 1. Resolve Customer
  try {
    const { data: customers } = await supabase.from('customers').select('id, name').eq('is_active', true);
    if (customers && customers.length > 0 && customerName) {
      const cTarget = norm(customerName);
      // Exact or partial match
      const matched = customers.find(c => {
        const cn = norm(c.name);
        return cn === cTarget || (cn.length >= 4 && cTarget.includes(cn)) || (cTarget.length >= 4 && cn.includes(cTarget));
      });
      if (matched) {
        customerId = matched.id;
        customerName = matched.name;
      }
    }
  } catch (err) {
    console.warn('Customer resolution error:', err);
  }

  // 2. Resolve Site
  try {
    const query = supabase.from('sites').select('id, name, customer_id').eq('is_active', true);
    if (customerId) {
      query.eq('customer_id', customerId);
    }
    const { data: sites } = await query;
    if (sites && sites.length > 0 && siteName) {
      const sTarget = norm(siteName);
      const matchedSite = sites.find(s => {
        const sn = norm(s.name);
        return sn === sTarget || (sn.length >= 3 && sTarget.includes(sn)) || (sTarget.length >= 3 && sn.includes(sTarget));
      });
      if (matchedSite) {
        siteId = matchedSite.id;
        siteName = matchedSite.name;
        if (!customerId && matchedSite.customer_id) {
          customerId = matchedSite.customer_id;
        }
      }
    } else if (sites && sites.length === 1 && !siteId) {
      // Default to the single site if only one exists for this customer
      siteId = sites[0].id;
      siteName = sites[0].name;
    }
  } catch (err) {
    console.warn('Site resolution error:', err);
  }

  // 3. Resolve Products
  let resolvedItems: ParsedShipmentOCRItem[] = [];
  try {
    const { data: products } = await supabase.from('products').select('id, name, unit, thickness, color').eq('is_active', true);
    const rawItems = Array.isArray(rawShipment.items) && rawShipment.items.length > 0
      ? rawShipment.items
      : [{
          product_name: rawShipment.product_name || "8'lik Kilit Parke Taşı",
          pallets: Number(rawShipment.pallets || 0),
          pallet_type: rawShipment.pallet_type || 'uretim',
          m2: Number(rawShipment.quantity_m2 || rawShipment.m2 || 0),
          unit: rawShipment.unit || 'm²',
        }];

    resolvedItems = rawItems.map((it: any) => {
      let pId = '';
      let pName = it.product_name || "8'lik Kilit Parke Taşı";
      let pUnit = it.unit || 'm²';
      const itNorm = norm(pName);

      if (products && products.length > 0) {
        const matchedProd = products.find(p => {
          const pn = norm(p.name);
          return pn === itNorm || (pn.length >= 4 && itNorm.includes(pn)) || (itNorm.length >= 4 && pn.includes(itNorm));
        });
        if (matchedProd) {
          pId = matchedProd.id;
          pName = matchedProd.name;
          pUnit = matchedProd.unit === 'metre' ? 'Metre' : (matchedProd.unit === 'adet' ? 'Adet' : 'm²');
        }
      }

      let m2 = Number(it.m2 || it.quantity_m2 || 0);
      let pal = Number(it.pallets || 0);

      // Auto-compute m2 if 0 but pallets given
      if (m2 === 0 && pal > 0) {
        m2 = Math.round(pal * 7.2);
      } else if (m2 > 0 && pal === 0) {
        pal = Math.ceil(m2 / 10.66);
      }

      const pType = it.pallet_type === 'uretim' ? 'uretim' : (it.pallet_type === 'tahta' ? 'tahta' : (it.pallet_type === 'dokme' ? 'dokme' : 'sevkiyat'));

      return {
        product_name: pName,
        product_id: pId,
        pallets: pal,
        pallet_type: pType,
        m2: m2,
        unit: pUnit,
        thickness: it.thickness,
        color: it.color,
      };
    });
  } catch (err) {
    console.warn('Product resolution error:', err);
  }

  // 4. Totals & Weights
  const totalM2 = resolvedItems.reduce((acc, it) => acc + (it.unit === 'm²' || it.unit === 'm2' ? it.m2 : 0), 0) || Number(rawShipment.total_m2 || 0);
  const totalPallets = resolvedItems.reduce((acc, it) => acc + it.pallets, 0) || Number(rawShipment.total_pallets || 0);

  let estTonnage = Number(rawShipment.estimated_tonnage || 0);
  if (estTonnage === 0 && totalM2 > 0) {
    estTonnage = Number(((totalM2 * 180) / 1000).toFixed(2));
  }

  // Clean vehicle plate
  let cleanPlate = (rawShipment.vehicle_plate || '').toUpperCase().trim();
  const plateMatch = cleanPlate.match(/\b(\d{2})\s*([A-Z]{1,3})\s*(\d{2,4})\b/i);
  if (plateMatch) {
    cleanPlate = `${plateMatch[1]} ${plateMatch[2].toUpperCase()} ${plateMatch[3]}`;
  }

  return {
    invoice_no: rawShipment.invoice_no ? String(rawShipment.invoice_no).trim() : '',
    customer_name: customerName,
    matched_customer_id: customerId,
    site_name: siteName,
    matched_site_id: siteId,
    vehicle_plate: cleanPlate,
    driver_name: rawShipment.driver_name ? String(rawShipment.driver_name).trim() : '',
    driver_phone: rawShipment.driver_phone ? String(rawShipment.driver_phone).trim() : '',
    date: rawShipment.shipment_date || new Date().toISOString().split('T')[0],
    items: resolvedItems,
    total_m2: totalM2,
    total_pallets: totalPallets,
    gross_weight: Number(rawShipment.gross_weight || 0),
    tare_weight: Number(rawShipment.tare_weight || 0),
    net_weight: Number(rawShipment.net_weight || 0),
    estimated_tonnage: estTonnage,
    supplier_name: rawShipment.supplier_name,
    is_external: !!rawShipment.is_external,
    notes: rawShipment.summary || rawShipment.notes || '',
  };
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * SEVKİYAT EKRANI İÇİN DOĞRUDAN İRSALİYE TARAMA FONKSİYONU
 * ══════════════════════════════════════════════════════════════════════════════
 * Shipment.tsx sayfasında çekilen veya seçilen görseli tarayıp
 * doğrudan form verilerine dönüştürür.
 */
export async function scanWaybillImageForShipment(
  file: File,
  apiKey?: string
): Promise<{ success: boolean; data?: ParsedShipmentOCRData; message?: string; needsApiKey?: boolean }> {
  try {
    // 1. Görüntü Ön İşleme
    const preprocessed = await preprocessImageForOCR(file, 1600, 0.88);

    // 2. Vision AI Cascade
    const { candidateText, usedModel } = await callVisionCascade(
      preprocessed.base64,
      preprocessed.mimeType,
      'Sevkiyat irsaliyesini tara ve tüm verileri ayıkla',
      apiKey
    );

    // 3. Extract JSON
    const jsonMatch = candidateText.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      return {
        success: false,
        message: 'Görsel analiz edildi ancak yapılandırılmış irsaliye verisi bulunamadı.',
      };
    }

    const parsedJson = JSON.parse(jsonMatch[1]);

    // 4. Resolve with Supabase Database
    const resolvedData = await resolveEntitiesWithDatabase(parsedJson);

    return {
      success: true,
      data: resolvedData,
      message: `İrsaliye başarıyla okundu (${usedModel})!`,
    };
  } catch (err: any) {
    if (err?.message === 'API_KEY_MISSING') {
      return {
        success: false,
        needsApiKey: true,
        message: 'Google Gemini Vision API anahtarı bulunamadı. Lütfen anahtarınızı giriniz.',
      };
    }
    return {
      success: false,
      message: `Görüntü okuma hatası: ${err?.message || 'Bilinmeyen hata'}`,
    };
  }
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ASİSTAN MODAL İÇİN ÇOK MODLU GÖRSEL ANALİZİ (ANALYZE IMAGE WITH VISION)
 * ══════════════════════════════════════════════════════════════════════════════
 */
export async function analyzeImageWithVision(
  base64Image: string,
  mimeType = 'image/jpeg',
  userNote = '',
  apiKey?: string
): Promise<VisionAnalysisResult> {
  const savedKey = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('parke_gemini_api_key') : null;
  const envKey = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env?.VITE_GEMINI_API_KEY : null;
  const geminiKey = (apiKey || savedKey || envKey || '').trim();

  // If no Gemini key is provided, clearly request setup instead of returning fake data
  if (!geminiKey) {
    const promptMsg = `📷 **Optik Belge & İrsaliye Okuma Motoru (Vision AI)**\n\n` +
      `Fotoğraftan irsaliye, sevk fişi ve kantar verilerini %100 doğrulukla okumak için **Google Gemini Vision** motoru gereklidir.\n\n` +
      `🔑 **Hızlı Kurulum:**\n` +
      `Google AI Studio'dan (aistudio.google.com) saniyeler içinde **ücretsiz ve süresiz** bir API anahtarı alıp aşağıdaki alana yapıştırabilirsiniz:`;

    return {
      textResponse: promptMsg,
      description: promptMsg,
      needsApiKey: true,
    };
  }

  try {
    const { candidateText, usedModel } = await callVisionCascade(base64Image, mimeType, userNote, geminiKey);

    // Extract JSON block
    const jsonMatch = candidateText.match(/```json\s*([\s\S]*?)\s*```/);
    let parsedJson: any = null;
    if (jsonMatch) {
      try {
        parsedJson = JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.warn('Vision JSON parse error:', e);
      }
    }

    let actionDraft: ActionDraftPayload | undefined = undefined;
    let parsedShipment: ParsedShipmentOCRData | undefined = undefined;

    // Check document type
    const isShipment =
      parsedJson?.analysis_type === 'document_shipment' ||
      (!parsedJson?.analysis_type && (candidateText.includes('SEVK') || candidateText.includes('İRSALİYE') || candidateText.includes('PARKE')));

    if (isShipment && parsedJson) {
      parsedShipment = await resolveEntitiesWithDatabase(parsedJson);

      const draftItems: ShipmentItemDraft[] = parsedShipment.items.map(it => ({
        product_id: it.product_id || 'prod-auto-match',
        product_name: it.product_name,
        pallets: it.pallets,
        pallet_type: it.pallet_type,
        m2: it.m2,
        unit: it.unit,
      }));

      actionDraft = {
        id: `draft-ship-${Date.now()}`,
        type: 'create_shipment',
        status: 'draft',
        title: 'Parke Sevkiyat & Çıkış İrsaliyesi (Vision AI)',
        description: `${parsedShipment.customer_name || 'Müşteri'} firmasına ${parsedShipment.total_m2} m² (${parsedShipment.total_pallets} palet) sevk irsaliyesi okundu.`,
        createdAt: new Date().toISOString(),
        shipmentData: {
          customer_id: parsedShipment.matched_customer_id || '',
          customer_name: parsedShipment.customer_name || 'Müşteri',
          site_id: parsedShipment.matched_site_id || '',
          site_name: parsedShipment.site_name || '',
          vehicle_plate: parsedShipment.vehicle_plate || '',
          driver_name: parsedShipment.driver_name || '',
          driver_phone: parsedShipment.driver_phone || '',
          invoice_no: parsedShipment.invoice_no || '',
          items: draftItems,
          total_m2: parsedShipment.total_m2,
          total_pallets: parsedShipment.total_pallets,
          estimated_tonnage: parsedShipment.estimated_tonnage,
          gross_weight: parsedShipment.gross_weight,
          tare_weight: parsedShipment.tare_weight,
          net_weight: parsedShipment.net_weight,
          notes: `Fotoğraf OCR (${usedModel}) ile okundu. [İrsaliye: ${parsedShipment.invoice_no || '-'}]`,
          supplier_name: parsedShipment.supplier_name,
          is_external: parsedShipment.is_external,
        },
      };
    } else if (parsedJson?.analysis_type === 'document_purchase') {
      const isKg = (parsedJson.unit || '').toLowerCase() === 'kg';
      const qty = Number(parsedJson.quantity || 28000);
      const estTonnage = isKg ? Number((qty / 1000).toFixed(2)) : qty;

      actionDraft = {
        id: `draft-pur-${Date.now()}`,
        type: 'create_purchase',
        status: 'draft',
        title: 'Hammadde / Fiş Kabulü (Vision AI)',
        description: `${parsedJson.supplier_name || 'Tedarikçi'} firmasından ${qty.toLocaleString('tr-TR')} ${parsedJson.unit || 'kg'} ${parsedJson.material_name || 'Hammadde'} fişi okundu.`,
        createdAt: new Date().toISOString(),
        purchaseData: {
          supplier_name: parsedJson.supplier_name || 'Tedarikçi',
          invoice_no: parsedJson.invoice_no || `${Math.floor(10000 + Math.random() * 90000)}`,
          supplier_invoice_no: parsedJson.invoice_no || `${Math.floor(10000 + Math.random() * 90000)}`,
          vehicle_plate: parsedJson.vehicle_plate || '',
          driver_name: parsedJson.driver_name || '',
          material_name: parsedJson.material_name || 'CEM I 42.5 R Çimento',
          product_name: parsedJson.material_name || 'CEM I 42.5 R Çimento',
          material_type: parsedJson.material_category || 'cimento',
          quantity: qty,
          net_quantity: estTonnage,
          unit: parsedJson.unit || 'kg',
          notes: `Fotoğraf OCR (${usedModel}) ile okundu. [İrsaliye: ${parsedJson.invoice_no || '-'}]`,
        },
      };
    }

    return {
      textResponse: candidateText,
      description: candidateText,
      detectedType: parsedJson?.analysis_type === 'quality_defect' ? 'defect_inspection' : 'document_ocr',
      actionDraft,
      parsedShipment,
    };
  } catch (err: any) {
    console.error('analyzeImageWithVision hatası:', err);
    return {
      textResponse: `⚠️ **Görüntü Okuma Başarısız Oldu**\n\n${err?.message || 'Görsel işlenirken bir hata oluştu.'}\n\nLütfen fotoğrafın net, aydınlık ve yazılarının okunabilir olduğundan emin olup tekrar deneyiniz.`,
      description: `Görüntü okunamadı: ${err?.message}`,
      error: err?.message,
    };
  }
}
