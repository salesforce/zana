/**
 * ProfilesView — the agent-profiles gallery for the Tickets view's Profiles
 * sub-tab (C5). A count summary (total · built-in · workspace) above a gallery
 * of profile cards, grouped by category with section headers. The backend
 * returns ALL profiles (workspace + built-in) already sorted, so we keep that
 * order and just bucket by category for the headers. Clicking (or Enter/Space
 * on) a card opens the profile detail. Read-only.
 *
 * Profiles are deliberately GLOBAL (`~/.zana/profiles` + Zana's built-ins,
 * resolved by `listProfiles` with NO project arg). They are the single
 * legitimately-global surface inside the otherwise strictly per-project Tickets
 * view; the assigned-count badge, by contrast, is scoped to the CURRENT
 * project's tickets — so it reads "N assigned in THIS project."
 *
 * Pure presentational: data arrives via props from the B3 `useTickets` store
 * (the global `profiles` slice + this project's `tickets`). This component calls
 * NO `ticketsApi`, fires NO `useEffect` fetch, and holds NO local profiles
 * `useState` — the store owns the single fetch (Rule 5 / IPC-storm guard).
 *
 * Rule 6: imports core shared types ONLY — no `getHost`, no `window.cc.modules`,
 *   no `'zana'` module-id literal. (The `zana-profile-*` CSS class names and the
 *   `~/.zana/profiles/` empty-state path string contain the substring `zana`
 *   legitimately — they are styling / user-facing copy, not a module-id in logic.)
 *
 * Ported verbatim from `plugins/zana/renderer/ZanaPanel.tsx` (ProfilesView +
 * ProfileCard) into CORE; the live source rail / global-source toggle is NOT
 * carried over (the product decision drops the per-project Global rail).
 */

import { useMemo, type KeyboardEvent } from 'react';
import type { ZanaProfile, ZanaTicket } from '@shared/zana-types';

/**
 * Card-activation keyboard handler: Enter/Space activate (and suppress the
 * default scroll/submit), every other key is ignored. Exported so the card's
 * keyboard behaviour is unit-testable without a DOM harness (this repo ships
 * none); the card's `onClick` is the trivial direct call to `onOpen`.
 */
export function activateOnKey(
  e: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  onActivate: () => void
): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onActivate();
  }
}

export function ProfilesView({
  profiles,
  tickets,
  onOpen
}: {
  profiles: ZanaProfile[];
  /** The OPEN PROJECT's tickets — used ONLY for the per-card assigned-count badge. */
  tickets: ZanaTicket[];
  onOpen: (profile: ZanaProfile) => void;
}) {
  // How many of THIS project's tickets each profile is assigned, for a card badge.
  const assignedByProfile = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tickets) {
      if (t.assigneeProfileId) m.set(t.assigneeProfileId, (m.get(t.assigneeProfileId) ?? 0) + 1);
    }
    return m;
  }, [tickets]);

  const builtinCount = profiles.filter((p) => p.origin === 'builtin').length;
  const workspaceCount = profiles.filter((p) => p.origin === 'workspace').length;

  // Group into category buckets, preserving the backend's sort order both for
  // the categories (first-seen order) and the profiles within each.
  const groups = useMemo(() => {
    const map = new Map<string, ZanaProfile[]>();
    for (const p of profiles) {
      const key = p.category && p.category.trim() ? p.category : 'Uncategorized';
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    return [...map.entries()];
  }, [profiles]);

  if (profiles.length === 0) {
    return (
      <div className="zana-profiles-view">
        <div className="gus-column-empty">
          No profiles found. Profiles live in <code>~/.zana/profiles/</code> plus Zana's built-ins.
        </div>
      </div>
    );
  }

  return (
    <div className="zana-profiles-view">
      <div className="zana-profiles-summary">
        <strong>{profiles.length}</strong> {profiles.length === 1 ? 'profile' : 'profiles'}
        {builtinCount > 0 && (
          <>
            {' · '}
            {builtinCount} built-in
          </>
        )}
        {workspaceCount > 0 && (
          <>
            {' · '}
            <span className="zana-profiles-summary-ws">{workspaceCount} workspace</span>
          </>
        )}
      </div>

      {groups.map(([category, items]) => (
        <section key={category} className="zana-profile-group">
          {groups.length > 1 && (
            <div className="zana-profile-group-head">
              <span className="zana-profile-group-title">{category}</span>
              <span className="zana-profile-group-count">{items.length}</span>
            </div>
          )}
          <div className="zana-profile-grid">
            {items.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                assignedCount={assignedByProfile.get(p.id) ?? 0}
                onOpen={() => onOpen(p)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One profile card in the gallery: icon, name, category chip, origin badge, clamped description. */
function ProfileCard({
  profile,
  assignedCount,
  onOpen
}: {
  profile: ZanaProfile;
  assignedCount: number;
  onOpen: () => void;
}) {
  const isWorkspace = profile.origin === 'workspace';
  return (
    <article
      className="zana-profile-card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => activateOnKey(e, onOpen)}
      title={`${profile.displayName} — click for details`}
    >
      <div className="zana-profile-card-top">
        <span className="zana-profile-card-icon" aria-hidden>
          {profile.icon ?? '🤖'}
        </span>
        <div className="zana-profile-card-id">
          <h3 className="zana-profile-card-name">{profile.displayName}</h3>
          {profile.category && <span className="zana-profile-cat">{profile.category}</span>}
        </div>
        <span
          className={`zana-profile-origin zana-profile-origin--${profile.origin}`}
          title={isWorkspace ? 'Workspace profile' : 'Zana built-in profile'}
        >
          {isWorkspace ? 'Workspace' : 'Built-in'}
        </span>
      </div>
      {profile.description && <p className="zana-profile-card-desc">{profile.description}</p>}
      <div className="zana-profile-card-meta">
        {profile.model && <span className="zana-label-chip">{profile.model}</span>}
        {assignedCount > 0 && (
          <span className="gus-chip" title="Tickets assigned to this profile">
            {assignedCount} assigned
          </span>
        )}
      </div>
    </article>
  );
}
