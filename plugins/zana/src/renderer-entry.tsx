/**
 * Renderer entry for the zana DISK extension.
 *
 * Default-exports a {@link RendererEntry}. The host loader blob-imports this
 * bundle and calls `activate({ React, host })`; we MUST prime two in-bundle
 * holders BEFORE returning anything:
 *   - `setHostReact(React)` — so the react / jsx-runtime shims resolve against
 *     the host's single React instance (shared-hooks requirement, see
 *     ./host-react);
 *   - `primeModuleHost(host)` — the SDK's W1-7 accessor, so the module-singleton
 *     `useTickets` store and its `ticketsApi` data seam can reach main
 *     capabilities OUTSIDE the React tree (they can't take `host` as a prop).
 *     This replaced the per-extension `host-holder.ts` hack.
 *
 * We then return an {@link ActivateResult} exposing the per-project Tickets
 * `panel` (mounted with `{ host }`) and the `@zana-ai/mcp` version `settingsPanel`
 * — the same two surfaces the old core view + `zana-tickets` extension shipped.
 *
 * `react` / `react/jsx-runtime` are aliased to in-bundle shims at build time;
 * `lucide-react` and the rest of the renderer tree are BUNDLED. The bundle
 * externalizes nothing — it is fully self-contained.
 */
import type { RendererEntry, ActivateResult } from '@zana-ai/zcc-extension-sdk/renderer';
import { primeModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import { setHostReact } from './host-react.js';
import ProjectTicketsView from './renderer/ProjectTicketsView.js';
import VersionSettings from './renderer/VersionSettings.js';

const entry: RendererEntry = {
  activate({ React, host }): ActivateResult {
    // Both MUST run before any panel renders: React primes the shims;
    // primeModuleHost primes the store/ticketsApi bridge outside the React tree.
    setHostReact(React);
    primeModuleHost(host);

    return {
      panel: ProjectTicketsView,
      settingsPanel: VersionSettings
    };
  }
};

export default entry;
