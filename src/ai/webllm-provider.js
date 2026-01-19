/**
 * WebLLM Provider - Local LLM using WebGPU
 *
 * Note: WebLLM runs in the renderer process (requires WebGPU).
 * This module manages configuration and state tracking.
 * Actual inference is done in renderer via webllm-engine.js
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class WebLLMProvider {
  constructor() {
    this.ready = false;
    this.currentModel = null;
    this.downloadProgress = 0;
    this.modelCachePath = path.join(app.getPath('userData'), 'webllm-cache');

    // Ensure cache directory exists
    if (!fs.existsSync(this.modelCachePath)) {
      fs.mkdirSync(this.modelCachePath, { recursive: true });
    }
  }

  async initialize(config) {
    this.currentModel = config?.model || 'Qwen2.5-3B-Instruct-q4f16_1-MLC';

    // Check if model is downloaded
    const modelPath = path.join(this.modelCachePath, this.currentModel);
    const isDownloaded = fs.existsSync(modelPath);

    if (isDownloaded) {
      this.ready = true;
      console.log(`[WebLLM] Model ${this.currentModel} ready`);
      return { success: true, ready: true };
    }

    // Model not downloaded - UI will trigger download
    console.log(`[WebLLM] Model ${this.currentModel} not downloaded`);
    return {
      success: true,
      ready: false,
      needsDownload: true,
      model: this.currentModel
    };
  }

  isReady() {
    return this.ready;
  }

  setReady(ready) {
    this.ready = ready;
  }

  getCurrentModel() {
    return this.currentModel;
  }

  getDownloadProgress() {
    return this.downloadProgress;
  }

  setDownloadProgress(progress) {
    this.downloadProgress = progress;
  }

  markModelDownloaded(modelId) {
    const modelPath = path.join(this.modelCachePath, modelId);
    if (!fs.existsSync(modelPath)) {
      fs.mkdirSync(modelPath, { recursive: true });
      fs.writeFileSync(path.join(modelPath, '.downloaded'), new Date().toISOString());
    }
    this.ready = true;
  }

  isModelDownloaded(modelId) {
    const modelPath = path.join(this.modelCachePath, modelId);
    return fs.existsSync(path.join(modelPath, '.downloaded'));
  }

  getModelCachePath() {
    return this.modelCachePath;
  }

  // Actual generation is done in renderer - this is a placeholder
  async generate(prompt, options = {}) {
    // This should not be called - generation happens in renderer
    throw new Error('WebLLM generation must be called from renderer process');
  }

  // Model info for UI
  static getAvailableModels() {
    return [
      {
        id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 3B',
        size: '2.1GB',
        vram: '3GB',
        description: 'Best for Chinese & English, balanced performance',
        recommended: true
      },
      {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        name: 'Phi 3.5 Mini',
        size: '2.4GB',
        vram: '3.5GB',
        description: 'Strong reasoning, good for analysis'
      },
      {
        id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
        name: 'SmolLM2 1.7B',
        size: '1.1GB',
        vram: '2GB',
        description: 'Ultra lightweight, fast on lower-end devices'
      },
      {
        id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        name: 'Llama 3.2 3B',
        size: '2.0GB',
        vram: '3GB',
        description: 'Meta\'s efficient small model'
      },
      {
        id: 'gemma-2-2b-it-q4f16_1-MLC',
        name: 'Gemma 2 2B',
        size: '1.5GB',
        vram: '2.5GB',
        description: 'Google\'s lightweight model'
      }
    ];
  }
}

module.exports = WebLLMProvider;
