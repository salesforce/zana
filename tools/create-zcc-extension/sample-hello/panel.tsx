/**
 * Source for the `hello` sample extension. This is the MAINTAINABLE source; the
 * runnable artifact (the built ESM) is committed at bundled-extensions/hello/
 * so QA can copy it straight into ~/.zcc/extensions/hello/ with no build.
 *
 * If you change this file, hand-port the change into
 * bundled-extensions/hello/renderer.js (it's intentionally tiny and authored
 * directly as valid ESM — see the note there).
 *
 * Contract reminders:
 *   - DO NOT import react. The host injects React via activate({ React, host }).
 *   - Build with React.createElement (not JSX) so nothing references the
 *     externalized jsx-runtime.
 *
 * Phase 2 dogfood: exercises host.on('project:changed') (live re-render on
 * project switch) and host.cache (in-memory/sync scratch that survives unmount —
 * a mount counter + the last-seen project list). See bundled-extensions/hello/
 * renderer.js for the matching runnable artifact.
 *
 * SDK-2 dogfood: activate() returns the richer { panel, commands, navBadge }
 * ActivateResult — so this runtime-loaded bundle contributes a palette command
 * and a sidebar nav badge, not just a panel. Keep this in sync with the runnable
 * artifact at bundled-extensions/hello/renderer.js.
 */
import type { RendererEntry, ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    function HelloPanel(_props: { host: ModuleHost }) {
      // Seed from cache so a remount paints the previously-seen list at once,
      // then fall back to a fresh read. Cache is synchronous — no await.
      const [projects, setProjects] = React.useState(
        () => host.cache.get<ReturnType<ModuleHost['listProjects']>>('projects') ?? host.listProjects()
      );

      // Count mounts across the panel's lifetime. Lives in host.cache, so it
      // survives unmount (React state would reset on every nav switch).
      const mounts = (host.cache.get<number>('mounts') ?? 0) + 1;
      React.useEffect(() => {
        host.cache.set('mounts', mounts);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // Re-render the list live on project switches. `on` returns an unsubscribe
      // fn; returning it from the effect tears the subscription down on unmount.
      React.useEffect(() => {
        const off = host.on('project:changed', () => {
          const next = host.listProjects();
          host.cache.set('projects', next);
          setProjects(next);
        });
        return off;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const active = host.getActiveProject();

      return React.createElement(
        'div',
        { style: { padding: 16, fontFamily: 'system-ui, sans-serif' } },
        React.createElement('h2', { style: { marginTop: 0 } }, 'Hello from an extension'),
        React.createElement(
          'p',
          null,
          `Loaded ${projects.length} project${projects.length === 1 ? '' : 's'}${
            active ? ` · active: ${active.name}` : ''
          }:`
        ),
        React.createElement(
          'ul',
          null,
          projects.map((p) =>
            React.createElement('li', { key: p.id }, `${p.name} — ${p.path}`)
          )
        ),
        React.createElement(
          'p',
          { style: { fontSize: 12, opacity: 0.7 } },
          `Panel mounted ${mounts} time${mounts === 1 ? '' : 's'} this session (via host.cache).`
        ),
        React.createElement(
          'button',
          { onClick: () => host.toast('hello from extension') },
          'Say hello'
        )
      );
    }

    return {
      panel: HelloPanel,
      // A palette command (⌘K), namespaced by core as ext:hello:ping.
      commands: (h: ModuleHost) => [
        {
          id: 'ping',
          label: 'Hello: ping',
          keywords: ['pong', 'greet'],
          run: () => h.toast('pong from hello')
        }
      ],
      // Sidebar nav badge: the number of open projects. Cheap + synchronous.
      navBadge: (h: ModuleHost) => h.listProjects().length
    };
  },
};

export default entry;
