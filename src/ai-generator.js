/**
 * Pulsar AI Content Generator
 * Integrates with CLIProxyAPI for AI-powered content generation
 */

const https = require('https');
const http = require('http');

class AIGenerator {
  constructor() {
    // CLIProxyAPI endpoint - can be configured
    this.apiEndpoint = 'http://100.80.244.106:8317';
    this.defaultModel = 'gemini-2.0-flash-free';
    this.apiKey = 'magi-proxy-key-2026'; // CLIProxyAPI authentication key
  }

  // Configure the API endpoint
  setEndpoint(endpoint) {
    this.apiEndpoint = endpoint;
  }

  // Set API key
  setApiKey(key) {
    this.apiKey = key;
  }

  // Set default model
  setModel(model) {
    this.defaultModel = model;
  }

  // Generate content using CLIProxyAPI
  async generate(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const maxTokens = options.maxTokens || 500;

    // Use custom system prompt if provided, otherwise use default
    const defaultSystemPrompt = `You are a social media content creator. Create engaging, concise content suitable for social media posts.
Keep responses under 280 characters for Twitter unless specifically asked for longer content.
Be creative, engaging, and authentic. Avoid hashtag spam - use 0-2 relevant hashtags maximum.
Write in the same language as the user's prompt.`;

    const systemPrompt = options.systemPrompt || defaultSystemPrompt;

    console.log('[AIGenerator] Generating content with model:', model);

    try {
      const response = await this.callAPI('/v1/chat/completions', {
        model: model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: 0.8
      });

      if (response.choices && response.choices.length > 0) {
        const content = response.choices[0].message.content.trim();
        console.log('[AIGenerator] Generated content:', content.substring(0, 50) + '...');
        return {
          success: true,
          content: content,
          model: model
        };
      } else {
        return {
          success: false,
          error: 'No content generated'
        };
      }
    } catch (error) {
      console.error('[AIGenerator] Generation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate Twitter thread
  async generateThread(topic, threadCount = 3) {
    const prompt = `Create a Twitter thread with ${threadCount} tweets about: ${topic}

Format each tweet on a new line, numbered 1/, 2/, etc.
Each tweet should be under 280 characters.
Make the first tweet attention-grabbing.
End with a call-to-action or thought-provoking question.`;

    return this.generate(prompt, { maxTokens: 1000 });
  }

  // Generate content variations
  async generateVariations(content, count = 3) {
    const prompt = `Create ${count} different variations of this social media post, each with a different tone/style:

Original: "${content}"

Provide ${count} variations:
1. Professional/Formal
2. Casual/Friendly
3. Engaging/Question-based

Each variation should convey the same message but differently.`;

    return this.generate(prompt, { maxTokens: 800 });
  }

  // Improve existing content
  async improveContent(content, platform = 'twitter') {
    const prompt = `Improve this ${platform} post to be more engaging and effective:

Original: "${content}"

Make it:
- More attention-grabbing
- Better structured
- More likely to get engagement
- Appropriate length for ${platform}

Just provide the improved version, no explanations.`;

    return this.generate(prompt, { maxTokens: 400 });
  }

  // Call CLIProxyAPI
  async callAPI(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.apiEndpoint);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const headers = {
        'Content-Type': 'application/json'
      };

      // Add API key if configured
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: headers,
        // Skip SSL verification for local/tailscale endpoints
        rejectUnauthorized: false
      };

      const req = lib.request(options, (res) => {
        let data = '';

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(json.error?.message || `API error: ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data.substring(0, 100)}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  // Check if API is available
  async checkConnection() {
    try {
      const response = await this.callAPI('/v1/models', {});
      return { success: true, models: response.data };
    } catch (error) {
      // Try a simple health check
      try {
        const url = new URL('/health', this.apiEndpoint);
        return new Promise((resolve) => {
          const lib = url.protocol === 'https:' ? https : http;
          const req = lib.get(url, { rejectUnauthorized: false }, (res) => {
            resolve({ success: res.statusCode === 200 });
          });
          req.on('error', () => resolve({ success: false, error: 'Connection failed' }));
          req.setTimeout(5000, () => {
            req.destroy();
            resolve({ success: false, error: 'Timeout' });
          });
        });
      } catch (e) {
        return { success: false, error: error.message };
      }
    }
  }
}

module.exports = new AIGenerator();
