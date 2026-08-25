import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Factory, Truck, DollarSign, Package,
  BarChart3, LogOut, ChevronRight, ShieldCheck, Users, Boxes
} from 'lucide-react';

type Page = 'dashboard' | 'production' | 'shipment' | 'costs' | 'definitions' | 'reports' | 'admin_users' | 'pallet_tracking';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
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

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { profile, signOut, isAdmin, isFieldManager, isWeighbridge } = useAuth();

  const navItems = [
    { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard, access: true },
    { id: 'production' as Page, label: 'Üretim', icon: Factory, access: isFieldManager() },
    { id: 'shipment' as Page, label: 'Sevkiyat / Kantar', icon: Truck, access: isWeighbridge() },
    { id: 'pallet_tracking' as Page, label: 'Palet Takibi', icon: Boxes, access: true },
    { id: 'costs' as Page, label: 'Maliyet Giderleri', icon: DollarSign, access: isAdmin() },
    { id: 'definitions' as Page, label: 'Tanımlamalar', icon: Package, access: isAdmin() },
    { id: 'reports' as Page, label: 'Raporlar', icon: BarChart3, access: true },
    { id: 'admin_users' as Page, label: 'Kullanıcılar', icon: Users, access: isAdmin() },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col min-h-screen">
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
            <Factory size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Parke ERP</h1>
            <p className="text-slate-400 text-xs">Fabrika Yönetim Sistemi</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => {
          if (!item.access) return null;
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
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

      <div className="p-4 border-t border-slate-700">
        <div className="bg-slate-800 rounded-xl p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center">
              <ShieldCheck size={16} className="text-slate-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{profile?.full_name || 'Kullanıcı'}</p>
            </div>
          </div>
          {profile?.role && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[profile.role] || ''}`}>
              {ROLE_LABELS[profile.role] || profile.role}
            </span>
          )}
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl text-sm transition-colors"
        >
          <LogOut size={16} />
          Çıkış Yap
        </button>
      </div>
    </aside>
  );
}
