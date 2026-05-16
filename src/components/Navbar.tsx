import React from 'react';
import { LayoutDashboard, Scan, Download, ExternalLink, History, LogOut, User as UserIcon, Warehouse, Users, RotateCcw, Calendar } from 'lucide-react';
import { User } from 'firebase/auth';
import { useWarehouse } from '../contexts/WarehouseContext';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: User | null;
  role: string | null;
  isMasterAdmin: boolean;
  onLogout: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, user, role, isMasterAdmin, onLogout }) => {
  const { activeWarehouse } = useWarehouse();
  const menuRef = React.useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    const ele = menuRef.current;
    if (!ele) return;
    const startPos = {
      left: ele.scrollLeft,
      x: e.clientX,
    };

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startPos.x;
      ele.scrollLeft = startPos.left - dx;
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const tabs = [
    { id: 'STOK', label: 'Stok Gudang', icon: LayoutDashboard, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { id: 'STOK_HARIAN', label: 'Stok Harian', icon: Calendar, color: 'text-violet-600', bg: 'bg-violet-50' },
    { id: 'SCAN', label: 'Data Scan', icon: Scan, color: 'text-blue-600', bg: 'bg-blue-50' },
    { id: 'MASUK', label: 'Data Masuk', icon: Download, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { id: 'KELUAR', label: 'Data Keluar', icon: ExternalLink, color: 'text-orange-600', bg: 'bg-orange-50' },
    { id: 'RETUR', label: 'Retur', icon: RotateCcw, color: 'text-rose-600', bg: 'bg-rose-50' },
    { id: 'HISTORY', label: 'Database', icon: History, color: 'text-slate-600', bg: 'bg-slate-50' },
    { 
      id: 'GUDANG', 
      label: 'Gudang', 
      icon: Warehouse, 
      color: 'text-rose-600', 
      bg: 'bg-rose-50',
      adminOnly: true 
    },
    { 
      id: 'USERS', 
      label: 'Petugas', 
      icon: Users, 
      color: 'text-violet-600', 
      bg: 'bg-violet-50',
      masterOnly: true 
    },
  ];

  const visibleTabs = tabs.filter(tab => {
    if (tab.masterOnly) return isMasterAdmin;
    if (tab.adminOnly) return role === 'ADMIN';
    return true;
  });

  return (
    <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
              <LayoutDashboard className="text-white w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-black text-lg text-slate-900 tracking-tight leading-none uppercase">
                SMART<span className="text-indigo-600 italic">GUDANG</span>
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                 <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                 <span className="text-[10px] text-indigo-600 font-black tracking-widest uppercase">
                   {activeWarehouse?.name || 'System Pro'}
                 </span>
              </div>
            </div>
          </div>
          
          <div 
            ref={menuRef}
            onMouseDown={handleMouseDown}
            className="hidden md:flex gap-1 overflow-x-auto no-scrollbar max-w-[calc(100vw-500px)] flex-nowrap items-center px-2 cursor-grab active:cursor-grabbing select-none"
          >
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`group relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-black uppercase tracking-tight transition-all duration-200 whitespace-nowrap flex-shrink-0 cursor-pointer ${
                    isActive 
                      ? `${tab.bg} ${tab.color} shadow-sm ring-1 ring-inset ring-slate-100` 
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <tab.icon className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${isActive ? tab.color : 'text-slate-400'}`} />
                  {tab.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-indigo-600/30 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-4 pl-4 border-l border-slate-100">
            {user && (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className={`text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md ${role === 'ADMIN' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                    {role || 'Staff'}
                  </p>
                  <p className="text-xs font-bold text-slate-800 tabular-nums">{user.displayName}</p>
                </div>
                <div className="relative group">
                  <img 
                    src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                    alt={user.displayName || 'User'} 
                    className="w-9 h-9 rounded-full border-2 border-slate-100 shadow-sm cursor-pointer"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-2xl border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top-right scale-95 group-hover:scale-100 p-2 z-50">
                    <div className="flex flex-col p-2 px-3 border-b border-slate-50 mb-2">
                       <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{role || 'Staff Account'}</span>
                       <span className="text-[11px] font-bold text-slate-400 truncate">{user.email}</span>
                    </div>
                    <button
                      onClick={onLogout}
                      className="w-full flex items-center gap-3 p-2 px-3 rounded-lg text-sm font-bold text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Keluar Sistem
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="md:hidden flex overflow-x-auto px-4 pb-3 gap-2 no-scrollbar bg-white/50 backdrop-blur-sm border-t border-slate-50">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              activeTab === tab.id 
                ? `${tab.bg} ${tab.color} ring-1 ring-inset ring-indigo-100` 
                : 'text-slate-500 bg-slate-50'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default Navbar;
