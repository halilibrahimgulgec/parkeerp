import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { UserProfile, Company } from '../types';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  company: Company | null;
  loading: boolean;
  pendingApproval: boolean;
  companySuspended: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, role: string, companyId?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
  isAdmin: () => boolean;
  isFieldManager: () => boolean;
  isWeighbridge: () => boolean;
  isSuperAdmin: () => boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchProfileFromDb(userId: string, userEmail?: string): Promise<UserProfile | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('*, companies(*)')
    .eq('id', userId)
    .maybeSingle();

  if (!data) {
    const { data: defaultComp } = await supabase
      .from('companies')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: newProfile } = await supabase
      .from('user_profiles')
      .insert({
        id: userId,
        full_name: userEmail?.split('@')[0] || 'Kullanıcı',
        role: 'field_manager',
        company_id: defaultComp?.id || null,
        is_approved: false,
      })
      .select('*, companies(*)')
      .maybeSingle();

    if (!newProfile) return null;
    const comp = Array.isArray(newProfile.companies) ? newProfile.companies[0] : newProfile.companies;
    return { ...newProfile, company: comp };
  }

  const comp = Array.isArray(data.companies) ? data.companies[0] : data.companies;
  return { ...data, company: comp };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [companySuspended, setCompanySuspended] = useState(false);

  useEffect(() => {
    // Initial session check — only restore existing approved sessions
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const p = await fetchProfileFromDb(session.user.id, session.user.email);
        if (p && p.is_approved === false) {
          await supabase.auth.signOut();
        } else if (p && p.company && p.company.is_active === false && !p.is_super_admin) {
          await supabase.auth.signOut();
          setCompanySuspended(true);
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
    setCompanySuspended(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error as Error };

    if (data.user) {
      const p = await fetchProfileFromDb(data.user.id, data.user.email);
      // Only block if profile explicitly has is_approved = false
      if (p && p.is_approved === false) {
        await supabase.auth.signOut();
        setPendingApproval(true);
        return { error: null };
      }
      if (p && p.company && p.company.is_active === false && !p.is_super_admin) {
        await supabase.auth.signOut();
        setCompanySuspended(true);
        return { error: new Error('Firma hesabınız askıya alınmıştır. Lütfen sistem yöneticisi ile iletişime geçin.') };
      }
      setSession(data.session);
      setUser(data.user);
      setProfile(p);
    }
    return { error: null };
  };

  const signUp = async (email: string, password: string, fullName: string, role: string, companyId?: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error as Error };
    if (data.user) {
      let targetCompanyId = companyId;
      if (!targetCompanyId) {
        const { data: defaultComp } = await supabase
          .from('companies')
          .select('id')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        targetCompanyId = defaultComp?.id;
      }

      await supabase.from('user_profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        role,
        company_id: targetCompanyId || null,
        is_approved: false,
      });
      // Sign out immediately after registration — needs admin approval
      await supabase.auth.signOut();
    }
    return { error: null };
  };

  const signOut = async () => {
    setPendingApproval(false);
    setCompanySuspended(false);
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

  const isAdmin = () => profile?.role === 'admin' || profile?.is_super_admin === true;
  const isFieldManager = () => profile?.role === 'field_manager' || profile?.role === 'admin' || profile?.is_super_admin === true;
  const isWeighbridge = () => profile?.role === 'weighbridge' || profile?.role === 'admin' || profile?.is_super_admin === true;
  const isSuperAdmin = () => profile?.is_super_admin === true;

  return (
    <AuthContext.Provider value={{
      user, session, profile, company: profile?.company || null, loading, pendingApproval, companySuspended,
      signIn, signUp, signOut, sendPasswordResetEmail, updatePassword,
      isAdmin, isFieldManager, isWeighbridge, isSuperAdmin, refreshProfile,
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
