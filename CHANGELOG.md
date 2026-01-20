# Changelog

All notable changes to Pulsar Desktop will be documented in this file.

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
