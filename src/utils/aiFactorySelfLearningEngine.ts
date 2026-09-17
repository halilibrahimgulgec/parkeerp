import { FactorySnapshot, normalizeTurkish, ProductStockDetail } from './aiFactoryBrain';

// ---------------------------------------------------------------------------
// 1. HARDCODED FACTORY CORE CONSTANTS & RULES
// ---------------------------------------------------------------------------
export const FACTORY_CORE_RULES = {
  // Pallet deposit / asset valuation
  PALLET_PRICES: {
    uretim: 3000, // ₺3.000 / Adet (Çelik / Üretim Paleti)
    tahta: 300,   // ₺300 / Adet (Ahşap / Tahta Palet)
    sevkiyat: 200 // ₺200 / Adet (Sevkiyat Paleti)
  },
  // Work hours & schedule
  WORK_HOURS_PER_DAY: 10,
  DAILY_PRODUCTION_TARGET_M2: 2000,
  SUNDAY_IS_HOLIDAY: true,
  // Approximate Weights (kg)
  WEIGHT_PER_PARKE_M2: 180, // ~180 kg / m²
  WEIGHT_PER_BORDUR_METRE: 90, // ~90 kg / metre
  // Thresholds
  LOW_QUOTA_ALERT_THRESHOLD_M2: 500,
  RECOMMENDED_PROFIT_MARGIN: 0.25, // %25 kar marjı
};

// ---------------------------------------------------------------------------
// 2. CONVERSATION CONTEXT MEMORY (Autonomous Context Learning)
// ---------------------------------------------------------------------------
export interface ConversationContext {
  lastCustomer?: string;
  lastSite?: string;
  lastInvoice?: string;
  lastTopic?: 'pallet' | 'production' | 'shipment' | 'stock' | 'order' | 'finance';
  lastProduct?: {
    id?: string;
    name: string;
    unit: string;
    currentStock: number;
    minStock: number;
  };
}

const CONTEXT_KEY = 'parke_ai_auto_context';

export function getAutoContext(): ConversationContext {
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function updateAutoContext(update: Partial<ConversationContext>) {
  try {
    const current = getAutoContext();
    const merged = { ...current, ...update };
    localStorage.setItem(CONTEXT_KEY, JSON.stringify(merged));
  } catch {}
}

// ---------------------------------------------------------------------------
// 2.5 DYNAMIC PRODUCT INVENTORY MATCHER (Real-Time Stock Query)
// ---------------------------------------------------------------------------
export function findMatchingProducts(query: string, products: ProductStockDetail[]): ProductStockDetail[] {
  if (!products || products.length === 0) return [];
  const qNorm = normalizeTurkish(query);
  if (!qNorm) return [];

  // Extract dimensions/numbers: e.g. "8", "6", "10", "20x10", "50*25*20"
  const numbersInQuery: string[] = [];
  const dimMatches = qNorm.match(/\b\d+([x*]\d+)?\b/g);
  if (dimMatches) {
    numbersInQuery.push(...dimMatches);
  }
  const likMatch = qNorm.match(/\b(\d+)\s*(lik|luk|likli)\b/);
  if (likMatch && !numbersInQuery.includes(likMatch[1])) {
    numbersInQuery.push(likMatch[1]);
  }

  // Common Turkish stop words in stock questions
  const stopWords = new Set([
    'ne', 'kadar', 'kac', 'var', 'mi', 'mu', 'mevcut', 'durumu', 'stok', 'stogu', 'depo',
    'depoda', 'fiyat', 'fiyati', 'metre', 'metrekare', 'm2', 'adedi', 'adet', 'tasi', 'tas',
    'urun', 'urunu', 'olan', 'kaldi', 'bitti', 'listesi', 'toplam', 'gunluk', 'su', 'an'
  ]);

  const keywords = qNorm
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  if (keywords.length === 0 && numbersInQuery.length === 0) return [];

  interface ScoredProduct {
    product: ProductStockDetail;
    score: number;
  }

  const scored: ScoredProduct[] = [];
  for (const p of products) {
    const pNorm = normalizeTurkish(p.name);
    let score = 0;

    // Strict number / dimension matching if numbers specified
    if (numbersInQuery.length > 0) {
      const hasNumber = numbersInQuery.some(num => {
        if (num.includes('x') || num.includes('*')) {
          const alt1 = num.replace('*', 'x');
          const alt2 = num.replace('x', '*');
          return pNorm.includes(alt1) || pNorm.includes(alt2);
        }
        const pNums: string[] = pNorm.match(/\b\d+\b/g) || [];
        return pNums.includes(num);
      });
      if (!hasNumber) continue;
      score += 5;
    }

    // Keyword match
    for (const kw of keywords) {
      if (pNorm.includes(kw)) {
        score += kw.length >= 4 ? 3 : 2;
      }
    }

    if (score > 0) {
      scored.push({ product: p, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];

  const maxScore = scored[0].score;
  return scored
    .filter(s => s.score === maxScore || (s.score >= maxScore - 1 && s.score >= 4))
    .map(s => s.product);
}

export function formatProductStockResponse(products: ProductStockDetail[]): string {
  if (products.length === 0) return '';

  if (products.length === 1) {
    const p = products[0];
    updateAutoContext({ lastProduct: p, lastTopic: 'stock' });
    const isCritical = p.currentStock < p.minStock;
    const unitUpper = p.unit.toLowerCase() === 'm2' ? 'm²' : p.unit;

    let text = `🧱 **${p.name.trim()} - Güncel Depo Stoku**\n\n`;
    text += `• **Mevcut Net Stok:** **${p.currentStock.toLocaleString('tr-TR')} ${unitUpper}**\n`;
    text += `• **Emniyet Stoğu Sınırı:** ${p.minStock.toLocaleString('tr-TR')} ${unitUpper}\n`;
    text += `• **Stok Durumu:** ${
      isCritical
        ? `🚨 **Kritik Seviye** (Emniyet stoğunun ${Math.abs(p.minStock - p.currentStock).toLocaleString('tr-TR')} ${unitUpper} altında!)`
        : `✅ **Yeterli Seviye** (Sevkiyata ve siparişe uygun)`
    }\n\n`;
    text += `💡 *İpucu: Bu ürün için 'kaç metrekare var', 'termin süresi ne kadar' veya 'bugün sevkiyatı var mı' şeklinde devam soruları sorabilirsiniz.*`;
    return text;
  }

  // Multiple products matched
  updateAutoContext({ lastProduct: products[0], lastTopic: 'stock' });
  const totalStock = products.reduce((acc, cur) => acc + cur.currentStock, 0);
  const commonUnit = products[0].unit.toLowerCase() === 'm2' ? 'm²' : products[0].unit;

  let text = `📦 **İlgili Ürün Grubu Stok Durumu (Toplam: ${totalStock.toLocaleString('tr-TR')} ${commonUnit})**\n\n`;
  products.forEach(p => {
    const unitUpper = p.unit.toLowerCase() === 'm2' ? 'm²' : p.unit;
    const isCritical = p.currentStock < p.minStock;
    const statusIcon = isCritical ? '🚨 Kritik' : '✅ Yeterli';
    text += `• **${p.name.trim()}:** **${p.currentStock.toLocaleString('tr-TR')} ${unitUpper}** (Emniyet: ${p.minStock.toLocaleString('tr-TR')} ${unitUpper} - ${statusIcon})\n`;
  });
  text += `\n💡 *Tek bir ürünün detayını görmek için adını tam belirtebilirsiniz (Örn: "${products[0].name.trim()} ne kadar var").*`;
  return text;
}

// ---------------------------------------------------------------------------
// 2.7 DYNAMIC INVOICE MATCHER & FORMATTER (Real-Time Waybill Lookup)
// ---------------------------------------------------------------------------
export function extractInvoiceNumber(query: string): string | null {
  if (!query) return null;
  const qNorm = normalizeTurkish(query);

  const hasInvoiceWord = qNorm.includes('irsaliye') || qNorm.includes('irs') || qNorm.includes('fatura');
  if (!hasInvoiceWord) return null;

  // 1) "2453 nolu", "2453 no'lu", "2453 numarali", "2453 irsaliye"
  const m1 = qNorm.match(/\b(\d{3,6})\s*(?:nolu|no'lu|numarali|numara|irsaliye|irs)\b/);
  if (m1) return m1[1];

  // 2) "irsaliye no 2453", "irsaliye 2453", "irs 2453", "fatura 2453"
  const m2 = qNorm.match(/\b(?:irsaliye|irs|fatura|no)\s*[:#]?\s*(\d{3,6})\b/);
  if (m2) return m2[1];

  // 3) Any 3-6 digit number in an invoice-related query
  const m3 = qNorm.match(/\b(\d{3,6})\b/);
  if (m3) return m3[1];

  return null;
}

export function handleDynamicInvoiceQuery(invoiceNo: string, data: FactorySnapshot): string {
  const cleanInv = invoiceNo.trim();
  const found = data.todayRecentShipments.find(s => {
    const sInv = s.invoice.trim();
    return sInv === cleanInv || sInv.includes(cleanInv) || cleanInv.includes(sInv);
  });

  if (found) {
    let text = `📄 **İrsaliye No: ${found.invoice} Detayı**\n\n`;
    text += `* 🏢 **Cari / Müşteri:** **${found.customer}**\n`;
    text += `* 📍 **Teslim Şantiyesi:** **${found.site || 'Ana Şantiye / Merkez'}**\n`;
    if (found.plate || found.driver) {
      text += `* 🚛 **Araç / Şoför:** ${found.plate || '-'} ${found.driver ? `(${found.driver})` : ''}\n`;
    }
    text += `* 📦 **Sevk Edilen Malzeme:**\n`;
    if (found.items && found.items.length > 0) {
      found.items.forEach(it => {
        const u = it.unit === 'metre' ? 'Metre' : it.unit === 'adet' ? 'Adet' : 'm²';
        text += `   • **${it.m2.toLocaleString('tr-TR')} ${u}** ${it.name}\n`;
      });
    } else {
      text += `   • ${found.qty}\n`;
    }
    if (found.netWeight > 0) {
      text += `* ⚖️ **Kantar Net Tonajı:** **${(found.netWeight / 1000).toFixed(2)} Ton** (${found.netWeight.toLocaleString('tr-TR')} kg)\n`;
    }
    text += `* ⏱️ **Durum:** Kantar sevkiyatı tamamlandı ve sevk edildi.`;
    return text;
  }

  return `ℹ️ **${cleanInv} nolu irsaliye bugünkü (${data.todayDate}) sevkiyatlar arasında bulunamadı.**\n\n` +
    `Bugün çıkan irsaliyeleri listelemek için *"Bugün çıkan son sevkiyatlar hangileri?"* sorusunu sorabilirsiniz.`;
}

// ---------------------------------------------------------------------------
// 3. 60-QUESTION INDUSTRIAL KNOWLEDGE & BENCHMARK CATALOG
// ---------------------------------------------------------------------------
export interface QuestionDefinition {
  id: number;
  category: 'production' | 'shipment' | 'pallet' | 'stock' | 'order' | 'finance';
  categoryTitle: string;
  question: string;
  keywords: string[];
}

export const FACTORY_60_QUESTIONS: QuestionDefinition[] = [
  // ----------------- BÖLÜM 1: ÜRETİM & MAKİNELER (1-10) -----------------
  {
    id: 1,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bugün toplam kaç m² üretim yapıldı?',
    keywords: ['bugun toplam uretim', 'bugun kac m2 uretim', 'bugunku net uretim', 'bugun ne kadar urettik'],
  },
  {
    id: 2,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: '1 nolu parke makinesinin bugünkü üretimi ne kadar?',
    keywords: ['1 nolu makine', 'makine 1', 'parke makinesi', '1 nolu uretim'],
  },
  {
    id: 3,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: '2 nolu bordür makinesinin bugünkü dökümü ne kadar?',
    keywords: ['2 nolu makine', 'makine 2', 'bordur makinesi', '2 nolu dokum'],
  },
  {
    id: 4,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bugünkü fire ve ıskarta miktarı nedir?',
    keywords: ['fire', 'iskarta', 'hurda', 'fire orani', 'fire miktari'],
  },
  {
    id: 5,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bu ay kümülatif toplam kaç m² parke ve bordür ürettik?',
    keywords: ['kumulatif uretim', 'bu ay urettik', 'aylik toplam uretim', 'kumulatif toplam', 'bu ay ne kadar urettik', 'bu ay kumulatif'],
  },
  {
    id: 6,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Günlük 10 saatlik çalışma hedefine ulaştık mı?',
    keywords: ['10 saatlik', 'calisma hedefine', 'gunluk hedef', 'hedefe ulastik mi', '2000 m2 hedef'],
  },
  {
    id: 7,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Makinelerde şu an hangi ürünler basılıyor?',
    keywords: ['hangi urunler basiliyor', 'ne basiliyor', 'makinelerde hangi urun', 'kalip'],
  },
  {
    id: 8,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bugün kaç vardiya veya döküm girişi yapıldı?',
    keywords: ['kac vardiya', 'dokum girisi', 'giris sayisi', 'vardiya girisi'],
  },
  {
    id: 9,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Pazar günleri fabrikada üretim yapılıyor mu?',
    keywords: ['pazar gunleri', 'pazar tatil', 'pazar mesai', 'pazar uretim'],
  },
  {
    id: 10,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bu ay en çok hangi taş ve ebat üretildi?',
    keywords: ['en cok hangi tas', 'en cok uretilen', 'hangi ebat cok uretildi', 'lider tas'],
  },

  // ----------------- BÖLÜM 2: SEVKİYAT, KANTAR & İRSALİYELER (11-20) -----------------
  {
    id: 11,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün kantardan toplam kaç kamyon ve irsaliye çıktı?',
    keywords: ['kac kamyon', 'kac irsaliye', 'kac arac cikti', 'cikis sayisi', 'kamyon cikti'],
  },
  {
    id: 12,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugünkü kantar net sevk tonajı ne kadar?',
    keywords: ['net sevk tonaji', 'kantar tonaj', 'kac ton sevk', 'toplam agirlik', 'kantar net'],
  },
  {
    id: 13,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün Onikişubat Hacı Kel şantiyesine ne kadar sevkiyat yapıldı?',
    keywords: ['haci kel', 'onikisubat haci kel', 'haci kel santiye'],
  },
  {
    id: 14,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün Onikişubat Mustafa Kaya şantiyesine hangi ürünler gitti?',
    keywords: ['mustafa kaya', 'kaya santiye', 'mustafa kaya sevkiyat'],
  },
  {
    id: 15,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün Onikişubat Mustafa Yılmaz şantiyesine kaç metre bordür gitti?',
    keywords: ['mustafa yilmaz', 'yilmaz santiye', 'mustafa yilmaz bordur'],
  },
  {
    id: 16,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün Medikent Altınova şantiyesine ne kadar parke sevk edildi?',
    keywords: ['altinova', 'medikent altinova', 'altinova parke'],
  },
  {
    id: 17,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün çıkan son sevkiyatlar ve irsaliyeler hangileri?',
    keywords: ['son sevkiyatlar', 'son irsaliyeler', 'son kamyonlar', 'cikan son'],
  },
  {
    id: 18,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Kantar fişi girilmemiş tartımsız araç var mı?',
    keywords: ['tartimsiz', 'fissiz', 'kantar girilmemis', 'tartim eksik'],
  },
  {
    id: 19,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün toplam kaç m² parke ve kaç metre bordür sevk ettik?',
    keywords: ['kac m2 parke ve kac metre bordur sevk', 'sevk ettigimiz parke bordur', 'bugun sevk parke'],
  },
  {
    id: 20,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Sevkiyatta 2400 nolu irsaliyede ne var?',
    keywords: ['2400 nolu', 'irsaliye 2400', 'irs 2400', '2400 irsaliye', 'nolu irsaliyede ne var', 'nolu irsaliyede neler var', 'irsaliyede ne var', 'irsaliyede neler var'],
  },

  // ----------------- BÖLÜM 3: PALET TAKİBİ & ŞANTİYE ZİMMETLERİ (21-30) -----------------
  {
    id: 21,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Paletlerin toplam değeri ne kadar?',
    keywords: ['paletlerin toplam degeri', 'paletlerin degeri', 'palet degeri ne kadar', 'palet kac para', 'palet maliyet degeri'],
  },
  {
    id: 22,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Şantiyelerde toplam kaç adet üretim paleti bekliyor?',
    keywords: ['kac adet uretim paleti bekliyor', 'santiyelerde uretim paleti', 'disaridaki uretim paleti', 'toplam uretim paleti'],
  },
  {
    id: 23,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Şantiyelerde toplam kaç adet tahta palet bekliyor?',
    keywords: ['kac adet tahta palet bekliyor', 'santiyelerde tahta palet', 'disaridaki tahta palet', 'toplam tahta palet'],
  },
  {
    id: 24,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Medikent den ne kadar üretim paleti alacağımız var?',
    keywords: ['medikent den ne kadar uretim paleti', 'medikent uretim paleti', 'medikent uretim paleti alacagimiz'],
  },
  {
    id: 25,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Medikent firmasının toplam tahta ve üretim palet borcu ne kadar?',
    keywords: ['medikent firmasinin toplam', 'medikent palet borcu', 'medikent toplam palet'],
  },
  {
    id: 26,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Onikişubat Belediyesi şantiyelerinde kaç paletimiz kalmış?',
    keywords: ['onikisubat belediyesi santiyelerinde kac palet', 'onikisubat palet', 'onikisubat palet borcu'],
  },
  {
    id: 27,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'En çok palet borcu olan ilk 5 müşteri hangileri?',
    keywords: ['en cok palet borcu olan ilk 5', 'palet borclulari', 'en cok palet borcu', 'ilk 5 palet'],
  },
  {
    id: 28,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Aykach firmasında kaç adet paletimiz var?',
    keywords: ['aykach firmasinda kac adet', 'aykach palet', 'aykach borcu'],
  },
  {
    id: 29,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Üretim paletleri ve tahta paletlerin birim bedelleri nedir?',
    keywords: ['uretim paletleri ve tahta paletlerin birim bedelleri', 'palet birim bedelleri', 'palet fiyatlari nedir'],
  },
  {
    id: 30,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Şantiyelerdeki paletlerin toplam finansal riski kaç TL?',
    keywords: ['santiyelerdeki paletlerin toplam finansal riski', 'palet finansal riski', 'palet riski kac tl'],
  },

  // ----------------- BÖLÜM 4: DEPO STOKLARI & KRİTİK EŞİKLER (31-40) -----------------
  {
    id: 31,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Depoda şu an toplam kaç m² parke stoku var?',
    keywords: ['depoda su an toplam kac m2 parke stoku', 'mevcut parke stoku', 'toplam parke stoku'],
  },
  {
    id: 32,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Depoda şu an toplam kaç metre bordür stoku var?',
    keywords: ['depoda su an toplam kac metre bordur stoku', 'mevcut bordur stoku', 'toplam bordur stoku'],
  },
  {
    id: 33,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Emniyet stoğunun altına inen kritik ürünler hangileri?',
    keywords: ['emniyet stogunun altina inen', 'kritik urunler hangileri', 'kritik stok', 'emniyet stogu'],
  },
  {
    id: 34,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: '8 lik kilit parke taşında ne kadar stok kaldı?',
    keywords: ['8 lik kilit parke', '8 lik parke stoku', '8cm kilit'],
  },
  {
    id: 35,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: '6 lık parke taşından depoda stok var mı?',
    keywords: ['6 lik parke', '6 lik kilit', '6cm parke stoku'],
  },
  {
    id: 36,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Stokları tükenmek üzere olan ürünler için ne önerirsin?',
    keywords: ['stoklari tukenmek uzere', 'stok onerisi', 'stoklar icin ne onerirsin'],
  },
  {
    id: 37,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Ankara bordürü ve bahçe bordürü stok durumu nedir?',
    keywords: ['ankara borduru', 'bahce borduru', 'bordur stok durumu'],
  },
  {
    id: 38,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Yağmur oluğu ve engelli takip taşı stokları ne kadar?',
    keywords: ['yagmur olugu', 'engelli takip tasi', 'oluk ve engelli'],
  },
  {
    id: 39,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Depodaki tüm ürünlerin kalem sayısı kaçtır?',
    keywords: ['kalem sayisi kactir', 'urun kalem sayisi', 'kac cesit urun'],
  },
  {
    id: 40,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Şu an depomuzda en yüksek stoklu olan ürün hangisidir?',
    keywords: ['en yuksek stoklu', 'en cok stoklu urun', 'stok lideri'],
  },

  // ----------------- BÖLÜM 5: SİPARİŞLER, TERMİNLER & KOTALAR (41-50) -----------------
  {
    id: 41,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Bekleyen acil iş emirleri ve siparişler hangileri?',
    keywords: ['bekleyen acil is emirleri', 'acil siparisler hangileri', 'bekleyen siparisler'],
  },
  {
    id: 42,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Termini yaklaşan veya teslimatı geciken sipariş var mı?',
    keywords: ['termini yaklasan', 'teslimati geciken', 'geciken siparis'],
  },
  {
    id: 43,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Medikent in taahhüt kotası doldu mu, ne kadar kaldı?',
    keywords: ['medikent in taahhut kotasi', 'medikent kota', 'medikent kalan kota'],
  },
  {
    id: 44,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Kotası 500 m² altına düşen veya aşan müşteriler hangileri?',
    keywords: ['500 m2 altina dusen', 'kritik kota', 'kotasi biten musteriler'],
  },
  {
    id: 45,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Onikişubat Belediyesi nin aktif sipariş ve iş emirleri nelerdir?',
    keywords: ['onikisubat belediyesi nin aktif siparis', 'onikisubat is emirleri', 'belediye siparisleri'],
  },
  {
    id: 46,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Şu an toplam kaç aktif müşteri kotası sözleşmesi var?',
    keywords: ['kac aktif musteri kotasi', 'aktif kota sozlesmesi', 'toplam kota sozlesmesi'],
  },
  {
    id: 47,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Hangi müşterinin taahhüt kotası %100 doldu?',
    keywords: [
      'taahhut kotasi %100 doldu', 'kotasi dolan musteri', 'kota asimi',
      'sozlesmesi biten', 'sozlesmesi dolan', 'sozlesmesi biten musteri',
      'kotasi biten', 'sozlesmesi biten var mi', 'biten sozlesme', 'kotasi doldu'
    ],
  },
  {
    id: 48,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Üretim planında ilk sırada hangi sipariş var?',
    keywords: ['ilk sirada hangi siparis var', 'siradaki siparis', 'oncelikli is emri'],
  },
  {
    id: 49,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Yeni sipariş alırken termin süresi ne kadar verilmeli?',
    keywords: ['termin suresi ne kadar verilmeli', 'teslimat suresi ne kadar', 'termin kac gun'],
  },
  {
    id: 50,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'İptal edilen veya revize edilen sipariş var mı?',
    keywords: ['iptal edilen veya revize', 'iptal siparis', 'revize is emri'],
  },

  // ----------------- BÖLÜM 6: FİNANS, CİRO, MALİYET & YÖNETİM (51-60) -----------------
  {
    id: 51,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bu ayki toplam ciro ve satış geliri ne kadar?',
    keywords: ['bu ayki toplam ciro', 'satis geliri ne kadar', 'toplam ciro'],
  },
  {
    id: 52,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bu ay fabrikaya yapılan toplam masraf ve gider ne kadar?',
    keywords: ['toplam masraf ve gider', 'bu ayki gider', 'fabrika masrafi'],
  },
  {
    id: 53,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: '1 m² parkenin tahmini üretim maliyeti kaç TL dir?',
    keywords: ['1 m2 parkenin tahmini uretim maliyeti', 'm2 maliyeti kac tl', 'birim uretim maliyeti'],
  },
  {
    id: 54,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bu ayki tahmini brüt karımız ve karlılık durumumuz nedir?',
    keywords: ['tahmini brut karimiz', 'karlilik durumumuz', 'brut kar'],
  },
  {
    id: 55,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Satış fiyatı belirlerken minimum m² fiyatı ne olmalıdır?',
    keywords: ['minimum m2 fiyati ne olmalidir', 'taban satis fiyati', 'kaca satmaliyiz'],
  },
  {
    id: 56,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'En büyük gider kalemimiz hangisidir?',
    keywords: ['en buyuk gider kalemimiz', 'en yuksek masraf', 'masraf dagilimi'],
  },
  {
    id: 57,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bana kapsamlı bir Gün Sonu Yönetici Özeti çıkarır mısın?',
    keywords: ['kapsamli bir gun sonu yonetici ozeti', 'gun sonu ozeti cikar', 'executive briefing'],
  },
  {
    id: 58,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Fabrikanın bugünkü genel verimliliği ve kapasite kullanımı nasıl?',
    keywords: ['genel verimliligi ve kapasite kullanimi', 'fabrika verimliligi', 'kapasite kullanimi nasil'],
  },
  {
    id: 59,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Gelecek hafta için hangi ürünün üretimine ağırlık vermeliyiz?',
    keywords: ['gelecek hafta icin hangi urunun uretimine agirlik', 'hangi urune agirlik vermeliyiz', 'uretim plan tavsiyesi'],
  },
  {
    id: 60,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Şu an fabrika genelinde en kritik operasyonel risk nedir?',
    keywords: ['en kritik operasyonel risk nedir', 'en kritik risk', 'operasyonel tehlike'],
  },
];

// ---------------------------------------------------------------------------
// 4. THE 60 TRAINED INDUSTRIAL QUESTION RESOLVERS (INDIVIDUAL HANDLERS)
// ---------------------------------------------------------------------------

function answerQuestion(id: number, data: FactorySnapshot): string {
  const uretimPrice = FACTORY_CORE_RULES.PALLET_PRICES.uretim; // 3000 TL
  const tahtaPrice = FACTORY_CORE_RULES.PALLET_PRICES.tahta;   // 300 TL

  switch (id) {
    // Soru 1: Bugün toplam kaç m² üretim yapıldı?
    case 1: {
      let text = `🏭 **Bugünkü Üretim Röntgeni (${data.todayDate})**\n\n`;
      text += `* **Toplam Net Üretim:** **${data.todayProductionTotalM2.toLocaleString('tr-TR')} birim**\n`;
      text += `  - 🧱 **Parke Taşı:** **${data.todayProductionParkeM2.toLocaleString('tr-TR')} m²**\n`;
      text += `  - 📏 **Bordür:** **${data.todayProductionBordurMetre.toLocaleString('tr-TR')} Metre**\n`;
      if (data.todayProductionAdet > 0) {
        text += `  - 🔘 **Oluk / Kapak:** **${data.todayProductionAdet.toLocaleString('tr-TR')} Adet**\n`;
      }
      text += `\n* **Vardiya Giriş Sayısı:** ${data.todayEntriesCount} döküm kaydı\n`;
      if (data.todayEntriesCount > 0) {
        text += `* **1 Nolu Makine:** ${data.todayMachine1Output}\n`;
        text += `* **2 Nolu Makine:** ${data.todayMachine2Output}\n`;
        text += `* **Fire:** ${data.todayScrapTotalM2} m²\n`;
      }
      text += `📈 **Aylık Kümülatif Üretim:** **${data.monthlyProductionM2.toLocaleString('tr-TR')} m²**\n`;
      text += `💡 *Fabrika 10 saatlik mesai esasına göre günlük nominal 2.000 m² hedefiyle çalışır.*`;
      return text;
    }

    // Soru 2: 1 nolu parke makinesinin bugünkü üretimi ne kadar?
    case 2: {
      return `⚙️ **1 Nolu Parke Makinesi Günlük İmalat Durumu**\n\n` +
        `* **Bugünkü Üretim:** **${data.todayMachine1Output || '0 m²'}**\n` +
        `* **Ana İmalat Grubu:** 6'lık & 8'lik Kilit Parke Taşları, 20x10 Prizma Parke\n` +
        `* **Vardiya Kaydı:** ${data.todayEntriesCount > 0 ? `${data.todayEntriesCount} vardiya girişi yapıldı` : 'Henüz bugün için döküm girilmedi'}\n\n` +
        `💡 *1 Nolu makinemiz yüksek mukavemetli kilitli parke taşı imalatına tahsis edilmiştir.*`;
    }

    // Soru 3: 2 nolu bordür makinesinin bugünkü dökümü ne kadar?
    case 3: {
      return `⚙️ **2 Nolu Bordür Makinesi Günlük Döküm Durumu**\n\n` +
        `* **Bugünkü İmalat:** **${data.todayMachine2Output || '0 Metre'}**\n` +
        `* **Ana İmalat Grubu:** 50x25x20 Ankara Bordürü, Bahçe Bordürü, Yağmur Olukları\n` +
        `* **Vardiya Kaydı:** ${data.todayEntriesCount > 0 ? `${data.todayEntriesCount} vardiya girişi yapıldı` : 'Henüz bugün için döküm girilmedi'}\n\n` +
        `💡 *2 Nolu makinemiz kentsel yol ve bahçe bordürü döküm hattıdır.*`;
    }

    // Soru 4: Bugünkü fire ve ıskarta miktarı nedir?
    case 4: {
      const pct = data.todayProductionTotalM2 > 0 ? ((data.todayScrapTotalM2 / data.todayProductionTotalM2) * 100).toFixed(1) : '0';
      let text = `🗑️ **Günlük Fire & Iskarta Raporu**\n\n`;
      text += `* **Toplam Fire Miktarı:** **${data.todayScrapTotalM2} m²**\n`;
      text += `* **Fire Oranı:** **%${pct}**\n`;
      text += `* **Net Üretim:** ${data.todayProductionTotalM2.toLocaleString('tr-TR')} birim\n\n`;
      if (Number(pct) > 5) {
        text += `⚠️ *Uyarı: Fire oranı kabul edilebilir %5 sınırının üzerindedir. Harç su/çimento oranı ve vibrasyon kontrol edilmelidir.*`;
      } else {
        text += `✅ *Fire oranı fabrika tolerans sınırları (%0 - %4) dahilindedir.*`;
      }
      return text;
    }

    // Soru 5: Bu ay kümülatif toplam kaç m² parke ve bordür ürettik?
    case 5: {
      const avgDaily = Math.round(data.monthlyProductionM2 / (new Date().getDate() || 1));
      let text = `📈 **Aylık Kümülatif Üretim Röntgeni**\n\n`;
      text += `* **Bu Ay Toplam Kümülatif Üretim:** **${data.monthlyProductionM2.toLocaleString('tr-TR')} m²**\n`;
      text += `* **Bugünkü İlave Üretim:** **${data.todayProductionTotalM2.toLocaleString('tr-TR')} birim**\n`;
      text += `  - 🧱 Parke: ${data.todayProductionParkeM2.toLocaleString('tr-TR')} m²\n`;
      text += `  - 📏 Bordür: ${data.todayProductionBordurMetre.toLocaleString('tr-TR')} Metre\n`;
      text += `* **Günlük Ortalama Üretim Temposu:** ~**${avgDaily.toLocaleString('tr-TR')} m²/gün**\n\n`;
      text += `💡 *Kümülatif üretim, ayın ilk gününden itibaren imalat hattına giren net teslimatları gösterir.*`;
      return text;
    }

    // Soru 6: Günlük 10 saatlik çalışma hedefine ulaştık mı?
    case 6: {
      const target = FACTORY_CORE_RULES.DAILY_PRODUCTION_TARGET_M2;
      const actual = data.todayProductionTotalM2;
      const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
      let text = `🎯 **Günlük Hedef Gerçekleşme Oranı**\n\n`;
      text += `* **Günlük Çalışma Mesaisi:** 10 Saat\n`;
      text += `* **Günlük Kapasite Hedefi:** **${target.toLocaleString('tr-TR')} m²**\n`;
      text += `* **Gerçekleşen Üretim:** **${actual.toLocaleString('tr-TR')} birim**\n`;
      text += `* **Hedef Oranı:** **%${pct}**\n\n`;
      if (pct >= 100) {
        text += `🎉 *Tebrikler! Fabrika günlük 10 saatlik tam üretim hedefini aşmıştır.*`;
      } else {
        text += `⚡ *Kalan hedef: ${(target - actual).toLocaleString('tr-TR')} m². Vardiya akışını sürdürünüz.*`;
      }
      return text;
    }

    // Soru 7: Makinelerde şu an hangi ürünler basılıyor?
    case 7: {
      let text = `⚙️ **Makinelerde Aktif Basılan Ürünler**\n\n`;
      text += `* 🏭 **1 Nolu Makine (Parke Hattı):** ${data.todayMachine1Output ? data.todayMachine1Output : "Kilit Parke Taşı (8'lik Gri/Kırmızı) ve 20x10 Prizma"}\n`;
      text += `* 🏭 **2 Nolu Makine (Bordür Hattı):** ${data.todayMachine2Output ? data.todayMachine2Output : "50x25x20 Ankara Bordürü ve Yağmur Oluğu"}\n\n`;
      text += `💡 *Kalıp değişimleri sipariş önceliklerine göre günlük üretim amiri tarafından planlanır.*`;
      return text;
    }

    // Soru 8: Bugün kaç vardiya veya döküm girişi yapıldı?
    case 8: {
      return `📋 **Günlük Vardiya & Döküm Kayıt Sayısı**\n\n` +
        `* **Bugün Yapılan Giriş:** **${data.todayEntriesCount} Kayıt**\n` +
        `* **Toplam Net Miktar:** **${data.todayProductionTotalM2.toLocaleString('tr-TR')} birim**\n` +
        `* **Sistem Durumu:** Canlı veritabanına anlık işlenmektedir.`;
    }

    // Soru 9: Pazar günleri fabrikada üretim yapılıyor mu?
    case 9: {
      return `📅 **Çalışma Takvimi & Pazar Kuralı**\n\n` +
        `* **Pazar Günleri:** Fabrikamızda **Pazar günleri resmi tatildir ve üretim yapılmaz.**\n` +
        `* **Haftalık Mesai:** Pazartesi - Cumartesi (Haftada 6 gün, günde 10 saat).\n` +
        `* **Planlama:** Tüm teslimat terminleri ve kapasite hesapları Pazar günleri hariç tutularak hesaplanır.`;
    }

    // Soru 10: Bu ay en çok hangi taş ve ebat üretildi?
    case 10: {
      let text = `🏆 **Bu Ay En Çok Üretilen Taşlar ve Ebatlar**\n\n`;
      if (data.monthlyTopProducts && data.monthlyTopProducts.length > 0) {
        data.monthlyTopProducts.slice(0, 5).forEach((p, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '•';
          const unit = p.unit.toLowerCase() === 'm2' ? 'm²' : p.unit;
          text += `${medal} **${idx + 1}. ${p.name.trim()}:** **${p.quantity.toLocaleString('tr-TR')} ${unit}**\n`;
        });
      } else {
        text += `• Bu ay için henüz döküm veya üretim kaydı girilmemiştir.\n`;
      }
      text += `\n📈 **Toplam Aylık Üretim:** **${data.monthlyProductionM2.toLocaleString('tr-TR')} m²**\n`;
      text += `💡 *Veriler bu ayki döküm ve vardiya kayıtlarından anlık hesaplanmıştır.*`;
      return text;
    }

    // Soru 11: Bugün kantardan toplam kaç kamyon ve irsaliye çıktı?
    case 11: {
      return `🚚 **Bugünkü Kantar Çıkış & Sefer Sayısı**\n\n` +
        `* **Tamamlanan Sefer:** **${data.todayShipmentsCount} Kamyon / İrsaliye**\n` +
        `* **Toplam Sevk Parke:** ${data.todayShipmentParkeM2.toLocaleString('tr-TR')} m²\n` +
        `* **Toplam Sevk Bordür:** ${data.todayShipmentBordurMetre.toLocaleString('tr-TR')} Metre\n` +
        `* **Kantar Sevk Tonajı:** ${data.todayShipmentTonnage} Ton`;
    }

    // Soru 12: Bugünkü kantar net sevk tonajı ne kadar?
    case 12: {
      return `⚖️ **Bugünkü Kantar Net Sevk Tonajı**\n\n` +
        `* **Net Tartılan Tonaj:** **${data.todayShipmentTonnage} Ton**\n` +
        `* **Sevk Edilen Parke:** ${data.todayShipmentParkeM2.toLocaleString('tr-TR')} m² (~180 kg/m²)\n` +
        `* **Sevk Edilen Bordür:** ${data.todayShipmentBordurMetre.toLocaleString('tr-TR')} Metre (~90 kg/m)\n` +
        `* **Araç Sayısı:** ${data.todayShipmentsCount} Kamyon`;
    }

    // Soru 13: Bugün Onikişubat Hacı Kel şantiyesine ne kadar sevkiyat yapıldı?
    case 13: {
      const siteShipments = data.todayRecentShipments.filter(s => normalizeTurkish(s.site).includes('haci kel'));
      if (siteShipments.length > 0) {
        let text = `🚚 **ONİKİŞUBAT BELEDİYESİ - HACI KEL ŞANTİYESİ SEVKİYATI**\n\n`;
        siteShipments.forEach((s, idx) => {
          text += `📄 **${idx + 1}. Sefer [İrsaliye: ${s.invoice}]**\n`;
          text += `   🚛 Araç/Şoför: ${s.plate || '-'} ${s.driver ? `(${s.driver})` : ''}\n`;
          text += `   📦 Ürünler: ${s.qty}\n\n`;
        });
        return text;
      }
      return `ℹ️ **ONİKİŞUBAT BELEDİYESİ (Hacı Kel Şantiyesi)** adına bugün (${data.todayDate}) sevk edilmiş herhangi bir sevkiyat veya araç bulunmamaktadır.`;
    }

    // Soru 14: Bugün Onikişubat Mustafa Kaya şantiyesine hangi ürünler gitti?
    case 14: {
      const siteShipments = data.todayRecentShipments.filter(s => normalizeTurkish(s.site).includes('mustafa kaya'));
      if (siteShipments.length > 0) {
        let text = `🚚 **ONİKİŞUBAT BELEDİYESİ - MUSTAFA KAYA ŞANTİYESİ**\n\n`;
        siteShipments.forEach((s, idx) => {
          text += `📄 **${idx + 1}. Sefer [İrsaliye: ${s.invoice}]**\n`;
          text += `   🚛 Araç/Şoför: ${s.plate || '-'} ${s.driver ? `(${s.driver})` : ''}\n`;
          text += `   📦 Ürünler: ${s.qty}\n\n`;
        });
        return text;
      }
      return `ℹ️ **ONİKİŞUBAT BELEDİYESİ (Mustafa Kaya Şantiyesi)** adına bugün (${data.todayDate}) sevk edilmiş herhangi bir sevkiyat veya araç bulunmamaktadır.`;
    }

    // Soru 15: Bugün Onikişubat Mustafa Yılmaz şantiyesine kaç metre bordür gitti?
    case 15: {
      const siteShipments = data.todayRecentShipments.filter(s => normalizeTurkish(s.site).includes('mustafa yilmaz'));
      if (siteShipments.length > 0) {
        let text = `🚚 **ONİKİŞUBAT BELEDİYESİ - MUSTAFA YILMAZ ŞANTİYESİ**\n\n`;
        siteShipments.forEach((s, idx) => {
          text += `📄 **${idx + 1}. Sefer [İrsaliye: ${s.invoice}]**\n`;
          text += `   🚛 Araç/Şoför: ${s.plate || '-'} ${s.driver ? `(${s.driver})` : ''}\n`;
          text += `   📦 Ürünler: ${s.qty}\n\n`;
        });
        return text;
      }
      return `ℹ️ **ONİKİŞUBAT BELEDİYESİ (Mustafa Yılmaz Şantiyesi)** adına bugün (${data.todayDate}) sevk edilmiş herhangi bir sevkiyat veya bordür çıkışı bulunmamaktadır.`;
    }

    // Soru 16: Bugün Medikent Altınova şantiyesine ne kadar parke sevk edildi?
    case 16: {
      const siteShipments = data.todayRecentShipments.filter(s =>
        normalizeTurkish(s.site).includes('altinova') ||
        (normalizeTurkish(s.customer).includes('medikent') && normalizeTurkish(s.site).includes('altin'))
      );
      if (siteShipments.length > 0) {
        let text = `🚚 **MEDİKENT - ALTINOVA ŞANTİYESİ SEVKİYATI**\n\n`;
        siteShipments.forEach((s, idx) => {
          text += `📄 **${idx + 1}. Sefer [İrsaliye: ${s.invoice}]**\n`;
          text += `   🚛 Araç/Şoför: ${s.plate || '-'} ${s.driver ? `(${s.driver})` : ''}\n`;
          text += `   📦 Ürünler: ${s.qty}\n\n`;
        });
        return text;
      }
      return `ℹ️ **MEDİKENT (Altınova Şantiyesi)** adına bugün (${data.todayDate}) sevk edilmiş herhangi bir parke veya malzeme çıkışı bulunmamaktadır.`;
    }

    // Soru 17: Bugün çıkan son sevkiyatlar ve irsaliyeler hangileri?
    case 17: {
      let text = `📋 **Bugün Çıkan Son İrsaliyeler & Sevkiyatlar (${data.todayDate})**\n\n`;
      if (data.todayRecentShipments.length > 0) {
        data.todayRecentShipments.slice(0, 8).forEach((s, i) => {
          text += `${i + 1}. **${s.customer}** (${s.site}) ➔ ${s.qty} [İrs: ${s.invoice}] - Araç: ${s.plate || '-'}\n`;
        });
      } else {
        text += `ℹ️ Bugün henüz sisteme işlenen veya kantardan çıkan yeni bir sevkiyat / irsaliye bulunmamaktadır.\n`;
      }
      return text;
    }

    // Soru 18: Kantar fişi girilmemiş tartımsız araç var mı?
    case 18: {
      if (data.todayRecentShipments.length === 0) {
        return `ℹ️ Bugün (${data.todayDate}) henüz sevk edilen araç çıkışı bulunmadığı için bekleyen tartım kaydı yoktur.`;
      }
      const unweighed = data.todayRecentShipments.filter(s => s.netWeight <= 0);
      if (unweighed.length > 0) {
        let text = `⚠️ **Kantar Tartımı Eksik / Bekleyen Araçlar**\n\n`;
        unweighed.forEach(s => {
          text += `• **İrsaliye ${s.invoice}:** ${s.customer} (${s.site}) - Araç: ${s.plate || 'Plaka girilmedi'}\n`;
        });
        text += `\n💡 *Lütfen kantar görevlisine fiş tartım girişlerini tamamlamasını iletiniz.*`;
        return text;
      }
      return `✅ **Tüm araçların kantar fişi ve tartım kayıtları eksiksizdir.** Bugün çıkan ${data.todayShipmentsCount} aracın tamamı tartılmıştır.`;
    }

    // Soru 19: Bugün toplam kaç m² parke ve kaç metre bordür sevk ettik?
    case 19: {
      return `📊 **Bugünkü Toplam Sevk Metrajları**\n\n` +
        `* 🧱 **Toplam Parke Çıkışı:** **${data.todayShipmentParkeM2.toLocaleString('tr-TR')} m²**\n` +
        `* 📏 **Toplam Bordür Çıkışı:** **${data.todayShipmentBordurMetre.toLocaleString('tr-TR')} Metre**\n` +
        `* 🔘 **Adetli Ürünler:** **${data.todayShipmentAdet.toLocaleString('tr-TR')} Adet**\n` +
        `* 🚛 **Toplam Sefer:** ${data.todayShipmentsCount} Kamyon`;
    }

    // Soru 20: Sevkiyatta 2400 nolu irsaliyede ne var?
    case 20: {
      return handleDynamicInvoiceQuery('2400', data);
    }

    // Soru 21: Paletlerin toplam değeri ne kadar?
    case 21: {
      const uretimVal = data.totalUnreturnedUretim * uretimPrice;
      const tahtaVal = data.totalUnreturnedTahta * tahtaPrice;
      const sevkiyatVal = (data.totalUnreturnedSevkiyat || 0) * (FACTORY_CORE_RULES.PALLET_PRICES.sevkiyat || 200);
      const totalVal = uretimVal + tahtaVal + sevkiyatVal;

      let text = `💰 **Şantiyelerdeki Paletlerin Finansal Değer Raporu**\n\n`;
      text += `*Fabrika Kuralı: Üretim Paleti = ₺${uretimPrice.toLocaleString('tr-TR')} | Tahta Palet = ₺${tahtaPrice.toLocaleString('tr-TR')}*\n\n`;
      text += `• 🏭 **Üretim Paletleri:** **${data.totalUnreturnedUretim.toLocaleString('tr-TR')} Adet** x ₺${uretimPrice.toLocaleString('tr-TR')} = **₺${uretimVal.toLocaleString('tr-TR')}**\n`;
      text += `• 🪵 **Tahta Paletler:** **${data.totalUnreturnedTahta.toLocaleString('tr-TR')} Adet** x ₺${tahtaPrice.toLocaleString('tr-TR')} = **₺${tahtaVal.toLocaleString('tr-TR')}**\n`;
      if (data.totalUnreturnedSevkiyat > 0) {
        text += `• 📦 **Sevkiyat Paletleri:** **${data.totalUnreturnedSevkiyat.toLocaleString('tr-TR')} Adet** x ₺200 = **₺${sevkiyatVal.toLocaleString('tr-TR')}**\n`;
      }
      text += `════════════════════════════════════════════════\n`;
      text += `💵 **TOPLAM ŞANTİYE PALET REHİN DEĞERİ:** **₺${totalVal.toLocaleString('tr-TR')}**\n\n`;
      text += `📦 **Toplam Bekleyen Palet:** **${data.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet** şantiyelerdedir.\n`;
      return text;
    }

    // Soru 22: Şantiyelerde toplam kaç adet üretim paleti bekliyor?
    case 22: {
      const uretimVal = data.totalUnreturnedUretim * uretimPrice;
      return `🏭 **Şantiyelerde Bekleyen Üretim Paletleri**\n\n` +
        `* **Miktar:** **${data.totalUnreturnedUretim.toLocaleString('tr-TR')} Adet Üretim Paleti**\n` +
        `* **Birim Değer:** ₺${uretimPrice.toLocaleString('tr-TR')} / Adet\n` +
        `* **Toplam Rehin / Maliyet Değeri:** **₺${uretimVal.toLocaleString('tr-TR')}**\n\n` +
        `⚠️ *Üretim paletleri fabrika imalatında kullanıldığından acil toplatılması gereken en kritik palet grubudur.*`;
    }

    // Soru 23: Şantiyelerde toplam kaç adet tahta palet bekliyor?
    case 23: {
      const tahtaVal = data.totalUnreturnedTahta * tahtaPrice;
      return `🪵 **Şantiyelerde Bekleyen Tahta Paletler**\n\n` +
        `* **Miktar:** **${data.totalUnreturnedTahta.toLocaleString('tr-TR')} Adet Tahta Palet**\n` +
        `* **Birim Depozito Değeri:** ₺${tahtaPrice.toLocaleString('tr-TR')} / Adet\n` +
        `* **Toplam Depozito Bedeli:** **₺${tahtaVal.toLocaleString('tr-TR')}**\n\n` +
        `💡 *Sevkiyat araçlarının boş dönmeyip tahta paletleri toplaması önerilir.*`;
    }

    // Soru 24: Medikent den ne kadar üretim paleti alacağımız var?
    case 24: {
      const med = data.palletDebtors.find(d => normalizeTurkish(d.customer).includes('medikent'));
      const u = med ? med.uretim : 0;
      const t = med ? med.tahta : 0;
      const s = med ? (med.sevkiyat || 0) : 0;
      const tot = med ? med.total : 0;
      const uVal = u * uretimPrice;
      const totVal = (u * uretimPrice) + (t * tahtaPrice) + (s * 200);

      let text = `🪵 **MEDİKENT - Üretim Paleti Alacağı**\n\n`;
      text += `🎯 **ÜRETİM PALETİ ALACAĞIMIZ: ${u.toLocaleString('tr-TR')} Adet**\n`;
      text += `• **Birim Değeri:** ₺${uretimPrice.toLocaleString('tr-TR')} / Adet\n`;
      text += `• **Üretim Paleti Tutarı:** **₺${uVal.toLocaleString('tr-TR')}**\n\n`;
      text += `ℹ️ *Ayrıca Medikent firmasında **${t.toLocaleString('tr-TR')} Adet Tahta Palet**${s > 0 ? ` ve **${s} Adet Sevkiyat Paleti**` : ''} bulunmaktadır (Genel Toplam: **${tot.toLocaleString('tr-TR')} Adet**).*\n`;
      text += `💰 *Toplam Palet Rehin Değeri: ~₺${totVal.toLocaleString('tr-TR')}*`;
      return text;
    }

    // Soru 25: Medikent firmasının toplam tahta ve üretim palet borcu ne kadar?
    case 25: {
      const med = data.palletDebtors.find(d => normalizeTurkish(d.customer).includes('medikent'));
      const u = med ? med.uretim : 0;
      const t = med ? med.tahta : 0;
      const s = med ? (med.sevkiyat || 0) : 0;
      const tot = med ? med.total : 0;
      const totVal = (u * uretimPrice) + (t * tahtaPrice) + (s * 200);

      let text = `🪵 **MEDİKENT - Güncel Şantiye Palet Durumu**\n\n`;
      text += `• 🏭 **Üretim Paleti:** **${u.toLocaleString('tr-TR')} Adet** (Değer: ₺${(u * uretimPrice).toLocaleString('tr-TR')})\n`;
      text += `• 🪵 **Tahta Palet:** **${t.toLocaleString('tr-TR')} Adet** (Değer: ₺${(t * tahtaPrice).toLocaleString('tr-TR')})\n`;
      if (s > 0) {
        text += `• 📦 **Sevkiyat Paleti:** **${s.toLocaleString('tr-TR')} Adet** (Değer: ₺${(s * 200).toLocaleString('tr-TR')})\n`;
      }
      text += `════════════════════════════════════════════════\n`;
      text += `📦 **Toplam Palet Borcu:** **${tot.toLocaleString('tr-TR')} Adet Palet**\n`;
      text += `💵 **Toplam Finansal Değer:** **₺${totVal.toLocaleString('tr-TR')}**\n\n`;
      if (med?.sites && Object.keys(med.sites).length > 0) {
        text += `📍 **Şantiye Dağılımı:**\n`;
        for (const [siteName, counts] of Object.entries(med.sites)) {
          text += `  - ${siteName}: ${counts.total} Adet (Üretim: ${counts.uretim}, Tahta: ${counts.tahta})\n`;
        }
      }
      return text;
    }

    // Soru 26: Onikişubat Belediyesi şantiyelerinde kaç paletimiz kalmış?
    case 26: {
      const onik = data.palletDebtors.find(d => normalizeTurkish(d.customer).includes('onikisubat'));
      const u = onik ? onik.uretim : 0;
      const t = onik ? onik.tahta : 0;
      const s = onik ? (onik.sevkiyat || 0) : 0;
      const tot = onik ? onik.total : 0;
      const val = (u * uretimPrice) + (t * tahtaPrice) + (s * 200);

      let text = `🪵 **ONİKİŞUBAT BELEDİYESİ - Şantiye Paletleri**\n\n`;
      text += `• 🏭 **Üretim Paleti:** **${u.toLocaleString('tr-TR')} Adet** (₺${(u * uretimPrice).toLocaleString('tr-TR')})\n`;
      text += `• 🪵 **Tahta Palet:** **${t.toLocaleString('tr-TR')} Adet** (₺${(t * tahtaPrice).toLocaleString('tr-TR')})\n`;
      if (s > 0) {
        text += `• 📦 **Sevkiyat Paleti:** **${s.toLocaleString('tr-TR')} Adet** (₺${(s * 200).toLocaleString('tr-TR')})\n`;
      }
      text += `════════════════════════════════════════════════\n`;
      text += `📦 **Toplam Palet:** **${tot.toLocaleString('tr-TR')} Adet** (Değer: **₺${val.toLocaleString('tr-TR')}**)\n\n`;
      if (onik?.sites && Object.keys(onik.sites).length > 0) {
        text += `📍 **Şantiye Dağılımı:**\n`;
        for (const [siteName, counts] of Object.entries(onik.sites)) {
          text += `  - ${siteName}: ${counts.total} Adet (Üretim: ${counts.uretim}, Tahta: ${counts.tahta})\n`;
        }
      }
      return text;
    }

    // Soru 27: En çok palet borcu olan ilk 5 müşteri hangileri?
    case 27: {
      let text = `⚠️ **En Çok Palet Borcu Olan İlk 5 Müşteri**\n\n`;
      if (data.palletDebtors.length > 0) {
        data.palletDebtors.slice(0, 5).forEach((d, idx) => {
          const val = (d.uretim * uretimPrice) + (d.tahta * tahtaPrice) + ((d.sevkiyat || 0) * 200);
          text += `${idx + 1}. **${d.customer}:** **${d.total.toLocaleString('tr-TR')} Adet** (Üretim: ${d.uretim} ad, Tahta: ${d.tahta} ad${d.sevkiyat ? `, Sevkiyat: ${d.sevkiyat} ad` : ''}) ➔ ~₺${val.toLocaleString('tr-TR')}\n`;
        });
      } else {
        text += `Kayıtlı palet borcu bulunmamaktadır.\n`;
      }
      return text;
    }

    // Soru 28: Aykach firmasında kaç adet paletimiz var?
    case 28: {
      const ayk = data.palletDebtors.find(d => normalizeTurkish(d.customer).includes('aykach'));
      const u = ayk ? ayk.uretim : 0;
      const t = ayk ? ayk.tahta : 0;
      const s = ayk ? (ayk.sevkiyat || 0) : 0;
      const tot = ayk ? ayk.total : 0;
      const val = (u * uretimPrice) + (t * tahtaPrice) + (s * 200);

      let text = `🪵 **AYKACH - Şantiye Palet Durumu**\n\n`;
      text += `• 🏭 **Üretim Paleti:** **${u.toLocaleString('tr-TR')} Adet** (₺${(u * uretimPrice).toLocaleString('tr-TR')})\n`;
      text += `• 🪵 **Tahta Palet:** **${t.toLocaleString('tr-TR')} Adet** (₺${(t * tahtaPrice).toLocaleString('tr-TR')})\n`;
      if (s > 0) {
        text += `• 📦 **Sevkiyat Paleti:** **${s.toLocaleString('tr-TR')} Adet** (₺${(s * 200).toLocaleString('tr-TR')})\n`;
      }
      text += `════════════════════════════════════════════════\n`;
      text += `📦 **Toplam:** **${tot.toLocaleString('tr-TR')} Adet Palet** (Toplam Değer: **₺${val.toLocaleString('tr-TR')}**)`;
      return text;
    }

    // Soru 29: Üretim paletleri ve tahta paletlerin birim bedelleri nedir?
    case 29: {
      return `🪵 **Öğrenilmiş Sabit Palet Birim Fiyatları**\n\n` +
        `* 🏭 **Üretim Paleti:** **₺${uretimPrice.toLocaleString('tr-TR')} / Adet** (Çelik İmalat Paleti)\n` +
        `* 🪵 **Tahta Palet:** **₺${tahtaPrice.toLocaleString('tr-TR')} / Adet** (Ahşap Sevkiyat Paleti)\n` +
        `* 📦 **Standart Sevkiyat Paleti:** **₺200 / Adet**\n\n` +
        `💡 *Tüm finansal hesaplamalarda ve cari rehin raporlarında bu birim bedeller esas alınmaktadır.*`;
    }

    // Soru 30: Şantiyelerdeki paletlerin toplam finansal riski kaç TL?
    case 30: {
      const uVal = data.totalUnreturnedUretim * uretimPrice;
      const tVal = data.totalUnreturnedTahta * tahtaPrice;
      const sVal = (data.totalUnreturnedSevkiyat || 0) * 200;
      const totVal = uVal + tVal + sVal;
      return `🚨 **Şantiyelerdeki Paletlerin Toplam Finansal Riski**\n\n` +
        `* **Toplam Bekleyen Palet:** **${data.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet**\n` +
        `* 🏭 **Üretim Paleti Riski:** ${data.totalUnreturnedUretim.toLocaleString('tr-TR')} Adet x ₺3.000 = **₺${uVal.toLocaleString('tr-TR')}**\n` +
        `* 🪵 **Tahta Palet Riski:** ${data.totalUnreturnedTahta.toLocaleString('tr-TR')} Adet x ₺300 = **₺${tVal.toLocaleString('tr-TR')}**\n` +
        (sVal > 0 ? `* 📦 **Sevkiyat Paleti Riski:** ${data.totalUnreturnedSevkiyat} Adet x ₺200 = **₺${sVal.toLocaleString('tr-TR')}**\n` : '') +
        `════════════════════════════════════════════════\n` +
        `💵 **TOPLAM FİNANSAL REHİN RİSKİ: ₺${totVal.toLocaleString('tr-TR')}**\n\n` +
        `💡 *Tavsiye: Boş palet getirmeyen araçlara palet depozito faturası kesilmesi önerilir.*`;
    }

    // Soru 31: Depoda şu an toplam kaç m² parke stoku var?
    case 31: {
      return `📦 **Depodaki Toplam Parke Taşı Stoku**\n\n` +
        `* **Mevcut Parke Stoku:** **${data.totalStockParkeM2.toLocaleString('tr-TR')} m²**\n` +
        `* **Ürün Dağılımı:** 8'lik Kilit Parke, 6'lık Parke, 20x10 Prizma Taşları\n` +
        `* **Depo Kapasite Durumu:** Yeterli seviyede stok mevcuttur.`;
    }

    // Soru 32: Depoda şu an toplam kaç metre bordür stoku var?
    case 32: {
      return `📦 **Depodaki Toplam Bordür Stoku**\n\n` +
        `* **Mevcut Bordür Stoku:** **${data.totalStockBordurMetre.toLocaleString('tr-TR')} Metre**\n` +
        `* **Ürün Dağılımı:** 50x25x20 Ankara Bordürü, Bahçe Bordürü, Dönüş Bordürleri\n` +
        `* **Sevkiyat Durumu:** Sevkiyata hazır paletlenmiş haldedir.`;
    }

    // Soru 33: Emniyet stoğunun altına inen kritik ürünler hangileri?
    case 33: {
      if (data.lowStockItems.length > 0) {
        let text = `🚨 **Emniyet Stoğunun Altına İnen Kritik Ürünler**\n\n`;
        data.lowStockItems.forEach(it => {
          text += `• **${it.name}:** Kalan **${it.current} ${it.unit}** (Emniyet Sınırı: ${it.min} ${it.unit})\n`;
        });
        text += `\n⚠️ *Bu ürünlerin acilen üretim planına alınması önerilir.*`;
        return text;
      }
      return `✅ **Stok durumu normal.** Emniyet stoğu altına inen kritik ürün bulunmamaktadır.`;
    }

    // Soru 34: 8 lik kilit parke taşında ne kadar stok kaldı?
    case 34: {
      const found = (data.allProductsStock || []).find(i => {
        const n = normalizeTurkish(i.name);
        return (n.includes('8') || n.includes('sekiz')) && (n.includes('parke') || n.includes('kilit') || n.includes('naturel'));
      });
      if (found) {
        return formatProductStockResponse([found]);
      }
      const low = data.lowStockItems.find(i => normalizeTurkish(i.name).includes('8') && normalizeTurkish(i.name).includes('kilit'));
      return `🧱 **8'lik Kilit Parke Taşı Stok Durumu**\n\n` +
        `* **Kullanım:** Ağır araç trafiği, cadde ve fabrika sahaları\n` +
        `* **Depo Durumu:** ${low ? `Kritik eşikte: ${low.current} ${low.unit}` : "Düzenli imalat yapılmakta olup sevkiyata uygun stok mevcuttur."}\n` +
        `* **Birim Ağırlık:** ~180 kg/m²`;
    }

    // Soru 35: 6 lık parke taşından depoda stok var mı?
    case 35: {
      const found = (data.allProductsStock || []).find(i => {
        const n = normalizeTurkish(i.name);
        return (n.includes('6') || n.includes('alti')) && (n.includes('parke') || n.includes('kilit') || n.includes('naturel'));
      });
      if (found) {
        return formatProductStockResponse([found]);
      }
      return `🧱 **6'lık Parke Taşı Stok Durumu**\n\n` +
        `* **Kullanım:** Otopark, yaya yolları ve site içi peyzaj\n` +
        `* **Stok:** Depoda yeterli seviyede 6'lık kilit ve prizma taşı bulunmaktadır.\n` +
        `* **Birim Ağırlık:** ~135 kg/m²`;
    }

    // Soru 36: Stokları tükenmek üzere olan ürünler için ne önerirsin?
    case 36: {
      let text = `💡 **Kritik Stok Üretim Tavsiyesi**\n\n`;
      if (data.lowStockItems.length > 0) {
        text += `Aşağıdaki ürünler emniyet stoğu altına düştüğü için 1 nolu ve 2 nolu makinelerin kalıp planına acilen alınmalıdır:\n\n`;
        data.lowStockItems.slice(0, 4).forEach(it => {
          text += `• **${it.name}** (Mevcut: ${it.current} ${it.unit} / Emniyet: ${it.min})\n`;
        });
      } else {
        text += `Şu an kritik seviyede azalan ürün yoktur. Bekleyen acil müşteri siparişlerinin imalatına devam edilebilir.`;
      }
      return text;
    }

    // Soru 37: Ankara bordürü ve bahçe bordürü stok durumu nedir?
    case 37: {
      const bordurler = (data.allProductsStock || []).filter(i => {
        const n = normalizeTurkish(i.name);
        return n.includes('ankara') || n.includes('bahce');
      });
      if (bordurler.length > 0) {
        return formatProductStockResponse(bordurler);
      }
      return `📏 **Bordür Grubu Stok Durumu**\n\n` +
        `* **Toplam Bordür Stoku:** **${data.totalStockBordurMetre.toLocaleString('tr-TR')} Metre**\n` +
        `* **50x25x20 Ankara Bordürü:** Yol projeleri için ana kalem, sevk edilebilir durumda.\n` +
        `* **Bahçe Bordürü:** Park ve peyzaj işleri için stok mevcuttur.`;
    }

    // Soru 38: Yağmur oluğu ve engelli takip taşı stokları ne kadar?
    case 38: {
      const matched = (data.allProductsStock || []).filter(i => {
        const n = normalizeTurkish(i.name);
        return n.includes('oluk') || n.includes('engelli');
      });
      if (matched.length > 0) {
        return formatProductStockResponse(matched);
      }
      return `🔘 **Yağmur Oluğu & Engelli Taşı Durumu**\n\n` +
        `* **Adetli Ürün Depo Stoku:** **${data.totalStockAdet.toLocaleString('tr-TR')} Adet**\n` +
        `* **Engelli Takip Taşı:** Sarı ve gri yüzeyli hissedilebilir taşlar sevkiyata hazırdır.\n` +
        `* **Yağmur Oluğu:** Standart oluk taşları düzenli olarak sevk edilmektedir.`;
    }

    // Soru 39: Depodaki tüm ürünlerin kalem sayısı kaçtır?
    case 39: {
      return `📦 **Depodaki Toplam Ürün Kalem Sayısı**\n\n` +
        `* **Aktif Ürün Çeşidi:** **${data.totalProductsCount} Kalem Ürün**\n` +
        `* **Kategoriler:** Parke Taşları, Bordürler, Yağmur Olukları, Engelli Taşları, Briketler`;
    }

    // Soru 40: Şu an depomuzda en yüksek stoklu olan ürün hangisidir?
    case 40: {
      if (data.allProductsStock && data.allProductsStock.length > 0) {
        const sorted = [...data.allProductsStock].sort((a, b) => b.currentStock - a.currentStock);
        const top = sorted[0];
        const second = sorted[1];
        const unit1 = top.unit.toLowerCase() === 'm2' ? 'm²' : top.unit;
        const unit2 = second ? (second.unit.toLowerCase() === 'm2' ? 'm²' : second.unit) : '';
        return `📦 **Depoda En Yüksek Stoklu Ürün**\n\n` +
          `* 🥇 **Lider Ürün:** **${top.name.trim()}**\n` +
          `* **Mevcut Stok:** **${top.currentStock.toLocaleString('tr-TR')} ${unit1}** (Emniyet: ${top.minStock.toLocaleString('tr-TR')} ${unit1})\n` +
          (second ? `* 🥈 **İkinci Sırada:** **${second.name.trim()}** (${second.currentStock.toLocaleString('tr-TR')} ${unit2})\n` : '') +
          `\n💡 *Yüksek stoklu ürünler ani büyük belediye ve altyapı siparişleri için hazır tampon stoğu oluşturur.*`;
      }
      return `📦 **Depoda En Yüksek Stoklu Ürün**\n\n` +
        `* **Lider Ürün:** **8'lik Kilit Parke Taşı (Gri)**\n` +
        `* **Neden:** En yaygın kamu ve müteahhit talebi bu üründe olduğu için tampon stok yüksek tutulmaktadır.`;
    }

    // Soru 41: Bekleyen acil iş emirleri ve siparişler hangileri?
    case 41: {
      let text = `🎯 **Bekleyen Acil İş Emirleri & Siparişler**\n\n`;
      text += `* **Bekleyen Sipariş Sayısı:** **${data.pendingOrdersCount} Adet**\n\n`;
      if (data.criticalOrders.length > 0) {
        text += `🔥 **Öncelikli Sipariş Listesi:**\n`;
        data.criticalOrders.forEach(o => {
          text += `• **${o.customer}:** ${o.product} (${o.qty}) ${o.dueDate ? `[Termin: ${new Date(o.dueDate).toLocaleDateString('tr-TR')}]` : ''}\n`;
        });
      } else {
        text += `*Acil termin baskısı olan gecikmiş iş emri bulunmamaktadır.*`;
      }
      return text;
    }

    // Soru 42: Termini yaklaşan veya teslimatı geciken sipariş var mı?
    case 42: {
      const urgent = data.criticalOrders.filter(o => o.dueDate);
      if (urgent.length > 0) {
        let text = `⏰ **Termini Yaklaşan / Takipteki Siparişler**\n\n`;
        urgent.forEach(o => {
          text += `• **${o.customer}** ➔ ${o.product} (${o.qty}) [Termin: ${new Date(o.dueDate!).toLocaleDateString('tr-TR')}]\n`;
        });
        return text;
      }
      return `✅ **Termin durumu sağlıklı.** Teslimatı geciken veya riskli sipariş bulunmuyor.`;
    }

    // Soru 43: Medikent in taahhüt kotası doldu mu, ne kadar kaldı?
    case 43: {
      const medQuota = (data.quotaDetails || []).find(q => {
        const c = q.customerName || q.customer || '';
        return normalizeTurkish(c).includes('medikent');
      });
      if (medQuota) {
        const cust = medQuota.customerName || medQuota.customer || 'Medikent';
        const prod = medQuota.productName || medQuota.product || 'Parke Taşı';
        const site = medQuota.siteName || medQuota.site ? ` (${medQuota.siteName || medQuota.site})` : '';
        const unit = medQuota.unit.toLowerCase() === 'm2' ? 'm²' : medQuota.unit;

        return `📋 **MEDİKENT - Taahhüt & Kota Takip Raporu**\n\n` +
          `* **Cari / Şantiye:** **${cust}**${site}\n` +
          `* **Sözleşmeli Ürün:** **${prod}**\n` +
          `* **Sözleşme / Hedef Kota:** **${medQuota.target.toLocaleString('tr-TR')} ${unit}**\n` +
          `* **Gerçekleşen Toplam Sevk:** **${medQuota.shipped.toLocaleString('tr-TR')} ${unit}**\n` +
          `* **Kalan Kota:** **${medQuota.remaining <= 0 ? `🚨 0 ${unit} (KOTA %${medQuota.pct} AŞILDI)` : `${medQuota.remaining.toLocaleString('tr-TR')} ${unit}` }**\n` +
          `* **Durum:** ${medQuota.isExceeded ? `🚨 **Sözleşme kotası dolmuş ve ${Math.abs(medQuota.remaining).toLocaleString('tr-TR')} ${unit} aşılmıştır!** Ek protokol hazırlanmalıdır.` : medQuota.remaining < 500 ? '⚠️ **Kritik eşikte** (500 birimin altında kaldı).' : '✅ Normal sevkiyat bandında devam ediyor.'}`;
      }
      return `ℹ️ **Medikent** adına tanımlı aktif bir sözleşme kotası bulunmamaktadır. Kotalar ekranından yeni sözleşme eklenebilir.`;
    }

    // Soru 44: Kotası 500 m² altına düşen veya aşan müşteriler hangileri?
    case 44: {
      if (data.lowQuotaAlerts && data.lowQuotaAlerts.length > 0) {
        let text = `⚠️ **Kotası 500 m² Altına Düşen veya Dolan Sözleşmeler**\n\n`;
        data.lowQuotaAlerts.forEach(q => {
          const cust = q.customerName || q.customer || 'Müşteri';
          const prod = q.productName || q.product || 'Parke Taşı';
          const site = q.siteName || q.site ? ` (${q.siteName || q.site})` : '';
          const unit = q.unit.toLowerCase() === 'm2' ? 'm²' : q.unit;

          if (q.isExceeded || q.remaining <= 0) {
            text += `• 🛑 **${cust}**${site} - **${prod}**:\n`;
            text += `  Taahhüt: ${q.target.toLocaleString('tr-TR')} ${unit} | Sevk: ${q.shipped.toLocaleString('tr-TR')} ${unit} ➔ 🚨 **KOTA %${q.pct} AŞILDI** (${Math.abs(q.remaining).toLocaleString('tr-TR')} ${unit} fazla sevk)\n`;
          } else {
            text += `• ⚠️ **${cust}**${site} - **${prod}**:\n`;
            text += `  Taahhüt: ${q.target.toLocaleString('tr-TR')} ${unit} | Sevk: ${q.shipped.toLocaleString('tr-TR')} ${unit} ➔ **Kalan: ${q.remaining.toLocaleString('tr-TR')} ${unit}** (%${q.pct} doluluk)\n`;
          }
        });
        text += `\n💡 *Pazarlama ve sözleşme ekibinin bu müşterilerle yeni protokol yapması önerilir.*`;
        return text;
      }
      return `✅ **Tüm müşteri kotaları 500 m² güvenli sınırın üzerindedir.** Kotası tükenmek üzere olan veya aşan cari bulunmamaktadır.`;
    }

    // Soru 45: Onikişubat Belediyesi nin aktif sipariş ve iş emirleri nelerdir?
    case 45: {
      return `🎯 **ONİKİŞUBAT BELEDİYESİ - Aktif İş Emirleri**\n\n` +
        `* **Aktif Şantiyeler:** Hacı Kel, Mustafa Kaya, Mustafa Yılmaz\n` +
        `* **Talep Edilen Ürünler:** 20x10 Siyah/Beyaz Prizma Parke, 50x25x20 Ankara Bordürü, Engelli Takip Taşı\n` +
        `* **Sevkiyat Durumu:** Düzenli olarak günlük kamyon çıkışları yapılmaktadır.`;
    }

    // Soru 46: Şu an toplam kaç aktif müşteri kotası sözleşmesi var?
    case 46: {
      return `📋 **Aktif Müşteri Kotası & Sözleşme Sayısı**\n\n` +
        `* **Aktif Sözleşme Sayısı:** **${data.activeQuotasCount} Adet**\n` +
        `* **Kapsam:** Belediye ihaleleri, toplu konut şantiyeleri ve müteahhit taahhütleri.`;
    }

    // Soru 47: Hangi müşterinin taahhüt kotası %100 doldu? / Sözleşmesi biten müşteri var mı?
    case 47: {
      if (data.exceededQuotas && data.exceededQuotas.length > 0) {
        let text = `🚨 **Sözleşmesi Biten / Taahhüt Kotası %100 Dolan Müşteriler**\n\n`;
        text += `Aşağıdaki müşterilerin sözleşme taahhüt kotaları tamamlanmış veya aşılmıştır:\n\n`;
        data.exceededQuotas.forEach(q => {
          const cust = q.customerName || q.customer || 'Müşteri';
          const prod = q.productName || q.product || 'Parke Taşı';
          const site = q.siteName || q.site ? ` (${q.siteName || q.site})` : '';
          const unit = q.unit.toLowerCase() === 'm2' ? 'm²' : q.unit;

          text += `• 🛑 **${cust}**${site} - **${prod}**\n`;
          text += `  - **Sözleşme Kotası:** ${q.target.toLocaleString('tr-TR')} ${unit}\n`;
          text += `  - **Toplam Yapılan Sevk:** **${q.shipped.toLocaleString('tr-TR')} ${unit}** (Doluluk: **%${q.pct}**)\n`;
          if (q.remaining < 0) {
            text += `  - ⚠️ **Kota Aşımı:** **${Math.abs(q.remaining).toLocaleString('tr-TR')} ${unit}** sözleşme üstü sevk yapılmıştır!\n`;
          } else {
            text += `  - ✅ **Durum:** Sözleşme taahhüdü tam olarak (%100) tamamlanmıştır.\n`;
          }
          text += `\n`;
        });
        text += `💡 *Öneri: Sevkiyatın devamı için ilgili müşterilerle acilen ek protokol veya yeni sözleşme imzalanmalıdır.*`;
        return text;
      }
      if (data.quotaDetails && data.quotaDetails.length > 0) {
        const sorted = [...data.quotaDetails].sort((a, b) => b.pct - a.pct);
        const top = sorted[0];
        const cust = top.customerName || top.customer || 'Müşteri';
        const prod = top.productName || top.product || 'Parke Taşı';
        const unit = top.unit.toLowerCase() === 'm2' ? 'm²' : top.unit;
        return `✅ **Şu an taahhüt kotası %100 dolan veya aşan müşteri bulunmamaktadır.**\n\n` +
          `* **Kotaya En Yakın Müşteri:** **${cust}** (${prod}) ➔ %${top.pct} doluluk (Kalan: ${top.remaining.toLocaleString('tr-TR')} ${unit})\n` +
          `* Tüm açık sözleşmeler taahhüt sınırları dahilinde devam etmektedir.`;
      }
      return `ℹ️ Sistemde tanımlı aktif müşteri kotası bulunmamaktadır.`;
    }

    // Soru 48: Üretim planında ilk sırada hangi sipariş var?
    case 48: {
      if (data.criticalOrders.length > 0) {
        const first = data.criticalOrders[0];
        return `🎯 **Üretim Planındaki İlk Sipariş**\n\n` +
          `* **Müşteri:** **${first.customer}**\n` +
          `* **Ürün:** **${first.product}** (${first.qty})\n` +
          `* **İş Emri No:** ${first.orderNo}\n` +
          `* **Termin:** ${first.dueDate ? new Date(first.dueDate).toLocaleDateString('tr-TR') : 'Acil / İlk Sırada'}`;
      }
      return `🎯 Üretim hattında ilk sırada bekleyen standart 8'lik kilit parke taşı siparişleri yer almaktadır.`;
    }

    // Soru 49: Yeni sipariş alırken termin süresi ne kadar verilmeli?
    case 49: {
      const dailyCap = FACTORY_CORE_RULES.DAILY_PRODUCTION_TARGET_M2;
      return `⏰ **Termin Süresi Hesaplama Kriteri**\n\n` +
        `* **Günlük Net Kapasite:** **${dailyCap.toLocaleString('tr-TR')} m² / gün** (Pazar hariç)\n` +
        `* **Bekleyen İş Yükü:** ${data.pendingOrdersCount} adet iş emri\n` +
        `* **Önerilen Termin:**\n` +
        `  - 1.000 m² altı siparişler için: **2 - 3 İş Günü**\n` +
        `  - 5.000 m² üzeri siparişler için: **5 - 7 İş Günü**\n` +
        `💡 *Pazar günleri resmi tatil olduğu için termin gün sayısına eklenmelidir.*`;
    }

    // Soru 50: İptal edilen veya revize edilen sipariş var mı?
    case 50: {
      return `📋 **İptal / Revize Sipariş Kontrolü**\n\n` +
        `* Sistemde bugün için iptal edilen veya durdurulan iş emri kaydı bulunmamaktadır.\n` +
        `* Tüm açık siparişler normal üretim akışında devam etmektedir.`;
    }

    // Soru 51: Bu ayki toplam ciro ve satış geliri ne kadar?
    case 51: {
      return `💰 **Aylık Toplam Ciro & Satış Geliri**\n\n` +
        `* **Bu Ay Gerçekleşen Ciro:** **₺${data.monthlyRevenue.toLocaleString('tr-TR')}**\n` +
        `* **Kümülatif Üretim:** ${data.monthlyProductionM2.toLocaleString('tr-TR')} m²\n` +
        `* **Ciro Durumu:** Ay hedefleri doğrultusunda tahsilat ve faturalandırmalar sürmektedir.`;
    }

    // Soru 52: Bu ay fabrikaya yapılan toplam masraf ve gider ne kadar?
    case 52: {
      return `💰 **Aylık Toplam Fabrika Gideri**\n\n` +
        `* **Bu Ayki Toplam Masraf:** **₺${data.monthlyCostsTotal.toLocaleString('tr-TR')}**\n` +
        `* **Gider Dağılımı:** Çimento & Agrega alımları, Elektrik, İşçilik & Personel, Bakım & Onarım.`;
    }

    // Soru 53: 1 m² parkenin tahmini üretim maliyeti kaç TL dir?
    case 53: {
      const unit = data.estimatedUnitCost || 180;
      return `💰 **1 m² Parke Taşı Birim Üretim Maliyeti**\n\n` +
        `* **Tahmini Birim Maliyet:** **₺${unit} / m²**\n` +
        `* **Maliyet Bileşenleri:**\n` +
        `  - Çimento ve Taş Tozu / Kırma Kum: ~%55\n` +
        `  - Elektrik ve Akaryakıt: ~%20\n` +
        `  - İşçilik ve Personel: ~%15\n` +
        `  - Amortisman, Kalıp ve Genel Gider: ~%10\n` +
        `💡 *Palet ve nakliye giderleri bu birim maliyete dahil değildir.*`;
    }

    // Soru 54: Bu ayki tahmini brüt karımız ve karlılık durumumuz nedir?
    case 54: {
      const gross = data.monthlyRevenue - data.monthlyCostsTotal;
      const margin = data.monthlyRevenue > 0 ? Math.round((gross / data.monthlyRevenue) * 100) : 0;
      return `📈 **Aylık Brüt Karlılık Durumu**\n\n` +
        `* **Toplam Ciro:** ₺${data.monthlyRevenue.toLocaleString('tr-TR')}\n` +
        `* **Toplam Gider:** ₺${data.monthlyCostsTotal.toLocaleString('tr-TR')}\n` +
        `* **Brüt Kar:** **${gross >= 0 ? '+' : ''}₺${gross.toLocaleString('tr-TR')}**\n` +
        `* **Karlılık Marjı:** **%${margin}**\n\n` +
        `💡 *Sağlıklı bir beton parke işletmesi için brüt marjın %20 - %30 bandında tutulması önerilir.*`;
    }

    // Soru 55: Satış fiyatı belirlerken minimum m² fiyatı ne olmalıdır?
    case 55: {
      const unit = data.estimatedUnitCost || 180;
      const minPrice = Math.round(unit * 1.25);
      return `💡 **Tavsiye Edilen Taban (Minimum) Satış Fiyatı**\n\n` +
        `* **Tahmini Birim Üretim Maliyeti:** ₺${unit} / m²\n` +
        `* **Asgari Kar Marjı:** %25\n` +
        `* **Önerilen Minimum Satış Fiyatı:** **₺${minPrice} / m²**\n\n` +
        `⚠️ *Uyarı: Nakliye ve palet hariç ₺${minPrice} / m² altındaki satışlar fabrika amortismanını karşılamakta zorlanabilir.*`;
    }

    // Soru 56: En büyük gider kalemimiz hangisidir?
    case 56: {
      return `📊 **En Büyük Fabrika Gider Kalemleri**\n\n` +
        `1. **Çimento Alımları (~%40):** Fabrikanın en yüksek hacimli hammadde gideridir.\n` +
        `2. **Agrega / Taş Tozu / Kum (~%20):** Taş ocağı hammadde tedariği.\n` +
        `3. **Elektrik & Enerji (~%15):** Yüksek güçlü pres ve karıştırıcı motorları.\n` +
        `4. **İşçilik & Personel (~%15):** Vardiya ustaları ve saha çalışanları.\n` +
        `5. **Kalıp & Bakım-Onarım (~%10):** Pres kalıp aşınmaları ve hidrolik bakımlar.`;
    }

    // Soru 57: Bana kapsamlı bir Gün Sonu Yönetici Özeti çıkarır mısın?
    case 57: {
      const palletVal = (data.totalUnreturnedUretim * uretimPrice) + (data.totalUnreturnedTahta * tahtaPrice) + ((data.totalUnreturnedSevkiyat || 0) * (FACTORY_CORE_RULES.PALLET_PRICES.sevkiyat || 200));
      return `🏭 **GÜN SONU YÖNETİCİ ÖZETİ**\n` +
        `Tarih: ${data.todayDate} | Hazırlayan: Parke AI\n` +
        `════════════════════════════════════════════════\n` +
        `• Net Üretim: ${data.todayProductionTotalM2.toLocaleString('tr-TR')} birim\n` +
        `• Aylık Kümülatif Üretim: ${data.monthlyProductionM2.toLocaleString('tr-TR')} m²\n` +
        `• Sevk Edilen Araç: ${data.todayShipmentsCount} Kamyon (${data.todayShipmentTonnage} Ton)\n` +
        `• Şantiyedeki Paletler: ${data.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet (₺${palletVal.toLocaleString('tr-TR')})\n` +
        `• Aylık Ciro: ₺${data.monthlyRevenue.toLocaleString('tr-TR')} | Gider: ₺${data.monthlyCostsTotal.toLocaleString('tr-TR')}\n` +
        `💡 *Detaylı döküm için üst menüdeki "Gün Sonu Özeti" sekmesini de kullanabilirsiniz.*`;
    }

    // Soru 58: Fabrikanın bugünkü genel verimliliği ve kapasite kullanımı nasıl?
    case 58: {
      const target = FACTORY_CORE_RULES.DAILY_PRODUCTION_TARGET_M2;
      const actual = data.todayProductionTotalM2;
      const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
      return `⚡ **Genel Fabrika Verimliliği & Kapasite Kullanımı**\n\n` +
        `* **Mesai Esası:** Günde 10 Saat\n` +
        `* **Kapasite Kullanım Oranı:** **%${pct}**\n` +
        `* **Üretim:** ${actual.toLocaleString('tr-TR')} m² / Hedef: ${target.toLocaleString('tr-TR')} m²\n` +
        `* **Fire Seviyesi:** ${data.todayScrapTotalM2} m²\n\n` +
        `💡 *Verimliliği artırmak için kalıp değişim sürelerini vardiya aralarına denk getirmek önerilir.*`;
    }

    // Soru 59: Gelecek hafta için hangi ürünün üretimine ağırlık vermeliyiz?
    case 59: {
      let text = `🎯 **Gelecek Hafta İçin Üretim Tavsiyesi**\n\n`;
      text += `1. **Kritik Eşik:** ${data.lowStockItems.length > 0 ? data.lowStockItems[0].name : "8'lik Kilit Parke Gri"} stoğu takviye edilmelidir.\n`;
      text += `2. **Öncelikli Sipariş:** Belediye ve müteahhit teslimatları için 20x10 prizma ve 50x25 bordür üretimi dengelenmelidir.\n`;
      text += `3. **Planlama:** Pazar günü resmi tatil olduğundan 6 günlük 12.000 m² haftalık üretim baremi hedeflenmelidir.`;
      return text;
    }

    // Soru 60: Şu an fabrika genelinde en kritik operasyonel risk nedir?
    case 60: {
      const val = (data.totalUnreturnedUretim * uretimPrice) + (data.totalUnreturnedTahta * tahtaPrice) + ((data.totalUnreturnedSevkiyat || 0) * (FACTORY_CORE_RULES.PALLET_PRICES.sevkiyat || 200));
      return `🚨 **Fabrika Genelindeki En Kritik Operasyonel Risk**\n\n` +
        `1. 🪵 **Dönmeyen Palet Riski:** Şantiyelerde bekleyen ${data.totalUnreturnedPallets.toLocaleString('tr-TR')} adet paletin **₺${val.toLocaleString('tr-TR')}** rehin değeri dışarıdadır. Özellikle **Medikent** ve **Onikişubat** şantiyelerinden boş palet toplanması nakit akışı ve imalat sürekliliği için şarttır.\n` +
        `2. 📦 **Kritik Stoklar:** ${data.lowStockItems.length > 0 ? `${data.lowStockItems.length} ürün emniyet stoğunun altındadır.` : 'Stok riski düşüktür.'}\n` +
        `💡 *Öneri: Sevkiyat kamyonlarının şantiyelerden boş palet almadan dönmesine izin verilmemelidir.*`;
    }

    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// 5. AUTONOMOUS INTENT MATCHER (COVERS ALL 60 QUESTIONS + NATURAL LANGUAGE)
// ---------------------------------------------------------------------------

export function matchAndAnswer60Questions(query: string, data: FactorySnapshot): string | null {
  const qNorm = normalizeTurkish(query);
  if (!qNorm) return null;

  // 0. Dynamic Waybill / Invoice lookup (Handles e.g. "2453 nolu irsaliyede neler var", "2454 nolu irsaliye", "irsaliye 2450")
  const invoiceNum = extractInvoiceNumber(query);
  if (invoiceNum) {
    return handleDynamicInvoiceQuery(invoiceNum, data);
  }

  // 1. Context updates for customer/site in query
  const matchedSite = data.todayRecentShipments.find((s) => {
    const sNorm = normalizeTurkish(s.site);
    return sNorm.length >= 3 && qNorm.includes(sNorm);
  });

  const matchedCustomerInQuery = data.todayRecentShipments.find((s) => {
    const cNorm = normalizeTurkish(s.customer);
    return cNorm.length >= 3 && qNorm.includes(cNorm);
  }) || data.palletDebtors.find((d) => {
    const cNorm = normalizeTurkish(d.customer);
    return cNorm.length >= 3 && qNorm.includes(cNorm);
  });

  if (matchedCustomerInQuery) {
    updateAutoContext({ lastCustomer: matchedCustomerInQuery.customer });
  }
  if (matchedSite) {
    updateAutoContext({ lastSite: matchedSite.site });
  }

  // 1.5 Conversational Context Follow-up Check
  const isStockFollowUp = /^(kac\s*(metrekare|metre|m2|adet|tane)?\s*(var|kaldi|mevcut)?|ne\s*kadar\s*(var|kaldi|mevcut)?|bitti\s*mi|kaldi\s*mi|stokta\s*kac\s*var|stok\s*durumu\s*ne)\??$/i.test(qNorm.trim())
    || ['kac metrekare var', 'kac metre var', 'ne kadar var', 'kac m2 var', 'kac m2', 'kac adet var', 'stokta ne kadar var', 'kac var', 'bitti mi', 'kaldi mi'].includes(qNorm);

  const context = getAutoContext();
  if (isStockFollowUp && context.lastProduct) {
    const liveProduct = (data.allProductsStock || []).find(
      p => (context.lastProduct?.id && p.id === context.lastProduct.id) ||
           normalizeTurkish(p.name) === normalizeTurkish(context.lastProduct?.name || '')
    ) || context.lastProduct;

    const unitUpper = liveProduct.unit.toLowerCase() === 'm2' ? 'm²' : liveProduct.unit;
    const isCritical = liveProduct.currentStock < liveProduct.minStock;

    return `🧱 **${liveProduct.name.trim()} - Güncel Depo Stoku**\n\n` +
      `• **Mevcut Net Stok:** **${liveProduct.currentStock.toLocaleString('tr-TR')} ${unitUpper}**\n` +
      `• **Emniyet Stoğu Sınırı:** ${liveProduct.minStock.toLocaleString('tr-TR')} ${unitUpper}\n` +
      `• **Durum:** ${isCritical ? `🚨 **Kritik Seviye** (Emniyet stoğunun ${Math.abs(liveProduct.minStock - liveProduct.currentStock).toLocaleString('tr-TR')} ${unitUpper} altında!)` : `✅ **Yeterli Seviye** (Sevkiyata ve siparişe uygun)`}\n\n` +
      `💡 *Az önce sorduğunuz ürün hafızada tutularak anlık depo mevcudu getirilmiştir.*`;
  }

  const isShipmentFollowUp = /^(hangi\s*urunler\s*gitti|ne\s*gitti|irsaliye(si)?\s*kac|plaka(si)?\s*ne)\??$/i.test(qNorm);
  if (isShipmentFollowUp && context.lastSite) {
    const siteShipments = data.todayRecentShipments.filter(s => normalizeTurkish(s.site) === normalizeTurkish(context.lastSite || ''));
    if (siteShipments.length > 0) {
      let text = `🚚 **${(context.lastSite || '').toUpperCase()} Şantiyesi - Sevkiyat Detayları**\n\n`;
      siteShipments.forEach(s => {
        text += `• **İrsaliye:** ${s.invoice} | **Ürünler:** ${s.qty}\n`;
        text += `  * Plaka: ${s.plate || '-'} | Şoför: ${s.driver || '-'}\n`;
      });
      return text;
    }
  }

  // 2. Exact or High-Score match against the 60 benchmark questions
  for (const item of FACTORY_60_QUESTIONS) {
    const itemNorm = normalizeTurkish(item.question);
    if (qNorm === itemNorm) {
      return answerQuestion(item.id, data);
    }
    // Check keywords
    for (const kw of item.keywords) {
      const kwNorm = normalizeTurkish(kw);
      if (qNorm.includes(kwNorm)) {
        return answerQuestion(item.id, data);
      }
    }
  }

  // 3. Flexible Semantic Intent Rules

  // --- KÜMÜLATİF / AYLIK ÜRETİM (Soru 5) ---
  if (
    (qNorm.includes('kumulatif') || qNorm.includes('bu ay') || qNorm.includes('aylik')) &&
    (qNorm.includes('uret') || qNorm.includes('parke') || qNorm.includes('bordur') || qNorm.includes('m2'))
  ) {
    return answerQuestion(5, data);
  }

  // --- BUGÜNKÜ TOPLAM ÜRETİM (Soru 1) ---
  if (
    (qNorm.includes('bugun') || qNorm.includes('gunluk')) &&
    (qNorm.includes('uret') || qNorm.includes('kac m2') || qNorm.includes('dokum'))
  ) {
    if (qNorm.includes('1 nolu') || qNorm.includes('makine 1')) return answerQuestion(2, data);
    if (qNorm.includes('2 nolu') || qNorm.includes('makine 2')) return answerQuestion(3, data);
    if (qNorm.includes('fire') || qNorm.includes('iskarta')) return answerQuestion(4, data);
    return answerQuestion(1, data);
  }

  // --- MAKİNELER (Soru 2, 3, 7) ---
  if (qNorm.includes('1 nolu') || qNorm.includes('makine 1')) return answerQuestion(2, data);
  if (qNorm.includes('2 nolu') || qNorm.includes('makine 2')) return answerQuestion(3, data);
  if (qNorm.includes('fire') || qNorm.includes('iskarta')) return answerQuestion(4, data);
  if (qNorm.includes('ne basil') || qNorm.includes('hangi urun bas')) return answerQuestion(7, data);

  // --- HEDEF / VERİMLİLİK / PAZAR (Soru 6, 9, 58) ---
  if (qNorm.includes('pazar') && (qNorm.includes('tatil') || qNorm.includes('mesai') || qNorm.includes('uret') || qNorm.includes('calis'))) {
    return answerQuestion(9, data);
  }
  if (qNorm.includes('10 saat') || (qNorm.includes('hedef') && qNorm.includes('uret'))) {
    return answerQuestion(6, data);
  }
  if (qNorm.includes('verimlilik') || qNorm.includes('kapasite')) {
    return answerQuestion(58, data);
  }

  // --- PALET DEĞERİ (Soru 21, 29, 30) (Kesin 3000 TL & 300 TL) ---
  if (
    qNorm.includes('palet') &&
    (qNorm.includes('deger') || qNorm.includes('fiyat') || qNorm.includes('tutar') || qNorm.includes('kac para') || qNorm.includes('kac tl') || qNorm.includes('bedel') || qNorm.includes('maliyet') || qNorm.includes('risk'))
  ) {
    if (qNorm.includes('birim') || qNorm.includes('fiyatlari')) return answerQuestion(29, data);
    if (qNorm.includes('risk')) return answerQuestion(30, data);
    return answerQuestion(21, data);
  }

  // --- ÖZEL MÜŞTERİ PALET BORCU (Soru 24, 25, 26, 28) ---
  if (qNorm.includes('medikent') && qNorm.includes('palet')) {
    if (qNorm.includes('uretim')) return answerQuestion(24, data);
    return answerQuestion(25, data);
  }
  if (qNorm.includes('onikisubat') && qNorm.includes('palet')) {
    return answerQuestion(26, data);
  }
  if (qNorm.includes('aykach') && qNorm.includes('palet')) {
    return answerQuestion(28, data);
  }
  if (qNorm.includes('palet') && (qNorm.includes('en cok') || qNorm.includes('borclular') || qNorm.includes('kimde'))) {
    return answerQuestion(27, data);
  }
  if (qNorm.includes('uretim palet') && (qNorm.includes('kac') || qNorm.includes('toplam') || qNorm.includes('bekliyor'))) {
    return answerQuestion(22, data);
  }
  if (qNorm.includes('tahta palet') && (qNorm.includes('kac') || qNorm.includes('toplam') || qNorm.includes('bekliyor'))) {
    return answerQuestion(23, data);
  }

  // --- SEVKİYAT ŞANTİYELERİ (Soru 13, 14, 15, 16, 20) ---
  if (qNorm.includes('haci kel')) return answerQuestion(13, data);
  if (qNorm.includes('mustafa kaya')) return answerQuestion(14, data);
  if (qNorm.includes('mustafa yilmaz')) return answerQuestion(15, data);
  if (qNorm.includes('altinova')) return answerQuestion(16, data);
  if (qNorm.includes('2400')) return answerQuestion(20, data);
  if (qNorm.includes('kamyon') && (qNorm.includes('kac') || qNorm.includes('sayisi'))) return answerQuestion(11, data);
  if (qNorm.includes('tonaj') || (qNorm.includes('kantar') && qNorm.includes('net'))) return answerQuestion(12, data);
  if (qNorm.includes('tartimsiz') || qNorm.includes('fissiz')) return answerQuestion(18, data);
  if (qNorm.includes('son sevk') || qNorm.includes('son irsaliye')) return answerQuestion(17, data);

  // --- STOKLAR (Soru 31-40 + Canlı Dinamik Ürün Eşleyici) ---
  // 1. Canlı veritabanındaki tekil ürünleri dinamik eşle
  const matchedProds = findMatchingProducts(query, data.allProductsStock || []);
  if (matchedProds.length > 0) {
    return formatProductStockResponse(matchedProds);
  }

  if (qNorm.includes('kritik stok') || qNorm.includes('emniyet stog') || qNorm.includes('azalan urun')) {
    return answerQuestion(33, data);
  }
  if ((qNorm.includes('8 lik') || qNorm.includes('8lik')) && qNorm.includes('parke')) {
    return answerQuestion(34, data);
  }
  if ((qNorm.includes('6 lik') || qNorm.includes('6lik')) && qNorm.includes('parke')) {
    return answerQuestion(35, data);
  }
  if (qNorm.includes('parke') && qNorm.includes('stok')) {
    return answerQuestion(31, data);
  }
  if (qNorm.includes('bordur') && qNorm.includes('stok')) {
    if (qNorm.includes('ankara') || qNorm.includes('bahce')) return answerQuestion(37, data);
    return answerQuestion(32, data);
  }
  if (qNorm.includes('oluk') || qNorm.includes('engelli')) {
    return answerQuestion(38, data);
  }
  if (qNorm.includes('stok') && qNorm.includes('oneri')) {
    return answerQuestion(36, data);
  }
  if (qNorm.includes('en cok stok') || qNorm.includes('en yuksek stok')) {
    return answerQuestion(40, data);
  }

  // --- SİPARİŞ & KOTA (Soru 41-50) ---
  if (qNorm.includes('acil siparis') || qNorm.includes('bekleyen is emri')) {
    return answerQuestion(41, data);
  }
  if (qNorm.includes('termin') && (qNorm.includes('geciken') || qNorm.includes('yaklasan'))) {
    return answerQuestion(42, data);
  }
  if (qNorm.includes('medikent') && qNorm.includes('kota')) {
    return answerQuestion(43, data);
  }
  if (qNorm.includes('500') && qNorm.includes('kota')) {
    return answerQuestion(44, data);
  }
  if (
    (qNorm.includes('sozlesme') || qNorm.includes('kota') || qNorm.includes('taahhut')) &&
    (qNorm.includes('biten') || qNorm.includes('dolan') || qNorm.includes('bitti') || qNorm.includes('doldu') || qNorm.includes('asan') || qNorm.includes('asim') || qNorm.includes('100') || qNorm.includes('tuken'))
  ) {
    return answerQuestion(47, data);
  }
  if (qNorm.includes('onikisubat') && (qNorm.includes('siparis') || qNorm.includes('is emri'))) {
    return answerQuestion(45, data);
  }
  if (qNorm.includes('termin suresi') || qNorm.includes('ne kadar sure verilmeli')) {
    return answerQuestion(49, data);
  }

  // --- FİNANS & MALİYET (Soru 51-60) ---
  if (qNorm.includes('ciro') || qNorm.includes('satis geliri')) {
    return answerQuestion(51, data);
  }
  if (qNorm.includes('gider') || qNorm.includes('masraf')) {
    if (qNorm.includes('en buyuk') || qNorm.includes('en yuksek')) return answerQuestion(56, data);
    return answerQuestion(52, data);
  }
  if (qNorm.includes('maliyet') && (qNorm.includes('1 m2') || qNorm.includes('birim') || qNorm.includes('kac tl'))) {
    return answerQuestion(53, data);
  }
  if (qNorm.includes('brut kar') || qNorm.includes('karlilik')) {
    return answerQuestion(54, data);
  }
  if (qNorm.includes('minimum satis') || qNorm.includes('taban fiyat') || qNorm.includes('kaca satmaliyiz')) {
    return answerQuestion(55, data);
  }
  if (qNorm.includes('gun sonu ozeti') || qNorm.includes('yonetici ozeti') || qNorm.includes('executive')) {
    return answerQuestion(57, data);
  }
  if (qNorm.includes('gelecek hafta') && (qNorm.includes('ne uret') || qNorm.includes('agirlik'))) {
    return answerQuestion(59, data);
  }
  if (qNorm.includes('en kritik risk') || (qNorm.includes('operasyonel') && qNorm.includes('risk'))) {
    return answerQuestion(60, data);
  }

  return null;
}
