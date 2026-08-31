import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Nav, Footer } from './components/Nav';
import { StarBanner } from './components/StarBanner';
import { Reveal } from './components/Reveal';
import { site } from '@/lib/site';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains'
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
    'Cursor',
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
 * Set data-theme before first paint. Honors localStorage "zcc-theme";
 * otherwise dark — the same default as the desktop app.
 */
const NO_FLASH_THEME = `
(function(){try{
  var t = localStorage.getItem('zcc-theme');
  if(!t){ t = 'dark'; }
  document.documentElement.setAttribute('data-theme', t);
}catch(e){ document.documentElement.setAttribute('data-theme','dark'); }})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
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
        <StarBanner />
        <Reveal />
      </body>
    </html>
  );
}
