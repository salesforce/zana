import { lazy, Suspense } from 'react';
import { DelayedStencilList } from '../../components/ui/Skeleton.js';

const SettingsView = lazy(() => import('./SettingsView.js').then(module => ({ default: module.SettingsView })));

/** Keep optional settings pages outside the shell's initial import graph. */
export function LazySettingsView() {
  return (
    <Suspense fallback={
      <section className="settings-panel" aria-label="Settings" aria-busy="true">
        <div className="settings-inner"><DelayedStencilList label="Loading settings" /></div>
      </section>
    }>
      <SettingsView />
    </Suspense>
  );
}
