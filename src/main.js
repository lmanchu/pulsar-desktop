const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');
const puppeteer = require('puppeteer-core');
const scheduler = require('./scheduler');
const aiGenerator = require('./ai-generator');
const personaBuilder = require('./persona-builder');
const knowledgeBase = require('./knowledge-base');

// Payment & Auth System
const authManager = require('./auth/auth-manager');
const quotaManager = require('./quota/quota-manager');
const trackedAccountsManager = require('./tracked-accounts/tracked-accounts-manager');
const subscriptionManager = require('./subscription/subscription-manager');

// AI Provider System
const aiProvider = require('./ai/ai-provider');

let mainWindow;
let browserView;
let browser; // Puppeteer browser instance

// Get the path to Electron's Chromium
function getChromiumPath() {
  // In production, use the bundled Chromium
  // In development, we'll connect to the BrowserView directly
  return app.getPath('exe');
}

async function createWindow() {
  // Create the main window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Set dock icon explicitly for macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, '..', 'assets', 'icon.png'));
  }

  // Create BrowserView for social media browsing
  browserView = new BrowserView({
    webPreferences: {
      // Allow the social media sites to work normally
      contextIsolation: true,
      nodeIntegration: false,
      // Persist session data
      partition: 'persist:pulsar'
    }
  });

  mainWindow.setBrowserView(browserView);

  // Position the BrowserView (leave space for control panel on left)
  const bounds = mainWindow.getBounds();
  browserView.setBounds({
    x: 300,  // Control panel width
    y: 0,
    width: bounds.width - 300,
    height: bounds.height
  });
  browserView.setAutoResize({ width: true, height: true });

  // Load the control panel UI
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Load Twitter by default in BrowserView
  browserView.webContents.loadURL('https://x.com');

  // Handle BrowserView load errors
  browserView.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Pulsar] BrowserView load failed:', errorCode, errorDescription, validatedURL);
  });

  browserView.webContents.on('did-finish-load', () => {
    console.log('[Pulsar] BrowserView loaded:', browserView.webContents.getURL());
  });

  // Handle window resize
  mainWindow.on('resize', () => {
    const newBounds = mainWindow.getBounds();
    browserView.setBounds({
      x: 300,
      y: 0,
      width: newBounds.width - 300,
      height: newBounds.height
    });
  });

  // Open DevTools in development mode only
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Add keyboard shortcut for DevTools (Cmd+Option+I on Mac)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.alt && input.key === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// Connect puppeteer to the BrowserView's debugger
async function connectPuppeteer() {
  try {
    // Get the debugging port from the BrowserView
    const debuggerUrl = browserView.webContents.debugger;

    // Enable CDP
    browserView.webContents.debugger.attach('1.3');

    console.log('[Pulsar] CDP debugger attached to BrowserView');
    return true;
  } catch (error) {
    console.error('[Pulsar] Failed to attach debugger:', error);
    return false;
  }
}

// Execute CDP command directly on the BrowserView
async function executeCDP(method, params = {}) {
  try {
    const result = await browserView.webContents.debugger.sendCommand(method, params);
    return result;
  } catch (error) {
    console.error(`[Pulsar] CDP command ${method} failed:`, error);
    throw error;
  }
}

// Navigate to a URL
ipcMain.handle('navigate', async (event, url) => {
  console.log('[Pulsar] Navigating to:', url);
  await browserView.webContents.loadURL(url);
  return { success: true };
});

// Get current URL
ipcMain.handle('getCurrentUrl', async () => {
  return browserView.webContents.getURL();
});

// Refresh BrowserView
ipcMain.handle('refreshBrowserView', async () => {
  console.log('[Pulsar] Refreshing BrowserView');
  browserView.webContents.reload();
  return { success: true };
});

// Check if logged in to a platform
ipcMain.handle('checkLoginStatus', async (event, platform) => {
  const url = browserView.webContents.getURL();

  // Execute JavaScript in the BrowserView to check login status
  const isLoggedIn = await browserView.webContents.executeJavaScript(`
    (function() {
      if (window.location.hostname.includes('x.com') || window.location.hostname.includes('twitter.com')) {
        return !!(
          document.querySelector('[data-testid="AppTabBar_Profile_Link"]') ||
          document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
        );
      }
      if (window.location.hostname.includes('linkedin.com')) {
        return !!document.querySelector('.feed-identity-module');
      }
      return false;
    })()
  `);

  return { platform, loggedIn: isLoggedIn, url };
});

// Post to Twitter using CDP for reliable text input
// Now with quota token verification for anti-hack protection
ipcMain.handle('postToTwitter', async (event, content, postToken = null) => {
  console.log('[Pulsar] Posting to Twitter:', content.substring(0, 50) + '...');

  // Step 0: Verify post token (anti-hack)
  let tokenToConfirm = postToken;

  if (!tokenToConfirm) {
    // Request token if not provided (backwards compatibility)
    const tokenResult = await quotaManager.requestPostToken('twitter', content);
    if (!tokenResult.success) {
      return {
        success: false,
        error: tokenResult.error,
        quotaExceeded: true
      };
    }
    tokenToConfirm = tokenResult.token;
  }

  try {
    // Navigate to compose page
    await browserView.webContents.loadURL('https://x.com/compose/post');

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Step 1: Focus and click on the textarea
    const focusResult = await browserView.webContents.executeJavaScript(`
      (async function() {
        const waitForElement = (selectors, timeout = 15000) => {
          return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const selectorList = Array.isArray(selectors) ? selectors : [selectors];
            const check = () => {
              for (const selector of selectorList) {
                const el = document.querySelector(selector);
                if (el) {
                  console.log('[Pulsar] Found element with selector:', selector);
                  return resolve(el);
                }
              }
              if (Date.now() - startTime > timeout) {
                return reject(new Error('Timeout waiting for: ' + selectorList.join(' OR ')));
              }
              setTimeout(check, 200);
            };
            check();
          });
        };

        try {
          // Try multiple selectors for the text area
          const selectors = [
            '[data-testid="tweetTextArea_0"]',
            '[data-testid="tweetTextArea_0_label"]',
            'div[role="textbox"][data-testid]',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"][data-contents="true"]',
            '.public-DraftEditor-content',
            '[aria-label="Post text"]'
          ];

          console.log('[Pulsar] Looking for textarea with selectors:', selectors);

          const textarea = await waitForElement(selectors);
          console.log('[Pulsar] Found textarea:', textarea.tagName, textarea.className);

          textarea.click();
          textarea.focus();

          // Get the editable div inside if exists
          const editableDiv = textarea.querySelector('[contenteditable="true"]') || textarea;
          editableDiv.click();
          editableDiv.focus();

          // Ensure cursor is in the editor
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editableDiv);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);

          return { success: true, focused: true, element: textarea.tagName };
        } catch (error) {
          console.error('[Pulsar] Focus error:', error);
          return { success: false, error: error.message };
        }
      })()
    `);

    if (!focusResult.success) {
      return focusResult;
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 2: Use CDP Input.insertText for reliable text input
    console.log('[Pulsar] Using CDP to insert text...');
    await browserView.webContents.debugger.sendCommand('Input.insertText', {
      text: content
    });

    // Wait longer for React/Draft.js to update DOM
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 3: Verify text was inserted and click post button
    const postResult = await browserView.webContents.executeJavaScript(`
      (async function() {
        // Wait for DOM to settle
        await new Promise(r => setTimeout(r, 500));

        // Try multiple selectors to find the text area content
        const selectors = [
          '[data-testid="tweetTextArea_0"]',
          'div[contenteditable="true"][role="textbox"]',
          '.public-DraftEditor-content',
          '[aria-label="Post text"]'
        ];

        let textarea = null;
        for (const selector of selectors) {
          textarea = document.querySelector(selector);
          if (textarea && textarea.textContent.trim().length > 0) {
            console.log('[Pulsar] Found text in:', selector);
            break;
          }
        }

        const textContent = textarea?.textContent?.trim() || '';
        console.log('[Pulsar] Text content found:', textContent.substring(0, 50));

        // Find post button - try multiple selectors
        const postBtnSelectors = [
          '[data-testid="tweetButton"]',
          '[data-testid="tweetButtonInline"]',
          'button[data-testid*="tweet"]'
        ];

        let postBtn = null;
        for (const selector of postBtnSelectors) {
          postBtn = document.querySelector(selector);
          if (postBtn) {
            console.log('[Pulsar] Found post button:', selector);
            break;
          }
        }

        if (!postBtn) {
          return { success: false, error: 'Post button not found' };
        }

        // Check if button is enabled
        const isDisabled = postBtn.getAttribute('aria-disabled') === 'true';
        console.log('[Pulsar] Post button aria-disabled:', isDisabled);

        // Even if aria-disabled, try clicking if text is present
        if (textContent.length === 0 && isDisabled) {
          return { success: false, error: 'No text detected and button is disabled' };
        }

        // Click the post button
        console.log('[Pulsar] Clicking post button...');
        postBtn.click();

        // Wait for post to complete
        await new Promise(r => setTimeout(r, 2500));

        // Check if compose modal closed (indicating success)
        const modalStillOpen = document.querySelector('[data-testid="tweetTextArea_0"]');
        if (!modalStillOpen) {
          console.log('[Pulsar] Compose modal closed - post likely succeeded');
          return { success: true };
        }

        // Modal still open - check if text was cleared (another success indicator)
        const remainingText = modalStillOpen.textContent?.trim() || '';
        if (remainingText.length === 0) {
          console.log('[Pulsar] Text cleared - post likely succeeded');
          return { success: true };
        }

        return { success: true, note: 'Post button clicked, verify manually' };
      })()
    `);

    // Confirm token usage based on result
    await quotaManager.confirmPostToken(
      tokenToConfirm,
      postResult.success,
      null, // platformPostId - we don't get this from Twitter easily
      postResult.success ? null : postResult.error
    );

    return postResult;
  } catch (error) {
    console.error('[Pulsar] Post failed:', error);

    // Refund token on error
    await quotaManager.confirmPostToken(tokenToConfirm, false, null, error.message);

    return { success: false, error: error.message };
  }
});

// Get page content (for debugging)
ipcMain.handle('getPageContent', async () => {
  const content = await browserView.webContents.executeJavaScript(`
    document.body.innerText.substring(0, 1000)
  `);
  return content;
});

// ============================================
// Scheduler IPC Handlers
// ============================================

// Schedule a post
ipcMain.handle('schedulePost', async (event, { platform, content, scheduledAt }) => {
  console.log('[Pulsar] Scheduling post for:', new Date(scheduledAt).toLocaleString());
  const job = scheduler.addJob({ platform, content, scheduledAt });
  // Notify renderer of update
  if (mainWindow) {
    mainWindow.webContents.send('scheduler-update', scheduler.getJobs());
  }
  return job;
});

// Get all scheduled jobs
ipcMain.handle('getScheduledJobs', async () => {
  return scheduler.getJobs();
});

// Get scheduler stats
ipcMain.handle('getSchedulerStats', async () => {
  return scheduler.getStats();
});

// Delete a scheduled job
ipcMain.handle('deleteScheduledJob', async (event, jobId) => {
  scheduler.deleteJob(jobId);
  if (mainWindow) {
    mainWindow.webContents.send('scheduler-update', scheduler.getJobs());
  }
  return { success: true };
});

// Clear completed jobs
ipcMain.handle('clearCompletedJobs', async () => {
  scheduler.clearCompleted();
  if (mainWindow) {
    mainWindow.webContents.send('scheduler-update', scheduler.getJobs());
  }
  return { success: true };
});

// ============================================
// AI Generator IPC Handlers
// ============================================

// Generate content
ipcMain.handle('generateContent', async (event, { prompt, options }) => {
  console.log('[Pulsar] Generating content with prompt:', prompt.substring(0, 50) + '...');
  return aiGenerator.generate(prompt, options);
});

// Generate thread
ipcMain.handle('generateThread', async (event, { topic, count }) => {
  return aiGenerator.generateThread(topic, count);
});

// Generate variations
ipcMain.handle('generateVariations', async (event, { content, count }) => {
  return aiGenerator.generateVariations(content, count);
});

// Improve content
ipcMain.handle('improveContent', async (event, { content, platform }) => {
  return aiGenerator.improveContent(content, platform);
});

// Check AI connection
ipcMain.handle('checkAIConnection', async () => {
  return aiGenerator.checkConnection();
});

// Set AI endpoint
ipcMain.handle('setAIEndpoint', async (event, endpoint) => {
  aiGenerator.setEndpoint(endpoint);
  return { success: true };
});

// ============================================
// Persona Builder IPC Handlers
// ============================================

// Check if persona exists
ipcMain.handle('personaExists', async () => {
  return personaBuilder.exists();
});

// Get persona
ipcMain.handle('getPersona', async () => {
  return personaBuilder.load();
});

// Get MBTI questions
ipcMain.handle('getMBTIQuestions', async () => {
  return personaBuilder.getQuestions();
});

// Create persona from MBTI answers
ipcMain.handle('createPersona', async (event, { answers, additionalInfo }) => {
  console.log('[Pulsar] Creating persona from MBTI answers');
  return personaBuilder.createFullPersona(answers, additionalInfo);
});

// Get prompt for platform
ipcMain.handle('getPersonaPrompt', async (event, platform) => {
  return personaBuilder.getPromptForPlatform(platform);
});

// Delete persona
ipcMain.handle('deletePersona', async () => {
  personaBuilder.delete();
  return { success: true };
});

// Update platform mask
ipcMain.handle('updatePersonaMask', async (event, { platform, customizations }) => {
  return personaBuilder.updateMask(platform, customizations);
});

// ============================================
// Knowledge Base IPC Handlers
// ============================================

// Get all knowledge documents
ipcMain.handle('getKnowledgeDocuments', async () => {
  return knowledgeBase.getStats();
});

// Add knowledge document
ipcMain.handle('addKnowledgeDocument', async (event, { name, content, metadata }) => {
  console.log('[Pulsar] Adding knowledge document:', name);
  return knowledgeBase.addDocument(name, content, metadata);
});

// Remove knowledge document
ipcMain.handle('removeKnowledgeDocument', async (event, docId) => {
  return knowledgeBase.removeDocument(docId);
});

// Search knowledge base
ipcMain.handle('searchKnowledge', async (event, { query, options }) => {
  return knowledgeBase.search(query, options);
});

// Get knowledge context for AI generation
ipcMain.handle('getKnowledgeContext', async (event, { topic, options }) => {
  return knowledgeBase.getContext(topic, options);
});

// Clear knowledge base
ipcMain.handle('clearKnowledgeBase', async () => {
  return knowledgeBase.clear();
});

// Parse PDF content
ipcMain.handle('parsePDFContent', async (event, uint8Array) => {
  try {
    const pdfParse = require('pdf-parse');
    const buffer = Buffer.from(uint8Array);
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    console.error('[Pulsar] PDF parse error:', err);
    throw new Error('Failed to parse PDF: ' + err.message);
  }
});

// ============================================
// Smart Engagement
// ============================================

// Search Twitter for posts based on interests
ipcMain.handle('engage:searchTwitter', async (event, { interests, audience }) => {
  console.log('[Engage] Searching Twitter for:', interests, 'audience:', audience);

  try {
    // Build search query from interests
    const searchQuery = interests.join(' OR ');

    // Navigate to Twitter search
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(searchQuery)}&f=live`;
    await browserView.webContents.loadURL(searchUrl);

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract posts from the page
    const posts = await browserView.webContents.executeJavaScript(`
      (function() {
        const posts = [];
        const articles = document.querySelectorAll('article[data-testid="tweet"]');

        articles.forEach((article, index) => {
          if (index >= 10) return; // Limit to 10 posts

          try {
            // Get author
            const authorEl = article.querySelector('a[href^="/"][role="link"] span');
            const authorLinkEl = article.querySelector('a[href^="/"][role="link"][tabindex="-1"]');
            const author = authorLinkEl ? authorLinkEl.getAttribute('href').replace('/', '') : (authorEl?.textContent || 'unknown');

            // Get text content
            const textEl = article.querySelector('[data-testid="tweetText"]');
            const text = textEl ? textEl.textContent : '';

            // Get engagement metrics
            const likesEl = article.querySelector('[data-testid="like"] span');
            const repliesEl = article.querySelector('[data-testid="reply"] span');
            const engagement = (likesEl?.textContent || '0') + ' likes, ' + (repliesEl?.textContent || '0') + ' replies';

            // Get post URL
            const timeEl = article.querySelector('time');
            const linkEl = timeEl ? timeEl.closest('a') : null;
            const url = linkEl ? 'https://x.com' + linkEl.getAttribute('href') : '';

            if (text && text.length > 10) {
              posts.push({
                author: author.replace('@', ''),
                text: text,
                engagement: engagement,
                url: url
              });
            }
          } catch (e) {
            console.error('Error parsing tweet:', e);
          }
        });

        return posts;
      })()
    `);

    console.log('[Engage] Found', posts.length, 'posts');

    return {
      success: true,
      posts: posts
    };

  } catch (error) {
    console.error('[Engage] Search error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Send reply to a Twitter post
ipcMain.handle('engage:sendReply', async (event, { postUrl, replyText }) => {
  console.log('[Engage] Sending reply to:', postUrl);

  try {
    // Navigate to the post
    await browserView.webContents.loadURL(postUrl);
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Find and click the reply button
    const clickReply = await browserView.webContents.executeJavaScript(`
      (function() {
        // Find the reply button on the main tweet
        const replyBtn = document.querySelector('article[data-testid="tweet"] [data-testid="reply"]');
        if (replyBtn) {
          replyBtn.click();
          return { success: true };
        }
        return { success: false, error: 'Reply button not found' };
      })()
    `);

    if (!clickReply.success) {
      return clickReply;
    }

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Find the reply textarea and enter text
    const focusResult = await browserView.webContents.executeJavaScript(`
      (function() {
        const selectors = [
          '[data-testid="tweetTextArea_0"]',
          'div[contenteditable="true"][role="textbox"]',
          '[aria-label="Post your reply"]'
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            el.click();
            el.focus();
            return { success: true };
          }
        }
        return { success: false, error: 'Reply textarea not found' };
      })()
    `);

    if (!focusResult.success) {
      return focusResult;
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    // Insert reply text via CDP
    await browserView.webContents.debugger.sendCommand('Input.insertText', {
      text: replyText
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Click the reply/post button
    const postResult = await browserView.webContents.executeJavaScript(`
      (function() {
        // Find the reply submit button
        const submitBtn = document.querySelector('[data-testid="tweetButtonInline"]') ||
                          document.querySelector('[data-testid="tweetButton"]');
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.click();
          return { success: true };
        }
        return { success: false, error: 'Submit button not found or disabled' };
      })()
    `);

    if (!postResult.success) {
      return postResult;
    }

    // Wait for reply to be sent
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('[Engage] Reply sent successfully');
    return { success: true };

  } catch (error) {
    console.error('[Engage] Reply error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Get engagement stats (placeholder for now)
ipcMain.handle('engage:getStats', async () => {
  return {
    found: 0,
    replied: 0,
    today: 0
  };
});

// Save engagement settings
ipcMain.handle('engage:saveSettings', async (event, settings) => {
  const fs = require('fs');
  const settingsPath = path.join(app.getPath('userData'), 'engage-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return { success: true };
});

// Load engagement settings
ipcMain.handle('engage:loadSettings', async () => {
  const fs = require('fs');
  const settingsPath = path.join(app.getPath('userData'), 'engage-settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Engage] Load settings error:', err);
  }
  return { interests: [], audience: 'all' };
});

// ============================================
// Enhanced AI Generation with Persona
// ============================================

// Generate content with persona context
ipcMain.handle('generateWithPersona', async (event, { prompt, platform, useKnowledge, model }) => {
  console.log('[Pulsar] Generating with persona for:', platform, 'using model:', model);

  try {
    // Get persona prompt for platform
    const personaPrompt = personaBuilder.getPromptForPlatform(platform || 'twitter');

    // Get knowledge context if requested
    let kbContext = null;
    if (useKnowledge) {
      const contextResult = knowledgeBase.getContext(prompt);
      if (contextResult) {
        kbContext = contextResult.context;
      }
    }

    // Build full prompt with context
    let fullPrompt = prompt;
    if (kbContext) {
      fullPrompt = `Using this context from my knowledge base:\n\n${kbContext}\n\nCreate a post about: ${prompt}`;
    }

    // Generate with persona system prompt and selected model
    const options = {
      systemPrompt: personaPrompt,
      model: model
    };

    return aiGenerator.generate(fullPrompt, options);
  } catch (error) {
    console.error('[Pulsar] Generate with persona failed:', error);
    return { success: false, error: error.message };
  }
});

// ============================================
// Job Execution (for scheduler)
// ============================================

async function executeScheduledJob(job) {
  console.log('[Pulsar] Executing scheduled job:', job.id, job.platform);

  if (job.platform === 'twitter') {
    // Reuse the postToTwitter logic
    try {
      await browserView.webContents.loadURL('https://x.com/compose/post');
      await new Promise(resolve => setTimeout(resolve, 2500));

      // Focus textarea
      const focusResult = await browserView.webContents.executeJavaScript(`
        (async function() {
          const selectors = [
            '[data-testid="tweetTextArea_0"]',
            'div[contenteditable="true"][role="textbox"]',
            '[aria-label="Post text"]'
          ];
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
              el.click();
              el.focus();
              return { success: true };
            }
          }
          return { success: false, error: 'Textarea not found' };
        })()
      `);

      if (!focusResult.success) return focusResult;

      await new Promise(resolve => setTimeout(resolve, 300));

      // Insert text via CDP
      await browserView.webContents.debugger.sendCommand('Input.insertText', {
        text: job.content
      });

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Click post button
      const result = await browserView.webContents.executeJavaScript(`
        (async function() {
          await new Promise(r => setTimeout(r, 500));
          const postBtn = document.querySelector('[data-testid="tweetButton"]');
          if (postBtn && postBtn.getAttribute('aria-disabled') !== 'true') {
            postBtn.click();
            await new Promise(r => setTimeout(r, 2500));
            return { success: true };
          }
          return { success: false, error: 'Post button not clickable' };
        })()
      `);

      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'Platform not supported: ' + job.platform };
}

// App lifecycle
app.whenReady().then(async () => {
  await createWindow();
  await connectPuppeteer();

  // Initialize scheduler with job execution callback
  scheduler.init(executeScheduledJob);

  // Initialize payment & auth system
  authManager.setMainWindow(mainWindow);
  authManager.initIPCHandlers();
  quotaManager.initIPCHandlers();
  trackedAccountsManager.initIPCHandlers();
  subscriptionManager.setMainWindow(mainWindow);
  subscriptionManager.initIPCHandlers();

  console.log('[Pulsar] Payment system initialized');

  // Initialize AI provider system
  await aiProvider.initialize();
  console.log('[Pulsar] AI provider system initialized');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up on quit
app.on('before-quit', () => {
  if (browserView && browserView.webContents.debugger.isAttached()) {
    browserView.webContents.debugger.detach();
  }
});
