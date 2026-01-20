# Social Profiles Management Spec (v1.3.0)

## 商業邏輯

### 帳號配額
| Tier | 帳號數 | 月費 | 說明 |
|------|--------|------|------|
| Free | 1 | $0 | 1 個平台的 1 個帳號 |
| Starter | 3 | $14.99 | 可跨平台（如 1 X + 2 LinkedIn） |
| Pro | 5 | $49 | 包含 Company Page 支援 |
| Agency | 10 | $99 | 多客戶管理 |

### 帳號類型
1. **Personal Account** - 個人 X/LinkedIn 帳號
2. **Company Page** - LinkedIn Company Page（需 Pro+）
3. **Delegate Account** - 代理發文（用個人帳號切換到公司帳號）

### 付費邏輯
- 基本付費 = 每平台各 1 個帳號的「額度」
- 新增帳號消耗額度
- 額度滿 → 顯示升級提示
- Company Page 需要 Pro 以上才能新增

---

## 資料庫設計

### `social_profiles` 表
```sql
CREATE TABLE social_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),

  -- 帳號資訊
  platform TEXT NOT NULL,           -- 'twitter' | 'linkedin'
  profile_type TEXT NOT NULL,       -- 'personal' | 'company_page' | 'delegate'
  account_identifier TEXT NOT NULL, -- @username 或 company slug
  display_name TEXT,                -- 顯示名稱
  avatar_url TEXT,

  -- Session 管理
  session_path TEXT,                -- 獨立 browser profile 路徑
  is_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,

  -- 狀態
  is_active BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false, -- 該平台的預設帳號

  -- 時間戳
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, platform, account_identifier)
);

-- RLS Policy
ALTER TABLE social_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own profiles" ON social_profiles
  FOR ALL USING (auth.uid() = user_id);
```

### 本地快取 (Electron)
```javascript
// ~/Library/Application Support/pulsar-desktop/social-profiles.json
{
  "profiles": [
    {
      "id": "uuid",
      "platform": "twitter",
      "profileType": "personal",
      "accountIdentifier": "@lmanchu",
      "displayName": "Lman",
      "sessionPath": "sessions/twitter-lmanchu",
      "isVerified": true,
      "isPrimary": true
    },
    {
      "id": "uuid",
      "platform": "linkedin",
      "profileType": "company_page",
      "accountIdentifier": "irixion",
      "displayName": "IrisGo",
      "sessionPath": "sessions/linkedin-irixion",
      "isVerified": true,
      "isPrimary": false
    }
  ],
  "lastSynced": "2026-01-20T12:00:00Z"
}
```

---

## UI 設計

### 1. Settings > Social Profiles Tab

```
┌─────────────────────────────────────────────────┐
│ Social Profiles                    2/5 帳號已使用 │
├─────────────────────────────────────────────────┤
│                                                 │
│ Twitter/X                                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🐦 @lmanchu              ⭐ Primary  ✅ Active │ │
│ │    Lman                           [Remove]  │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ LinkedIn                                        │
│ ┌─────────────────────────────────────────────┐ │
│ │ 👤 Yichen Chu            ⭐ Primary  ✅ Active │ │
│ │    Personal Account               [Remove]  │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🏢 IrisGo                          ✅ Active │ │
│ │    Company Page                   [Remove]  │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [+ Add Account]                                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 2. Add Account Flow

```
Step 1: 選擇平台
┌─────────────────────────────────┐
│ Add New Account                 │
├─────────────────────────────────┤
│                                 │
│  [🐦 Twitter/X]  [💼 LinkedIn]  │
│                                 │
└─────────────────────────────────┘

Step 2: 選擇類型 (LinkedIn only)
┌─────────────────────────────────┐
│ Account Type                    │
├─────────────────────────────────┤
│                                 │
│  ○ Personal Account             │
│  ○ Company Page    🔒 Pro+      │
│                                 │
│  [Continue]                     │
└─────────────────────────────────┘

Step 3: 登入驗證
┌─────────────────────────────────┐
│ Connect Your Account            │
├─────────────────────────────────┤
│                                 │
│  A browser window will open.    │
│  Please log in to your account. │
│                                 │
│  [Open Login Window]            │
│                                 │
└─────────────────────────────────┘

Step 4: 確認 (Company Page)
┌─────────────────────────────────┐
│ Select Company Page             │
├─────────────────────────────────┤
│                                 │
│  Enter your Company Page slug:  │
│  linkedin.com/company/[_______] │
│                                 │
│  [Verify & Add]                 │
│                                 │
└─────────────────────────────────┘
```

### 3. 付費牆 (Quota Exceeded)

```
┌─────────────────────────────────┐
│ Account Limit Reached           │
├─────────────────────────────────┤
│                                 │
│  You've used all 1 account      │
│  slots in your Free plan.       │
│                                 │
│  Upgrade to add more accounts:  │
│                                 │
│  Starter ($14.99/mo) → 3 帳號   │
│  Pro ($49/mo) → 5 帳號          │
│  Agency ($99/mo) → 10 帳號      │
│                                 │
│  [Upgrade Now]  [Maybe Later]   │
│                                 │
└─────────────────────────────────┘
```

### 4. 發文選擇器 (Compose Area)

```
┌─────────────────────────────────────────────────┐
│ Post to: [▼ @lmanchu (Twitter)               ]  │
│          ├─ 🐦 @lmanchu (Twitter)               │
│          ├─ 👤 Yichen Chu (LinkedIn)            │
│          └─ 🏢 IrisGo (LinkedIn Company)        │
├─────────────────────────────────────────────────┤
│                                                 │
│ [Write your post here...]                       │
│                                                 │
├─────────────────────────────────────────────────┤
│ [Post Now]  [Schedule]                          │
└─────────────────────────────────────────────────┘
```

---

## API 設計

### Preload API
```javascript
// Profile Management
getProfiles: () => ipcRenderer.invoke('profiles:getAll'),
addProfile: (platform, profileType) => ipcRenderer.invoke('profiles:add', { platform, profileType }),
removeProfile: (profileId) => ipcRenderer.invoke('profiles:remove', profileId),
verifyProfile: (profileId) => ipcRenderer.invoke('profiles:verify', profileId),
setPrimaryProfile: (profileId) => ipcRenderer.invoke('profiles:setPrimary', profileId),

// Quota Check
canAddProfile: () => ipcRenderer.invoke('profiles:canAdd'),
getProfileQuota: () => ipcRenderer.invoke('profiles:getQuota'),

// Post with Profile
postWithProfile: (profileId, content) => ipcRenderer.invoke('post:withProfile', { profileId, content }),
scheduleWithProfile: (profileId, content, scheduledAt) =>
  ipcRenderer.invoke('schedule:withProfile', { profileId, content, scheduledAt }),
```

### IPC Handlers
```javascript
// profiles:add
1. 檢查配額 (canAddProfile)
2. 如果是 Company Page，檢查是否 Pro+
3. 建立獨立 session 資料夾
4. 開啟登入視窗
5. 驗證成功後儲存到資料庫
6. 同步到本地快取

// profiles:verify
1. 載入該 profile 的 session
2. 導航到平台首頁
3. 檢查登入狀態
4. 更新 verified 狀態

// post:withProfile
1. 載入指定 profile 的 session
2. 根據 platform 和 profileType 執行對應的發文邏輯
3. 記錄發文歷史
```

---

## Session 管理

### 獨立 Browser Profile
```
~/Library/Application Support/pulsar-desktop/
├── sessions/
│   ├── twitter-lmanchu/
│   │   ├── Cookies
│   │   ├── Local Storage/
│   │   └── ...
│   ├── linkedin-personal/
│   │   └── ...
│   └── linkedin-irixion/
│       └── ...
└── social-profiles.json
```

### Session 切換邏輯
```javascript
async loadProfileSession(profileId) {
  const profile = await this.getProfile(profileId);
  const partition = `persist:${profile.platform}-${profile.accountIdentifier}`;

  // BrowserView 使用獨立 partition
  this.browserView.webContents.session = session.fromPartition(partition);
}
```

---

## 實作順序

### Phase 1: 資料層
- [ ] 建立 `social_profiles` Supabase 表
- [ ] 建立 `social-profiles-manager.js`
- [ ] 本地快取同步機制
- [ ] Session partition 管理

### Phase 2: Profile 管理
- [ ] `profiles:getAll` / `profiles:add` / `profiles:remove`
- [ ] 配額檢查邏輯
- [ ] 登入驗證視窗

### Phase 3: UI
- [ ] Settings > Social Profiles Tab
- [ ] Add Account Flow
- [ ] 付費牆 Modal
- [ ] 發文選擇器

### Phase 4: 發文整合
- [ ] `postWithProfile` 整合現有發文邏輯
- [ ] `scheduleWithProfile` 整合排程
- [ ] 遷移現有 `postToTwitter` / `postToLinkedIn` API

---

## 遷移計畫

現有用戶升級到 v1.3.0 時：
1. 自動建立 1 個 Personal Profile（使用現有 session）
2. 如果有 Company Settings → 自動建立 Company Page Profile
3. 顯示「新功能介紹」Modal
