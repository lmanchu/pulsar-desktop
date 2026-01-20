/**
 * Quota Manager for Pulsar Desktop
 * Handles usage limits, token-based posting, and quota caching
 */

const { ipcMain } = require('electron');
const supabaseClient = require('../api/supabase-client');

class QuotaManager {
  constructor() {
    this.quotaCache = null;
    this.quotaCacheTime = null;
    this.tierLimitsCache = null;
    this.CACHE_TTL = 60000; // 1 minute cache
  }

  // Get cached quota or fetch fresh
  async getQuota(forceRefresh = false) {
    const now = Date.now();

    if (!forceRefresh && this.quotaCache && this.quotaCacheTime &&
        (now - this.quotaCacheTime) < this.CACHE_TTL) {
      return this.quotaCache;
    }

    if (!supabaseClient.isAuthenticated()) {
      // Return default free limits for unauthenticated users
      return this.getDefaultQuota();
    }

    try {
      const quota = await supabaseClient.getQuota();

      // Handle null response (JWT expired, not authenticated, etc.)
      if (!quota) {
        console.log('[QuotaManager] Quota returned null, using defaults');
        return this.quotaCache || this.getDefaultQuota();
      }

      this.quotaCache = quota;
      this.quotaCacheTime = now;
      return quota;
    } catch (error) {
      console.error('[QuotaManager] Failed to fetch quota:', error.message);
      // Return cached or default
      return this.quotaCache || this.getDefaultQuota();
    }
  }

  getDefaultQuota() {
    return {
      posts_used: 0,
      posts_limit: 3,
      replies_used: 0,
      replies_limit: 0,
      ai_generations_used: 0,
      ai_generations_limit: 3
    };
  }

  getDefaultTierLimit() {
    return {
      tier: 'free',
      daily_posts: 3,
      daily_replies: 0,
      has_scheduling: false,
      has_ai_generation: true,
      daily_ai_generations: 3,
      max_tracked_accounts: 0,
      max_interest_topics: 0,
      max_social_accounts: 1,
      has_knowledge_base: false,
      price_monthly_usd: 0
    };
  }

  // Get tier limits
  async getTierLimits() {
    if (this.tierLimitsCache) {
      return this.tierLimitsCache;
    }

    try {
      const limits = await supabaseClient.getTierLimits();
      this.tierLimitsCache = limits;
      return limits;
    } catch (error) {
      console.error('[QuotaManager] Failed to fetch tier limits:', error);
      // Fallback tier limits matching 4-tier pricing model
      return [
        { tier: 'free', daily_posts: 3, daily_replies: 0, has_scheduling: false, has_ai_generation: true, daily_ai_generations: 3, max_tracked_accounts: 0, max_interest_topics: 0, max_social_accounts: 1, has_knowledge_base: false, price_monthly_usd: 0 },
        { tier: 'starter', daily_posts: 5, daily_replies: 10, has_scheduling: true, has_ai_generation: true, daily_ai_generations: 10, max_tracked_accounts: 3, max_interest_topics: 3, max_social_accounts: 3, has_knowledge_base: false, price_monthly_usd: 14.99 },
        { tier: 'pro', daily_posts: 10, daily_replies: 30, has_scheduling: true, has_ai_generation: true, daily_ai_generations: 30, max_tracked_accounts: 10, max_interest_topics: 10, max_social_accounts: 5, has_knowledge_base: true, price_monthly_usd: 49.00 },
        { tier: 'agency', daily_posts: 30, daily_replies: 100, has_scheduling: true, has_ai_generation: true, daily_ai_generations: 100, max_tracked_accounts: 50, max_interest_topics: 20, max_social_accounts: 10, has_knowledge_base: true, price_monthly_usd: 99.00 }
      ];
    }
  }

  // Check if user can post
  async canPost() {
    const quota = await this.getQuota();
    return quota.posts_used < quota.posts_limit;
  }

  // Get remaining posts
  async getRemainingPosts() {
    const quota = await this.getQuota();
    return Math.max(0, quota.posts_limit - quota.posts_used);
  }

  // Request a post token (REQUIRED before posting)
  async requestPostToken(platform, content) {
    if (!supabaseClient.isAuthenticated()) {
      // For unauthenticated users, use local tracking
      return this.requestLocalToken(platform, content);
    }

    try {
      const result = await supabaseClient.requestPostToken(platform, content);

      if (result.success) {
        // Invalidate cache since quota changed
        this.quotaCache = null;
      }

      return result;
    } catch (error) {
      console.error('[QuotaManager] Token request failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Local token for unauthenticated users (stored in memory)
  localTokens = new Map();
  localPostCount = 0;
  localPostDate = null;

  requestLocalToken(platform, content) {
    const today = new Date().toDateString();

    // Reset daily count
    if (this.localPostDate !== today) {
      this.localPostCount = 0;
      this.localPostDate = today;
    }

    // Check limit (3 posts/day for free)
    if (this.localPostCount >= 3) {
      return {
        success: false,
        error: 'Daily post limit exceeded. Please log in or upgrade to Pro.'
      };
    }

    // Generate local token
    const token = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.localTokens.set(token, {
      platform,
      content,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    return {
      success: true,
      token,
      isLocal: true
    };
  }

  // Confirm token usage (after posting)
  async confirmPostToken(token, success, platformPostId = null, errorMessage = null) {
    // Handle local tokens
    if (token.startsWith('local-')) {
      return this.confirmLocalToken(token, success);
    }

    try {
      const result = await supabaseClient.confirmPostToken(
        token,
        success,
        platformPostId,
        errorMessage
      );

      // Invalidate cache since quota might have changed (refund on failure)
      this.quotaCache = null;

      return result;
    } catch (error) {
      console.error('[QuotaManager] Token confirmation failed:', error);
      return { success: false, error: error.message };
    }
  }

  confirmLocalToken(token, success) {
    const tokenData = this.localTokens.get(token);

    if (!tokenData) {
      return { success: false, error: 'Token not found' };
    }

    // Check expiry
    if (Date.now() > tokenData.expiresAt) {
      this.localTokens.delete(token);
      return { success: false, error: 'Token expired' };
    }

    // Update count on success
    if (success) {
      this.localPostCount++;
    }

    this.localTokens.delete(token);
    return { success: true };
  }

  // Check feature access
  async hasFeatureAccess(feature) {
    if (!supabaseClient.isAuthenticated()) {
      // Free tier defaults
      const freeFeatures = ['post']; // Basic posting is always available
      return freeFeatures.includes(feature);
    }

    return supabaseClient.checkFeatureAccess(feature);
  }

  // Get full quota status for UI
  async getQuotaStatus() {
    const quota = await this.getQuota();
    const limits = await this.getTierLimits();

    let subscriptionInfo = { subscription_tier: 'free' };
    const isAuth = supabaseClient.isAuthenticated();
    console.log('[QuotaManager] getQuotaStatus: isAuthenticated =', isAuth);

    if (isAuth) {
      const info = await supabaseClient.getSubscriptionInfo();
      console.log('[QuotaManager] getQuotaStatus: subscriptionInfo =', JSON.stringify(info));
      if (info) {
        subscriptionInfo = info;
      }
    }

    const currentTier = subscriptionInfo?.subscription_tier || 'free';
    console.log('[QuotaManager] getQuotaStatus: currentTier =', currentTier);
    const tierLimit = limits.find(l => l.tier === currentTier) || limits[0] || this.getDefaultTierLimit();

    return {
      authenticated: supabaseClient.isAuthenticated(),
      tier: currentTier,
      quota: {
        posts: {
          used: quota.posts_used,
          limit: quota.posts_limit,
          remaining: Math.max(0, quota.posts_limit - quota.posts_used)
        },
        replies: {
          used: quota.replies_used || 0,
          limit: quota.replies_limit || 0,
          remaining: Math.max(0, (quota.replies_limit || 0) - (quota.replies_used || 0))
        },
        aiGenerations: {
          used: quota.ai_generations_used,
          limit: quota.ai_generations_limit,
          remaining: Math.max(0, quota.ai_generations_limit - quota.ai_generations_used)
        }
      },
      features: {
        scheduling: tierLimit.has_scheduling,
        aiGeneration: tierLimit.has_ai_generation,
        knowledgeBase: tierLimit.has_knowledge_base,
        trackedAccounts: tierLimit.max_tracked_accounts > 0,
        maxTrackedAccounts: tierLimit.max_tracked_accounts,
        interestTopics: tierLimit.max_interest_topics > 0,
        maxInterestTopics: tierLimit.max_interest_topics,
        maxSocialAccounts: tierLimit.max_social_accounts,
        replies: (tierLimit.daily_replies || 0) > 0,
        dailyReplies: tierLimit.daily_replies || 0
      },
      subscription: subscriptionInfo
    };
  }

  // Initialize IPC handlers
  initIPCHandlers() {
    // Get quota status
    ipcMain.handle('quota:getStatus', async () => {
      return this.getQuotaStatus();
    });

    // Check if can post
    ipcMain.handle('quota:canPost', async () => {
      return this.canPost();
    });

    // Get remaining posts
    ipcMain.handle('quota:getRemainingPosts', async () => {
      return this.getRemainingPosts();
    });

    // Request post token
    ipcMain.handle('quota:requestToken', async (event, { platform, content }) => {
      return this.requestPostToken(platform, content);
    });

    // Confirm token usage
    ipcMain.handle('quota:confirmToken', async (event, { token, success, platformPostId, errorMessage }) => {
      return this.confirmPostToken(token, success, platformPostId, errorMessage);
    });

    // Check feature access
    ipcMain.handle('quota:hasFeature', async (event, feature) => {
      return this.hasFeatureAccess(feature);
    });

    // Get tier limits
    ipcMain.handle('quota:getTierLimits', async () => {
      return this.getTierLimits();
    });

    // Refresh quota (force)
    ipcMain.handle('quota:refresh', async () => {
      return this.getQuota(true);
    });
  }
}

module.exports = new QuotaManager();
