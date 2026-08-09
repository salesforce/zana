/**
 * Mounts every merged module's headless `background` component (see
 * {@link AppModule.background}) ONCE, for the whole session, regardless of the
 * active nav. This is the always-on counterpart to {@link ModulePanelHost},
 * which mounts a module's `panel` only while its nav is selected and unmounts
 * it on nav change.
 *
 * Why this exists: a module whose work must keep running while the user looks
 * elsewhere (a Slack poll bridge, a long-lived subscription) cannot put that
 * work in its panel — the panel unmounts the moment the user navigates away,
 * tearing down its effects. Such work lives in `background`, mounted here and
 * never torn down by nav. Mirrors how `TerminalSurface` is mounted once in
 * `App.tsx` so xterm scrollback survives nav changes.
 *
 * Each background gets the SAME cached `ModuleHost` its panel would get
 * (`getHost`), so panel and background share one host instance + cache. Wrapped
 * per-module in an ErrorBoundary so one module's background throwing can't crash
 * the shell or the other backgrounds.
 */

import { useMergedModules } from './index';
import { getHost } from './ModulePanelHost';
import { ErrorBoundary } from '../components/ErrorBoundary';

export function ModuleBackgroundHost() {
  const modules = useMergedModules();
  return (
    <>
      {modules
        .filter((m) => m.background)
        .map((m) => {
          const Background = m.background!;
          return (
            <ErrorBoundary key={m.id}>
              <Background host={getHost(m.id)} />
            </ErrorBoundary>
          );
        })}
    </>
  );
}
