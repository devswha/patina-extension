import { scoreProse, detectLanguage, stripNonProse } from 'patina-core';
import lexicons from 'patina-lexicons';

export const DEFAULT_SETTINGS = Object.freeze({ language: 'auto', threshold: 30 });
export const MAX_TEXT_CHARS = 50000;
export function settingsFrom(value = {}) {
  return { language: ['auto', 'en', 'ko'].includes(value.language) ? value.language : 'auto',
    threshold: typeof value.threshold === 'number' && Number.isFinite(value.threshold) && value.threshold >= 0 && value.threshold <= 100 ? value.threshold : 30 };
}

export function scoreLocal(text, settings = DEFAULT_SETTINGS) {
  if (typeof text !== 'string') throw new Error('Text is required.');
  if (text.length > MAX_TEXT_CHARS) return { available: false, reason: 'Select fewer than 50,000 characters.' };
  const options = settingsFrom(settings);
  const lang = detectLanguage('', stripNonProse(text), options.language);
  if (!Object.hasOwn(lexicons, lang)) return { available: false, reason: 'This extension currently supports English and Korean.' };
  const result = scoreProse(text, { lang, gate: options.threshold, lexicon: lexicons[lang] });
  return { available: true, language: lang, score: result.score, warning: result.overGate,
    paragraphCount: result.paragraphCount, hotCount: result.hotCount,
    shortSample: result.analysisSkipped, markupLeakage: result.markupLeakage.leaked };
}
