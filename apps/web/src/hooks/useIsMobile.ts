import { useEffect, useState } from 'react';

/**
 * True when the viewport is below Tailwind's `md` breakpoint (<768px) — i.e. a
 * phone-sized screen. Use for the handful of places where a CSS-only responsive
 * treatment isn't enough and the component needs to branch its render/behaviour
 * (e.g. swapping a desktop split-pane for a mobile tabbed layout). Prefer plain
 * Tailwind responsive classes where they suffice.
 */
export function useIsMobile(query = '(max-width: 767px)'): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return isMobile;
}
