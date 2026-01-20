/**
 * AI Provider - Unified AI Interface for Pulsar Desktop
 *
 * Supports three modes:
 * - WebLLM: Local 4B SLM (Free tier, privacy-first)
 * - BYOK: Bring Your Own Key (Free tier, flexible)
 * - CLIProxy: Backend AI Proxy (Pro tier)
 */

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

// Provider implementations
const WebLLMProvider = require('./webllm-provider');
const BYOKProvider = require('./byok-provider');
const CLIProxyProvider = require('./cliproxy-provider');

class AIProvider {
  constructor() {
    this.currentProvider = null;
    this.providerType = 'none'; // 'webllm' | 'byok' | 'cliproxy' | 'none'
    this.configPath = path.join(app.getPath('userData'), 'ai-config.json');
    this.config = this.loadConfig();

    // Provider instances
    this.providers = {
      webllm: new WebLLMProvider(),
      byok: new BYOKProvider(),
      cliproxy: new CLIProxyProvider()
    };
  }

  // ============================================
  // Configuration
  // ============================================

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      }
    } catch (error) {
      console.error('[AIProvider] Failed to load config:', error);
    }
    return {
      provider: 'none',
      webllm: {
        model: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
        downloaded: false
      },
      byok: {
        service: 'openai', // 'openai' | 'anthropic' | 'gemini' | 'openrouter'
        apiKey: '',
        model: 'gpt-4o-mini'
      },
      cliproxy: {
        endpoint: 'http://192.168.1.101:8317',
        apiKey: 'magi-proxy-key-2026',
        model: 'gemini-2.0-flash'
      }
    };
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('[AIProvider] Failed to save config:', error);
    }
  }

  getConfig() {
    return this.config;
  }

  setProviderConfig(providerType, config) {
    if (this.config[providerType]) {
      this.config[providerType] = { ...this.config[providerType], ...config };
      this.saveConfig();
    }
  }

  // ============================================
  // Provider Management
  // ============================================

  async setProvider(providerType, userTier = 'free', skipTierCheck = false) {
    // Validate provider based on tier (skip during auto-restore from config)
    if (!skipTierCheck && providerType === 'cliproxy' && userTier !== 'pro') {
      return { success: false, error: 'CLIProxy requires Pro subscription' };
    }

    // Initialize the provider
    const provider = this.providers[providerType];
    if (!provider) {
      return { success: false, error: `Unknown provider: ${providerType}` };
    }

    try {
      const initResult = await provider.initialize(this.config[providerType]);
      if (!initResult.success) {
        return initResult;
      }

      this.currentProvider = provider;
      this.providerType = providerType;
      this.config.provider = providerType;
      this.saveConfig();

      console.log(`[AIProvider] Switched to ${providerType}`);
      return { success: true, provider: providerType };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getCurrentProvider() {
    return {
      type: this.providerType,
      ready: this.currentProvider?.isReady() || false,
      config: this.config[this.providerType] || {}
    };
  }

  // ============================================
  // AI Operations
  // ============================================

  async generate(prompt, options = {}) {
    if (!this.currentProvider || !this.currentProvider.isReady()) {
      return {
        success: false,
        error: 'No AI provider configured. Please set up WebLLM or BYOK in Settings.'
      };
    }

    try {
      const result = await this.currentProvider.generate(prompt, options);
      return { success: true, ...result };
    } catch (error) {
      console.error('[AIProvider] Generation failed:', error);
      return { success: false, error: error.message };
    }
  }

  async generatePost(topic, persona, platform, options = {}) {
    const prompt = this.buildPostPrompt(topic, persona, platform);
    return this.generate(prompt, {
      maxTokens: options.maxTokens || 280,
      temperature: options.temperature || 0.8,
      ...options
    });
  }

  async generateReply(originalPost, persona, platform, options = {}) {
    const prompt = this.buildReplyPrompt(originalPost, persona, platform);
    return this.generate(prompt, {
      maxTokens: options.maxTokens || 200,
      temperature: options.temperature || 0.7,
      ...options
    });
  }

  // ============================================
  // Prompt Building
  // ============================================

  buildPostPrompt(topic, persona, platform) {
    const platformLimits = {
      twitter: 280,
      linkedin: 3000,
      threads: 500
    };
    const limit = platformLimits[platform] || 280;

    let prompt = `You are a social media content creator.`;

    if (persona) {
      prompt += `\n\nPersona: ${persona.name}
Writing style: ${persona.style || 'professional'}
Tone: ${persona.tone || 'friendly'}
Topics of expertise: ${persona.topics?.join(', ') || 'technology'}`;
    }

    prompt += `\n\nWrite a ${platform} post about: ${topic}

Requirements:
- Maximum ${limit} characters
- Engaging and authentic voice
- Include 1-2 relevant hashtags if appropriate
- No emojis unless the persona style calls for them
- Write in the language of the topic (if Chinese topic, write in Chinese)

Output only the post content, nothing else.`;

    return prompt;
  }

  buildReplyPrompt(originalPost, persona, platform) {
    let prompt = `You are responding to a social media post.`;

    if (persona) {
      prompt += `\n\nPersona: ${persona.name}
Writing style: ${persona.style || 'professional'}
Tone: ${persona.tone || 'friendly'}`;
    }

    prompt += `\n\nOriginal post:
"${originalPost}"

Write a thoughtful reply that:
- Is relevant and adds value to the conversation
- Matches the persona's style
- Is concise (under 200 characters preferred)
- Sounds natural and authentic
- Write in the same language as the original post

Output only the reply content, nothing else.`;

    return prompt;
  }

  // ============================================
  // WebLLM Specific
  // ============================================

  async downloadWebLLMModel(modelId, progressCallback) {
    return this.providers.webllm.downloadModel(modelId, progressCallback);
  }

  getWebLLMDownloadProgress() {
    return this.providers.webllm.getDownloadProgress();
  }

  getAvailableWebLLMModels() {
    return [
      {
        id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 3B',
        size: '2.1GB',
        description: 'Best for Chinese & English'
      },
      {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        name: 'Phi 3.5 Mini',
        size: '2.4GB',
        description: 'Strong reasoning'
      },
      {
        id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
        name: 'SmolLM2 1.7B',
        size: '1.1GB',
        description: 'Ultra lightweight'
      },
      {
        id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        name: 'Llama 3.2 3B',
        size: '2.0GB',
        description: 'Meta\'s latest small model'
      }
    ];
  }

  // ============================================
  // BYOK Specific
  // ============================================

  getBYOKServices() {
    return [
      { id: 'openai', name: 'OpenAI', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'] },
      { id: 'anthropic', name: 'Anthropic', models: ['claude-3-haiku-20240307', 'claude-3-sonnet-20240229'] },
      { id: 'gemini', name: 'Google Gemini', models: ['gemini-1.5-flash', 'gemini-1.5-pro'] },
      { id: 'openrouter', name: 'OpenRouter', models: ['meta-llama/llama-3.1-8b-instruct:free', 'google/gemma-2-9b-it:free'] }
    ];
  }

  async testBYOKConnection(service, apiKey, model) {
    return this.providers.byok.testConnection(service, apiKey, model);
  }

  // ============================================
  // IPC Handlers
  // ============================================

  initIPCHandlers() {
    // Get current provider info
    ipcMain.handle('ai:getProvider', () => {
      return this.getCurrentProvider();
    });

    // Set provider
    ipcMain.handle('ai:setProvider', async (event, providerType, userTier) => {
      return this.setProvider(providerType, userTier);
    });

    // Get config
    ipcMain.handle('ai:getConfig', () => {
      return this.getConfig();
    });

    // Update provider config
    ipcMain.handle('ai:setProviderConfig', (event, providerType, config) => {
      this.setProviderConfig(providerType, config);
      return { success: true };
    });

    // Generate content
    ipcMain.handle('ai:generate', async (event, prompt, options) => {
      return this.generate(prompt, options);
    });

    // Generate post
    ipcMain.handle('ai:generatePost', async (event, topic, persona, platform, options) => {
      return this.generatePost(topic, persona, platform, options);
    });

    // Generate reply
    ipcMain.handle('ai:generateReply', async (event, originalPost, persona, platform, options) => {
      return this.generateReply(originalPost, persona, platform, options);
    });

    // WebLLM specific
    ipcMain.handle('ai:getWebLLMModels', () => {
      return this.getAvailableWebLLMModels();
    });

    ipcMain.handle('ai:downloadWebLLMModel', async (event, modelId) => {
      return this.downloadWebLLMModel(modelId, (progress) => {
        event.sender.send('ai:downloadProgress', progress);
      });
    });

    ipcMain.handle('ai:getWebLLMProgress', () => {
      return this.getWebLLMDownloadProgress();
    });

    // BYOK specific
    ipcMain.handle('ai:getBYOKServices', () => {
      return this.getBYOKServices();
    });

    ipcMain.handle('ai:testBYOK', async (event, service, apiKey, model) => {
      return this.testBYOKConnection(service, apiKey, model);
    });
  }

  // ============================================
  // Initialization
  // ============================================

  async initialize() {
    this.initIPCHandlers();

    // Auto-restore last used provider (skip tier check - user already configured it)
    if (this.config.provider && this.config.provider !== 'none') {
      console.log(`[AIProvider] Restoring provider: ${this.config.provider}`);
      await this.setProvider(this.config.provider, 'free', true); // skipTierCheck = true
    }

    console.log('[AIProvider] Initialized');
  }
}

module.exports = new AIProvider();
