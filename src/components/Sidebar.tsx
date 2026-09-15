import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Factory, Truck, DollarSign, Package,
  BarChart3, LogOut, ChevronRight, ShieldCheck, Users, Boxes,
  UserCheck, Target, ShoppingBag, Sparkles, X
} from 'lucide-react';

type Page = 'dashboard' | 'production' | 'production_planning' | 'purchases' | 'shipment' | 'customer_quotas' | 'costs' | 'definitions' | 'reports' | 'admin_users' | 'pallet_tracking' | 'labor_tracking';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onCloseMobile?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Yönetici',
  field_manager: 'Saha Sorumlusu',
  weighbridge: 'Kantar Görevlisi',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-amber-100 text-amber-800',
  field_manager: 'bg-blue-100 text-blue-800',
  weighbridge: 'bg-green-100 text-green-800',
};

export default function Sidebar({ currentPage, onNavigate, onCloseMobile }: SidebarProps) {
  const { profile, signOut, isAdmin, isFieldManager, isWeighbridge } = useAuth();

  const navItems = [
    { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard, access: true },
    { id: 'production' as Page, label: 'Üretim Girişi', icon: Factory, access: isFieldManager() },
    { id: 'production_planning' as Page, label: 'Üretim Planlama & AI', icon: Sparkles, access: isFieldManager() || isAdmin() },
    { id: 'purchases' as Page, label: 'Dış Alım & Transit', icon: ShoppingBag, access: isFieldManager() || isWeighbridge() || isAdmin() },
    { id: 'shipment' as Page, label: 'Sevkiyat / Kantar', icon: Truck, access: isWeighbridge() },
    { id: 'customer_quotas' as Page, label: 'Müşteri Kotaları & Sevk', icon: Target, access: isWeighbridge() },
    { id: 'pallet_tracking' as Page, label: 'Palet Takibi', icon: Boxes, access: true },
    { id: 'labor_tracking' as Page, label: 'İşçilik & Puantaj', icon: UserCheck, access: isAdmin() || isFieldManager() },
    { id: 'costs' as Page, label: 'Maliyet Giderleri', icon: DollarSign, access: isAdmin() },
    { id: 'definitions' as Page, label: 'Tanımlamalar', icon: Package, access: isAdmin() },
    { id: 'reports' as Page, label: 'Raporlar', icon: BarChart3, access: true },
    { id: 'admin_users' as Page, label: 'Kullanıcılar', icon: Users, access: isAdmin() },
  ];

  return (
    <aside className="w-full h-full flex flex-col bg-slate-900 text-white overflow-hidden select-none">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center shadow-md shadow-amber-500/20">
            <Factory size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base sm:text-lg leading-tight text-white">Parke ERP</h1>
            <p className="text-slate-400 text-[11px]">Fabrika Yönetim Sistemi</p>
          </div>
        </div>
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="md:hidden p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Menüyü Kapat"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Scrollable Navigation Menu */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {navItems.map(item => {
          if (!item.access) return null;
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group cursor-pointer ${
                isActive
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon size={18} />
              <span className="flex-1 text-left">{item.label}</span>
              {isActive && <ChevronRight size={14} />}
            </button>
          );
        })}
      </nav>

      {/* Pinned Bottom User Card & Sign Out */}
      <div className="p-3 border-t border-slate-800 shrink-0 bg-slate-950/70 backdrop-blur-xs">
        <div className="bg-slate-800/90 rounded-xl p-2.5 mb-2">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 bg-slate-700 rounded-full flex items-center justify-center">
              <ShieldCheck size={15} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold truncate">{profile?.full_name || 'Kullanıcı'}</p>
            </div>
          </div>
          {profile?.role && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${ROLE_COLORS[profile.role] || ''}`}>
              {ROLE_LABELS[profile.role] || profile.role}
            </span>
          )}
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-slate-400 hover:text-red-400 hover:bg-slate-800/80 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
        >
          <LogOut size={15} />
          Çıkış Yap
        </button>
      </div>
    </aside>
  );
}
