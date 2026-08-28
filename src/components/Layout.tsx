import { ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import { Menu, X } from 'lucide-react';

type Page = 'dashboard' | 'production' | 'shipment' | 'costs' | 'definitions' | 'reports' | 'admin_users' | 'pallet_tracking';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export default function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleNavigate = (page: Page) => {
    onNavigate(page);
    setIsSidebarOpen(false); // Close sidebar on mobile after navigation
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50">
      {/* Mobile Top Navbar */}
      <header className="flex md:hidden items-center justify-between px-4 py-3 bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <span className="font-bold text-lg">Parke ERP</span>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
          className="p-1 hover:bg-slate-800 rounded-lg transition-colors"
          aria-label="Menüyü Aç/Kapat"
        >
          {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Sidebar Overlay (Backdrop) */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Sliding Drawer */}
      <div className={`no-print fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 md:relative md:translate-x-0 md:flex h-full
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar currentPage={currentPage} onNavigate={handleNavigate} />
      </div>

      {/* Main Content Pane */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
