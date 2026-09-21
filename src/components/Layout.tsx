import { ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';
import AIAssistantModal from './AIAssistantModal';
import { Menu, X } from 'lucide-react';

type Page = 'dashboard' | 'production' | 'production_planning' | 'purchases' | 'shipment' | 'customer_quotas' | 'costs' | 'definitions' | 'reports' | 'admin_users' | 'pallet_tracking' | 'labor_tracking';

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
        <div className="flex items-center gap-2">
          <div className="text-slate-800 bg-white/90 rounded-xl p-0.5">
            <NotificationBell onNavigate={handleNavigate} />
          </div>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className="p-1 hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Menüyü Aç/Kapat"
          >
            {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Overlay (Backdrop) */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Sliding Drawer */}
      <div
        className={`no-print fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-300 md:relative md:translate-x-0 md:flex h-[100dvh] md:h-screen md:sticky md:top-0 shadow-2xl md:shadow-none overflow-hidden
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <Sidebar currentPage={currentPage} onNavigate={handleNavigate} onCloseMobile={() => setIsSidebarOpen(false)} />
      </div>

      {/* Main Content Pane */}
      <main className="flex-1 overflow-auto flex flex-col min-h-screen print:overflow-visible print:block print:min-h-0 print:h-auto">
        {/* Desktop Top Bar with Notification Bell */}
        <div className="no-print hidden md:flex items-center justify-end px-8 py-3 bg-white/70 backdrop-blur border-b border-slate-100 sticky top-0 z-20">
          <NotificationBell onNavigate={handleNavigate} />
        </div>
        <div className="flex-1">
          {children}
        </div>
      </main>

      {/* Floating AI Factory Assistant */}
      <AIAssistantModal />
    </div>
  );
}
