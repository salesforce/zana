import { useState, type ReactNode } from 'react';
import { FLOW_HARNESSES, HOME_PROMPT, THREAD_TITLE, type FlowScene } from './flow-scene';
import { NAV_TO_SLIDE, useTourNav } from './tour-nav';

function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type IconName =
  | 'pen'
  | 'inbox'
  | 'bot'
  | 'clock'
  | 'blocks'
  | 'plus'
  | 'search'
  | 'term'
  | 'back'
  | 'settings'
  | 'folderTree'
  | 'folder'
  | 'more'
  | 'filter'
  | 'plug'
  | 'paperclip'
  | 'mic'
  | 'send'
  | 'alert'
  | 'zap'
  | 'moon'
  | 'check'
  | 'star'
  | 'chevron'
  | 'help'
  | 'gitBranch'
  | 'panel';

function Icon({
  name,
  size = 14,
  className
}: {
  name: IconName;
  size?: number;
  className?: string;
}): ReactNode {
  const plug = name === 'plug';
  return (
    <svg
      className={className ?? 'product-tour-glyph'}
      width={size}
      height={size}
      viewBox={plug ? '0 0 16 16' : '0 0 24 24'}
      fill={plug ? 'currentColor' : 'none'}
      stroke={plug ? undefined : 'currentColor'}
      strokeWidth={plug ? undefined : 2}
      strokeLinecap={plug ? undefined : 'round'}
      strokeLinejoin={plug ? undefined : 'round'}
      aria-hidden
    >
      {iconGlyph(name)}
    </svg>
  );
}

function iconGlyph(name: IconName): ReactNode {
  switch (name) {
    case 'pen':
      return (
        <>
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
        </>
      );
    case 'inbox':
      return (
        <>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </>
      );
    case 'bot':
      return (
        <>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <circle cx="9" cy="13" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="15" cy="13" r="0.6" fill="currentColor" stroke="none" />
        </>
      );
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </>
      );
    case 'blocks':
      return (
        <>
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
        </>
      );
    case 'plus':
      return <path d="M5 12h14M12 5v14" />;
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" />
        </>
      );
    case 'term':
      return (
        <>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="m8 9 3 3-3 3" />
          <path d="M13 15h4" />
        </>
      );
    case 'back':
      return <path d="M19 12H5M12 19l-7-7 7-7" />;
    case 'settings':
      return (
        <>
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0 1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </>
      );
    case 'folderTree':
      return (
        <>
          <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
          <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.88-.55H9.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1Z" />
          <path d="M3 5.5a2.5 2.5 0 0 1 5 0v10a2.5 2.5 0 0 1-5 0Z" />
        </>
      );
    case 'folder':
      return (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      );
    case 'more':
      return (
        <>
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case 'filter':
      return (
        <>
          <path d="M3 6h18" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </>
      );
    case 'plug':
      return (
        <path d="M5.2 1.5v3H3.8V1.5h1.4zm7 0v3h-1.4V1.5H12.2zM4.5 5.2h7c.7 0 1.3.6 1.3 1.3v3.2c0 2.4-1.6 4.4-3.8 5v1.8H7v-1.8c-2.2-.6-3.8-2.6-3.8-5V6.5c0-.7.6-1.3 1.3-1.3z" />
      );
    case 'paperclip':
      return (
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      );
    case 'mic':
      return (
        <>
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </>
      );
    case 'send':
      return <path d="M12 19V5M5 12l7-7 7 7" />;
    case 'alert':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </>
      );
    case 'zap':
      return <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />;
    case 'moon':
      return <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />;
    case 'check':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </>
      );
    case 'star':
      return (
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      );
    case 'chevron':
      return <path d="m9 18 6-6-6-6" />;
    case 'help':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" x2="12.01" y1="17" y2="17" />
        </>
      );
    case 'gitBranch':
      return (
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </>
      );
    case 'panel':
      return (
        <>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M15 3v18" />
        </>
      );
  }
}

function WindowFrame({ children }: { children: ReactNode }): ReactNode {
  return <div className="product-tour-window">{children}</div>;
}

function HarnessMark({ name, size = 14 }: { name: string; size?: number }): ReactNode {
  const cls = 'product-tour-glyph product-tour-harness-mark';
  if (name === 'Claude Code') {
    return (
      <svg
        className={cls}
        data-harness-icon="Claude Code"
        width={size}
        height={size}
        viewBox="0 0 149 149"
        fill="currentColor"
        aria-hidden
      >
        <path d="M29.05 98.54L58.19 82.19L58.68 80.77L58.19 79.98H56.77L51.9 79.68L35.25 79.23L20.81 78.63L6.82 77.88L3.3 77.13L0 72.78L0.340004 70.61L3.3 68.62L7.54 68.99L16.91 69.63L30.97 70.6L41.17 71.2L56.28 72.77H58.68L59.02 71.8L58.2 71.2L57.56 70.6L43.01 60.74L27.26 50.32L19.01 44.32L14.55 41.28L12.3 38.43L11.33 32.21L15.38 27.75L20.82 28.12L22.21 28.49L27.72 32.73L39.49 41.84L54.86 53.16L57.11 55.03L58.01 54.39L58.12 53.94L57.11 52.25L48.75 37.14L39.83 21.77L35.86 15.4L34.81 11.58C34.44 10.01 34.17 8.69 34.17 7.08L38.78 0.820007L41.33 0L47.48 0.820007L50.07 3.07001L53.89 11.81L60.08 25.57L69.68 44.28L72.49 49.83L73.99 54.97L74.55 56.54H75.52V55.64L76.31 45.1L77.77 32.16L79.19 15.51L79.68 10.82L82 5.2L86.61 2.16L90.21 3.88L93.17 8.12L92.76 10.86L91 22.3L87.55 40.22L85.3 52.22H86.61L88.11 50.72L94.18 42.66L104.38 29.91L108.88 24.85L114.13 19.26L117.5 16.6H123.87L128.56 23.57L126.46 30.77L119.9 39.09L114.46 46.14L106.66 56.64L101.79 65.04L102.24 65.71L103.4 65.6L121.02 61.85L130.54 60.13L141.9 58.18L147.04 60.58L147.6 63.02L145.58 68.01L133.43 71.01L119.18 73.86L97.96 78.88L97.7 79.07L98 79.44L107.56 80.34L111.65 80.56H121.66L140.3 81.95L145.17 85.17L148.09 89.11L147.6 92.11L140.1 95.93L129.98 93.53L106.36 87.91L98.26 85.89H97.14V86.56L103.89 93.16L116.26 104.33L131.75 118.73L132.54 122.29L130.55 125.1L128.45 124.8L114.84 114.56L109.59 109.95L97.7 99.94H96.91V100.99L99.65 105L114.12 126.75L114.87 133.42L113.82 135.59L110.07 136.9L105.95 136.15L97.48 124.26L88.74 110.87L81.69 98.87L80.83 99.36L76.67 144.17L74.72 146.46L70.22 148.18L66.47 145.33L64.48 140.72L66.47 131.61L68.87 119.72L70.82 110.27L72.58 98.53L73.63 94.63L73.56 94.37L72.7 94.48L63.85 106.63L50.39 124.82L39.74 136.22L37.19 137.23L32.77 134.94L33.18 130.85L35.65 127.21L50.39 108.46L59.28 96.84L65.02 90.13L64.98 89.16H64.64L25.49 114.58L18.52 115.48L15.52 112.67L15.89 108.06L17.31 106.56L29.08 98.46L29.04 98.5L29.05 98.54Z" />
      </svg>
    );
  }
  if (name === 'Cursor') {
    return (
      <svg
        className={cls}
        data-harness-icon="Cursor"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M4 5 L12 9.5 L20 5 L12 14 Z" />
        <path d="M4 5 L12 14 L12 22 L4 17.5 Z" opacity="0.55" />
        <path d="M20 5 L20 17.5 L12 22 L12 14 Z" opacity="0.8" />
      </svg>
    );
  }
  if (name === 'Codex') {
    return (
      <svg
        className={cls}
        data-harness-icon="Codex"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        fillRule="evenodd"
        aria-hidden
      >
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
      </svg>
    );
  }
  if (name === 'OpenCode') {
    return (
      <svg
        className={cls}
        data-harness-icon="OpenCode"
        width={size}
        height={size}
        viewBox="-72 -42 384 384"
        fill="none"
        aria-hidden
      >
        <path d="M180 240H60V120H180V240Z" fill="currentColor" fillOpacity={0.45} />
        <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" />
      </svg>
    );
  }
  return <Icon name="bot" size={size} />;
}

type NavId = 'new-chat' | 'inbox' | 'agents' | 'scheduler' | 'plugins';
type RailId = 'agents' | 'feed' | 'terminals' | 'explorer' | 'scheduler';

function AppShell({
  activeNav,
  activeRail,
  onRail,
  workspaceTitle,
  topbarExtra,
  sshHost,
  flushCanvas,
  overlay,
  inboxBadge,
  children
}: {
  activeNav: NavId;
  activeRail?: RailId;
  onRail?: (id: RailId) => void;
  workspaceTitle: ReactNode;
  topbarExtra?: ReactNode;
  sshHost?: boolean;
  flushCanvas?: boolean;
  overlay?: ReactNode;
  inboxBadge?: boolean;
  children: ReactNode;
}): ReactNode {
  const goToSlide = useTourNav();
  const nav: Array<{ id: NavId; icon: IconName; label: string }> = [
    { id: 'new-chat', icon: 'pen', label: 'New Chat' },
    { id: 'inbox', icon: 'inbox', label: 'Inbox' },
    { id: 'agents', icon: 'bot', label: 'Agents' },
    { id: 'scheduler', icon: 'clock', label: 'Scheduler' },
    { id: 'plugins', icon: 'blocks', label: 'Plugins' }
  ];
  const rail: Array<{ id: RailId; icon: IconName; label: string }> = [
    { id: 'agents', icon: 'bot', label: 'Agents' },
    { id: 'feed', icon: 'inbox', label: 'Feed' },
    { id: 'terminals', icon: 'term', label: 'Terminals' },
    { id: 'explorer', icon: 'folderTree', label: 'Explorer' },
    { id: 'scheduler', icon: 'clock', label: 'Scheduler' }
  ];

  return (
    <WindowFrame>
      <div className="product-tour-shell">
        <aside className="product-tour-nav">
          <div className="product-tour-titlebar">
            <span className="product-tour-traffic" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <Icon name="back" size={14} />
          </div>
          {nav.map((row) => (
            <button
              key={row.id}
              type="button"
              className={classNames('product-tour-nav-row', activeNav === row.id && 'is-active')}
              onClick={() => goToSlide(NAV_TO_SLIDE[row.id])}
            >
              <Icon name={row.icon} size={16} />
              {row.label}
              {row.id === 'agents' ? <span className="product-tour-status-dot" aria-hidden /> : null}
              {row.id === 'inbox' && inboxBadge ? (
                <span className="product-tour-status-dot is-inbox" aria-hidden />
              ) : null}
            </button>
          ))}
          <div className="product-tour-thread-stack">
            <div className="product-tour-ws-head">
              <span className="product-tour-section product-tour-ws-head-title">Projects</span>
              <span className="product-tour-ws-head-actions">
                <span className="product-tour-icon-hit">
                  <Icon name="filter" size={14} />
                </span>
                <span className="product-tour-icon-hit">
                  <Icon name="more" size={14} />
                </span>
                <span className="product-tour-icon-hit">
                  <Icon name="plus" size={14} />
                </span>
              </span>
            </div>
            <div className="product-tour-folder">zana-command-center</div>
            <div className={classNames('product-tour-nav-row', !sshHost && 'is-active')}>Acme</div>
            <div className="product-tour-nav-row">checkout-api</div>
            <div className="product-tour-nav-row">docs-site</div>
            {sshHost ? (
              <>
                <span className="product-tour-section">Machines</span>
                <button type="button" className="product-tour-nav-row is-active" onClick={() => goToSlide('remote')}>
                  fde-box
                  <span className="product-tour-ssh-tag">SSH</span>
                </button>
              </>
            ) : null}
          </div>
          <div className="product-tour-footer">
            <span className="product-tour-icon-hit product-tour-icon-hit-lg">
              <Icon name="settings" size={18} />
            </span>
            <span className="product-tour-icon-hit product-tour-icon-hit-lg">
              <Icon name="plug" size={18} />
            </span>
          </div>
        </aside>
        {activeRail ? (
          <aside className="product-tour-list">
            <header className="product-tour-list-head">
              <Icon name="back" size={14} /> Acme
            </header>
            {rail.map((row) => {
              const selected = activeRail === row.id;
              if (onRail) {
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={classNames('product-tour-list-row', selected && 'is-selected')}
                    onClick={() => onRail(row.id)}
                  >
                    <Icon name={row.icon} size={16} /> {row.label}
                  </button>
                );
              }
              return (
                <div
                  key={row.id}
                  className={classNames('product-tour-list-row', selected && 'is-selected')}
                >
                  <Icon name={row.icon} size={16} /> {row.label}
                </div>
              );
            })}
          </aside>
        ) : null}
        <section className="product-tour-workspace">
          <header className="product-tour-topbar">
            <span className="product-tour-topbar-title">{workspaceTitle}</span>
            {topbarExtra}
          </header>
          <div className={classNames('product-tour-canvas', flushCanvas && 'is-flush')}>
            {children}
            {overlay}
          </div>
        </section>
      </div>
    </WindowFrame>
  );
}

function AgentCard({
  title,
  prompt,
  harness,
  project = 'Acme',
  duration,
  live,
  need,
  ssh,
  idle,
  thread,
  onOpen
}: {
  title: string;
  prompt: string;
  harness: string;
  project?: string;
  duration?: string;
  live?: boolean;
  need?: boolean;
  ssh?: boolean;
  idle?: string;
  thread?: boolean;
  onOpen?: () => void;
}): ReactNode {
  const body = (
    <>
      {live ? (
        <span className="product-tour-card-activity" aria-hidden>
          <i />
        </span>
      ) : null}
      <span className="product-tour-card-head">
        <Icon name={thread ? 'pen' : 'bot'} size={14} />
        <span className="product-tour-card-title">{title}</span>
        {live ? <span className="product-tour-pulse" aria-hidden /> : null}
        {need ? <span className="product-tour-pulse is-need" aria-hidden /> : null}
        <Icon name="star" size={12} className="product-tour-glyph product-tour-card-star" />
      </span>
      <p>{prompt}</p>
      <div className="product-tour-card-foot">
        <span className="product-tour-harness">{harness}</span>
        {ssh ? <span className="product-tour-ssh-tag">SSH</span> : null}
        <span className="product-tour-card-project">{project}</span>
        <span className="product-tour-card-branch">
          <Icon name="gitBranch" size={11} />
          main
        </span>
        {idle ? <span>{idle}</span> : null}
        {duration ? <span className={classNames('product-tour-card-dur', live && 'is-live')}>{duration}</span> : null}
      </div>
    </>
  );
  const cls = classNames(
    'product-tour-card',
    live && 'is-live',
    need && 'is-need',
    thread && 'is-thread'
  );
  if (onOpen) {
    return (
      <button type="button" className={cls} onClick={onOpen}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

function Board({
  peek = false,
  remote = false,
  launch = false
}: {
  peek?: boolean;
  remote?: boolean;
  launch?: boolean;
}): ReactNode {
  const goToSlide = useTourNav();
  const workingCount = launch ? 3 : remote || !peek ? 2 : 1;
  const checkoutCard = (
    <AgentCard
      title="Checkout flakes"
      prompt="Fix the flaky checkout tests"
      harness="Cursor"
      need={!launch}
      live={launch}
      thread
      duration={launch ? '1m' : '14m'}
      onOpen={() => goToSlide('thread')}
    />
  );
  return (
    <div className={classNames('product-tour-board', peek && 'is-peek')} aria-label="Agents board">
      <div className="product-tour-col">
        <div className="product-tour-col-head product-tour-lane-need">
          <Icon name="alert" size={13} />
          Needs you <span className="product-tour-col-count">{launch ? 0 : 1}</span>
        </div>
        <div className="product-tour-col-body">{launch ? null : checkoutCard}</div>
      </div>
      <div className="product-tour-col">
        <div className="product-tour-col-head product-tour-lane-work">
          <Icon name="zap" size={13} />
          Working <span className="product-tour-col-count">{workingCount}</span>
        </div>
        <div className="product-tour-col-body">
          {launch ? checkoutCard : null}
          <AgentCard
            title="Pairing relay"
            prompt="Ship the pairing flow on this host."
            harness="Claude Code"
            live
            duration="8m"
            onOpen={() => goToSlide('cli')}
          />
          {peek ? null : (
            <AgentCard
              title="Nightly audit"
              prompt={remote ? 'Running on fde-box over SSH.' : 'Scan dependencies for the morning digest.'}
              harness="Codex"
              live
              ssh={remote}
              project={remote ? 'fde-box' : 'Acme'}
              duration="3m"
            />
          )}
        </div>
      </div>
      {peek ? null : (
        <>
          <div className="product-tour-col">
            <div className="product-tour-col-head product-tour-lane-idle">
              <Icon name="moon" size={13} />
              Idle <span className="product-tour-col-count">1</span>
            </div>
            <div className="product-tour-col-body">
              <AgentCard title="Docs pass" prompt="Tighten the getting-started chapter." harness="OpenCode" idle="idle 12m" />
            </div>
          </div>
          <div className="product-tour-col">
            <div className="product-tour-col-head product-tour-lane-done">
              <Icon name="check" size={13} />
              Done <span className="product-tour-col-count">1</span>
            </div>
            <div className="product-tour-col-body">
              <AgentCard title="Release notes" prompt="Draft 2.0.3 from the local work." harness="Codex" thread duration="41m" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InboxFeed(): ReactNode {
  return (
    <div className="product-tour-inbox">
      <div className="product-tour-summary">
        <strong>AI Summary</strong>
        <p>3 items need you. Checkout flakes is blocked on retries; pairing is ready to review.</p>
      </div>
      <div className="product-tour-pinned">
        <div className="product-tour-pinned-head">
          <Icon name="help" size={12} />
          Needs your answer
          <em>1</em>
        </div>
        <div className="product-tour-entry is-pinned">
          <span className="product-tour-entry-kicker is-question">Question</span>
          <strong>Which retry budget for checkout?</strong>
          <p>The suite flakes in two places. Reply here and it goes back to the waiting agent.</p>
          <div className="product-tour-entry-meta">
            <span>Acme · 2m</span>
            <span className="product-tour-reply">Reply</span>
          </div>
        </div>
      </div>
      <div className="product-tour-bucket">Today</div>
      <div className="product-tour-entry">
        <span className="product-tour-entry-kicker">Report</span>
        <strong>Pairing flow is ready to review</strong>
        <p>Shipped on this host. Linked the walkthrough in the project library.</p>
        <div className="product-tour-entry-meta">
          <span>Acme · 18m</span>
        </div>
      </div>
      <div className="product-tour-entry">
        <span className="product-tour-entry-kicker is-idea">Idea</span>
        <strong>Cache the GUS query</strong>
        <p>The org-chart pull is the slow step on every standup digest.</p>
        <div className="product-tour-entry-meta">
          <span>Acme · 1h</span>
        </div>
      </div>
      <div className="product-tour-folded">
        <Icon name="chevron" size={12} />
        Routine <em>4</em>
      </div>
      <div className="product-tour-folded">
        <Icon name="chevron" size={12} />
        Agent closed <em>2</em>
      </div>
    </div>
  );
}

function ComposerCard({
  variant,
  draft,
  harness = 'Claude Code',
  pickerOpen = false,
  pickerHighlight = null,
  caret = false,
  sendPulse = false,
  harnessHot = false
}: {
  variant: 'home' | 'thread' | 'cli';
  draft: ReactNode;
  harness?: string;
  pickerOpen?: boolean;
  pickerHighlight?: string | null;
  caret?: boolean;
  sendPulse?: boolean;
  harnessHot?: boolean;
}): ReactNode {
  const modelChip =
    harness === 'Cursor' ? 'Grok' : variant === 'home' && harness === 'Claude Code' ? 'Opus' : null;
  return (
    <div className={classNames('product-tour-composer', variant === 'home' && 'is-home')}>
      <div className="product-tour-composer-prompt">
        {draft}
        {caret ? <span className="product-tour-caret" aria-hidden /> : null}
      </div>
      <div className="product-tour-composer-tools">
        <div className="product-tour-composer-tools-start">
          {variant === 'thread' ? <span className="product-tour-picker">Agent</span> : null}
          <span className="product-tour-picker-wrap">
            <span className={classNames('product-tour-picker', harnessHot && 'is-hot')}>
              {variant === 'cli' ? <Icon name="term" size={14} /> : <HarnessMark name={harness} size={14} />}
              {harness}
            </span>
            {pickerOpen ? (
              <div className="product-tour-picker-menu" role="listbox" aria-label="Harness">
                {FLOW_HARNESSES.map((option) => (
                  <span
                    key={option}
                    className={classNames(
                      'product-tour-picker-item',
                      option === harness && 'is-active',
                      option === pickerHighlight && 'is-hot'
                    )}
                    role="option"
                    aria-selected={option === harness}
                  >
                    <HarnessMark name={option} size={14} />
                    {option}
                    {option === harness ? (
                      <Icon name="check" size={12} className="product-tour-glyph product-tour-picker-check" />
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
          </span>
          {modelChip ? <span className="product-tour-picker">{modelChip}</span> : null}
        </div>
        <div className="product-tour-composer-tools-end">
          <span className="product-tour-composer-icon">
            <Icon name="paperclip" size={14} />
          </span>
          <span className="product-tour-composer-icon">
            <Icon name="mic" size={14} />
          </span>
          <span className={classNames('product-tour-send', sendPulse && 'is-pulse')}>
            <Icon name="send" size={16} />
          </span>
        </div>
      </div>
    </div>
  );
}

function ComposerMeta(): ReactNode {
  return (
    <div className="product-tour-composer-meta">
      <span className="product-tour-composer-chip">
        <Icon name="folder" size={12} />
        Acme
      </span>
      <span className="product-tour-picker">Full Access</span>
    </div>
  );
}

function SidePanel({
  tabs,
  wide,
  flush,
  children
}: {
  tabs: Array<{ label: string; active?: boolean }>;
  wide?: boolean;
  flush?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <aside className={classNames('product-tour-side', wide && 'is-split')}>
      <header className="product-tour-side-tabs">
        {tabs.map((tab) => (
          <span key={tab.label} className={classNames('product-tour-side-tab', tab.active && 'is-active')}>
            {tab.label}
          </span>
        ))}
      </header>
      <div className={classNames('product-tour-side-body', flush && 'is-flush')}>{children}</div>
    </aside>
  );
}

function ThreadDiff(): ReactNode {
  const lines: Array<{ kind?: 'add' | 'del'; text: string }> = [
    { kind: 'del', text: '- const stripe = mockStripe();' },
    { kind: 'add', text: '+ beforeEach(() => {' },
    { kind: 'add', text: '+   mockStripe.reset();' },
    { kind: 'add', text: '+ });' },
    { text: "  it('checks out', async () => {" },
    { kind: 'del', text: '-   await pay();' },
    { kind: 'add', text: '+   await pay({ isolated: true });' }
  ];
  return (
    <div className="product-tour-diff" data-tour-diff>
      <header className="product-tour-diff-toolbar">
        <span>checkout.spec.ts</span>
        <span className="product-tour-diff-stat">+6 −2</span>
      </header>
      <pre className="product-tour-diff-body">
        {lines.map((line) => (
          <span
            key={line.text}
            className={classNames('product-tour-diff-line', line.kind && `is-${line.kind}`)}
          >
            {line.text}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function FeaturesWireframe(): ReactNode {
  const [mode, setMode] = useState<'thread' | 'cli'>('thread');
  return (
    <div className="product-tour-stage">
      <AppShell activeNav="new-chat" workspaceTitle="New Chat">
        <div className="product-tour-home">
          <div className="product-tour-launch" role="group" aria-label="Launch mode">
            <button
              type="button"
              className={classNames(mode === 'thread' && 'is-active')}
              onClick={() => setMode('thread')}
            >
              Modern <span className="product-tour-new">NEW</span>
            </button>
            <button
              type="button"
              className={classNames(mode === 'cli' && 'is-active')}
              onClick={() => setMode('cli')}
            >
              CLI Agent
            </button>
          </div>
          <ComposerCard
            variant={mode === 'cli' ? 'cli' : 'home'}
            draft={
              <span className="product-tour-placeholder">
                {mode === 'cli' ? 'Instruction for the CLI agent' : 'Describe the task…'}
              </span>
            }
          />
          <ComposerMeta />
          <div className="product-tour-home-tiles">
            {['Release 1.4', 'Bug triage', 'Design QA'].map((card) => (
              <span key={card} className="product-tour-home-tile">
                <strong>{card}</strong>
                <i />
                <i className="is-short" />
              </span>
            ))}
          </div>
        </div>
      </AppShell>
    </div>
  );
}

export function KanbanWireframe(): ReactNode {
  return (
    <div className="product-tour-stage">
      <AppShell activeNav="agents" activeRail="agents" workspaceTitle="Agents">
        <Board />
      </AppShell>
    </div>
  );
}

export function ThreadWireframe(): ReactNode {
  return (
    <div className="product-tour-stage">
      <AppShell
        activeNav="agents"
        workspaceTitle="Fix flaky checkout tests"
        topbarExtra={
          <>
            <span className="product-tour-state is-need">Needs you</span>
            <span className="product-tour-icon-hit">
              <Icon name="panel" size={14} />
            </span>
          </>
        }
        flushCanvas
      >
        <div className="product-tour-split">
          <div className="product-tour-thread-col">
            <div className="product-tour-timeline">
              <div className="product-tour-bubble is-user">Fix the flaky checkout tests</div>
              <div className="product-tour-tool">
                <span>
                  Re-ran checkout suite <em>Completed</em>
                </span>
                <span className="product-tour-bar" />
              </div>
              <div className="product-tour-assistant">
                <p>The retries cluster in two suites. Failure rate by suite:</p>
                <span className="product-tour-bars" aria-hidden>
                  <i />
                  <i className="is-tall" />
                  <i />
                  <i className="is-mid" />
                </span>
                <p>
                  Fixed by isolating the <strong>Stripe mock</strong> per test.
                </p>
                <span className="product-tour-file">checkout.spec.ts</span>
                <span className="product-tour-msg-actions">Copy · Fork</span>
              </div>
              <div className="product-tour-pending">
                <span>
                  <Icon name="help" size={12} /> Which retry budget for checkout?
                </span>
                <span className="product-tour-pending-row">
                  <span className="product-tour-field">3 retries</span>
                  <span className="product-tour-btn">Cancel</span>
                  <span className="product-tour-btn is-primary">Reply</span>
                </span>
              </div>
            </div>
            <div className="product-tour-thread-dock">
              <ComposerCard
                variant="thread"
                draft={
                  <span>
                    Summarize <span className="product-tour-mention">@release-notes</span> and fold in the retry budget.
                  </span>
                }
              />
              <ComposerMeta />
            </div>
          </div>
          <SidePanel tabs={[{ label: 'Info', active: true }, { label: 'Files' }, { label: 'Tasks' }]}>
            <strong>Cursor · Modern thread</strong>
            <p>Acme · main</p>
            <div className="product-tour-skel" />
            <div className="product-tour-skel is-short" />
          </SidePanel>
        </div>
      </AppShell>
    </div>
  );
}

export function CliWireframe(): ReactNode {
  return (
    <div className="product-tour-stage">
      <AppShell
        activeNav="agents"
        workspaceTitle="Pairing relay"
        topbarExtra={
          <>
            <span className="product-tour-state is-work">Working</span>
            <span className="product-tour-harness">Claude Code</span>
            <span className="product-tour-icon-hit">
              <Icon name="panel" size={14} />
            </span>
          </>
        }
        flushCanvas
      >
        <div className="product-tour-split">
          <div className="product-tour-thread-col">
            <div className="product-tour-term" aria-label="CLI agent terminal">
              <div className="product-tour-term-line dim">~/acme · claude</div>
              <div className="product-tour-term-line">
                <span className="product-tour-term-prompt">&gt;</span> Ship the pairing flow on this host.
              </div>
              <div className="product-tour-term-line dim">● Read src/pairing.ts</div>
              <div className="product-tour-term-line dim">● Edit src/pairing.ts (+48 −12)</div>
              <div className="product-tour-term-line">
                Pairing notes drafted. Two edges left — reply with what to fold in.
              </div>
              <div className="product-tour-term-line">
                <span className="product-tour-term-prompt">❯</span>
                <span className="product-tour-caret" aria-hidden />
              </div>
            </div>
          </div>
          <SidePanel tabs={[{ label: 'Info', active: true }, { label: 'Diff' }]}>
            <strong>Claude Code</strong>
            <p>Working · 8m</p>
            <dl className="product-tour-facts">
              <div>
                <dt>Project</dt>
                <dd>Acme</dd>
              </div>
              <div>
                <dt>Directory</dt>
                <dd>~/acme</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>main</dd>
              </div>
            </dl>
          </SidePanel>
        </div>
      </AppShell>
    </div>
  );
}

export function InboxWireframe(): ReactNode {
  return (
    <div className="product-tour-stage">
      <AppShell activeNav="inbox" workspaceTitle="Inbox">
        <InboxFeed />
      </AppShell>
    </div>
  );
}

export function PluginsWireframe(): ReactNode {
  return (
    <div className="product-tour-stage">
      <AppShell activeNav="plugins" workspaceTitle="Plugins">
        <div className="product-tour-hub">
          <div className="product-tour-hub-search">
            <Icon name="search" size={14} /> Search plugins…
          </div>
          <div className="product-tour-hub-label">Installed</div>
          <div className="product-tour-plugin-row">
            <span className="product-tour-plugin-icon">
              <Icon name="blocks" size={16} />
            </span>
            <span>
              <strong>Tasks</strong>
              <p>A persistent work list agents can claim.</p>
            </span>
            <span className="product-tour-plugin-status">On</span>
          </div>
          <div className="product-tour-plugin-row">
            <span className="product-tour-plugin-icon">
              <Icon name="folder" size={16} />
            </span>
            <span>
              <strong>Docs</strong>
              <p>Project library on the workspace rail.</p>
            </span>
            <span className="product-tour-plugin-status">On</span>
          </div>
          <div className="product-tour-hub-label">Browse</div>
          <div className="product-tour-plugin-grid">
            <div className="product-tour-plugin">
              <strong>PR Monitor</strong>
              <p>Watch pull requests from the same cockpit.</p>
              <span className="product-tour-official">Official</span>
            </div>
            <div className="product-tour-plugin">
              <strong>Salesforce</strong>
              <p>Org workflows beside the Agents board.</p>
              <span className="product-tour-official">Official</span>
            </div>
          </div>
          <div className="product-tour-hub-actions">
            <span className="product-tour-cta">
              <Icon name="plus" size={14} /> New plugin
            </span>
            <span className="product-tour-trust">Confirm full trust to install</span>
          </div>
        </div>
      </AppShell>
    </div>
  );
}

export function RemoteWireframe(): ReactNode {
  return (
    <div className="product-tour-stage">
      <AppShell
        activeNav="agents"
        activeRail="agents"
        workspaceTitle="Agents"
        sshHost
        topbarExtra={
          <span className="product-tour-ssh-tag">Connected · fde-box</span>
        }
      >
        <Board remote />
      </AppShell>
    </div>
  );
}

function FlakeDiagram(): ReactNode {
  return (
    <div className="product-tour-mermaid">
      <div className="product-tour-mermaid-toolbar">Copy · PNG</div>
      <div className="product-tour-mermaid-graph">
        <div className="product-tour-mermaid-row">
          <span className="product-tour-mermaid-node">checkout.spec</span>
          <span className="product-tour-mermaid-node">payment.spec</span>
        </div>
        <div className="product-tour-mermaid-fan" aria-hidden>
          <i />
          <i />
        </div>
        <span className="product-tour-mermaid-node is-hot">Stripe mock</span>
        <span className="product-tour-mermaid-edge" aria-hidden />
        <span className="product-tour-mermaid-node">Timeout / retry</span>
        <span className="product-tour-mermaid-edge" aria-hidden />
        <span className="product-tour-mermaid-node is-fix">Isolate mock per test</span>
      </div>
    </div>
  );
}

function composerDraft(text: string, placeholder: string): ReactNode {
  if (text) return text;
  return <span className="product-tour-placeholder">{placeholder}</span>;
}

export function HomeFlowWireframe({ scene }: { scene: FlowScene }): ReactNode {
  const home = scene.view === 'home';
  const kanban = scene.view === 'kanban';
  const working = scene.status === 'working';
  const nav: 'new-chat' | 'agents' = home ? 'new-chat' : 'agents';
  const title = home ? 'New Chat' : kanban ? 'Agents' : THREAD_TITLE;
  return (
    <div
      className="product-tour-stage"
      data-flow-view={scene.view}
      data-flow-harness={scene.harness}
      data-flow-loading={scene.loading ? 'true' : undefined}
      data-flow-diagram={scene.diagram}
      data-flow-side={scene.sideTab}
      data-flow-status={scene.status}
    >
      <AppShell
        activeNav={nav}
        activeRail={kanban ? 'agents' : undefined}
        workspaceTitle={title}
        flushCanvas={scene.view === 'thread'}
        overlay={
          scene.loading ? (
            <div className="product-tour-overlay">
              <span className="product-tour-spinner" aria-hidden />
              <strong>Starting Cursor…</strong>
              <p>Acme · Modern thread</p>
            </div>
          ) : null
        }
        topbarExtra={
          scene.view === 'thread' ? (
            <>
              <span className={classNames('product-tour-state', working && 'is-work')}>
                {working ? 'Working' : 'Idle'}
              </span>
              {working ? <span className="product-tour-pulse is-work" aria-hidden /> : null}
              <span className="product-tour-harness">
                <HarnessMark name={scene.harness} size={12} />
                {scene.harness}
              </span>
              <span className="product-tour-icon-hit">
                <Icon name="panel" size={14} />
              </span>
            </>
          ) : undefined
        }
      >
        {home ? (
          <div className={classNames('product-tour-home', scene.loading && 'is-dim')}>
            <div className="product-tour-launch" role="group" aria-label="Launch mode">
              <span className="is-active">
                Modern <span className="product-tour-new">NEW</span>
              </span>
              <span>CLI Agent</span>
            </div>
            <ComposerCard
              variant="home"
              harness={scene.harness}
              pickerOpen={scene.pickerOpen}
              pickerHighlight={scene.pickerHighlight}
              caret={scene.caret === 'home'}
              sendPulse={scene.sendPulse === 'home'}
              harnessHot={scene.harnessHot}
              draft={composerDraft(scene.homeDraft, 'Describe the task…')}
            />
            <ComposerMeta />
            <div className="product-tour-home-tiles">
              {['Release 1.4', 'Bug triage', 'Design QA'].map((card) => (
                <span key={card} className="product-tour-home-tile">
                  <strong>{card}</strong>
                  <i />
                  <i className="is-short" />
                </span>
              ))}
            </div>
          </div>
        ) : kanban ? (
          <Board launch />
        ) : (
          <div className="product-tour-split">
            <div className="product-tour-thread-col">
              <div className="product-tour-timeline is-demo">
                {scene.userSent ? (
                  <div className="product-tour-bubble is-user">{HOME_PROMPT}</div>
                ) : null}
                {working && scene.tools.length === 0 ? (
                  <p className="product-tour-working is-shimmer">Working…</p>
                ) : null}
                {scene.tools.map((tool) => (
                  <div key={tool.label} className="product-tour-tool">
                    <span>
                      {tool.label} <em>{tool.done ? 'Completed' : 'Running'}</em>
                    </span>
                    {tool.done ? <span className="product-tour-bar" /> : null}
                  </div>
                ))}
                {scene.tools.length >= 2 ? (
                  <span className="product-tour-file">checkout.spec.ts</span>
                ) : null}
                {scene.assistant ? (
                  <div className="product-tour-assistant">
                    <p>
                      {scene.assistant.includes('Stripe mock') ? (
                        <>
                          {scene.assistant.slice(0, scene.assistant.indexOf('Stripe mock'))}
                          <strong>Stripe mock</strong>
                          {scene.assistant.slice(scene.assistant.indexOf('Stripe mock') + 'Stripe mock'.length)}
                        </>
                      ) : (
                        scene.assistant
                      )}
                    </p>
                    {scene.diagram === 'shown' ? <FlakeDiagram /> : null}
                    {scene.diagram === 'shown' ? (
                      <span className="product-tour-msg-actions">Copy · Fork</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="product-tour-thread-dock">
                <ComposerCard
                  variant="thread"
                  harness={scene.harness}
                  caret={scene.caret === 'thread'}
                  sendPulse={scene.sendPulse === 'thread'}
                  draft={composerDraft(scene.threadDraft, 'Describe the task…')}
                />
                <ComposerMeta />
              </div>
            </div>
            <SidePanel
              wide={scene.sideWide}
              flush={scene.sideTab === 'diff'}
              tabs={[
                { label: 'Info', active: scene.sideTab === 'info' },
                { label: 'Files' },
                { label: 'Diff', active: scene.sideTab === 'diff' }
              ]}
            >
              {scene.sideTab === 'diff' ? (
                <ThreadDiff />
              ) : (
                <>
                  <strong>Cursor · Modern thread</strong>
                  <dl className="product-tour-facts">
                    <div>
                      <dt>Project</dt>
                      <dd>Acme</dd>
                    </div>
                    <div>
                      <dt>Directory</dt>
                      <dd>~/acme</dd>
                    </div>
                    <div>
                      <dt>Branch</dt>
                      <dd>main</dd>
                    </div>
                  </dl>
                </>
              )}
            </SidePanel>
          </div>
        )}
      </AppShell>
    </div>
  );
}

export function SlideWireframe({ slideId }: { slideId: string }): ReactNode {
  switch (slideId) {
    case 'features':
      return <FeaturesWireframe />;
    case 'thread':
      return <ThreadWireframe />;
    case 'cli':
      return <CliWireframe />;
    case 'inbox':
      return <InboxWireframe />;
    case 'plugins':
      return <PluginsWireframe />;
    case 'remote':
      return <RemoteWireframe />;
    default:
      return <KanbanWireframe />;
  }
}
