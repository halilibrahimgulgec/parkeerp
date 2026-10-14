import React from 'react';

interface ParkeSahaLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showTagline?: boolean;
  showDomain?: boolean;
  className?: string;
  iconOnly?: boolean;
}

export default function ParkeSahaLogo({
  size = 'md',
  showTagline = true,
  showDomain = false,
  className = '',
  iconOnly = false,
}: ParkeSahaLogoProps) {
  const sizeMap = {
    xs: { icon: 24, title: 'text-sm', tag: 'text-[9px]', domain: 'text-[8px]' },
    sm: { icon: 32, title: 'text-base', tag: 'text-[10px]', domain: 'text-[9px]' },
    md: { icon: 40, title: 'text-lg', tag: 'text-xs', domain: 'text-[10px]' },
    lg: { icon: 52, title: 'text-2xl', tag: 'text-xs sm:text-sm', domain: 'text-xs' },
    xl: { icon: 68, title: 'text-3xl sm:text-4xl', tag: 'text-sm sm:text-base', domain: 'text-xs sm:text-sm' },
  };

  const currentSize = sizeMap[size];

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Vektörel Amblem: Kilit Parke + İstifli Palet + Yukarı Yükselen Tahsilat Oku */}
      <div 
        className="relative flex items-center justify-center rounded-2xl shadow-lg shadow-amber-500/10 transition-transform hover:scale-105 overflow-hidden flex-shrink-0"
        style={{ width: currentSize.icon, height: currentSize.icon }}
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="psGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
            <linearGradient id="psDarkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
            <linearGradient id="psAccentGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>

          {/* Arka Plan Taban Kartı */}
          <rect width="100" height="100" rx="22" fill="url(#psDarkGrad)" />
          
          {/* İnce Altın Dış Kontur */}
          <rect x="2" y="2" width="96" height="96" rx="20" stroke="url(#psGoldGrad)" strokeWidth="1.5" strokeOpacity="0.4" />

          {/* Kilit Parke Taşı Geometrisi (İzometrik Alt Katman) */}
          <path
            d="M50 16L78 30V48L50 62L22 48V30L50 16Z"
            fill="#334155"
            stroke="url(#psGoldGrad)"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />

          {/* Palet Katmanı Çizgileri (Ahşap İstif Çıtaları) */}
          <path
            d="M32 40L50 49L68 40"
            stroke="#fbbf24"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d="M32 47L50 56L68 47"
            stroke="#f59e0b"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          {/* Yükselen Tahsilat / Başarı Oku (Paletten Tahsilata İvmesi) */}
          <path
            d="M48 68L68 46M68 46H52M68 46V62"
            stroke="url(#psGoldGrad)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Yeşil Güven / Bakiye Noktası */}
          <circle cx="78" cy="22" r="4.5" fill="url(#psAccentGrad)" />
        </svg>
      </div>

      {/* Tipografi ve Slogan Bloğu */}
      {!iconOnly && (
        <div className="flex flex-col justify-center min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-black tracking-tight text-white ${currentSize.title}`}>
              Parke<span className="text-amber-400">Saha</span>
            </span>
            {showDomain && (
              <span className={`font-mono text-amber-300/80 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded ${currentSize.domain}`}>
                parkesaha.com
              </span>
            )}
          </div>
          {showTagline && (
            <p className={`font-medium text-slate-300/90 tracking-normal leading-tight ${currentSize.tag}`}>
              Kalıptan Palete, Paletten Tahsilata.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
