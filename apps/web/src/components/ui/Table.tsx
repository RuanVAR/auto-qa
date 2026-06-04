import React from 'react';
import { cn } from '@/lib/utils';

export function Table({ children, className, cards }: { children: React.ReactNode; className?: string; cards?: boolean }) {
  // `cards`: below md, rows collapse into labelled cards (see index.css
  // .table-cards). Each <Td> should pass `label` so the card shows field
  // names. Desktop rendering is identical with or without `cards`.
  return (
    <div
      className={cn('overflow-x-auto rounded-xl', cards && 'table-cards-wrap', className)}
      style={{ border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <table className={cn('w-full text-sm border-collapse', cards && 'table-cards')}>{children}</table>
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

export function Td({ children, className, colSpan, onClick, style, label }: { children?: React.ReactNode; className?: string; colSpan?: number; onClick?: (e: React.MouseEvent) => void; style?: React.CSSProperties; label?: string }) {
  return (
    <td
      colSpan={colSpan}
      onClick={onClick}
      // `label` feeds the mobile card view (Table cards) via data-label —
      // it has no effect on the desktop table layout.
      data-label={label}
      className={cn('px-4 py-3 text-sm', className)}
      style={{ color: 'rgba(238,238,248,0.82)', borderBottom: '1px solid rgba(255,255,255,0.06)', ...style }}
    >
      {children}
    </td>
  );
}

export const Tr = React.forwardRef<
  HTMLTableRowElement,
  {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    'data-testid'?: string;
    style?: React.CSSProperties;
  } & React.HTMLAttributes<HTMLTableRowElement>
>(function Tr({ children, onClick, className, 'data-testid': dataTestId, style, ...rest }, ref) {
  return (
    <tr
      ref={ref}
      data-testid={dataTestId}
      className={cn('transition-colors', onClick ? 'cursor-pointer' : '', className)}
      style={style}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      onClick={onClick}
      {...rest}
    >
      {children}
    </tr>
  );
});
