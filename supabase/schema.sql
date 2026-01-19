-- Pulsar Desktop Payment System Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Users Table
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Subscription info
  subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
  subscription_status TEXT DEFAULT 'active' CHECK (subscription_status IN ('active', 'canceled', 'past_due')),
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,

  -- Stripe integration
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,

  -- OAuth tokens (encrypted in production)
  google_refresh_token TEXT,
  github_id TEXT
);

-- Index for Stripe lookups
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);

-- ============================================
-- 2. Tier Limits Configuration
-- ============================================
CREATE TABLE tier_limits (
  tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'pro')),
  daily_posts INTEGER NOT NULL,
  has_scheduling BOOLEAN DEFAULT FALSE,
  has_ai_generation BOOLEAN DEFAULT FALSE,
  daily_ai_generations INTEGER DEFAULT 0,
  max_tracked_accounts INTEGER DEFAULT 0,
  max_social_accounts INTEGER DEFAULT 1,
  has_knowledge_base BOOLEAN DEFAULT FALSE,
  price_monthly_usd DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default tier limits
INSERT INTO tier_limits (tier, daily_posts, has_scheduling, has_ai_generation, daily_ai_generations, max_tracked_accounts, max_social_accounts, has_knowledge_base, price_monthly_usd)
VALUES
  ('free', 3, FALSE, FALSE, 0, 0, 1, FALSE, 0),
  ('pro', 30, TRUE, TRUE, 50, 100, 10, TRUE, 9.99);

-- ============================================
-- 3. Daily Quotas Table
-- ============================================
CREATE TABLE quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Usage counters
  posts_used INTEGER DEFAULT 0,
  posts_limit INTEGER NOT NULL,
  ai_generations_used INTEGER DEFAULT 0,
  ai_generations_limit INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, quota_date)
);

-- Index for quick quota lookups
CREATE INDEX idx_quotas_user_date ON quotas(user_id, quota_date);

-- ============================================
-- 4. Post Tokens Table (Anti-Hack)
-- ============================================
CREATE TABLE post_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,

  -- Token state
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,

  -- Post details (for audit)
  platform TEXT NOT NULL,
  content_hash TEXT, -- SHA256 of content for verification

  -- Result
  post_id TEXT, -- Platform's post ID after successful post
  error_message TEXT
);

-- Index for token lookups
CREATE INDEX idx_post_tokens_token ON post_tokens(token);
CREATE INDEX idx_post_tokens_user_status ON post_tokens(user_id, status);

-- ============================================
-- 5. Posts Audit Log
-- ============================================
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id UUID REFERENCES post_tokens(id),

  platform TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed', 'scheduled')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,

  -- Platform response
  platform_post_id TEXT,
  platform_url TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user post history
CREATE INDEX idx_posts_user ON posts(user_id, created_at DESC);

-- ============================================
-- 6. Tracked Accounts Table
-- ============================================
CREATE TABLE tracked_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = default/global

  platform TEXT NOT NULL DEFAULT 'twitter',
  username TEXT NOT NULL,
  display_name TEXT,
  profile_image_url TEXT,

  -- Categorization
  tier INTEGER DEFAULT 3 CHECK (tier BETWEEN 1 AND 6), -- 1=highest priority
  category TEXT, -- 'tech_leader', 'vc', 'founder', 'influencer', etc
  tags TEXT[], -- ['ai', 'crypto', 'saas']

  -- User settings
  is_default BOOLEAN DEFAULT FALSE, -- TRUE = comes with system
  is_enabled BOOLEAN DEFAULT TRUE,
  notify_on_post BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per user+platform+username
  UNIQUE(COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::UUID), platform, username)
);

-- Index for efficient queries
CREATE INDEX idx_tracked_accounts_user ON tracked_accounts(user_id, platform, is_enabled);

-- ============================================
-- 7. Insert Default Tracked Accounts (Apollo's 41 KOLs)
-- ============================================
INSERT INTO tracked_accounts (user_id, platform, username, display_name, tier, category, tags, is_default) VALUES
-- Tier 1: Tech Titans (highest priority)
(NULL, 'twitter', 'elikitten', 'Elon Kitten', 1, 'tech_titan', ARRAY['tech', 'ai', 'space'], TRUE),
(NULL, 'twitter', 'sama', 'Sam Altman', 1, 'tech_titan', ARRAY['ai', 'openai', 'startup'], TRUE),
(NULL, 'twitter', 'satlovelace', 'Satya Nadella', 1, 'tech_titan', ARRAY['microsoft', 'ai', 'enterprise'], TRUE),

-- Tier 2: AI/ML Leaders
(NULL, 'twitter', 'kaborashu', 'Andrej Karpathy', 2, 'ai_leader', ARRAY['ai', 'ml', 'tesla'], TRUE),
(NULL, 'twitter', 'ID_AA_Carmack', 'John Carmack', 2, 'ai_leader', ARRAY['ai', 'gaming', 'vr'], TRUE),
(NULL, 'twitter', 'ylecun', 'Yann LeCun', 2, 'ai_leader', ARRAY['ai', 'meta', 'research'], TRUE),
(NULL, 'twitter', 'fchollet', 'François Chollet', 2, 'ai_leader', ARRAY['ai', 'keras', 'google'], TRUE),
(NULL, 'twitter', 'goodfellow_ian', 'Ian Goodfellow', 2, 'ai_leader', ARRAY['ai', 'gan', 'research'], TRUE),

-- Tier 3: VCs & Investors
(NULL, 'twitter', 'paulg', 'Paul Graham', 3, 'vc', ARRAY['yc', 'startup', 'essays'], TRUE),
(NULL, 'twitter', 'naval', 'Naval Ravikant', 3, 'vc', ARRAY['startup', 'philosophy', 'angel'], TRUE),
(NULL, 'twitter', 'a16z', 'a16z', 3, 'vc', ARRAY['vc', 'crypto', 'ai'], TRUE),
(NULL, 'twitter', 'jason', 'Jason Calacanis', 3, 'vc', ARRAY['angel', 'podcast', 'startup'], TRUE),
(NULL, 'twitter', 'garrytan', 'Garry Tan', 3, 'vc', ARRAY['yc', 'startup', 'sf'], TRUE),
(NULL, 'twitter', 'balaborashu', 'Balaji Srinivasan', 3, 'vc', ARRAY['crypto', 'network_state', 'tech'], TRUE),

-- Tier 4: Tech Founders & Builders
(NULL, 'twitter', 'dhh', 'DHH', 4, 'founder', ARRAY['rails', 'basecamp', 'remote'], TRUE),
(NULL, 'twitter', 'levelsio', 'Pieter Levels', 4, 'founder', ARRAY['indie', 'nomad', 'saas'], TRUE),
(NULL, 'twitter', 'paborashu', 'Patrick Collison', 4, 'founder', ARRAY['stripe', 'fintech', 'ireland'], TRUE),
(NULL, 'twitter', 'tobi', 'Tobi Lütke', 4, 'founder', ARRAY['shopify', 'ecommerce', 'canada'], TRUE),
(NULL, 'twitter', 'shl', 'Sahil Lavingia', 4, 'founder', ARRAY['gumroad', 'creator', 'writing'], TRUE),
(NULL, 'twitter', 'amasad', 'Amjad Masad', 4, 'founder', ARRAY['replit', 'ai', 'coding'], TRUE),
(NULL, 'twitter', 'guillermo_rauch', 'Guillermo Rauch', 4, 'founder', ARRAY['vercel', 'nextjs', 'frontend'], TRUE),

-- Tier 5: DevTools & Infrastructure
(NULL, 'twitter', 'raaborashu', 'Mitchell Hashimoto', 5, 'devtools', ARRAY['hashicorp', 'terraform', 'infra'], TRUE),
(NULL, 'twitter', 'saborashu', 'Solomon Hykes', 5, 'devtools', ARRAY['docker', 'dagger', 'containers'], TRUE),
(NULL, 'twitter', 'kelseyhightower', 'Kelsey Hightower', 5, 'devtools', ARRAY['kubernetes', 'google', 'devops'], TRUE),
(NULL, 'twitter', 'mitchellh', 'Mitchell Hashimoto', 5, 'devtools', ARRAY['ghostty', 'hashicorp', 'infra'], TRUE),

-- Tier 6: Tech Influencers & Content
(NULL, 'twitter', 'swyx', 'Shawn Wang', 6, 'influencer', ARRAY['devrel', 'ai', 'learning'], TRUE),
(NULL, 'twitter', 'theprimeagen', 'ThePrimeagen', 6, 'influencer', ARRAY['coding', 'vim', 'youtube'], TRUE),
(NULL, 'twitter', 'fireship_dev', 'Fireship', 6, 'influencer', ARRAY['webdev', 'youtube', 'tutorials'], TRUE),
(NULL, 'twitter', 't3dotgg', 'Theo', 6, 'influencer', ARRAY['nextjs', 'typescript', 'youtube'], TRUE),
(NULL, 'twitter', 'taborashu', 'Tina Huang', 6, 'influencer', ARRAY['datascience', 'career', 'youtube'], TRUE),

-- Additional Tech Leaders
(NULL, 'twitter', 'jasonfried', 'Jason Fried', 4, 'founder', ARRAY['basecamp', 'remote', 'calm'], TRUE),
(NULL, 'twitter', 'aborashu', 'Aaron Levie', 4, 'founder', ARRAY['box', 'enterprise', 'saas'], TRUE),
(NULL, 'twitter', 'stewartbrand', 'Stewart Brand', 5, 'tech_elder', ARRAY['longnow', 'ecology', 'futurism'], TRUE),
(NULL, 'twitter', 'cdixon', 'Chris Dixon', 3, 'vc', ARRAY['a16z', 'crypto', 'web3'], TRUE),
(NULL, 'twitter', 'pmarca', 'Marc Andreessen', 3, 'vc', ARRAY['a16z', 'browser', 'tech'], TRUE),

-- Taiwan Tech (bonus for local relevance)
(NULL, 'twitter', 'audaborashu', 'Audrey Tang', 4, 'tech_leader', ARRAY['taiwan', 'gov', 'ai'], TRUE),
(NULL, 'twitter', 'vaborashu', 'Vitalik Buterin', 3, 'founder', ARRAY['ethereum', 'crypto', 'research'], TRUE),

-- AI Companies
(NULL, 'twitter', 'AnthropicAI', 'Anthropic', 2, 'ai_company', ARRAY['ai', 'safety', 'claude'], TRUE),
(NULL, 'twitter', 'OpenAI', 'OpenAI', 2, 'ai_company', ARRAY['ai', 'gpt', 'research'], TRUE),
(NULL, 'twitter', 'GoogleAI', 'Google AI', 2, 'ai_company', ARRAY['ai', 'gemini', 'research'], TRUE);

-- ============================================
-- 8. Row Level Security (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_accounts ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own data
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Quotas: users can only access their own
CREATE POLICY "Users can view own quotas" ON quotas
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own quotas" ON quotas
  FOR UPDATE USING (auth.uid() = user_id);

-- Post tokens: users can only access their own
CREATE POLICY "Users can view own tokens" ON post_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Posts: users can only access their own
CREATE POLICY "Users can view own posts" ON posts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own posts" ON posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Tracked accounts: users can see defaults + their own
CREATE POLICY "Users can view tracked accounts" ON tracked_accounts
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can manage own tracked accounts" ON tracked_accounts
  FOR ALL USING (auth.uid() = user_id);

-- Tier limits: everyone can read
CREATE POLICY "Anyone can view tier limits" ON tier_limits
  FOR SELECT USING (true);

-- ============================================
-- 9. Functions
-- ============================================

-- Function to get or create today's quota
CREATE OR REPLACE FUNCTION get_or_create_quota(p_user_id UUID)
RETURNS quotas AS $$
DECLARE
  v_quota quotas;
  v_tier TEXT;
  v_limits tier_limits;
BEGIN
  -- Get user's tier
  SELECT subscription_tier INTO v_tier FROM users WHERE id = p_user_id;

  -- Get tier limits
  SELECT * INTO v_limits FROM tier_limits WHERE tier = v_tier;

  -- Try to get existing quota for today
  SELECT * INTO v_quota FROM quotas
  WHERE user_id = p_user_id AND quota_date = CURRENT_DATE;

  -- If not exists, create new
  IF v_quota IS NULL THEN
    INSERT INTO quotas (user_id, quota_date, posts_limit, ai_generations_limit)
    VALUES (p_user_id, CURRENT_DATE, v_limits.daily_posts, v_limits.daily_ai_generations)
    RETURNING * INTO v_quota;
  END IF;

  RETURN v_quota;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to request a post token
CREATE OR REPLACE FUNCTION request_post_token(
  p_user_id UUID,
  p_platform TEXT,
  p_content_hash TEXT
)
RETURNS TABLE(success BOOLEAN, token TEXT, error TEXT) AS $$
DECLARE
  v_quota quotas;
  v_token TEXT;
  v_limits tier_limits;
  v_tier TEXT;
BEGIN
  -- Get user's tier and check scheduling permission
  SELECT subscription_tier INTO v_tier FROM users WHERE id = p_user_id;
  SELECT * INTO v_limits FROM tier_limits WHERE tier = v_tier;

  -- Get today's quota
  SELECT * INTO v_quota FROM get_or_create_quota(p_user_id);

  -- Check if quota exceeded
  IF v_quota.posts_used >= v_quota.posts_limit THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Daily post limit exceeded'::TEXT;
    RETURN;
  END IF;

  -- Generate unique token
  v_token := encode(gen_random_bytes(32), 'hex');

  -- Insert token (10 minute expiry)
  INSERT INTO post_tokens (user_id, token, platform, content_hash, expires_at)
  VALUES (p_user_id, v_token, p_platform, p_content_hash, NOW() + INTERVAL '10 minutes');

  -- Increment quota (reserve the post)
  UPDATE quotas SET posts_used = posts_used + 1, updated_at = NOW()
  WHERE id = v_quota.id;

  RETURN QUERY SELECT TRUE, v_token, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to confirm post token usage
CREATE OR REPLACE FUNCTION confirm_post_token(
  p_token TEXT,
  p_success BOOLEAN,
  p_platform_post_id TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, error TEXT) AS $$
DECLARE
  v_token post_tokens;
BEGIN
  -- Get token
  SELECT * INTO v_token FROM post_tokens WHERE token = p_token;

  -- Check if token exists
  IF v_token IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Token not found'::TEXT;
    RETURN;
  END IF;

  -- Check if already used
  IF v_token.status != 'pending' THEN
    RETURN QUERY SELECT FALSE, 'Token already processed'::TEXT;
    RETURN;
  END IF;

  -- Check if expired
  IF v_token.expires_at < NOW() THEN
    -- Refund the quota
    UPDATE quotas SET posts_used = posts_used - 1
    WHERE user_id = v_token.user_id AND quota_date = CURRENT_DATE;

    UPDATE post_tokens SET status = 'expired' WHERE id = v_token.id;
    RETURN QUERY SELECT FALSE, 'Token expired'::TEXT;
    RETURN;
  END IF;

  -- Update token status
  IF p_success THEN
    UPDATE post_tokens SET
      status = 'used',
      used_at = NOW(),
      post_id = p_platform_post_id
    WHERE id = v_token.id;
  ELSE
    -- Refund quota on failure
    UPDATE quotas SET posts_used = posts_used - 1
    WHERE user_id = v_token.user_id AND quota_date = CURRENT_DATE;

    UPDATE post_tokens SET
      status = 'refunded',
      error_message = p_error_message
    WHERE id = v_token.id;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check feature access
CREATE OR REPLACE FUNCTION check_feature_access(p_user_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_tier TEXT;
  v_limits tier_limits;
BEGIN
  SELECT subscription_tier INTO v_tier FROM users WHERE id = p_user_id;
  SELECT * INTO v_limits FROM tier_limits WHERE tier = v_tier;

  CASE p_feature
    WHEN 'scheduling' THEN RETURN v_limits.has_scheduling;
    WHEN 'ai_generation' THEN RETURN v_limits.has_ai_generation;
    WHEN 'knowledge_base' THEN RETURN v_limits.has_knowledge_base;
    WHEN 'tracked_accounts' THEN RETURN v_limits.max_tracked_accounts > 0;
    ELSE RETURN FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
