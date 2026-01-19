const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('pulsar', {
  // Navigation
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  getCurrentUrl: () => ipcRenderer.invoke('getCurrentUrl'),
  refreshBrowserView: () => ipcRenderer.invoke('refreshBrowserView'),

  // Authentication
  checkLoginStatus: (platform) => ipcRenderer.invoke('checkLoginStatus', platform),

  // Twitter actions
  postToTwitter: (content) => ipcRenderer.invoke('postToTwitter', content),

  // Debugging
  getPageContent: () => ipcRenderer.invoke('getPageContent'),

  // Platform shortcuts
  platforms: {
    twitter: 'https://x.com',
    linkedin: 'https://www.linkedin.com',
    threads: 'https://www.threads.net',
    instagram: 'https://www.instagram.com'
  },

  // ============================================
  // Scheduler
  // ============================================

  // Schedule a post for later
  schedulePost: (platform, content, scheduledAt) =>
    ipcRenderer.invoke('schedulePost', { platform, content, scheduledAt }),

  // Get all scheduled jobs
  getScheduledJobs: () => ipcRenderer.invoke('getScheduledJobs'),

  // Get scheduler statistics
  getSchedulerStats: () => ipcRenderer.invoke('getSchedulerStats'),

  // Delete a scheduled job
  deleteScheduledJob: (jobId) => ipcRenderer.invoke('deleteScheduledJob', jobId),

  // Clear completed jobs
  clearCompletedJobs: () => ipcRenderer.invoke('clearCompletedJobs'),

  // Listen for scheduler updates
  onSchedulerUpdate: (callback) => {
    ipcRenderer.on('scheduler-update', (event, jobs) => callback(jobs));
  },

  // ============================================
  // AI Content Generation
  // ============================================

  // Generate content with a prompt
  generateContent: (prompt, options = {}) =>
    ipcRenderer.invoke('generateContent', { prompt, options }),

  // Generate a Twitter thread
  generateThread: (topic, count = 3) =>
    ipcRenderer.invoke('generateThread', { topic, count }),

  // Generate content variations
  generateVariations: (content, count = 3) =>
    ipcRenderer.invoke('generateVariations', { content, count }),

  // Improve existing content
  improveContent: (content, platform = 'twitter') =>
    ipcRenderer.invoke('improveContent', { content, platform }),

  // Check AI service connection
  checkAIConnection: () => ipcRenderer.invoke('checkAIConnection'),

  // Set AI endpoint URL
  setAIEndpoint: (endpoint) => ipcRenderer.invoke('setAIEndpoint', endpoint),

  // Generate with persona context
  generateWithPersona: (prompt, platform, useKnowledge, model) =>
    ipcRenderer.invoke('generateWithPersona', { prompt, platform, useKnowledge, model }),

  // ============================================
  // Persona Builder
  // ============================================

  // Check if persona exists
  personaExists: () => ipcRenderer.invoke('personaExists'),

  // Get persona data
  getPersona: () => ipcRenderer.invoke('getPersona'),

  // Get MBTI questions for quiz
  getMBTIQuestions: () => ipcRenderer.invoke('getMBTIQuestions'),

  // Create persona from MBTI answers
  createPersona: (answers, additionalInfo = {}) =>
    ipcRenderer.invoke('createPersona', { answers, additionalInfo }),

  // Get persona prompt for a platform
  getPersonaPrompt: (platform) => ipcRenderer.invoke('getPersonaPrompt', platform),

  // Delete persona
  deletePersona: () => ipcRenderer.invoke('deletePersona'),

  // Update platform mask customizations
  updatePersonaMask: (platform, customizations) =>
    ipcRenderer.invoke('updatePersonaMask', { platform, customizations }),

  // ============================================
  // Knowledge Base
  // ============================================

  // Get all knowledge documents (with stats)
  getKnowledgeDocuments: () => ipcRenderer.invoke('getKnowledgeDocuments'),

  // Add a knowledge document
  addKnowledgeDocument: (name, content, metadata = {}) =>
    ipcRenderer.invoke('addKnowledgeDocument', { name, content, metadata }),

  // Remove a knowledge document
  removeKnowledgeDocument: (docId) => ipcRenderer.invoke('removeKnowledgeDocument', docId),

  // Search knowledge base
  searchKnowledge: (query, options = {}) =>
    ipcRenderer.invoke('searchKnowledge', { query, options }),

  // Get knowledge context for AI generation
  getKnowledgeContext: (topic, options = {}) =>
    ipcRenderer.invoke('getKnowledgeContext', { topic, options }),

  // Clear all knowledge documents
  clearKnowledgeBase: () => ipcRenderer.invoke('clearKnowledgeBase'),

  // Parse PDF content (returns extracted text)
  parsePDFContent: (uint8Array) => ipcRenderer.invoke('parsePDFContent', uint8Array),

  // ============================================
  // Authentication
  // ============================================

  // Check if authenticated
  isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),

  // Get current user
  getUser: () => ipcRenderer.invoke('auth:getUser'),

  // Get subscription info
  getSubscriptionInfo: () => ipcRenderer.invoke('auth:getSubscriptionInfo'),

  // Login with OAuth provider (google, github)
  login: (provider = 'google') => ipcRenderer.invoke('auth:login', provider),

  // Logout
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Refresh session
  refreshSession: () => ipcRenderer.invoke('auth:refresh'),

  // Configure Supabase (for first-time setup)
  configureSupabase: (url, anonKey) =>
    ipcRenderer.invoke('auth:configure', { url, anonKey }),

  // Check if Supabase is configured
  isSupabaseConfigured: () => ipcRenderer.invoke('auth:isConfigured'),

  // Listen for auth state changes
  onAuthStateChanged: (callback) => {
    ipcRenderer.on('auth-state-changed', (event, data) => callback(data));
  },

  // ============================================
  // Quota Management
  // ============================================

  // Get full quota status (tier, limits, usage)
  getQuotaStatus: () => ipcRenderer.invoke('quota:getStatus'),

  // Check if user can post
  canPost: () => ipcRenderer.invoke('quota:canPost'),

  // Get remaining posts for today
  getRemainingPosts: () => ipcRenderer.invoke('quota:getRemainingPosts'),

  // Request post token (before posting)
  requestPostToken: (platform, content) =>
    ipcRenderer.invoke('quota:requestToken', { platform, content }),

  // Confirm post token usage (after posting)
  confirmPostToken: (token, success, platformPostId = null, errorMessage = null) =>
    ipcRenderer.invoke('quota:confirmToken', { token, success, platformPostId, errorMessage }),

  // Check if feature is available
  hasFeature: (feature) => ipcRenderer.invoke('quota:hasFeature', feature),

  // Get tier limits
  getTierLimits: () => ipcRenderer.invoke('quota:getTierLimits'),

  // Refresh quota (force refresh from server)
  refreshQuota: () => ipcRenderer.invoke('quota:refresh'),

  // ============================================
  // Tracked Accounts
  // ============================================

  // Get all tracked accounts (defaults + custom)
  getTrackedAccounts: () => ipcRenderer.invoke('trackedAccounts:getAll'),

  // Get only enabled tracked accounts
  getEnabledTrackedAccounts: () => ipcRenderer.invoke('trackedAccounts:getEnabled'),

  // Get tracked accounts by tier (1-6)
  getTrackedAccountsByTier: (tier) => ipcRenderer.invoke('trackedAccounts:getByTier', tier),

  // Get tracked accounts by category
  getTrackedAccountsByCategory: (category) =>
    ipcRenderer.invoke('trackedAccounts:getByCategory', category),

  // Search tracked accounts
  searchTrackedAccounts: (query) => ipcRenderer.invoke('trackedAccounts:search', query),

  // Add custom tracked account (Pro only)
  addTrackedAccount: (accountData) => ipcRenderer.invoke('trackedAccounts:add', accountData),

  // Remove tracked account
  removeTrackedAccount: (accountId) => ipcRenderer.invoke('trackedAccounts:remove', accountId),

  // Toggle tracked account enabled/disabled
  toggleTrackedAccount: (accountId, enabled) =>
    ipcRenderer.invoke('trackedAccounts:toggle', { accountId, enabled }),

  // Get tracked accounts stats
  getTrackedAccountsStats: () => ipcRenderer.invoke('trackedAccounts:getStats'),

  // Get random accounts for engagement (weighted by tier)
  getRandomAccountsForEngagement: (count = 5) =>
    ipcRenderer.invoke('trackedAccounts:getRandomForEngagement', count),

  // Refresh tracked accounts cache
  refreshTrackedAccounts: () => ipcRenderer.invoke('trackedAccounts:refresh'),

  // ============================================
  // Subscription / Payment
  // ============================================

  // Create Stripe checkout session (upgrade to Pro)
  createCheckoutSession: () => ipcRenderer.invoke('subscription:createCheckout'),

  // Create Stripe portal session (manage subscription)
  createPortalSession: () => ipcRenderer.invoke('subscription:createPortal'),

  // ============================================
  // AI Provider
  // ============================================

  // Get current AI provider info
  getAIProvider: () => ipcRenderer.invoke('ai:getProvider'),

  // Set AI provider (webllm, byok, cliproxy)
  setAIProvider: (providerType, userTier = 'free') =>
    ipcRenderer.invoke('ai:setProvider', providerType, userTier),

  // Get AI config
  getAIConfig: () => ipcRenderer.invoke('ai:getConfig'),

  // Update provider config
  setAIProviderConfig: (providerType, config) =>
    ipcRenderer.invoke('ai:setProviderConfig', providerType, config),

  // Generate content
  aiGenerate: (prompt, options = {}) =>
    ipcRenderer.invoke('ai:generate', prompt, options),

  // Generate post
  aiGeneratePost: (topic, persona, platform, options = {}) =>
    ipcRenderer.invoke('ai:generatePost', topic, persona, platform, options),

  // Generate reply
  aiGenerateReply: (originalPost, persona, platform, options = {}) =>
    ipcRenderer.invoke('ai:generateReply', originalPost, persona, platform, options),

  // WebLLM specific
  getWebLLMModels: () => ipcRenderer.invoke('ai:getWebLLMModels'),
  downloadWebLLMModel: (modelId) => ipcRenderer.invoke('ai:downloadWebLLMModel', modelId),
  getWebLLMProgress: () => ipcRenderer.invoke('ai:getWebLLMProgress'),

  // Listen for WebLLM download progress
  onWebLLMDownloadProgress: (callback) => {
    ipcRenderer.on('ai:downloadProgress', (event, progress) => callback(progress));
  },

  // BYOK specific
  getBYOKServices: () => ipcRenderer.invoke('ai:getBYOKServices'),
  testBYOKConnection: (service, apiKey, model) =>
    ipcRenderer.invoke('ai:testBYOK', service, apiKey, model),

  // ============================================
  // Smart Engagement
  // ============================================

  // Search Twitter for posts matching interests
  searchTwitterPosts: (interests, audience) =>
    ipcRenderer.invoke('engage:searchTwitter', { interests, audience }),

  // Send reply to a Twitter post
  sendTwitterReply: (postUrl, replyText) =>
    ipcRenderer.invoke('engage:sendReply', { postUrl, replyText }),

  // Get engagement stats
  getEngagementStats: () => ipcRenderer.invoke('engage:getStats'),

  // Save engagement settings (interests, audience)
  saveEngagementSettings: (settings) =>
    ipcRenderer.invoke('engage:saveSettings', settings),

  // Load engagement settings
  loadEngagementSettings: () => ipcRenderer.invoke('engage:loadSettings')
});
