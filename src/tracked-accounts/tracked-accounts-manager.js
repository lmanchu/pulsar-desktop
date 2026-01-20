/**
 * Tracked Accounts Manager for Pulsar Desktop
 * Markdown-based config with AI auto-classification via WebLLM
 */

const { ipcMain, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');

class TrackedAccountsManager {
  constructor() {
    this.mdPath = path.join(app.getPath('userData'), 'tracked-accounts.md');
    this.cachePath = path.join(app.getPath('userData'), 'tracked-accounts-cache.json');
    this.accountsCache = null;
    this.cacheTime = null;
    this.CACHE_TTL = 60000; // 1 minute
    this.aiProvider = null; // Will be set after AIProvider is initialized
    this.ensureConfigExists();
  }

  // Set AI provider reference (called from main.js after AIProvider init)
  setAIProvider(provider) {
    this.aiProvider = provider;
  }

  // Create default markdown config if doesn't exist
  ensureConfigExists() {
    if (!fs.existsSync(this.mdPath)) {
      fs.writeFileSync(this.mdPath, this.getDefaultMarkdown());
      console.log('[TrackedAccounts] Created default config at:', this.mdPath);
    }
    // Also ensure cache exists
    if (!fs.existsSync(this.cachePath)) {
      fs.writeFileSync(this.cachePath, JSON.stringify({ accounts: this.getDefaultAccounts() }, null, 2));
    }
  }

  // Default markdown content (multilingual)
  getDefaultMarkdown() {
    return `# Tracked Accounts

Add Twitter/X usernames below, one per line.
AI will automatically classify tier and category.

在下方新增 Twitter/X 用戶名，一行一個。
AI 會自動分類層級與類別。

---

sama
elonmusk
karpathy
ylecun
AnthropicAI
OpenAI
garrytan
paulg
naval
dhh
levelsio
guillermo_rauch
t3dotgg
swyx
dan_abramov
`;
  }

  // Default accounts with pre-classified data
  getDefaultAccounts() {
    return [
      { username: "sama", display_name: "Sam Altman", tier: 1, category: "tech_titan", enabled: true },
      { username: "elonmusk", display_name: "Elon Musk", tier: 1, category: "tech_titan", enabled: true },
      { username: "karpathy", display_name: "Andrej Karpathy", tier: 2, category: "ai_leader", enabled: true },
      { username: "ylecun", display_name: "Yann LeCun", tier: 2, category: "ai_leader", enabled: true },
      { username: "AnthropicAI", display_name: "Anthropic", tier: 2, category: "ai_company", enabled: true },
      { username: "OpenAI", display_name: "OpenAI", tier: 2, category: "ai_company", enabled: true },
      { username: "garrytan", display_name: "Garry Tan", tier: 3, category: "vc", enabled: true },
      { username: "paulg", display_name: "Paul Graham", tier: 3, category: "vc", enabled: true },
      { username: "naval", display_name: "Naval Ravikant", tier: 3, category: "vc", enabled: true },
      { username: "dhh", display_name: "DHH", tier: 4, category: "founder", enabled: true },
      { username: "levelsio", display_name: "Pieter Levels", tier: 4, category: "founder", enabled: true },
      { username: "guillermo_rauch", display_name: "Guillermo Rauch", tier: 4, category: "founder", enabled: true },
      { username: "t3dotgg", display_name: "Theo", tier: 5, category: "devtools", enabled: true },
      { username: "swyx", display_name: "Shawn Wang", tier: 6, category: "influencer", enabled: true },
      { username: "dan_abramov", display_name: "Dan Abramov", tier: 6, category: "influencer", enabled: true }
    ];
  }

  // Parse markdown file to extract usernames
  parseMarkdown() {
    try {
      const content = fs.readFileSync(this.mdPath, 'utf8');
      const lines = content.split('\n');
      const usernames = [];

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines, headers, comments, and separator
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---') ||
            trimmed.includes('Add Twitter') || trimmed.includes('AI will') ||
            trimmed.includes('在下方') || trimmed.includes('會自動')) {
          continue;
        }
        // Clean username (remove @ if present)
        const username = trimmed.replace(/^@/, '');
        if (username && /^[a-zA-Z0-9_]+$/.test(username)) {
          usernames.push(username);
        }
      }

      return usernames;
    } catch (error) {
      console.error('[TrackedAccounts] Failed to parse markdown:', error.message);
      return [];
    }
  }

  // Load cached account data
  loadCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        return data.accounts || [];
      }
    } catch (error) {
      console.error('[TrackedAccounts] Failed to load cache:', error.message);
    }
    return this.getDefaultAccounts();
  }

  // Save cache
  saveCache(accounts) {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({ accounts }, null, 2));
    } catch (error) {
      console.error('[TrackedAccounts] Failed to save cache:', error.message);
    }
  }

  // Classify new accounts using AI
  async classifyAccounts(usernames) {
    if (!usernames.length) {
      return [];
    }

    const prompt = `Classify these Twitter/X accounts into tiers and categories.

Tier definitions:
1 = Tech Titans (Elon Musk, Sam Altman level)
2 = AI Leaders & Companies (researchers, AI companies)
3 = VCs & Investors
4 = Founders & Entrepreneurs
5 = DevTools & Technical
6 = Influencers & Content Creators

Category options: tech_titan, ai_leader, ai_company, vc, founder, devtools, influencer, custom

Accounts to classify:
${usernames.join('\n')}

Return ONLY a JSON array, no explanation:
[{"username":"xxx","display_name":"Full Name","tier":4,"category":"founder"}]`;

    // Try main provider first
    if (this.aiProvider) {
      try {
        const result = await this.aiProvider.generate(prompt, { maxTokens: 1000 });
        if (result.success && result.text) {
          const jsonMatch = result.text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const classified = JSON.parse(jsonMatch[0]);
            console.log('[TrackedAccounts] AI classification successful');
            return classified.map(acc => ({
              username: acc.username,
              display_name: acc.display_name || acc.username,
              tier: acc.tier || 4,
              category: acc.category || 'custom',
              enabled: true
            }));
          }
        }
      } catch (error) {
        console.log('[TrackedAccounts] Main provider failed:', error.message);
      }
    }

    // Fallback: try CLIProxy directly (for Pro users)
    try {
      const fullConfig = this.aiProvider?.getConfig?.() || {};
      const config = fullConfig.cliproxy;
      console.log('[TrackedAccounts] CLIProxy config:', config?.endpoint ? 'found' : 'not found');
      if (config?.endpoint && config?.apiKey) {
        console.log('[TrackedAccounts] Trying CLIProxy fallback...');
        const response = await fetch(`${config.endpoint}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model || 'gemini-2.0-flash',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000
          })
        });

        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content || '';
          console.log('[TrackedAccounts] CLIProxy response:', text.substring(0, 200));
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const classified = JSON.parse(jsonMatch[0]);
            console.log('[TrackedAccounts] CLIProxy classification successful');
            return classified.map(acc => ({
              username: acc.username,
              display_name: acc.display_name || acc.username,
              tier: acc.tier || 4,
              category: acc.category || 'custom',
              enabled: true
            }));
          }
        } else {
          const errorText = await response.text();
          console.error('[TrackedAccounts] CLIProxy error:', response.status, errorText.substring(0, 200));
        }
      }
    } catch (error) {
      console.error('[TrackedAccounts] CLIProxy fallback failed:', error.message);
    }

    // Final fallback: return with default classification
    console.log('[TrackedAccounts] Using default classification');
    return usernames.map(username => ({
      username,
      display_name: username,
      tier: 4,
      category: 'custom',
      enabled: true
    }));
  }

  // Sync markdown with cache, classify new accounts
  async syncAccounts() {
    const mdUsernames = this.parseMarkdown();
    const cachedAccounts = this.loadCache();

    // Build lookup map from cache
    const cacheMap = new Map();
    cachedAccounts.forEach(acc => {
      if (acc?.username) {
        cacheMap.set(acc.username.toLowerCase(), acc);
      }
    });

    // Find new usernames not in cache
    const newUsernames = mdUsernames.filter(u => !cacheMap.has(u.toLowerCase()));

    // Classify new accounts if any
    let newAccounts = [];
    if (newUsernames.length > 0) {
      console.log('[TrackedAccounts] Classifying new accounts:', newUsernames);
      newAccounts = await this.classifyAccounts(newUsernames);
    }

    // Build final account list based on markdown order
    const finalAccounts = [];
    for (const username of mdUsernames) {
      const cached = cacheMap.get(username.toLowerCase());
      if (cached) {
        finalAccounts.push(cached);
      } else {
        const newAcc = newAccounts.find(a => a.username.toLowerCase() === username.toLowerCase());
        if (newAcc) {
          finalAccounts.push(newAcc);
        }
      }
    }

    // Save updated cache
    this.saveCache(finalAccounts);
    this.accountsCache = null; // Invalidate memory cache

    return {
      total: finalAccounts.length,
      new: newUsernames.length,
      classified: newAccounts.length
    };
  }

  // Get all tracked accounts
  async getAccounts(forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh && this.accountsCache && this.cacheTime &&
        (now - this.cacheTime) < this.CACHE_TTL) {
      return this.accountsCache;
    }

    // Sync markdown with cache
    await this.syncAccounts();

    const accounts = this.loadCache();

    // Add IDs if missing
    accounts.forEach((a, i) => {
      if (!a.id) a.id = `local-${i}`;
      if (a.enabled === undefined) a.enabled = true;
    });

    // Group by tier for easy access
    const grouped = {
      all: accounts,
      byTier: {},
      byCategory: {},
      defaults: accounts.filter(a => a.tier <= 3),
      custom: accounts.filter(a => a.tier > 3)
    };

    for (let i = 1; i <= 6; i++) {
      grouped.byTier[i] = accounts.filter(a => a.tier === i);
    }

    accounts.forEach(account => {
      if (account.category) {
        if (!grouped.byCategory[account.category]) {
          grouped.byCategory[account.category] = [];
        }
        grouped.byCategory[account.category].push(account);
      }
    });

    this.accountsCache = grouped;
    this.cacheTime = now;

    return grouped;
  }

  // Get only enabled accounts
  async getEnabledAccounts() {
    const accounts = await this.getAccounts();
    return accounts.all.filter(a => a.enabled !== false);
  }

  // Get accounts by tier
  async getAccountsByTier(tier) {
    const accounts = await this.getAccounts();
    return accounts.byTier[tier] || [];
  }

  // Get accounts by category
  async getAccountsByCategory(category) {
    const accounts = await this.getAccounts();
    return accounts.byCategory[category] || [];
  }

  // Search accounts
  async searchAccounts(query) {
    const accounts = await this.getAccounts();
    const lowerQuery = query.toLowerCase();

    return accounts.all.filter(account =>
      account.username.toLowerCase().includes(lowerQuery) ||
      (account.display_name && account.display_name.toLowerCase().includes(lowerQuery))
    );
  }

  // Get stats
  async getStats() {
    const accounts = await this.getAccounts();

    return {
      total: accounts.all.length,
      defaults: accounts.defaults.length,
      custom: accounts.custom.length,
      enabled: accounts.all.filter(a => a.enabled !== false).length,
      byTier: Object.fromEntries(
        Object.entries(accounts.byTier).map(([tier, accs]) => [tier, accs.length])
      ),
      categories: Object.keys(accounts.byCategory)
    };
  }

  // Get random accounts for engagement (weighted by tier)
  async getRandomAccountsForEngagement(count = 5) {
    const accounts = await this.getEnabledAccounts();

    if (accounts.length === 0) return [];

    const weighted = [];
    accounts.forEach(account => {
      const weight = 7 - (account.tier || 3);
      for (let i = 0; i < weight; i++) {
        weighted.push(account);
      }
    });

    const shuffled = weighted.sort(() => Math.random() - 0.5);
    const selected = new Set();
    const result = [];

    for (const account of shuffled) {
      if (!selected.has(account.username) && result.length < count) {
        selected.add(account.username);
        result.push(account);
      }
    }

    return result;
  }

  // Open markdown config in default editor
  openConfigFile() {
    shell.openPath(this.mdPath);
    return { success: true, path: this.mdPath };
  }

  // Get config file path
  getConfigPath() {
    return this.mdPath;
  }

  // Initialize IPC handlers
  initIPCHandlers() {
    ipcMain.handle('trackedAccounts:getAll', async () => {
      return this.getAccounts();
    });

    ipcMain.handle('trackedAccounts:getEnabled', async () => {
      return this.getEnabledAccounts();
    });

    ipcMain.handle('trackedAccounts:getByTier', async (event, tier) => {
      return this.getAccountsByTier(tier);
    });

    ipcMain.handle('trackedAccounts:getByCategory', async (event, category) => {
      return this.getAccountsByCategory(category);
    });

    ipcMain.handle('trackedAccounts:search', async (event, query) => {
      return this.searchAccounts(query);
    });

    ipcMain.handle('trackedAccounts:getStats', async () => {
      return this.getStats();
    });

    ipcMain.handle('trackedAccounts:getRandomForEngagement', async (event, count) => {
      return this.getRandomAccountsForEngagement(count);
    });

    ipcMain.handle('trackedAccounts:refresh', async () => {
      const result = await this.syncAccounts();
      console.log('[TrackedAccounts] Refresh result:', result);
      return this.getAccounts(true);
    });

    ipcMain.handle('trackedAccounts:openConfig', async () => {
      return this.openConfigFile();
    });

    ipcMain.handle('trackedAccounts:getConfigPath', async () => {
      return this.getConfigPath();
    });
  }
}

module.exports = new TrackedAccountsManager();
