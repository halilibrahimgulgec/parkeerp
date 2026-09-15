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
} from 'lucide-react';
import {
  getLiveFactorySnapshot,
  generateExecutiveBriefingText,
  askFactoryAI,
  FactorySnapshot,
} from '../utils/aiFactoryBrain';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time: string;
}

const QUICK_PROMPTS = [
  { label: '📊 Bugün Üretim & Sevk', query: 'Bugünkü üretim miktarları, fire durumu ve kantar sevkiyatları ne durumda?' },
  { label: '🚨 Kritik Stoklar', query: 'Emniyet stoğu altına düşen kritik ürünler hangileri ve stokları kaç?' },
  { label: '⚖️ Kantar Tonajı', query: 'Bugün kantardan çıkan toplam kamyon sayısı ve net sevk tonajı nedir?' },
  { label: '🪵 Palet Borcu', query: 'Hangi müşterilerde paletimiz kalmış ve toplam dönmeyen palet sayısı kaç?' },
  { label: '🎯 Acil Siparişler', query: 'Bekleyen iş emirleri ve acil teslim edilmesi gereken siparişler neler?' },
  { label: '💰 Finans & Birim Maliyet', query: 'Bu ayki ciro, toplam gider ve tahmini metrekare üretim maliyeti nedir?' },
  { label: '📋 Gün Sonu Özeti', query: 'Fabrika geneli için kapsamlı bir Gün Sonu Yönetici Özeti hazırla.' },
];

export default function AIAssistantModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'briefing'>('chat');
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Load saved API key on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('parke_gemini_api_key') || '';
    setApiKey(savedKey);
  }, []);

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome-1',
          role: 'assistant',
          text: `👋 **Merhaba! Ben Parke ERP Fabrika Zekası.**\n\nFabrikanızın tüm canlı üretim hatlarını, kantar tartımlarını, depo stoklarını ve şantiyelerdeki paletleri anlık olarak izliyorum.\n\nAşağıdaki hızlı butonları kullanabilir, sesli konuşabilir veya fabrikanızla ilgili aklınıza gelen her soruyu sorabilirsiniz!`,
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
    } catch (err) {
      console.error('Fabrika verisi çekilemedi:', err);
    } finally {
      setIsRefreshingSnapshot(false);
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
    if (!query || isLoading) return;

    setInputText('');

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: query,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Ensure we have current snapshot
      let currentData = snapshot;
      if (!currentData) {
        currentData = await getLiveFactorySnapshot();
        setSnapshot(currentData);
      }

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
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error('AI yanıt üretirken hata:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: '❌ Yanıt oluşturulurken bir hata oluştu. Lütfen bağlantınızı kontrol edip tekrar deneyin.',
          time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
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

  const handleShareWhatsApp = () => {
    if (!briefingText) return;
    const encoded = encodeURIComponent(briefingText);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
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

  const saveApiKey = (newKey: string) => {
    setApiKey(newKey);
    localStorage.setItem('parke_gemini_api_key', newKey.trim());
    setShowSettings(false);
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
          className="no-print fixed inset-x-0 bottom-0 sm:bottom-20 sm:right-6 sm:left-auto w-full sm:w-[480px] h-[85vh] sm:h-[650px] max-h-[90vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl border border-slate-200/80 flex flex-col z-50 overflow-hidden transition-all duration-300"
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
                  <h3 className="font-bold text-sm text-slate-100">Parke AI Danışmanı</h3>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Canlı Veri
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate max-w-[200px]">
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

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-100 bg-slate-50/70 px-3 pt-2 gap-2 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-1.5 pb-2 px-3 border-b-2 transition-all ${
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
                setActiveTab('briefing');
                if (!briefingText && snapshot) {
                  setBriefingText(generateExecutiveBriefingText(snapshot));
                }
              }}
              className={`flex items-center gap-1.5 pb-2 px-3 border-b-2 transition-all ${
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
            <div className="bg-slate-900 text-white p-3.5 border-b border-slate-700 text-xs animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold flex items-center gap-1.5 text-amber-400">
                  <Zap className="w-3.5 h-3.5" /> Google Gemini API Yapılandırması
                </span>
                <span className="text-[10px] text-slate-400">İsteğe Bağlı</span>
              </div>
              <p className="text-slate-300 text-[11px] mb-2 leading-relaxed">
                Google AI Studio üzerinden alacağınız ücretsiz <strong>Gemini 2.0 Flash</strong> anahtarını buraya ekleyerek daha derin tahminleme gücüne erişebilirsiniz. Anahtar girilmezse dahili Fabrika Motoru sıfır konfigürasyonla kesintisiz çalışır.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="AIzaSy... (Gemini API Key)"
                  defaultValue={apiKey}
                  id="gemini-key-input"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => {
                    const el = document.getElementById('gemini-key-input') as HTMLInputElement;
                    saveApiKey(el ? el.value : '');
                  }}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition-colors"
                >
                  Kaydet
                </button>
              </div>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/50">
            {activeTab === 'chat' ? (
              <>
                {/* Quick Prompts Bar */}
                <div className="overflow-x-auto py-2 px-3 border-b border-slate-100 bg-white flex gap-1.5 no-scrollbar shrink-0">
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
                        className={`group relative max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-sm text-sm ${
                          msg.role === 'user'
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-none'
                            : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'
                        }`}
                      >
                        {msg.role === 'assistant' ? (
                          renderFormattedMarkdown(msg.text)
                        ) : (
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        )}

                        {/* Copy button for assistant */}
                        {msg.role === 'assistant' && (
                          <button
                            onClick={() => handleCopyMessage(msg.id, msg.text)}
                            className="absolute -bottom-2.5 right-2 opacity-0 group-hover:opacity-100 bg-slate-100 hover:bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 shadow-sm transition-all duration-150"
                            title="Yanıtı kopyala"
                          >
                            {copiedMsgId === msg.id ? (
                              <>
                                <Check className="w-2.5 h-2.5 text-emerald-600" />
                                <span className="text-emerald-600 font-bold">Kopyalandı</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-2.5 h-2.5" />
                                <span>Kopyala</span>
                              </>
                            )}
                          </button>
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
                        <span className="text-xs text-slate-500 font-medium ml-1">Fabrika verileri taranıyor...</span>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input Bar */}
                <div className="p-3 bg-white border-t border-slate-200 shrink-0">
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-2xl px-3 py-1.5 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all">
                    {/* Speech Recognition Mic */}
                    <button
                      type="button"
                      onClick={toggleSpeechRecognition}
                      className={`p-1.5 rounded-full transition-all ${
                        isListening
                          ? 'bg-rose-500 text-white animate-pulse'
                          : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/50'
                      }`}
                      title={isListening ? 'Dinleniyor... Durdurmak için tıklayın' : 'Sesli Konuş (Mikrofon)'}
                    >
                      {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
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
                      placeholder={isListening ? 'Konuşmanız dinleniyor...' : 'Fabrika hakkında bir şey sorun...'}
                      className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
                    />

                    <button
                      type="button"
                      onClick={() => handleSendMessage()}
                      disabled={!inputText.trim() || isLoading}
                      className="p-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-xl transition-all shadow-sm active:scale-95 disabled:active:scale-100"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* Briefing Tab */
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
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
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
                      onClick={handleShareWhatsApp}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                      title="WhatsApp ile Paylaş"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </button>

                    <button
                      onClick={handlePrintBriefing}
                      className="p-1.5 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
                      title="Yazdır / PDF"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

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
        </div>
      )}
    </>
  );
}
