import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import './fairy.css';
import './components/product-tour/product-tour.css';
import '@/lib/plugin-guide/plugin-guide.css';
import './components/plugin-guide/plugin-guide-site.css';
import { Nav, Footer } from './components/Nav';
import { Reveal } from './components/Reveal';
import { fetchRepoStarCount } from '@/lib/github-stars';
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
    default: `${site.name} — your agents, projects, and decisions in one place`,
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
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Zana — Your agents. Your projects. One clear view.' }]
  },
  twitter: {
    card: 'summary_large_image',
    title: site.name,
    description: site.tagline,
    images: ['/opengraph-image']
  },
  icons: {
    icon: [
      { url: '/favicon.svg?v=fairy-2', type: 'image/svg+xml', sizes: 'any' },
      { url: '/favicon-32.png?v=fairy-2', type: 'image/png', sizes: '32x32' }
    ],
    apple: [{ url: '/apple-touch-icon.png?v=fairy-2', sizes: '180x180' }]
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const starCount = await fetchRepoStarCount({ repoUrl: site.repo });
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav starCount={starCount} />
        <main id="main">{children}</main>
        <Footer />
        <Reveal />
      </body>
    </html>
  );
}
