import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const HASH_NAVIGATION_WAIT_MS = 2_000;

function hashTargetId(hash: string): string | null {
  if (hash.length <= 1) return null;
  try {
    return decodeURIComponent(hash.slice(1)) || null;
  } catch {
    return hash.slice(1) || null;
  }
}

/**
 * Scroll a hash target into view after the destination panel mounts. Settings
 * subsections use `settings-anchor-<id>` ids; other views may use the raw hash.
 */
export function HashNavigationScroll() {
  const location = useLocation();

  useEffect(() => {
    const targetId = hashTargetId(location.hash);
    if (!targetId) return;
    const started = Date.now();
    let cancelled = false;
    const tryScroll = () => {
      if (cancelled) return;
      const el =
        document.getElementById(`settings-anchor-${targetId}`) ??
        document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (Date.now() - started < HASH_NAVIGATION_WAIT_MS) {
        window.requestAnimationFrame(tryScroll);
      }
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [location.hash, location.pathname]);

  return null;
}
