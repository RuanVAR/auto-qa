import { cn } from '@/lib/utils';

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl', className)} style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      {children}
    </thead>
  );
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn('px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap', className)}
      style={{ color: 'rgba(238,238,248,0.55)' }}
    >
      {children}
    </th>
  );
}

export function Td({ children, className, colSpan, onClick, style }: { children?: React.ReactNode; className?: string; colSpan?: number; onClick?: (e: React.MouseEvent) => void; style?: React.CSSProperties }) {
  return (
    <td
      colSpan={colSpan}
      onClick={onClick}
      className={cn('px-4 py-3 text-sm', className)}
      style={{ color: 'rgba(238,238,248,0.82)', borderBottom: '1px solid rgba(255,255,255,0.06)', ...style }}
    >
      {children}
    </td>
  );
}

export function Tr({ children, onClick, className, 'data-testid': dataTestId }: { children: React.ReactNode; onClick?: () => void; className?: string; 'data-testid'?: string }) {
  return (
    <tr
      data-testid={dataTestId}
      className={cn('transition-colors', onClick ? 'cursor-pointer' : '', className)}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}
