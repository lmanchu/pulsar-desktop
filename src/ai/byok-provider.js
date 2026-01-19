/**
 * BYOK Provider - Bring Your Own Key
 *
 * Supports multiple AI services:
 * - OpenAI (GPT-4o, GPT-4o-mini)
 * - Anthropic (Claude)
 * - Google Gemini
 * - OpenRouter (many models, some free)
 */

class BYOKProvider {
  constructor() {
    this.ready = false;
    this.service = null;
    this.apiKey = null;
    this.model = null;
  }

  async initialize(config) {
    if (!config?.service || !config?.apiKey) {
      return { success: false, error: 'BYOK requires service and API key' };
    }

    this.service = config.service;
    this.apiKey = config.apiKey;
    this.model = config.model || this.getDefaultModel(config.service);

    // Test the connection
    const testResult = await this.testConnection(this.service, this.apiKey, this.model);
    if (!testResult.success) {
      return testResult;
    }

    this.ready = true;
    console.log(`[BYOK] Initialized with ${this.service}/${this.model}`);
    return { success: true, ready: true };
  }

  isReady() {
    return this.ready;
  }

  getDefaultModel(service) {
    const defaults = {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-haiku-20240307',
      gemini: 'gemini-1.5-flash',
      openrouter: 'meta-llama/llama-3.1-8b-instruct:free'
    };
    return defaults[service] || 'gpt-4o-mini';
  }

  // ============================================
  // API Endpoints
  // ============================================

  getEndpoint(service) {
    const endpoints = {
      openai: 'https://api.openai.com/v1/chat/completions',
      anthropic: 'https://api.anthropic.com/v1/messages',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions'
    };
    return endpoints[service];
  }

  // ============================================
  // Connection Test
  // ============================================

  async testConnection(service, apiKey, model) {
    try {
      const testPrompt = 'Say "OK" and nothing else.';
      const result = await this.makeRequest(service, apiKey, model, testPrompt, { maxTokens: 10 });
      return { success: true, response: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Generation
  // ============================================

  async generate(prompt, options = {}) {
    if (!this.ready) {
      throw new Error('BYOK provider not initialized');
    }

    const result = await this.makeRequest(
      this.service,
      this.apiKey,
      this.model,
      prompt,
      options
    );

    return {
      text: result,
      model: this.model,
      provider: this.service
    };
  }

  async makeRequest(service, apiKey, model, prompt, options = {}) {
    const maxTokens = options.maxTokens || 500;
    const temperature = options.temperature || 0.7;

    switch (service) {
      case 'openai':
        return this.requestOpenAI(apiKey, model, prompt, maxTokens, temperature);
      case 'anthropic':
        return this.requestAnthropic(apiKey, model, prompt, maxTokens, temperature);
      case 'gemini':
        return this.requestGemini(apiKey, model, prompt, maxTokens, temperature);
      case 'openrouter':
        return this.requestOpenRouter(apiKey, model, prompt, maxTokens, temperature);
      default:
        throw new Error(`Unknown service: ${service}`);
    }
  }

  // ============================================
  // Service-specific Implementations
  // ============================================

  async requestOpenAI(apiKey, model, prompt, maxTokens, temperature) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async requestAnthropic(apiKey, model, prompt, maxTokens, temperature) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
  }

  async requestGemini(apiKey, model, prompt, maxTokens, temperature) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature
        }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  async requestOpenRouter(apiKey, model, prompt, maxTokens, temperature) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://pulsar.irisgo.ai',
        'X-Title': 'Pulsar Desktop'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  // ============================================
  // Available Services & Models
  // ============================================

  static getServices() {
    return [
      {
        id: 'openai',
        name: 'OpenAI',
        description: 'GPT-4o and GPT-4o-mini',
        keyUrl: 'https://platform.openai.com/api-keys',
        models: [
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', cost: '$0.15/1M tokens', recommended: true },
          { id: 'gpt-4o', name: 'GPT-4o', cost: '$2.50/1M tokens' },
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', cost: '$0.50/1M tokens' }
        ]
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        description: 'Claude models',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        models: [
          { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', cost: '$0.25/1M tokens', recommended: true },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', cost: '$3/1M tokens' }
        ]
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        description: 'Gemini 1.5 models',
        keyUrl: 'https://aistudio.google.com/app/apikey',
        models: [
          { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', cost: '$0.075/1M tokens', recommended: true },
          { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', cost: '$1.25/1M tokens' }
        ]
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        description: 'Many models, some free',
        keyUrl: 'https://openrouter.ai/keys',
        models: [
          { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (Free)', cost: 'Free', recommended: true },
          { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B (Free)', cost: 'Free' },
          { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (Free)', cost: 'Free' }
        ]
      }
    ];
  }
}

module.exports = BYOKProvider;
