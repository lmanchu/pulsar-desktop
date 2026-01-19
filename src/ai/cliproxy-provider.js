/**
 * CLIProxy Provider - Backend AI Proxy for Pro Users
 *
 * Connects to CLIProxyAPI which provides:
 * - Gemini via OAuth
 * - Claude via Max subscription
 * - Multiple model options
 */

class CLIProxyProvider {
  constructor() {
    this.ready = false;
    this.endpoint = null;
    this.apiKey = null;
    this.model = null;
  }

  async initialize(config) {
    if (!config?.endpoint || !config?.apiKey) {
      return { success: false, error: 'CLIProxy requires endpoint and API key' };
    }

    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-2.0-flash';

    // Test the connection
    const testResult = await this.testConnection();
    if (!testResult.success) {
      return testResult;
    }

    this.ready = true;
    console.log(`[CLIProxy] Initialized with ${this.model}`);
    return { success: true, ready: true };
  }

  isReady() {
    return this.ready;
  }

  // ============================================
  // Connection Test
  // ============================================

  async testConnection() {
    try {
      const response = await fetch(`${this.endpoint}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(`CLIProxy connection failed: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[CLIProxy] Connected, ${data.data?.length || 0} models available`);
      return { success: true, models: data.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Generation
  // ============================================

  async generate(prompt, options = {}) {
    if (!this.ready) {
      throw new Error('CLIProxy provider not initialized');
    }

    const maxTokens = options.maxTokens || 500;
    const temperature = options.temperature || 0.7;

    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `CLIProxy error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;

    return {
      text,
      model: this.model,
      provider: 'cliproxy',
      usage: data.usage
    };
  }

  // ============================================
  // Available Models
  // ============================================

  async getAvailableModels() {
    if (!this.endpoint || !this.apiKey) {
      return [];
    }

    try {
      const response = await fetch(`${this.endpoint}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        return this.getDefaultModels();
      }

      const data = await response.json();
      return data.data || this.getDefaultModels();
    } catch (error) {
      return this.getDefaultModels();
    }
  }

  getDefaultModels() {
    return [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Fast and capable',
        recommended: true
      },
      {
        id: 'gemini-2.0-flash-thinking',
        name: 'Gemini 2.0 Flash Thinking',
        description: 'Extended reasoning'
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Most capable'
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        description: 'Anthropic\'s best'
      }
    ];
  }

  // ============================================
  // Static Configuration
  // ============================================

  static getDefaultConfig() {
    return {
      endpoint: 'http://192.168.1.101:8317',
      apiKey: 'magi-proxy-key-2026',
      model: 'gemini-2.0-flash'
    };
  }
}

module.exports = CLIProxyProvider;
