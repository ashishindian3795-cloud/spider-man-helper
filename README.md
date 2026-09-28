# Spider-Man Desktop Companion

A small, always-on-top Spider-Man helper for Windows and macOS. It can answer questions about a selected display and offer occasional tips while monitoring is enabled.

## Run it

Requires Node.js 22 or newer.

```sh
npm install
npm run start
```

To view the interface in Chrome without launching Electron, run `npm run build`, then open `.build/renderer/index.html`. This browser preview is UI-only: it never captures the screen, accepts API keys, or contacts an AI service.

Build a distributable for the current operating system with `npm run package`. Build a macOS app on macOS and a Windows installer on Windows. The project is configured for Windows x64 installers and macOS DMG/ZIP packages.

## Install the Windows app

Run `release/Spider-Man Companion Setup 0.2.2.exe` and finish the setup wizard. The installer creates Start menu and desktop shortcuts and launches Spider-Man Companion when setup finishes. On first launch, Settings opens automatically because live coding help needs your own AI key before the app can send screen images or answer questions. Choose xKiro or a compatible provider, enter your key in Settings, save, then click **Start watching**. Keep the key in Settings; do not paste it into chat.

If you want to launch from this project folder instead, double-click `START-SPIDER-MAN.bat`. It builds and opens the desktop app; Node.js 22 or newer is required.

## First-time setup

1. Open Settings from Spider-Man’s floating panel.
2. Choose xKiro or a custom OpenAI-compatible API endpoint. The xKiro model defaults to `qwen/qwen3-coder-plus:free`, a free-tier vision model. For a custom endpoint, enter its base URL (for example, `https://api.example.com/v1`), a vision-capable model ID, and your API key.
3. Save your settings, choose the display and snapshot interval, then start watching.
4. On macOS, allow Screen Recording when the operating system prompts you. If permission was denied, enable it in System Settings and restart the app.

The default hotkey is `CommandOrControl+Shift+Space`. It opens the chat panel; customize it in Settings.

Spider-Man is set to launch when you sign in to Windows or macOS. You can turn this off in Settings. Screen watching always starts paused after sign-in; press **Start watching** when you want it to inspect your display. On macOS, allow Spider-Man Companion in **System Settings → General → Login Items** if macOS asks for approval. A packaged, signed app is needed for reliable automatic launch on macOS.

## Screen and API data

Screen watching is off until you turn it on. When proactive coding help is enabled, the app captures the selected display at the configured interval (5 seconds by default) and sends each snapshot to the chosen AI service. It looks for clearly visible editor, compiler, test, and terminal errors, then suggests a small correction; it suppresses repeated versions of the same tip. It does not modify your code or save screenshots locally. Asking a question while watching is enabled sends a fresh screenshot with that question; with watching paused, questions are text-only. API calls may incur charges from your provider.

The API key is encrypted using Electron `safeStorage`, backed by the operating system’s secure storage where available. Settings remember the selected provider, endpoint, and model; the full saved key stays hidden. The app sends requests directly to the configured endpoint and does not use a shared application server or API key. Chat messages and proactive tips are kept in the app window’s memory for the current session.

## Project commands

- `npm run build` compiles TypeScript and copies the interface and avatar into `.build/`.
- `npm run start` builds and launches the app.
- `npm run package` builds a platform installer/package into `release/`.
