#!/usr/bin/env node
/**
 * Admin Script: Manually Upgrade User Subscription
 *
 * Usage:
 *   node scripts/admin-upgrade.js <user_email> <tier>
 *
 * Examples:
 *   node scripts/admin-upgrade.js user@example.com pro
 *   node scripts/admin-upgrade.js user@example.com starter
 *   node scripts/admin-upgrade.js user@example.com agency
 *   node scripts/admin-upgrade.js user@example.com free    # downgrade
 *
 * Valid tiers: free, starter, pro, agency
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Get config path (same as Electron's app.getPath('userData'))
function getConfigPath() {
  const appName = 'pulsar-desktop';
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName);
    case 'win32':
      return path.join(process.env.APPDATA || os.homedir(), appName);
    default:
      return path.join(os.homedir(), '.config', appName);
  }
}

// Load Supabase config
function loadSupabaseConfig() {
  const configPath = path.join(getConfigPath(), 'supabase-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Error: Supabase config not found at:', configPath);
    console.log('Run the app first to configure Supabase.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Validate tier
const VALID_TIERS = ['free', 'starter', 'pro', 'agency'];

async function upgradeUser(email, tier) {
  if (!VALID_TIERS.includes(tier)) {
    console.error(`Error: Invalid tier "${tier}". Valid tiers: ${VALID_TIERS.join(', ')}`);
    process.exit(1);
  }

  const config = loadSupabaseConfig();
  const baseUrl = config.url;
  const apiKey = config.anonKey;

  console.log(`\nUpgrading user: ${email}`);
  console.log(`New tier: ${tier}`);
  console.log(`Supabase URL: ${baseUrl}\n`);

  try {
    // First, find the user by email
    const searchUrl = `${baseUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,subscription_tier`;

    const searchResponse = await fetch(searchUrl, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!searchResponse.ok) {
      const error = await searchResponse.text();
      throw new Error(`Failed to search users: ${error}`);
    }

    const users = await searchResponse.json();

    if (users.length === 0) {
      console.error(`Error: User with email "${email}" not found in database.`);
      console.log('\nThe user needs to log in to the app at least once before they can be upgraded.');
      process.exit(1);
    }

    const user = users[0];
    console.log(`Found user: ${user.id}`);
    console.log(`Current tier: ${user.subscription_tier || 'free'}`);

    // Update the user's subscription tier
    const updateUrl = `${baseUrl}/rest/v1/users?id=eq.${user.id}`;

    const now = new Date().toISOString();
    const updateData = {
      subscription_tier: tier,
      subscription_status: tier === 'free' ? 'inactive' : 'active',
      subscription_started_at: tier === 'free' ? null : now,
      subscription_ends_at: null, // Manual subscriptions don't auto-expire
      updated_at: now
    };

    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updateData)
    });

    if (!updateResponse.ok) {
      const error = await updateResponse.text();
      throw new Error(`Failed to update user: ${error}`);
    }

    const updatedUsers = await updateResponse.json();

    if (updatedUsers.length > 0) {
      console.log(`\n✅ Success! User upgraded to ${tier}`);
      console.log(`User ID: ${updatedUsers[0].id}`);
      console.log(`Email: ${updatedUsers[0].email}`);
      console.log(`New Tier: ${updatedUsers[0].subscription_tier}`);
      console.log(`\nThe user should logout and login again to see the changes.`);
    } else {
      console.log('\n⚠️ Update may have failed. Please check the database.');
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           Pulsar Desktop - Admin User Upgrade Tool             ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Usage:                                                        ║
║    node scripts/admin-upgrade.js <email> <tier>                ║
║                                                                ║
║  Valid tiers: free, starter, pro, agency                       ║
║                                                                ║
║  Examples:                                                     ║
║    node scripts/admin-upgrade.js user@example.com pro          ║
║    node scripts/admin-upgrade.js user@example.com starter      ║
║    node scripts/admin-upgrade.js user@example.com free         ║
║                                                                ║
║  Tier Features:                                                ║
║    free    - 3 posts/day, basic features                       ║
║    starter - 5 posts/day, scheduling, 3 tracked accounts       ║
║    pro     - 10 posts/day, KB, 10 tracked accounts             ║
║    agency  - 30 posts/day, full suite, 50 tracked accounts     ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
  process.exit(0);
}

const [email, tier] = args;
upgradeUser(email, tier.toLowerCase());
