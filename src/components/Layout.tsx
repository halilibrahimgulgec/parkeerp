import { ReactNode } from 'react';
import Sidebar from './Sidebar';

type Page = 'dashboard' | 'production' | 'shipment' | 'costs' | 'definitions' | 'reports' | 'admin_users' | 'pallet_tracking';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export default function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
