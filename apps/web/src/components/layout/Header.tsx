import { useLocation } from 'react-router-dom';
import { PLATFORM_NAME } from '@/hooks/useOrgBranding';
const TITLES: Record<string, string> = { '/dashboard': 'Dashboard', '/projects': 'Projects', '/ai': 'AI Assistant' };
export function Header() {
  const { pathname } = useLocation();
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-base font-semibold text-gray-800">{TITLES[pathname] ?? PLATFORM_NAME}</h1>
      <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-white text-xs font-semibold">QA</div>
    </header>
  );
}
