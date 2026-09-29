import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, shell, Tray, systemPreferences } from 'electron';
import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppSettings, ChatRequest, CompanionStatus, DisplayOption } from './types';

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'xkiro',
  endpoint: 'https://api.xkiro.com/v1',
  model: 'qwen/qwen3-coder-plus:free',
  intervalSeconds: 5,
  displayId: '',
  shortcut: 'CommandOrControl+Shift+Space',
  proactive: true,
  launchAtLogin: true
};

let overlay: BrowserWindow | null = null;
let tray: Tray | null = null;
let monitoring = false;
let settings = { ...DEFAULT_SETTINGS };
let status: CompanionStatus = { monitoring: false, permission: 'unknown', message: 'Ready when you are.' };
let lastTipAt = 0;
let lastTipText = '';
let snapshotInFlight = false;
let snapshotTimer: NodeJS.Timeout | undefined;
let settingsPath = '';
let overlayPositionPath = '';
let savedOverlayPosition: { x: number; y: number } | undefined;
let overlayWebInset = 48;
let overlayPositionNeedsMigration = false;
let overlayPositionSaveTimer: NodeJS.Timeout | undefined;
let credentialPath = '';
let overlayMode: 'compact' | 'chat' | 'settings' | 'thought' = 'compact';
let moveMode = false;
let moveModeTimer: NodeJS.Timeout | undefined;

// Some Windows hosts cannot start Chromium's GPU process; software rendering
// keeps the companion available there and does not affect screen capture.
app.commandLine.appendSwitch('in-process-gpu');
app.disableHardwareAcceleration();

// Use a fresh profile folder to avoid a Chromium lock conflict on some Windows
// setups. Migrate the old settings and Electron encryption state intact.
const previousUserData = app.getPath('userData');
const companionUserData = path.join(app.getPath('appData'), 'Spider-Man Companion');
if (path.resolve(previousUserData).toLowerCase() !== path.resolve(companionUserData).toLowerCase()) {
  try {
    mkdirSync(companionUserData, { recursive: true });
    const hasMigratedSettings = existsSync(path.join(companionUserData, 'settings.json'));
    if (!hasMigratedSettings) {
      for (const filename of ['Local State', 'settings.json', 'api-key.enc']) {
        const source = path.join(previousUserData, filename);
        if (existsSync(source)) copyFileSync(source, path.join(companionUserData, filename));
      }
    }
    app.setPath('userData', companionUserData);
  } catch (error) {
    console.warn('Could not prepare the companion profile folder:', error);
  }
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!overlay) return;
    if (overlay.isMinimized()) overlay.restore();
    overlay.show();
    overlay.focus();
  });
}

function publishStatus(patch: Partial<CompanionStatus>): CompanionStatus {
  status = { ...status, ...patch, monitoring };
  overlay?.webContents.send('status:changed', status);
  updateTrayMenu();
  return status;
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: monitoring ? 'Pause screen watching' : 'Start screen watching', click: () => void setMonitoring(!monitoring) },
    { label: 'Open Spider-Man chat', click: showChatFromShortcut },
    { type: 'separator' },
    {
      label: moveMode ? 'Cancel Spider-Man move' : 'Move Spider-Man',
      click: () => setMoveMode(!moveMode)
    },
    { label: overlay?.isVisible() ? 'Hide Spider-Man' : 'Show Spider-Man', click: toggleOverlayVisibility },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Spider-Man Companion · ${monitoring ? 'Watching' : 'Paused'} · ${moveMode ? 'Move mode' : 'Clicks pass through'}`);
}

function showChatFromShortcut() {
  const target = overlay;
  if (!target || target.isDestroyed()) return;
  setOverlayMode('chat');
  target.show();
  target.focus();
  const sendHotkey = () => {
    if (!target.isDestroyed()) target.webContents.send('hotkey:pressed');
  };
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', sendHotkey);
  else sendHotkey();
}

function updateMouseInputMode() {
  if (!overlay || overlay.isDestroyed()) return;
  const panelIsOpen = overlayMode === 'chat' || overlayMode === 'settings';
  // Compact and thought modes always pass input through, except during a
  // deliberate one-shot move action. Do not forward hover events to the page.
  overlay.setIgnoreMouseEvents(!panelIsOpen && !moveMode);
}

function setMoveMode(enabled: boolean) {
  if (!overlay || overlay.isDestroyed()) return;
  if (moveModeTimer) clearTimeout(moveModeTimer);
  moveModeTimer = undefined;
  moveMode = enabled;
  if (enabled) {
    moveModeTimer = setTimeout(() => {
      saveOverlayPosition();
      setMoveMode(false);
    }, 15_000);
    if (!overlay.isVisible()) overlay.show();
  }
  updateMouseInputMode();
  overlay.webContents.send('overlay:move-mode', moveMode);
  updateTrayMenu();
}

function toggleOverlayVisibility() {
  if (!overlay || overlay.isDestroyed()) return;
  if (overlay.isVisible()) {
    if (moveMode) setMoveMode(false);
    overlay.hide();
  }
  else overlay.show();
  updateTrayMenu();
}

function positionOverlay(width: number, height: number) {
  if (!overlay) return;
  const initialPosition = savedOverlayPosition;
  const display = initialPosition
    ? screen.getDisplayMatching({ x: initialPosition.x, y: initialPosition.y, width, height })
    : screen.getPrimaryDisplay();
  const { x, y, width: workWidth, height: workHeight } = display.workArea;
  const safeWidth = Math.min(width, Math.max(1, workWidth - 16));
  const safeHeight = Math.min(height, Math.max(1, workHeight - 24));
  const maxX = x + workWidth - safeWidth;
  const maxY = y + workHeight - safeHeight;
  if (!initialPosition) {
    overlayWebInset = Math.max(0, y + Math.min(48, Math.max(0, workHeight - safeHeight)) - display.bounds.y);
  }
  overlay.setBounds({
    x: initialPosition ? Math.min(maxX, Math.max(x, initialPosition.x)) : maxX - 12,
    y: initialPosition ? Math.min(maxY, Math.max(display.bounds.y, initialPosition.y)) : display.bounds.y,
    width: safeWidth,
    height: safeHeight
  });
}

async function loadOverlayPosition() {
  try {
    const saved = JSON.parse(await readFile(overlayPositionPath, 'utf8')) as { version?: unknown; x?: unknown; y?: unknown; webInset?: unknown };
    if (typeof saved.x === 'number' && Number.isFinite(saved.x) && Math.abs(saved.x) <= 1_000_000
      && typeof saved.y === 'number' && Number.isFinite(saved.y) && Math.abs(saved.y) <= 1_000_000) {
      const x = Math.round(saved.x);
      const y = Math.round(saved.y);
      if (saved.version === 2 && typeof saved.webInset === 'number' && Number.isFinite(saved.webInset)) {
        savedOverlayPosition = { x, y };
        overlayWebInset = Math.min(160, Math.max(0, Math.round(saved.webInset)));
      } else {
        const display = screen.getDisplayMatching({ x, y, width: 220, height: 390 });
        const oldTopInset = Math.max(0, display.workArea.y + Math.min(48, Math.max(0, display.workArea.height - 390)) - display.bounds.y);
        overlayWebInset = Math.min(oldTopInset, Math.max(0, y - display.bounds.y));
        savedOverlayPosition = { x, y: y - overlayWebInset };
        overlayPositionNeedsMigration = true;
      }
    }
  } catch {
    savedOverlayPosition = undefined;
  }
}

function saveOverlayPosition() {
  if (overlayPositionSaveTimer) clearTimeout(overlayPositionSaveTimer);
  overlayPositionSaveTimer = undefined;
  if (!overlay || overlay.isDestroyed() || !overlayPositionPath) return;
  const { x, y } = overlay.getBounds();
  savedOverlayPosition = { x, y };
  const temporaryPath = `${overlayPositionPath}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify({ version: 2, x, y, webInset: overlayWebInset }), 'utf8');
    renameSync(temporaryPath, overlayPositionPath);
    overlayPositionNeedsMigration = false;
  } catch (error) {
    console.warn('Could not save Spider-Man’s position:', error);
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch (cleanupError) {
      console.warn('Could not clean up Spider-Man’s temporary position file:', cleanupError);
    }
  }
}

function scheduleOverlayPositionSave() {
  if (overlayPositionSaveTimer) clearTimeout(overlayPositionSaveTimer);
  overlayPositionSaveTimer = setTimeout(() => {
    overlayPositionSaveTimer = undefined;
    saveOverlayPosition();
  }, 250);
}

function resizeOverlay(width: number, height: number) {
  if (!overlay) return;
  const bounds = overlay.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const safeWidth = Math.min(width, Math.max(1, area.width));
  const safeHeight = Math.min(height, Math.max(1, area.height));
  const maxX = area.x + area.width - safeWidth;
  const maxY = area.y + area.height - safeHeight;
  const right = bounds.x + bounds.width;
  const x = Math.min(maxX, Math.max(area.x, right - safeWidth));
  const y = Math.min(maxY, Math.max(display.bounds.y, bounds.y));
  overlay.setBounds({ x, y, width: safeWidth, height: safeHeight });
}

function moveOverlayBy(dx: number, dy: number) {
  if (!overlay || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 10_000 || Math.abs(dy) > 10_000) return;
  const bounds = overlay.getBounds();
  const nextBounds = { ...bounds, x: bounds.x + Math.round(dx), y: bounds.y + Math.round(dy) };
  const display = screen.getDisplayMatching(nextBounds);
  const area = display.workArea;
  const maxX = Math.max(area.x, area.x + area.width - bounds.width);
  const maxY = Math.max(area.y, area.y + area.height - bounds.height);
  overlay.setPosition(
    Math.min(maxX, Math.max(area.x, nextBounds.x)),
    Math.min(maxY, Math.max(display.bounds.y, nextBounds.y))
  );
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: 220,
    height: 390,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setContentProtection(true);
  overlay.setIgnoreMouseEvents(true);
  positionOverlay(220, 390);
  const target = overlay;
  target.on('move', scheduleOverlayPositionSave);
  target.on('query-session-end', saveOverlayPosition);
  target.on('session-end', saveOverlayPosition);
  target.webContents.on('did-finish-load', () => {
    if (!target.isDestroyed()) target.webContents.send('overlay:move-mode', moveMode);
  });
  const rendererPath = path.resolve(__dirname, '../renderer/index.html');
  const rendererUrl = pathToFileURL(rendererPath);
  rendererUrl.searchParams.set('webInset', String(overlayWebInset));
  void target.loadURL(rendererUrl.href).then(() => {
    if (!target.isDestroyed()) target.show();
  }).catch((error: unknown) => {
    console.error('Could not load the Spider-Man companion window:', error);
    publishStatus({ message: 'The companion window could not load. Restart it from START-SPIDER-MAN.bat.' });
    if (!target.isDestroyed()) target.show();
  });
  overlay.once('ready-to-show', () => overlay?.show());
  overlay.on('show', updateTrayMenu);
  overlay.on('hide', updateTrayMenu);
  overlay.on('closed', () => { overlay = null; updateTrayMenu(); });
}

function setOverlayMode(mode: 'compact' | 'chat' | 'settings' | 'thought') {
  if (!overlay) return;
  if ((mode === 'chat' || mode === 'settings') && moveMode) setMoveMode(false);
  overlayMode = mode;
  if (mode === 'compact') {
    resizeOverlay(220, 390);
    updateMouseInputMode();
    updateTrayMenu();
    return;
  }
  if (mode === 'thought') {
    resizeOverlay(560, 390);
    updateMouseInputMode();
    updateTrayMenu();
    return;
  }
  const width = 600;
  const height = mode === 'settings' ? 620 : 560;
  resizeOverlay(width, height);
  updateMouseInputMode();
  updateTrayMenu();
}

async function loadSettings() {
  try {
    const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as Partial<AppSettings>;
    settings = { ...DEFAULT_SETTINGS, ...saved, launchAtLogin: saved.launchAtLogin !== false };
  } catch { settings = { ...DEFAULT_SETTINGS }; }
}

async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const validIntervals = [5, 10, 15, 30, 60];
  settings = {
    ...DEFAULT_SETTINGS,
    ...next,
    provider: next.provider === 'custom' ? 'custom' : 'xkiro',
    endpoint: (next.provider === 'custom' ? next.endpoint : 'https://api.xkiro.com/v1').trim().replace(/\/+$/, ''),
    model: next.model.trim(),
    intervalSeconds: validIntervals.includes(next.intervalSeconds) ? next.intervalSeconds : 5,
    shortcut: next.shortcut.trim() || DEFAULT_SETTINGS.shortcut,
    launchAtLogin: next.launchAtLogin !== false
  };
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  const shortcutRegistered = registerShortcut(settings.shortcut);
  const launchMessage = configureLoginItem();
  publishStatus({ message: [launchMessage, !shortcutRegistered ? `Shortcut unavailable: ${settings.shortcut}. Choose another shortcut in Settings.` : ''].filter(Boolean).join(' ') });
  if (monitoring) scheduleSnapshot(0);
  return settings;
}

function registerShortcut(accelerator: string): boolean {
  globalShortcut.unregisterAll();
  return globalShortcut.register(accelerator, showChatFromShortcut);
}

function configureLoginItem(): string {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return 'Automatic launch is supported on Windows and macOS only.';
  }

  const loginItem: Electron.Settings = { openAtLogin: settings.launchAtLogin };
  let windowsQuery: { path: string; args: string[] } | undefined;
  if (process.platform === 'win32') {
    const args = app.isPackaged ? [] : [`"${app.getAppPath()}"`];
    loginItem.path = process.execPath;
    loginItem.args = args;
    loginItem.name = 'Spider-Man Companion';
    loginItem.enabled = settings.launchAtLogin;
    windowsQuery = { path: process.execPath, args };
  }

  try {
    app.setLoginItemSettings(loginItem);
    if (!settings.launchAtLogin) return 'Spider-Man automatic launch is off.';
    const loginStatus = app.getLoginItemSettings(windowsQuery);
    if (process.platform === 'darwin') {
      if (loginStatus.status === 'requires-approval') {
        return 'macOS needs login approval. Enable Spider-Man Companion in System Settings > General > Login Items.';
      }
      if (loginStatus.status !== 'enabled') {
        return 'macOS did not register Spider-Man for login. Use the packaged, signed app and allow it in System Settings > General > Login Items.';
      }
    } else if (!loginStatus.openAtLogin) {
      return 'Windows has not enabled Spider-Man at sign-in. Enable it under Settings > Apps > Startup.';
    }
    return 'Spider-Man will launch after sign-in. Screen watching will stay paused.';
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    return `Could not update automatic launch settings.${detail}`;
  }
}

async function listDisplays(): Promise<DisplayOption[]> {
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: `Display ${index + 1}${display.bounds.width}×${display.bounds.height}`,
    width: display.bounds.width,
    height: display.bounds.height,
    primary: display.id === screen.getPrimaryDisplay().id
  }));
}

function permissionStatus(): CompanionStatus['permission'] {
  if (process.platform !== 'darwin') return 'granted';
  const permission = systemPreferences.getMediaAccessStatus('screen');
  if (permission === 'granted' || permission === 'denied' || permission === 'not-determined') return permission;
  return 'unknown';
}

async function captureSnapshot(displayId: string): Promise<string> {
  if (!monitoring) throw new Error('Screen watching is paused.');
  if (process.platform === 'darwin') {
    const permission = permissionStatus();
    if (permission === 'denied') {
      publishStatus({ permission, message: 'Screen Recording access is blocked. Enable it in System Settings, then restart the app.' });
      throw new Error(status.message);
    }
  }
  const displays = await listDisplays();
  const chosen = displays.find((display) => display.id === displayId) ?? displays.find((display) => display.id === settings.displayId) ?? displays.find((display) => display.primary) ?? displays[0];
  if (!chosen) throw new Error('No display is available to capture.');
  const maxWidth = 960;
  const scale = Math.min(1, maxWidth / chosen.width);
  let sources: Awaited<ReturnType<typeof desktopCapturer.getSources>>;
  try {
    // On macOS, the first capture request is what triggers the system Screen Recording permission prompt.
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.max(1, Math.round(chosen.width * scale)), height: Math.max(1, Math.round(chosen.height * scale)) },
      fetchWindowIcons: false
    });
  } catch {
    const permission = permissionStatus();
    publishStatus({ permission, message: permission === 'denied' ? 'Screen Recording access is blocked. Enable it in System Settings, then restart the app.' : 'Screen capture could not start. Check the operating system’s screen recording permissions.' });
    throw new Error(status.message);
  }
  const source = sources.find((entry) => entry.display_id === chosen.id) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    const permission = permissionStatus();
    publishStatus({ permission, message: 'Could not capture the display. Check screen recording permissions and try again.' });
    throw new Error(status.message);
  }
  const dataUrl = `data:image/jpeg;base64,${source.thumbnail.toJPEG(65).toString('base64')}`;
  publishStatus({ permission: 'granted', lastSnapshotAt: Date.now(), message: 'Screen updated.' });
  return dataUrl;
}

async function readApiKey(): Promise<string> {
  const encrypted = await readFile(credentialPath);
  return safeStorage.decryptString(encrypted);
}

async function saveApiKey(key: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
  if (!key.trim()) throw new Error('Enter an API key first.');
  await writeFile(credentialPath, safeStorage.encryptString(key.trim()));
}

async function ask(request: ChatRequest): Promise<{ text: string }> {
  const apiKey = await readApiKey().catch(() => '');
  if (!apiKey) throw new Error('Add your API key in Settings before asking Spider-Man.');
  if (!settings.model) throw new Error('Choose a model in Settings first.');
  const endpoint = `${settings.endpoint.replace(/\/+$/, '')}/chat/completions`;
  let imageUrl = request.imageDataUrl;
  if (imageUrl?.length && imageUrl.length > 12_000_000) throw new Error('That screen image is too large to send.');
  const automaticCheck = request.question.startsWith('Automatic coding check:');
  const userContent: Array<Record<string, unknown>> = [{ type: 'text', text: request.question }];
  if (imageUrl) userContent.push({ type: 'image_url', image_url: { url: imageUrl, detail: 'low' } });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: automaticCheck ? 160 : 350,
      messages: [
        { role: 'system', content: 'You are Spider-Man, a friendly coding mentor. Reply in the user’s language, including Hindi or Hinglish. Read only legible text in the screenshot. For questions, give a concise practical answer and the smallest useful fix. For automatic checks, report one clearly visible coding error in at most two short sentences, or exactly NO_TIP if none is clear. Never guess, claim to edit files, or repeat secrets visible in screenshots.' },
        { role: 'user', content: userContent }
      ]
    }),
    signal: AbortSignal.timeout(45_000)
  });
  const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `AI service returned HTTP ${response.status}.`);
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return { text: content.trim() };
  if (Array.isArray(content)) return { text: content.map((part) => typeof part === 'string' ? part : (part as { text?: string }).text ?? '').join('').trim() };
  throw new Error('The AI service returned an empty response. Check the selected model and endpoint.');
}

function isDuplicateTip(candidate: string): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}_./:-]+/gu, ' ').trim();
  const current = normalize(candidate);
  const previous = normalize(lastTipText);
  if (!previous) return false;
  if (current === previous) return true;

  // Treat small wording changes to the same diagnostic/fix as the same alert.
  const tokenize = (value: string) => new Set(value.split(' ').filter((word) => word.length > 2));
  const currentWords = tokenize(current);
  const previousWords = tokenize(previous);
  let shared = 0;
  for (const word of currentWords) if (previousWords.has(word)) shared++;
  return shared >= 5 && shared / Math.min(currentWords.size, previousWords.size) >= 0.75;
}

async function monitoringTick() {
  if (!monitoring || snapshotInFlight) return;
  snapshotInFlight = true;
  try {
    const imageDataUrl = await captureSnapshot(settings.displayId);
    if (settings.proactive && monitoring) {
      const result = await ask({ question: 'Automatic coding check: inspect the visible editor, terminal, or test output. Give one concise, concrete correction for the clearest visible coding error; include the exact small code change when readable. Do not repeat the previous issue as a new tip. If no clear coding error is visible, answer exactly NO_TIP.', imageDataUrl });
      const tip = result.text.trim();
      if (tip && tip !== 'NO_TIP' && monitoring && Date.now() - lastTipAt > 30_000 && !isDuplicateTip(tip)) {
        lastTipAt = Date.now();
        lastTipText = tip;
        overlay?.webContents.send('companion:tip', tip);
        publishStatus({ message: tip });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Screen check failed.';
    publishStatus({ message });
  } finally {
    snapshotInFlight = false;
    if (monitoring) scheduleSnapshot(settings.intervalSeconds * 1000);
  }
}

function scheduleSnapshot(delay: number) {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  if (!monitoring) return;
  snapshotTimer = setTimeout(() => void monitoringTick(), delay);
}

async function setMonitoring(enabled: boolean): Promise<CompanionStatus> {
  if (enabled && settings.proactive) {
    let hasKey = false;
    try { hasKey = Boolean(await readApiKey()); } catch { /* no saved key */ }
    if (!settings.model || !hasKey) {
      monitoring = false;
      return publishStatus({ message: 'Set up an API key and vision model in Settings before starting screen watching.' });
    }
  }
  monitoring = enabled;
  if (enabled) {
    const permission = permissionStatus();
    if (permission === 'denied') {
      monitoring = false;
      return publishStatus({ permission, message: 'Screen Recording access is blocked. Open System Settings to enable it.' });
    }
    publishStatus({ permission, message: 'Watching this display. Pause any time from Spider-Man or the tray menu.' });
    scheduleSnapshot(0);
  } else {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
    publishStatus({ message: 'Screen watching is paused.' });
  }
  return status;
}

async function openSystemSettings() {
  if (process.platform === 'darwin') await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  else publishStatus({ message: 'Open Windows Settings → Privacy & security → Screen capture permissions for desktop apps.' });
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:save', (_event, next: AppSettings) => saveSettings(next));
  ipcMain.handle('credential:save', (_event, key: string) => saveApiKey(key));
  ipcMain.handle('credential:has', async () => { try { return Boolean(await readApiKey()); } catch { return false; } });
  ipcMain.handle('display:list', () => listDisplays());
  ipcMain.handle('screen:capture', (_event, displayId: string) => captureSnapshot(displayId));
  ipcMain.handle('ai:ask', (_event, request: ChatRequest) => ask(request));
  ipcMain.handle('status:get', () => status);
  ipcMain.handle('monitoring:set', (_event, enabled: boolean) => setMonitoring(Boolean(enabled)));
  ipcMain.handle('system-settings:open', () => openSystemSettings());
  ipcMain.on('overlay:mode', (event, mode: unknown) => {
    if (event.sender !== overlay?.webContents || !['compact', 'chat', 'settings', 'thought'].includes(String(mode))) return;
    setOverlayMode(mode as 'compact' | 'chat' | 'settings' | 'thought');
  });
  ipcMain.on('overlay:move-arm', (event) => {
    if (event.sender !== overlay?.webContents) return;
    setMoveMode(true);
  });
  ipcMain.on('overlay:move-by', (event, dx: unknown, dy: unknown) => {
    if (event.sender !== overlay?.webContents || !moveMode || typeof dx !== 'number' || typeof dy !== 'number') return;
    moveOverlayBy(dx, dy);
  });
  ipcMain.on('overlay:move-finished', (event) => {
    if (event.sender !== overlay?.webContents) return;
    if (moveMode) setMoveMode(false);
    saveOverlayPosition();
  });
  ipcMain.on('app:quit', () => app.quit());
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  await mkdir(userData, { recursive: true });
  settingsPath = path.join(userData, 'settings.json');
  overlayPositionPath = path.join(userData, 'overlay-position.json');
  credentialPath = path.join(userData, 'api-key.enc');
  await loadSettings();
  await loadOverlayPosition();
  createOverlay();
  if (overlayPositionNeedsMigration) saveOverlayPosition();
  registerIpc();
  const shortcutRegistered = registerShortcut(settings.shortcut);
  const launchMessage = configureLoginItem();
  publishStatus({ message: [launchMessage, !shortcutRegistered ? `Shortcut unavailable: ${settings.shortcut}. Choose another shortcut in Settings.` : ''].filter(Boolean).join(' ') });
  const icon = nativeImage.createFromPath(path.join(__dirname, '../renderer/assets/spider-man-cutout.png')).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  updateTrayMenu();
  tray.on('click', showChatFromShortcut);
  screen.on('display-removed', () => { void listDisplays().then((displays) => { if (!displays.some((display) => display.id === settings.displayId)) void saveSettings({ ...settings, displayId: displays.find((display) => display.primary)?.id ?? '' }); }); });
});

app.on('activate', () => overlay?.show());
app.on('before-quit', saveOverlayPosition);
app.on('will-quit', () => {
  saveOverlayPosition();
  globalShortcut.unregisterAll();
  if (snapshotTimer) clearTimeout(snapshotTimer);
  if (moveModeTimer) clearTimeout(moveModeTimer);
});
app.on('window-all-closed', () => undefined);
