# Pulsar Desktop

AI-powered social media automation desktop app built with Electron.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Pulsar Desktop                      │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │ Control Panel│  │      BrowserView            │  │
│  │  (Renderer)  │  │  (Social Media Sites)       │  │
│  │              │  │                             │  │
│  │ • 平台切換    │  │  Twitter / LinkedIn /       │  │
│  │ • 發文輸入    │  │  Threads / Instagram        │  │
│  │ • 日誌顯示    │  │                             │  │
│  └──────────────┘  └─────────────────────────────┘  │
│                          ↑                          │
│                    executeJavaScript                │
│                    (自動化操作)                      │
└─────────────────────────────────────────────────────┘
```

## Features

- **Embedded Browser**: 內建 Chromium，用戶直接在 app 中登入社群平台
- **Session Persistence**: 登入狀態自動保存，不需每次重新登入
- **Direct Automation**: 透過 Chrome DevTools Protocol 直接操作頁面
- **Multi-Platform**: 支援 Twitter, LinkedIn, Threads, Instagram

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build:mac  # macOS
npm run build:win  # Windows
npm run build:linux  # Linux
```

## Usage

1. 啟動 app 後，右側會顯示 Twitter
2. 如果尚未登入，在右側瀏覽器中登入你的帳號
3. 登入後，左側面板會顯示「已登入」
4. 在文字框輸入要發布的內容
5. 點擊「發布到 Twitter」按鈕

## Tech Stack

- **Electron**: Desktop app framework
- **BrowserView**: Embedded browser for social media
- **Chrome DevTools Protocol**: Page automation
- **puppeteer-core**: CDP utilities (optional)

## Project Structure

```
pulsar-desktop/
├── package.json
├── src/
│   ├── main.js          # Electron main process
│   ├── preload.js       # IPC bridge
│   └── renderer/
│       └── index.html   # Control panel UI
└── assets/              # App icons
```

## Extending

To add a new platform:

1. Add platform button in `index.html`
2. Add URL to `platforms` object
3. Add automation handler in `main.js` via `ipcMain.handle()`
4. Add renderer call in `preload.js`

## Security Notes

- Session data stored in app's userData directory
- No credentials sent to external servers
- All automation runs locally
