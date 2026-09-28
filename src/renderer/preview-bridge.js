// Browser preview shim. Electron provides the real, privileged API through preload.js.
if (!window.companion) {
  const previewMessage = 'Screen capture is unavailable in the Chrome preview. Use the installed desktop app for live watching.';
  const listeners = new Set();
  const defaults = {
    provider: 'xkiro',
    endpoint: 'https://api.xkiro.com/v1',
    model: '',
    intervalSeconds: 5,
    displayId: 'chrome-preview',
    shortcut: 'CommandOrControl+Shift+Space',
    proactive: true,
    launchAtLogin: true
  };
  let status = { monitoring: false, permission: 'unsupported', message: 'Chrome preview — UI only.' };
  let settings = { ...defaults };
  let mascotOffsetX = 0;
  let mascotOffsetY = 0;

  window.companion = {
    isPreview: true,
    async getSettings() { return { ...settings }; },
    async saveSettings(next) { settings = { ...settings, ...next }; return { ...settings }; },
    async saveApiKey() { throw new Error('API keys are not accepted or saved in the Chrome preview. Use the installed desktop app.'); },
    async hasApiKey() { return false; },
    async listDisplays() {
      return [{ id: 'chrome-preview', label: 'Chrome preview window', width: window.innerWidth, height: window.innerHeight, primary: true }];
    },
    async captureSnapshot() { return ''; },
    async ask() {
      return { text: 'This is a UI preview only. It does not capture your screen or contact an AI service. Use the installed desktop app for live help.' };
    },
    async getStatus() { return { ...status }; },
    async setMonitoring(enabled) {
      status = {
        ...status,
        monitoring: Boolean(enabled),
        message: enabled
          ? 'Preview only: the browser cannot capture your screen or send it to an AI service.'
          : 'Preview paused. Live screen watching is available in the installed desktop app.'
      };
      for (const listener of listeners) listener({ ...status });
      return { ...status };
    },
    async openSystemSettings() {
      status = { ...status, message: 'Screen permissions are managed by the installed desktop app.' };
      for (const listener of listeners) listener({ ...status });
    },
    onStatus(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    onHotkey(callback) {
      const handler = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Space') {
          event.preventDefault();
          callback();
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    },
    onTip() { return () => undefined; },
    onMoveMode(callback) { callback(false); return () => undefined; },
    setOverlayMode() {},
    armOverlayMove() {},
    finishOverlayMove() {},
    moveOverlayBy(dx, dy) {
      const mascot = document.getElementById('mascot');
      const root = document.getElementById('app');
      if (!mascot || !root || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const baseX = root.clientWidth - mascot.offsetWidth;
      const maxX = Math.max(0, root.clientWidth - mascot.offsetWidth);
      const maxY = Math.max(0, root.clientHeight - mascot.offsetHeight);
      const x = Math.min(maxX, Math.max(0, baseX + mascotOffsetX + dx));
      mascotOffsetY = Math.min(maxY, Math.max(0, mascotOffsetY + dy));
      mascotOffsetX = x - baseX;
      mascot.style.translate = String(mascotOffsetX) + 'px ' + String(mascotOffsetY) + 'px';
    },
    quit() {}
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.title = 'Spider-Man Companion · Chrome Preview';
    const workspace = document.createElement('section');
    workspace.className = 'preview-desktop';
    workspace.setAttribute('aria-label', 'Sample coding workspace preview');
    workspace.innerHTML = `
      <header class="preview-titlebar">
        <div class="preview-window-dots"><i></i><i></i><i></i></div>
        <span class="preview-title">neighborhood-app <b>—</b> Visual Studio Code</span>
        <span class="preview-title-action">● &nbsp; Local workspace</span>
      </header>
      <div class="preview-workarea">
        <nav class="preview-activity"><b>▦</b><span>⌕</span><span>⑂</span><span>◉</span><span>⚙</span></nav>
        <aside class="preview-explorer">
          <div class="preview-explorer-title">EXPLORER</div>
          <div class="preview-project">⌄ &nbsp; NEIGHBORHOOD-APP</div>
          <div class="preview-file active">◈ &nbsp; App.tsx</div>
          <div class="preview-file">◇ &nbsp; index.ts</div>
          <div class="preview-file">▣ &nbsp; package.json</div>
          <div class="preview-file">▤ &nbsp; README.md</div>
          <div class="preview-side-note"><span>OPEN EDITORS</span><br><br>App.tsx</div>
        </aside>
        <main class="preview-editor">
          <div class="preview-tab">◈ &nbsp; App.tsx <span>×</span></div>
          <div class="preview-breadcrumb">src &nbsp;›&nbsp; components &nbsp;›&nbsp; App.tsx</div>
          <div class="preview-code">
            <div><i>1</i><code><span class="code-purple">import</span> { useState } <span class="code-purple">from</span> <span class="code-green">'react'</span>;</code></div>
            <div><i>2</i><code></code></div>
            <div><i>3</i><code><span class="code-purple">type</span> <span class="code-blue">Task</span> = { id: <span class="code-orange">number</span>; title: <span class="code-orange">string</span> };</code></div>
            <div><i>4</i><code></code></div>
            <div><i>5</i><code><span class="code-purple">export default function</span> <span class="code-yellow">App</span>() {</code></div>
            <div><i>6</i><code>&nbsp;&nbsp;<span class="code-purple">const</span> [tasks, setTasks] = <span class="code-yellow">useState</span>&lt;<span class="code-blue">Task</span>[]&gt;([]);</code></div>
            <div><i>7</i><code>&nbsp;&nbsp;<span class="code-purple">const</span> completed = tasks.<span class="code-yellow">filter</span>(task =&gt; task.done);</code></div>
            <div class="preview-error-line"><i>8</i><code>&nbsp;&nbsp;<span class="code-purple">return</span> &lt;<span class="code-blue">TaskList</span> tasks={tasks} /&gt;;</code><b>1</b></div>
            <div><i>9</i><code>}</code></div>
          </div>
          <section class="preview-terminal">
            <div class="preview-terminal-tabs"><b>PROBLEMS <em>1</em></b><span>OUTPUT</span><span>DEBUG CONSOLE</span><span>TERMINAL</span></div>
            <div class="preview-problem"><strong>TS2339</strong> &nbsp; Property <code>'done'</code> does not exist on type <code>Task</code>.</div>
            <div class="preview-problem-path">src/components/App.tsx &nbsp;·&nbsp; line 7</div>
          </section>
          <footer class="preview-statusbar"><span>⎇ main*</span><span>TypeScript React</span><span>Ln 7, Col 43 &nbsp; UTF-8</span></footer>
        </main>
      </div>`;
    document.getElementById('app')?.prepend(workspace);
    const keyStatus = document.getElementById('key-status');
    if (keyStatus) keyStatus.textContent = 'Preview only. API keys are not accepted or stored in Chrome.';
    const privacy = document.querySelector('.privacy-note');
    if (privacy) privacy.textContent = 'Preview only — no screenshots are captured and no data is sent to an AI service.';
    const banner = document.createElement('div');
    banner.className = 'preview-banner';
    banner.textContent = 'Chrome preview: Start watching demonstrates the UI only. For live screen help, use the installed desktop app.';
    document.getElementById('app')?.append(banner);
  });
}
