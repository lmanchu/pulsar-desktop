/**
 * WebLLM Engine - Runs in renderer process with WebGPU
 * Loads from CDN since renderer is sandboxed
 */

let webllm = null;
let engine = null;
let currentModelId = null;
let isLoading = false;

/**
 * Load WebLLM library from CDN
 */
async function loadWebLLM() {
  if (webllm) return webllm;

  console.log('[WebLLM] Loading library from CDN...');
  // Use unpkg with explicit bundle for better compatibility
  webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.78/+esm');
  console.log('[WebLLM] Library loaded');
  return webllm;
}

/**
 * Initialize WebLLM engine with a model
 */
async function initWebLLM(modelId, onProgress) {
  if (isLoading) {
    throw new Error('Already loading a model');
  }

  isLoading = true;

  try {
    // Load library first
    const lib = await loadWebLLM();

    console.log('[WebLLM] Initializing with model:', modelId);

    // Create engine with progress callback
    engine = await lib.CreateMLCEngine(modelId, {
      initProgressCallback: (progress) => {
        const pct = Math.round(progress.progress * 100);
        console.log(`[WebLLM] ${pct}% - ${progress.text}`);
        if (onProgress) {
          onProgress({
            progress: progress.progress,
            text: progress.text
          });
        }
      }
    });

    currentModelId = modelId;
    isLoading = false;

    console.log('[WebLLM] Engine ready');
    return { success: true, model: modelId };

  } catch (error) {
    isLoading = false;
    console.error('[WebLLM] Init error:', error);
    throw error;
  }
}

/**
 * Generate text with WebLLM
 */
async function generateWithWebLLM(prompt, options = {}) {
  if (!engine) {
    throw new Error('WebLLM engine not initialized');
  }

  const {
    maxTokens = 500,
    temperature = 0.7,
    systemPrompt = 'You are a helpful social media content assistant. Be concise and engaging.'
  } = options;

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    console.log('[WebLLM] Generating...');
    const response = await engine.chat.completions.create({
      messages,
      max_tokens: maxTokens,
      temperature
    });

    const text = response.choices[0].message.content;
    console.log('[WebLLM] Generated:', text.slice(0, 100) + '...');

    return {
      success: true,
      text,
      usage: response.usage
    };

  } catch (error) {
    console.error('[WebLLM] Generate error:', error);
    throw error;
  }
}

/**
 * Check if WebLLM is ready
 */
function isWebLLMReady() {
  return engine !== null && !isLoading;
}

/**
 * Get current model ID
 */
function getWebLLMModel() {
  return currentModelId;
}

/**
 * Check if currently loading
 */
function isWebLLMLoading() {
  return isLoading;
}

/**
 * Unload the current model
 */
async function unloadWebLLM() {
  if (engine) {
    try {
      await engine.unload();
    } catch (e) {
      console.warn('[WebLLM] Unload warning:', e);
    }
    engine = null;
    currentModelId = null;
  }
}

// Export to window for use in renderer
window.webllmEngine = {
  init: initWebLLM,
  generate: generateWithWebLLM,
  isReady: isWebLLMReady,
  isLoading: isWebLLMLoading,
  getModel: getWebLLMModel,
  unload: unloadWebLLM
};

console.log('[WebLLM] Engine module loaded');
