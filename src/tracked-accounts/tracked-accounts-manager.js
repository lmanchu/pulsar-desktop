/**
 * Tracked Accounts Manager for Pulsar Desktop
 * Platform-specific markdown configs with AI auto-classification via WebLLM
 *
 * Supports separate tracked accounts for Twitter and LinkedIn
 */

const { ipcMain, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');

class TrackedAccountsManager {
  constructor() {
    // Platform-specific paths
    this.platforms = ['twitter', 'linkedin'];
    this.mdPaths = {
      twitter: path.join(app.getPath('userData'), 'tracked-accounts-twitter.md'),
      linkedin: path.join(app.getPath('userData'), 'tracked-accounts-linkedin.md')
    };
    this.cachePaths = {
      twitter: path.join(app.getPath('userData'), 'tracked-accounts-twitter-cache.json'),
      linkedin: path.join(app.getPath('userData'), 'tracked-accounts-linkedin-cache.json')
    };
    // Legacy path for migration
    this.legacyMdPath = path.join(app.getPath('userData'), 'tracked-accounts.md');
    this.legacyCachePath = path.join(app.getPath('userData'), 'tracked-accounts-cache.json');

    this.accountsCache = {}; // { twitter: {...}, linkedin: {...} }
    this.cacheTime = {};     // { twitter: timestamp, linkedin: timestamp }
    this.CACHE_TTL = 60000;  // 1 minute
    this.aiProvider = null;

    this.migrateIfNeeded();
    this.ensureConfigExists();
  }

  // Migrate from single file to platform-specific files
  migrateIfNeeded() {
    // If legacy file exists and Twitter file doesn't, migrate
    if (fs.existsSync(this.legacyMdPath) && !fs.existsSync(this.mdPaths.twitter)) {
      console.log('[TrackedAccounts] Migrating legacy config to Twitter...');
      fs.copyFileSync(this.legacyMdPath, this.mdPaths.twitter);
      if (fs.existsSync(this.legacyCachePath)) {
        fs.copyFileSync(this.legacyCachePath, this.cachePaths.twitter);
      }
      // Rename legacy files (keep as backup)
      fs.renameSync(this.legacyMdPath, this.legacyMdPath + '.bak');
      if (fs.existsSync(this.legacyCachePath)) {
        fs.renameSync(this.legacyCachePath, this.legacyCachePath + '.bak');
      }
      console.log('[TrackedAccounts] Migration complete');
    }
  }

  // Set AI provider reference (called from main.js after AIProvider init)
  setAIProvider(provider) {
    this.aiProvider = provider;
  }

  // Create default markdown configs for each platform if doesn't exist
  ensureConfigExists() {
    for (const platform of this.platforms) {
      if (!fs.existsSync(this.mdPaths[platform])) {
        fs.writeFileSync(this.mdPaths[platform], this.getDefaultMarkdown(platform));
        console.log(`[TrackedAccounts] Created default ${platform} config at:`, this.mdPaths[platform]);
      }
      // Also ensure cache exists
      if (!fs.existsSync(this.cachePaths[platform])) {
        fs.writeFileSync(
          this.cachePaths[platform],
          JSON.stringify({ accounts: this.getDefaultAccounts(platform) }, null, 2)
        );
      }
    }
  }

  // Platform-specific default markdown content
  getDefaultMarkdown(platform = 'twitter') {
    if (platform === 'linkedin') {
      return `# LinkedIn Tracked Accounts

Add LinkedIn usernames or company pages below, one per line.
AI will automatically classify tier and category.

在下方新增 LinkedIn 用戶名或公司頁面，一行一個。
AI 會自動分類層級與類別。

---

satlokomern
raborgh
jeffweiner08
melsassak
brianchesky
raborgh
alexisohanian
stephenfry
guykawasaki
garyvee
simonsinakk
ariaborgh
`;
    }

    // Twitter default
    return `# Twitter/X Tracked Accounts

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

  // Platform-specific default accounts with pre-classified data
  getDefaultAccounts(platform = 'twitter') {
    if (platform === 'linkedin') {
      return [
        { username: "satlokomern", display_name: "Satya Nadella", tier: 1, category: "tech_titan", enabled: true },
        { username: "raborgh", display_name: "Reid Hoffman", tier: 1, category: "tech_titan", enabled: true },
        { username: "jeffweiner08", display_name: "Jeff Weiner", tier: 2, category: "tech_leader", enabled: true },
        { username: "melsassak", display_name: "Melanie Perkins", tier: 2, category: "founder", enabled: true },
        { username: "brianchesky", display_name: "Brian Chesky", tier: 2, category: "founder", enabled: true },
        { username: "alexisohanian", display_name: "Alexis Ohanian", tier: 3, category: "vc", enabled: true },
        { username: "stephenfry", display_name: "Stephen Fry", tier: 3, category: "influencer", enabled: true },
        { username: "guykawasaki", display_name: "Guy Kawasaki", tier: 4, category: "influencer", enabled: true },
        { username: "garyvee", display_name: "Gary Vaynerchuk", tier: 4, category: "influencer", enabled: true },
        { username: "simonsinakk", display_name: "Simon Sinek", tier: 5, category: "thought_leader", enabled: true },
        { username: "ariaborgh", display_name: "Arianna Huffington", tier: 5, category: "thought_leader", enabled: true }
      ];
    }

    // Twitter defaults
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
  parseMarkdown(platform = 'twitter') {
    try {
      const mdPath = this.mdPaths[platform];
      if (!mdPath || !fs.existsSync(mdPath)) {
        console.log(`[TrackedAccounts] No markdown file for platform: ${platform}`);
        return [];
      }

      const content = fs.readFileSync(mdPath, 'utf8');
      const lines = content.split('\n');
      const usernames = [];

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines, headers, comments, and separator
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---') ||
            trimmed.includes('Add Twitter') || trimmed.includes('Add LinkedIn') ||
            trimmed.includes('AI will') ||
            trimmed.includes('在下方') || trimmed.includes('會自動')) {
          continue;
        }
        // Clean username (remove @ if present)
        const username = trimmed.replace(/^@/, '');
        if (username && /^[a-zA-Z0-9_-]+$/.test(username)) {
          usernames.push(username);
        }
      }

      return usernames;
    } catch (error) {
      console.error(`[TrackedAccounts] Failed to parse ${platform} markdown:`, error.message);
      return [];
    }
  }

  // Load cached account data for platform
  loadCache(platform = 'twitter') {
    try {
      const cachePath = this.cachePaths[platform];
      if (cachePath && fs.existsSync(cachePath)) {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        return data.accounts || [];
      }
    } catch (error) {
      console.error(`[TrackedAccounts] Failed to load ${platform} cache:`, error.message);
    }
    return this.getDefaultAccounts(platform);
  }

  // Save cache for platform
  saveCache(accounts, platform = 'twitter') {
    try {
      const cachePath = this.cachePaths[platform];
      if (cachePath) {
        fs.writeFileSync(cachePath, JSON.stringify({ accounts }, null, 2));
      }
    } catch (error) {
      console.error(`[TrackedAccounts] Failed to save ${platform} cache:`, error.message);
    }
  }

  // Classify new accounts using AI
  async classifyAccounts(usernames, platform = 'twitter') {
    if (!usernames.length) {
      return [];
    }

    const platformName = platform === 'linkedin' ? 'LinkedIn' : 'Twitter/X';
    const categoryOptions = platform === 'linkedin'
      ? 'tech_titan, tech_leader, founder, vc, influencer, thought_leader, company, custom'
      : 'tech_titan, ai_leader, ai_company, vc, founder, devtools, influencer, custom';

    const prompt = `Classify these ${platformName} accounts into tiers and categories.

Tier definitions:
1 = Tech Titans (Satya Nadella, Sam Altman level)
2 = Tech Leaders & Companies (executives, AI companies)
3 = VCs & Investors
4 = Founders & Entrepreneurs
5 = ${platform === 'linkedin' ? 'Thought Leaders & Speakers' : 'DevTools & Technical'}
6 = Influencers & Content Creators

Category options: ${categoryOptions}

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

  // Sync markdown with cache, classify new accounts for a specific platform
  async syncAccounts(platform = 'twitter') {
    const mdUsernames = this.parseMarkdown(platform);
    const cachedAccounts = this.loadCache(platform);

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
      console.log(`[TrackedAccounts] Classifying new ${platform} accounts:`, newUsernames);
      newAccounts = await this.classifyAccounts(newUsernames, platform);
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
    this.saveCache(finalAccounts, platform);
    this.accountsCache[platform] = null; // Invalidate memory cache for this platform

    return {
      platform,
      total: finalAccounts.length,
      new: newUsernames.length,
      classified: newAccounts.length
    };
  }

  // Sync all platforms
  async syncAllPlatforms() {
    const results = {};
    for (const platform of this.platforms) {
      results[platform] = await this.syncAccounts(platform);
    }
    return results;
  }

  // Get all tracked accounts for a platform
  async getAccounts(platform = 'twitter', forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh && this.accountsCache[platform] && this.cacheTime[platform] &&
        (now - this.cacheTime[platform]) < this.CACHE_TTL) {
      return this.accountsCache[platform];
    }

    // Sync markdown with cache
    await this.syncAccounts(platform);

    const accounts = this.loadCache(platform);

    // Add IDs and platform if missing
    accounts.forEach((a, i) => {
      if (!a.id) a.id = `${platform}-${i}`;
      if (a.enabled === undefined) a.enabled = true;
      a.platform = platform;
    });

    // Group by tier for easy access
    const grouped = {
      platform,
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

    this.accountsCache[platform] = grouped;
    this.cacheTime[platform] = now;

    return grouped;
  }

  // Get accounts for all platforms
  async getAllPlatformAccounts() {
    const result = {};
    for (const platform of this.platforms) {
      result[platform] = await this.getAccounts(platform);
    }
    return result;
  }

  // Get only enabled accounts for a platform
  async getEnabledAccounts(platform = 'twitter') {
    const accounts = await this.getAccounts(platform);
    return accounts.all.filter(a => a.enabled !== false);
  }

  // Get accounts by tier for a platform
  async getAccountsByTier(tier, platform = 'twitter') {
    const accounts = await this.getAccounts(platform);
    return accounts.byTier[tier] || [];
  }

  // Get accounts by category for a platform
  async getAccountsByCategory(category, platform = 'twitter') {
    const accounts = await this.getAccounts(platform);
    return accounts.byCategory[category] || [];
  }

  // Search accounts across all platforms or specific platform
  async searchAccounts(query, platform = null) {
    const lowerQuery = query.toLowerCase();
    const results = [];

    const platformsToSearch = platform ? [platform] : this.platforms;

    for (const p of platformsToSearch) {
      const accounts = await this.getAccounts(p);
      const matches = accounts.all.filter(account =>
        account.username.toLowerCase().includes(lowerQuery) ||
        (account.display_name && account.display_name.toLowerCase().includes(lowerQuery))
      );
      results.push(...matches);
    }

    return results;
  }

  // Get stats for a platform or all platforms
  async getStats(platform = null) {
    if (platform) {
      const accounts = await this.getAccounts(platform);
      return {
        platform,
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

    // Stats for all platforms
    const stats = { platforms: {} };
    let totalAll = 0;
    let enabledAll = 0;

    for (const p of this.platforms) {
      const accounts = await this.getAccounts(p);
      stats.platforms[p] = {
        total: accounts.all.length,
        defaults: accounts.defaults.length,
        custom: accounts.custom.length,
        enabled: accounts.all.filter(a => a.enabled !== false).length,
        byTier: Object.fromEntries(
          Object.entries(accounts.byTier).map(([tier, accs]) => [tier, accs.length])
        ),
        categories: Object.keys(accounts.byCategory)
      };
      totalAll += accounts.all.length;
      enabledAll += accounts.all.filter(a => a.enabled !== false).length;
    }

    stats.totalAll = totalAll;
    stats.enabledAll = enabledAll;
    return stats;
  }

  // Get random accounts for engagement (weighted by tier) for a platform
  async getRandomAccountsForEngagement(count = 5, platform = 'twitter') {
    const accounts = await this.getEnabledAccounts(platform);

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

  // Open markdown config in default editor for a platform
  openConfigFile(platform = 'twitter') {
    const mdPath = this.mdPaths[platform];
    if (mdPath) {
      shell.openPath(mdPath);
      return { success: true, path: mdPath, platform };
    }
    return { success: false, error: `Unknown platform: ${platform}` };
  }

  // Get config file path for a platform
  getConfigPath(platform = 'twitter') {
    return this.mdPaths[platform] || null;
  }

  // Get all config paths
  getAllConfigPaths() {
    return { ...this.mdPaths };
  }

  // Initialize IPC handlers
  initIPCHandlers() {
    // Get accounts for a platform (default: twitter)
    ipcMain.handle('trackedAccounts:getAll', async (event, platform = 'twitter') => {
      return this.getAccounts(platform);
    });

    // Get accounts for all platforms
    ipcMain.handle('trackedAccounts:getAllPlatforms', async () => {
      return this.getAllPlatformAccounts();
    });

    // Get enabled accounts for a platform
    ipcMain.handle('trackedAccounts:getEnabled', async (event, platform = 'twitter') => {
      return this.getEnabledAccounts(platform);
    });

    // Get by tier for a platform
    ipcMain.handle('trackedAccounts:getByTier', async (event, { tier, platform = 'twitter' }) => {
      return this.getAccountsByTier(tier, platform);
    });

    // Get by category for a platform
    ipcMain.handle('trackedAccounts:getByCategory', async (event, { category, platform = 'twitter' }) => {
      return this.getAccountsByCategory(category, platform);
    });

    // Search across platforms
    ipcMain.handle('trackedAccounts:search', async (event, { query, platform = null }) => {
      return this.searchAccounts(query, platform);
    });

    // Get stats (platform = null for all platforms)
    ipcMain.handle('trackedAccounts:getStats', async (event, platform = null) => {
      return this.getStats(platform);
    });

    // Get random for engagement on a platform
    ipcMain.handle('trackedAccounts:getRandomForEngagement', async (event, { count = 5, platform = 'twitter' }) => {
      return this.getRandomAccountsForEngagement(count, platform);
    });

    // Refresh a specific platform or all
    ipcMain.handle('trackedAccounts:refresh', async (event, platform = null) => {
      if (platform) {
        const result = await this.syncAccounts(platform);
        console.log(`[TrackedAccounts] Refresh ${platform} result:`, result);
        return this.getAccounts(platform, true);
      } else {
        const results = await this.syncAllPlatforms();
        console.log('[TrackedAccounts] Refresh all platforms result:', results);
        return this.getAllPlatformAccounts();
      }
    });

    // Open config for a platform
    ipcMain.handle('trackedAccounts:openConfig', async (event, platform = 'twitter') => {
      return this.openConfigFile(platform);
    });

    // Get config path for a platform
    ipcMain.handle('trackedAccounts:getConfigPath', async (event, platform = 'twitter') => {
      return this.getConfigPath(platform);
    });

    // Get all config paths
    ipcMain.handle('trackedAccounts:getAllConfigPaths', async () => {
      return this.getAllConfigPaths();
    });

    // Get list of supported platforms
    ipcMain.handle('trackedAccounts:getPlatforms', async () => {
      return this.platforms;
    });
  }
}

module.exports = new TrackedAccountsManager();
