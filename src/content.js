import { DEFAULT_SETTINGS, settingsFrom, scoreLocal } from './local-score.js';

const COMPOSE = '[contenteditable="true"][role="textbox"][g_editable="true"]';
const bodies = new Map();
let settings = DEFAULT_SETTINGS, scanTimer, settingsReady = false;

function update(body, entry) {
  clearTimeout(entry.timer);
  if (!body.isConnected) return;
  const text = body.innerText || '';
  try {
    const result = scoreLocal(text, settings);
    entry.badge.textContent = !text.trim() ? 'Patina —' : result.available ? `Patina ${Math.round(result.score)}%${result.markupLeakage ? ' · markup' : ''}` : 'Patina —';
    entry.badge.setAttribute('aria-label', `${entry.badge.textContent}. Refresh local writing signals.`);
    entry.badge.classList.toggle('patina-local-warning', result.available && (result.warning || result.markupLeakage));
    entry.badge.title = result.available
      ? `${result.hotCount}/${result.paragraphCount} prose paragraphs flagged. Local editing signals, not an authorship probability.${result.shortSample ? ' Short sample: interpret cautiously.' : ''}${result.markupLeakage ? ' Model-output markup also found.' : ''}`
      : result.reason;
  } catch { entry.badge.textContent = 'Patina unavailable'; entry.badge.title = 'Local inspection failed.'; }
}

function scan() {
  clearTimeout(scanTimer);
  if (!settingsReady) return;
  for (const [body, entry] of bodies) {
    if (!body.isConnected || !body.matches(COMPOSE)) { clearTimeout(entry.timer); body.removeEventListener('input', entry.input); entry.badge.remove(); bodies.delete(body); }
    else if (entry.badge.previousElementSibling !== body) body.insertAdjacentElement('afterend', entry.badge);
  }
  for (const body of document.querySelectorAll(COMPOSE)) {
    if (bodies.has(body)) continue;
    const badge = document.createElement('button');
    badge.type = 'button'; badge.className = 'patina-local-badge'; badge.dataset.patinaLocal = 'badge';
    badge.setAttribute('aria-label', 'Refresh local Patina writing signals');
    const entry = { badge, timer: null, input: null };
    entry.input = () => { clearTimeout(entry.timer); entry.timer = setTimeout(() => update(body, entry), 300); };
    badge.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); update(body, entry); });
    body.addEventListener('input', entry.input);
    // Never put UI inside the editable draft or its serialized message text.
    body.insertAdjacentElement('afterend', badge); bodies.set(body, entry); update(body, entry);
  }
}

const owned = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest?.('[data-patina-local]');
const observer = new MutationObserver((records) => {
  if (records.every((record) => owned(record.target))) return;
  const changedBodies = new Set();
  for (const record of records) {
    if (owned(record.target)) continue;
    const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    const body = target?.closest?.(COMPOSE);
    if (body && bodies.has(body)) changedBodies.add(body);
  }
  for (const body of changedBodies) bodies.get(body).input();
  clearTimeout(scanTimer); scanTimer = setTimeout(scan, 100);
});
observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['contenteditable', 'role', 'g_editable'] });

chrome.storage.local.get(DEFAULT_SETTINGS).then((value) => { settings = settingsFrom(value); settingsReady = true; scan(); }).catch(() => { settingsReady = true; scan(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.language && !changes.threshold)) return;
  settings = settingsFrom({ ...settings, ...(changes.language ? { language: changes.language.newValue } : {}), ...(changes.threshold ? { threshold: changes.threshold.newValue } : {}) });
  for (const [body, entry] of bodies) update(body, entry);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'patina-selection') return;
  const selection = window.getSelection();
  const parent = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection?.anchorNode?.parentElement;
  const focus = selection?.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection?.focusNode?.parentElement;
  const body = parent?.closest(COMPOSE);
  if (!body || !body.contains(focus) || !selection.toString().trim()) { respond({ ok: false, error: 'Select text inside a Gmail compose body first.' }); return; }
  const text = selection.toString();
  try {
    const result = scoreLocal(text, message.settings ? settingsFrom(message.settings) : settings);
    respond(result.available ? { ok: true, text, result } : { ok: false, error: result.reason });
  }
  catch { respond({ ok: false, error: 'Local inspection failed.' }); }
});
scan();
