import React, { useState, useMemo } from 'react';
import ParkeSahaLogo from '../components/ParkeSahaLogo';
import {
  Factory,
  Scale,
  Truck,
  Boxes,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Download,
  Smartphone,
  QrCode,
  Calculator,
  TrendingUp,
  Send,
  Phone,
  Mail,
  MapPin,
  Sparkles,
  Layers,
  ChevronRight,
  Check,
  Clock,
  LogIn,
  Sliders,
  DollarSign,
  AlertCircle
} from 'lucide-react';

interface LandingPageProps {
  onGoToLogin: () => void;
}

export default function LandingPage({ onGoToLogin }: LandingPageProps) {
  // Demo Talep Form State
  const [formName, setFormName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // İnteraktif Tasarruf Hesaplayıcısı State
  const [dailyM2, setDailyM2] = useState<number>(1500);

  // Dinamik Tasarruf Hesaplaması
  const savings = useMemo(() => {
    // Yıllık 280 çalışma günü baz alınarak
    const annualM2 = dailyM2 * 280;
    // Palet kaçak/hasar önleme (her 50 m² için 1 palet = 250 TL palet maliyeti, %3 kaçak tasarrufu)
    const palletSavings = Math.round((annualM2 / 50) * 0.03 * 280);
    // Kantar & tonaj fire önleme (m² başına ortalama 1.5 TL fire/kaçak önleme)
    const scaleSavings = Math.round(annualM2 * 1.6);
    // Çimento & reçete standardizasyonu (m² başına ortalama 2.2 TL hammadde tasarrufu)
    const recipeSavings = Math.round(annualM2 * 2.2);
    const totalAnnual = palletSavings + scaleSavings + recipeSavings;
    const monthlyAverage = Math.round(totalAnnual / 12);

    return {
      palletSavings,
      scaleSavings,
      recipeSavings,
      totalAnnual,
      monthlyAverage,
    };
  }, [dailyM2]);

  const handleDemoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSubmitted(true);
    }, 700);
  };

  const apkDownloadUrl = 'https://github.com/halilibrahimgulgec/parkeerp/releases/download/mobile-apk/ParkeSaha.apk';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(apkDownloadUrl)}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* 1. HEADER / NAVBAR */}
      <header className="sticky top-0 z-50 bg-slate-950/85 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <ParkeSahaLogo size="md" showTagline={false} showDomain={true} />
          </div>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a href="#surec" className="hover:text-amber-400 transition-colors">Nasıl Çalışır?</a>
            <a href="#ozellikler" className="hover:text-amber-400 transition-colors">Özellikler</a>
            <a href="#tasarruf" className="hover:text-amber-400 transition-colors">Tasarruf Hesabı</a>
            <a href="#mobil" className="hover:text-amber-400 transition-colors">Mobil APK</a>
            <a href="#paketler" className="hover:text-amber-400 transition-colors">Paketler</a>
            <a href="#iletisim" className="hover:text-amber-400 transition-colors">İletişim</a>
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={onGoToLogin}
              className="px-4 py-2 text-sm font-semibold text-slate-200 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl transition-all flex items-center gap-2"
            >
              <LogIn size={16} className="text-amber-400" />
              <span>Giriş Yap</span>
            </button>
            <a
              href="#demo"
              className="hidden sm:inline-flex px-4 py-2 text-sm font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 rounded-xl shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95"
            >
              Demo Talep Et
            </a>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION */}
      <section className="relative pt-12 pb-24 overflow-hidden">
        {/* Arka plan ışık efektleri */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] bg-amber-500/10 blur-[140px] pointer-events-none rounded-full" />
        <div className="absolute top-1/3 right-10 w-96 h-96 bg-orange-600/10 blur-[130px] pointer-events-none rounded-full" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          {/* Rozet */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs sm:text-sm font-semibold mb-6 shadow-inner">
            <Sparkles size={15} className="text-amber-400 animate-pulse" />
            <span>Kilit Parke, Bordür ve Briket Fabrikaları İçin Özel Olarak Geliştirildi</span>
          </div>

          {/* Ana Başlık (Slogan) */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-5xl mx-auto leading-tight mb-6">
            Kalıptan Palete,{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-amber-200">
              Paletten Tahsilata.
            </span>
          </h1>

          {/* Açıklama */}
          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed mb-10">
            Beton parke fabrikalarının reçete hammadde düşümünü, kalıp basım ömrünü, kantar tartım fişini ve müşteri cari bakiyesini tek bir bulut ve mobil ekranda birleştiren yeni nesil saha yönetim sistemi.
          </p>

          {/* Butonlar */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <a
              href="#demo"
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-base rounded-2xl shadow-xl shadow-amber-500/25 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
            >
              <span>Ücretsiz Demo Talep Edin</span>
              <ArrowRight size={18} />
            </a>
            <button
              onClick={onGoToLogin}
              className="w-full sm:w-auto px-8 py-4 bg-slate-900/90 hover:bg-slate-800 text-white font-bold text-base rounded-2xl border border-slate-700/80 hover:border-slate-600 transition-all flex items-center justify-center gap-2"
            >
              <LogIn size={18} className="text-amber-400" />
              <span>Sisteme Giriş Yap</span>
            </button>
            <a
              href={apkDownloadUrl}
              className="w-full sm:w-auto px-6 py-4 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/30 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2"
            >
              <Download size={16} />
              <span>Android APK İndir (v1.0)</span>
            </a>
          </div>

          {/* Güven ve Özellik Rozetleri */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-4 border-t border-slate-800/60 text-xs sm:text-sm text-slate-400 font-medium">
            <div className="flex items-center justify-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Sıfır Sunucu & Kurulum</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Kantar Tartım & İrsaliye</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Çift Yönlü Palet Takibi</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span>Android Mobil Saha Desteği</span>
            </div>
          </div>

          {/* HERO PREVIEW MOCKUP */}
          <div className="mt-14 relative max-w-5xl mx-auto">
            <div className="rounded-2xl p-2 sm:p-4 bg-gradient-to-b from-slate-800/80 to-slate-900/90 border border-slate-700/80 shadow-2xl shadow-amber-500/5">
              <div className="bg-slate-950 rounded-xl p-5 border border-slate-800 text-left">
                {/* Mockup Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-rose-500" />
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-xs text-slate-400 font-mono ml-2">parkesaha.com/dashboard • Canlı Saha Görünümü</span>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    Pres ve Kantar Canlı
                  </span>
                </div>

                {/* KPI Kartları Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>GÜNLÜK ÜRETİM</span>
                      <Factory size={16} className="text-amber-400" />
                    </div>
                    <div className="text-2xl font-black text-white">2.850 m²</div>
                    <div className="text-xs text-emerald-400 mt-1 font-medium">8'lik Kilit Parke (Gri + Kırmızı)</div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>KANTAR & SEVKİYAT</span>
                      <Scale size={16} className="text-blue-400" />
                    </div>
                    <div className="text-2xl font-black text-white">16 Kamyon</div>
                    <div className="text-xs text-blue-400 mt-1 font-medium">412 Ton Net Sevkiyat / 0 Kaçak</div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>CARİ BAKİYE & TAHSİLAT</span>
                      <TrendingUp size={16} className="text-emerald-400" />
                    </div>
                    <div className="text-2xl font-black text-white">₺ 1.840.000</div>
                    <div className="text-xs text-amber-400 mt-1 font-medium">Otomatik Sevkiyat Kasa Kotası Aktif</div>
                  </div>
                </div>

                {/* Süreç İlerleme Çubuğu */}
                <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-4">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Uçtan Uca Süreç Döngüsü (Kalıp → Palet → Tahsilat)
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-center text-xs">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 text-amber-300 font-bold">
                      1. Reçete & Pres
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 text-amber-300 font-bold">
                      2. Kürlenme & Havuz
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 text-amber-300 font-bold">
                      3. Paletleme & Barkod
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2 text-blue-300 font-bold">
                      4. Kantar & İrsaliye
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 text-emerald-300 font-bold">
                      5. Cari Tahsilat
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. UÇTAN UCA SÜREÇ (3 ADIMDA PARKE SAHA) */}
      <section id="surec" className="py-24 bg-slate-900/50 border-y border-slate-800/60 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-extrabold text-amber-400 tracking-widest uppercase mb-3">
              Kalıptan Palete, Paletten Tahsilata
            </h2>
            <p className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              3 Adımda Eksiksiz Fabrika Döngüsü
            </p>
            <p className="text-slate-400 mt-4 text-base">
              Beton parke üretiminde en çok para kaybedilen üç kritik noktayı birbirine bağlıyoruz: Reçete, Depozitolu Palet ve Kantar Tartımı.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* ADIM 1 */}
            <div className="bg-slate-950 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-7 transition-all hover:-translate-y-1 shadow-xl relative overflow-hidden group">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-6 group-hover:scale-110 transition-transform">
                <Factory size={28} />
              </div>
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">Aşama 01</div>
              <h3 className="text-xl font-bold text-white mb-3">Kalıptan... (Pres & Üretim)</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-5">
                Kalıp basım sayacından girilen metrekareye göre; çimento, mıcır, taş tozu, kum ve boya reçetesinden otomatik stok düşümü yapılır.
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-amber-400" />
                  <span>Kalıp ömrü, basım sayısı ve aşınma takibi</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-amber-400" />
                  <span>Çimento ve agrega reçete optimizasyonu</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-amber-400" />
                  <span>Vardiya ve pres operatörü verimlilik analizi</span>
                </li>
              </ul>
            </div>

            {/* ADIM 2 */}
            <div className="bg-slate-950 border border-slate-800 hover:border-orange-500/40 rounded-2xl p-7 transition-all hover:-translate-y-1 shadow-xl relative overflow-hidden group">
              <div className="w-14 h-14 rounded-2xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400 mb-6 group-hover:scale-110 transition-transform">
                <Boxes size={28} />
              </div>
              <div className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-1">Aşama 02</div>
              <h3 className="text-xl font-bold text-white mb-3">Palete... (Kür & Saha Stoku)</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-5">
                Kür odasından veya havuzdan çıkan parkeler paletlenir. Sağlam ve kırık taşlar anında fireye yazılır, ahşap paletler depozitoya işlenir.
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-orange-400" />
                  <span>Ahşap palet kayıplarını sıfırlayan depozito takibi</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-orange-400" />
                  <span>Açık saha m² stok ve parti lot barkodlama</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-orange-400" />
                  <span>Kürlenme süresi tamamlanmadan sevke izin vermeme</span>
                </li>
              </ul>
            </div>

            {/* ADIM 3 */}
            <div className="bg-slate-950 border border-slate-800 hover:border-emerald-500/40 rounded-2xl p-7 transition-all hover:-translate-y-1 shadow-xl relative overflow-hidden group">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition-transform">
                <Scale size={28} />
              </div>
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">Aşama 03</div>
              <h3 className="text-xl font-bold text-white mb-3">Tahsilata... (Kantar & Kasa)</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-5">
                Kamyon kantar tartımı (boş/dolu) ile irsaliye anında çıkar. Müşteri cari bakiyesine işlenir; vadesi geçen müşteriye sevk otomatik durdurulur.
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-400" />
                  <span>Net tonaj ve kamyon plakası kayıtlı kantar fişi</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-400" />
                  <span>Müteahhit cari hesap bakiye ve kota denetimi</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-400" />
                  <span>Nakit, çek, senet ve havale tahsilat takibi</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 4. İNTERAKTİF TASARRUF & KÂR HESAPLAYICISI */}
      <section id="tasarruf" className="py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-amber-500/20 rounded-3xl p-8 sm:p-12 shadow-2xl relative">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              {/* Sol Taraf: Açıklama ve Slider */}
              <div className="lg:col-span-7">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-400/10 text-amber-400 rounded-lg text-xs font-bold uppercase mb-4">
                  <Calculator size={14} />
                  <span>ParkeSaha Kâr & Tasarruf Simülatörü</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-4">
                  ParkeSaha Fabrikanızda Kaç TL Tasarruf Sağlar?
                </h2>
                <p className="text-slate-400 text-sm sm:text-base leading-relaxed mb-8">
                  Günlük kilit parke ve bordür basım m² kapasitenizi seçin; kantar kaçaklarının önlenmesi, hammadde reçete optimizasyonu ve kayıp ahşap palet takibinden yılda ne kadar para tasarruf edeceğinizi görün.
                </p>

                {/* Sürgü Kontrolü */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-6 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-slate-300">Günlük Üretim Kapasiteniz:</span>
                    <span className="text-2xl font-black text-amber-400 font-mono">
                      {dailyM2.toLocaleString('tr-TR')} m² <span className="text-xs font-normal text-slate-400">/ gün</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min="300"
                    max="6000"
                    step="100"
                    value={dailyM2}
                    onChange={(e) => setDailyM2(Number(e.target.value))}
                    className="w-full h-3 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 mt-2 font-mono">
                    <span>300 m² (Küçük Tesis)</span>
                    <span>2.500 m² (Orta Fabrika)</span>
                    <span>6.000 m² (Büyük Tesis)</span>
                  </div>
                </div>

                {/* Kalem Kalem Tasarruf Maddeleri */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3">
                    <div className="text-slate-400">Palet Kaçak Önleme</div>
                    <div className="text-base font-bold text-amber-300 mt-1 font-mono">
                      ₺ {savings.palletSavings.toLocaleString('tr-TR')}
                    </div>
                  </div>
                  <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3">
                    <div className="text-slate-400">Kantar Tonaj Koruma</div>
                    <div className="text-base font-bold text-blue-300 mt-1 font-mono">
                      ₺ {savings.scaleSavings.toLocaleString('tr-TR')}
                    </div>
                  </div>
                  <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3">
                    <div className="text-slate-400">Reçete & Fire Tasarrufu</div>
                    <div className="text-base font-bold text-emerald-300 mt-1 font-mono">
                      ₺ {savings.recipeSavings.toLocaleString('tr-TR')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Sağ Taraf: Büyük Toplam Kartı */}
              <div className="lg:col-span-5 bg-gradient-to-b from-amber-500/15 via-slate-950 to-slate-950 border border-amber-500/30 rounded-2xl p-7 text-center relative shadow-2xl">
                <span className="text-xs uppercase tracking-wider font-extrabold text-amber-400">
                  Tahmini Yıllık Net Kazanç & Tasarruf
                </span>
                <div className="text-4xl sm:text-5xl font-black text-white font-mono mt-3 mb-2 tracking-tight">
                  ₺ {savings.totalAnnual.toLocaleString('tr-TR')}
                </div>
                <div className="text-xs text-emerald-400 font-semibold mb-6">
                  Ortalama Aylık ₺ {savings.monthlyAverage.toLocaleString('tr-TR')} Tasarruf
                </div>

                <div className="text-xs text-slate-400 border-t border-slate-800 pt-5 mb-6 text-left space-y-2">
                  <p>✓ Geri dönmeyen ahşap paletler cariye yazılır, zarar önlenir.</p>
                  <p>✓ Boş kantar tartımı (dara) kaçakları ortadan kaldırılır.</p>
                  <p>✓ Kalıp basım sayacı reçeteyi tam denetler.</p>
                </div>

                <a
                  href="#demo"
                  className="w-full block py-3.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black rounded-xl text-sm transition-all"
                >
                  Fabrikanız İçin Demo İsteyin
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. ÖZELLİKLER GRİDİ */}
      <section id="ozellikler" className="py-24 bg-slate-900/30 border-y border-slate-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-extrabold text-amber-400 tracking-widest uppercase mb-3">
              Kapsamlı Modüller
            </h2>
            <p className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              Sahanın Tüm Zorlukları İçin Hazırlandı
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-6 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4">
                <Smartphone size={24} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Android Saha Uygulaması</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Kantar kulübesindeki görevli ve forklift operatörü cep telefonundan tek dokunuşla sevk yapar, irsaliye basar.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-6 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4">
                <Scale size={24} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Çift Tartım Dijital Kantar</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Kamyon boş dara ve dolu tartımı otomatik hesaplanır, plaka bazlı sevk fişi saniyeler içinde oluşturulur.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-6 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center mb-4">
                <Layers size={24} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Kalıp & Makine Ömrü</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Hangi kalıbın kaçıncı baskıda olduğunu izleyin; taş yüksekliği ve aşınma sınırına yaklaşınca sistem uyarır.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-6 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
                <DollarSign size={24} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">m² Başına Net Maliyet & Kâr</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Her basılan kilit taşının içine çimento, agrega, boya, işçilik ve elektrik payı otomatik eklenir; net kârınızı bilin.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-6 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4">
                <ShieldCheck size={24} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Müşteri Risk & Kota Kilidi</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Bakiyesini aşan veya vadesi geçmiş müteahhitlere kantar çıkışında sevk emri verilmesini otomatik engeller.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-6 hover:border-slate-700 transition-all">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center mb-4">
                <Factory size={24} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Çoklu Tesis & Şube Desteği</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Farklı şehirlerdeki veya sahalardaki pres hatlarınızı tek bir merkez yönetim ekranından anlık izleyin.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. MOBİL UYGULAMA & APK QR BÖLÜMÜ */}
      <section id="mobil" className="py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 border border-slate-800 rounded-3xl p-8 sm:p-12 shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-bold uppercase mb-4">
                  <Smartphone size={14} />
                  <span>Saha İçin Hazır Mobil APK</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-4">
                  ParkeSaha Cebinizde. Sahada, Kantarda, Forkliftte.
                </h2>
                <p className="text-slate-400 text-sm sm:text-base leading-relaxed mb-8">
                  Fabrika yöneticileri, saha sorumluları ve kantar memurları için özel olarak optimize edilmiş Android uygulamamız yayında. İnternet kesilse bile hızlı arayüzle işlemlerinizi aksatmadan sürdürün.
                </p>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <a
                    href={apkDownloadUrl}
                    className="w-full sm:w-auto px-7 py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all flex items-center justify-center gap-2.5"
                  >
                    <Download size={20} />
                    <span>ParkeSaha.apk İndir (6.4 MB)</span>
                  </a>
                  <span className="text-xs text-slate-400">
                    Android 8.0 ve üzeri tüm telefon ve tabletlerle uyumludur.
                  </span>
                </div>
              </div>

              {/* QR Kod Kartı */}
              <div className="lg:col-span-4 flex flex-col items-center justify-center bg-slate-950 border border-slate-800 rounded-2xl p-6 text-center">
                <div className="p-3 bg-white rounded-xl shadow-md mb-3">
                  <img
                    src={qrCodeUrl}
                    alt="ParkeSaha APK QR Kodu"
                    className="w-40 h-40 object-contain"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 mb-1">
                  <QrCode size={14} />
                  <span>Kameranızla Okutun</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Telefonunuzun kamerasını QR koda tutarak APK'yı doğrudan telefonunuza indirebilirsiniz.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. PAKETLER & FİYATLANDIRMA */}
      <section id="paketler" className="py-24 bg-slate-900/30 border-y border-slate-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-extrabold text-amber-400 tracking-widest uppercase mb-3">
              Şeffaf Fiyatlandırma
            </h2>
            <p className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              Fabrikanızın Büyüklüğüne Uygun Planlar
            </p>
            <p className="text-slate-400 mt-4 text-base">
              Gizli masraf yok, sunucu kurulum ücreti yok. Yalnızca fabrikanızın ihtiyaç duyduğu modüller.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* BAŞLANGIÇ */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 flex flex-col">
              <h3 className="text-xl font-bold text-white mb-2">Başlangıç Tesisi</h3>
              <p className="text-slate-400 text-xs mb-6">Tek pres hattı olan küçük üreticiler için.</p>
              <div className="mb-6">
                <span className="text-3xl font-black text-white">İletişime Geçin</span>
              </div>
              <ul className="space-y-3 text-xs text-slate-300 mb-8 flex-1">
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> 1 Pres Hattı / Reçete Takibi</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Standart Kantar & İrsaliye</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> 3 Kullanıcı Erişimi</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Web & Mobil Erişim</li>
              </ul>
              <a href="#demo" className="w-full block py-3 text-center bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl border border-slate-700 transition-colors">
                Teklif Alın
              </a>
            </div>

            {/* PRO FABRİKA (ÖNE ÇIKAN) */}
            <div className="bg-slate-950 border-2 border-amber-500 rounded-2xl p-8 flex flex-col relative shadow-2xl shadow-amber-500/10">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 text-xs font-black rounded-full uppercase tracking-wider">
                En Çok Tercih Edilen
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Pro Fabrika</h3>
              <p className="text-slate-400 text-xs mb-6">Orta ve büyük ölçekli beton parke fabrikaları.</p>
              <div className="mb-6">
                <span className="text-3xl font-black text-amber-400">Özel Teklif</span>
                <span className="text-xs text-slate-400 block mt-1">Yıllık avantajlı lisans</span>
              </div>
              <ul className="space-y-3 text-xs text-slate-300 mb-8 flex-1">
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> <strong>Tüm Modüller Dahil</strong></li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Çift Yönlü Ahşap Palet Depozito Takibi</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Otomatik Cari Bakiye & Kota Kilidi</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Kalıp Sayacı ve Aşınma Uyarısı</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Sınırsız Kullanıcı ve Saha APK</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Öncelikli 7/24 WhatsApp Desteği</li>
              </ul>
              <a href="#demo" className="w-full block py-3 text-center bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 transition-all">
                Ücretsiz Demo Başlatın
              </a>
            </div>

            {/* KURUMSAL */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 flex flex-col">
              <h3 className="text-xl font-bold text-white mb-2">Kurumsal Çoklu Tesis</h3>
              <p className="text-slate-400 text-xs mb-6">Birden fazla il veya şantiyede tesisi olanlar.</p>
              <div className="mb-6">
                <span className="text-3xl font-black text-white">Kurumsal Çözüm</span>
              </div>
              <ul className="space-y-3 text-xs text-slate-300 mb-8 flex-1">
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Sınırsız Şube & Tesis Yönetimi</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Donanım & İndikatör Kantar Entegrasyonu</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Logo / Mikro / ERP Muhasebe Aktarımı</li>
                <li className="flex items-center gap-2"><Check size={14} className="text-amber-400" /> Özel Müşteri Temsilcisi</li>
              </ul>
              <a href="#demo" className="w-full block py-3 text-center bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl border border-slate-700 transition-colors">
                Bize Ulaşın
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 8. DEMO TALEP & İLETİŞİM FORMU */}
      <section id="demo" className="py-24 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-8 sm:p-12 shadow-2xl">
            <div className="text-center max-w-2xl mx-auto mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-400/10 text-amber-400 rounded-lg text-xs font-bold uppercase mb-3">
                <Sparkles size={14} />
                <span>Hemen Deneyin</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                ParkeSaha Canlı Demosunu Talep Edin
              </h2>
              <p className="text-slate-400 text-sm mt-3">
                Bilgilerinizi bırakın, uzmanımız fabrikanıza özel canlı demoyu göstersin veya anında test hesabınızı açsın.
              </p>
            </div>

            {submitted ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 text-center animate-fadeIn">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={36} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Talebiniz Başarıyla Alındı!</h3>
                <p className="text-slate-300 text-sm max-w-md mx-auto mb-6">
                  Teşekkür ederiz Sayın <strong>{formName}</strong>. Ekibimiz <strong>{formPhone}</strong> numaralı telefonunuz üzerinden en kısa sürede sizinle iletişime geçecektir.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={() => setSubmitted(false)}
                    className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
                  >
                    Yeni Talep Gönder
                  </button>
                  <a
                    href="mailto:info@parkesaha.com"
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-bold"
                  >
                    info@parkesaha.com ile İletişime Geç
                  </a>
                </div>
              </div>
            ) : (
              <form onSubmit={handleDemoSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Adınız Soyadınız *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ahmet Yılmaz"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-400 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Firma / Fabrika Unvanı *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Örnek Beton Parke San. Tic."
                      value={formCompany}
                      onChange={(e) => setFormCompany(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-400 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Telefon Numaranız *
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="0532 000 00 00"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-400 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Şehir
                    </label>
                    <input
                      type="text"
                      placeholder="Ankara, Konya, Gaziantep..."
                      value={formCity}
                      onChange={(e) => setFormCity(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-400 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Tesisiniz Hakkında Not / Günlük Kapasite
                  </label>
                  <textarea
                    rows={3}
                    placeholder="2 adet pres hattımız var, kantar ve palet takibi için görüşmek istiyoruz..."
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-amber-400 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition-colors resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-slate-950 font-black text-base rounded-2xl shadow-xl shadow-amber-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 mt-4"
                >
                  {loading ? (
                    <span>Gönderiliyor...</span>
                  ) : (
                    <>
                      <Send size={18} />
                      <span>Ücretsiz Demo Talebini Gönder</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* 9. FOOTER */}
      <footer id="iletisim" className="bg-slate-950 border-t border-slate-900 py-16 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            <div className="md:col-span-2">
              <div className="mb-4">
                <ParkeSahaLogo size="md" showTagline={true} showDomain={true} />
              </div>
              <p className="text-slate-400 max-w-sm leading-relaxed mb-4">
                Kilit parke, bordür ve briket fabrikaları için bulut tabanlı uçtan uca saha üretim, kantar ve tahsilat yönetim sistemi.
              </p>
              <div className="flex items-center gap-4 text-slate-400">
                <a href="mailto:info@parkesaha.com" className="hover:text-amber-400 flex items-center gap-1.5 transition-colors">
                  <Mail size={14} className="text-amber-400" />
                  <span>info@parkesaha.com</span>
                </a>
              </div>
            </div>

            <div>
              <h4 className="text-white font-bold uppercase tracking-wider text-xs mb-4">Hızlı Menü</h4>
              <ul className="space-y-2.5">
                <li><a href="#surec" className="hover:text-amber-400 transition-colors">Nasıl Çalışır?</a></li>
                <li><a href="#ozellikler" className="hover:text-amber-400 transition-colors">Özellikler</a></li>
                <li><a href="#tasarruf" className="hover:text-amber-400 transition-colors">Kâr Simülatörü</a></li>
                <li><a href="#mobil" className="hover:text-amber-400 transition-colors">Android APK</a></li>
                <li><a href="#paketler" className="hover:text-amber-400 transition-colors">Paketler</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-bold uppercase tracking-wider text-xs mb-4">Sistem & Güvenlik</h4>
              <ul className="space-y-2.5">
                <li><span className="text-slate-400">SSL 256-Bit Şifreleme</span></li>
                <li><span className="text-slate-400">Bulut Yedekleme & CDN</span></li>
                <li><span className="text-slate-400">KVKK ve Veri İzolasyonu</span></li>
                <li>
                  <button onClick={onGoToLogin} className="text-amber-400 hover:underline font-semibold flex items-center gap-1">
                    <LogIn size={13} />
                    <span>Personel Giriş Ekranı</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <p>© 2026 ParkeSaha. Tüm hakları saklıdır. parkesaha.com</p>
            <p className="text-amber-400 font-semibold">"Kalıptan Palete, Paletten Tahsilata."</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
