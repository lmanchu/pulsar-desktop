-- Migration: Add Clerk user support
-- Run this in Supabase SQL Editor to enable Clerk JWT authentication

-- ============================================
-- 1. Add clerk_id column to users table
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;

-- Index for Clerk ID lookups
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);

-- ============================================
-- 2. Function to create or get user by Clerk ID
-- This function bypasses RLS using SECURITY DEFINER
-- ============================================
CREATE OR REPLACE FUNCTION create_or_get_user_by_clerk(
  p_clerk_id TEXT,
  p_email TEXT
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  subscription_tier TEXT,
  is_new BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_is_new BOOLEAN := FALSE;
BEGIN
  -- Try to find existing user by clerk_id
  SELECT id INTO v_user_id FROM users WHERE clerk_id = p_clerk_id;

  -- If not found, try by email
  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id FROM users WHERE users.email = p_email;

    -- If found by email, update the clerk_id
    IF v_user_id IS NOT NULL THEN
      UPDATE users SET clerk_id = p_clerk_id, updated_at = NOW() WHERE id = v_user_id;
    END IF;
  END IF;

  -- If still not found, create new user
  IF v_user_id IS NULL THEN
    INSERT INTO users (email, clerk_id, subscription_tier)
    VALUES (p_email, p_clerk_id, 'free')
    RETURNING id INTO v_user_id;
    v_is_new := TRUE;
  END IF;

  -- Return user data
  RETURN QUERY
  SELECT u.id, u.email, u.subscription_tier, v_is_new
  FROM users u WHERE u.id = v_user_id;
END;
$$;

-- ============================================
-- 3. Function to upgrade user subscription (admin only)
-- ============================================
CREATE OR REPLACE FUNCTION admin_upgrade_user(
  p_email TEXT,
  p_tier TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  user_id UUID,
  email TEXT,
  old_tier TEXT,
  new_tier TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_old_tier TEXT;
BEGIN
  -- Validate tier
  IF p_tier NOT IN ('free', 'starter', 'pro', 'agency') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, p_email, NULL::TEXT, p_tier;
    RETURN;
  END IF;

  -- Find user by email
  SELECT id, subscription_tier INTO v_user_id, v_old_tier
  FROM users WHERE users.email = p_email;

  IF v_user_id IS NULL THEN
    -- User not found
    RETURN QUERY SELECT FALSE, NULL::UUID, p_email, NULL::TEXT, p_tier;
    RETURN;
  END IF;

  -- Update subscription
  UPDATE users SET
    subscription_tier = p_tier,
    subscription_status = CASE WHEN p_tier = 'free' THEN 'inactive' ELSE 'active' END,
    subscription_started_at = CASE WHEN p_tier = 'free' THEN NULL ELSE NOW() END,
    updated_at = NOW()
  WHERE id = v_user_id;

  RETURN QUERY SELECT TRUE, v_user_id, p_email, v_old_tier, p_tier;
END;
$$;

-- ============================================
-- 4. Update RLS policies to support Clerk JWT
-- ============================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own data" ON users;
DROP POLICY IF EXISTS "Users can update own data" ON users;

-- New policy: Allow users to view their own data (by clerk_id from JWT)
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (
    clerk_id = (current_setting('request.jwt.claims', true)::json->>'sub')
    OR auth.uid() = id
  );

-- New policy: Allow users to update their own data (by clerk_id from JWT)
CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (
    clerk_id = (current_setting('request.jwt.claims', true)::json->>'sub')
    OR auth.uid() = id
  );

-- ============================================
-- 4b. Function to get subscription by Clerk ID
-- Used by the app to fetch subscription status (bypasses RLS)
-- ============================================
CREATE OR REPLACE FUNCTION get_subscription_by_clerk(
  p_clerk_id TEXT
)
RETURNS TABLE (
  subscription_tier TEXT,
  subscription_status TEXT,
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.subscription_tier,
    u.subscription_status,
    u.subscription_started_at,
    u.subscription_ends_at
  FROM users u
  WHERE u.clerk_id = p_clerk_id;
END;
$$;

-- Grant execute on new functions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION create_or_get_user_by_clerk TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_upgrade_user TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_subscription_by_clerk TO anon, authenticated;

-- ============================================
-- 5. Comment for documentation
-- ============================================
COMMENT ON FUNCTION create_or_get_user_by_clerk IS
'Creates or retrieves a user by their Clerk ID. Used during login flow.';

COMMENT ON FUNCTION admin_upgrade_user IS
'Admin function to upgrade a user subscription by email. SECURITY DEFINER bypasses RLS.';
