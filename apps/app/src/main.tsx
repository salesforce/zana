import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { hasDesktopBridge } from './lib/app-surface.js';
import { getPluginViewTarget } from './lib/pluginViewSurface.js';
import { getThreadViewTarget } from './lib/threadViewSurface.js';
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
      // A plugin view window (`?surface=plugin-view`) shows one plugin project
      // tab and never imports `./App`, so it cannot restore sessions or drive
      // main-window state.
      const pluginView = isRepair ? null : getPluginViewTarget();
      // A thread view window (`?surface=thread-view`) shows one thread and its
      // side panel, likewise without `./App`.
      const threadView = isRepair || pluginView ? null : getThreadViewTarget();
      if (!isRepair) {
        // Every window needs main's open plugin and thread view sets from the
        // start, so a navigation can bring an open one forward before any pane subscribes.
        // Browser reveals are queued from the start too, so one aimed at a thread
        // that is not open yet is shown when the user opens it.
        const [{ startPluginViewMirror }, { startThreadViewMirror }, { startDesktopBrowserRevealQueue }] = await Promise.all([
          import('./plugins/plugin-view-windows.js'),
          import('./lib/thread-view-windows.js'),
          import('./lib/desktop-browser-reveal-queue.js')
        ]);
        startPluginViewMirror();
        startThreadViewMirror();
        startDesktopBrowserRevealQueue();
      }
      // Routers render navigations as urgent updates, in the same pass as the
      // store writes that go with them. As transitions, every store update
      // restarted the route render, and Back took seconds under load (#532).
      let content: ReactElement;
      if (isRepair) {
        const { StartupRepair } = await import('./components/StartupRepair.js');
        content = <StartupRepair />;
      } else if (pluginView) {
        const { PluginViewApp } = await import('./views/plugin-view/PluginViewApp.js');
        content = (
          <BrowserRouter useTransitions={false}>
            <PluginViewApp target={pluginView} />
          </BrowserRouter>
        );
      } else if (threadView) {
        const { ThreadViewApp } = await import('./views/thread-view/ThreadViewApp.js');
        content = (
          <BrowserRouter useTransitions={false}>
            <ThreadViewApp target={threadView} />
          </BrowserRouter>
        );
      } else {
        const { App } = await import('./App.js');
        content = (
          <BrowserRouter useTransitions={false}>
            <App />
          </BrowserRouter>
        );
      }
      appRoot.render(<ErrorBoundary>{content}</ErrorBoundary>);
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
