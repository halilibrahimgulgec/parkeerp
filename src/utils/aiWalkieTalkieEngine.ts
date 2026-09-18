/**
 * Walkie-Talkie Sound Synthesis & Voice Confirmation Engine
 * Uses Web Audio API for 100% offline, zero-latency realistic radio sound effects.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Realistic Walkie-Talkie Radio Transmission Chirp (Opening sound)
 */
export function playRadioChirp(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Frequency chirp: 850 Hz -> 1350 Hz
    osc.frequency.setValueAtTime(850, now);
    osc.frequency.exponentialRampToValueAtTime(1350, now + 0.04);
    osc.frequency.setValueAtTime(1200, now + 0.05);

    // Volume envelope
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.09);
  } catch (e) {
    console.warn('Radio chirp error:', e);
  }
}

/**
 * Realistic Radio Roger Beep (Transmission end sound)
 */
export function playRogerBeep(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1050, now);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  } catch (e) {
    console.warn('Roger beep error:', e);
  }
}

/**
 * Pleasant Success Chime for Approved Actions
 */
export function playSuccessChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    });
  } catch (e) {
    console.warn('Success chime error:', e);
  }
}

/**
 * Cancellation Tone
 */
export function playCancelChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [440, 349.23]; // A4 -> F4
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.22);
    });
  } catch (e) {
    console.warn('Cancel chime error:', e);
  }
}

/**
 * Checks if a voice transcript indicates positive confirmation
 */
export function isVoiceConfirmation(text: string): boolean {
  const t = (text || '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .trim();

  if (!t) return false;

  const confirmKeywords = [
    'evet',
    'onayla',
    'onaylıyorum',
    'onayliyorum',
    'kaydet',
    'kaydet lütfen',
    'kaydet lutfen',
    'tamam',
    'tamamdır',
    'tamamdir',
    'doğru',
    'dogru',
    'uygun',
    'olur',
    'yaz',
    'işle',
    'isle',
    'bas',
  ];

  return confirmKeywords.some((kw) => t === kw || t.startsWith(`${kw} `) || t.endsWith(` ${kw}`) || t.includes(` ${kw} `));
}

/**
 * Checks if a voice transcript indicates cancellation
 */
export function isVoiceCancellation(text: string): boolean {
  const t = (text || '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    .trim();

  if (!t) return false;

  const cancelKeywords = [
    'hayır',
    'hayir',
    'iptal',
    'iptal et',
    'vazgeç',
    'vazgec',
    'kaydetme',
    'yanlış',
    'yanlis',
    'istemiyorum',
    'dursun',
    'dur',
    'kapat',
  ];

  return cancelKeywords.some((kw) => t === kw || t.startsWith(`${kw} `) || t.endsWith(` ${kw}`) || t.includes(` ${kw} `));
}
