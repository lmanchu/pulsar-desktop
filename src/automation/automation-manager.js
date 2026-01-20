/**
 * Pulsar Automation Manager
 * Manages automated posting rules and engagement
 *
 * Types of automations:
 * 1. recurring - Post at fixed intervals (daily, weekly)
 * 2. engagement - Auto-reply to tracked accounts or topic search
 *    - engagement_tracked: Reply to tracked accounts' posts
 *    - engagement_topic: Search topics and reply to relevant posts
 * 3. queue - AI-generated content queue with auto-posting
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class AutomationManager {
  constructor() {
    this.automations = [];
    this.dataPath = path.join(app.getPath('userData'), 'automations.json');
    this.replyHistoryPath = path.join(app.getPath('userData'), 'reply-history.json');
    this.replyHistory = new Set(); // Set of replied post URLs/IDs
    this.checkInterval = null;
    this.aiProvider = null;
    this.trackedAccountsManager = null;
    this.scheduler = null;
    this.onExecutePost = null;
    this.onExecuteEngagement = null; // Callback for browser automation
    this.onNotify = null;
  }

  /**
   * Initialize the automation manager
   */
  init(options = {}) {
    this.aiProvider = options.aiProvider;
    this.trackedAccountsManager = options.trackedAccountsManager;
    this.scheduler = options.scheduler;
    this.onExecutePost = options.onExecutePost;
    this.onExecuteEngagement = options.onExecuteEngagement; // For browser automation
    this.onNotify = options.onNotify;

    this.loadAutomations();
    this.loadReplyHistory();
    this.startChecking();
    console.log('[Automation] Initialized with', this.automations.length, 'rules');
  }

  /**
   * Load reply history from disk
   */
  loadReplyHistory() {
    try {
      if (fs.existsSync(this.replyHistoryPath)) {
        const data = fs.readFileSync(this.replyHistoryPath, 'utf8');
        const parsed = JSON.parse(data);
        // Keep only last 7 days of history
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recentHistory = parsed.filter(item => item.timestamp > cutoff);
        this.replyHistory = new Set(recentHistory.map(item => item.postId));
        console.log('[Automation] Loaded', this.replyHistory.size, 'reply history entries');
      }
    } catch (error) {
      console.error('[Automation] Failed to load reply history:', error);
      this.replyHistory = new Set();
    }
  }

  /**
   * Save reply history to disk
   */
  saveReplyHistory() {
    try {
      const historyArray = Array.from(this.replyHistory).map(postId => ({
        postId,
        timestamp: Date.now()
      }));
      fs.writeFileSync(this.replyHistoryPath, JSON.stringify(historyArray, null, 2));
    } catch (error) {
      console.error('[Automation] Failed to save reply history:', error);
    }
  }

  /**
   * Check if we've already replied to a post
   */
  hasReplied(postId) {
    return this.replyHistory.has(postId);
  }

  /**
   * Mark a post as replied
   */
  markAsReplied(postId) {
    this.replyHistory.add(postId);
    this.saveReplyHistory();
  }

  /**
   * Load automations from disk
   */
  loadAutomations() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf8');
        this.automations = JSON.parse(data);
      }
    } catch (error) {
      console.error('[Automation] Failed to load:', error);
      this.automations = [];
    }
  }

  /**
   * Save automations to disk
   */
  saveAutomations() {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.automations, null, 2));
    } catch (error) {
      console.error('[Automation] Failed to save:', error);
    }
  }

  /**
   * Add a new automation rule
   * @param {Object} automation
   * @param {string} automation.type - 'recurring' | 'engagement' | 'queue'
   * @param {string} automation.name - User-friendly name
   * @param {string} automation.platform - 'twitter' | 'linkedin' | 'threads'
   * @param {boolean} automation.enabled - Whether the automation is active
   * @param {Object} automation.config - Type-specific configuration
   */
  addAutomation(automation) {
    const newAutomation = {
      id: `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: automation.type,
      name: automation.name || this.getDefaultName(automation.type),
      platform: automation.platform || 'twitter',
      enabled: automation.enabled !== false,
      config: automation.config || {},
      stats: {
        totalRuns: 0,
        successfulPosts: 0,
        lastRunAt: null,
        nextRunAt: this.calculateNextRun(automation)
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.automations.push(newAutomation);
    this.saveAutomations();
    console.log('[Automation] Added:', newAutomation.id, newAutomation.type);

    return newAutomation;
  }

  /**
   * Get default name for automation type
   */
  getDefaultName(type) {
    const names = {
      recurring: '定時發文 Daily Post',
      engagement: '自動互動 Auto Engagement',
      queue: '內容佇列 Content Queue'
    };
    return names[type] || 'Automation';
  }

  /**
   * Update an automation
   */
  updateAutomation(id, updates) {
    const automation = this.automations.find(a => a.id === id);
    if (automation) {
      Object.assign(automation, updates, { updatedAt: Date.now() });
      if (updates.config || updates.enabled !== undefined) {
        automation.stats.nextRunAt = this.calculateNextRun(automation);
      }
      this.saveAutomations();
    }
    return automation;
  }

  /**
   * Delete an automation
   */
  deleteAutomation(id) {
    this.automations = this.automations.filter(a => a.id !== id);
    this.saveAutomations();
  }

  /**
   * Get all automations
   */
  getAutomations() {
    return this.automations;
  }

  /**
   * Get automation by ID
   */
  getAutomation(id) {
    return this.automations.find(a => a.id === id);
  }

  /**
   * Toggle automation enabled/disabled
   */
  toggleAutomation(id, enabled) {
    return this.updateAutomation(id, { enabled });
  }

  /**
   * Calculate next run time for an automation
   */
  calculateNextRun(automation) {
    if (!automation.enabled) return null;

    const now = new Date();
    const config = automation.config || {};

    switch (automation.type) {
      case 'recurring': {
        // config: { frequency: 'daily'|'weekly', time: '09:00', dayOfWeek: 0-6 }
        const [hours, minutes] = (config.time || '09:00').split(':').map(Number);
        let nextRun = new Date(now);
        nextRun.setHours(hours, minutes, 0, 0);

        if (config.frequency === 'weekly') {
          const targetDay = config.dayOfWeek || 1; // Default Monday
          const currentDay = now.getDay();
          let daysUntil = targetDay - currentDay;
          if (daysUntil < 0 || (daysUntil === 0 && nextRun <= now)) {
            daysUntil += 7;
          }
          nextRun.setDate(nextRun.getDate() + daysUntil);
        } else {
          // Daily
          if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
          }
        }

        return nextRun.getTime();
      }

      case 'engagement': {
        // Check every X minutes
        const intervalMinutes = config.checkIntervalMinutes || 60;
        return now.getTime() + intervalMinutes * 60 * 1000;
      }

      case 'queue': {
        // config: { postTimes: ['09:00', '12:00', '18:00'] }
        const postTimes = config.postTimes || ['09:00', '12:00', '18:00'];

        for (const time of postTimes.sort()) {
          const [hours, minutes] = time.split(':').map(Number);
          let nextRun = new Date(now);
          nextRun.setHours(hours, minutes, 0, 0);

          if (nextRun > now) {
            return nextRun.getTime();
          }
        }

        // All times passed today, schedule for first time tomorrow
        const [hours, minutes] = postTimes[0].split(':').map(Number);
        let nextRun = new Date(now);
        nextRun.setDate(nextRun.getDate() + 1);
        nextRun.setHours(hours, minutes, 0, 0);
        return nextRun.getTime();
      }

      default:
        return null;
    }
  }

  /**
   * Start the automation checker
   */
  startChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // Check every minute
    this.checkInterval = setInterval(() => {
      this.checkAndExecute();
    }, 60000);

    // Initial check
    setTimeout(() => this.checkAndExecute(), 5000);
  }

  /**
   * Stop the automation checker
   */
  stopChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for due automations and execute
   */
  async checkAndExecute() {
    const now = Date.now();

    for (const automation of this.automations) {
      if (!automation.enabled) continue;
      if (!automation.stats.nextRunAt) continue;
      if (automation.stats.nextRunAt > now) continue;

      console.log('[Automation] Running:', automation.id, automation.type);

      try {
        await this.executeAutomation(automation);
        automation.stats.totalRuns++;
        automation.stats.lastRunAt = now;
      } catch (error) {
        console.error('[Automation] Error:', automation.id, error);
      }

      // Calculate next run
      automation.stats.nextRunAt = this.calculateNextRun(automation);
      this.saveAutomations();
    }
  }

  /**
   * Execute a specific automation
   */
  async executeAutomation(automation) {
    switch (automation.type) {
      case 'recurring':
        return this.executeRecurring(automation);
      case 'engagement':
        return this.executeEngagement(automation);
      case 'queue':
        return this.executeQueue(automation);
      default:
        console.warn('[Automation] Unknown type:', automation.type);
    }
  }

  /**
   * Execute recurring post automation
   */
  async executeRecurring(automation) {
    const config = automation.config || {};

    if (!this.aiProvider) {
      console.error('[Automation] No AI provider for recurring post');
      return;
    }

    // Generate content using AI
    const topic = config.topic || 'tech industry insights';
    const style = config.style || 'professional';
    const persona = config.persona || null;

    console.log('[Automation] Generating content for topic:', topic);

    try {
      let content;

      if (persona) {
        // Use persona-based generation
        content = await this.aiProvider.generatePost(topic, persona, automation.platform);
      } else {
        // Simple generation
        const prompt = `Generate a ${style} ${automation.platform} post about: ${topic}.
Keep it concise and engaging. Use 1-2 relevant hashtags.
Output only the post content, nothing else.`;

        const result = await this.aiProvider.generate(prompt, { maxTokens: 500 });
        content = result.content || result;
      }

      if (content) {
        // Schedule for immediate posting
        if (this.scheduler) {
          this.scheduler.addJob({
            platform: automation.platform,
            content: content,
            scheduledAt: Date.now(),
            automationId: automation.id
          });
        } else if (this.onExecutePost) {
          await this.onExecutePost(automation.platform, content);
        }

        automation.stats.successfulPosts++;
        console.log('[Automation] Generated and scheduled:', content.substring(0, 50) + '...');

        if (this.onNotify) {
          this.onNotify({
            type: 'automation',
            title: '自動發文已排程',
            message: `${automation.name}: ${content.substring(0, 50)}...`
          });
        }
      }
    } catch (error) {
      console.error('[Automation] Failed to generate content:', error);
      throw error;
    }
  }

  /**
   * Execute engagement automation (auto-reply)
   * Supports two modes:
   * - tracked_accounts: Reply to tracked accounts' posts
   * - topic_search: Search topics and reply to relevant posts
   */
  async executeEngagement(automation) {
    const config = automation.config || {};
    const mode = config.engagementMode || 'tracked_accounts';

    if (!this.aiProvider) {
      console.error('[Automation] No AI provider for engagement');
      return;
    }

    if (!this.onExecuteEngagement) {
      console.error('[Automation] No engagement executor callback');
      return;
    }

    console.log('[Automation] Executing engagement mode:', mode);

    if (mode === 'tracked_accounts') {
      await this.executeTrackedAccountsEngagement(automation);
    } else if (mode === 'topic_search') {
      await this.executeTopicSearchEngagement(automation);
    } else {
      console.warn('[Automation] Unknown engagement mode:', mode);
    }
  }

  /**
   * Execute tracked accounts engagement
   * Visit tracked accounts, find recent posts, generate and send replies
   */
  async executeTrackedAccountsEngagement(automation) {
    const config = automation.config || {};

    if (!this.trackedAccountsManager) {
      console.error('[Automation] No tracked accounts manager');
      return;
    }

    const maxReplies = config.maxRepliesPerRun || 3;
    const priorityTiers = config.priorityTiers || [1, 2, 3]; // Prefer higher tiers
    const usePersona = config.usePersona !== false;

    // Get accounts by tier priority
    let accounts = [];
    for (const tier of priorityTiers) {
      const tierAccounts = await this.trackedAccountsManager.getAccountsByTier(tier);
      accounts = accounts.concat(tierAccounts.filter(a => a.enabled));
      if (accounts.length >= maxReplies * 2) break; // Get enough candidates
    }

    // Shuffle and limit
    accounts = accounts.sort(() => Math.random() - 0.5).slice(0, maxReplies * 2);

    console.log('[Automation] Checking', accounts.length, 'tracked accounts for engagement');

    let successCount = 0;

    for (const account of accounts) {
      if (successCount >= maxReplies) break;

      try {
        // Use browser automation to find and reply to posts
        const result = await this.onExecuteEngagement({
          type: 'tracked_account',
          username: account.username,
          aiProvider: this.aiProvider,
          usePersona,
          persona: config.persona,
          platform: automation.platform,
          checkReplied: (postId) => this.hasReplied(postId),
          markReplied: (postId) => this.markAsReplied(postId)
        });

        if (result && result.success) {
          successCount++;
          automation.stats.successfulPosts = (automation.stats.successfulPosts || 0) + 1;
          console.log('[Automation] Replied to', account.username);

          if (this.onNotify) {
            this.onNotify({
              type: 'engagement',
              title: '自動回覆成功',
              message: `已回覆 @${account.username} 的貼文`
            });
          }
        }
      } catch (error) {
        console.error('[Automation] Failed to engage with', account.username, error.message);
      }

      // Rate limiting - wait between engagements
      await new Promise(r => setTimeout(r, 5000));
    }

    console.log('[Automation] Tracked accounts engagement complete:', successCount, 'replies');
  }

  /**
   * Execute topic search engagement
   * Search for topics, find relevant posts, generate and send replies
   */
  async executeTopicSearchEngagement(automation) {
    const config = automation.config || {};

    const topics = config.searchTopics || config.topics || ['AI', 'startups'];
    const maxReplies = config.maxRepliesPerTopic || config.maxRepliesPerRun || 3;
    const usePersona = config.usePersona !== false;

    console.log('[Automation] Searching topics:', topics.join(', '), '| maxReplies:', maxReplies);

    let successCount = 0;

    for (const topic of topics) {
      if (successCount >= maxReplies) break;

      try {
        // Use browser automation to search and reply
        const result = await this.onExecuteEngagement({
          type: 'topic_search',
          searchQuery: topic,
          maxResults: Math.min(5, maxReplies - successCount),
          aiProvider: this.aiProvider,
          usePersona,
          persona: config.persona,
          platform: automation.platform,
          checkReplied: (postId) => this.hasReplied(postId),
          markReplied: (postId) => this.markAsReplied(postId)
        });

        if (result && result.repliesCount > 0) {
          successCount += result.repliesCount;
          automation.stats.successfulPosts = (automation.stats.successfulPosts || 0) + result.repliesCount;
          console.log('[Automation] Replied to', result.repliesCount, 'posts about:', topic);

          if (this.onNotify) {
            this.onNotify({
              type: 'engagement',
              title: '主題回覆成功',
              message: `已回覆 ${result.repliesCount} 則關於「${topic}」的貼文`
            });
          }
        }
      } catch (error) {
        console.error('[Automation] Failed to search topic:', topic, error.message);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log('[Automation] Topic search engagement complete:', successCount, 'replies');
  }

  /**
   * Execute content queue automation
   */
  async executeQueue(automation) {
    const config = automation.config || {};

    // Check if there's content in the queue
    if (!config.queue || config.queue.length === 0) {
      console.log('[Automation] Queue is empty, generating new content...');

      // Auto-generate new content if enabled
      if (config.autoGenerate && this.aiProvider) {
        const topic = config.defaultTopic || 'tech';
        const prompt = `Generate a ${automation.platform} post about: ${topic}.
Keep it concise and engaging. Use 1-2 relevant hashtags.
Output only the post content, nothing else.`;

        try {
          const result = await this.aiProvider.generate(prompt, { maxTokens: 500 });
          const content = result.content || result;

          if (!config.queue) config.queue = [];
          config.queue.push({
            content,
            generatedAt: Date.now()
          });

          this.saveAutomations();
        } catch (error) {
          console.error('[Automation] Failed to generate queue content:', error);
          return;
        }
      } else {
        return; // Nothing to post
      }
    }

    // Get next item from queue
    const item = config.queue.shift();
    this.saveAutomations();

    if (item && item.content) {
      // Schedule for immediate posting
      if (this.scheduler) {
        this.scheduler.addJob({
          platform: automation.platform,
          content: item.content,
          scheduledAt: Date.now(),
          automationId: automation.id
        });
      } else if (this.onExecutePost) {
        await this.onExecutePost(automation.platform, item.content);
      }

      automation.stats.successfulPosts++;
      console.log('[Automation] Posted from queue:', item.content.substring(0, 50) + '...');

      if (this.onNotify) {
        this.onNotify({
          type: 'automation',
          title: '佇列發文已排程',
          message: `${automation.name}: ${item.content.substring(0, 50)}...`
        });
      }
    }
  }

  /**
   * Add content to a queue automation
   */
  addToQueue(automationId, content) {
    const automation = this.automations.find(a => a.id === automationId && a.type === 'queue');
    if (!automation) return null;

    if (!automation.config.queue) {
      automation.config.queue = [];
    }

    automation.config.queue.push({
      content,
      addedAt: Date.now()
    });

    this.saveAutomations();
    return automation;
  }

  /**
   * Get queue contents for an automation
   */
  getQueueContents(automationId) {
    const automation = this.automations.find(a => a.id === automationId);
    if (!automation || automation.type !== 'queue') return [];
    return automation.config.queue || [];
  }

  /**
   * Manually trigger an automation
   */
  async triggerNow(id) {
    const automation = this.automations.find(a => a.id === id);
    if (!automation) {
      throw new Error('Automation not found');
    }

    console.log('[Automation] Manual trigger:', automation.id);
    await this.executeAutomation(automation);

    automation.stats.totalRuns++;
    automation.stats.lastRunAt = Date.now();
    automation.stats.nextRunAt = this.calculateNextRun(automation);
    this.saveAutomations();

    return automation;
  }

  /**
   * Get automation statistics
   */
  getStats() {
    return {
      total: this.automations.length,
      enabled: this.automations.filter(a => a.enabled).length,
      disabled: this.automations.filter(a => !a.enabled).length,
      byType: {
        recurring: this.automations.filter(a => a.type === 'recurring').length,
        engagement: this.automations.filter(a => a.type === 'engagement').length,
        queue: this.automations.filter(a => a.type === 'queue').length
      },
      totalPosts: this.automations.reduce((sum, a) => sum + (a.stats?.successfulPosts || 0), 0)
    };
  }
}

module.exports = new AutomationManager();
