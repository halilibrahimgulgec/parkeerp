import { supabase } from '../lib/supabase';

export interface AILearnedRule {
  id: string;
  originalQuery?: string;
  wrongAnswer?: string;
  rule: string;
  category: 'pallet' | 'production' | 'shipment' | 'stock' | 'cost' | 'general';
  createdAt: string;
}

const STORAGE_KEY = 'parke_ai_learned_rules';

// Pre-seeded foundational factory rules
const DEFAULT_RULES: AILearnedRule[] = [
  {
    id: 'default-1',
    rule: 'Fabrikada günlük çalışma süresi 10 saattir ve Pazar günleri tatildir.',
    category: 'production',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'default-2',
    rule: 'Palet takibinde Üretim Paleti ve Tahta Palet mutlaka ayrı kalemler olarak raporlanmalıdır.',
    category: 'pallet',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'default-3',
    rule: 'Şantiyelerdeki tahta palet depozito bedeli ~300 TL, çelik/üretim paleti bedeli ~600 TL olarak kabul edilir.',
    category: 'pallet',
    createdAt: new Date().toISOString(),
  },
];

/**
 * Load all learned rules (LocalStorage + Supabase sync fallback)
 */
export function getLearnedRules(): AILearnedRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_RULES));
      return DEFAULT_RULES;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RULES;
  } catch (err) {
    console.error('Öğrenilmiş kurallar okunamadı:', err);
    return DEFAULT_RULES;
  }
}

/**
 * Add a new learned rule or error correction
 */
export function addLearnedRule(
  ruleText: string,
  category: AILearnedRule['category'] = 'general',
  originalQuery?: string,
  wrongAnswer?: string
): AILearnedRule {
  const current = getLearnedRules();
  const newRule: AILearnedRule = {
    id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    originalQuery,
    wrongAnswer,
    rule: ruleText.trim(),
    category,
    createdAt: new Date().toISOString(),
  };

  const updated = [newRule, ...current];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Kural kaydedilemedi:', err);
  }

  // Attempt async sync to Supabase if table exists
  try {
    (async () => {
      try {
        await (supabase.from('ai_knowledge_rules') as any).insert({
          rule_text: newRule.rule,
          original_query: newRule.originalQuery,
          wrong_answer: newRule.wrongAnswer,
          category: newRule.category,
        });
      } catch {}
    })();
  } catch {}

  return newRule;
}

/**
 * Delete a learned rule
 */
export function deleteLearnedRule(id: string): void {
  const current = getLearnedRules();
  const updated = current.filter((r) => r.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Kural silinemedi:', err);
  }
}

/**
 * Format learned rules for injection into AI prompts
 */
export function formatRulesForPrompt(): string {
  const rules = getLearnedRules();
  if (rules.length === 0) return '';

  return rules
    .map((r, i) => `${i + 1}. [${r.category.toUpperCase()}] ${r.rule}${r.originalQuery ? ` (Kullanıcı "${r.originalQuery}" sorduğunda bu kuralı hatırla)` : ''}`)
    .join('\n');
}
