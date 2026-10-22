import { useState, useEffect, useMemo } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { supabase } from './lib/supabase';
import { Capacitor } from '@capacitor/core';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
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
import { initAnalytics, trackPageView } from './utils/analytics';

export type Page =
  | 'dashboard'
  | 'production'
  | 'production_planning'
  | 'molds'
  | 'purchases'
  | 'shipment'
  | 'customer_balances'
  | 'customer_quotas'
  | 'costs'
  | 'definitions'
  | 'reports'
  | 'admin_users'
  | 'pallet_tracking'
  | 'labor_tracking'
  | 'super_admin_companies';

const PAGE_TO_ROUTE: Record<Page, string> = {
  dashboard: '/dashboard',
  production: '/production',
  production_planning: '/production-planning',
  molds: '/molds',
  purchases: '/purchases',
  shipment: '/shipment',
  customer_balances: '/customer-balances',
  customer_quotas: '/customer-quotas',
  costs: '/costs',
  definitions: '/definitions',
  reports: '/reports',
  admin_users: '/admin-users',
  pallet_tracking: '/pallet-tracking',
  labor_tracking: '/labor-tracking',
  super_admin_companies: '/super-admin-companies',
};

const ROUTE_TO_PAGE: Record<string, Page> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/production': 'production',
  '/production-planning': 'production_planning',
  '/molds': 'molds',
  '/purchases': 'purchases',
  '/shipment': 'shipment',
  '/customer-balances': 'customer_balances',
  '/customer-quotas': 'customer_quotas',
  '/costs': 'costs',
  '/definitions': 'definitions',
  '/reports': 'reports',
  '/admin-users': 'admin_users',
  '/pallet-tracking': 'pallet_tracking',
  '/labor-tracking': 'labor_tracking',
  '/super-admin-companies': 'super_admin_companies',
};

function AppContent() {
  const { user, loading, pendingApproval } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  // URL rotasından aktif Page'i türet (Sidebar, Layout ve BottomNav senkronizasyonu için)
  const currentPage: Page = useMemo(() => {
    return ROUTE_TO_PAGE[location.pathname] || 'dashboard';
  }, [location.pathname]);

  const handleNavigate = (page: Page) => {
    const route = PAGE_TO_ROUTE[page] || '/dashboard';
    navigate(route);
  };

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

  if (!user || pendingApproval) {
    const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();
    const isLoginRoute = location.pathname === '/login' || location.pathname === '/giris';

    if (isNative || pendingApproval || isLoginRoute) {
      return <LoginPage onGoToLanding={isNative ? undefined : () => navigate('/')} />;
    }

    return <LandingPage onGoToLogin={() => navigate('/login')} />;
  }

  return (
    <Layout currentPage={currentPage} onNavigate={handleNavigate}>
      <ErrorBoundary key={location.pathname} onReset={() => navigate('/dashboard')}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="/giris" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard onNavigate={handleNavigate} />} />
          <Route path="/production" element={<Production onNavigate={handleNavigate} />} />
          <Route path="/production-planning" element={<ProductionPlanning />} />
          <Route path="/molds" element={<MoldsPage />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/shipment" element={<ShipmentPage />} />
          <Route path="/customer-balances" element={<CustomerBalancesPage />} />
          <Route path="/customer-quotas" element={<CustomerQuotas />} />
          <Route path="/costs" element={<Costs />} />
          <Route path="/definitions" element={<Definitions />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/admin-users" element={<AdminUsers />} />
          <Route path="/pallet-tracking" element={<PalletTracking />} />
          <Route path="/labor-tracking" element={<LaborTracking />} />
          <Route path="/super-admin-companies" element={<SuperAdminCompanies />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </AuthProvider>
  );
}
