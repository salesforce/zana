import { ZanaFairy } from './ZanaFairy.js';

export type FairySceneKind =
  | 'conversation'
  | 'first-turn'
  | 'inbox'
  | 'agents'
  | 'saved'
  | 'error'
  | 'ended'
  | 'missing'
  | 'window'
  | 'mobile'
  | 'plugin';

/** Decorative fairy scene. Callers own the accessible text around it. */
export function FairyScene({ kind }: { kind: FairySceneKind }) {
  return (
    <div className={`fairy-scene fairy-scene--${kind}`} data-scene={kind} aria-hidden="true">
      <SceneBody kind={kind} />
    </div>
  );
}

function WindowBar() {
  return (
    <div className="fairy-win-bar">
      <span /><span /><span />
    </div>
  );
}

function SceneBody({ kind }: { kind: FairySceneKind }) {
  switch (kind) {
    case 'conversation':
      return (
        <>
          <ZanaFairy />
          <div className="fairy-conv-thread">
            <span className="fairy-bubble fairy-bubble--user" />
            <span className="fairy-bubble" />
            <span className="fairy-bubble" />
            <span className="fairy-bubble fairy-bubble--user" />
          </div>
        </>
      );
    case 'first-turn':
      return (
        <>
          <span className="fairy-bubble fairy-bubble--user fairy-first-user" />
          <ZanaFairy />
          <div className="fairy-first-agent">
            <span /><span /><span />
          </div>
        </>
      );
    case 'inbox':
      return (
        <>
          <ZanaFairy />
          <div className="fairy-inbox-letter"><span /><span /></div>
          <svg className="fairy-inbox-envelope" viewBox="0 0 100 66">
            <rect x="1" y="1" width="98" height="64" rx="8" />
            <path d="M4 6 L50 38 L96 6" />
          </svg>
          <div className="fairy-inbox-badge">1</div>
        </>
      );
    case 'agents':
      return (
        <>
          <svg className="fairy-agents-card" viewBox="0 0 140 112">
            <rect className="fairy-agents-outline" x="1" y="1" width="138" height="110" rx="12" />
            <g className="fairy-agents-inner">
              <circle cx="30" cy="32" r="13" />
              <rect x="52" y="24" width="64" height="7" rx="3.5" />
              <rect x="52" y="36" width="42" height="5" rx="2.5" />
              <rect x="18" y="62" width="104" height="6" rx="3" />
              <rect x="18" y="76" width="80" height="6" rx="3" />
              <circle className="fairy-agents-live" cx="122" cy="96" r="4" />
            </g>
          </svg>
          <ZanaFairy />
        </>
      );
    case 'saved':
      return (
        <>
          <div className="fairy-saved-doc"><span /><span /><span /><span /><span /></div>
          <div className="fairy-saved-ribbon" />
          <ZanaFairy />
        </>
      );
    case 'error':
      return (
        <>
          <span className="fairy-error-puff" />
          <span className="fairy-error-puff" />
          <span className="fairy-error-puff" />
          <span className="fairy-error-puff" />
          <svg className="fairy-error-bolt" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
          <ZanaFairy />
        </>
      );
    case 'ended':
      return (
        <>
          <div className="fairy-ended-term">
            <WindowBar />
            <div className="fairy-ended-prompt">$ exit<br />$ <b /></div>
          </div>
          <ZanaFairy mood="resting" />
          <span className="fairy-ended-z">z</span>
          <span className="fairy-ended-z">z</span>
          <span className="fairy-ended-z">z</span>
        </>
      );
    case 'missing':
      return (
        <>
          <div className="fairy-missing-beam" />
          <svg className="fairy-missing-folder" viewBox="0 0 116 82">
            <path d="M2 12a8 8 0 0 1 8-8h28l9 9h59a8 8 0 0 1 8 8v51a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8z" />
            <text x="50" y="58">?</text>
          </svg>
          <ZanaFairy />
        </>
      );
    case 'window':
      return (
        <>
          <div className="fairy-win fairy-window-from"><WindowBar /><div className="fairy-window-hole" /></div>
          <div className="fairy-win fairy-window-to">
            <WindowBar />
            <div className="fairy-window-rows"><span /><span /><span /></div>
          </div>
          <span className="fairy-window-dust" />
          <span className="fairy-window-dust" />
          <span className="fairy-window-dust" />
          <span className="fairy-window-dust" />
          <ZanaFairy />
        </>
      );
    case 'mobile':
      return (
        <>
          <div className="fairy-mobile-phone"><span /></div>
          <div className="fairy-mobile-laptop">
            <div className="fairy-mobile-prompt">zcc ›<br />$ <b /></div>
          </div>
          <div className="fairy-mobile-base" />
          <ZanaFairy />
        </>
      );
    case 'plugin':
      return (
        <>
          <PluginTile d="M4 17l6-6-6-6M12 19h8" />
          <PluginTile d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18" />
          <PluginTile d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
          <PluginTile d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <div className="fairy-plugin-ring" />
          <ZanaFairy />
        </>
      );
  }
}

function PluginTile({ d }: { d: string }) {
  return (
    <span className="fairy-plugin-tile">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}
