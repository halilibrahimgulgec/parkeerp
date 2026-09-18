import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Bot,
  Send,
  Mic,
  MicOff,
  X,
  RefreshCw,
  Settings,
  Copy,
  Check,
  FileText,
  Share2,
  Printer,
  MessageSquare,
  Zap,
  Volume2,
  VolumeX,
  Camera,
  Image as ImageIcon,
  ShieldAlert,
  ArrowRight,
  Radio,
  Headphones,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getLiveFactorySnapshot,
  generateExecutiveBriefingText,
  askFactoryAI,
  FactorySnapshot,
} from '../utils/aiFactoryBrain';
import { FACTORY_CORE_RULES } from '../utils/aiFactorySelfLearningEngine';
import { AIActionApprovalCard } from './AIActionApprovalCard';
import { ActionDraftPayload } from '../types/aiActionTypes';
import { parseActionIntentFromQuery, executeApprovedAction } from '../utils/aiActionEngine';
import { speakTurkishText, stopSpeaking, isSpeaking } from '../utils/aiVoiceTTS';
import { analyzeImageWithVision, compressImageFile } from '../utils/aiVisionOCREngine';
import {
  runFactoryWatchdogScan,
  formatWatchdogReportForChat,
  formatWatchdogBriefingForTTS,
} from '../utils/aiWatchdogEngine';
import { WatchdogScanResult } from '../types/aiWatchdogTypes';
import { AIWatchdogPanel } from './AIWatchdogPanel';
import { AIWalkieTalkieOverlay } from './AIWalkieTalkieOverlay';
import {
  isVoiceConfirmation,
  isVoiceCancellation,
  playSuccessChime,
  playCancelChime,
} from '../utils/aiWalkieTalkieEngine';
import {
  formatExecutiveReportForMessaging,
  sendBriefingViaWhatsApp,
  sendBriefingViaTelegram,
} from '../utils/aiExecutiveBriefingEngine';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time: string;
  userQuery?: string;
  actionDraft?: ActionDraftPayload;
  imagePreview?: string;
}

const QUICK_PROMPTS = [
  { label: '📲 Patrona Rapor Gönder', query: 'Günün özetini WhatsApp üzerinden yöneticiye brifing olarak ilet' },
  { label: '✈️ Telegrama Brifing At', query: 'Fabrika gün sonu raporunu Telegram kanalına gönder' },
  { label: '🚨 Fabrika Risklerini Tara', query: 'Fabrikadaki kantar dara sapmaları, makine fireleri ve kritik riskleri denetle' },
  { label: '🚚 Kantar Fişi Hazırla', query: "Ahmet Yılmaz 46 K 1234 kamyonuna 15 palet 8'lik kilit parke yüklendi kantar fişi hazırla" },
  { label: '🏭 Üretim Girişi Yap', query: "1 nolu makinede 500 m2 8'lik parke basıldı 15 m2 fire var üretim kaydet" },
  { label: '🪵 Palet İadesi Al', query: "Medikent şantiyesinden 40 tahta palet iade geldi" },
  { label: '📸 İrsaliye & Fiş Tara', query: 'Ocak ve çimento irsaliyelerini kamerayla nasıl okutup stoğa eklerim?' },
  { label: '🔍 Hasarlı Taş Teşhisi', query: 'Kırık veya yüzeyi pürüzlü çıkan parke taşlarının fotoğraflarını nasıl analiz edersin?' },
  { label: '📊 Bugün Üretim & Sevk', query: 'Bugünkü üretim miktarları, fire durumu ve kantar sevkiyatları ne durumda?' },
  { label: '📈 Aylık Kümülatif Üretim', query: 'Bu ay kümülatif toplam kaç m² parke ve bordür ürettik?' },
  { label: '🪵 Paletlerin Değeri', query: 'Paletlerin toplam değeri ne kadar?' },
  { label: '🪵 Medikent Üretim Paleti', query: 'Medikent den ne kadar üretim paleti alacağımız var?' },
  { label: '🚨 Kritik Stoklar', query: 'Emniyet stoğu altına düşen kritik ürünler hangileri ve stokları kaç?' },
  { label: '⚖️ Kantar Tonajı', query: 'Bugünkü kantar net sevk tonajı ne kadar?' },
  { label: '🎯 Acil Siparişler', query: 'Bekleyen acil iş emirleri ve siparişler hangileri?' },
  { label: '💰 Finans & Birim Maliyet', query: '1 m² parkenin tahmini üretim maliyeti kaç TL dir?' },
];

export default function AIAssistantModal() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'watchdog' | 'briefing'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [snapshot, setSnapshot] = useState<FactorySnapshot | null>(null);
  const [isRefreshingSnapshot, setIsRefreshingSnapshot] = useState(false);
  const [briefingText, setBriefingText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [copiedBriefing, setCopiedBriefing] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);

  // Phase 5: Automated Executive WhatsApp & Telegram Dispatcher States
  const [managerPhone, setManagerPhone] = useState('');
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [telegramStatusMsg, setTelegramStatusMsg] = useState<string | null>(null);

  // Phase 3: Watchdog Anomaly Detector States
  const [watchdogResult, setWatchdogResult] = useState<WatchdogScanResult | null>(null);
  const [isScanningWatchdog, setIsScanningWatchdog] = useState(false);

  // Phase 4: Walkie-Talkie & Voice Confirmation States
  const [isWalkieTalkieOpen, setIsWalkieTalkieOpen] = useState(false);
  const [isAutoHandsFree, setIsAutoHandsFree] = useState(false);
  const [activePendingDraft, setActivePendingDraft] = useState<ActionDraftPayload | null>(null);

  // Phase 2: Vision OCR & Image Upload States
  const [selectedImage, setSelectedImage] = useState<{
    base64: string;
    mimeType: string;
    previewUrl: string;
    fileName: string;
  } | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingImage(true);
      const compressed = await compressImageFile(file, 1200, 0.82);
      setSelectedImage({
        base64: compressed.base64,
        mimeType: compressed.mimeType,
        previewUrl: `data:${compressed.mimeType};base64,${compressed.base64}`,
        fileName: file.name,
      });
    } catch (err) {
      console.error('Fotoğraf işlenemedi:', err);
      alert('Fotoğraf yüklenirken bir hata oluştu.');
    } finally {
      setIsProcessingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearSelectedImage = () => {
    setSelectedImage(null);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const handleToggleSpeak = (msgId: string, text: string) => {
    if (speakingMsgId === msgId) {
      stopSpeaking();
      setSpeakingMsgId(null);
    } else {
      setSpeakingMsgId(msgId);
      speakTurkishText(
        text,
        () => setSpeakingMsgId(msgId),
        () => setSpeakingMsgId(null),
        () => setSpeakingMsgId(null)
      );
    }
  };

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  // Load saved API key and messaging settings on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('parke_gemini_api_key') || '';
    const savedPhone = localStorage.getItem('parke_manager_phone') || '';
    const savedBotToken = localStorage.getItem('parke_telegram_bot_token') || '';
    const savedChatId = localStorage.getItem('parke_telegram_chat_id') || '';
    setApiKey(savedKey);
    setManagerPhone(savedPhone);
    setTelegramBotToken(savedBotToken);
    setTelegramChatId(savedChatId);
  }, []);

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome-1',
          role: 'assistant',
          text: `👋 **Merhaba! Ben Parke ERP Fabrika Zekası.**\n\nFabrikanızın tüm canlı üretim hatlarını, kantar tartımlarını, depo stoklarını ve şantiyelerdeki palet borçlarını anlık olarak analiz ediyorum.\n\n⚙️ **Öğrenilmiş Sabit Fabrika Kuralları:**\n• 🏭 **Üretim Paleti Bedeli:** ₺${FACTORY_CORE_RULES.PALLET_PRICES.uretim.toLocaleString('tr-TR')} / Adet\n• 🪵 **Tahta Palet Bedeli:** ₺${FACTORY_CORE_RULES.PALLET_PRICES.tahta.toLocaleString('tr-TR')} / Adet\n• ⏰ **Fabrika Mesaisi:** Günde ${FACTORY_CORE_RULES.WORK_HOURS_PER_DAY} Saat (Pazar günleri tatil)\n• 🎯 **Günlük Hedef:** ${FACTORY_CORE_RULES.DAILY_PRODUCTION_TARGET_M2.toLocaleString('tr-TR')} m²\n\nFabrika üretimi, kantar sevkleri, müşteri palet alacakları, kritik stoklar veya maliyetler hakkında doğrudan soru sorabilirsiniz.`,
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [messages.length]);

  // Fetch or refresh live factory snapshot
  const loadFreshSnapshot = async () => {
    setIsRefreshingSnapshot(true);
    try {
      const data = await getLiveFactorySnapshot();
      setSnapshot(data);
      const generated = generateExecutiveBriefingText(data);
      setBriefingText(generated);
      loadWatchdogScan(data);
    } catch (err) {
      console.error('Fabrika verisi çekilemedi:', err);
    } finally {
      setIsRefreshingSnapshot(false);
    }
  };

  // Run Watchdog Scan
  const loadWatchdogScan = async (targetSnapshot?: FactorySnapshot) => {
    setIsScanningWatchdog(true);
    try {
      const snap = targetSnapshot || snapshot || await getLiveFactorySnapshot();
      const res = await runFactoryWatchdogScan(snap);
      setWatchdogResult(res);
    } catch (err) {
      console.error('Bekçi tarama hatası:', err);
    } finally {
      setIsScanningWatchdog(false);
    }
  };

  useEffect(() => {
    if (isOpen && !snapshot) {
      loadFreshSnapshot();
    }
  }, [isOpen, snapshot]);

  // Auto scroll chat
  useEffect(() => {
    if (activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, activeTab]);

  // Speech to Text (Web Speech API)
  const toggleSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Tarayıcınız ses tanıma özelliğini desteklemiyor. Google Chrome veya Android WebView kullanmanızı öneririz.');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'tr-TR';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Ses tanıma hatası:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Ses tanıma başlatılamadı:', err);
      setIsListening(false);
    }
  };

  // Send message
  const handleSendMessage = async (queryText?: string) => {
    const query = (queryText || inputText).trim();
    const currentImg = selectedImage;
    if ((!query && !currentImg) || isLoading || isProcessingImage) return;

    setInputText('');
    setSelectedImage(null);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: query || (currentImg ? '📸 Belge / Hasar fotoğrafı gönderildi, inceleniyor...' : ''),
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      imagePreview: currentImg?.previewUrl,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Phase 2: If an image is provided, run Multimodal Vision OCR / Quality Inspection
      if (currentImg) {
        const visionResult = await analyzeImageWithVision(
          currentImg.base64,
          currentImg.mimeType,
          query,
          apiKey
        );

        const aiMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: visionResult.description,
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          userQuery: query,
          actionDraft: visionResult.actionDraft,
        };

        if (visionResult.actionDraft) {
          setActivePendingDraft(visionResult.actionDraft);
        }

        setMessages((prev) => [...prev, aiMsg]);
        if (autoSpeak || isWalkieTalkieOpen) {
          handleToggleSpeak(aiMsg.id, aiMsg.text);
        }
        setIsLoading(false);
        return;
      }

      // Phase 4: Voice Confirmation & Cancellation Loop
      if (activePendingDraft) {
        if (isVoiceConfirmation(query)) {
          playSuccessChime();
          const targetDraft = activePendingDraft;
          setActivePendingDraft(null);
          try {
            const execRes = await executeApprovedAction(targetDraft, user);
            const confirmedDraft: ActionDraftPayload = {
              ...targetDraft,
              status: execRes.success ? 'confirmed' : 'error',
              resultMessage: execRes.message,
              errorMessage: execRes.success ? undefined : execRes.message,
              createdRecordId: execRes.recordId,
            };
            const aiMsg: ChatMessage = {
              id: `a-${Date.now()}`,
              role: 'assistant',
              text: `✅ **Sesli Onay Alındı:** ${execRes.message}`,
              time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
              userQuery: query,
              actionDraft: confirmedDraft,
            };
            setMessages((prev) => [...prev, aiMsg]);
            if (autoSpeak || isWalkieTalkieOpen) {
              handleToggleSpeak(aiMsg.id, 'İşlem sesli olarak onaylandı ve sisteme başarıyla kaydedildi.');
            }
          } catch (e: any) {
            const errMsg: ChatMessage = {
              id: `err-${Date.now()}`,
              role: 'assistant',
              text: `⚠️ Kayıt sırasında hata: ${e.message}`,
              time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            };
            setMessages((prev) => [...prev, errMsg]);
          }
          setIsLoading(false);
          return;
        }

        if (isVoiceCancellation(query)) {
          playCancelChime();
          const targetDraft = activePendingDraft;
          setActivePendingDraft(null);
          const cancelledDraft: ActionDraftPayload = {
            ...targetDraft,
            status: 'cancelled',
            resultMessage: 'İşlem operatör tarafından sesli olarak iptal edildi.',
          };
          const aiMsg: ChatMessage = {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: `❌ **Sesli İptal:** Taslak iptal edildi. Veritabanına kayıt yapılmadı.`,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            userQuery: query,
            actionDraft: cancelledDraft,
          };
          setMessages((prev) => [...prev, aiMsg]);
          if (autoSpeak || isWalkieTalkieOpen) {
            handleToggleSpeak(aiMsg.id, 'İşlem iptal edildi.');
          }
          setIsLoading(false);
          return;
        }
      }

      let currentData = snapshot;
      if (!currentData) {
        currentData = await getLiveFactorySnapshot();
        setSnapshot(currentData);
      }

      // 1. Action Intent Recognition (Kantar, Sevkiyat, Üretim, Palet İade Girişi)
      const actionDraft = await parseActionIntentFromQuery(query, currentData);
      if (actionDraft) {
        setActivePendingDraft(actionDraft);
        const actionMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `📋 **${actionDraft.title}** hazırlandı. Onaylıyor musunuz? (Sesle *"Evet"* veya *"İptal"* diyebilirsiniz):\n\nLütfen aşağıdaki bilgileri kontrol ediniz:`,
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          userQuery: query,
          actionDraft,
        };
        setMessages((prev) => [...prev, actionMsg]);
        if (autoSpeak || isWalkieTalkieOpen) {
          handleToggleSpeak(actionMsg.id, `${actionDraft.title} hazırlandı. Onaylıyor musunuz?`);
        }
        setIsLoading(false);
        return;
      }

      // Phase 5: Automated Executive Briefing Dispatch (WhatsApp & Telegram)
      const qLower = query.toLowerCase();
      const isBriefingDispatchQuery =
        (qLower.includes('patron') || qLower.includes('yönetici') || qLower.includes('müdür')) &&
        (qLower.includes('rapor') || qLower.includes('özet') || qLower.includes('brifing') || qLower.includes('gönder') || qLower.includes('at') || qLower.includes('paylaş') || qLower.includes('ilet'));

      const isDirectPlatformDispatch =
        (qLower.includes('whatsapp') || qLower.includes('telegram')) &&
        (qLower.includes('gönder') || qLower.includes('at') || qLower.includes('ilet') || qLower.includes('paylaş') || qLower.includes('rapor') || qLower.includes('özet') || qLower.includes('brifing'));

      if (isBriefingDispatchQuery || isDirectPlatformDispatch) {
        let wRes = watchdogResult;
        if (!wRes) {
          wRes = await runFactoryWatchdogScan(currentData);
          setWatchdogResult(wRes);
        }

        const formattedBriefing = formatExecutiveReportForMessaging(currentData, wRes);
        const wantsTelegram = qLower.includes('telegram');
        const wantsWhatsApp = qLower.includes('whatsapp') || !wantsTelegram;

        const statusLines: string[] = [];

        if (wantsWhatsApp) {
          sendBriefingViaWhatsApp(formattedBriefing, managerPhone);
          statusLines.push(
            managerPhone
              ? `📲 **WhatsApp Gönderimi Başlatıldı:** Gün sonu brifingi yöneticinin (${managerPhone}) numarasına iletilmek üzere WhatsApp açıldı.`
              : `📲 **WhatsApp Gönderimi Başlatıldı:** WhatsApp açıldı. (İpucu: Ayarlar simgesinden yönetici telefon numarasını kaydedebilirsiniz).`
          );
        }

        if (wantsTelegram) {
          if (telegramBotToken.trim() && telegramChatId.trim()) {
            setIsSendingTelegram(true);
            try {
              const telRes = await sendBriefingViaTelegram(formattedBriefing, telegramBotToken, telegramChatId);
              if (telRes.success) {
                statusLines.push(`✈️ **Telegram İletildi:** Rapor Telegram kanalına başarıyla gönderildi.`);
              } else {
                statusLines.push(`⚠️ **Telegram Hatası:** ${telRes.message}`);
              }
            } catch (err: any) {
              statusLines.push(`⚠️ **Telegram Hatası:** ${err.message}`);
            } finally {
              setIsSendingTelegram(false);
            }
          } else {
            statusLines.push(`⚠️ **Telegram Yapılandırması Eksik:** Bot Token veya Chat ID girilmediği için doğrudan iletilemedi. Lütfen üstteki Ayarlar (⚙️) menüsünden Telegram bilgilerinizi tanımlayınız.`);
          }
        }

        const aiMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `${statusLines.join('\n\n')}\n\n📋 **Gönderilen Gün Sonu Yönetici Brifingi:**\n\n${formattedBriefing}`,
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          userQuery: query,
        };

        setMessages((prev) => [...prev, aiMsg]);
        if (autoSpeak || isWalkieTalkieOpen) {
          handleToggleSpeak(aiMsg.id, 'Gün sonu yönetici brifingi oluşturuldu ve iletildi.');
        }
        setIsLoading(false);
        return;
      }

      // 2. Watchdog / Anomaly / Leakage Query Recognition
      const isWatchdogQuery =
        qLower.includes('anomali') ||
        qLower.includes('bekçi') ||
        qLower.includes('risk') ||
        qLower.includes('kaçak') ||
        qLower.includes('açık var mı') ||
        (qLower.includes('dara') && (qLower.includes('sapma') || qLower.includes('fark') || qLower.includes('şüphe') || qLower.includes('sorun') || qLower.includes('hafif') || qLower.includes('ağır')));

      if (isWatchdogQuery) {
        let wRes = watchdogResult;
        if (!wRes) {
          wRes = await runFactoryWatchdogScan(currentData);
          setWatchdogResult(wRes);
        }
        const reportText = formatWatchdogReportForChat(wRes);
        const aiMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: reportText,
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          userQuery: query,
        };
        setMessages((prev) => [...prev, aiMsg]);
        if (autoSpeak) {
          handleToggleSpeak(aiMsg.id, formatWatchdogBriefingForTTS(wRes));
        }
        setIsLoading(false);
        return;
      }

      // 3. Standard Autonomous Question Answering
      const chatHistory = messages.map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const answer = await askFactoryAI({ query, apiKey, chatHistory });

      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: answer,
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        userQuery: query,
      };

      setMessages((prev) => [...prev, aiMsg]);
      if (autoSpeak) {
        handleToggleSpeak(aiMsg.id, aiMsg.text);
      }
    } catch (err) {
      console.error('AI yanıt üretirken hata:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: '❌ Yanıt oluşturulurken bir hata oluştu. Lütfen bağlantınızı kontrol edip tekrar deneyin.',
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          userQuery: query,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const handleCopyBriefing = () => {
    if (!briefingText) return;
    navigator.clipboard.writeText(briefingText);
    setCopiedBriefing(true);
    setTimeout(() => setCopiedBriefing(false), 2000);
  };

  const handleShareWhatsApp = (customText?: string) => {
    const textToSend = customText || (snapshot ? formatExecutiveReportForMessaging(snapshot, watchdogResult) : briefingText);
    if (!textToSend) return;
    sendBriefingViaWhatsApp(textToSend, managerPhone);
  };

  const handleShareTelegram = async (customText?: string) => {
    const textToSend = customText || (snapshot ? formatExecutiveReportForMessaging(snapshot, watchdogResult) : briefingText);
    if (!textToSend) return;

    if (!telegramBotToken.trim() || !telegramChatId.trim()) {
      setShowSettings(true);
      setTelegramStatusMsg('⚠️ Lütfen önce Telegram Bot Token ve Chat ID bilgilerini Ayarlar panelinden kaydedin.');
      setTimeout(() => setTelegramStatusMsg(null), 6000);
      return;
    }

    setIsSendingTelegram(true);
    setTelegramStatusMsg(null);
    try {
      const res = await sendBriefingViaTelegram(textToSend, telegramBotToken, telegramChatId);
      setTelegramStatusMsg(res.success ? '✅ ' + res.message : '❌ ' + res.message);
    } catch (e: any) {
      setTelegramStatusMsg('❌ Gönderim hatası: ' + e.message);
    } finally {
      setIsSendingTelegram(false);
      setTimeout(() => setTelegramStatusMsg(null), 6000);
    }
  };

  const handlePrintBriefing = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Gün Sonu Yönetici Özeti - Parke ERP</title>
            <style>
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; line-height: 1.6; color: #1e293b; }
              h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; font-size: 20px; }
              pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; }
            </style>
          </head>
          <body>
            <h1>Parke ERP - Gün Sonu Yönetici Özeti</h1>
            <pre>${briefingText}</pre>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const saveSettings = (newKey: string, newPhone: string, newBotToken: string, newChatId: string) => {
    setApiKey(newKey);
    setManagerPhone(newPhone);
    setTelegramBotToken(newBotToken);
    setTelegramChatId(newChatId);
    localStorage.setItem('parke_gemini_api_key', newKey.trim());
    localStorage.setItem('parke_manager_phone', newPhone.trim());
    localStorage.setItem('parke_telegram_bot_token', newBotToken.trim());
    localStorage.setItem('parke_telegram_chat_id', newChatId.trim());
    setShowSettings(false);
  };

  const saveApiKey = (newKey: string) => {
    saveSettings(newKey, managerPhone, telegramBotToken, telegramChatId);
  };

  // Helper to format markdown in chat cleanly
  const renderFormattedMarkdown = (rawText: string) => {
    const lines = rawText.split('\n');
    return (
      <div className="space-y-1.5 text-sm leading-relaxed">
        {lines.map((line, idx) => {
          if (!line.trim()) {
            return <div key={idx} className="h-1.5" />;
          }

          // Headers
          if (line.startsWith('### ')) {
            return (
              <h4 key={idx} className="font-bold text-slate-900 mt-2 mb-1 text-sm flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                {line.replace('### ', '')}
              </h4>
            );
          }
          if (line.startsWith('## ')) {
            return (
              <h3 key={idx} className="font-bold text-slate-900 mt-2 mb-1 text-base border-b border-slate-200 pb-1">
                {line.replace('## ', '')}
              </h3>
            );
          }

          // Bullet point
          if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
            const content = line.substring(2);
            return (
              <div key={idx} className="flex items-start gap-2 pl-1">
                <span className="text-amber-500 font-bold mt-0.5">•</span>
                <span className="flex-1">{formatInline(content)}</span>
              </div>
            );
          }

          // Regular paragraph
          return <p key={idx}>{formatInline(line)}</p>;
        })}
      </div>
    );
  };

  // Format bold and code inline
  const formatInline = (str: string) => {
    const parts = str.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={i} className="px-1.5 py-0.5 rounded bg-slate-100 text-amber-700 font-mono text-xs">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  return (
    <>
      {/* 1. Floating Action Trigger Button */}
      <div className="no-print fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="relative group flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-white rounded-full shadow-xl shadow-amber-500/25 transition-all duration-300 transform hover:scale-105 active:scale-95 focus:outline-none"
          title="Parke AI Fabrika Danışmanı"
          aria-label="AI Asistan"
        >
          {/* Pulsing ring indicator */}
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white"></span>
          </span>

          <Sparkles className="w-5 h-5 animate-pulse text-amber-100" />
          <span className="font-bold text-sm tracking-wide hidden sm:inline">Parke AI</span>
        </button>
      </div>

      {/* 2. Floating AI Drawer / Modal */}
      {isOpen && (
        <div
          className="no-print fixed inset-x-0 bottom-0 sm:bottom-20 sm:right-6 sm:left-auto w-full sm:w-[500px] h-[85vh] sm:h-[680px] max-h-[92vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200/80 flex flex-col z-50 overflow-hidden transition-all duration-300"
          style={{ boxShadow: '0 20px 50px rgba(15, 23, 42, 0.25)' }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white px-4 py-3.5 flex items-center justify-between border-b border-slate-700 select-none">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg text-white shadow-sm">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-slate-100">Parke AI Fabrika Zekası</h3>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Canlı Veri
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate max-w-[220px]">
                  {apiKey ? 'Google Gemini 2.0 Flash' : 'Dahili Fabrika Zekası Motoru'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={loadFreshSnapshot}
                disabled={isRefreshingSnapshot}
                className="p-1.5 hover:bg-slate-700/60 rounded-lg text-slate-300 hover:text-white transition-colors"
                title="Canlı verileri tazele"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshingSnapshot ? 'animate-spin text-amber-400' : ''}`} />
              </button>
              {/* Phase 4: Walkie-Talkie Button in Header */}
              <button
                onClick={() => setIsWalkieTalkieOpen(true)}
                className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Saha Telsizi / Bas-Konuş Modu (PTT)"
              >
                <Radio className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="hidden sm:inline text-[11px]">Telsiz</span>
              </button>

              <button
                onClick={() => setAutoSpeak(!autoSpeak)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  autoSpeak ? 'bg-amber-500 text-white' : 'hover:bg-slate-700/60 text-slate-300 hover:text-white'
                }`}
                title={autoSpeak ? 'Otomatik Sesli Okuma Açık (Her yanıt okunur)' : 'Otomatik Sesli Okuma Kapalı'}
              >
                {autoSpeak ? <Volume2 className="w-4 h-4 text-white" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1.5 rounded-lg transition-colors ${
                  showSettings ? 'bg-amber-500 text-white' : 'hover:bg-slate-700/60 text-slate-300 hover:text-white'
                }`}
                title="AI Motor Ayarları"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-slate-700/60 rounded-lg text-slate-300 hover:text-white transition-colors ml-1"
                title="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs (3 Tabs: Sohbet, Bekçi Alarmları & Gün Sonu Özeti) */}
          <div className="flex border-b border-slate-100 bg-slate-50/70 px-3 pt-2 gap-1 text-xs font-semibold overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-1.5 pb-2 px-3 border-b-2 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'chat'
                  ? 'border-amber-500 text-amber-600 font-bold bg-white rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Fabrika Sohbeti
            </button>

            <button
              onClick={() => {
                setActiveTab('watchdog');
                if (!watchdogResult && snapshot) {
                  loadWatchdogScan(snapshot);
                }
              }}
              className={`flex items-center gap-1.5 pb-2 px-3 border-b-2 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'watchdog'
                  ? 'border-rose-500 text-rose-600 font-bold bg-white rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Bekçi Alarmları</span>
              {watchdogResult && watchdogResult.criticalCount > 0 && (
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-black animate-pulse">
                  {watchdogResult.criticalCount}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveTab('briefing');
                if (!briefingText && snapshot) {
                  setBriefingText(generateExecutiveBriefingText(snapshot));
                }
              }}
              className={`flex items-center gap-1.5 pb-2 px-3 border-b-2 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === 'briefing'
                  ? 'border-amber-500 text-amber-600 font-bold bg-white rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Gün Sonu Özeti
            </button>
          </div>

          {/* Settings Sub-panel (Collapsible) */}
          {showSettings && (
            <div className="bg-slate-900 text-white p-4 border-b border-slate-700 text-xs animate-in slide-in-from-top-2 duration-200 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold flex items-center gap-1.5 text-amber-400 text-sm">
                  <Settings className="w-4 h-4" /> AI ve Yönetici İletişim Ayarları
                </span>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-md cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 1. Gemini API Key */}
              <div>
                <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Google Gemini API Anahtarı (İsteğe Bağlı)
                </label>
                <input
                  type="password"
                  placeholder="AIzaSy... (Gemini 2.0 Flash API Key)"
                  defaultValue={apiKey}
                  id="gemini-key-input"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Girilmezse sistem dahili Otonom Fabrika Zekası motoruyla sıfır konfigürasyonla çalışır.
                </p>
              </div>

              {/* 2. WhatsApp Executive Phone */}
              <div>
                <label className="block text-emerald-400 font-medium mb-1 flex items-center gap-1">
                  <span>📲</span> WhatsApp Yönetici Telefon Numarası
                </label>
                <input
                  type="text"
                  placeholder="Örn: 905321234567 veya 05321234567"
                  defaultValue={managerPhone}
                  id="manager-phone-input"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  "Patrona rapor at" dendiğinde veya Gün Sonu WhatsApp butonunda otomatik bu numaraya yönlenir.
                </p>
              </div>

              {/* 3. Telegram Bot Integration */}
              <div className="space-y-1.5">
                <label className="block text-sky-400 font-medium flex items-center gap-1">
                  <span>✈️</span> Telegram Bot & Kanal Yapılandırması
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="password"
                    placeholder="Bot Token (örn: 123456:ABC-DEF...)"
                    defaultValue={telegramBotToken}
                    id="telegram-token-input"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="Chat ID veya Kanal (örn: -100123456)"
                    defaultValue={telegramChatId}
                    id="telegram-chat-id-input"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  Telegram BotFather'dan aldığınız bot token ve yönetici/grup chat ID'sini girerek tek tıkla doğrudan Telegram mesajı iletebilirsiniz.
                </p>
              </div>

              {/* Save Button */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => {
                    const keyEl = document.getElementById('gemini-key-input') as HTMLInputElement;
                    const phoneEl = document.getElementById('manager-phone-input') as HTMLInputElement;
                    const tokenEl = document.getElementById('telegram-token-input') as HTMLInputElement;
                    const chatEl = document.getElementById('telegram-chat-id-input') as HTMLInputElement;
                    saveSettings(
                      keyEl ? keyEl.value : apiKey,
                      phoneEl ? phoneEl.value : managerPhone,
                      tokenEl ? tokenEl.value : telegramBotToken,
                      chatEl ? chatEl.value : telegramChatId
                    );
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold rounded-lg transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  Ayarları Kaydet
                </button>
              </div>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50 relative">
            {/* TAB 1: CHAT */}
            {activeTab === 'chat' && (
              <>
                {/* Watchdog Emergency Banner if critical anomalies exist */}
                {watchdogResult && watchdogResult.criticalCount > 0 && (
                  <div
                    onClick={() => setActiveTab('watchdog')}
                    className="mx-3 mt-2 px-3 py-2 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white rounded-xl shadow-md flex items-center justify-between cursor-pointer animate-pulse shrink-0 text-xs transition-all"
                  >
                    <div className="flex items-center gap-2 font-bold truncate">
                      <ShieldAlert className="w-4 h-4 text-white shrink-0" />
                      <span className="truncate">🚨 DİKKAT: Fabrikada {watchdogResult.criticalCount} kritik anomali tespit edildi!</span>
                    </div>
                    <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 shrink-0 ml-2">
                      İncele <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                )}

                {/* Quick Prompts Bar */}
                <div className="overflow-x-auto py-2 px-3 border-b border-slate-100 bg-white flex gap-1.5 no-scrollbar shrink-0 items-center">
                  {QUICK_PROMPTS.map((qp, index) => (
                    <button
                      key={index}
                      onClick={() => handleSendMessage(qp.query)}
                      disabled={isLoading}
                      className="whitespace-nowrap px-2.5 py-1 text-xs bg-slate-100 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 border border-slate-200 text-slate-700 rounded-full transition-all duration-150 flex items-center gap-1 active:scale-95 disabled:opacity-50"
                    >
                      <span>{qp.label}</span>
                    </button>
                  ))}
                </div>

                {/* Chat Messages Stream */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`group relative max-w-[90%] rounded-2xl px-3.5 py-2.5 shadow-sm text-sm ${
                          msg.role === 'user'
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-none'
                            : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none pb-3'
                        }`}
                      >
                        {msg.role === 'assistant' ? (
                          <>
                            {renderFormattedMarkdown(msg.text)}

                            {/* Action Approval Card (Human-in-the-Loop) */}
                            {msg.actionDraft && (
                              <AIActionApprovalCard
                                draft={msg.actionDraft}
                                currentUser={user}
                                onUpdateDraft={(updated) => {
                                  setMessages((prev) =>
                                    prev.map((m) => (m.id === msg.id ? { ...m, actionDraft: updated } : m))
                                  );
                                }}
                              />
                            )}
                          </>
                        ) : (
                          <>
                            {msg.imagePreview && (
                              <div className="mb-2 overflow-hidden rounded-lg border border-white/20 max-w-[240px]">
                                <img
                                  src={msg.imagePreview}
                                  alt="Yüklenen belge/fotoğraf"
                                  className="w-full h-auto object-cover max-h-48 rounded"
                                />
                              </div>
                            )}
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                          </>
                        )}

                        {/* Action buttons for assistant responses */}
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-100">
                            {/* Copy button */}
                            <button
                              onClick={() => handleCopyMessage(msg.id, msg.text)}
                              className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1 rounded text-[11px] flex items-center gap-1 font-medium transition-colors"
                              title="Cevabı kopyala"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-600 font-bold">Kopyalandı</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Kopyala</span>
                                </>
                              )}
                            </button>

                            {/* Voice TTS Listen button */}
                            <button
                              onClick={() => handleToggleSpeak(msg.id, msg.text)}
                              className={`px-2.5 py-1 rounded text-[11px] flex items-center gap-1 font-medium transition-colors ${
                                speakingMsgId === msg.id
                                  ? 'bg-amber-100 text-amber-800 font-bold animate-pulse'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                              }`}
                              title={speakingMsgId === msg.id ? 'Sesli okumayı durdur' : 'Cevabı sesli dinle'}
                            >
                              {speakingMsgId === msg.id ? (
                                <>
                                  <VolumeX className="w-3 h-3 text-amber-700" />
                                  <span>Durdur</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 className="w-3 h-3 text-slate-500" />
                                  <span>Dinle</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 px-1">{msg.time}</span>
                    </div>
                  ))}

                  {/* Typing / Loading indicator */}
                  {isLoading && (
                    <div className="flex items-start gap-2">
                      <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                        <span className="text-xs text-slate-500 font-medium ml-1">
                          {selectedImage ? 'Görsel ve metin analiz ediliyor...' : 'Fabrika zekası analiz ediyor...'}
                        </span>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input Bar */}
                <div className="p-3 bg-white border-t border-slate-200 shrink-0">
                  {/* Phase 2: Selected Image Preview Chip */}
                  {selectedImage && (
                    <div className="flex items-center gap-2 mb-2 p-1.5 bg-slate-100 border border-slate-300 rounded-xl w-fit max-w-full">
                      <img
                        src={selectedImage.previewUrl}
                        alt="Seçilen belge"
                        className="w-10 h-10 object-cover rounded-lg border border-slate-200 shrink-0"
                      />
                      <div className="text-[11px] truncate max-w-[180px]">
                        <span className="font-semibold text-slate-800 block truncate">{selectedImage.fileName}</span>
                        <span className="text-slate-500 text-[10px]">İrsaliye / Fiş / Taş Fotoğrafı</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSelectedImage}
                        className="p-1 hover:bg-slate-200 rounded-full text-slate-500 hover:text-rose-600 transition-colors ml-1 cursor-pointer"
                        title="Görseli kaldır"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-2xl px-3 py-1.5 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all">
                    {/* Hidden file input for camera / file upload */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleImageFileChange}
                    />

                    {/* Camera / Photo Button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessingImage || isLoading}
                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-slate-200/50 rounded-full transition-all cursor-pointer"
                      title="Kamera / Fotoğraf Çek veya Yükle (İrsaliye / Hasarlı Taş)"
                    >
                      {isProcessingImage ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
                      ) : (
                        <Camera className="w-4 h-4" />
                      )}
                    </button>

                    {/* Speech Recognition Mic */}
                    <button
                      type="button"
                      onClick={toggleSpeechRecognition}
                      className={`p-1.5 rounded-full transition-all cursor-pointer ${
                        isListening
                          ? 'bg-rose-500 text-white animate-pulse'
                          : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/50'
                      }`}
                      title={isListening ? 'Dinleniyor... Durdurmak için tıklayın' : 'Sesli Konuş (Mikrofon)'}
                    >
                      {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>

                    {/* Phase 4: Walkie-Talkie PTT Mode Button */}
                    <button
                      type="button"
                      onClick={() => setIsWalkieTalkieOpen(true)}
                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-slate-200/50 rounded-full transition-all cursor-pointer"
                      title="Saha Telsizi / Bas-Konuş (PTT) Modunu Aç"
                    >
                      <Radio className="w-4 h-4" />
                    </button>

                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={
                        selectedImage
                          ? 'Fotoğraf seçildi. İsteğe bağlı not ekleyip gönderebilirsiniz...'
                          : isListening
                          ? 'Konuşmanız dinleniyor...'
                          : 'Fabrika hakkında sorun veya irsaliye yükleyin...'
                      }
                      className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
                    />

                    <button
                      type="button"
                      onClick={() => handleSendMessage()}
                      disabled={(!inputText.trim() && !selectedImage) || isLoading || isProcessingImage}
                      className="p-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-xl transition-all shadow-sm active:scale-95 disabled:active:scale-100 cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* TAB 2: WATCHDOG ANOMALIES */}
            {activeTab === 'watchdog' && (
              <AIWatchdogPanel
                scanResult={watchdogResult}
                isLoading={isScanningWatchdog}
                onRefreshScan={() => loadWatchdogScan()}
                onSelectActionDraft={(draft) => {
                  setActiveTab('chat');
                  const draftMsg: ChatMessage = {
                    id: `a-${Date.now()}`,
                    role: 'assistant',
                    text: `📋 **${draft.title}** için telafi eylemi hazırlandı. Lütfen kontrol edip onaylayınız:`,
                    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    actionDraft: draft,
                  };
                  setMessages((prev) => [...prev, draftMsg]);
                }}
              />
            )}

            {/* TAB 3: BRIEFING */}
            {activeTab === 'briefing' && (
              <div className="flex-1 flex flex-col overflow-hidden p-4">
                {/* Actions Toolbar */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-800 text-sm">Gün Sonu Raporu</span>
                    <span className="text-[11px] text-slate-400">
                      ({snapshot ? snapshot.todayDate : 'Yükleniyor...'})
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCopyBriefing}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="Panoya Kopyala"
                    >
                      {copiedBriefing ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-600 font-semibold">Kopyalandı</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Kopyala</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleShareWhatsApp()}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="WhatsApp ile Yöneticiye İlet"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </button>

                    <button
                      onClick={() => handleShareTelegram()}
                      disabled={isSendingTelegram}
                      className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                      title="Telegram Bot ile Kanala Gönder"
                    >
                      {isSendingTelegram ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
                      ) : (
                        <Send className="w-3.5 h-3.5 text-sky-600" />
                      )}
                      <span>Telegram</span>
                    </button>

                    <button
                      onClick={handlePrintBriefing}
                      className="p-1.5 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors cursor-pointer"
                      title="Yazdır / PDF"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {telegramStatusMsg && (
                  <div className={`mt-2 p-2 rounded-lg text-xs font-medium flex items-center gap-1.5 ${telegramStatusMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                    <span>{telegramStatusMsg}</span>
                  </div>
                )}

                {/* Briefing Text Area */}
                <div className="flex-1 overflow-y-auto mt-3 bg-white p-4 rounded-xl border border-slate-200 text-sm shadow-inner">
                  {isRefreshingSnapshot ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
                      <span>Özet güncelleniyor...</span>
                    </div>
                  ) : briefingText ? (
                    <div className="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed text-xs sm:text-sm">
                      {briefingText}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                      <FileText className="w-8 h-8 text-slate-300" />
                      <span>Henüz özet oluşturulmadı.</span>
                      <button
                        onClick={loadFreshSnapshot}
                        className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold"
                      >
                        Özeti Hazırla
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Phase 4: Walkie-Talkie HUD Overlay */}
          <AIWalkieTalkieOverlay
            isOpen={isWalkieTalkieOpen}
            onClose={() => setIsWalkieTalkieOpen(false)}
            onSendQuery={(trans) => handleSendMessage(trans)}
            pendingDraft={activePendingDraft}
            onConfirmDraft={() => handleSendMessage('evet onayla')}
            onCancelDraft={() => handleSendMessage('iptal')}
            isAutoHandsFree={isAutoHandsFree}
            onToggleHandsFree={() => setIsAutoHandsFree(!isAutoHandsFree)}
          />
        </div>
      )}
    </>
  );
}
