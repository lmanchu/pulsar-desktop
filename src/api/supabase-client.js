/**
 * Supabase Client for Pulsar Desktop
 * Handles all server-side API calls for auth, quotas, and tracked accounts
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Supabase configuration - will be loaded from env or config file
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';

// Load config on startup
function loadConfig() {
  try {
    const configPath = path.join(app.getPath('userData'), 'supabase-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      SUPABASE_URL = config.url || '';
      SUPABASE_ANON_KEY = config.anonKey || '';
    }
  } catch (error) {
    console.error('[Supabase] Failed to load config:', error);
  }
}

// Initialize when module loads
loadConfig();

class SupabaseClient {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    this.tokenPath = path.join(app.getPath('userData'), 'auth-token.json');
    this.loadStoredAuth();
  }

  // ============================================
  // Configuration
  // ============================================

  setConfig(url, anonKey) {
    SUPABASE_URL = url;
    SUPABASE_ANON_KEY = anonKey;

    // Persist config
    const configPath = path.join(app.getPath('userData'), 'supabase-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ url, anonKey }));
  }

  isConfigured() {
    return SUPABASE_URL && SUPABASE_ANON_KEY;
  }

  // ============================================
  // HTTP Helpers
  // ============================================

  async request(endpoint, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Supabase not configured. Call setConfig() first.');
    }

    const url = endpoint.startsWith('http')
      ? endpoint
      : `${SUPABASE_URL}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      ...options.headers
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || error.error_description || 'Request failed');
    }

    return response.json();
  }

  async rpc(functionName, params = {}) {
    return this.request(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body: JSON.stringify(params)
    });
  }

  async query(table, options = {}) {
    let url = `/rest/v1/${table}`;
    const queryParams = [];

    if (options.select) {
      queryParams.push(`select=${encodeURIComponent(options.select)}`);
    }
    if (options.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        queryParams.push(`${key}=${encodeURIComponent(value)}`);
      });
    }
    if (options.order) {
      queryParams.push(`order=${encodeURIComponent(options.order)}`);
    }
    if (options.limit) {
      queryParams.push(`limit=${options.limit}`);
    }

    if (queryParams.length > 0) {
      url += '?' + queryParams.join('&');
    }

    return this.request(url);
  }

  async insert(table, data) {
    return this.request(`/rest/v1/${table}`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Prefer': 'return=representation'
      }
    });
  }

  async update(table, data, filter) {
    let url = `/rest/v1/${table}`;
    const queryParams = [];

    Object.entries(filter).forEach(([key, value]) => {
      queryParams.push(`${key}=${encodeURIComponent(value)}`);
    });

    if (queryParams.length > 0) {
      url += '?' + queryParams.join('&');
    }

    return this.request(url, {
      method: 'PATCH',
      body: JSON.stringify(data),
      headers: {
        'Prefer': 'return=representation'
      }
    });
  }

  async delete(table, filter) {
    let url = `/rest/v1/${table}`;
    const queryParams = [];

    Object.entries(filter).forEach(([key, value]) => {
      queryParams.push(`${key}=${encodeURIComponent(value)}`);
    });

    if (queryParams.length > 0) {
      url += '?' + queryParams.join('&');
    }

    return this.request(url, {
      method: 'DELETE'
    });
  }

  // ============================================
  // Authentication
  // ============================================

  loadStoredAuth() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
        this.accessToken = data.accessToken;
        this.refreshToken = data.refreshToken;
        this.user = data.user;
      }
    } catch (error) {
      console.error('[Supabase] Failed to load stored auth:', error);
    }
  }

  saveAuth() {
    try {
      fs.writeFileSync(this.tokenPath, JSON.stringify({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        user: this.user
      }));
    } catch (error) {
      console.error('[Supabase] Failed to save auth:', error);
    }
  }

  clearAuth() {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }
    } catch (error) {
      console.error('[Supabase] Failed to clear auth:', error);
    }
  }

  isAuthenticated() {
    return !!this.accessToken && !!this.user;
  }

  getUser() {
    return this.user;
  }

  // Sign in with OAuth (returns URL for auth window)
  getOAuthUrl(provider) {
    const redirectUrl = 'pulsar://auth/callback';
    return `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectUrl)}`;
  }

  // Handle OAuth callback
  async handleOAuthCallback(url) {
    try {
      const urlObj = new URL(url);
      const accessToken = urlObj.searchParams.get('access_token') ||
                          urlObj.hash.match(/access_token=([^&]*)/)?.[1];
      const refreshToken = urlObj.searchParams.get('refresh_token') ||
                           urlObj.hash.match(/refresh_token=([^&]*)/)?.[1];

      if (!accessToken) {
        throw new Error('No access token in callback');
      }

      this.accessToken = accessToken;
      this.refreshToken = refreshToken;

      // Get user info
      const user = await this.request('/auth/v1/user');
      this.user = user;
      this.saveAuth();

      // Ensure user exists in our users table
      await this.ensureUserExists();

      return { success: true, user };
    } catch (error) {
      console.error('[Supabase] OAuth callback failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Ensure user record exists in users table
  async ensureUserExists() {
    if (!this.user) return;

    try {
      // Check if user exists
      const existing = await this.query('users', {
        filter: { id: `eq.${this.user.id}` }
      });

      if (existing.length === 0) {
        // Create user record
        await this.insert('users', {
          id: this.user.id,
          email: this.user.email
        });
      }
    } catch (error) {
      console.error('[Supabase] Failed to ensure user exists:', error);
    }
  }

  // Refresh token
  async refreshSession() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await this.request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: this.refreshToken })
      });

      this.accessToken = response.access_token;
      this.refreshToken = response.refresh_token;
      this.user = response.user;
      this.saveAuth();

      return { success: true };
    } catch (error) {
      this.clearAuth();
      return { success: false, error: error.message };
    }
  }

  // Sign out
  async signOut() {
    try {
      if (this.accessToken) {
        await this.request('/auth/v1/logout', { method: 'POST' });
      }
    } catch (error) {
      // Ignore errors, just clear local state
    }
    this.clearAuth();
    return { success: true };
  }

  // ============================================
  // Quota Management
  // ============================================

  // Get today's quota
  async getQuota() {
    if (!this.user) throw new Error('Not authenticated');

    const result = await this.rpc('get_or_create_quota', {
      p_user_id: this.user.id
    });

    return result;
  }

  // Request a post token (before posting)
  async requestPostToken(platform, content) {
    if (!this.user) throw new Error('Not authenticated');

    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const result = await this.rpc('request_post_token', {
      p_user_id: this.user.id,
      p_platform: platform,
      p_content_hash: contentHash
    });

    // Result is array, get first item
    const tokenResult = Array.isArray(result) ? result[0] : result;

    if (!tokenResult.success) {
      return { success: false, error: tokenResult.error };
    }

    return {
      success: true,
      token: tokenResult.token,
      contentHash
    };
  }

  // Confirm post token usage (after posting)
  async confirmPostToken(token, success, platformPostId = null, errorMessage = null) {
    const result = await this.rpc('confirm_post_token', {
      p_token: token,
      p_success: success,
      p_platform_post_id: platformPostId,
      p_error_message: errorMessage
    });

    const confirmResult = Array.isArray(result) ? result[0] : result;
    return confirmResult;
  }

  // Check feature access
  async checkFeatureAccess(feature) {
    if (!this.user) return false;

    try {
      const result = await this.rpc('check_feature_access', {
        p_user_id: this.user.id,
        p_feature: feature
      });
      return result;
    } catch (error) {
      console.error('[Supabase] Feature check failed:', error);
      return false;
    }
  }

  // Get tier limits
  async getTierLimits() {
    return this.query('tier_limits');
  }

  // ============================================
  // Tracked Accounts
  // ============================================

  // Get all tracked accounts (defaults + user's custom)
  async getTrackedAccounts() {
    if (!this.user) {
      // Return only default accounts if not logged in
      return this.query('tracked_accounts', {
        filter: { user_id: 'is.null' },
        order: 'tier.asc,username.asc'
      });
    }

    // Get both default and user's accounts
    return this.query('tracked_accounts', {
      filter: {
        or: `(user_id.is.null,user_id.eq.${this.user.id})`
      },
      order: 'tier.asc,username.asc'
    });
  }

  // Get only user's custom tracked accounts
  async getUserTrackedAccounts() {
    if (!this.user) return [];

    return this.query('tracked_accounts', {
      filter: { user_id: `eq.${this.user.id}` },
      order: 'created_at.desc'
    });
  }

  // Add custom tracked account
  async addTrackedAccount(account) {
    if (!this.user) throw new Error('Not authenticated');

    // Check if user has access to tracked accounts feature
    const hasAccess = await this.checkFeatureAccess('tracked_accounts');
    if (!hasAccess) {
      return { success: false, error: 'Upgrade to Pro to add custom tracked accounts' };
    }

    // Check account limit
    const userAccounts = await this.getUserTrackedAccounts();
    const limits = await this.getTierLimits();
    const userTierLimit = limits.find(l => l.tier === 'pro')?.max_tracked_accounts || 100;

    if (userAccounts.length >= userTierLimit) {
      return { success: false, error: `Maximum ${userTierLimit} tracked accounts reached` };
    }

    try {
      const result = await this.insert('tracked_accounts', {
        user_id: this.user.id,
        platform: account.platform || 'twitter',
        username: account.username,
        display_name: account.displayName,
        tier: account.tier || 3,
        category: account.category,
        tags: account.tags || [],
        is_default: false
      });

      return { success: true, account: result[0] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Remove tracked account (only user's own)
  async removeTrackedAccount(accountId) {
    if (!this.user) throw new Error('Not authenticated');

    try {
      await this.delete('tracked_accounts', {
        id: `eq.${accountId}`,
        user_id: `eq.${this.user.id}` // Safety: can only delete own accounts
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Toggle tracked account enabled status
  async toggleTrackedAccount(accountId, enabled) {
    if (!this.user) throw new Error('Not authenticated');

    try {
      // For default accounts, we'd need a user_settings table
      // For now, only allow toggling user's own accounts
      await this.update('tracked_accounts',
        { is_enabled: enabled },
        { id: `eq.${accountId}`, user_id: `eq.${this.user.id}` }
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Subscription / Stripe
  // ============================================

  // Get user's subscription info
  async getSubscriptionInfo() {
    if (!this.user) return null;

    const users = await this.query('users', {
      select: 'subscription_tier,subscription_status,subscription_started_at,subscription_ends_at',
      filter: { id: `eq.${this.user.id}` }
    });

    return users[0] || null;
  }

  // Create Stripe checkout session (calls Edge Function)
  async createCheckoutSession() {
    if (!this.user) throw new Error('Not authenticated');

    return this.request(`${SUPABASE_URL}/functions/v1/create-checkout`, {
      method: 'POST',
      body: JSON.stringify({ userId: this.user.id })
    });
  }

  // Create Stripe portal session (for managing subscription)
  async createPortalSession() {
    if (!this.user) throw new Error('Not authenticated');

    return this.request(`${SUPABASE_URL}/functions/v1/create-portal`, {
      method: 'POST',
      body: JSON.stringify({ userId: this.user.id })
    });
  }
}

module.exports = new SupabaseClient();
