type AppSettings = {
  provider: 'xkiro' | 'custom';
  endpoint: string;
  model: string;
  intervalSeconds: number;
  displayId: string;
  shortcut: string;
  proactive: boolean;
  launchAtLogin: boolean;
};
type CompanionStatus = {
  monitoring: boolean;
  permission: 'unknown' | 'granted' | 'denied' | 'not-determined' | 'unsupported';
  lastSnapshotAt?: number;
  message?: string;
};
type DisplayOption = { id: string; label: string; width: number; height: number; primary: boolean };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chatPanel = $('chat-panel');
const settingsPanel = $('settings-panel');
const messages = $('messages');
const question = $('question') as HTMLTextAreaElement;
const avatarButton = $('avatar-button') as HTMLButtonElement;
const hangGroup = document.querySelector('.hang-group') as HTMLElement;
const settingsForm = $('settings-form') as HTMLFormElement;
let currentStatus: CompanionStatus = { monitoring: false, permission: 'unknown' };
let savedSettings: AppSettings;
let hasSavedApiKey = false;
let toastTimer: number | undefined;
let tipTimer: number | undefined;
let lastStatusToast = '';
let overlayMode: 'compact' | 'chat' | 'settings' = 'compact';
let moveArmed = false;
let avatarDrag: {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
} | undefined;

function setOverlayMode(mode: 'compact' | 'chat' | 'settings' | 'thought') {
  if (mode !== 'thought') overlayMode = mode;
  window.companion.setOverlayMode(mode);
}

function showToast(text: string) {
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.remove('hidden');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 5200);
}

function setStatus(status: CompanionStatus) {
  currentStatus = status;
  const isPreview = status.permission === 'unsupported';
  const state = $('state-label');
  const dot = $('state-dot').parentElement;
  state.textContent = isPreview ? (status.monitoring ? 'Preview active' : 'Preview') : (status.monitoring ? 'Watching' : 'Paused');
  dot?.classList.toggle('active', status.monitoring);
  const watchToggle = $('watch-toggle') as HTMLButtonElement;
  watchToggle.textContent = status.monitoring ? 'Pause watching' : 'Start watching';
  watchToggle.setAttribute('aria-pressed', String(status.monitoring));
  $('panel-status').textContent = status.message ?? (status.monitoring ? 'Watching this display.' : 'Ready when you are.');
  if (status.permission === 'denied') showToast('Screen permission is blocked. Open Settings for help.');
  else if (status.message && /set up|blocked|could not|failed|unavailable|http \d+|timed out|permission|preview mode|needs login approval|did not register|has not enabled|shortcut unavailable/i.test(status.message) && status.message !== lastStatusToast) {
    lastStatusToast = status.message;
    showToast(status.message);
  }
}

function addMessage(text: string, who: 'assistant' | 'user' | 'error') {
  const node = document.createElement('div');
  node.className = `message ${who === 'error' ? 'assistant error' : who}`;
  node.textContent = text;
  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

function openChat() {
  setOverlayMode('chat');
  settingsPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  question.focus();
}

function openMascot() {
  chatPanel.classList.add('hidden');
  settingsPanel.classList.add('hidden');
  overlayMode = 'compact';
  window.companion.setOverlayMode($('tip-bubble').classList.contains('hidden') ? 'compact' : 'thought');
}

async function showSettings() {
  setOverlayMode('settings');
  chatPanel.classList.add('hidden');
  settingsPanel.classList.remove('hidden');
  await populateSettings();
}

async function populateSettings() {
  savedSettings = await window.companion.getSettings();
  const displays = await window.companion.listDisplays();
  const displaySelect = $('display') as HTMLSelectElement;
  displaySelect.replaceChildren(...displays.map((display: DisplayOption) => {
    const option = document.createElement('option');
    option.value = display.id;
    option.textContent = `${display.label}${display.primary ? ' · Primary' : ''}`;
    return option;
  }));
  if (displays.length) displaySelect.value = displays.some((display) => display.id === savedSettings.displayId) ? savedSettings.displayId : displays.find((display) => display.primary)!.id;
  ($('provider') as HTMLSelectElement).value = savedSettings.provider;
  ($('endpoint') as HTMLInputElement).value = savedSettings.endpoint;
  ($('endpoint-wrap')).classList.toggle('hidden', savedSettings.provider !== 'custom');
  ($('model') as HTMLInputElement).value = savedSettings.model;
  ($('interval') as HTMLSelectElement).value = String(savedSettings.intervalSeconds);
  ($('proactive') as HTMLInputElement).checked = savedSettings.proactive;
  ($('launch-at-login') as HTMLInputElement).checked = savedSettings.launchAtLogin;
  ($('shortcut') as HTMLInputElement).value = savedSettings.shortcut;
  ($('api-key') as HTMLInputElement).value = '';
  hasSavedApiKey = await window.companion.hasApiKey();
  updateConnectionSummary();
  await updateLaunchStatus(savedSettings);
  $('settings-message').textContent = '';
}

function updateConnectionSummary() {
  const provider = ($('provider') as HTMLSelectElement).value as AppSettings['provider'];
  const endpoint = ($('endpoint') as HTMLInputElement).value.trim();
  const model = ($('model') as HTMLInputElement).value.trim();
  const providerName = provider === 'xkiro' ? 'xKiro unified API' : 'Custom OpenAI-compatible API';
  const selectedEndpoint = provider === 'custom' && endpoint ? ` · ${endpoint}` : '';
  const selectedModel = model ? ` · ${model}` : ' · no model selected';
  $('connection-summary').textContent = `Selected connection: ${providerName}${selectedEndpoint}${selectedModel}`;
  $('key-status').textContent = hasSavedApiKey
    ? 'A saved API key is encrypted on this device. The full key stays hidden; enter another key only to replace it.'
    : 'No API key is saved yet. Enter a key to use this connection.';
}

async function updateLaunchStatus(settings: AppSettings) {
  const status = await window.companion.getStatus();
  const launchIssue = status.message && /login approval|did not register Spider-Man|has not enabled Spider-Man|Could not update automatic launch/i.test(status.message);
  $('launch-status').textContent = window.companion.isPreview
    ? 'Chrome preview only; automatic launch is available in the desktop app.'
    : launchIssue
      ? status.message!
      : settings.launchAtLogin
        ? 'Enabled. Spider-Man opens after sign-in; screen watching stays paused.'
        : 'Disabled. Start Spider-Man manually after sign-in.';
}

function setBusy(button: HTMLButtonElement, busy: boolean, idleText: string) {
  button.disabled = busy;
  button.textContent = busy ? 'Thinking…' : idleText;
}

avatarButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || (!moveArmed && !window.companion.isPreview)) return;
  event.preventDefault();
  avatarDrag = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    lastX: event.screenX,
    lastY: event.screenY,
    moved: false
  };
  avatarButton.setPointerCapture(event.pointerId);
});

avatarButton.addEventListener('pointermove', (event) => {
  const drag = avatarDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.screenX - drag.lastX;
  const dy = event.screenY - drag.lastY;
  if (!drag.moved && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) >= 5) {
    drag.moved = true;
    hangGroup.classList.add('is-dragging');
    window.companion.moveOverlayBy(event.screenX - drag.startX, event.screenY - drag.startY);
  } else if (drag.moved && (dx !== 0 || dy !== 0)) {
    window.companion.moveOverlayBy(dx, dy);
  }
  drag.lastX = event.screenX;
  drag.lastY = event.screenY;
});

avatarButton.addEventListener('pointerup', (event) => {
  if (!avatarDrag || avatarDrag.pointerId !== event.pointerId) return;
  const wasDragged = avatarDrag.moved;
  avatarDrag = undefined;
  hangGroup.classList.remove('is-dragging');
  if (window.companion.isPreview) {
    if (!wasDragged) openChat();
  }
  window.companion.finishOverlayMove();
});

avatarButton.addEventListener('pointercancel', () => {
  avatarDrag = undefined;
  hangGroup.classList.remove('is-dragging');
  if (moveArmed && !window.companion.isPreview) window.companion.finishOverlayMove();
});

avatarButton.addEventListener('click', (event) => {
  if (event.detail === 0) openChat();
});

$('chat-settings').addEventListener('click', () => void showSettings());
$('close-chat').addEventListener('click', openMascot);
$('close-settings').addEventListener('click', openMascot);
$('watch-toggle').addEventListener('click', async () => {
  const button = $('watch-toggle') as HTMLButtonElement;
  button.disabled = true;
  try {
    setStatus(await window.companion.setMonitoring(!currentStatus.monitoring));
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not change screen watching.');
  } finally {
    button.disabled = false;
  }
});
$('ask-now').addEventListener('click', () => question.focus());
$('move-toggle').addEventListener('click', () => {
  if (moveArmed) window.companion.finishOverlayMove();
  else window.companion.armOverlayMove();
});
$('provider').addEventListener('change', () => {
  $('endpoint-wrap').classList.toggle('hidden', ($('provider') as HTMLSelectElement).value !== 'custom');
  updateConnectionSummary();
});
$('model').addEventListener('input', updateConnectionSummary);
$('endpoint').addEventListener('input', updateConnectionSummary);
$('permission-button').addEventListener('click', () => void window.companion.openSystemSettings());
$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (!text) return;
  const button = $('send-button') as HTMLButtonElement;
  addMessage(text, 'user');
  question.value = '';
  setBusy(button, true, 'Send');
  const panelStatus = $('panel-status');
  let requestFailed = false;
  try {
    let imageDataUrl: string | undefined;
    if (currentStatus.monitoring) {
      panelStatus.textContent = 'Capturing a smaller screen snapshot…';
      imageDataUrl = await window.companion.captureSnapshot(savedSettings?.displayId ?? '');
    }
    panelStatus.textContent = 'Waiting for a quick reply…';
    const result = await window.companion.ask({ question: text, imageDataUrl });
    const reply = result.text || 'I couldn’t think of a useful reply that time. Try asking a more specific question.';
    addMessage(reply, 'assistant');
    showThought(reply);
  } catch (error) {
    addMessage(error instanceof Error ? error.message : 'Something went wrong. Check your settings and try again.', 'error');
    panelStatus.textContent = 'Could not get a reply. See the message below.';
    requestFailed = true;
  } finally {
    setBusy(button, false, 'Send');
    question.focus();
    if (!requestFailed) panelStatus.textContent = currentStatus.monitoring ? 'Watching this display.' : 'Ready when you are.';
  }
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = settingsForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  const message = $('settings-message');
  saveButton.disabled = true;
  message.className = 'settings-message';
  message.textContent = 'Saving…';
  try {
    const provider = ($('provider') as HTMLSelectElement).value as AppSettings['provider'];
    const endpoint = provider === 'xkiro' ? 'https://api.xkiro.com/v1' : ($('endpoint') as HTMLInputElement).value.trim();
    if (provider === 'custom') {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Use an HTTPS API endpoint. Localhost endpoints may use HTTP.');
    }
    const next: AppSettings = {
      provider,
      endpoint,
      model: ($('model') as HTMLInputElement).value.trim(),
      intervalSeconds: Number(($('interval') as HTMLSelectElement).value),
      displayId: ($('display') as HTMLSelectElement).value,
      shortcut: ($('shortcut') as HTMLInputElement).value.trim() || 'CommandOrControl+Shift+Space',
      proactive: ($('proactive') as HTMLInputElement).checked,
      launchAtLogin: ($('launch-at-login') as HTMLInputElement).checked
    };
    savedSettings = await window.companion.saveSettings(next);
    const key = ($('api-key') as HTMLInputElement).value.trim();
    if (key) { await window.companion.saveApiKey(key); ($('api-key') as HTMLInputElement).value = ''; }
    hasSavedApiKey = await window.companion.hasApiKey();
    updateConnectionSummary();
    await updateLaunchStatus(savedSettings);
    message.textContent = 'Settings saved.';
  } catch (error) {
    message.className = 'settings-message error';
    message.textContent = error instanceof Error ? error.message : 'Could not save settings.';
  } finally { saveButton.disabled = false; }
});

window.companion.onStatus(setStatus);
window.companion.onHotkey(openChat);
window.companion.onMoveMode((enabled) => {
  moveArmed = enabled;
  hangGroup.classList.toggle('is-move-armed', enabled);
  const moveButton = $('move-toggle') as HTMLButtonElement;
  moveButton.textContent = enabled ? 'Drag to move' : 'Move Spider-Man';
  moveButton.setAttribute('aria-pressed', String(enabled));
  const hint = enabled
    ? 'Drag Spider-Man to move. Click without dragging to cancel.'
    : window.companion.isPreview
      ? 'Drag to move · Click to chat'
      : 'Mouse clicks pass through. Use the shortcut or tray to chat.';
  avatarButton.title = hint;
  avatarButton.setAttribute('aria-label', hint);
});
window.companion.onTip(showThought);
window.companion.getStatus().then(setStatus);
window.companion.getSettings().then(async (settings) => {
  savedSettings = settings;
  if (!window.companion.isPreview && (!settings.model || !(await window.companion.hasApiKey()))) void showSettings();
});
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') openMascot(); });

function showThought(text: string) {
  if (!text || text === 'NO_TIP') return;
  const preview = text.replace(/\s+/g, ' ').trim();
  if (!preview) return;
  const bubble = $('tip-bubble');
  $('thought-text').textContent = preview;
  bubble.setAttribute('aria-label', 'Spider-Man has a suggestion: ' + preview.slice(0, 160) + '. Open chat for the full reply.');
  bubble.classList.remove('hidden');
  if (overlayMode === 'compact') setOverlayMode('thought');
  if (tipTimer) window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => {
    bubble.classList.add('hidden');
    if (overlayMode === 'compact') setOverlayMode('compact');
  }, 11_000);
}

$('tip-bubble').addEventListener('click', openChat);

