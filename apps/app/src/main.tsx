import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { hasDesktopBridge } from './lib/app-surface.js';
// Prevent the OS from navigating to files dropped outside the terminal area.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

window.addEventListener('error', (event) => {
  const err = event.error instanceof Error ? event.error.stack || event.error.message : event.message;
  console.error('[renderer] window error:', err);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
  console.error('[renderer] unhandled rejection:', reason);
});

const root = document.getElementById('root');
// The menu-bar popover loads the SAME bundle with `?surface=popover`. It mounts
// a thin, read-only card (`MenubarPopover`) fed by a main-pushed snapshot —
// NOT the full shell. Critically it never imports `./App` (which pulls in the
// heavy store: session restore, pty spawning), so the popover stays cheap and
// can't drive app state.
const isPopover = new URLSearchParams(window.location.search).get('surface') === 'popover';

if (!root) {
  console.error('[renderer] root element not found');
} else if (isPopover) {
  document.body.classList.add('menubar-popover-body');
  void import('./components/MenubarPopover.js').then(({ MenubarPopover }) => {
    createRoot(root).render(
      <ErrorBoundary>
        <MenubarPopover />
      </ErrorBoundary>
    );
  });
} else {
  const appRoot = createRoot(root);
  const start = async () => {
    try {
      const startup = hasDesktopBridge()
        ? await window.cc.startup.state()
        : { mode: 'ready' as const };
      // Keep repair mode outside App: importing App initializes renderer stores
      // backed by data that migration has not made safe to read yet.
      const isRepair = startup.mode === 'repair-required';
      const Content = isRepair
        ? (await import('./components/StartupRepair.js')).StartupRepair
        : (await import('./App.js')).App;
      appRoot.render(
        <ErrorBoundary>
          {isRepair ? (
            <Content />
          ) : (
            <BrowserRouter>
              <Content />
            </BrowserRouter>
          )}
        </ErrorBoundary>
      );
    } catch (error) {
      console.error('[renderer] startup state failed:', error);
      const { StartupError } = await import('./components/StartupRepair.js');
      const message = error instanceof Error ? error.message : String(error);
      appRoot.render(
        <ErrorBoundary>
          <StartupError
            error={message}
            // A failed ESM import stays failed in the module map — calling
            // start() again would rethrow the same error. Reload the window
            // so Vite re-transforms from disk (e.g. after a hot-reload dropped
            // an export another module still referenced).
            onRetry={() => window.location.reload()}
          />
        </ErrorBoundary>
      );
    }
  };
  void start();
}
