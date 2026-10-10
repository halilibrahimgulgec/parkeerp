import React from 'react';
import { Home, Truck, Factory, Package, Settings } from 'lucide-react';

type Page =
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

interface MobileBottomNavProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  isDark?: boolean;
}

export default function MobileBottomNav({ currentPage, onNavigate, isDark = false }: MobileBottomNavProps) {
  const navItems: { page: Page; label: string; icon: React.ComponentType<{ size: number; className?: string }> }[] = [
    { page: 'dashboard', label: 'Ana Sayfa', icon: Home },
    { page: 'shipment', label: 'Sevkiyat', icon: Truck },
    { page: 'production', label: 'Üretim', icon: Factory },
    { page: 'pallet_tracking', label: 'Paletler', icon: Package },
    { page: 'definitions', label: 'Ayarlar', icon: Settings },
  ];

  return (
    <nav
      className={`no-print md:hidden fixed bottom-0 left-0 right-0 z-40 transition-colors duration-300 border-t ${
        isDark
          ? 'bg-slate-900/95 border-slate-800 text-slate-400 backdrop-blur-lg'
          : 'bg-white/95 border-slate-200/80 text-slate-500 backdrop-blur-lg'
      } shadow-[0_-4px_20px_rgba(0,0,0,0.06)]`}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6px)' }}
    >
      <div className="flex items-center justify-around px-2 pt-2 pb-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.page;

          return (
            <button
              key={item.page}
              type="button"
              onClick={() => onNavigate(item.page)}
              className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition-all relative ${
                isActive
                  ? isDark
                    ? 'text-blue-400 font-bold'
                    : 'text-blue-600 font-bold'
                  : isDark
                  ? 'hover:text-slate-200 text-slate-400'
                  : 'hover:text-slate-900 text-slate-500'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  isActive
                    ? isDark
                      ? 'bg-blue-500/20 text-blue-400 scale-110 shadow-sm shadow-blue-500/10'
                      : 'bg-blue-50 text-blue-600 scale-110 shadow-sm shadow-blue-500/10'
                    : ''
                }`}
              >
                <Icon size={20} />
              </div>
              <span className="text-[10px] tracking-tight mt-0.5 leading-none">{item.label}</span>
              {isActive && (
                <span
                  className={`w-1.5 h-1.5 rounded-full absolute -top-0.5 ${
                    isDark ? 'bg-blue-400' : 'bg-blue-600'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
