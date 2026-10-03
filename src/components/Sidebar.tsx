import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Factory, Truck, DollarSign, Package,
  BarChart3, LogOut, ChevronRight, ShieldCheck, Users, Boxes,
  UserCheck, Target, ShoppingBag, Sparkles, X, Search, Building2
} from 'lucide-react';

type Page = 'dashboard' | 'production' | 'production_planning' | 'purchases' | 'shipment' | 'customer_quotas' | 'costs' | 'definitions' | 'reports' | 'admin_users' | 'pallet_tracking' | 'labor_tracking' | 'super_admin_companies';

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

interface NavItem {
  id: Page;
  label: string;
  icon: any;
  access: boolean;
  badge?: string;
  badgeColor?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export default function Sidebar({ currentPage, onNavigate, onCloseMobile }: SidebarProps) {
  const { profile, signOut, isAdmin, isFieldManager, isWeighbridge, isSuperAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');

  // 4 Temel Mantıksal Operasyonel Grup + Süper Admin Grubu
  const navGroups: NavGroup[] = [
    ...(isSuperAdmin() ? [{
      title: '👑 SAAS & ÇOKLU FİRMA YÖNETİMİ',
      items: [
        {
          id: 'super_admin_companies' as Page,
          label: 'Firma & Kiracı Yönetimi',
          icon: Building2,
          access: true,
          badge: 'SaaS',
          badgeColor: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40',
        },
      ],
    }] : []),
    {
      title: '📊 KOKPİT & MASTER RAPORLAR',
      items: [
        { id: 'dashboard', label: 'Genel Bakış (Dashboard)', icon: LayoutDashboard, access: true },
        { 
          id: 'reports', 
          label: 'Master Raporlar', 
          icon: BarChart3, 
          access: true,
          badge: '2 Rapor',
          badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
        },
      ],
    },
    {
      title: '🏭 ÜRETİM & PLANLAMA',
      items: [
        { id: 'production', label: 'Günlük Üretim Girişi', icon: Factory, access: isFieldManager() },
        { 
          id: 'production_planning', 
          label: 'Üretim Planlama & AI', 
          icon: Sparkles, 
          access: isFieldManager() || isAdmin(),
          badge: 'AI',
          badgeColor: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
        },
      ],
    },
    {
      title: '🚚 SEVKİYAT & TİCARET',
      items: [
        { 
          id: 'shipment', 
          label: 'Sevkiyat & Kantar', 
          icon: Truck, 
          access: isWeighbridge(),
          badge: 'Kantar',
          badgeColor: 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
        },
        { id: 'customer_quotas', label: 'Müşteri Kotaları & Sevk', icon: Target, access: isWeighbridge() },
        { id: 'purchases', label: 'Dış Alım & Transit', icon: ShoppingBag, access: isFieldManager() || isWeighbridge() || isAdmin() },
        { id: 'pallet_tracking', label: 'Palet Takibi & Zimmet', icon: Boxes, access: true },
      ],
    },
    {
      title: '⚙️ FABRİKA YÖNETİMİ & AYARLAR',
      items: [
        { id: 'costs', label: 'Maliyet Giderleri', icon: DollarSign, access: isAdmin() },
        { id: 'labor_tracking', label: 'İşçilik & Puantaj', icon: UserCheck, access: isAdmin() || isFieldManager() },
        { id: 'definitions', label: 'Tanımlamalar', icon: Package, access: isAdmin() },
        { id: 'admin_users', label: 'Kullanıcılar & Yetkiler', icon: Users, access: isAdmin() },
      ],
    },
  ];

  const handleItemClick = (pageId: Page) => {
    onNavigate(pageId);
    if (onCloseMobile) onCloseMobile();
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  return (
    <aside className="w-full h-full flex flex-col bg-slate-900 text-white overflow-hidden select-none border-r border-slate-800">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center shadow-md shadow-amber-500/20">
              <Factory size={20} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight text-white tracking-tight">Parke ERP</h1>
              <p className="text-slate-400 text-[11px]">Fabrika Yönetim Sistemi</p>
            </div>
          </div>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="md:hidden p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              aria-label="Menüyü Kapat"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Aktif Firma Göstergesi */}
        {profile?.company?.name && (
          <div className="px-3 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700/60 flex items-center gap-2">
            <Building2 size={13} className="text-amber-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Aktif Firma</div>
              <div className="text-xs font-black text-amber-300 truncate">{profile.company.name}</div>
            </div>
          </div>
        )}
      </div>

      {/* Hızlı Menü Filtre Arama Barı */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Modül veya sayfa ara..."
            className="w-full bg-slate-800/80 border border-slate-700/60 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Navigation Groups */}
      <nav className="flex-1 px-3 py-2 space-y-4 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {navGroups.map((group, groupIdx) => {
          // Bu grupta kullanıcının erişebildiği ve arama filtresine uyan elemanlar
          const accessibleItems = group.items.filter(item => {
            if (!item.access) return false;
            if (!normalizedQuery) return true;
            return item.label.toLowerCase().includes(normalizedQuery) ||
                   item.id.toLowerCase().includes(normalizedQuery) ||
                   (item.badge && item.badge.toLowerCase().includes(normalizedQuery));
          });

          // Eğer bu grupta gösterilecek hiçbir öğe yoksa grubu gizle
          if (accessibleItems.length === 0) return null;

          return (
            <div key={groupIdx} className="space-y-1">
              {/* Grup Başlığı */}
              <div className="px-2 pt-1 pb-1">
                <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase select-none">
                  {group.title}
                </span>
              </div>

              {/* Grup Öğeleri */}
              <div className="space-y-0.5">
                {accessibleItems.map(item => {
                  const Icon = item.icon;
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemClick(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all group cursor-pointer ${
                        isActive
                          ? 'bg-amber-500 text-white font-semibold shadow-md shadow-amber-500/25'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon 
                          size={17} 
                          className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-amber-400'} transition-colors`} 
                        />
                        <span className="truncate text-left">{item.label}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-1">
                        {item.badge && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold tracking-wide ${
                            isActive 
                              ? 'bg-white/20 text-white' 
                              : (item.badgeColor || 'bg-slate-800 text-slate-300')
                          }`}>
                            {item.badge}
                          </span>
                        )}
                        {isActive && <ChevronRight size={13} className="text-white/80" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
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
          <div className="flex items-center gap-1.5 flex-wrap">
            {isSuperAdmin() && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/40">
                👑 Süper Admin
              </span>
            )}
            {profile?.role && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${ROLE_COLORS[profile.role] || ''}`}>
                {ROLE_LABELS[profile.role] || profile.role}
              </span>
            )}
          </div>
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
