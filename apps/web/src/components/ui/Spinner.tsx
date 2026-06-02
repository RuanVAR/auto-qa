import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin', className)} style={{ color: 'var(--accent-light)' }} />;
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="relative">
        <Spinner className="w-8 h-8" />
        <div
          className="absolute inset-0 rounded-full animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, rgba(var(--accent-rgb),0.25) 0%, transparent 70%)' }}
        />
      </div>
    </div>
  );
}
