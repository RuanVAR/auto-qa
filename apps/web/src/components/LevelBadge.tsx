import { Folder, Layers, Flag, ClipboardCheck, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

/**
 * Visual hierarchy cue (Option 2): a coloured level pill so a tester always
 * knows whether they're in Project / Module / Feature / Test view. Each level
 * has its own accent colour + icon:
 *   Project = grey · Module = violet · Feature = sky · Test = emerald.
 */
export type HierarchyLevel = 'project' | 'module' | 'feature' | 'test';

export const LEVEL_META: Record<HierarchyLevel, { label: string; icon: LucideIcon; rgb: string; hex: string }> = {
  project: { label: 'Project', icon: Folder, rgb: '169,178,201', hex: '#a9b2c9' },
  module:  { label: 'Module',  icon: Layers, rgb: '139,92,246', hex: '#8b5cf6' },
  feature: { label: 'Feature', icon: Flag, rgb: '56,189,248', hex: '#38bdf8' },
  test:    { label: 'Test', icon: ClipboardCheck, rgb: '52,211,153', hex: '#34d399' },
};

export function LevelBadge({ level, size = 'md', className = '' }: { level: HierarchyLevel; size?: 'md' | 'lg'; className?: string }) {
  const m = LEVEL_META[level];
  const Icon = m.icon;
  const sz = size === 'lg' ? 'text-[13px] gap-2 px-3.5 py-1.5' : 'text-[10px] gap-1.5 px-2.5 py-1';
  return (
    <span
      className={`inline-flex items-center ${sz} font-extrabold uppercase tracking-wider rounded-full whitespace-nowrap shrink-0 ${className}`}
      style={{ background: `rgba(${m.rgb},0.16)`, color: `rgb(${m.rgb})`, border: `1px solid rgba(${m.rgb},0.42)` }}
    >
      <Icon size={size === 'lg' ? 16 : 12} strokeWidth={2.5} /> {m.label}
    </span>
  );
}

/** The level's coloured icon — for per-item rows in lists (flag on a feature,
 *  layers on a module, clipboard-check on a test). */
export function LevelIcon({ level, size = 14, className = '' }: { level: HierarchyLevel; size?: number; className?: string }) {
  const m = LEVEL_META[level];
  const Icon = m.icon;
  return <Icon size={size} strokeWidth={2.25} className={`shrink-0 ${className}`} style={{ color: `rgb(${m.rgb})` }} />;
}

/**
 * Per-view accent override. Re-points the global `--accent` theme var to the
 * level's colour so every accent-driven border / shadow / highlight on the page
 * adopts that colour — drop onto a page's root wrapper via `style`. Module ≈ the
 * app default, so we tone Feature (sky) + Test (emerald); Project keeps default.
 */
export function levelAccentVars(level: HierarchyLevel): CSSProperties {
  if (level === 'project') return {};
  const m = LEVEL_META[level];
  return { ['--accent']: m.hex, ['--accent-rgb']: m.rgb } as CSSProperties;
}
