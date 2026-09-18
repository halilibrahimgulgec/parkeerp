import React, { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Mic,
  MicOff,
  X,
  Volume2,
  Headphones,
  Check,
  AlertCircle,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  playRadioChirp,
  playRogerBeep,
  playSuccessChime,
  playCancelChime,
} from '../utils/aiWalkieTalkieEngine';
import { ActionDraftPayload } from '../types/aiActionTypes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSendQuery: (transcript: string) => void;
  pendingDraft?: ActionDraftPayload | null;
  onConfirmDraft?: () => void;
  onCancelDraft?: () => void;
  isAutoHandsFree: boolean;
  onToggleHandsFree: () => void;
}

export const AIWalkieTalkieOverlay: React.FC<Props> = ({
  isOpen,
  onClose,
  onSendQuery,
  pendingDraft,
  onConfirmDraft,
  onCancelDraft,
  isAutoHandsFree,
  onToggleHandsFree,
}) => {
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastTransmission, setLastTransmission] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<any>(null);

  // Initialize Web Speech API
  const startListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Tarayıcınız ses tanıma özelliğini desteklemiyor.');
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'tr-TR';
      recognition.continuous = isAutoHandsFree;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsTransmitting(true);
        playRadioChirp();
      };

      recognition.onresult = (event: any) => {
        let currentText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentText += event.results[i][0].transcript;
        }

        if (currentText) {
          setTranscript(currentText);

          // In hands-free mode, trigger auto-submit after 1.4s of silence
          if (isAutoHandsFree) {
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              if (currentText.trim()) {
                handleFinishTransmission(currentText.trim());
              }
            }, 1400);
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Telsiz konuşma hatası:', event.error);
        if (!isAutoHandsFree) {
          setIsTransmitting(false);
        }
      };

      recognition.onend = () => {
        if (isAutoHandsFree && isOpen) {
          // Restart for continuous loop
          try {
            recognition.start();
          } catch (e) {}
        } else {
          setIsTransmitting(false);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Telsiz başlatılamadı:', err);
      setIsTransmitting(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setIsTransmitting(false);
    playRogerBeep();
  };

  const handleFinishTransmission = (textToSend?: string) => {
    const finalQuery = (textToSend || transcript).trim();
    stopListening();

    if (finalQuery) {
      setLastTransmission(finalQuery);
      setTranscript('');
      onSendQuery(finalQuery);
    }
  };

  // Push-to-Talk Mouse & Touch Handlers
  const handlePttDown = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isAutoHandsFree) return; // In hands-free mode, it's always listening
    setTranscript('');
    startListening();
  };

  const handlePttUp = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isAutoHandsFree) return;
    handleFinishTransmission();
  };

  // When Hands-Free mode is toggled while open
  useEffect(() => {
    if (isOpen && isAutoHandsFree) {
      startListening();
    } else if (!isAutoHandsFree && recognitionRef.current) {
      stopListening();
    }
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, [isOpen, isAutoHandsFree]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-slate-950 text-white flex flex-col justify-between p-4 select-none animate-in fade-in duration-200">
      {/* 1. Radio Top Bezel & Channel Display */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-3.5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-[11px] font-mono tracking-widest text-emerald-400 font-bold uppercase">
              TELSİZ KANALI: CH-01 [PARKE ERP]
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Telsiz Modundan Çık"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Frequency & Signal Display */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between text-slate-400">
            <span>FREKANS:</span>
            <span className="text-amber-400 font-bold">446.006 MHz</span>
          </div>
          <div className="bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between text-slate-400">
            <span>MOD:</span>
            <span className="text-emerald-400 font-bold">
              {isAutoHandsFree ? 'SÜREKLİ DİKTE' : 'BAS-KONUŞ (PTT)'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Pending Action Callout (Voice Confirmation Prompt) */}
      {pendingDraft && (
        <div className="my-2 bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border-2 border-amber-500/60 rounded-2xl p-3.5 text-center animate-pulse">
          <div className="flex items-center justify-center gap-2 text-amber-300 font-bold text-xs mb-1">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>SESLİ ONAY BEKLENİYOR</span>
          </div>
          <p className="text-xs text-white font-medium mb-3">
            📋 <strong>{pendingDraft.title}</strong> hazırlandı.<br />
            Kulaklığa <strong>"Evet / Onayla"</strong> veya <strong>"İptal"</strong> deyiniz.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                playSuccessChime();
                onConfirmDraft?.();
              }}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>EVET / ONAYLA</span>
            </button>
            <button
              onClick={() => {
                playCancelChime();
                onCancelDraft?.();
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold active:scale-95 transition-all cursor-pointer"
            >
              İPTAL
            </button>
          </div>
        </div>
      )}

      {/* 3. Live Audio Wave / Spoken Transcript Box */}
      <div className="flex-1 flex flex-col justify-center items-center my-4 px-2">
        {/* Animated Wave Bars */}
        {isTransmitting ? (
          <div className="flex items-center gap-1.5 h-16 mb-4">
            <span className="w-1.5 h-6 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-12 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-16 bg-amber-300 rounded-full animate-pulse" style={{ animationDelay: '75ms' }} />
            <span className="w-1.5 h-10 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '225ms' }} />
            <span className="w-1.5 h-14 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: '120ms' }} />
            <span className="w-1.5 h-8 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '180ms' }} />
          </div>
        ) : (
          <div className="flex items-center gap-1.5 h-16 mb-4 opacity-30">
            <span className="w-1.5 h-2 bg-slate-500 rounded-full" />
            <span className="w-1.5 h-3 bg-slate-500 rounded-full" />
            <span className="w-1.5 h-4 bg-slate-500 rounded-full" />
            <span className="w-1.5 h-3 bg-slate-500 rounded-full" />
            <span className="w-1.5 h-2 bg-slate-500 rounded-full" />
          </div>
        )}

        {/* Live Transcript Display */}
        <div className="w-full max-w-sm bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 text-center min-h-[70px] flex items-center justify-center">
          {transcript ? (
            <p className="text-sm font-semibold text-amber-300 italic leading-relaxed">
              "{transcript}"
            </p>
          ) : lastTransmission ? (
            <p className="text-xs text-slate-400 leading-relaxed">
              Son iletilen: <span className="text-slate-200">"{lastTransmission}"</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              {isAutoHandsFree
                ? '🎧 Kulaklık bağlı. Doğrudan konuşunuz, durduğunuzda otomatik iletilir.'
                : 'Aşağıdaki butona basılı tutarak doğrudan konuşunuz.'}
            </p>
          )}
        </div>
      </div>

      {/* 4. Push-to-Talk Big Center Button */}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onMouseDown={handlePttDown}
          onMouseUp={handlePttUp}
          onTouchStart={handlePttDown}
          onTouchEnd={handlePttUp}
          className={`w-40 h-40 rounded-full flex flex-col items-center justify-center shadow-2xl transition-all duration-150 transform select-none cursor-pointer ${
            isTransmitting
              ? 'bg-gradient-to-tr from-amber-600 via-orange-500 to-amber-400 text-white scale-105 ring-8 ring-amber-500/30'
              : 'bg-gradient-to-tr from-slate-800 to-slate-900 text-slate-200 border-4 border-slate-700 hover:border-amber-500/50 active:scale-95'
          }`}
          style={{ touchAction: 'none' }}
        >
          {isTransmitting ? (
            <>
              <Radio className="w-12 h-12 text-white animate-pulse mb-1" />
              <span className="text-xs font-black tracking-widest uppercase">YAYINDA</span>
              <span className="text-[9px] text-amber-200 font-mono">Bırak ve İlet</span>
            </>
          ) : (
            <>
              <Mic className="w-12 h-12 text-amber-400 mb-1" />
              <span className="text-xs font-black tracking-widest uppercase">BAS - KONUŞ</span>
              <span className="text-[9px] text-slate-400 font-mono">
                {isAutoHandsFree ? 'Sürekli Dinle Açık' : 'Basılı Tut'}
              </span>
            </>
          )}
        </button>

        {/* 5. Hands-Free (Continuous Listen) Toggle */}
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={onToggleHandsFree}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isAutoHandsFree
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>Eller Serbest Modu: {isAutoHandsFree ? 'AÇIK (Sürekli)' : 'KAPALI (Bas-Konuş)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
