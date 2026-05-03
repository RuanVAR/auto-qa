import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, Sparkles, Settings, Zap, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/ai', icon: Sparkles, label: 'AI Assistant' },
];

export function Sidebar() {
  return (
    <aside className="w-60 bg-gray-900 flex flex-col shrink-0">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-800">
        <div className="w-7 h-7 rounded-lg bg-sky-500 flex items-center justify-center"><Zap size={15} className="text-white" /></div>
        <span className="text-white font-semibold text-sm">QA Platform</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors', isActive ? 'bg-sky-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white')}>
            <Icon size={16} />{label}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 pb-4 border-t border-gray-800 pt-4 space-y-0.5">
        <NavLink to="/admin" className={({ isActive }) => cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors', isActive ? 'bg-sky-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white')}>
          <ShieldCheck size={16} />Admin
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors', isActive ? 'bg-sky-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white')}>
          <Settings size={16} />Settings
        </NavLink>
      </div>
    </aside>
  );
}
