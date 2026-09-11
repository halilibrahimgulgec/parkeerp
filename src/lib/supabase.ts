import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://aaxwznaxvjltcskrdtyu.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFheHd6bmF4dmpsdGNza3JkdHl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTE3NDIsImV4cCI6MjA5MjYyNzc0Mn0.26Zs7RJ6iziS0o7OdKE1TGySvPzv3NFZzi4p_mdttzo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
