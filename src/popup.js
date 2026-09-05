const language = document.querySelector('#language');
const threshold = document.querySelector('#threshold');
const status = document.querySelector('#status');
const selected = document.querySelector('#selection');
let requestId = 0;

chrome.storage.local.get({ language: 'auto', threshold: 30 }).then((settings) => {
  language.value = ['auto', 'en', 'ko'].includes(settings.language) ? settings.language : 'auto';
  threshold.value = Number.isFinite(settings.threshold) ? settings.threshold : 30;
});
const save = () => {
  const parsed = threshold.value.trim() === '' ? 30 : Number(threshold.value);
  const value = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 30; threshold.value = value;
  chrome.storage.local.set({ language: language.value, threshold: value });
};
language.addEventListener('change', save); threshold.addEventListener('change', save);

async function selection(showHandoff) {
  const request = ++requestId;
  document.querySelector('#handoff').hidden = true; selected.value = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id) || tab.id < 0) throw new Error('Open Gmail and select text in a compose body.');
    let reply;
    try { reply = await chrome.tabs.sendMessage(tab.id, { type: 'patina-selection', settings: { language: language.value, threshold: Number(threshold.value) } }); }
    catch { throw new Error('Open Gmail and reload it after installing the extension.'); }
    if (request !== requestId) return;
    if (!reply?.ok) throw new Error(reply?.error || 'The Gmail page is not ready. Reload it after installing the extension.');
    if (!reply.result.available) throw new Error(reply.result.reason);
    status.textContent = `${Math.round(reply.result.score)}% — ${reply.result.hotCount}/${reply.result.paragraphCount} prose paragraphs flagged.${reply.result.shortSample ? ' Short sample.' : ''}${reply.result.markupLeakage ? ' Model-output markup also found.' : ''}`;
    if (showHandoff) {
      selected.value = reply.text;
      document.querySelector('#command').textContent = `patina --verify --lang ${reply.result.language} draft.txt`;
      document.querySelector('#handoff').hidden = false;
    }
  } catch (error) { if (request === requestId) status.textContent = error.message || 'Local inspection unavailable.'; }
}
document.querySelector('#score').addEventListener('click', () => selection(false));
document.querySelector('#humanize').addEventListener('click', () => selection(true));
document.querySelector('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(selected.value); status.textContent = 'Selection copied. Review the CLI output before pasting it back.'; }
  catch { selected.focus(); selected.select(); status.textContent = 'Press Ctrl+C or Command+C to copy the selection.'; }
});
