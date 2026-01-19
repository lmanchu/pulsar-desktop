/**
 * Subscription Manager for Pulsar Desktop
 * Handles Stripe checkout and subscription management
 */

const { ipcMain, shell, BrowserWindow } = require('electron');
const supabaseClient = require('../api/supabase-client');

class SubscriptionManager {
  constructor() {
    this.mainWindow = null;
  }

  setMainWindow(window) {
    this.mainWindow = window;
  }

  // Get current subscription info
  async getSubscription() {
    return supabaseClient.getSubscriptionInfo();
  }

  // Check if user is Pro
  async isPro() {
    const info = await this.getSubscription();
    return info?.subscription_tier === 'pro' &&
           info?.subscription_status === 'active';
  }

  // Create Stripe checkout session for upgrade
  async createCheckout() {
    if (!supabaseClient.isAuthenticated()) {
      return { success: false, error: 'Please log in first' };
    }

    try {
      const result = await supabaseClient.createCheckoutSession();

      if (result.url) {
        // Open checkout URL in default browser
        shell.openExternal(result.url);
        return { success: true, url: result.url };
      }

      return { success: false, error: 'Failed to create checkout session' };
    } catch (error) {
      console.error('[Subscription] Checkout failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Create Stripe portal session for managing subscription
  async createPortal() {
    if (!supabaseClient.isAuthenticated()) {
      return { success: false, error: 'Please log in first' };
    }

    try {
      const result = await supabaseClient.createPortalSession();

      if (result.url) {
        // Open portal URL in default browser
        shell.openExternal(result.url);
        return { success: true, url: result.url };
      }

      return { success: false, error: 'Failed to create portal session' };
    } catch (error) {
      console.error('[Subscription] Portal failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Get tier comparison for upgrade modal
  getTierComparison() {
    return {
      free: {
        name: 'Free',
        price: '$0',
        features: [
          '3 posts per day',
          '1 social account',
          'Basic posting'
        ],
        limitations: [
          'No scheduling',
          'No AI generation',
          'No tracked accounts',
          'No knowledge base'
        ]
      },
      pro: {
        name: 'Pro',
        price: '$9.99/month',
        features: [
          '30 posts per day',
          '10 social accounts',
          'Scheduled posting',
          '50 AI generations/day',
          '100 tracked accounts',
          'Knowledge base',
          'Priority support'
        ],
        recommended: true
      }
    };
  }

  // Initialize IPC handlers
  initIPCHandlers() {
    // Get subscription info
    ipcMain.handle('subscription:getInfo', async () => {
      return this.getSubscription();
    });

    // Check if Pro
    ipcMain.handle('subscription:isPro', async () => {
      return this.isPro();
    });

    // Create checkout session
    ipcMain.handle('subscription:createCheckout', async () => {
      return this.createCheckout();
    });

    // Create portal session
    ipcMain.handle('subscription:createPortal', async () => {
      return this.createPortal();
    });

    // Get tier comparison
    ipcMain.handle('subscription:getTierComparison', () => {
      return this.getTierComparison();
    });
  }
}

module.exports = new SubscriptionManager();
