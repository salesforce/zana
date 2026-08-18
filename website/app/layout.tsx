import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import { Nav, Footer } from './components/Nav';
import { Reveal } from './components/Reveal';
import { site } from '@/lib/site';

// Self-hosted at build time (no third-party render-blocking stylesheet), with
// font-display: swap so text paints immediately in the fallback and swaps in
// when the webfont arrives. Exposed as CSS variables that globals.css's
// --font-sans / --font-display point at.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  style: ['normal'],
  variable: '--font-fraunces'
});

export const metadata: Metadata = {
  metadataBase: new URL(site.publicBaseUrl),
  title: {
    default: `${site.name} — orchestrate AI coding harnesses across every project`,
    template: `%s — ${site.name}`
  },
  description: site.tagline,
  applicationName: site.name,
  keywords: [
    'Claude Code',
    'OpenCode',
    'Codex CLI',
    'Pi coding agent',
    'AI coding harnesses',
    'AI agents',
    'multi-agent orchestration',
    'developer cockpit',
    'terminal',
    'Electron'
  ],
  openGraph: {
    title: site.name,
    description: site.tagline,
    type: 'website',
    siteName: site.name,
    // Explicit reference so every route inherits the generated card even when a
    // child segment declares its own openGraph block (which otherwise drops the
    // file-convention image). Resolved against metadataBase.
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Zana Command Center — the control plane for AI coding harnesses' }]
  },
  twitter: {
    card: 'summary_large_image',
    title: site.name,
    description: site.tagline,
    images: ['/opengraph-image']
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }]
  }
};

/**
 * Set data-theme before first paint to avoid a flash. Honors a saved choice
 * (localStorage "zcc-theme"), otherwise using the public site's light default.
 * Kept inline + tiny so it runs synchronously in <head>.
 */
const NO_FLASH_THEME = `
(function(){try{
  var t = localStorage.getItem('zcc-theme');
  if(!t){ t = 'light'; }
  document.documentElement.setAttribute('data-theme', t);
}catch(e){ document.documentElement.setAttribute('data-theme','light'); }})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
        <Reveal />
      </body>
    </html>
  );
}
