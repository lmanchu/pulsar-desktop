/**
 * Tracked Accounts Manager for Pulsar Desktop
 * Manages followed accounts for engagement automation
 */

const { ipcMain } = require('electron');
const supabaseClient = require('../api/supabase-client');

class TrackedAccountsManager {
  constructor() {
    this.accountsCache = null;
    this.cacheTime = null;
    this.CACHE_TTL = 300000; // 5 minutes
  }

  // Get all tracked accounts (defaults + user's)
  async getAccounts(forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh && this.accountsCache && this.cacheTime &&
        (now - this.cacheTime) < this.CACHE_TTL) {
      return this.accountsCache;
    }

    try {
      const accounts = await supabaseClient.getTrackedAccounts();

      // Group by tier for easy access
      const grouped = {
        all: accounts,
        byTier: {},
        byCategory: {},
        defaults: accounts.filter(a => a.is_default),
        custom: accounts.filter(a => !a.is_default)
      };

      // Group by tier (1-6)
      for (let i = 1; i <= 6; i++) {
        grouped.byTier[i] = accounts.filter(a => a.tier === i);
      }

      // Group by category
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
    } catch (error) {
      console.error('[TrackedAccounts] Failed to fetch accounts:', error);
      return this.accountsCache || this.getDefaultAccountsOffline();
    }
  }

  // Offline fallback with hardcoded defaults
  getDefaultAccountsOffline() {
    const defaults = [
      { username: 'sama', display_name: 'Sam Altman', tier: 1, category: 'tech_titan' },
      { username: 'karpathy', display_name: 'Andrej Karpathy', tier: 2, category: 'ai_leader' },
      { username: 'paulg', display_name: 'Paul Graham', tier: 3, category: 'vc' },
      { username: 'naval', display_name: 'Naval Ravikant', tier: 3, category: 'vc' },
      { username: 'levelsio', display_name: 'Pieter Levels', tier: 4, category: 'founder' },
      { username: 'swyx', display_name: 'Shawn Wang', tier: 6, category: 'influencer' }
    ].map(a => ({ ...a, platform: 'twitter', is_default: true, is_enabled: true }));

    return {
      all: defaults,
      byTier: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
      byCategory: {},
      defaults,
      custom: []
    };
  }

  // Get only enabled accounts
  async getEnabledAccounts() {
    const accounts = await this.getAccounts();
    return accounts.all.filter(a => a.is_enabled);
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

  // Search accounts by username or display name
  async searchAccounts(query) {
    const accounts = await this.getAccounts();
    const lowerQuery = query.toLowerCase();

    return accounts.all.filter(account =>
      account.username.toLowerCase().includes(lowerQuery) ||
      (account.display_name && account.display_name.toLowerCase().includes(lowerQuery))
    );
  }

  // Add custom tracked account
  async addAccount(accountData) {
    try {
      const result = await supabaseClient.addTrackedAccount(accountData);

      if (result.success) {
        // Invalidate cache
        this.accountsCache = null;
      }

      return result;
    } catch (error) {
      console.error('[TrackedAccounts] Failed to add account:', error);
      return { success: false, error: error.message };
    }
  }

  // Remove custom tracked account
  async removeAccount(accountId) {
    try {
      const result = await supabaseClient.removeTrackedAccount(accountId);

      if (result.success) {
        // Invalidate cache
        this.accountsCache = null;
      }

      return result;
    } catch (error) {
      console.error('[TrackedAccounts] Failed to remove account:', error);
      return { success: false, error: error.message };
    }
  }

  // Toggle account enabled status
  async toggleAccount(accountId, enabled) {
    try {
      const result = await supabaseClient.toggleTrackedAccount(accountId, enabled);

      if (result.success) {
        // Update cache locally instead of full refresh
        if (this.accountsCache) {
          const account = this.accountsCache.all.find(a => a.id === accountId);
          if (account) {
            account.is_enabled = enabled;
          }
        }
      }

      return result;
    } catch (error) {
      console.error('[TrackedAccounts] Failed to toggle account:', error);
      return { success: false, error: error.message };
    }
  }

  // Get stats
  async getStats() {
    const accounts = await this.getAccounts();

    return {
      total: accounts.all.length,
      defaults: accounts.defaults.length,
      custom: accounts.custom.length,
      enabled: accounts.all.filter(a => a.is_enabled).length,
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

    // Weight by tier (tier 1 = 6 weight, tier 6 = 1 weight)
    const weighted = [];
    accounts.forEach(account => {
      const weight = 7 - (account.tier || 3);
      for (let i = 0; i < weight; i++) {
        weighted.push(account);
      }
    });

    // Shuffle and pick unique
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

  // Initialize IPC handlers
  initIPCHandlers() {
    // Get all tracked accounts
    ipcMain.handle('trackedAccounts:getAll', async () => {
      return this.getAccounts();
    });

    // Get enabled accounts only
    ipcMain.handle('trackedAccounts:getEnabled', async () => {
      return this.getEnabledAccounts();
    });

    // Get accounts by tier
    ipcMain.handle('trackedAccounts:getByTier', async (event, tier) => {
      return this.getAccountsByTier(tier);
    });

    // Get accounts by category
    ipcMain.handle('trackedAccounts:getByCategory', async (event, category) => {
      return this.getAccountsByCategory(category);
    });

    // Search accounts
    ipcMain.handle('trackedAccounts:search', async (event, query) => {
      return this.searchAccounts(query);
    });

    // Add custom account
    ipcMain.handle('trackedAccounts:add', async (event, accountData) => {
      return this.addAccount(accountData);
    });

    // Remove account
    ipcMain.handle('trackedAccounts:remove', async (event, accountId) => {
      return this.removeAccount(accountId);
    });

    // Toggle account
    ipcMain.handle('trackedAccounts:toggle', async (event, { accountId, enabled }) => {
      return this.toggleAccount(accountId, enabled);
    });

    // Get stats
    ipcMain.handle('trackedAccounts:getStats', async () => {
      return this.getStats();
    });

    // Get random for engagement
    ipcMain.handle('trackedAccounts:getRandomForEngagement', async (event, count) => {
      return this.getRandomAccountsForEngagement(count);
    });

    // Refresh cache
    ipcMain.handle('trackedAccounts:refresh', async () => {
      return this.getAccounts(true);
    });
  }
}

module.exports = new TrackedAccountsManager();
