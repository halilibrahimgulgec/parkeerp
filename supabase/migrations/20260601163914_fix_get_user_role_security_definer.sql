/*
  # Fix get_user_role function with SECURITY DEFINER

  The function was querying user_profiles without SECURITY DEFINER,
  causing infinite RLS recursion (policy calls function, function queries
  the same table, RLS triggers again, returns null).
  
  This recreates the function as SECURITY DEFINER so it bypasses RLS
  when looking up the caller's own role.
*/

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;
