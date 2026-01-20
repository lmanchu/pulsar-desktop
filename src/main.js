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

// Automation System
const automationManager = require('./automation/automation-manager');

// Company Settings (stored locally)
const fs = require('fs');
const companySettingsPath = path.join(app.getPath('userData'), 'company-settings.json');

function loadCompanySettings() {
  try {
    if (fs.existsSync(companySettingsPath)) {
      return JSON.parse(fs.readFileSync(companySettingsPath, 'utf8'));
    }
  } catch (e) {
    console.error('[Settings] Failed to load company settings:', e.message);
  }
  return { linkedin: { companySlug: '', enabled: false } };
}

function saveCompanySettings(settings) {
  try {
    fs.writeFileSync(companySettingsPath, JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (e) {
    console.error('[Settings] Failed to save company settings:', e.message);
    return { success: false, error: e.message };
  }
}

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

  // Open DevTools (temporarily enabled for testing)
  // TODO: restore condition after testing: if (process.env.NODE_ENV === 'development')
  mainWindow.webContents.openDevTools({ mode: 'detach' });

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
        // LinkedIn UI updated - use multiple selectors
        return !!(
          document.querySelector('.feed-identity-module') ||
          document.querySelector('.profile-card-profile-picture') ||
          document.querySelector('[data-control-name="identity_profile_photo"]') ||
          document.querySelector('.share-box-feed-entry__avatar') ||
          document.querySelector('.feed-identity-module__actor-meta') ||
          document.querySelector('img.feed-identity-module__member-photo') ||
          document.querySelector('.global-nav__me-photo') ||
          document.querySelector('[data-view-name="profile-card"]')
        );
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

// Post to LinkedIn using CDP for reliable text input
// Similar pattern to Twitter but with LinkedIn-specific selectors
ipcMain.handle('postToLinkedIn', async (event, content, postToken = null) => {
  console.log('[Pulsar] Posting to LinkedIn:', content.substring(0, 50) + '...');

  // Step 0: Verify post token (anti-hack)
  let tokenToConfirm = postToken;

  if (!tokenToConfirm) {
    // Request token if not provided
    const tokenResult = await quotaManager.requestPostToken('linkedin', content);
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
    // Navigate to LinkedIn feed with share modal active
    await browserView.webContents.loadURL('https://www.linkedin.com/feed/');

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 1: Click "Start a post" button to open compose modal
    console.log('[Pulsar] Step 1: Looking for Start a post button...');
    const openResult = await browserView.webContents.executeJavaScript(`
      (function() {
        try {
          // Strategy: Find the share-box and click the most interactive element inside
          const shareBox = document.querySelector('.share-box-feed-entry, [class*="share-box-feed"]');

          if (shareBox) {
            // Look for the trigger button or placeholder text area inside the share box
            const innerTrigger = shareBox.querySelector(
              'button, ' +
              '[role="button"], ' +
              '.share-box-feed-entry__trigger, ' +
              '.share-box-feed-entry__placeholder, ' +
              '[class*="trigger"], ' +
              '[class*="placeholder"], ' +
              'span[dir="ltr"]'
            );

            if (innerTrigger) {
              innerTrigger.click();
              return { success: true, selector: 'shareBox-inner', element: innerTrigger.tagName + '.' + (innerTrigger.className || '').split(' ')[0] };
            }

            // If no inner trigger, click the share box itself
            shareBox.click();
            return { success: true, selector: 'shareBox-direct' };
          }

          // Fallback: try direct selectors
          const directSelectors = [
            '.share-box-feed-entry__trigger',
            'button.share-box-feed-entry__trigger',
            '[data-control-name="share.open_share_box"]',
            'button[aria-label="Start a post"]',
            '.share-creation-state__trigger'
          ];

          for (const sel of directSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              el.click();
              return { success: true, selector: sel };
            }
          }

          // Last resort: find by "Start a post" text
          const allClickables = document.querySelectorAll('button, [role="button"], [tabindex="0"], span, div');
          for (const el of allClickables) {
            if (el.textContent?.includes('Start a post')) {
              el.click();
              return { success: true, selector: 'text-match', element: el.tagName };
            }
          }

          return { success: false, error: 'Could not find Start a post element' };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `);
    console.log('[Pulsar] Step 1 result:', JSON.stringify(openResult));

    // If click succeeded, wait longer for modal animation
    if (openResult.success) {
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify modal opened, if not try clicking again or a different element
      const modalCheck = await browserView.webContents.executeJavaScript(`
        (function() {
          const modal = document.querySelector('.artdeco-modal, [role="dialog"], .share-creation-state');
          const contentEditable = document.querySelector('[contenteditable="true"]');
          return { hasModal: !!modal, hasEditor: !!contentEditable };
        })()
      `);
      console.log('[Pulsar] Modal check after click:', JSON.stringify(modalCheck));

      if (!modalCheck.hasModal && !modalCheck.hasEditor) {
        console.log('[Pulsar] Modal did not open, trying alternative click...');
        // Try clicking "Start a post" text directly with a simulated mouse event
        await browserView.webContents.executeJavaScript(`
          (function() {
            const shareBox = document.querySelector('.share-box-feed-entry, [class*="share-box-feed"]');
            if (shareBox) {
              // Dispatch a proper mouse event
              const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
              shareBox.dispatchEvent(evt);
            }
          })()
        `);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    if (!openResult.success) {
      await quotaManager.confirmPostToken(tokenToConfirm, false, null, openResult.error);
      return openResult;
    }

    // Wait for compose modal to open
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Focus on the text editor
    console.log('[Pulsar] Step 2: Looking for editor...');
    const focusResult = await browserView.webContents.executeJavaScript(`
      (function() {
        try {
          // LinkedIn uses various editor implementations
          const editorSelectors = [
            '.ql-editor',
            '[data-placeholder="What do you want to talk about?"]',
            '.share-creation-state__text-editor .ql-editor',
            '.editor-content[contenteditable="true"]',
            '[role="textbox"][contenteditable="true"]',
            '.share-box-v2__modal-content .ql-editor',
            '.share-creation-state__editor .ql-editor',
            '[data-test-richtexteditor]',
            '.share-box__editor .ql-editor',
            'div[contenteditable="true"][aria-label*="post"]',
            '.artdeco-modal [contenteditable="true"]',
            '[aria-label="Text editor for creating content"]',
            // More aggressive patterns
            '[contenteditable="true"]',
            '.ql-container .ql-editor'
          ];

          let editor = null;
          let foundSelector = '';

          for (const selector of editorSelectors) {
            editor = document.querySelector(selector);
            if (editor) {
              foundSelector = selector;
              break;
            }
          }

          // Fallback: find any contenteditable in modal
          if (!editor) {
            const modal = document.querySelector('.artdeco-modal, [role="dialog"], [class*="modal"]');
            if (modal) {
              editor = modal.querySelector('[contenteditable="true"]');
              if (editor) foundSelector = 'modal-contenteditable';
            }
          }

          if (!editor) {
            // Debug: check what modals/dialogs exist
            const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], .artdeco-modal');
            const contentEditables = document.querySelectorAll('[contenteditable="true"]');
            return {
              success: false,
              error: 'Editor not found',
              debug: {
                modals: modals.length,
                contentEditables: contentEditables.length,
                modalClasses: Array.from(modals).slice(0,3).map(m => m.className?.split(' ')[0])
              }
            };
          }

          editor.click();
          editor.focus();

          // Ensure cursor is in the editor
          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          } catch(e) {}

          return { success: true, selector: foundSelector };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `);
    console.log('[Pulsar] Step 2 result:', JSON.stringify(focusResult));

    if (!focusResult.success) {
      await quotaManager.confirmPostToken(tokenToConfirm, false, null, focusResult.error);
      return focusResult;
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 3: Use CDP Input.insertText for reliable text input
    console.log('[Pulsar] Using CDP to insert text into LinkedIn...');
    await browserView.webContents.debugger.sendCommand('Input.insertText', {
      text: content
    });

    // Wait for editor to update
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 4: Click the Post button
    const postResult = await browserView.webContents.executeJavaScript(`
      (async function() {
        await new Promise(r => setTimeout(r, 500));

        // Verify text was inserted
        const editorSelectors = [
          '.ql-editor',
          '[data-placeholder="What do you want to talk about?"]',
          '.editor-content[contenteditable="true"]',
          '[contenteditable="true"][role="textbox"]',
          '.artdeco-modal [contenteditable="true"]'
        ];

        let editor = null;
        for (const selector of editorSelectors) {
          editor = document.querySelector(selector);
          if (editor && editor.textContent.trim().length > 0) {
            console.log('[Pulsar] Found text in:', selector);
            break;
          }
        }

        // Fallback: find in modal
        if (!editor || editor.textContent.trim().length === 0) {
          const modal = document.querySelector('.artdeco-modal, [role="dialog"]');
          if (modal) {
            const modalEditor = modal.querySelector('[contenteditable="true"]');
            if (modalEditor && modalEditor.textContent.trim().length > 0) {
              editor = modalEditor;
              console.log('[Pulsar] Found text in modal editor');
            }
          }
        }

        const textContent = editor?.textContent?.trim() || '';
        console.log('[Pulsar] LinkedIn text content found:', textContent.substring(0, 50));

        if (textContent.length === 0) {
          return { success: false, error: 'No text detected in editor' };
        }

        // Find the Post button - LinkedIn UI changes frequently
        const postBtnSelectors = [
          '.share-actions__primary-action',
          'button.share-actions__primary-action',
          '[data-control-name="share.post"]',
          'button[aria-label="Post"]',
          '.share-box-v2__submit-button',
          'button.artdeco-button--primary[type="submit"]',
          // Additional selectors
          '.share-creation-state__footer button.artdeco-button--primary',
          '.artdeco-modal button.artdeco-button--primary',
          '[data-test-modal-footer] button.artdeco-button--primary'
        ];

        let postBtn = null;
        for (const selector of postBtnSelectors) {
          const btn = document.querySelector(selector);
          if (btn) {
            console.log('[Pulsar] Found post button:', selector, btn.textContent);
            postBtn = btn;
            break;
          }
        }

        if (!postBtn) {
          // Try finding by button text in modal
          const modal = document.querySelector('.artdeco-modal, [role="dialog"]');
          const buttonsToCheck = modal ? modal.querySelectorAll('button') : document.querySelectorAll('button');
          for (const btn of buttonsToCheck) {
            const text = btn.textContent.trim().toLowerCase();
            if (text === 'post' || text === 'share') {
              postBtn = btn;
              console.log('[Pulsar] Found post button by text:', text);
              break;
            }
          }
        }

        if (!postBtn) {
          return { success: false, error: 'Post button not found' };
        }

        // Check if button is disabled
        const isDisabled = postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true';
        console.log('[Pulsar] Post button disabled:', isDisabled);

        if (isDisabled) {
          return { success: false, error: 'Post button is disabled' };
        }

        // Click the post button
        console.log('[Pulsar] Clicking LinkedIn post button...');
        postBtn.click();

        // Wait for post to complete
        await new Promise(r => setTimeout(r, 3000));

        // Check if modal closed (indicating success)
        const modalStillOpen = document.querySelector('.share-box-v2__modal-content') ||
                              document.querySelector('.share-creation-state');
        if (!modalStillOpen) {
          console.log('[Pulsar] LinkedIn compose modal closed - post likely succeeded');
          return { success: true };
        }

        // Check for success toast
        const successToast = document.querySelector('.artdeco-toast-item--visible');
        if (successToast && successToast.textContent.toLowerCase().includes('post')) {
          console.log('[Pulsar] Found success toast');
          return { success: true };
        }

        return { success: true, note: 'Post button clicked, verify manually' };
      })()
    `);

    // Confirm token usage based on result
    await quotaManager.confirmPostToken(
      tokenToConfirm,
      postResult.success,
      null,
      postResult.success ? null : postResult.error
    );

    return postResult;
  } catch (error) {
    console.error('[Pulsar] LinkedIn post failed:', error);

    // Refund token on error
    await quotaManager.confirmPostToken(tokenToConfirm, false, null, error.message);

    return { success: false, error: error.message };
  }
});

// ============================================
// LinkedIn Company Page Posting
// ============================================
ipcMain.handle('postToLinkedInCompany', async (event, { content, companySlug }) => {
  console.log(`[Pulsar] Posting to LinkedIn Company Page: ${companySlug}`);
  console.log('[Pulsar] Content:', content.substring(0, 50) + '...');

  // Step 0: Verify post token (anti-hack)
  const tokenResult = await quotaManager.requestPostToken('linkedin_company', content);
  if (!tokenResult.success) {
    return {
      success: false,
      error: tokenResult.error,
      quotaExceeded: true
    };
  }
  const tokenToConfirm = tokenResult.token;

  try {
    // Navigate to Company Page
    const companyUrl = `https://www.linkedin.com/company/${companySlug}/`;
    console.log('[Pulsar] Navigating to Company Page:', companyUrl);
    await browserView.webContents.loadURL(companyUrl);

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 1: Click "Create" button on Company Page to open dropdown
    console.log('[Pulsar] Step 1: Looking for Create button...');
    const createResult = await browserView.webContents.executeJavaScript(`
      (function() {
        try {
          // Find the Create button (usually a green/primary button)
          const createSelectors = [
            'button[aria-label="Create"]',
            '.org-page-navigation__create-btn',
            'button.artdeco-button--primary',
            '[data-control-name="org_admin_create"]'
          ];

          for (const selector of createSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent?.toLowerCase().includes('create')) {
              el.click();
              return { success: true, selector: selector, text: el.textContent.trim() };
            }
          }

          // Fallback: find by text "Create"
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent?.trim().toLowerCase() === 'create') {
              btn.click();
              return { success: true, selector: 'text-match', text: btn.textContent.trim() };
            }
          }

          return { success: false, error: 'Create button not found' };
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()
    `);
    console.log('[Pulsar] Step 1 (Create button) result:', JSON.stringify(createResult));

    if (!createResult.success) {
      await quotaManager.confirmPostToken(tokenToConfirm, false, null, createResult.error);
      return createResult;
    }

    // Wait for dropdown menu to appear
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 1b: Click "Start a post" in the Create dialog/dropdown
    console.log('[Pulsar] Step 1b: Looking for "Start a post" in Create dialog...');

    // Get the position of "Start a post" element for precise clicking
    const startPostInfo = await browserView.webContents.executeJavaScript(`
      (function() {
        try {
          // Company Page uses a modal dialog instead of dropdown
          // Look for modal/dialog first
          const createDialog = document.querySelector('.artdeco-modal, [role="dialog"], .share-actions-modal');
          const searchContainer = createDialog || document;

          // Strategy 1: Find by text content - search ALL clickable elements
          const allClickables = searchContainer.querySelectorAll('li, button, a, div[role="button"], span[role="button"], [tabindex="0"]');
          for (const item of allClickables) {
            const text = item.textContent?.toLowerCase() || '';
            if (text.includes('start a post') && !text.includes('create an event')) {
              const rect = item.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  text: item.textContent.trim().substring(0, 80),
                  strategy: 'text-match'
                };
              }
            }
          }

          // Strategy 2: Find dropdown items (traditional dropdown)
          const dropdownItems = searchContainer.querySelectorAll('.artdeco-dropdown__item, [role="menuitem"], li[role="option"]');
          for (const item of dropdownItems) {
            if (item.textContent?.toLowerCase().includes('start a post')) {
              const rect = item.getBoundingClientRect();
              return {
                found: true,
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                text: item.textContent.trim().substring(0, 50),
                strategy: 'dropdown-item'
              };
            }
          }

          // Strategy 3: Find by first item in Create menu (usually Start a post)
          const dropdown = searchContainer.querySelector('.artdeco-dropdown__content, [role="menu"], .share-actions-modal__content');
          if (dropdown) {
            const firstItem = dropdown.querySelector('li, [role="menuitem"], button');
            if (firstItem) {
              const rect = firstItem.getBoundingClientRect();
              return {
                found: true,
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                text: firstItem.textContent.trim().substring(0, 50),
                strategy: 'first-item-fallback'
              };
            }
          }

          // Debug: list what elements exist in the modal
          const debugInfo = {
            hasDialog: !!createDialog,
            clickableCount: allClickables.length,
            firstFewTexts: Array.from(allClickables).slice(0, 5).map(el => el.textContent?.trim().substring(0, 30))
          };

          return { found: false, debug: debugInfo };
        } catch (e) {
          return { found: false, error: e.message };
        }
      })()
    `);
    console.log('[Pulsar] Start a post element info:', JSON.stringify(startPostInfo));

    if (!startPostInfo.found) {
      const error = '"Start a post" option not found in dropdown';
      await quotaManager.confirmPostToken(tokenToConfirm, false, null, error);
      return { success: false, error };
    }

    // Use CDP to perform a real mouse click at the element position
    console.log('[Pulsar] Clicking "Start a post" at:', startPostInfo.x, startPostInfo.y);
    await browserView.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: startPostInfo.x,
      y: startPostInfo.y,
      button: 'left',
      clickCount: 1
    });
    await browserView.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: startPostInfo.x,
      y: startPostInfo.y,
      button: 'left',
      clickCount: 1
    });

    console.log('[Pulsar] Step 1b: CDP click dispatched');

    // Wait for modal to open (Company Page modal loads slower)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for editor to appear with retry
    console.log('[Pulsar] Step 2: Waiting for editor in modal...');
    let focusResult = { success: false, error: 'Editor not found after retries' };

    for (let retry = 0; retry < 5; retry++) {
      const checkResult = await browserView.webContents.executeJavaScript(`
        (function() {
          try {
            // Company Page modal editor selectors
            const editorSelectors = [
              '.ql-editor',
              '.share-creation-state__text-editor .ql-editor',
              '[contenteditable="true"][role="textbox"]',
              '[contenteditable="true"][data-placeholder]',
              '.artdeco-modal [contenteditable="true"]',
              '[role="dialog"] [contenteditable="true"]',
              '.share-box-v2__modal-content .ql-editor',
              '[aria-label="Text editor for creating content"]',
              // More generic
              '[contenteditable="true"]'
            ];

            let editor = null;
            let foundSelector = '';

            for (const selector of editorSelectors) {
              const els = document.querySelectorAll(selector);
              for (const el of els) {
                // Make sure it's visible and in a modal
                if (el.offsetParent !== null) {
                  editor = el;
                  foundSelector = selector;
                  break;
                }
              }
              if (editor) break;
            }

            // Fallback: find any contenteditable in modal
            if (!editor) {
              const modal = document.querySelector('.artdeco-modal, [role="dialog"], .share-creation-state');
              if (modal) {
                const ce = modal.querySelector('[contenteditable="true"]');
                if (ce && ce.offsetParent !== null) {
                  editor = ce;
                  foundSelector = 'modal-contenteditable';
                }
              }
            }

            if (!editor) {
              // Debug info
              const modals = document.querySelectorAll('.artdeco-modal, [role="dialog"]');
              const allCE = document.querySelectorAll('[contenteditable="true"]');
              return {
                success: false,
                retry: true,
                debug: { modals: modals.length, contentEditables: allCE.length }
              };
            }

            editor.click();
            editor.focus();

            // Place cursor
            try {
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            } catch(e) {}

            return { success: true, selector: foundSelector };
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `);

      console.log('[Pulsar] Step 2 attempt ' + (retry + 1) + ':', JSON.stringify(checkResult));

      if (checkResult.success) {
        focusResult = checkResult;
        break;
      }

      if (!checkResult.retry) {
        focusResult = checkResult;
        break;
      }

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('[Pulsar] Step 2 final result:', JSON.stringify(focusResult));

    if (!focusResult.success) {
      await quotaManager.confirmPostToken(tokenToConfirm, false, null, focusResult.error);
      return focusResult;
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 3: Use CDP Input.insertText for reliable text input
    console.log('[Pulsar] Using CDP to insert text...');
    await browserView.webContents.debugger.sendCommand('Input.insertText', {
      text: content
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 4: Click the Post button
    const postResult = await browserView.webContents.executeJavaScript(`
      (async function() {
        await new Promise(r => setTimeout(r, 500));

        // Find the Post button
        const postBtnSelectors = [
          '.share-actions__primary-action',
          'button.share-actions__primary-action',
          'button[aria-label="Post"]',
          '.artdeco-modal button.artdeco-button--primary',
          '[data-control-name="share.post"]'
        ];

        let postBtn = null;
        for (const selector of postBtnSelectors) {
          const btn = document.querySelector(selector);
          if (btn) {
            postBtn = btn;
            break;
          }
        }

        // Fallback: find by text
        if (!postBtn) {
          const modal = document.querySelector('.artdeco-modal, [role="dialog"]');
          const buttons = modal ? modal.querySelectorAll('button') : document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent.trim().toLowerCase();
            if (text === 'post' || text === 'share') {
              postBtn = btn;
              break;
            }
          }
        }

        if (!postBtn) {
          return { success: false, error: 'Post button not found' };
        }

        const isDisabled = postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true';
        if (isDisabled) {
          return { success: false, error: 'Post button is disabled' };
        }

        postBtn.click();
        await new Promise(r => setTimeout(r, 3000));

        // Check if modal closed
        const modalStillOpen = document.querySelector('.share-creation-state');
        if (!modalStillOpen) {
          return { success: true };
        }

        return { success: true, note: 'Post button clicked, verify manually' };
      })()
    `);

    // Confirm token usage
    await quotaManager.confirmPostToken(
      tokenToConfirm,
      postResult.success,
      null,
      postResult.success ? null : postResult.error
    );

    return postResult;
  } catch (error) {
    console.error('[Pulsar] LinkedIn Company post failed:', error);
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

// Update a scheduled job
ipcMain.handle('updateScheduledJob', async (event, { jobId, updates }) => {
  const job = scheduler.updateJob(jobId, updates);
  if (mainWindow) {
    mainWindow.webContents.send('scheduler-update', scheduler.getJobs());
  }
  return { success: true, job };
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
// Automation IPC Handlers (自動化排程)
// ============================================

// Get all automations
ipcMain.handle('automation:getAll', async () => {
  return automationManager.getAutomations();
});

// Get automation statistics
ipcMain.handle('automation:getStats', async () => {
  return automationManager.getStats();
});

// Add a new automation
ipcMain.handle('automation:add', async (event, automation) => {
  console.log('[Pulsar] Adding automation:', automation.type, automation.name);
  const newAutomation = automationManager.addAutomation(automation);
  if (mainWindow) {
    mainWindow.webContents.send('automation-update', {
      type: 'added',
      automation: newAutomation,
      all: automationManager.getAutomations()
    });
  }
  return newAutomation;
});

// Update an automation
ipcMain.handle('automation:update', async (event, { id, updates }) => {
  const automation = automationManager.updateAutomation(id, updates);
  if (mainWindow) {
    mainWindow.webContents.send('automation-update', {
      type: 'updated',
      automation,
      all: automationManager.getAutomations()
    });
  }
  return automation;
});

// Delete an automation
ipcMain.handle('automation:delete', async (event, id) => {
  automationManager.deleteAutomation(id);
  if (mainWindow) {
    mainWindow.webContents.send('automation-update', {
      type: 'deleted',
      id,
      all: automationManager.getAutomations()
    });
  }
  return { success: true };
});

// Toggle automation enabled/disabled
ipcMain.handle('automation:toggle', async (event, { id, enabled }) => {
  const automation = automationManager.toggleAutomation(id, enabled);
  if (mainWindow) {
    mainWindow.webContents.send('automation-update', {
      type: 'toggled',
      automation,
      all: automationManager.getAutomations()
    });
  }
  return automation;
});

// Manually trigger an automation
ipcMain.handle('automation:trigger', async (event, id) => {
  console.log('[Pulsar] Manually triggering automation:', id);
  try {
    const automation = await automationManager.triggerNow(id);
    if (mainWindow) {
      mainWindow.webContents.send('automation-update', {
        type: 'triggered',
        automation,
        all: automationManager.getAutomations()
      });
    }
    return { success: true, automation };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Add content to a queue automation
ipcMain.handle('automation:addToQueue', async (event, { id, content }) => {
  const automation = automationManager.addToQueue(id, content);
  if (automation && mainWindow) {
    mainWindow.webContents.send('automation-update', {
      type: 'queueUpdated',
      automation,
      all: automationManager.getAutomations()
    });
  }
  return automation;
});

// Get queue contents
ipcMain.handle('automation:getQueue', async (event, id) => {
  return automationManager.getQueueContents(id);
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
// Company Settings
// ============================================

ipcMain.handle('settings:getCompany', async () => {
  return loadCompanySettings();
});

ipcMain.handle('settings:setCompany', async (event, settings) => {
  return saveCompanySettings(settings);
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

  // Step 0: Request post token (anti-hack - even scheduled posts need tokens)
  const tokenResult = await quotaManager.requestPostToken(job.platform, job.content);
  if (!tokenResult.success) {
    console.log('[Pulsar] Scheduled job blocked by quota:', tokenResult.error);
    return {
      success: false,
      error: tokenResult.error,
      quotaExceeded: true
    };
  }
  const postToken = tokenResult.token;

  if (job.platform === 'twitter') {
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

      if (!focusResult.success) {
        // Refund token on failure
        await quotaManager.confirmPostToken(postToken, false, null, focusResult.error);
        return focusResult;
      }

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

      // Confirm token usage
      await quotaManager.confirmPostToken(postToken, result.success, null, result.success ? null : result.error);

      return result;
    } catch (error) {
      // Refund token on error
      await quotaManager.confirmPostToken(postToken, false, null, error.message);
      return { success: false, error: error.message };
    }
  }

  if (job.platform === 'linkedin') {
    try {
      // Navigate to LinkedIn feed
      await browserView.webContents.loadURL('https://www.linkedin.com/feed/');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Click "Start a post" button
      const openResult = await browserView.webContents.executeJavaScript(`
        (function() {
          try {
            const shareBox = document.querySelector('.share-box-feed-entry, [class*="share-box-feed"]');
            if (shareBox) {
              const innerTrigger = shareBox.querySelector('button, [role="button"], .share-box-feed-entry__trigger');
              if (innerTrigger) {
                innerTrigger.click();
                return { success: true };
              }
              shareBox.click();
              return { success: true };
            }
            return { success: false, error: 'Share box not found' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `);

      if (!openResult.success) {
        await quotaManager.confirmPostToken(postToken, false, null, openResult.error);
        return openResult;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Focus editor
      const focusResult = await browserView.webContents.executeJavaScript(`
        (function() {
          try {
            const editor = document.querySelector('.ql-editor, [contenteditable="true"]');
            if (editor) {
              editor.click();
              editor.focus();
              return { success: true };
            }
            return { success: false, error: 'Editor not found' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `);

      if (!focusResult.success) {
        await quotaManager.confirmPostToken(postToken, false, null, focusResult.error);
        return focusResult;
      }

      await new Promise(resolve => setTimeout(resolve, 300));

      // Insert text via CDP
      await browserView.webContents.debugger.sendCommand('Input.insertText', {
        text: job.content
      });

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Click Post button
      const result = await browserView.webContents.executeJavaScript(`
        (async function() {
          await new Promise(r => setTimeout(r, 500));
          // Find Post button
          let postBtn = document.querySelector('.share-actions__primary-action, button[aria-label="Post"]');
          if (!postBtn) {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
              if (btn.textContent.trim().toLowerCase() === 'post') {
                postBtn = btn;
                break;
              }
            }
          }
          if (postBtn && !postBtn.disabled) {
            postBtn.click();
            await new Promise(r => setTimeout(r, 3000));
            return { success: true };
          }
          return { success: false, error: 'Post button not clickable' };
        })()
      `);

      // Confirm token usage
      await quotaManager.confirmPostToken(postToken, result.success, null, result.success ? null : result.error);

      return result;
    } catch (error) {
      await quotaManager.confirmPostToken(postToken, false, null, error.message);
      return { success: false, error: error.message };
    }
  }

  // Refund token for unsupported platform
  await quotaManager.confirmPostToken(postToken, false, null, 'Platform not supported');
  return { success: false, error: 'Platform not supported: ' + job.platform };
}

// ============================================
// Engagement Task Execution (for automation)
// ============================================

async function executeEngagementTask(options) {
  const {
    type,
    username,
    searchQuery,
    maxResults = 5,
    aiProvider: ai,
    usePersona,
    checkReplied,
    markReplied
  } = options;

  console.log('[Engagement] Executing:', type, username || searchQuery);

  try {
    if (type === 'tracked_account') {
      return await executeTrackedAccountEngagement(username, ai, usePersona, checkReplied, markReplied);
    } else if (type === 'topic_search') {
      return await executeTopicSearchEngagement(searchQuery, maxResults, ai, usePersona, checkReplied, markReplied);
    }
    return { success: false, error: 'Unknown engagement type: ' + type };
  } catch (error) {
    console.error('[Engagement] Task failed:', error);
    return { success: false, error: error.message };
  }
}

// Engage with a tracked account's posts
async function executeTrackedAccountEngagement(username, ai, usePersona, checkReplied, markReplied) {
  console.log('[Engagement] Visiting tracked account:', username);

  // Navigate to user's profile
  await browserView.webContents.loadURL(`https://x.com/${username}`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Find recent posts and select one to reply to
  const postData = await browserView.webContents.executeJavaScript(`
    (function() {
      // Find tweet articles
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const posts = [];

      for (const article of articles) {
        // Skip pinned tweets
        if (article.querySelector('[data-testid="socialContext"]')?.textContent?.includes('Pinned')) {
          continue;
        }

        // Get the tweet link for unique ID
        const linkEl = article.querySelector('a[href*="/status/"]');
        if (!linkEl) continue;

        const postUrl = linkEl.href;
        const postId = postUrl.match(/status\\/(\\d+)/)?.[1];
        if (!postId) continue;

        // Get tweet text
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText : '';

        // Get author
        const authorEl = article.querySelector('[data-testid="User-Name"]');
        const author = authorEl ? authorEl.innerText.split('\\n')[0] : '';

        posts.push({
          postId,
          postUrl,
          text: text.substring(0, 500),
          author
        });

        if (posts.length >= 5) break;
      }

      return posts;
    })()
  `);

  if (!postData || postData.length === 0) {
    console.log('[Engagement] No posts found for', username);
    return { success: false, error: 'No posts found' };
  }

  // Find a post we haven't replied to
  let targetPost = null;
  for (const post of postData) {
    if (!checkReplied(post.postId)) {
      targetPost = post;
      break;
    }
  }

  if (!targetPost) {
    console.log('[Engagement] Already replied to all recent posts from', username);
    return { success: false, error: 'Already replied to recent posts' };
  }

  console.log('[Engagement] Found post to reply:', targetPost.postId);

  // Generate AI reply
  let replyText;
  try {
    const hasPersona = usePersona && personaBuilder.exists();
    const personaPrompt = hasPersona ? personaBuilder.getPromptForPlatform('twitter') : '';

    const generatePrompt = `Reply to this tweet from @${username}: "${targetPost.text}"

Requirements:
- Be genuine and add value to the conversation
- Keep it under 200 characters
- Don't use hashtags or emojis excessively
- Sound natural, not like a bot
- Just return the reply text, nothing else`;

    const result = await ai.generate(generatePrompt, {
      systemPrompt: personaPrompt || 'You are a helpful Twitter user who engages authentically.',
      maxTokens: 100
    });

    console.log('[Engagement] AI result:', JSON.stringify(result).substring(0, 200));

    if (!result.success) {
      console.error('[Engagement] AI generation failed:', result.error);
      return { success: false, error: result.error || 'AI generation failed' };
    }

    // Extract text from result - handle different response formats
    replyText = result.text || result.content || '';
    if (typeof replyText !== 'string') {
      console.error('[Engagement] Unexpected reply type:', typeof replyText);
      return { success: false, error: 'Invalid AI response format' };
    }
    // Clean up the reply
    replyText = replyText.replace(/^["']|["']$/g, '').trim();
  } catch (error) {
    console.error('[Engagement] AI generation error:', error);
    return { success: false, error: 'AI generation failed: ' + error.message };
  }

  if (!replyText || replyText.length < 5) {
    console.log('[Engagement] Reply too short:', replyText);
    return { success: false, error: 'Generated reply too short' };
  }

  console.log('[Engagement] Generated reply:', replyText.substring(0, 50) + '...');

  // Navigate to the tweet and reply
  await browserView.webContents.loadURL(targetPost.postUrl);
  await new Promise(resolve => setTimeout(resolve, 2500));

  // Click reply button and send reply
  const replyResult = await browserView.webContents.executeJavaScript(`
    (async function() {
      // Find and click the reply button
      const replyBtn = document.querySelector('[data-testid="reply"]');
      if (!replyBtn) {
        return { success: false, error: 'Reply button not found' };
      }
      replyBtn.click();
      await new Promise(r => setTimeout(r, 1500));
      return { success: true, clicked: true };
    })()
  `);

  if (!replyResult.success) {
    return replyResult;
  }

  // Wait for reply modal to open
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Focus the reply textarea
  const focusResult = await browserView.webContents.executeJavaScript(`
    (async function() {
      const selectors = [
        '[data-testid="tweetTextarea_0"]',
        'div[contenteditable="true"][role="textbox"]',
        '[aria-label="Post text"]',
        '[aria-label="Tweet text"]'
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

  await new Promise(resolve => setTimeout(resolve, 1500));

  // Click the reply/post button
  const sendResult = await browserView.webContents.executeJavaScript(`
    (async function() {
      await new Promise(r => setTimeout(r, 500));

      // Find the reply button in the modal
      const postBtnSelectors = [
        '[data-testid="tweetButton"]',
        '[data-testid="tweetButtonInline"]',
        'button[data-testid*="tweet"]'
      ];

      let postBtn = null;
      for (const selector of postBtnSelectors) {
        const btn = document.querySelector(selector);
        if (btn && btn.getAttribute('aria-disabled') !== 'true') {
          postBtn = btn;
          break;
        }
      }

      if (!postBtn) {
        return { success: false, error: 'Send button not found or disabled' };
      }

      postBtn.click();
      await new Promise(r => setTimeout(r, 2500));

      // Check if modal closed (success indicator)
      const modalStillOpen = document.querySelector('[data-testid="tweetTextarea_0"]');
      return { success: !modalStillOpen };
    })()
  `);

  if (sendResult.success) {
    // Mark as replied
    markReplied(targetPost.postId);
    console.log('[Engagement] Successfully replied to', targetPost.postUrl);
  }

  return {
    success: sendResult.success,
    postId: targetPost.postId,
    postUrl: targetPost.postUrl,
    reply: replyText
  };
}

// Search for topics and engage with posts
async function executeTopicSearchEngagement(searchQuery, maxResults, ai, usePersona, checkReplied, markReplied) {
  console.log('[Engagement] Searching for topic:', searchQuery);

  // Navigate to Twitter search (latest tab)
  const encodedQuery = encodeURIComponent(searchQuery);
  await browserView.webContents.loadURL(`https://x.com/search?q=${encodedQuery}&f=live`);
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Find posts to engage with
  const posts = await browserView.webContents.executeJavaScript(`
    (function() {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const posts = [];

      for (const article of articles) {
        const linkEl = article.querySelector('a[href*="/status/"]');
        if (!linkEl) continue;

        const postUrl = linkEl.href;
        const postId = postUrl.match(/status\\/(\\d+)/)?.[1];
        if (!postId) continue;

        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText : '';

        // Skip if no meaningful text
        if (text.length < 20) continue;

        const authorEl = article.querySelector('[data-testid="User-Name"]');
        const authorText = authorEl ? authorEl.innerText : '';
        const authorMatch = authorText.match(/@(\\w+)/);
        const author = authorMatch ? authorMatch[1] : '';

        posts.push({
          postId,
          postUrl,
          text: text.substring(0, 500),
          author
        });

        if (posts.length >= 10) break;
      }

      return posts;
    })()
  `);

  if (!posts || posts.length === 0) {
    console.log('[Engagement] No posts found for search:', searchQuery);
    return { success: false, error: 'No posts found', repliedCount: 0 };
  }

  console.log('[Engagement] Found', posts.length, 'posts for', searchQuery);

  let repliedCount = 0;
  let attemptCount = 0;
  let consecutiveFailures = 0;
  const maxAttempts = maxResults * 2; // Maximum attempts to prevent endless loop
  const maxConsecutiveFailures = 3;
  const results = [];

  // Engage with posts (up to maxResults)
  for (const post of posts) {
    if (repliedCount >= maxResults) {
      console.log('[Engagement] Reached max replies:', maxResults);
      break;
    }
    if (attemptCount >= maxAttempts) {
      console.log('[Engagement] Reached max attempts:', maxAttempts);
      break;
    }
    if (consecutiveFailures >= maxConsecutiveFailures) {
      console.log('[Engagement] Too many consecutive failures, stopping');
      break;
    }

    // Skip if already replied
    if (checkReplied(post.postId)) {
      console.log('[Engagement] Already replied to', post.postId);
      continue;
    }

    attemptCount++;
    console.log(`[Engagement] Attempt ${attemptCount}/${maxAttempts} for post:`, post.postId);

    // Generate AI reply
    let replyText;
    try {
      const hasPersona = usePersona && personaBuilder.exists();
      const personaPrompt = hasPersona ? personaBuilder.getPromptForPlatform('twitter') : '';

      const generatePrompt = `Reply to this tweet about "${searchQuery}" from @${post.author}: "${post.text}"

Requirements:
- Be relevant to the topic: ${searchQuery}
- Add value or insight to the conversation
- Keep it under 200 characters
- Sound natural and authentic
- Just return the reply text, nothing else`;

      const result = await ai.generate(generatePrompt, {
        systemPrompt: personaPrompt || 'You are a knowledgeable Twitter user who engages authentically.',
        maxTokens: 100
      });

      console.log('[Engagement] AI result for', post.postId, ':', JSON.stringify(result).substring(0, 200));

      if (!result.success) {
        console.error('[Engagement] AI failed for post:', post.postId, result.error);
        consecutiveFailures++;
        continue;
      }

      replyText = result.text || result.content || '';
      if (typeof replyText !== 'string') {
        console.error('[Engagement] Invalid reply type for', post.postId);
        consecutiveFailures++;
        continue;
      }
      replyText = replyText.replace(/^["']|["']$/g, '').trim();
    } catch (error) {
      console.error('[Engagement] AI generation error for post:', post.postId, error);
      consecutiveFailures++;
      continue;
    }

    if (!replyText || replyText.length < 5) {
      console.log('[Engagement] Reply too short for', post.postId, ':', replyText);
      consecutiveFailures++;
      continue;
    }

    // Navigate to the tweet
    await browserView.webContents.loadURL(post.postUrl);
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Click reply and send
    const replyResult = await browserView.webContents.executeJavaScript(`
      (async function() {
        const replyBtn = document.querySelector('[data-testid="reply"]');
        if (!replyBtn) {
          return { success: false, error: 'Reply button not found' };
        }
        replyBtn.click();
        await new Promise(r => setTimeout(r, 1500));
        return { success: true };
      })()
    `);

    if (!replyResult.success) {
      console.log('[Engagement] Could not click reply for', post.postId);
      consecutiveFailures++;
      continue;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Focus textarea
    const focusResult = await browserView.webContents.executeJavaScript(`
      (async function() {
        const selectors = [
          '[data-testid="tweetTextarea_0"]',
          'div[contenteditable="true"][role="textbox"]'
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            el.click();
            el.focus();
            return { success: true };
          }
        }
        return { success: false };
      })()
    `);

    if (!focusResult.success) {
      console.log('[Engagement] Could not focus textarea for', post.postId);
      consecutiveFailures++;
      continue;
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    // Insert text
    await browserView.webContents.debugger.sendCommand('Input.insertText', {
      text: replyText
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Send reply
    const sendResult = await browserView.webContents.executeJavaScript(`
      (async function() {
        await new Promise(r => setTimeout(r, 500));
        const postBtn = document.querySelector('[data-testid="tweetButton"]');
        if (postBtn && postBtn.getAttribute('aria-disabled') !== 'true') {
          postBtn.click();
          await new Promise(r => setTimeout(r, 2500));
          const modalOpen = document.querySelector('[data-testid="tweetTextarea_0"]');
          return { success: !modalOpen };
        }
        return { success: false };
      })()
    `);

    if (sendResult.success) {
      markReplied(post.postId);
      repliedCount++;
      consecutiveFailures = 0; // Reset on success
      results.push({
        postId: post.postId,
        postUrl: post.postUrl,
        reply: replyText
      });
      console.log('[Engagement] Successfully replied to', post.postUrl, `(${repliedCount}/${maxResults})`);

      // Rate limiting between replies
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('[Engagement] Failed to send reply for', post.postId);
      consecutiveFailures++;
    }
  }

  console.log(`[Engagement] Completed: ${repliedCount}/${maxResults} replies sent, ${attemptCount} attempts`);

  return {
    success: repliedCount > 0,
    repliedCount,
    attemptCount,
    results
  };
}

// Payment Popup Window
ipcMain.handle('openPaymentPopup', async () => {
  const paymentWindow = new BrowserWindow({
    width: 480,
    height: 700,
    parent: mainWindow,
    modal: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const paymentHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Upgrade Your Plan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    h1 { font-size: 16px; }
    .close-btn { background: none; border: none; color: #888; font-size: 24px; cursor: pointer; padding: 4px 8px; }
    .close-btn:hover { color: #e0e0e0; }

    /* Billing Toggle */
    .billing-toggle { display: flex; justify-content: center; gap: 8px; margin-bottom: 12px; align-items: center; }
    .billing-btn { padding: 6px 14px; border: 1px solid #2a2a2a; border-radius: 6px; background: #1a1a1a; cursor: pointer; font-size: 11px; color: #888; }
    .billing-btn.active { border-color: #6366f1; background: #1f1f3d; color: #e0e0e0; }
    .billing-btn:hover { border-color: #6366f1; }
    .save-badge { background: #22c55e; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; }

    /* Tier Tabs */
    .tier-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
    .tier-tab { flex: 1; padding: 8px 6px; border: 1px solid #2a2a2a; border-radius: 8px; background: #1a1a1a; cursor: pointer; text-align: center; }
    .tier-tab:hover { border-color: #6366f1; }
    .tier-tab.active { border-color: #6366f1; background: #1f1f3d; }
    .tier-name { font-size: 11px; font-weight: 600; margin-bottom: 2px; }
    .tier-price { font-size: 13px; color: #6366f1; font-weight: 600; }
    .tier-tab.active .tier-price { color: #818cf8; }
    .tier-save { font-size: 9px; color: #22c55e; margin-top: 2px; }

    /* Features */
    .features { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; font-size: 10px; }
    .features ul { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
    .features li::before { content: "✓ "; color: #22c55e; }

    /* Payment sections */
    .section { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
    .section-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; }
    .fee { font-size: 9px; color: #22c55e; }
    .label { font-size: 9px; color: #888; margin-bottom: 2px; }
    .value-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .value { flex: 1; font-size: 10px; background: #0f0f0f; padding: 5px 6px; border-radius: 4px; word-break: break-all; font-family: monospace; user-select: all; }
    .copy-btn { background: #6366f1; color: white; border: none; padding: 3px 6px; border-radius: 4px; font-size: 9px; cursor: pointer; }
    .copy-btn:hover { background: #818cf8; }
    .copy-btn.copied { background: #22c55e; }

    .note { font-size: 9px; color: #888; text-align: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid #2a2a2a; }
    .note a { color: #6366f1; }
    .selected-amount { text-align: center; font-size: 11px; color: #f59e0b; margin-bottom: 10px; padding: 6px; background: #1a1a0a; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>💎 Upgrade Your Plan</h1>
    <button class="close-btn" onclick="window.close()">&times;</button>
  </div>

  <div class="billing-toggle">
    <button class="billing-btn active" id="btn-monthly" onclick="setBilling('monthly')">Monthly</button>
    <button class="billing-btn" id="btn-yearly" onclick="setBilling('yearly')">Yearly</button>
    <span class="save-badge">Save up to 16%</span>
  </div>

  <div class="tier-tabs">
    <div class="tier-tab" onclick="selectTier('starter')" id="tab-starter">
      <div class="tier-name">Starter</div>
      <div class="tier-price" id="price-starter">$14.99/mo</div>
      <div class="tier-save" id="save-starter"></div>
    </div>
    <div class="tier-tab active" onclick="selectTier('pro')" id="tab-pro">
      <div class="tier-name">Pro ⭐</div>
      <div class="tier-price" id="price-pro">$49/mo</div>
      <div class="tier-save" id="save-pro"></div>
    </div>
    <div class="tier-tab" onclick="selectTier('agency')" id="tab-agency">
      <div class="tier-name">Agency</div>
      <div class="tier-price" id="price-agency">$99/mo</div>
      <div class="tier-save" id="save-agency"></div>
    </div>
  </div>

  <div class="features" id="features-starter" style="display:none;">
    <ul>
      <li>5 posts/day</li>
      <li>Post scheduling</li>
      <li>3 tracked accounts</li>
      <li>Email support</li>
    </ul>
  </div>
  <div class="features" id="features-pro">
    <ul>
      <li>10 posts/day</li>
      <li>Post scheduling</li>
      <li>AI generation (50/day)</li>
      <li>10 tracked accounts</li>
      <li>Knowledge base</li>
      <li>Priority support</li>
    </ul>
  </div>
  <div class="features" id="features-agency" style="display:none;">
    <ul>
      <li>30 posts/day</li>
      <li>Post scheduling</li>
      <li>AI generation (200/day)</li>
      <li>50 tracked accounts</li>
      <li>Knowledge base</li>
      <li>Dedicated support</li>
    </ul>
  </div>

  <div class="selected-amount">💰 Send: <span id="amount">$49 USD</span> <span id="period">(1 month)</span></div>

  <div class="section">
    <div class="section-title">🪙 USDC/USDT <span class="fee">~0% fee</span></div>
    <div class="label">USDT (TRC20):</div>
    <div class="value-row">
      <div class="value" id="usdt-addr">TJpXLr33FAK322tpdgHzxTRs4GAdUGy87M</div>
      <button class="copy-btn" onclick="copyText('usdt-addr', this)">Copy</button>
    </div>
    <div class="label">USDC (Solana):</div>
    <div class="value-row">
      <div class="value" id="usdc-addr">9ung8ZvgFYbgMC4uj9TqkLZm6SiNsXhmbZY6VhhTaxdk</div>
      <button class="copy-btn" onclick="copyText('usdc-addr', this)">Copy</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">🏦 Wise <span class="fee">~1% fee</span></div>
    <div class="value-row">
      <div class="value" id="wise-info">YI CHEN CHU | 573002996611255 | Routing: 084009519 | SWIFT: TRWIUS35XXX</div>
      <button class="copy-btn" onclick="copyText('wise-info', this)">Copy</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">💳 PayPal <span class="fee">~4.4% fee</span></div>
    <div class="value-row">
      <div class="value" id="paypal-info">lman.chu@gmail.com (or @lmanchu)</div>
      <button class="copy-btn" onclick="copyText('paypal-info', this)">Copy</button>
    </div>
  </div>

  <div class="note">
    After payment, send receipt to <a href="mailto:lman.chu@gmail.com">lman.chu@gmail.com</a> or DM <a href="https://twitter.com/lmanchu" target="_blank">@lmanchu</a><br>
    Your account will be upgraded within 24 hours.
  </div>

  <script>
    const pricing = {
      monthly: { starter: 14.99, pro: 49, agency: 99 },
      yearly: { starter: 170, pro: 550, agency: 1000 }
    };
    const savings = { starter: '$10', pro: '$38', agency: '$188' };

    let currentBilling = 'monthly';
    let currentTier = 'pro';

    function setBilling(billing) {
      currentBilling = billing;
      document.getElementById('btn-monthly').classList.toggle('active', billing === 'monthly');
      document.getElementById('btn-yearly').classList.toggle('active', billing === 'yearly');
      updatePrices();
      updateAmount();
    }

    function updatePrices() {
      const isYearly = currentBilling === 'yearly';
      ['starter', 'pro', 'agency'].forEach(tier => {
        const price = pricing[currentBilling][tier];
        const suffix = isYearly ? '/yr' : '/mo';
        document.getElementById('price-' + tier).textContent = '$' + price + suffix;
        document.getElementById('save-' + tier).textContent = isYearly ? 'Save ' + savings[tier] : '';
      });
    }

    function selectTier(tier) {
      currentTier = tier;
      document.querySelectorAll('.tier-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + tier).classList.add('active');
      document.querySelectorAll('.features').forEach(f => f.style.display = 'none');
      document.getElementById('features-' + tier).style.display = 'block';
      updateAmount();
    }

    function updateAmount() {
      const price = pricing[currentBilling][currentTier];
      const period = currentBilling === 'yearly' ? '(1 year)' : '(1 month)';
      document.getElementById('amount').textContent = '$' + price + ' USD';
      document.getElementById('period').textContent = period;
    }

    function copyText(id, btn) {
      const text = document.getElementById(id).textContent;
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      } catch(e) {
        btn.textContent = 'Select & Cmd+C';
      }
      document.body.removeChild(textarea);
    }
  </script>
</body>
</html>
  `;

  paymentWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(paymentHTML));
  return { success: true };
});

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

  // Connect AI provider to tracked accounts for auto-classification
  trackedAccountsManager.setAIProvider(aiProvider);

  // Initialize automation manager
  automationManager.init({
    aiProvider,
    trackedAccountsManager,
    scheduler,
    onExecutePost: async (platform, content) => {
      if (platform === 'twitter') {
        return executeScheduledJob({ platform, content });
      }
      return { success: false, error: 'Platform not supported' };
    },
    onExecuteEngagement: async (options) => {
      // Browser automation for engagement
      return executeEngagementTask(options);
    },
    onNotify: (notification) => {
      console.log('[Automation] Notification:', notification.title, notification.message);
      if (mainWindow) {
        mainWindow.webContents.send('automation-notification', notification);
      }
    }
  });
  console.log('[Pulsar] Automation system initialized');

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
