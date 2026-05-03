import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

interface BackLinkProps {
  /** Text to display, e.g. "Auth Module" or "Projects" */
  label: string;
  /** Explicit parent path — never use navigate(-1) */
  to: string;
}

/**
 * Shared back-navigation link used in every page header.
 * Styled as muted text with a chevron — sits to the left of the page title.
 */
export function BackLink({ label, to }: BackLinkProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1 text-sm hover:opacity-100 transition-opacity shrink-0"
      style={{ color: 'rgba(238,238,248,0.60)' }}
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
