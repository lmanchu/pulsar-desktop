#!/usr/bin/env node
/**
 * Supabase Configuration Setup Script
 * Run: node scripts/setup-supabase.js <anon-key>
 *
 * This creates the supabase-config.json in the Electron userData directory
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Get userData path (same as Electron's app.getPath('userData'))
function getUserDataPath() {
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

// Default Supabase URL (public, safe to include)
const SUPABASE_URL = 'https://zezdqsgfbkatupsxibaw.supabase.co';

// Get anon key from command line argument
const anonKey = process.argv[2];

if (!anonKey) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║         Pulsar Desktop - Supabase Configuration Setup          ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Usage: node scripts/setup-supabase.js <anon-key>              ║
║                                                                ║
║  Get your anon key from:                                       ║
║  https://supabase.com/dashboard/project/zezdqsgfbkatupsxibaw   ║
║  → Settings → API Keys → anon (public)                         ║
║                                                                ║
║  Example:                                                      ║
║  node scripts/setup-supabase.js eyJhbGciOiJIUzI1NiIs...        ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// Validate anon key format (should be JWT)
if (!anonKey.startsWith('eyJ')) {
  console.error('❌ Error: Invalid anon key format. Should start with "eyJ" (JWT format)');
  console.log('   Get the legacy anon key from Supabase dashboard');
  process.exit(1);
}

const userDataPath = getUserDataPath();
const configPath = path.join(userDataPath, 'supabase-config.json');

// Create userData directory if it doesn't exist
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
  console.log(`📁 Created directory: ${userDataPath}`);
}

// Write config file
const config = {
  url: SUPABASE_URL,
  anonKey: anonKey
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log(`
✅ Supabase configuration saved!

📄 Config file: ${configPath}
🔗 Supabase URL: ${SUPABASE_URL}
🔑 Anon Key: ${anonKey.substring(0, 20)}...

You can now run the app with: npm start
`);
