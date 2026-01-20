-- Migration: 4-Tier Quota System
-- Run this in Supabase Dashboard SQL Editor
-- This migration updates the existing schema to support 4 tiers

-- ============================================
-- 1. Update users table constraint
-- ============================================
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_subscription_tier_check;

ALTER TABLE users
ADD CONSTRAINT users_subscription_tier_check
CHECK (subscription_tier IN ('free', 'starter', 'pro', 'agency'));

-- ============================================
-- 2. Update tier_limits table
-- ============================================

-- Drop and recreate tier_limits with new structure
DROP TABLE IF EXISTS tier_limits CASCADE;

CREATE TABLE tier_limits (
  tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'starter', 'pro', 'agency')),
  daily_posts INTEGER NOT NULL,
  daily_replies INTEGER DEFAULT 0,
  has_scheduling BOOLEAN DEFAULT FALSE,
  has_ai_generation BOOLEAN DEFAULT FALSE,
  daily_ai_generations INTEGER DEFAULT 0,
  max_tracked_accounts INTEGER DEFAULT 0,
  max_interest_topics INTEGER DEFAULT 0,
  max_social_accounts INTEGER DEFAULT 1,
  has_knowledge_base BOOLEAN DEFAULT FALSE,
  price_monthly_usd DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert 4-tier pricing data
INSERT INTO tier_limits (tier, daily_posts, daily_replies, has_scheduling, has_ai_generation, daily_ai_generations, max_tracked_accounts, max_interest_topics, max_social_accounts, has_knowledge_base, price_monthly_usd)
VALUES
  ('free', 3, 0, FALSE, TRUE, 3, 0, 0, 1, FALSE, 0),
  ('starter', 5, 10, TRUE, TRUE, 10, 3, 3, 3, FALSE, 14.99),
  ('pro', 10, 30, TRUE, TRUE, 30, 10, 10, 5, TRUE, 49.00),
  ('agency', 30, 100, TRUE, TRUE, 100, 50, 20, 10, TRUE, 99.00);

-- RLS Policy for tier_limits (anyone can read)
ALTER TABLE tier_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view tier limits" ON tier_limits;
CREATE POLICY "Anyone can view tier limits" ON tier_limits
  FOR SELECT USING (true);

-- ============================================
-- 3. Update quotas table (add replies columns)
-- ============================================

-- Add new columns if they don't exist
ALTER TABLE quotas ADD COLUMN IF NOT EXISTS replies_used INTEGER DEFAULT 0;
ALTER TABLE quotas ADD COLUMN IF NOT EXISTS replies_limit INTEGER DEFAULT 0;

-- ============================================
-- 4. Update get_or_create_quota function
-- ============================================
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
    INSERT INTO quotas (user_id, quota_date, posts_limit, replies_limit, ai_generations_limit)
    VALUES (p_user_id, CURRENT_DATE, v_limits.daily_posts, v_limits.daily_replies, v_limits.daily_ai_generations)
    RETURNING * INTO v_quota;
  END IF;

  RETURN v_quota;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. Update check_feature_access function
-- ============================================
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
    WHEN 'interest_topics' THEN RETURN v_limits.max_interest_topics > 0;
    WHEN 'replies' THEN RETURN v_limits.daily_replies > 0;
    ELSE RETURN FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. Add reply quota functions
-- ============================================

-- Function to check if user can reply
CREATE OR REPLACE FUNCTION can_reply(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_quota quotas;
BEGIN
  SELECT * INTO v_quota FROM get_or_create_quota(p_user_id);
  RETURN v_quota.replies_used < v_quota.replies_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to use a reply quota
CREATE OR REPLACE FUNCTION use_reply_quota(p_user_id UUID)
RETURNS TABLE(success BOOLEAN, remaining INTEGER, error TEXT) AS $$
DECLARE
  v_quota quotas;
BEGIN
  -- Get today's quota
  SELECT * INTO v_quota FROM get_or_create_quota(p_user_id);

  -- Check if quota exceeded
  IF v_quota.replies_used >= v_quota.replies_limit THEN
    RETURN QUERY SELECT FALSE, 0, 'Daily reply limit exceeded'::TEXT;
    RETURN;
  END IF;

  -- Increment usage
  UPDATE quotas SET replies_used = replies_used + 1, updated_at = NOW()
  WHERE id = v_quota.id;

  RETURN QUERY SELECT TRUE, (v_quota.replies_limit - v_quota.replies_used - 1)::INTEGER, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Verification query (run after migration)
-- ============================================
-- SELECT * FROM tier_limits;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'quotas';
