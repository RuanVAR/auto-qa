/**
 * Tiny progress ring — a single value/total fraction as a green arc on a faint
 * track, with the % in the centre. Used for "features fully passed" coverage on
 * the project + module overviews. Renders just the muted track at 0/0 so an
 * empty scope still looks intentional.
 */
export function MiniRing({ passed, total, size = 44 }: { passed: number; total: number; size?: number }) {
  const frac = total > 0 ? Math.min(1, passed / total) : 0;
  const pct = Math.round(frac * 100);
  const r = 16;
  const circ = 2 * Math.PI * r;
  const dash = circ * frac;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 44 44" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="4" />
        {frac > 0 && (
          <circle
            cx="22" cy="22" r={r} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
          />
        )}
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums"
        style={{ color: 'rgba(238,238,248,0.85)' }}
      >
        {pct}%
      </span>
    </div>
  );
}
