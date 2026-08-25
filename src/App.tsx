import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { supabase } from './lib/supabase';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import Dashboard from './pages/Dashboard';
import Production from './pages/Production';
import ShipmentPage from './pages/Shipment';
import Costs from './pages/Costs';
import Definitions from './pages/Definitions';
import Reports from './pages/Reports';
import AdminUsers from './pages/AdminUsers';

type Page = 'dashboard' | 'production' | 'shipment' | 'costs' | 'definitions' | 'reports' | 'admin_users';

function AppContent() {
  const { user, loading, pendingApproval } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [isPasswordReset, setIsPasswordReset] = useState(() => {
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery';
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordReset(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleResetDone = () => {
    setIsPasswordReset(false);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (isPasswordReset) return <ResetPasswordPage onDone={handleResetDone} />;
  if (!user || pendingApproval) return <LoginPage />;

  const PAGE_MAP: Record<Page, JSX.Element> = {
    dashboard: <Dashboard />,
    production: <Production />,
    shipment: <ShipmentPage />,
    costs: <Costs />,
    definitions: <Definitions />,
    reports: <Reports />,
    admin_users: <AdminUsers />,
  };

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      {PAGE_MAP[currentPage]}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
