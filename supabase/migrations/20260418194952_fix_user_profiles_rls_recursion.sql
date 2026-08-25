/*
  # Fix infinite recursion in user_profiles RLS policies

  The "Admins can view all profiles" policy was causing infinite recursion
  because it queried user_profiles inside a policy on user_profiles.

  Fix: Use auth.jwt() to check the role from the JWT token metadata instead
  of querying user_profiles again. This breaks the recursion.
*/

DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

CREATE POLICY "Admins can view all profiles"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    OR auth.uid() = id
  );
