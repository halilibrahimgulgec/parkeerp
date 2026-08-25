/*
  # Approve all existing users

  Sets is_approved = true for all users in user_profiles table.
  This fixes the issue where existing users were blocked from logging in.
*/

UPDATE user_profiles SET is_approved = true;
