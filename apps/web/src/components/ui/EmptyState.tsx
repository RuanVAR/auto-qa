import { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
        style={{
          background: 'rgba(var(--accent-rgb),0.12)',
          border: '1px solid rgba(var(--accent-rgb),0.20)',
          boxShadow: '0 0 20px rgba(var(--accent-rgb),0.10)',
        }}
      >
        <Icon size={24} style={{ color: 'var(--accent-400)' }} />
      </div>
      <h3 className="text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {description && (
        <p className="text-xs max-w-xs mb-5" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
