/*
  # Fix user_profiles RLS so admins can view all profiles

  The existing SELECT policy checks app_metadata.role which is never set,
  so admins can only see their own row. This migration replaces the policy
  to use the get_user_role() security-definer function instead.
*/

DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR get_user_role() = 'admin');

DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR get_user_role() = 'admin')
  WITH CHECK (auth.uid() = id OR get_user_role() = 'admin');
