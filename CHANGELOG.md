# Changelog

All notable changes to Pulsar Desktop will be documented in this file.

## [Planned] - Future

### Social Profiles Management (v1.3.0+)
- **Multi-Account Support** - 用戶可管理多個社群帳號
  - Profile 管理 UI（新增/移除帳號）
  - 帳號驗證流程（登入並綁定）
  - 帳號選擇器（發文時選擇 Profile）
  - 獨立 browser session 儲存
- **帳號配額限制** - 根據 tier 限制帳號數
  - Free: 1 帳號, Starter: 3, Pro: 5, Agency: 10
  - 超過配額顯示升級提示
- **Profile Types**
  - Personal Account (X/LinkedIn 個人帳號)
  - Company Page (LinkedIn Company Page)
  - Delegate Account (代理發文)

---

## [1.2.0] - 2026-01-20

### Added
- **LinkedIn Integration** - 完整支援 LinkedIn 發文
  - 即時發文功能 (postToLinkedIn)
  - 排程發文支援
  - 登入狀態偵測（8 個 fallback selectors）
  - 字數上限 3000 字元
- **LinkedIn Company Page Support** - 支援公司頁面發文
  - `postToLinkedInCompany(content, companySlug)` API
  - 導航到 `/company/{slug}/` 後發文
  - Company-specific selector 偵測
  - Company Settings 儲存功能
- **Platform-Specific Tracked Accounts** - 平台分離的追蹤帳號
  - `tracked-accounts-twitter.md` - Twitter/X 專用追蹤清單
  - `tracked-accounts-linkedin.md` - LinkedIn 專用追蹤清單
  - 自動遷移舊的單一檔案到 Twitter
  - 各平台獨立的 AI 分類與 cache
  - 新增 API: `getAllPlatformAccounts()`, `getTrackedAccountsPlatforms()`

### Fixed
- **LinkedIn Post Modal Detection** - 修復「找不到 editor」錯誤
  - 點擊 share-box 內部互動元素而非容器
  - Modal 開啟驗證 + MouseEvent fallback
  - Quill editor 多重 selector 偵測

### Changed
- `tracked-accounts-manager.js` - 重構為平台分離架構
- `preload.js` - 所有 tracked accounts API 加入 platform 參數
- `src/main.js` - 新增 LinkedIn posting + Company Page + scheduler 支援

## [1.1.0] - 2026-01-20

### Added
- **Smart Engagement Automation** - 自動回覆系統
  - Topic Search 模式：搜尋關鍵字並自動回覆相關貼文
  - Tracked Accounts 模式：追蹤特定帳號並回覆其貼文
  - AI 生成回覆內容（支援 Persona 設定）
  - 回覆歷史追蹤，避免重複回覆
- **Loop Protection** - 迴圈保護機制
  - `maxAttempts` 限制最大嘗試次數
  - `consecutiveFailures` 連續失敗自動停止
  - 詳細日誌追蹤執行進度

### Fixed
- **QuotaManager UUID 錯誤** - Clerk ID 與 Supabase UUID 格式不符
  - 新增 `dbUserId` 儲存真正的 Supabase UUID
  - 所有 quota/tracked-accounts API 改用 `dbUserId`
- **Token 持久化問題** - Clerk JWT 60 秒過期導致每次重啟需重新登入
  - Token 過期時只清除 accessToken，保留 user/dbUserId
  - `isAuthenticated()` 改為檢查 user + dbUserId
- **Pro 用戶 UI 顯示** - AI Provider 區域錯誤顯示 Upgrade 提示
  - 當 tier 為 pro/agency 時自動清除升級提示
  - 登入後自動更新 AI Provider UI

### Changed
- `supabase-client.js` - 重構認證流程，分離 Clerk ID 與 Supabase UUID
- `quota-manager.js` - 改善錯誤處理，使用快取作為 fallback
- `automation-manager.js` - 支援 `searchTopics` 和 `maxRepliesPerTopic` 參數

## [1.0.0] - 2026-01-15

### Added
- Initial release
- Twitter/X 自動發文
- 排程發文系統
- AI 內容生成（WebLLM / BYOK / CLIProxy）
- Persona 系統
- Tracked Accounts 管理
- Supabase 後端整合
- Clerk 認證整合
- 4-tier 訂閱系統（Free / Starter / Pro / Agency）
