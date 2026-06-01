import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { PageSpinner } from '@/components/ui/Spinner';

interface Props {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: Props) {
  const token = useAuthStore(s => s.token);
  const location = useLocation();

  if (!token) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}

export function PlatformAdminRoute({ children }: Props) {
  const { token, user } = useAuthStore();
  const location = useLocation();

  if (!token) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Wait for the profile to load before deciding. Without this, a hard refresh
  // (token present, user not yet hydrated from /auth/me) would briefly render
  // the admin UI to a non-admin before the redirect fires. The backend always
  // enforces PlatformAdminGuard, so this is about not flashing admin chrome.
  if (!user) {
    return <PageSpinner />;
  }

  if (user.platformRole !== 'PLATFORM_ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
