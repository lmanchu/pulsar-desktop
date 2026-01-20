/**
 * Auth Manager for Pulsar Desktop
 * Handles Clerk OAuth flow, session management, and login state
 * Uses Clerk as third-party auth provider for Supabase
 */

const { BrowserWindow, ipcMain } = require('electron');
const supabaseClient = require('../api/supabase-client');

// Clerk configuration
const CLERK_DOMAIN = 'https://active-snipe-51.accounts.dev';
const CLERK_SIGN_IN_URL = `${CLERK_DOMAIN}/sign-in`;

class AuthManager {
  constructor() {
    this.authWindow = null;
    this.mainWindow = null;
  }

  // Set main window reference for sending events
  setMainWindow(window) {
    this.mainWindow = window;
  }

  // Check if user is logged in
  isAuthenticated() {
    return supabaseClient.isAuthenticated();
  }

  // Get current user
  getUser() {
    return supabaseClient.getUser();
  }

  // Get subscription info
  async getSubscriptionInfo() {
    return supabaseClient.getSubscriptionInfo();
  }

  // Start Clerk OAuth flow
  async startOAuth(provider) {
    return new Promise((resolve, reject) => {
      // Check if Supabase is configured
      if (!supabaseClient.isConfigured()) {
        reject(new Error('Supabase not configured. Please set up your Supabase project first.'));
        return;
      }

      // Close existing auth window if any
      if (this.authWindow) {
        this.authWindow.close();
      }

      // Use Clerk's sign-in URL
      const authUrl = CLERK_SIGN_IN_URL;

      // Create auth window
      this.authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: true,
        modal: true,
        parent: this.mainWindow,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      this.authWindow.loadURL(authUrl);

      // Track if we've already resolved
      let resolved = false;

      // Check for successful login by monitoring page content
      const checkLoginSuccess = async () => {
        if (resolved) return;

        try {
          // Check if page shows "Welcome" (login success indicator)
          const pageContent = await this.authWindow.webContents.executeJavaScript(`
            document.body ? document.body.innerText : ''
          `);

          if (pageContent && pageContent.includes('Welcome')) {
            // User is logged in! Try to get session info
            const sessionData = await this.authWindow.webContents.executeJavaScript(`
              (async () => {
                try {
                  // Try multiple ways to get Clerk data
                  if (window.Clerk && window.Clerk.user) {
                    let token = null;
                    try {
                      token = await window.Clerk.session.getToken({ template: 'supabase' });
                    } catch (e) {
                      token = await window.Clerk.session.getToken();
                    }
                    return {
                      success: true,
                      token: token,
                      user: {
                        id: window.Clerk.user.id,
                        email: window.Clerk.user.primaryEmailAddress?.emailAddress,
                        firstName: window.Clerk.user.firstName,
                        lastName: window.Clerk.user.lastName,
                        imageUrl: window.Clerk.user.imageUrl
                      }
                    };
                  }

                  // Fallback: try to get from __clerk_client_js
                  if (window.__clerk_client_js) {
                    const client = window.__clerk_client_js;
                    if (client.session) {
                      const token = await client.session.getToken();
                      return {
                        success: true,
                        token: token,
                        user: client.user ? {
                          id: client.user.id,
                          email: client.user.primaryEmailAddress?.emailAddress
                        } : null
                      };
                    }
                  }

                  return { success: false, error: 'No Clerk session found' };
                } catch (e) {
                  return { success: false, error: e.message };
                }
              })()
            `);

            resolved = true;
            clearInterval(checkInterval);

            if (sessionData && sessionData.success && sessionData.token) {
              // Handle the Clerk token
              const result = await supabaseClient.handleClerkToken(sessionData.token);

              if (this.authWindow) {
                this.authWindow.close();
                this.authWindow = null;
              }

              if (result.success) {
                if (this.mainWindow) {
                  this.mainWindow.webContents.send('auth-state-changed', {
                    authenticated: true,
                    user: result.user
                  });
                }
                resolve(result);
              } else {
                reject(new Error(result.error));
              }
            } else {
              // Logged in but couldn't get token - still close window and report partial success
              console.log('[Auth] Logged in but could not get Clerk token:', sessionData?.error);

              if (this.authWindow) {
                this.authWindow.close();
                this.authWindow = null;
              }

              reject(new Error('Logged in but could not retrieve session token. Please try again.'));
            }
          }
        } catch (error) {
          // Window might be closed or navigating, ignore errors
        }
      };

      // Start polling after page loads
      let checkInterval = null;
      this.authWindow.webContents.on('did-finish-load', () => {
        if (!checkInterval) {
          checkInterval = setInterval(checkLoginSuccess, 1500);
        }
      });

      // Handle window closed by user
      this.authWindow.on('closed', () => {
        if (checkInterval) clearInterval(checkInterval);
        this.authWindow = null;
        reject(new Error('Authentication cancelled'));
      });

      // Handle load failures
      this.authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Auth] Load failed:', errorCode, errorDescription);
        if (checkInterval) clearInterval(checkInterval);
        if (this.authWindow) {
          this.authWindow.close();
          this.authWindow = null;
        }
        reject(new Error(`Failed to load auth page: ${errorDescription}`));
      });
    });
  }

  // Sign out
  async signOut() {
    const result = await supabaseClient.signOut();

    if (this.mainWindow) {
      this.mainWindow.webContents.send('auth-state-changed', {
        authenticated: false,
        user: null
      });
    }

    return result;
  }

  // Refresh session
  async refreshSession() {
    return supabaseClient.refreshSession();
  }

  // Initialize IPC handlers
  initIPCHandlers() {
    // Check auth state
    ipcMain.handle('auth:isAuthenticated', () => {
      return this.isAuthenticated();
    });

    // Get current user
    ipcMain.handle('auth:getUser', () => {
      return this.getUser();
    });

    // Get subscription info
    ipcMain.handle('auth:getSubscriptionInfo', async () => {
      return this.getSubscriptionInfo();
    });

    // Start OAuth login
    ipcMain.handle('auth:login', async (event, provider) => {
      try {
        const result = await this.startOAuth(provider || 'google');
        return { success: true, user: result.user };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Sign out
    ipcMain.handle('auth:logout', async () => {
      return this.signOut();
    });

    // Refresh session
    ipcMain.handle('auth:refresh', async () => {
      return this.refreshSession();
    });

    // Configure Supabase
    ipcMain.handle('auth:configure', async (event, { url, anonKey }) => {
      supabaseClient.setConfig(url, anonKey);
      return { success: true };
    });

    // Check if Supabase is configured
    ipcMain.handle('auth:isConfigured', () => {
      return supabaseClient.isConfigured();
    });
  }
}

module.exports = new AuthManager();
