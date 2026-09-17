/**
 * Turkish Text-to-Speech (TTS) Engine for Parke ERP Field Operations
 */

export function cleanMarkdownForSpeech(raw: string): string {
  if (!raw) return '';

  return raw
    // Remove emojis
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '')
    // Replace unit abbreviations with spoken Turkish words
    .replace(/m²|m2\b/gi, ' metrekare ')
    .replace(/\bkg\b/gi, ' kilogram ')
    .replace(/\bad\b|\badet\b/gi, ' adet ')
    .replace(/₺/g, ' Türk Lirası ')
    .replace(/TL\b/gi, ' Türk Lirası ')
    .replace(/%/g, ' yüzde ')
    .replace(/➔|->|=>/g, ' yani ')
    // Remove markdown headers, bold, italics, code blocks
    .replace(/#{1,6}\s?/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    // Remove bullet points and divider lines
    .replace(/^\s*[\*\-\•]\s+/gm, '')
    .replace(/^[=\-_]{3,}$/gm, '')
    // Remove square brackets, links and parenthesis formatting
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\[\]]/g, '')
    // Normalize spaces and line breaks
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let activeUtterance: SpeechSynthesisUtterance | null = null;

export function speakTurkishText(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: (err: any) => void
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('Tarayıcı ses sentezleme (TTS) özelliğini desteklemiyor.');
    return;
  }

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const spokenText = cleanMarkdownForSpeech(text);
  if (!spokenText) return;

  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = 'tr-TR';
  utterance.rate = 1.05; // Slightly brisk for field efficiency
  utterance.pitch = 1.0;

  // Try to find a high quality Turkish voice
  const voices = window.speechSynthesis.getVoices();
  const trVoice = voices.find(v => v.lang.startsWith('tr') || v.lang.includes('TR'));
  if (trVoice) {
    utterance.voice = trVoice;
  }

  utterance.onstart = () => {
    activeUtterance = utterance;
    onStart?.();
  };

  utterance.onend = () => {
    activeUtterance = null;
    onEnd?.();
  };

  utterance.onerror = (e) => {
    activeUtterance = null;
    onError?.(e);
  };

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    activeUtterance = null;
  }
}

export function isSpeaking(): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  return window.speechSynthesis.speaking;
}
