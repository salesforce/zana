/**
 * Resolves where clicking a notification (a native OS alert, or a row in
 * {@link NotificationsDrawer}) should land — the single place both surfaces
 * call so they stay in lockstep.
 *
 * Default behavior lands on the SPECIFIC entry in the full Inbox (not the
 * generic overview): select the entry's project, switch nav to `'inbox'`, and
 * select the entry in {@link useInboxSelection} so `InboxDetail` renders it.
 *
 * An extension-pushed entry may instead carry {@link InboxEntry.target} — see
 * its doc comment for the trust chain (host-authenticated at push time,
 * self-only). This module re-validates it AGAIN at click time against the
 * LIVE merged module registry (Rule 1: never trust a persisted redirect
 * blindly — the module may have been disabled/uninstalled since the entry was
 * pushed) and falls back to the default Inbox landing when the target no
 * longer resolves to a renderable surface.
 */

import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { useUi, useInboxRead, useInboxSelection } from '../store.js';
import { getMergedModule } from '../modules/index.js';

/** Land on the default Inbox detail view for `entry`, marking it read. */
function focusInboxEntryDefault(entry: InboxEntry): void {
  const ui = useUi.getState();
  ui.selectProject(entry.projectId);
  ui.setNav('inbox');
  useInboxSelection.getState().select(entry.id);
  useInboxRead.getState().markRead(entry.id);
}

/**
 * Resolve and apply the click destination for a notification tied to `entry`.
 * Always marks the entry read. Safe to call for any entry, targeted or not.
 */
export function focusInboxEntry(entry: InboxEntry): void {
  const targetModuleId = entry.target?.moduleId;
  if (!targetModuleId) {
    focusInboxEntryDefault(entry);
    return;
  }
  const mod = getMergedModule(targetModuleId);
  if (!mod || !mod.panel) {
    // Module gone, disabled, or panel-less by the time the click happened —
    // degrade to the entry's own Inbox landing rather than a dead nav.
    focusInboxEntryDefault(entry);
    return;
  }
  const ui = useUi.getState();
  if (mod.projectTab) {
    // Per-project surface: the Workspace only renders while `nav === 'projects'`
    // (mirrors `revealLibraryDoc`'s ordering — set nav BEFORE entering focus, and
    // enter focus BEFORE setting the mode, so the mode isn't reset by focus's own
    // default-to-agents behavior).
    ui.setNav('projects');
    ui.enterProjectFocus(entry.projectId);
    ui.setProjectView(entry.projectId, mod.id);
  } else {
    // Cross-project sidebar surface: just switch nav, still scoping the
    // selected project for context.
    ui.selectProject(entry.projectId);
    ui.setNav(mod.id);
  }
  useInboxRead.getState().markRead(entry.id);
}
