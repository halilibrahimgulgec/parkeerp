import React, { useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Scale,
  Flame,
  Boxes,
  Layers,
  CheckCircle2,
  Volume2,
  RefreshCw,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { WatchdogScanResult, WatchdogAnomaly, WatchdogAnomalyCategory } from '../types/aiWatchdogTypes';
import { ActionDraftPayload } from '../types/aiActionTypes';
import { speakTurkishText } from '../utils/aiVoiceTTS';
import { formatWatchdogBriefingForTTS } from '../utils/aiWatchdogEngine';

interface Props {
  scanResult: WatchdogScanResult | null;
  isLoading: boolean;
  onRefreshScan: () => void;
  onSelectActionDraft: (draft: ActionDraftPayload) => void;
}

export const AIWatchdogPanel: React.FC<Props> = ({
  scanResult,
  isLoading,
  onRefreshScan,
  onSelectActionDraft,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [isSpeakingBriefing, setIsSpeakingBriefing] = useState(false);

  const handleSpeakBriefing = () => {
    if (!scanResult) return;
    const text = formatWatchdogBriefingForTTS(scanResult);
    setIsSpeakingBriefing(true);
    speakTurkishText(
      text,
      () => setIsSpeakingBriefing(true),
      () => setIsSpeakingBriefing(false),
      () => setIsSpeakingBriefing(false)
    );
  };

  const anomalies = scanResult?.anomalies || [];

  const filteredAnomalies = anomalies.filter((a) => {
    if (selectedFilter === 'all') return true;
    if (selectedFilter === 'critical') return a.severity === 'critical';
    return a.category === selectedFilter;
  });

  const getCategoryIcon = (category: WatchdogAnomalyCategory) => {
    switch (category) {
      case 'scale_tare':
        return <Scale className="w-4 h-4 text-amber-500" />;
      case 'waste':
        return <Flame className="w-4 h-4 text-rose-500" />;
      case 'stock':
        return <Boxes className="w-4 h-4 text-blue-500" />;
      case 'pallet':
        return <Layers className="w-4 h-4 text-emerald-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    }
  };

  const getCategoryLabel = (category: WatchdogAnomalyCategory) => {
    switch (category) {
      case 'scale_tare':
        return 'Kantar & Dara';
      case 'waste':
        return 'Fire Oranı';
      case 'stock':
        return 'Kritik Stok';
      case 'pallet':
        return 'Palet Riski';
      default:
        return 'Genel Risk';
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/60 p-3 sm:p-4">
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-rose-500/10 text-rose-600 rounded-lg">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
              <span>Fabrika Bekçisi</span>
              {scanResult && scanResult.criticalCount > 0 && (
                <span className="text-[10px] bg-rose-500 text-white font-black px-1.5 py-0.2 rounded-full animate-pulse">
                  {scanResult.criticalCount} KRİTİK
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-500">
              Kantar dara sapmaları, aşırı makine fireleri ve palet risk radarı
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* TTS Audio Briefing Button */}
          <button
            onClick={handleSpeakBriefing}
            disabled={isLoading || !scanResult}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isSpeakingBriefing
                ? 'bg-amber-100 text-amber-800 animate-pulse border border-amber-300'
                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-sm'
            }`}
            title="Bekçi raporunu sesli dinle"
          >
            <Volume2 className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Sesli Alarm</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={onRefreshScan}
            disabled={isLoading}
            className="p-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
            title="Sensör ve Verileri Yeniden Tara"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Stat Chips Bar */}
      {scanResult && (
        <div className="grid grid-cols-3 gap-2 my-2.5 shrink-0 text-center">
          <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-xs">
            <span className="text-[10px] text-slate-500 font-medium block">Toplam Anomali</span>
            <span className="text-base font-black text-slate-800">{scanResult.totalAnomalies}</span>
          </div>
          <div className="bg-rose-50/70 p-2 rounded-xl border border-rose-200/80 shadow-xs">
            <span className="text-[10px] text-rose-700 font-medium block">Kritik Seviye</span>
            <span className="text-base font-black text-rose-700">{scanResult.criticalCount}</span>
          </div>
          <div className="bg-amber-50/70 p-2 rounded-xl border border-amber-200/80 shadow-xs">
            <span className="text-[10px] text-amber-700 font-medium block">Uyarı Seviyesi</span>
            <span className="text-base font-black text-amber-700">{scanResult.warningCount}</span>
          </div>
        </div>
      )}

      {/* 3. Category Filter Chips */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 shrink-0">
        {[
          { id: 'all', label: 'Tümü' },
          { id: 'critical', label: '🚨 Yalnızca Kritik' },
          { id: 'scale_tare', label: '⚖️ Kantar Darası' },
          { id: 'waste', label: '🔥 Makine Fireleri' },
          { id: 'stock', label: '📦 Kritik Stok' },
          { id: 'pallet', label: '🪵 Palet Riski' },
        ].map((flt) => (
          <button
            key={flt.id}
            onClick={() => setSelectedFilter(flt.id)}
            className={`whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              selectedFilter === flt.id
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            {flt.label}
          </button>
        ))}
      </div>

      {/* 4. Anomalies Stream */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 mt-1 pb-16 sm:pb-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <RefreshCw className="w-7 h-7 animate-spin text-amber-500" />
            <span className="text-xs font-medium">Fabrika kantar tartımları, makineler ve stoklar taranıyor...</span>
          </div>
        ) : filteredAnomalies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 bg-white rounded-2xl border border-slate-200/80 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h4 className="font-bold text-slate-800 text-sm mb-1">Risk veya Kaçak Bulunmuyor</h4>
            <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
              Kantar daraları, makine fire oranları ve emniyet stokları standart tolerans sınırları içinde güvenle çalışıyor.
            </p>
          </div>
        ) : (
          filteredAnomalies.map((anom) => (
            <div
              key={anom.id}
              className={`bg-white rounded-xl border p-3.5 shadow-xs transition-all hover:shadow-sm ${
                anom.severity === 'critical'
                  ? 'border-rose-300 ring-1 ring-rose-500/20'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="p-1 bg-slate-100 rounded-md">
                    {getCategoryIcon(anom.category)}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {getCategoryLabel(anom.category)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${
                      anom.severity === 'critical'
                        ? 'bg-rose-100 text-rose-700 border border-rose-300'
                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}
                  >
                    {anom.severity === 'critical' ? 'Kritik' : 'Uyarı'}
                  </span>
                  <span className="text-[11px] font-bold font-mono px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md border border-slate-200">
                    {anom.metric}
                  </span>
                </div>
              </div>

              <h4 className="font-bold text-slate-900 text-sm mb-1">
                {anom.title}
              </h4>

              <p className="text-xs text-slate-600 leading-relaxed mb-2.5">
                {anom.description}
              </p>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-2 text-[11px] text-slate-700 flex items-start gap-1.5 mb-2">
                <span className="text-amber-600 font-bold shrink-0">🛠️ Aksiyon:</span>
                <span className="italic">{anom.suggestedAction}</span>
              </div>

              {/* Action Draft Trigger Button (If Available) */}
              {anom.actionDraft && (
                <button
                  onClick={() => onSelectActionDraft(anom.actionDraft!)}
                  className="w-full mt-1 py-1.5 px-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-98 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Bu Durumu Telafi Et: {anom.actionDraft.title}</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-auto" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
