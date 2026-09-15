import { FactorySnapshot, normalizeTurkish } from './aiFactoryBrain';

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
interface ConversationContext {
  lastCustomer?: string;
  lastSite?: string;
  lastInvoice?: string;
  lastTopic?: 'pallet' | 'production' | 'shipment' | 'stock' | 'order' | 'finance';
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
    keywords: ['bugun', 'toplam', 'uretim', 'm2', 'miktar', 'kac m2'],
  },
  {
    id: 2,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: '1 nolu parke makinesinin bugünkü üretimi ne kadar?',
    keywords: ['1 nolu', '1.', 'makine 1', 'parke makinesi', 'makine 1 uretim'],
  },
  {
    id: 3,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: '2 nolu bordür makinesinin bugünkü dökümü ne kadar?',
    keywords: ['2 nolu', '2.', 'makine 2', 'bordur makinesi', 'makine 2 dokum'],
  },
  {
    id: 4,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bugünkü fire ve ıskarta miktarı nedir?',
    keywords: ['fire', 'iskarta', 'hurda', 'fire orani', 'cop'],
  },
  {
    id: 5,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bu ay kümülatif toplam kaç m² parke ve bordür ürettik?',
    keywords: ['bu ay', 'aylik', 'kumulatif', 'aylik uretim', 'bu ay uretim'],
  },
  {
    id: 6,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Günlük 10 saatlik çalışma hedefine ulaştık mı?',
    keywords: ['hedef', '10 saat', 'gunluk hedef', 'kapasite', 'hedefe ulas'],
  },
  {
    id: 7,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Makinelerde şu an hangi ürünler basılıyor?',
    keywords: ['hangi urun', 'ne basiliyor', 'kalip', 'makineler ne uretiyor'],
  },
  {
    id: 8,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bugün kaç vardiya veya döküm girişi yapıldı?',
    keywords: ['vardiya', 'giris sayisi', 'dokum sayisi', 'kac vardiya'],
  },
  {
    id: 9,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Pazar günleri fabrikada üretim yapılıyor mu?',
    keywords: ['pazar', 'tatil', 'hafta sonu', 'pazar mesai', 'pazar calisma'],
  },
  {
    id: 10,
    category: 'production',
    categoryTitle: '🏭 Üretim & Makineler',
    question: 'Bu ay en çok hangi taş ve ebat üretildi?',
    keywords: ['en cok uretilen', 'en fazla uretim', 'lider urun', 'hangi tas cok'],
  },

  // ----------------- BÖLÜM 2: SEVKİYAT, KANTAR & İRSALİYELER (11-20) -----------------
  {
    id: 11,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün kantardan toplam kaç kamyon ve irsaliye çıktı?',
    keywords: ['kamyon sayisi', 'kac kamyon', 'kac irsaliye', 'cikis sayisi', 'arac sayisi'],
  },
  {
    id: 12,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugünkü kantar net sevk tonajı ne kadar?',
    keywords: ['net tonaj', 'kantar tonaj', 'kac ton', 'toplam tonaj', 'agirlik'],
  },
  {
    id: 13,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün Onikişubat Hacı Kel şantiyesine ne kadar sevkiyat yapıldı?',
    keywords: ['haci kel', 'onikisubat haci kel', 'haci kel sevkiyat'],
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
    keywords: ['altinova', 'medikent altinova', 'altinova parke', 'altinova sevkiyat'],
  },
  {
    id: 17,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Bugün çıkan son sevkiyatlar ve irsaliyeler hangileri?',
    keywords: ['son sevkiyatlar', 'cikan son kamyonlar', 'son irsaliyeler', 'bugunku cikislar'],
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
    keywords: ['bugun sevk parke', 'bugun sevk bordur', 'sevk edilen metraj'],
  },
  {
    id: 20,
    category: 'shipment',
    categoryTitle: '🚚 Sevkiyat & Kantar',
    question: 'Sevkiyatta 2400 nolu irsaliyede ne var?',
    keywords: ['2400', 'irsaliye 2400', 'irs 2400', '2400 nolu'],
  },

  // ----------------- BÖLÜM 3: PALET TAKİBİ & ŞANTİYE ZİMMETLERİ (21-30) -----------------
  {
    id: 21,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Paletlerin toplam değeri ne kadar?',
    keywords: ['paletlerin degeri', 'palet degeri', 'palet kac para', 'palet maliyeti', 'palet tutari', 'rehin degeri'],
  },
  {
    id: 22,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Şantiyelerde toplam kaç adet üretim paleti bekliyor?',
    keywords: ['kac adet uretim paleti', 'toplam uretim paleti', 'disarida uretim paleti'],
  },
  {
    id: 23,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Şantiyelerde toplam kaç adet tahta palet bekliyor?',
    keywords: ['kac adet tahta palet', 'toplam tahta palet', 'disarida tahta palet'],
  },
  {
    id: 24,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Medikent den ne kadar üretim paleti alacağımız var?',
    keywords: ['medikent uretim paleti', 'medikent uretim', 'medikent ten uretim'],
  },
  {
    id: 25,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Medikent firmasının toplam tahta ve üretim palet borcu ne kadar?',
    keywords: ['medikent palet', 'medikent toplam palet', 'medikent borcu'],
  },
  {
    id: 26,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Onikişubat Belediyesi şantiyelerinde kaç paletimiz kalmış?',
    keywords: ['onikisubat palet', 'onikisubat belediyesi palet', 'onikisubat borcu'],
  },
  {
    id: 27,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'En çok palet borcu olan ilk 5 müşteri hangileri?',
    keywords: ['en cok palet borcu', 'palet borclulari', 'palet borcu olanlar', 'ilk 5 palet'],
  },
  {
    id: 28,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Aykach firmasında kaç adet paletimiz var?',
    keywords: ['aykach palet', 'aykach firmasi', 'aykach tahta', 'aykach uretim'],
  },
  {
    id: 29,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Üretim paletleri ve tahta paletlerin birim bedelleri nedir?',
    keywords: ['palet birim fiyat', 'uretim paleti kac tl', 'tahta palet kac tl', 'palet fiyati'],
  },
  {
    id: 30,
    category: 'pallet',
    categoryTitle: '🪵 Palet Takibi',
    question: 'Şantiyelerdeki paletlerin toplam finansal riski kaç TL?',
    keywords: ['finansal risk', 'palet riski', 'palet zarari', 'donmeyen palet tutari'],
  },

  // ----------------- BÖLÜM 4: DEPO STOKLARI & KRİTİK EŞİKLER (31-40) -----------------
  {
    id: 31,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Depoda şu an toplam kaç m² parke stoku var?',
    keywords: ['mevcut parke stoku', 'depoda kac m2 parke', 'toplam parke stogu'],
  },
  {
    id: 32,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Depoda şu an toplam kaç metre bordür stoku var?',
    keywords: ['mevcut bordur stoku', 'depoda kac metre bordur', 'toplam bordur stogu'],
  },
  {
    id: 33,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Emniyet stoğunun altına inen kritik ürünler hangileri?',
    keywords: ['kritik stok', 'emniyet stogu', 'azalan urunler', 'alarm veren stoklar'],
  },
  {
    id: 34,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: '8 lik kilit parke taşında ne kadar stok kaldı?',
    keywords: ['8 lik', '8 lik kilit', '8 lik parke', '8cm kilit'],
  },
  {
    id: 35,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: '6 lık parke taşından depoda stok var mı?',
    keywords: ['6 lik', '6 lik kilit', '6 lik parke', '6cm parke'],
  },
  {
    id: 36,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Stokları tükenmek üzere olan ürünler için ne önerirsin?',
    keywords: ['stok onerisi', 'ne uretmeliyiz', 'hangi urun azaldi'],
  },
  {
    id: 37,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Ankara bordürü ve bahçe bordürü stok durumu nedir?',
    keywords: ['ankara borduru', 'bahce borduru', 'bordur stok'],
  },
  {
    id: 38,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Yağmur oluğu ve engelli takip taşı stokları ne kadar?',
    keywords: ['yagmur olugu', 'engelli tasi', 'oluk stoku', 'engelli takip'],
  },
  {
    id: 39,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Depodaki tüm ürünlerin kalem sayısı kaçtır?',
    keywords: ['kac cesit urun', 'toplam urun kalemi', 'stok kalem sayisi'],
  },
  {
    id: 40,
    category: 'stock',
    categoryTitle: '📦 Depo & Stok',
    question: 'Şu an depomuzda en yüksek stoklu olan ürün hangisidir?',
    keywords: ['en cok stok', 'en yuksek stok', 'stok lideri', 'depodaki en fazla urun'],
  },

  // ----------------- BÖLÜM 5: SİPARİŞLER, TERMİNLER & KOTALAR (41-50) -----------------
  {
    id: 41,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Bekleyen acil iş emirleri ve siparişler hangileri?',
    keywords: ['bekleyen siparisler', 'acil is emirleri', 'oncelikli siparis'],
  },
  {
    id: 42,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Termini yaklaşan veya teslimatı geciken sipariş var mı?',
    keywords: ['termin', 'geciken', 'gecikmis siparis', 'teslimat tarihi'],
  },
  {
    id: 43,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Medikent in taahhüt kotası doldu mu, ne kadar kaldı?',
    keywords: ['medikent kota', 'medikent taahhut', 'medikent kalan'],
  },
  {
    id: 44,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Kotası 500 m² altına düşen veya aşan müşteriler hangileri?',
    keywords: ['500 m2 alti', 'kritik kota', 'kotasi bitenler', 'kota asimi'],
  },
  {
    id: 45,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Onikişubat Belediyesi nin aktif sipariş ve iş emirleri nelerdir?',
    keywords: ['onikisubat siparis', 'onikisubat is emri', 'belediye siparis'],
  },
  {
    id: 46,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Şu an toplam kaç aktif müşteri kotası sözleşmesi var?',
    keywords: ['kac sozlesme', 'aktif kota sayisi', 'toplam musteri kotasi'],
  },
  {
    id: 47,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Hangi müşterinin taahhüt kotası %100 doldu?',
    keywords: ['kotasi dolan', '%100 doldu', 'fazla sevk', 'kota dolumu'],
  },
  {
    id: 48,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Üretim planında ilk sırada hangi sipariş var?',
    keywords: ['planda ilk sirada', 'siradaki siparis', 'hangi is emri sirada'],
  },
  {
    id: 49,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'Yeni sipariş alırken termin süresi ne kadar verilmeli?',
    keywords: ['termin suresi', 'kac gun sonra', 'teslimat ne zaman verilmeli'],
  },
  {
    id: 50,
    category: 'order',
    categoryTitle: '🎯 Siparişler & Kotalar',
    question: 'İptal edilen veya revize edilen sipariş var mı?',
    keywords: ['iptal siparis', 'iptal is emri', 'revize'],
  },

  // ----------------- BÖLÜM 6: FİNANS, CİRO, MALİYET & YÖNETİM (51-60) -----------------
  {
    id: 51,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bu ayki toplam ciro ve satış geliri ne kadar?',
    keywords: ['bu ayki ciro', 'toplam ciro', 'satis geliri', 'kazanc', 'ciro ne kadar'],
  },
  {
    id: 52,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bu ay fabrikaya yapılan toplam masraf ve gider ne kadar?',
    keywords: ['bu ayki gider', 'toplam masraf', 'maliyet toplami', 'fabrika gideri'],
  },
  {
    id: 53,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: '1 m² parkenin tahmini üretim maliyeti kaç TL dir?',
    keywords: ['1 m2 maliyet', 'birim maliyet', 'm2 maliyeti', 'maliyet kac tl'],
  },
  {
    id: 54,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bu ayki tahmini brüt karımız ve karlılık durumumuz nedir?',
    keywords: ['brut kar', 'karlilik', 'net kar', 'kazandik mi', 'kar durumu'],
  },
  {
    id: 55,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Satış fiyatı belirlerken minimum m² fiyatı ne olmalıdır?',
    keywords: ['minimum satis fiyati', 'kaca satmaliyiz', 'tavsiye fiyat', 'taban fiyat'],
  },
  {
    id: 56,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'En büyük gider kalemimiz hangisidir?',
    keywords: ['en buyuk gider', 'masraf kalemi', 'cimento gideri', 'iscilik gideri'],
  },
  {
    id: 57,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Bana kapsamlı bir Gün Sonu Yönetici Özeti çıkarır mısın?',
    keywords: ['gun sonu ozeti', 'yonetici ozeti', 'executive briefing', 'gunun ozeti'],
  },
  {
    id: 58,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Fabrikanın bugünkü genel verimliliği ve kapasite kullanımı nasıl?',
    keywords: ['verimlilik', 'kapasite kullanimi', 'fabrika performansi'],
  },
  {
    id: 59,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Gelecek hafta için hangi ürünün üretimine ağırlık vermeliyiz?',
    keywords: ['gelecek hafta', 'hangi urune agirlik', 'uretim tavsiyesi'],
  },
  {
    id: 60,
    category: 'finance',
    categoryTitle: '💰 Finans & Yönetim',
    question: 'Şu an fabrika genelinde en kritik operasyonel risk nedir?',
    keywords: ['en kritik risk', 'risk nedir', 'tehlike nedir', 'dikkat edilmesi gereken'],
  },
];

// ---------------------------------------------------------------------------
// 4. AUTONOMOUS INTENT MATCHER & LIVE RESPONDER (THE 60 BENCHMARKS)
// ---------------------------------------------------------------------------
export function matchAndAnswer60Questions(query: string, data: FactorySnapshot): string | null {
  const qNorm = normalizeTurkish(query);
  const context = getAutoContext();

  const uretimPrice = FACTORY_CORE_RULES.PALLET_PRICES.uretim; // 3000 TL
  const tahtaPrice = FACTORY_CORE_RULES.PALLET_PRICES.tahta;   // 300 TL

  // Check 1: Target site shipment query e.g. "Onikişubat Hacı Kel şantiyesine ne kadar gitti"
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

  // -------------------------------------------------------------------------
  // PALET DEĞERİ VE FİYATLANDIRMA (Kesin 3000 TL & 300 TL Kuralı)
  // -------------------------------------------------------------------------
  if (
    (qNorm.includes('palet') && (qNorm.includes('deger') || qNorm.includes('fiyat') || qNorm.includes('tutar') || qNorm.includes('kac para') || qNorm.includes('kac tl') || qNorm.includes('bedel'))) ||
    qNorm.includes('paletlerin degeri')
  ) {
    const totalUretimVal = data.totalUnreturnedUretim * uretimPrice; // 1570 * 3000 = 4.710.000 TL
    const totalTahtaVal = data.totalUnreturnedTahta * tahtaPrice;   // 2913 * 300 = 873.900 TL
    const totalPalletVal = totalUretimVal + totalTahtaVal;          // 5.583.900 TL

    let text = `💰 **Şantiyelerdeki Paletlerin Finansal Değer Raporu**\n\n`;
    text += `*Fabrika Kuralı: Üretim Paleti = ₺${uretimPrice.toLocaleString('tr-TR')} / ad | Tahta Palet = ₺${tahtaPrice.toLocaleString('tr-TR')} / ad*\n\n`;
    text += `• 🏭 **Üretim Paletleri:** **${data.totalUnreturnedUretim.toLocaleString('tr-TR')} Adet** x ₺${uretimPrice.toLocaleString('tr-TR')} = **₺${totalUretimVal.toLocaleString('tr-TR')}**\n`;
    text += `• 🪵 **Tahta Paletler:** **${data.totalUnreturnedTahta.toLocaleString('tr-TR')} Adet** x ₺${tahtaPrice.toLocaleString('tr-TR')} = **₺${totalTahtaVal.toLocaleString('tr-TR')}**\n`;
    text += `════════════════════════════════════════════════\n`;
    text += `💵 **TOPLAM ŞANTİYE PALET REHİN DEĞERİ:** **₺${totalPalletVal.toLocaleString('tr-TR')}**\n\n`;

    text += `📦 **Toplam Bekleyen:** **${data.totalUnreturnedPallets.toLocaleString('tr-TR')} Adet Palet** şantiyelerdedir.\n\n`;

    if (data.palletDebtors.length > 0) {
      text += `⚠️ **En Çok Palet Riski Taşıyan Müşteriler (3.000 TL & 300 TL ile):**\n`;
      data.palletDebtors.slice(0, 5).forEach((d, idx) => {
        const dVal = (d.uretim * uretimPrice) + (d.tahta * tahtaPrice);
        text += `${idx + 1}. **${d.customer}**: **${d.balance} Adet** (Üretim: ${d.uretim} ad, Tahta: ${d.tahta} ad) ➔ **~₺${dVal.toLocaleString('tr-TR')}**\n`;
      });
      text += `\n💡 *Tavsiye: Boş palet teslim etmeyen müşterilere yeni sevkiyatta palet teslim tutanağı imzalattırınız.*`;
    }
    return text;
  }

  // -------------------------------------------------------------------------
  // SPESİFİK MÜŞTERİ PALET BORCU (Örn: "Medikent ten ne kadar üretim paleti alacağımız var")
  // -------------------------------------------------------------------------
  if (qNorm.includes('palet') && (matchedCustomerInQuery || context.lastCustomer)) {
    const custName = (matchedCustomerInQuery ? matchedCustomerInQuery.customer : context.lastCustomer) || '';
    const custRecords = data.palletBalances.filter(p => normalizeTurkish(p.customer) === normalizeTurkish(custName));

    if (custRecords.length > 0) {
      let totalUretimSent = 0, totalUretimRet = 0, uretimBal = 0;
      let totalTahtaSent = 0, totalTahtaRet = 0, tahtaBal = 0;
      let totalSevkSent = 0, totalSevkRet = 0, sevkiyatBal = 0;
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
      const isUretimSpecific = qNorm.includes('uretim');
      const isTahtaSpecific = qNorm.includes('tahta') || qNorm.includes('ahsap');

      let text = `🪵 **${custName.toUpperCase()} - Palet Zimmet & Alacak Durumu**\n\n`;

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

      // Site Breakdown
      const sitesList = Object.entries(siteMap).filter(([_, s]) => (s.uretim + s.tahta) > 0);
      if (sitesList.length > 1) {
        text += `📍 **Şantiye Bazlı Dağılım:**\n`;
        sitesList.forEach(([sName, s]) => {
          text += `• **${sName}:** ${s.uretim} Üretim Paleti, ${s.tahta} Tahta Palet (Toplam: ${s.uretim + s.tahta} ad)\n`;
        });
        text += `\n`;
      }

      const estVal = (uretimBal * uretimPrice) + (tahtaBal * tahtaPrice);
      text += `💰 **Müşteri Palet Teminat / Maliyet Değeri:** **~₺${estVal.toLocaleString('tr-TR')}** *(Üretim: ₺3.000, Tahta: ₺300)*\n`;
      return text;
    }
  }

  // -------------------------------------------------------------------------
  // SPESİFİK ŞANTİYE / İRSALİYE SEVKİYATI (Örn: "Hacı Kel şantiyesine ne kadar gitti")
  // -------------------------------------------------------------------------
  if (matchedSite || (qNorm.includes('sevk') && matchedCustomerInQuery)) {
    let siteShipments = data.todayRecentShipments;
    let targetTitle = '';

    if (matchedSite) {
      const sNorm = normalizeTurkish(matchedSite.site);
      siteShipments = siteShipments.filter(s => normalizeTurkish(s.site) === sNorm);
      targetTitle = `${matchedSite.customer} - ${matchedSite.site} Şantiyesi`;
    } else if (matchedCustomerInQuery) {
      const cNorm = normalizeTurkish(matchedCustomerInQuery.customer);
      siteShipments = siteShipments.filter(s => normalizeTurkish(s.customer) === cNorm);
      targetTitle = matchedCustomerInQuery.customer;
    }

    if (siteShipments.length > 0) {
      let totalM2 = 0, totalMetre = 0, totalAdet = 0, totalWeight = 0;
      siteShipments.forEach(s => {
        totalM2 += s.totalM2;
        totalMetre += s.totalMetre;
        totalAdet += s.totalAdet;
        totalWeight += s.netWeight;
      });

      let text = `🚚 **${targetTitle.toUpperCase()} BUGÜNKÜ SEVKİYATI**\n\n`;
      text += `Bugün tamamlanan toplam **${siteShipments.length} sefer/çıkış** yapılmıştır:\n\n`;

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

      text += `📊 **Günlük Toplam:**\n`;
      if (totalM2 > 0) text += `• **Toplam Parke:** **${totalM2.toLocaleString('tr-TR')} m²**\n`;
      if (totalMetre > 0) text += `• **Toplam Bordür:** **${totalMetre.toLocaleString('tr-TR')} Metre**\n`;
      if (totalAdet > 0) text += `• **Toplam Adetli Ürün:** **${totalAdet.toLocaleString('tr-TR')} Adet**\n`;
      text += `• **Toplam Sefer Sayısı:** **${siteShipments.length} Kamyon**\n`;
      if (totalWeight > 0) {
        text += `• **Net Kantar Tonajı:** **${(totalWeight / 1000).toFixed(1)} Ton**\n`;
      }
      return text;
    }
  }

  // -------------------------------------------------------------------------
  // İRSALİYE NO SORGULAMA (Örn: "2400 nolu irsaliye")
  // -------------------------------------------------------------------------
  const invoiceMatch = qNorm.match(/\b(\d{3,5})\b/);
  if (invoiceMatch && (qNorm.includes('irsaliye') || qNorm.includes('irs') || qNorm.includes('nolu'))) {
    const invNo = invoiceMatch[1];
    const found = data.todayRecentShipments.find(s => s.invoice.includes(invNo));
    if (found) {
      let text = `📄 **İRSALİYE DETAYI [No: ${found.invoice}]**\n\n`;
      text += `• **Müşteri:** ${found.customer}\n`;
      text += `• **Şantiye:** ${found.site}\n`;
      if (found.plate || found.driver) {
        text += `• **Araç / Şoför:** ${found.plate || '-'} ${found.driver ? `(${found.driver})` : ''}\n`;
      }
      text += `• **İçerik:** ${found.qty}\n`;
      if (found.netWeight > 0) {
        text += `• **Kantar Tonajı:** ${(found.netWeight / 1000).toFixed(1)} Ton\n`;
      }
      return text;
    }
  }

  // -------------------------------------------------------------------------
  // PAZAR MESAYİSİ (Soru 9)
  // -------------------------------------------------------------------------
  if (qNorm.includes('pazar') && (qNorm.includes('tatil') || qNorm.includes('uretim') || qNorm.includes('mesai') || qNorm.includes('calis'))) {
    return `📅 **Haftalık Çalışma Takvimi & Pazar Kuralı**\n\n` +
      `* **Pazar Günleri:** Fabrikamızda **Pazar günleri resmi tatildir ve üretim yapılmaz.**\n` +
      `* **Haftalık Çalışma:** Pazartesi - Cumartesi günleri arasıdır (Haftada 6 gün).\n` +
      `* **Günlük Mesai:** Günde **10 saat** esas alınır.\n` +
      `* **Aylık Planlama:** Üretim planlama ve termin hesapları Pazar günleri hariç tutularak hesaplanır.`;
  }

  // -------------------------------------------------------------------------
  // 10 SAATLİK HEDEF / VERİMLİLİK (Soru 6, 58)
  // -------------------------------------------------------------------------
  if (qNorm.includes('hedef') || qNorm.includes('10 saat') || qNorm.includes('kapasite') || qNorm.includes('verimlilik')) {
    const target = FACTORY_CORE_RULES.DAILY_PRODUCTION_TARGET_M2;
    const actual = data.todayProductionTotalM2;
    const pct = target > 0 ? Math.round((actual / target) * 100) : 0;

    let text = `🎯 **Günlük Hedef & Kapasite Verimlilik Röntgeni**\n\n`;
    text += `* **Günlük Çalışma Mesaisi:** 10 Saat\n`;
    text += `* **Günlük Fabrika Hedefi:** **${target.toLocaleString('tr-TR')} m²**\n`;
    text += `* **Bugünkü Gerçekleşen Net Üretim:** **${actual.toLocaleString('tr-TR')} birim**\n`;
    text += `* **Hedef Gerçekleşme Oranı:** **%${pct}**\n\n`;

    if (pct >= 100) {
      text += `🎉 **Tebrikler!** Fabrika bugünkü 10 saatlik tam kapasite üretim hedefine ulaşmıştır.`;
    } else if (pct >= 70) {
      text += `⚡ Fabrika hedefe yaklaşmaktadır. Vardiya sonuna kadar kalan hedef: **${(target - actual).toLocaleString('tr-TR')} m²**.`;
    } else {
      text += `⚠️ Bugünkü üretim günlük kapasite hedefinin altındadır. Makinelerin arıza/kalıp değişim sürelerini kontrol etmeniz önerilir.`;
    }
    return text;
  }

  // -------------------------------------------------------------------------
  // MİNİMUM SATIŞ FİYATI & KARLILIK TAVSİYESİ (Soru 55)
  // -------------------------------------------------------------------------
  if (qNorm.includes('minimum satis') || qNorm.includes('kaca sat') || qNorm.includes('taban fiyat') || (qNorm.includes('fiyat') && qNorm.includes('oneri'))) {
    const unitCost = data.estimatedUnitCost || 180;
    const minSalePrice = Math.round(unitCost * 1.25);

    let text = `💡 **Tavsiye Edilen Minimum Satış Fiyatı Analizi**\n\n`;
    text += `* **Tahmini m² Birim Üretim Maliyeti:** **₺${unitCost}/m²**\n`;
    text += `* **Öngörülen Sağlıklı Kar Marjı:** %25\n`;
    text += `* **Önerilen Taban (Minimum) Satış Fiyatı:** **₺${minSalePrice}/m²**\n\n`;
    text += `⚠️ *Uyarı: Nakliye ve palet depozitosu hariç olmak üzere, ₺${minSalePrice}/m² altındaki satışlar fabrika amortisman ve genel giderlerini karşılamakta yetersiz kalabilir.*`;
    return text;
  }

  return null; // Let the general engine handle if no specific 60-question benchmark matched
}
