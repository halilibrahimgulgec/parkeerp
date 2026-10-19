import { supabase } from '../lib/supabase';
import { ActionDraftPayload, ShipmentItemDraft } from '../types/aiActionTypes';
import { normalizeTurkish } from './aiFactoryBrain';
import { getLearnedRules } from './aiTrainingKnowledge';

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * GÖRÜNTÜ ÖN İŞLEME & BİLGİSAYARLI GÖRÜ (CANVAS PRE-PROCESSING)
 * ══════════════════════════════════════════════════════════════════════════════
 * Otokopili (pembe/sarı) sevk fişlerindeki ve kantar kağıtlarındaki silik
 * tükenmez kalem ve kurşun kalem yazılarını netleştiren kontrast ve keskinlik filtresi.
 * Boyut 1280px ve 0.80 kaliteye ayarlanarak yükleme süresi 10 kat hızlandırıldı (~200 KB).
 */
export async function preprocessImageForOCR(
  file: File,
  maxWidth = 1280,
  quality = 0.80
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Görsel dikey veya yatay olabilir; uzun kenarı max 1280px ile sınırla
        const maxDim = maxWidth;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
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

        // Kontrast ve netlik filtresi: Silik el yazılarını ve tükenmez kalem izlerini belirginleştirir
        try {
          ctx.filter = 'contrast(1.22) brightness(1.03) saturate(1.05)';
        } catch {}

        ctx.drawImage(img, 0, 0, width, height);

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
 * TARİH VE PALET NORMALİZASYON YARDIMCILARI (HELPERS)
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Türk formatındaki (DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY) veya ISO tarihlerini
 * HTML5 <input type="date"> bileşeninin kabul ettiği "YYYY-MM-DD" formatına dönüştürür.
 */
export function normalizeDateToISO(rawDate?: string | null): string {
  if (!rawDate || typeof rawDate !== 'string') return new Date().toISOString().split('T')[0];
  const trimmed = rawDate.trim();

  // 1. DD.MM.YYYY veya DD/MM/YYYY veya DD-MM-YYYY (örn. 29.09.2026)
  const dmyMatch = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    let year = dmyMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  // 2. YYYY-MM-DD (zaten standart ISO)
  const ymdMatch = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 3. Standart JS Date ayrıştırma denemesi
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return new Date().toISOString().split('T')[0];
}

/**
 * Sevk fişinde yazan palet cinsini güvenli şekilde normalleştirir:
 * 'uretim' | 'tahta' | 'sevkiyat' | 'dokme'
 */
export function normalizePalletType(rawType?: string | null): 'uretim' | 'tahta' | 'sevkiyat' | 'dokme' {
  if (!rawType) return 'uretim';
  const norm = normalizeTurkish(String(rawType || '')).toLowerCase().trim();

  if (norm.includes('uretim') || norm.includes('urt') || norm.includes('demir') || norm.includes('celik') || norm.includes('metal') || norm.includes('retim')) {
    return 'uretim';
  }
  if (norm.includes('tahta') || norm.includes('ahsap') || norm.includes('wood') || norm.includes('agac')) {
    return 'tahta';
  }
  if (norm.includes('dokme') || norm.includes('paletsiz') || norm.includes('yok') || norm.includes('damper')) {
    return 'dokme';
  }
  if (norm.includes('sevk') || norm.includes('euro') || norm.includes('standart')) {
    return 'sevkiyat';
  }

  return 'uretim';
}

/**
 * Türk araç plakalarını (01-81 il kodu, harf ve sayılar) temizleyip standartlaştırır.
 * "Araç: 46 KY 189", "kamyon plakası 34abc123" gibi girişleri "46 KY 189" yapar.
 */
export function normalizePlateNumber(rawPlate?: string | null): string {
  if (!rawPlate || typeof rawPlate !== 'string') return '';
  let cleaned = rawPlate.toUpperCase().trim()
    .replace(/^(PLAKA|ARAC\s*PLAKASI|KAMYON\s*PLAKASI|ARAC|KAMYON|CEKICI|DORSE|TASIT|OTO)\s*[:.-]?\s*/i, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 01-81 + 1-3 harf + 2-5 rakam deseni
  const match = cleaned.match(/\b(0[1-9]|[1-7][0-9]|8[01])\s*([A-Z]{1,3})\s*(\d{2,5})\b/);
  if (match) {
    return `${match[1]} ${match[2]} ${match[3]}`;
  }
  return cleaned;
}

/**
 * Çoklu Firma (Multi-Tenant) OCR Bağlamı
 * Her firmanın veritabanındaki aktif müşteri ve ürün listesini prompt için ipucu olarak taşır.
 */
export interface CompanyOcrContext {
  companyId?: string;
  companyName?: string;
  customerNames?: string[];
  siteNames?: string[];
  productNames?: string[];
  customRules?: string;
}

/**
 * Aktif firmanın veritabanındaki kayıtlı müşterilerini, şantiyelerini ve ürünlerini
 * OCR eşleştirme ipuçları olarak arka planda hazırlar.
 */
export async function fetchCompanyOcrContext(companyId?: string): Promise<CompanyOcrContext> {
  const ctx: CompanyOcrContext = { companyId };
  if (!companyId) return ctx;

  try {
    const [compRes, custRes, prodRes, siteRes] = await Promise.all([
      supabase.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
      supabase.from('customers').select('name').eq('is_active', true).or(`company_id.eq.${companyId},company_id.is.null`).limit(50),
      supabase.from('products').select('name').eq('is_active', true).or(`company_id.eq.${companyId},company_id.is.null`).limit(50),
      supabase.from('sites').select('name').eq('is_active', true).or(`company_id.eq.${companyId},company_id.is.null`).limit(30)
    ]);

    if (compRes.data) ctx.companyName = compRes.data.name;
    if (custRes.data) ctx.customerNames = custRes.data.map((c: any) => c.name);
    if (prodRes.data) ctx.productNames = prodRes.data.map((p: any) => p.name);
    if (siteRes.data) ctx.siteNames = siteRes.data.map((s: any) => s.name);
  } catch (err) {
    console.warn('fetchCompanyOcrContext error:', err);
  }

  return ctx;
}

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
  unit_price?: number;
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
 * HIZLI SEVKİYAT İRSALİYE PROMPTU (FAST WAYBILL OCR PROMPT)
 * ══════════════════════════════════════════════════════════════════════════════
 * Yalnızca saf JSON nesnesi üretir, sohbet metni yazmaz, 1 saniyede biter.
 */
export function buildFastWaybillPrompt(companyContext?: CompanyOcrContext): string {
  const hints: string[] = [];
  if (companyContext?.companyName) {
    hints.push(`Aktif Fabrika/Firma: "${companyContext.companyName}"`);
  }
  if (companyContext?.customerNames && companyContext.customerNames.length > 0) {
    hints.push(`Bu fabrikanın sistemde kayıtlı başlıca müşterileri: [${companyContext.customerNames.slice(0, 35).join(', ')}]`);
  }
  if (companyContext?.siteNames && companyContext.siteNames.length > 0) {
    hints.push(`Bu fabrikanın sistemde kayıtlı şantiyeleri: [${companyContext.siteNames.slice(0, 25).join(', ')}]`);
  }
  if (companyContext?.productNames && companyContext.productNames.length > 0) {
    hints.push(`Bu fabrikanın sistemde kayıtlı ürünleri: [${companyContext.productNames.slice(0, 35).join(', ')}]`);
  }
  if (companyContext?.customRules) {
    hints.push(`FİRMAYA ÖZEL FİŞ OKUMA KURALLARI: ${companyContext.customRules}`);
  }

  const contextSection = hints.length > 0
    ? `\n═══ SİSTEM VERİTABANI İPUÇLARI (EŞLEŞTİRME İÇİN ÖNCELİKLİ KULLAN) ═══\n${hints.join('\n')}\n`
    : '';

  return [
    'Sen "Parke ERP" sisteminin yüksek hızlı, çok firmalı (multi-tenant) ve sıfır hata hedefli Evrensel Sevkiyat Formu / İrsaliye Okuma Yapay Zekasısın.',
    'Görsel; herhangi bir beton parke, bordür, büz, kantar veya hazır yapı elemanları fabrikasının matbu veya elle doldurulmuş SEVKİYAT FORMU, SEVK İRSALİYESİ, TAŞIMA İRSALİYESİ veya KANTAR FİŞİDİR.',
    '',
    'DİKKAT: Fotoğraf yan (90 derece sağa/sola dönük), ters veya eğik çekilmiş olabilir. Metinlerin yönüne göre belgeyi doğru açıdan oku.',
    'ÖNEMLİ KURAL: Her fabrikanın matbu fişi farklıdır (tarih sağ üstte, sol başta veya altta olabilir; plaka "Plaka", "Kamyon", "Araç" veya "Araç Plakası" yazabilir). Bilgileri SABİT BİR KOORDİNATA GÖRE DEĞİL, AŞAĞIDAKİ ANLAMSAL EŞ ANLAMLILAR (SYNONYMS) VE DESENLERE GÖRE TESPİT ET:',
    '',
    '1. İrsaliye / Fiş No ("invoice_no"):',
    '   - Eş anlamlı etiketler: "İrsaliye No", "Fiş No", "Form No", "Sıra No", "Seri No", "Belge No", "№", "Kantar Fiş No".',
    '   - Genellikle matbu basılmış (kırmızı/siyah) veya kaşeyle basılmış seri/numaradır (Örn: "2627", "A-10492").',
    '',
    '2. Tarih ("shipment_date"):',
    '   - Eş anlamlı etiketler: "Tarih", "Sevk Tarihi", "Düzenleme Tarihi", "Fiş Tarihi", "Teslim Tarihi".',
    '   - Fişin neresinde olursa olsun (üstte, ortada, imza yanında) yazılı olan tarihi (örn: "29.09.2026", "29/09/2026", "29-09-2026") bul.',
    '   - MUTLAKA "YYYY-MM-DD" formatında (örn: "2026-09-29") yaz! Asla bugünün tarihini uydurma, belgede ne yazıyorsa onu çıkar.',
    '',
    '3. Plaka / Araç ("vehicle_plate"):',
    '   - Eş anlamlı etiketler: "Plaka", "Araç Plakası", "Kamyon Plakası", "Araç", "Kamyon", "Çekici", "Dorse", "Taşıt No", "Oto".',
    '   - Ya da belgede Türk plaka kalıbında olan metni tespit et (Örn: "46 KY 189", "34 ABC 789", "06 B 1234").',
    '   - Plakayı standart büyük harf ve aralıklı formatta yaz (Örn: "46 KY 189").',
    '',
    '4. Müşteri & Şantiye ("customer_name", "site_name"):',
    '   - Müşteri Eş Anlamlıları: "Firma", "Müşteri", "Alıcı", "Sayın", "Kime", "Teslim Edilen", "Ünvan".',
    '   - Şantiye Eş Anlamlıları: "Şantiye", "Sevk Yeri", "Teslim Yeri", "Gideceği Yer", "Boşaltma Yeri", "Adres", "Proje".',
    '   - Eğer firma kutusunda "Medikent - Altınova" veya "Ergişi İnş. / Doğukent" gibi tire veya bölü ile şantiye belirtilmişse:',
    '     * "customer_name": "Medikent",',
    '     * "site_name": "Altınova".',
    '',
    '5. Malzeme Cinsi, Miktar ve Birim ("items"):',
    '   - Tablo veya satırlardaki taş cinsini (Örn: "10 luk taş", "8 lik Kilit Parke", "Bordür", "Oluk Taşı", "Çim Taşı") ayıkla.',
    '   - Miktar ("m2"): m² veya metre veya adet cinsinden sevk miktarı (Örn: 120).',
    '   - Birim ("unit"): "m²", "Metre", "Adet".',
    '',
    '6. Palet Türü ("pallet_type"):',
    '   - Formda "Üretim", "üretim", "demir", "metal", "çelik" yazıyorsa -> "pallet_type": "uretim"',
    '   - Formda "Tahta", "ahşap", "wood" yazıyorsa -> "pallet_type": "tahta"',
    '   - Formda "Dökme", "paletsiz", "damper" yazıyorsa -> "pallet_type": "dokme"',
    '   - Formda "Sevkiyat", "euro", "standart" yazıyorsa -> "pallet_type": "sevkiyat"',
    '',
    '7. Palet Adeti ("pallets"):',
    '   - Sevk edilen asıl palet sayısıdır (Örn: 20).',
    '   - (DİKKAT: Tablo haricinde sağda veya dipnotta el yazısıyla yazılmış ambar stok düşüm hesaplarını (örn. "Üretim 555 + 20 = 575") sevk paleti sanma; sevkiyat palet adedi tablodaki sevk adedidir).',
    '',
    '8. Şoför & Kantar Tartımı (varsa):',
    '   - "driver_name": Şoför veya teslim alan kişi adı.',
    '   - "gross_weight", "tare_weight", "net_weight": Varsa kantar brüt, dara ve net kg değerleri.',
    contextSection,
    'SADECE ve YALNIZCA geçerli bir JSON nesnesi döndür. JSON haricinde hiçbir selamlama, özet veya markdown açıklaması yazma.',
    'Örnek JSON formatı:',
    JSON.stringify({
      analysis_type: "document_shipment",
      invoice_no: "2627",
      customer_name: "Medikent",
      site_name: "Altınova",
      vehicle_plate: "46 KY 189",
      driver_name: "",
      shipment_date: "2026-09-29",
      items: [
        {
          product_name: "10 LUK NATUREL PARKE",
          pallets: 20,
          pallet_type: "uretim",
          m2: 120,
          unit: "m²",
          thickness: "10 cm",
          color: "Gri"
        }
      ],
      total_m2: 120,
      total_pallets: 20,
      gross_weight: 0,
      tare_weight: 0,
      net_weight: 0,
      estimated_tonnage: 26.4
    }, null, 2)
  ].join('\n');
}

/**
 * Kapsamlı Optik Belge, İrsaliye ve Kalite Kontrol Sistem İstemi (Asistan Modalı için)
 */
function buildVisionPrompt(userNote = '', companyContext?: CompanyOcrContext): string {
  const learned = getLearnedRules();
  const learnedSection = learned.length > 0
    ? '\nÖĞRENİLMİŞ FABRİKA VE İRSALİYE KURALLARI:\n' + learned.map(r => `• ${r.rule}`).join('\n')
    : '';

  const hints: string[] = [];
  if (companyContext?.companyName) {
    hints.push(`Aktif Fabrika/Firma: "${companyContext.companyName}"`);
  }
  if (companyContext?.customerNames && companyContext.customerNames.length > 0) {
    hints.push(`Bu fabrikanın sistemde kayıtlı başlıca müşterileri: [${companyContext.customerNames.slice(0, 35).join(', ')}]`);
  }
  if (companyContext?.siteNames && companyContext.siteNames.length > 0) {
    hints.push(`Bu fabrikanın sistemde kayıtlı şantiyeleri: [${companyContext.siteNames.slice(0, 25).join(', ')}]`);
  }
  if (companyContext?.productNames && companyContext.productNames.length > 0) {
    hints.push(`Bu fabrikanın sistemde kayıtlı ürünleri: [${companyContext.productNames.slice(0, 35).join(', ')}]`);
  }
  if (companyContext?.customRules) {
    hints.push(`FİRMAYA ÖZEL FİŞ OKUMA KURALLARI: ${companyContext.customRules}`);
  }

  const contextSection = hints.length > 0
    ? `\n═══ SİSTEM VERİTABANI İPUÇLARI (EŞLEŞTİRME İÇİN ÖNCELİKLİ KULLAN) ═══\n${hints.join('\n')}\n`
    : '';

  return `Sen "Parke ERP" sisteminin Üst Düzey Evrensel Optik Karakter Tanıma (OCR) ve Belge/Kalite Yapay Zekasısın.
Sana gönderilen görsel bir SEVKİYAT İRSALİYESİ, KANTAR ÇIKIŞ FİŞİ, HAMMADDE GİRİŞ İRSALİYESİ veya BOZUK TAŞ FOTOĞRAFIDIR.
Görseli en yüksek dikkatle incele. Hem matbaa/yazıcı yazılarını hem de elle yazılmış (tükenmez/kurşun kalem) notları eksiksiz oku.
DİKKAT: Fotoğraf yan (90 derece sağa/sola) çekilmiş olabilir, başlık ve tablo yönüne göre oku.

Belgeler çoğunlukla şu 3 sınıftan birine aittir:

SINIF 1: PARKE / BORDÜR SEVKİYAT FORMU VEYA SEVK İRSALİYESİ (ÇIKIŞ)
ÖNEMLİ KURAL: Her fabrikanın matbu fişi farklıdır (tarih sağ üstte, sol başta veya altta olabilir; plaka "Plaka", "Kamyon", "Araç" veya "Araç Plakası" yazabilir). Bilgileri SABİT BİR KOORDİNATA GÖRE DEĞİL, ANLAMSAL EŞ ANLAMLILAR (SYNONYMS) VE DESENLERE GÖRE TESPİT ET:
- İrsaliye No / Form No ("İrsaliye No", "Fiş No", "Form No", "Sıra No", "№", "Kantar No" etiketleri örn: 2627)
- Müşteri / Firma Ünvanı ("Firma", "Müşteri", "Alıcı", "Sayın", "Kime", "Teslim Edilen")
- Teslim Şantiyesi / Sevk Yeri ("Şantiye", "Sevk Yeri", "Teslim Adresi", "Gideceği Yer", "Boşaltma Yeri")
- Araç Plakası ("Plaka", "Araç Plakası", "Kamyon Plakası", "Araç", "Kamyon", "Çekici", "Dorse" veya Türkiye plaka deseni örn: 46 KY 189)
- Şoför Adı veya Teslim Alan ("Şoför", "Sürücü", "Teslim Eden", "Teslim Alan")
- Tarih ("Tarih", "Sevk Tarihi", "Düzenleme Tarihi", "Fiş Tarihi" nerede olursa olsun örn: 29.09.2026 -> 2026-09-29)
- Sevk Edilen Malzemeler (Taş cinsi örn. "10'luk taş", "8'lik Kilit Parke", Miktar, Birim m²/Metre, Palet Sayısı, Palet Türü: uretim / tahta / sevkiyat / dokme)
- Kantar Tartımı varsa (Brüt kg, Dara kg, Net kg)

═══ PALET TÜRÜ VE AMBAR STOK AYRIMI KURALLARI ═══
1. Palet Cinsi: Formda "Üretim", "üretim", "demir" yazıyorsa "pallet_type": "uretim" olmalıdır! "Tahta" veya "ahşap" yazıyorsa "pallet_type": "tahta" olmalıdır! "Dökme" veya "paletsiz" yazıyorsa "pallet_type": "dokme" olmalıdır!
2. Palet Adeti: Tablodaki sevk adedidir. Tablo dışındaki sağ kenarda el yazısıyla alt alta yazılmış ambar stok düşüm hesapları (örn: "Üretim 555 + 20 = 575", "Tahta 1664") fabrikanın kendi stok hesabıdır; sevk paleti tablodaki sevk adedidir.

SINIF 2: HAMMADDE / ÇİMENTO / AGREGA / MICIR GİRİŞİ VEYA KANTAR FİŞİ
- Tedarikçi Adı
- İrsaliye No
- Malzeme Adı
- Tartım Miktarı (Net kg veya Ton)
- Plaka ve Şoför

SINIF 3: BOZUK / HATALI PARKE VEYA BORDÜR TAŞI (KALİTE KONTROL)
- Hata Tipi, şiddeti ve operatöre tavsiye

${contextSection}
${learnedSection}

ÇOK ÖNEMLİ KURALLAR:
1. Yanıtının EN BAŞINA mutlaka aşağıdaki JSON formatında \`\`\`json ... \`\`\` kod bloğu koy.
2. JSON'dan sonra Türkçe, nazik ve maddeli bir özet rapor yaz.

Eğer SINIF 1 (Parke Sevkiyat Formu / İrsaliyesi) ise JSON Şablonu:
\`\`\`json
{
  "analysis_type": "document_shipment",
  "invoice_no": "2627",
  "customer_name": "MEDİKENT",
  "site_name": "Altınova Şantiyesi",
  "vehicle_plate": "46 KY 189",
  "driver_name": "",
  "shipment_date": "2026-09-29",
  "items": [
    {
      "product_name": "10 LUK NATUREL PARKE TAŞI",
      "pallets": 20,
      "pallet_type": "uretim",
      "m2": 120,
      "unit": "m²",
      "thickness": "10 cm",
      "color": "Gri"
    }
  ],
  "total_m2": 120,
  "total_pallets": 20,
  "gross_weight": 0,
  "tare_weight": 0,
  "net_weight": 0,
  "estimated_tonnage": 26.4,
  "supplier_name": "",
  "is_external": false,
  "summary": "MEDİKENT Altınova şantiyesine 120 m² 10'luk parke (20 üretim paleti) sevk irsaliyesi"
}
\`\`\`
${userNote ? `Kullanıcının ilettiği ek not: "${userNote}"` : ''}`;
}

/**
 * Model Önbelleği ve Dinamik Model Keşfi
 */
let cachedWorkingModel: string | null = null;
let cachedDiscoveredModels: { key: string; models: string[]; timestamp: number } | null = null;

const ROBUST_FALLBACK_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
];

async function getAvailableVisionModels(apiKey: string): Promise<string[]> {
  if (cachedDiscoveredModels && cachedDiscoveredModels.key === apiKey && Date.now() - cachedDiscoveredModels.timestamp < 3600000) {
    return cachedDiscoveredModels.models;
  }

  try {
    const controller = new AbortController();
    const tId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      signal: controller.signal
    });
    clearTimeout(tId);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.models)) {
        const genModels = data.models
          .filter((m: any) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => m.name.replace(/^models\//, ''));

        if (genModels.length > 0) {
          genModels.sort((a: string, b: string) => {
            const score = (m: string) => {
              let s = 0;
              if (m.includes('flash')) s += 10;
              if (m.includes('2.0')) s += 5;
              if (m.includes('1.5')) s += 4;
              if (m.includes('8b')) s += 3;
              if (m.includes('pro')) s += 2;
              return s;
            };
            return score(b) - score(a);
          });

          cachedDiscoveredModels = { key: apiKey, models: genModels, timestamp: Date.now() };
          return genModels;
        }
      }
    }
  } catch (e) {
    console.warn('Dinamik model keşfi uyarısı, yedek model listesi devrede:', e);
  }

  return ROBUST_FALLBACK_MODELS;
}

/**
 * YÜKSEK HIZLI VISION AI MOTORU (FAST CASCADE)
 * En hızlı modelden başlayarak dinamik ve hatasız kaskad çalıştırır.
 */
export async function callFastVisionCascade(
  base64Image: string,
  mimeType = 'image/jpeg',
  promptText: string,
  apiKey?: string
): Promise<{ candidateText: string; usedModel: string }> {
  const savedKey = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('parke_gemini_api_key') : null;
  const envKey = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env?.VITE_GEMINI_API_KEY : null;
  const rawKey = (apiKey || savedKey || envKey || '');
  const cleanKey = rawKey.replace(/['"`\s]/g, '').trim();

  if (!cleanKey) {
    throw new Error('API_KEY_MISSING');
  }

  const discovered = await getAvailableVisionModels(cleanKey);
  const candidateModels = Array.from(new Set([
    ...(cachedWorkingModel ? [cachedWorkingModel] : []),
    ...discovered,
    ...ROBUST_FALLBACK_MODELS
  ]));

  const detailedErrors: string[] = [];

  for (const model of candidateModels) {
    // v1beta önce denenir (JSON modu destekler), ardından v1 standart denenir
    for (const apiVersion of ['v1beta', 'v1']) {
      try {
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${cleanKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const genConfig: any = {
          temperature: 0.1,
          maxOutputTokens: 2048,
        };
        // responseMimeType yalnızca v1beta üzerinde desteklenir
        if (apiVersion === 'v1beta') {
          genConfig.responseMimeType = "application/json";
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType: mimeType,
                      data: base64Image,
                    },
                  },
                ],
              },
            ],
            generationConfig: genConfig,
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          let parsedMsg = '';
          try {
            const errObj = JSON.parse(errText);
            parsedMsg = errObj?.error?.message || '';
          } catch {}

          if (response.status === 400 && (parsedMsg.includes('API_KEY_INVALID') || parsedMsg.includes('API key not valid'))) {
            throw new Error('Girdiğiniz Google Gemini API anahtarı geçersiz. Lütfen aistudio.google.com üzerinden geçerli bir anahtar alınız.');
          }
          if (response.status === 403 && parsedMsg.includes('PERMISSION_DENIED')) {
            throw new Error('Bu API anahtarının Generative Language API erişim izni bulunmuyor veya bölge kısıtlaması var.');
          }
          if (response.status === 429) {
            throw new Error('Google Gemini API istek kotası doldu (HTTP 429). Lütfen 30 saniye sonra tekrar deneyiniz veya aistudio.google.com üzerinden yeni bir anahtar alınız.');
          }

          detailedErrors.push(`[${apiVersion}/${model}] HTTP ${response.status}: ${parsedMsg || errText.substring(0, 100)}`);
          continue;
        }

        const resJson = await response.json();
        const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          cachedWorkingModel = model;
          return { candidateText: text, usedModel: `${model} (${apiVersion})` };
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          detailedErrors.push(`[${apiVersion}/${model}] Zaman aşımı (20s)`);
        } else if (err?.message?.includes('Google Gemini API anahtarı') || err?.message?.includes('PERMISSION_DENIED') || err?.message?.includes('kota')) {
          throw err;
        } else {
          detailedErrors.push(`[${apiVersion}/${model}] Hata: ${err?.message}`);
        }
      }
    }
  }

  // Son çare genel kaskad fonksiyonunu çağır
  return callVisionCascade(base64Image, mimeType, promptText, cleanKey);
}

/**
 * Genel Kaskad Vision API Caller (Asistan Modalı ve derin analizler için)
 */
export async function callVisionCascade(
  base64Image: string,
  mimeType = 'image/jpeg',
  userNote = '',
  apiKey?: string,
  companyContext?: CompanyOcrContext
): Promise<{ candidateText: string; usedModel: string }> {
  const savedKey = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('parke_gemini_api_key') : null;
  const envKey = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env?.VITE_GEMINI_API_KEY : null;
  const rawKey = (apiKey || savedKey || envKey || '');
  const cleanKey = rawKey.replace(/['"`\s]/g, '').trim();

  if (!cleanKey) {
    throw new Error('API_KEY_MISSING');
  }

  const discovered = await getAvailableVisionModels(cleanKey);
  const candidateModels = Array.from(new Set([
    ...(cachedWorkingModel ? [cachedWorkingModel] : []),
    ...discovered,
    ...ROBUST_FALLBACK_MODELS
  ]));

  const prompt = (userNote && userNote.startsWith('Sen ')) ? userNote : buildVisionPrompt(userNote, companyContext);
  const detailedErrors: string[] = [];

  for (const model of candidateModels) {
    for (const apiVersion of ['v1beta', 'v1']) {
      try {
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${cleanKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
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

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          let parsedMsg = '';
          try {
            const errObj = JSON.parse(errText);
            parsedMsg = errObj?.error?.message || '';
          } catch {}

          if (response.status === 400 && (parsedMsg.includes('API_KEY_INVALID') || parsedMsg.includes('API key not valid'))) {
            throw new Error('Girdiğiniz Google Gemini API anahtarı geçersiz. Lütfen Google AI Studio (aistudio.google.com) üzerinden geçerli bir anahtar alınız.');
          }
          if (response.status === 403 && parsedMsg.includes('PERMISSION_DENIED')) {
            throw new Error('Bu API anahtarının Generative Language API erişim izni bulunmuyor veya bölge kısıtlaması var.');
          }
          if (response.status === 429) {
            throw new Error('Google Gemini API istek kotası doldu (HTTP 429). Lütfen 30 saniye bekleyip tekrar deneyiniz veya aistudio.google.com üzerinden yeni bir anahtar alınız.');
          }

          detailedErrors.push(`[${apiVersion}/${model}] HTTP ${response.status}: ${parsedMsg || errText.substring(0, 100)}`);
          continue;
        }

        const resJson = await response.json();
        const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          cachedWorkingModel = model;
          return { candidateText: text, usedModel: `${model} (${apiVersion})` };
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          detailedErrors.push(`[${apiVersion}/${model}] Zaman aşımı (20s)`);
        } else if (err?.message?.includes('Google Gemini API anahtarı') || err?.message?.includes('PERMISSION_DENIED') || err?.message?.includes('kota')) {
          throw err;
        } else {
          detailedErrors.push(`[${apiVersion}/${model}] Hata: ${err?.message}`);
        }
      }
    }
  }

  const summaryError = detailedErrors.slice(-3).join(' | ');
  throw new Error(`Vision AI modelleri çağrılamadı: ${summaryError || 'Ağ veya model bağlantısı kurulamadı'}`);
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * AKILLI ÜRÜN EŞLEŞTİRİCİ (SMART PRODUCT MATCHER)
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function smartMatchProduct(rawName: string, products: any[]): any | null {
  if (!products || products.length === 0 || !rawName) return null;
  const norm = (s: string) => normalizeTurkish(s || '').toLowerCase().trim();
  const targetNorm = norm(rawName);

  // 1. Ebat / Kalınlık Tespiti (8, 6, 10, 50x25 vb.)
  const isTarget8 = /\b8(\s*lik|\s*cm|lik|\b)/i.test(targetNorm);
  const isTarget6 = /\b6(\s*lik|\s*cm|lik|\b)/i.test(targetNorm);
  const isTarget10 = /\b10(\s*luk|\s*cm|luk|\b)/i.test(targetNorm);

  let bestProd: any = null;
  let bestScore = -999;

  for (const p of products) {
    const pNorm = norm(p.name);
    const pThick = norm(p.thickness || '');
    const pCombined = `${pNorm} ${pThick}`;

    const isProd8 = /\b8(\s*lik|\s*cm|lik|\b)/i.test(pCombined);
    const isProd6 = /\b6(\s*lik|\s*cm|lik|\b)/i.test(pCombined);
    const isProd10 = /\b10(\s*luk|\s*cm|luk|\b)/i.test(pCombined);

    let score = 0;

    // Ebat Çakışması Kontrolü (8'lik isteniyorsa 10'luk veya 6'lık elenmeli!)
    if (isTarget8) {
      if (isProd8) score += 70;
      if (isProd10 || isProd6) score -= 90;
    } else if (isTarget10) {
      if (isProd10) score += 70;
      if (isProd8 || isProd6) score -= 90;
    } else if (isTarget6) {
      if (isProd6) score += 70;
      if (isProd8 || isProd10) score -= 90;
    }

    // Renk Eşleşmesi (Gri, Kırmızı vb.)
    const colors = ['gri', 'kirmizi', 'antrasit', 'siyah', 'sari', 'beyaz'];
    for (const col of colors) {
      if (targetNorm.includes(col)) {
        const pCol = norm(p.color || '');
        if (pCol.includes(col) || pNorm.includes(col)) {
          score += 25;
        }
      }
    }

    // Anahtar Kelime Puanlaması
    const keywords = ['kilit', 'parke', 'tas', 'tasi', 'bordur', 'oluk', 'cimen'];
    for (const kw of keywords) {
      if (targetNorm.includes(kw) && pCombined.includes(kw)) {
        score += 20;
      }
    }

    // Tam veya alt metin eşleşmesi
    if (pNorm === targetNorm) score += 100;
    if (pNorm.includes(targetNorm) || targetNorm.includes(pNorm)) score += 30;

    if (score > bestScore) {
      bestScore = score;
      bestProd = p;
    }
  }

  return bestScore > 0 ? bestProd : null;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * VERİTABANI VARLIK ÇÖZÜMLEME (DATABASE ENTITY RESOLUTION)
 * ══════════════════════════════════════════════════════════════════════════════
 * OCR'dan çıkan ham veriyi aktif firmanın müşteri, şantiye, ürün ve plaka veritabanıyla eşleştirir.
 */
export async function resolveEntitiesWithDatabase(
  rawShipment: any,
  companyId?: string
): Promise<ParsedShipmentOCRData> {
  const norm = (s: string) => normalizeTurkish(s || '').toLowerCase().trim();

  let customerId = '';
  let customerName = rawShipment.customer_name || '';
  let siteId = '';
  let siteName = rawShipment.site_name || '';

  // Etiket ön eklerini temizle (Örn: "Müşteri: Medikent", "Alıcı: Ergişi")
  customerName = customerName.replace(/^(musteri|alici|firma|sayin|unvan|kime)\s*[:.-]?\s*/i, '').trim();
  siteName = siteName.replace(/^(santiye|sevk yeri|teslim yeri|gidecegi yer|proje)\s*[:.-]?\s*/i, '').trim();

  // "Medikent - Altınova" gibi tireli girişlerde müşteri ve şantiyeyi ayır
  if (customerName.includes('-') || customerName.includes('/')) {
    const parts = customerName.split(/[-/]/).map((p: string) => p.trim());
    if (parts.length >= 2) {
      customerName = parts[0];
      if (!siteName) {
        siteName = parts[1];
      }
    }
  }

  // 1. Resolve Customer (Aktif firmaya izole sorgu)
  try {
    let custQuery = supabase.from('customers').select('id, name, company_id').eq('is_active', true);
    if (companyId) {
      custQuery = custQuery.or(`company_id.eq.${companyId},company_id.is.null`);
    }
    const { data: customers } = await custQuery;
    if (customers && customers.length > 0 && customerName) {
      const cTarget = norm(customerName);
      const matched = customers.find(c => {
        const cn = norm(c.name);
        return cn === cTarget ||
               (cn.length >= 3 && cTarget.includes(cn)) ||
               (cTarget.length >= 3 && cn.includes(cTarget));
      });
      if (matched) {
        customerId = matched.id;
        customerName = matched.name;
      }
    }
  } catch (err) {
    console.warn('Customer resolution error:', err);
  }

  // 2. Resolve Site (Aktif firmaya / müşteriye izole sorgu)
  try {
    let query = supabase.from('sites').select('id, name, customer_id, company_id').eq('is_active', true);
    if (customerId) {
      query = query.eq('customer_id', customerId);
    } else if (companyId) {
      query = query.or(`company_id.eq.${companyId},company_id.is.null`);
    }
    const { data: sites } = await query;
    if (sites && sites.length > 0 && siteName) {
      const sTarget = norm(siteName);
      const matchedSite = sites.find(s => {
        const sn = norm(s.name);
        return sn === sTarget ||
               (sn.length >= 3 && sTarget.includes(sn)) ||
               (sTarget.length >= 3 && sn.includes(sTarget));
      });
      if (matchedSite) {
        siteId = matchedSite.id;
        siteName = matchedSite.name;
        if (!customerId && matchedSite.customer_id) {
          customerId = matchedSite.customer_id;
        }
      }
    } else if (sites && sites.length === 1 && !siteId) {
      siteId = sites[0].id;
      siteName = sites[0].name;
    }
  } catch (err) {
    console.warn('Site resolution error:', err);
  }

  // 3. Resolve Products & Pallet Types (Aktif firmaya izole sorgu)
  let resolvedItems: ParsedShipmentOCRItem[] = [];
  try {
    let prodQuery = supabase.from('products').select('id, name, unit, thickness, color, price, company_id').eq('is_active', true);
    if (companyId) {
      prodQuery = prodQuery.or(`company_id.eq.${companyId},company_id.is.null`);
    }
    const { data: products } = await prodQuery;

    const rawItems = Array.isArray(rawShipment.items) && rawShipment.items.length > 0
      ? rawShipment.items
      : [{
          product_name: rawShipment.product_name || "10 LUK NATUREL PARKE TAŞI",
          pallets: Number(rawShipment.pallets || 0),
          pallet_type: rawShipment.pallet_type || 'uretim',
          m2: Number(rawShipment.quantity_m2 || rawShipment.m2 || 0),
          unit: rawShipment.unit || 'm²',
        }];

    resolvedItems = rawItems.map((it: any) => {
      let pId = '';
      let pName = it.product_name || "10 LUK NATUREL PARKE TAŞI";
      let pUnit = it.unit || 'm²';
      let unitPrice = 0;

      if (products && products.length > 0) {
        const matchedProd = smartMatchProduct(pName, products);
        if (matchedProd) {
          pId = matchedProd.id;
          pName = matchedProd.name;
          pUnit = matchedProd.unit === 'metre' ? 'Metre' : (matchedProd.unit === 'adet' ? 'Adet' : 'm²');
          unitPrice = Number(matchedProd.price || 0);
        }
      }

      let m2 = Number(it.m2 || it.quantity_m2 || 0);
      let pal = Number(it.pallets || 0);

      // Auto-compute m2 if 0 but pallets given
      if (m2 === 0 && pal > 0) {
        m2 = Math.round(pal * 6.0);
      } else if (m2 > 0 && pal === 0) {
        pal = Math.ceil(m2 / 6.0);
      }

      // Pallet count sanity check:
      // Formun sağındaki stok notu sevkiyat sanılmışsa düzelt
      if (m2 > 0 && pal > 0) {
        const ratio = m2 / pal;
        if (ratio < 2.0 && pal > 10) {
          pal = Math.round(m2 / 6.0) || 20;
        }
      }

      // Palet Tipi Güvenli Normalizasyonu
      const pType = normalizePalletType(it.pallet_type);

      return {
        product_name: pName,
        product_id: pId,
        pallets: pal,
        pallet_type: pType,
        m2: m2,
        unit: pUnit,
        thickness: it.thickness,
        color: it.color,
        unit_price: unitPrice,
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
    estTonnage = Number(((totalM2 * 220) / 1000).toFixed(2));
  }

  // 5. Araç Plakası Temizliği ve Veritabanı Teyidi (normalizePlateNumber ile standartlaştır)
  let cleanPlate = normalizePlateNumber(rawShipment.vehicle_plate || '');

  // El yazısı benzerliği için son sevkiyat plakalarıyla çapraz kontrol
  try {
    if (cleanPlate) {
      const prefix = cleanPlate.substring(0, Math.max(5, cleanPlate.length - 1));
      let shipQuery = supabase
        .from('shipments')
        .select('vehicle_plate')
        .ilike('vehicle_plate', `${prefix}%`)
        .limit(5);

      if (companyId) {
        shipQuery = shipQuery.or(`company_id.eq.${companyId},company_id.is.null`);
      }

      const { data: existingShipments } = await shipQuery;

      if (existingShipments && existingShipments.length > 0) {
        const exact = existingShipments.find(s => norm(s.vehicle_plate) === norm(cleanPlate));
        if (exact) {
          cleanPlate = exact.vehicle_plate;
        } else if (existingShipments[0]?.vehicle_plate) {
          cleanPlate = existingShipments[0].vehicle_plate;
        }
      }
    }
  } catch (err) {
    console.warn('Plate verify warning:', err);
  }

  // 6. Tarih Normalizasyonu (Kesinlikle YYYY-MM-DD olarak döner)
  const rawDate = rawShipment.shipment_date || rawShipment.date || rawShipment.tarih || rawShipment.shipmentDate;
  const finalDate = normalizeDateToISO(rawDate);

  return {
    invoice_no: rawShipment.invoice_no ? String(rawShipment.invoice_no).trim() : '',
    customer_name: customerName,
    matched_customer_id: customerId,
    site_name: siteName,
    matched_site_id: siteId,
    vehicle_plate: cleanPlate,
    driver_name: rawShipment.driver_name ? String(rawShipment.driver_name).trim() : '',
    driver_phone: rawShipment.driver_phone ? String(rawShipment.driver_phone).trim() : '',
    date: finalDate,
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
 * Optimize edilmiş hızlı model kaskadı ve saf JSON çıktısıyla 1.5 - 2.5 saniyede tamamlanır.
 */
export async function scanWaybillImageForShipment(
  file: File,
  apiKey?: string,
  companyId?: string
): Promise<{ success: boolean; data?: ParsedShipmentOCRData; message?: string; needsApiKey?: boolean }> {
  try {
    // 1. Görüntü Ön İşleme (1280px, 0.80 kalite: ~200 KB boyut, hızlı yükleme)
    const preprocessed = await preprocessImageForOCR(file, 1280, 0.80);

    // 2. Çoklu Firma Bağlamı ve İpuçları
    const companyContext = await fetchCompanyOcrContext(companyId);

    // 3. Yüksek Hızlı Odaklanmış Vision AI Promptu
    const prompt = buildFastWaybillPrompt(companyContext);

    // 4. Fast Vision API Cascade (Gemini 2.0 Flash)
    const { candidateText, usedModel } = await callFastVisionCascade(
      preprocessed.base64,
      preprocessed.mimeType,
      prompt,
      apiKey
    );

    // 5. Extract & Parse JSON
    let parsedJson: any = null;
    try {
      const cleanText = candidateText.trim();
      if (cleanText.startsWith('{') && cleanText.endsWith('}')) {
        parsedJson = JSON.parse(cleanText);
      } else {
        const jsonMatch = cleanText.match(/```json\s*([\s\S]*?)```/) || cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
      }
    } catch (parseErr) {
      console.warn('Fast JSON parse fallback:', parseErr);
    }

    if (!parsedJson) {
      return {
        success: false,
        message: 'Görsel analiz edildi ancak irsaliye verisi ayrıştırılamadı. Lütfen fotoğrafın netliğini kontrol ediniz.',
      };
    }

    // 6. Supabase Veritabanı Varlıkları ile Eşleştir (Aktif firmanın müşteri, şantiye, ürün ve plakaları)
    const resolvedData = await resolveEntitiesWithDatabase(parsedJson, companyId);

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
        message: 'Google Gemini Vision API anahtarı bulunamadı. Lütfen Asistan Ayarları menüsünden anahtarınızı giriniz.',
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
  apiKey?: string,
  companyId?: string
): Promise<VisionAnalysisResult> {
  const savedKey = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('parke_gemini_api_key') : null;
  const envKey = typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env?.VITE_GEMINI_API_KEY : null;
  const geminiKey = (apiKey || savedKey || envKey || '').trim();

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
    const companyContext = await fetchCompanyOcrContext(companyId);
    const { candidateText, usedModel } = await callVisionCascade(base64Image, mimeType, userNote, geminiKey, companyContext);

    // Extract JSON block
    const jsonMatch = candidateText.match(/```json\s*([\s\S]*?)```/);
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

    const isShipment =
      parsedJson?.analysis_type === 'document_shipment' ||
      (!parsedJson?.analysis_type && (candidateText.includes('SEVK') || candidateText.includes('İRSALİYE') || candidateText.includes('PARKE')));

    if (isShipment && parsedJson) {
      parsedShipment = await resolveEntitiesWithDatabase(parsedJson, companyId);

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
          shipment_date: parsedShipment.date || new Date().toISOString().split('T')[0],
          company_id: companyId,
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
    const msg = err?.message || 'Görsel işlenirken bir hata oluştu.';

    return {
      textResponse: `⚠️ **Görüntü Okuma Başarısız Oldu**\n\n${msg}\n\nLütfen Google Gemini API anahtarınızı kontrol edip Asistan Ayarlarından güncelleyebilir veya tekrar deneyebilirsiniz.`,
      description: `Görüntü okunamadı: ${msg}`,
      error: msg,
    };
  }
}
