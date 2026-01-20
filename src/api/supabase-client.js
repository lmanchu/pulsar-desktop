/**
 * Supabase Client for Pulsar Desktop
 * Handles all server-side API calls for auth, quotas, and tracked accounts
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Supabase configuration - loaded from env, config file, or defaults
// Default URL for pulsar-desktop project (public, safe to include)
const DEFAULT_SUPABASE_URL = 'https://zezdqsgfbkatupsxibaw.supabase.co';

let SUPABASE_URL = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
let SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Load config on startup
function loadConfig() {
  try {
    const configPath = path.join(app.getPath('userData'), 'supabase-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      SUPABASE_URL = config.url || SUPABASE_URL;
      SUPABASE_ANON_KEY = config.anonKey || SUPABASE_ANON_KEY;
    }

    // Log configuration status (not the actual keys)
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      console.log('[Supabase] Configuration loaded successfully');
    } else if (!SUPABASE_ANON_KEY) {
      console.warn('[Supabase] Missing anon key. Please configure via Settings or supabase-config.json');
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

  async request(endpoint, options = {}, isRetry = false) {
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
      const errorMsg = error.message || error.error_description || 'Request failed';

      // Handle JWT expired - clear auth and require re-login
      if (errorMsg.includes('JWT expired') || errorMsg.includes('invalid JWT') || response.status === 401) {
        if (!isRetry && this.accessToken) {
          console.log('[Supabase] Token expired, clearing auth state');
          this.clearAuth();
          // Don't throw error for auth-related requests, just return empty
          if (endpoint.includes('quota') || endpoint.includes('tracked') || endpoint.includes('subscription')) {
            return null;
          }
        }
      }

      throw new Error(errorMsg);
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
        this.dbUserId = data.dbUserId; // Supabase UUID
        this.subscriptionTier = data.subscriptionTier;

        // Check if token is expired - but keep user/dbUserId for Clerk flow
        // Clerk will refresh the token when user interacts with the app
        if (this.accessToken && this.isTokenExpired(this.accessToken)) {
          console.log('[Supabase] Stored token is expired, clearing access token but keeping user info');
          this.accessToken = null; // Clear only the expired token
          // Keep user, dbUserId, subscriptionTier - they're still valid
          // Clerk will provide a fresh token when the user is active
        }
      }
    } catch (error) {
      console.error('[Supabase] Failed to load stored auth:', error);
    }
  }

  // Check if JWT token is expired
  isTokenExpired(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = payload.exp;
      if (!exp) return false;

      // Check if expired (with 60 second buffer)
      const now = Math.floor(Date.now() / 1000);
      return now >= (exp - 60);
    } catch (error) {
      console.error('[Supabase] Failed to check token expiry:', error);
      return false;
    }
  }

  saveAuth() {
    try {
      fs.writeFileSync(this.tokenPath, JSON.stringify({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        user: this.user,
        dbUserId: this.dbUserId, // Supabase UUID
        subscriptionTier: this.subscriptionTier
      }));
    } catch (error) {
      console.error('[Supabase] Failed to save auth:', error);
    }
  }

  clearAuth() {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    this.dbUserId = null;
    this.subscriptionTier = null;
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }
    } catch (error) {
      console.error('[Supabase] Failed to clear auth:', error);
    }
  }

  isAuthenticated() {
    // User is considered authenticated if we have user info and dbUserId
    // Token may be expired but Clerk will refresh it when user is active
    return !!this.user && !!this.dbUserId;
  }

  hasValidToken() {
    // Check if we have a non-expired access token for API calls
    return !!this.accessToken && !this.isTokenExpired(this.accessToken);
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

  // Handle Clerk JWT token for third-party auth
  async handleClerkToken(clerkToken) {
    try {
      // With Clerk third-party auth, we use the Clerk JWT directly
      // Supabase will validate it against the configured Clerk domain
      this.accessToken = clerkToken;
      this.refreshToken = null; // Clerk handles refresh

      // Decode JWT to get user info (without verification - Supabase will verify)
      const payload = JSON.parse(atob(clerkToken.split('.')[1]));

      this.user = {
        id: payload.sub,
        email: payload.email || payload.primary_email_address,
        user_metadata: {
          full_name: payload.name || payload.first_name,
          avatar_url: payload.image_url || payload.profile_image_url
        }
      };

      this.saveAuth();

      // Ensure user exists in our users table
      await this.ensureUserExists();

      return { success: true, user: this.user };
    } catch (error) {
      console.error('[Supabase] Clerk token handling failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Ensure user record exists in users table (using Clerk ID)
  async ensureUserExists() {
    if (!this.user) return;

    try {
      // Use RPC function to create or get user by Clerk ID
      // If email is missing, use a placeholder (will be updated if user exists)
      const email = this.user.email || `${this.user.id}@clerk.pulsar.app`;
      const result = await this.rpc('create_or_get_user_by_clerk', {
        p_clerk_id: this.user.id,
        p_email: email
      });

      if (result && result.length > 0) {
        // Store the database user ID and email for future use
        this.dbUserId = result[0].user_id;
        this.subscriptionTier = result[0].subscription_tier;
        // Update user object with email from DB if we didn't have it
        if (!this.user.email && result[0].email) {
          this.user.email = result[0].email;
        }
        // Always save auth to persist dbUserId
        this.saveAuth();
        console.log('[Supabase] User ensured:', result[0].is_new ? 'created new' : 'existing',
                    'email:', result[0].email, 'tier:', this.subscriptionTier, 'dbUserId:', this.dbUserId);
      }
    } catch (error) {
      console.error('[Supabase] Failed to ensure user exists:', error.message);
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
    if (!this.user) return null;

    // Need dbUserId (Supabase UUID), not Clerk ID
    if (!this.dbUserId) {
      console.log('[Supabase] getQuota: no dbUserId, trying to get it');
      await this.ensureUserExists();
      if (!this.dbUserId) {
        console.log('[Supabase] getQuota: still no dbUserId, returning null');
        return null;
      }
    }

    try {
      const result = await this.rpc('get_or_create_quota', {
        p_user_id: this.dbUserId
      });

      return result;
    } catch (error) {
      // JWT expired errors are handled in request(), return null for graceful degradation
      if (error.message.includes('JWT') || error.message.includes('401')) {
        return null;
      }
      throw error;
    }
  }

  // Request a post token (before posting)
  async requestPostToken(platform, content) {
    if (!this.user) throw new Error('Not authenticated');

    // Need dbUserId (Supabase UUID), not Clerk ID
    if (!this.dbUserId) {
      await this.ensureUserExists();
      if (!this.dbUserId) {
        throw new Error('Could not get database user ID');
      }
    }

    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const result = await this.rpc('request_post_token', {
      p_user_id: this.dbUserId,
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

    // Need dbUserId (Supabase UUID), not Clerk ID
    if (!this.dbUserId) {
      await this.ensureUserExists();
      if (!this.dbUserId) return false;
    }

    try {
      const result = await this.rpc('check_feature_access', {
        p_user_id: this.dbUserId,
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
    try {
      const result = await this.query('tier_limits');
      return result || [];
    } catch (error) {
      console.error('[Supabase] Failed to fetch tier limits:', error.message);
      return [];
    }
  }

  // ============================================
  // Tracked Accounts
  // ============================================

  // Get all tracked accounts (defaults + user's custom)
  async getTrackedAccounts() {
    try {
      if (!this.user) {
        // Return only default accounts if not logged in
        const result = await this.query('tracked_accounts', {
          filter: { user_id: 'is.null' },
          order: 'tier.asc,username.asc'
        });
        return result || [];
      }

      // Need dbUserId for user-specific queries
      if (!this.dbUserId) {
        await this.ensureUserExists();
      }

      // Get both default and user's accounts
      const result = await this.query('tracked_accounts', {
        filter: {
          or: `(user_id.is.null,user_id.eq.${this.dbUserId || this.user.id})`
        },
        order: 'tier.asc,username.asc'
      });
      return result || [];
    } catch (error) {
      console.error('[Supabase] Failed to fetch tracked accounts:', error.message);
      return [];
    }
  }

  // Get only user's custom tracked accounts
  async getUserTrackedAccounts() {
    if (!this.user) return [];

    // Need dbUserId (Supabase UUID)
    if (!this.dbUserId) {
      await this.ensureUserExists();
      if (!this.dbUserId) return [];
    }

    return this.query('tracked_accounts', {
      filter: { user_id: `eq.${this.dbUserId}` },
      order: 'created_at.desc'
    });
  }

  // Add custom tracked account
  async addTrackedAccount(account) {
    if (!this.user) throw new Error('Not authenticated');

    // Need dbUserId (Supabase UUID)
    if (!this.dbUserId) {
      await this.ensureUserExists();
      if (!this.dbUserId) {
        return { success: false, error: 'Could not get database user ID' };
      }
    }

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
        user_id: this.dbUserId,
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

    // Need dbUserId (Supabase UUID)
    if (!this.dbUserId) {
      await this.ensureUserExists();
      if (!this.dbUserId) {
        return { success: false, error: 'Could not get database user ID' };
      }
    }

    try {
      await this.delete('tracked_accounts', {
        id: `eq.${accountId}`,
        user_id: `eq.${this.dbUserId}` // Safety: can only delete own accounts
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Toggle tracked account enabled status
  async toggleTrackedAccount(accountId, enabled) {
    if (!this.user) throw new Error('Not authenticated');

    // Need dbUserId (Supabase UUID)
    if (!this.dbUserId) {
      await this.ensureUserExists();
      if (!this.dbUserId) {
        return { success: false, error: 'Could not get database user ID' };
      }
    }

    try {
      // For default accounts, we'd need a user_settings table
      // For now, only allow toggling user's own accounts
      await this.update('tracked_accounts',
        { is_enabled: enabled },
        { id: `eq.${accountId}`, user_id: `eq.${this.dbUserId}` }
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
    if (!this.user) {
      console.log('[Supabase] getSubscriptionInfo: no user, returning null');
      return null;
    }

    try {
      // Use RPC function to bypass RLS (user.id is the Clerk ID)
      console.log('[Supabase] getSubscriptionInfo: calling RPC with clerk_id:', this.user.id);
      const result = await this.rpc('get_subscription_by_clerk', {
        p_clerk_id: this.user.id
      });

      console.log('[Supabase] getSubscriptionInfo: RPC result:', JSON.stringify(result));
      return result?.[0] || null;
    } catch (error) {
      console.error('[Supabase] Failed to fetch subscription info:', error.message);
      return null;
    }
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
