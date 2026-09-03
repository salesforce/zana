'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { site } from '@/lib/site';

const LINKS = [
  { href: '/', label: 'Product' },
  { href: '/features/', label: 'Features' },
  { href: '/docs/', label: 'Docs' },
  { href: '/extensions/', label: 'Plugins' },
  { href: '/marketplace/', label: 'Marketplace' },
  { href: '/dashboard/', label: 'Publish' }
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

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <nav className="nav">
      <div className="wrap">
        <Link href="/" className="brand">
          <Image className="brand-mark" src="/favicon.svg" alt="" width={22} height={22} priority />
          <span className="brand-full">Zana Command Center</span>
          <span className="brand-short">Zana</span>
        </Link>

        <div className="nav-links desktop">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={isActive(l.href) ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
          <a
            className="nav-star-link"
            href={site.repo}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Star on GitHub"
            title="Star on GitHub"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.486 2 12.021c0 4.424 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.004.071 1.532 1.032 1.532 1.032.892 1.53 2.341 1.088 2.91.833.091-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.847-2.338 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.02C22 6.486 17.523 2 12 2Z" />
            </svg>
            Star
          </a>
          <div className="nav-cta">
            <ThemeToggle />
            <Link href="/download/" className="zcc-btn zcc-btn-primary zcc-btn-sm">
              Download
            </Link>
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }} className="mobile-only-controls">
          <ThemeToggle />
          <button
            type="button"
            className="nav-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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
          <a href={site.repo} target="_blank" rel="noopener noreferrer">Star on GitHub</a>
          <Link href="/download/" className="zcc-btn zcc-btn-primary">
            Download
          </Link>
        </div>
      )}
    </nav>
  );
}

export function Footer() {
  const [year, setYear] = useState(2026);
  useEffect(() => setYear(new Date().getFullYear()), []);
  return (
    <footer>
      <div className="wrap">
        <div className="foot-top">
          <div>
            <span className="foot-brand">
              <Image className="brand-mark" src="/favicon.svg" alt="" width={22} height={22} />
              Zana Command Center
            </span>
            <p className="foot-blurb">
              A desktop control plane for Claude Code, Cursor, OpenCode, Codex, and Pi sessions across every project.
            </p>
          </div>
          <div className="foot-col">
            <h4>Product</h4>
            <Link href="/">Home</Link>
            <Link href="/features/">Features</Link>
            <Link href="/download/">Download</Link>
            <Link href="/marketplace/">Marketplace</Link>
            <Link href="/dashboard/">Publish</Link>
          </div>
          <div className="foot-col">
            <h4>Docs</h4>
            <Link href="/docs/">Documentation</Link>
            <Link href="/docs/cli/">The zcc CLI</Link>
            <Link href="/extensions/">Plugins</Link>
          </div>
          <div className="foot-col">
            <h4>Resources</h4>
            <a href={site.repo}>Source</a>
            <a href={site.releasesRepo}>Releases</a>
            <a href={site.readmeUrl}>README</a>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© {year} Zana Command Center. Free and open source.</span>
          <span>macOS today · Windows and Linux soon</span>
        </div>
      </div>
    </footer>
  );
}
