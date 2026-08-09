'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { site } from '@/lib/site';

const LINKS = [
  { href: '/features/', label: 'Features' },
  { href: '/marketplace/', label: 'Marketplace' },
  { href: '/docs/', label: 'Docs' },
  { href: '/dashboard/', label: 'Publish an extension' }
];

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const current = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'dark';
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('zcc-theme', next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  // Before hydration `theme` is null — describe the action generically; once
  // known, announce the target so a screen reader says "Switch to light theme".
  const label =
    theme === null
      ? 'Toggle color theme'
      : `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`;

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      aria-pressed={theme === 'dark'}
      title="Toggle light / dark"
    >
      <svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
      </svg>
      <svg className="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <nav className="nav">
      <div className="wrap">
        <Link href="/" className="brand">
          <span className="mark">Z</span> Zana Command Center
        </Link>

        <div className="nav-links desktop">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={isActive(l.href) ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
          <a href={site.repo} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
          <div className="nav-cta">
            <ThemeToggle />
            <Link href="/download/" className="btn btn-primary btn-sm">
              Download
            </Link>
          </div>
        </div>

        {/* mobile */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }} className="mobile-only-controls">
          <ThemeToggle />
          <button
            type="button"
            className="nav-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="mobile-menu" id="mobile-menu">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
          <a href={site.repo} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
          <Link href="/download/" className="btn btn-primary">
            ⬇ Download
          </Link>
        </div>
      )}
    </nav>
  );
}

export function Footer() {
  // Start from a stable base so SSR and first client render agree (no hydration
  // mismatch), then correct to the real year after mount so it never goes stale.
  const [year, setYear] = useState(2026);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return (
    <footer>
      <div className="wrap">
        <div className="foot-top">
          <div>
            <span className="foot-brand">
              <span className="mark">Z</span> Zana Command Center
            </span>
            <p className="foot-blurb">
              An Electron cockpit for Claude Code — orchestrate many sessions across every project, from one
              window.
            </p>
          </div>
          <div className="foot-col">
            <h4>Product</h4>
            <Link href="/features/">Features</Link>
            <Link href="/marketplace/">Marketplace</Link>
            <Link href="/download/">Download</Link>
            <Link href="/dashboard/">Publish an extension</Link>
          </div>
          <div className="foot-col">
            <h4>Docs</h4>
            <Link href="/docs/">Documentation</Link>
            <Link href="/docs/cli/">The zcc CLI</Link>
            <Link href="/docs/extensions-authoring/">Build an extension</Link>
            <Link href="/docs/release-hosting/">Release hosting</Link>
          </div>
          <div className="foot-col">
            <h4>Resources</h4>
            <a href={site.repo}>Source (GitHub)</a>
            <a href={site.releasesRepo}>Releases</a>
            <a href={site.readmeUrl}>README ↗</a>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© {year} Zana Command Center. Free &amp; open.</span>
          <span>macOS today, Windows &amp; Linux soon — signed &amp; auto-updating.</span>
        </div>
      </div>
    </footer>
  );
}
