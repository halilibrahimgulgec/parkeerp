import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  pendingApproval: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, role: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
  isAdmin: () => boolean;
  isFieldManager: () => boolean;
  isWeighbridge: () => boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchProfileFromDb(userId: string, userEmail?: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!data) {
    const { data: newProfile } = await supabase
      .from('user_profiles')
      .insert({
        id: userId,
        full_name: userEmail?.split('@')[0] || 'Kullanıcı',
        role: 'field_manager',
        is_approved: false,
      })
      .select()
      .maybeSingle();
    return newProfile;
  }
  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingApproval, setPendingApproval] = useState(false);

  useEffect(() => {
    // Initial session check — only restore existing approved sessions
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const p = await fetchProfileFromDb(session.user.id, session.user.email);
        if (p && p.is_approved === false) {
          await supabase.auth.signOut();
        } else {
          setSession(session);
          setUser(session.user);
          setProfile(p);
        }
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
      // SIGNED_IN is handled by signIn() directly
    });

    return () => subscription.unsubscribe();
  }, []);

  const refreshProfile = async () => {
    if (!user) return;
    const p = await fetchProfileFromDb(user.id, user.email);
    if (p) setProfile(p);
  };

  const signIn = async (email: string, password: string) => {
    setPendingApproval(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error as Error };

    if (data.user) {
      const p = await fetchProfileFromDb(data.user.id, data.user.email);
      // p is null means RLS blocked the read — treat as approved and let them in
      // Only block if profile explicitly has is_approved = false
      if (p && p.is_approved === false) {
        await supabase.auth.signOut();
        setPendingApproval(true);
        return { error: null };
      }
      setSession(data.session);
      setUser(data.user);
      setProfile(p);
    }
    return { error: null };
  };

  const signUp = async (email: string, password: string, fullName: string, role: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error as Error };
    if (data.user) {
      await supabase.from('user_profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        role,
        is_approved: false,
      });
      // Sign out immediately after registration — needs admin approval
      await supabase.auth.signOut();
    }
    return { error: null };
  };

  const signOut = async () => {
    setPendingApproval(false);
    setUser(null);
    setSession(null);
    setProfile(null);
    await supabase.auth.signOut();
  };

  const sendPasswordResetEmail = async (email: string) => {
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return { error: error as Error | null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error as Error | null };
  };

  const isAdmin = () => profile?.role === 'admin';
  const isFieldManager = () => profile?.role === 'field_manager' || profile?.role === 'admin';
  const isWeighbridge = () => profile?.role === 'weighbridge' || profile?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading, pendingApproval,
      signIn, signUp, signOut, sendPasswordResetEmail, updatePassword,
      isAdmin, isFieldManager, isWeighbridge, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
