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
import PalletTracking from './pages/PalletTracking';
import LaborTracking from './pages/LaborTracking';
import CustomerQuotas from './pages/CustomerQuotas';
import Purchases from './pages/Purchases';
import ProductionPlanning from './pages/ProductionPlanning';
import SuperAdminCompanies from './pages/SuperAdminCompanies';
import MoldsPage from './pages/Molds';
import CustomerBalancesPage from './pages/CustomerBalances';
import ErrorBoundary from './components/ErrorBoundary';

type Page = 'dashboard' | 'production' | 'production_planning' | 'molds' | 'purchases' | 'shipment' | 'customer_balances' | 'customer_quotas' | 'costs' | 'definitions' | 'reports' | 'admin_users' | 'pallet_tracking' | 'labor_tracking' | 'super_admin_companies';

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

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'production':
        return <Production onNavigate={setCurrentPage} />;
      case 'production_planning':
        return <ProductionPlanning />;
      case 'molds':
        return <MoldsPage />;
      case 'purchases':
        return <Purchases />;
      case 'shipment':
        return <ShipmentPage />;
      case 'customer_balances':
        return <CustomerBalancesPage />;
      case 'customer_quotas':
        return <CustomerQuotas />;
      case 'costs':
        return <Costs />;
      case 'definitions':
        return <Definitions />;
      case 'reports':
        return <Reports />;
      case 'admin_users':
        return <AdminUsers />;
      case 'pallet_tracking':
        return <PalletTracking />;
      case 'labor_tracking':
        return <LaborTracking />;
      case 'super_admin_companies':
        return <SuperAdminCompanies />;
      default:
        return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  return (
    <Layout currentPage={currentPage} onNavigate={setCurrentPage}>
      <ErrorBoundary key={currentPage} onReset={() => setCurrentPage('dashboard')}>
        {renderCurrentPage()}
      </ErrorBoundary>
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
