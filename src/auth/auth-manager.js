/**
 * Auth Manager for Pulsar Desktop
 * Handles OAuth flow, session management, and login state
 */

const { BrowserWindow, ipcMain } = require('electron');
const supabaseClient = require('../api/supabase-client');

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

  // Start OAuth flow
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

      // Get OAuth URL
      const authUrl = supabaseClient.getOAuthUrl(provider);

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

      // Handle redirect
      const handleNavigation = async (url) => {
        if (url.startsWith('pulsar://auth/callback')) {
          const result = await supabaseClient.handleOAuthCallback(url);

          if (this.authWindow) {
            this.authWindow.close();
            this.authWindow = null;
          }

          if (result.success) {
            // Notify main window
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
        }
      };

      // Listen for navigation
      this.authWindow.webContents.on('will-navigate', (event, url) => {
        handleNavigation(url);
      });

      this.authWindow.webContents.on('will-redirect', (event, url) => {
        handleNavigation(url);
      });

      // Handle window closed by user
      this.authWindow.on('closed', () => {
        this.authWindow = null;
        reject(new Error('Authentication cancelled'));
      });

      // Handle load failures
      this.authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[Auth] Load failed:', errorCode, errorDescription);
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
