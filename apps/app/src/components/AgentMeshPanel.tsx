import { useMemo, useState } from 'react';
import { Network, MessageSquare, ArrowRight, ChevronDown } from 'lucide-react';
import type { AgentMessage, AgentState } from '@zana-ai/zcc-domain/product';
import { useAgentMesh, useAgentStatus, useData } from '../store.js';
import { getScopedProjectId } from '../lib/windowScope.js';

/**
 * Shorten a peer label for display. Auto-seeded agents that never called
 * `register_agent` carry their cwd (or a tmp scratch path) as the handle, which
 * renders as an unreadable `@/var/folders/…/T/…` blob. Collapse any path-shaped
 * label to its last segment, and hard-cap the rest so a long tab title can't
 * blow out the row. The full value is preserved in the row's title attribute.
 */
function prettyHandle(label: string): string {
  let out = label;
  if (out.includes('/')) {
    const segments = out.split('/').filter(Boolean);
    out = segments[segments.length - 1] ?? out;
  }
  return out.length > 28 ? `${out.slice(0, 27)}…` : out;
}

/** Compact relative time ("just now", "5m", "2h", else a date). */
function relativeTime(ts: number, now: number): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return new Date(ts).toLocaleDateString();
}

interface AgentMeshPanelProps {
  /** When set, filter the mesh to this project (overrides window scope). The
   *  per-project board passes this since it runs in the main window. */
  projectId?: string;
  /** Render as a full standalone view (the List toggle) rather than the
   *  self-hiding bottom strip: fills the area and shows section empty states
   *  instead of returning null. */
  fullView?: boolean;
}

/**
 * Read-only view of the inter-agent mesh (Phase 0/1), surfaced under the global
 * Agents board:
 *
 *  - **Registered agents** — the discovery registry (`agent_registry`): every
 *    claude session's handle / role / capabilities, with its live status fused
 *    in from `useAgentStatus` (the registry store deliberately doesn't hold a
 *    stale status). This is what one agent sees when it calls `list_agents`.
 *  - **Recent messages** — the agent↔agent audit history (`AgentMessageLog`),
 *    SEPARATE from the user inbox. Each row shows from → to and the body, so the
 *    user can audit cross-agent traffic that, by design, never lands in the
 *    inbox.
 *
 * Purely presentational + reactive to the two stores; never mutates the mesh.
 * Renders nothing when the mesh is empty (no registered agents and no messages)
 * so it stays out of the way until the feature is in use.
 */
export function AgentMeshPanel({ projectId, fullView = false }: AgentMeshPanelProps = {}) {
  const allAgents = useAgentMesh((s) => s.agents);
  const allMessages = useAgentMesh((s) => s.messages);
  const statusById = useAgentStatus((s) => s.byId);
  const projects = useData((s) => s.projects);

  // In a per-project window the mesh shows only this project's agents/traffic;
  // both carry a projectId. The main window (scoped null) sees the full mesh.
  const effectiveProjectId = projectId ?? getScopedProjectId();
  const agents = useMemo(
    () => (effectiveProjectId ? allAgents.filter((a) => a.projectId === effectiveProjectId) : allAgents),
    [allAgents, effectiveProjectId]
  );
  const messages = useMemo(
    () =>
      effectiveProjectId ? allMessages.filter((m) => m.projectId === effectiveProjectId) : allMessages,
    [allMessages, effectiveProjectId]
  );

  const projectName = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [projects]);

  // Newest first, capped — this is an at-a-glance audit strip, not a full log.
  const recent = useMemo(() => messages.slice(0, 30), [messages]);
  // One timestamp per render keeps every row's relative time consistent.
  const now = Date.now();

  if (!fullView && agents.length === 0 && messages.length === 0) return null;

  return (
    <div className={`agent-mesh ${fullView ? 'agent-mesh--full' : ''}`}>
      <section className="agent-mesh-section">
        <header className="agent-mesh-head">
          <Network size={13} aria-hidden="true" />
          <span className="agent-mesh-title">Registered agents</span>
          <span className="agent-mesh-count">{agents.length}</span>
        </header>
        {agents.length === 0 ? (
          <p className="agent-mesh-empty">No agents have registered yet.</p>
        ) : (
          <ul className="agent-mesh-list">
            {agents.map((a) => {
              const state: AgentState = statusById[a.sessionId] ?? 'unknown';
              return (
                <li key={a.sessionId} className="agent-mesh-agent">
                  <span className={`tab-agent-dot agent-${state}`} aria-hidden="true" />
                  <span className="agent-mesh-handle" title={`@${a.handle ?? a.displayName ?? a.sessionId}`}>
                    @{prettyHandle(a.handle ?? a.displayName ?? a.sessionId)}
                  </span>
                  {/* Show the live tab title alongside a registered handle so the
                      authoritative name and the drifting display name are both
                      visible (and never conflated). Omitted when the agent hasn't
                      registered — the handle slot already shows the displayName. */}
                  {a.handle && a.displayName && a.displayName !== a.handle && (
                    <span className="agent-mesh-display">{a.displayName}</span>
                  )}
                  {a.role && <span className="agent-mesh-role">{a.role}</span>}
                  <span className="grow" />
                  {(a.capabilities ?? []).map((cap) => (
                    <span key={cap} className="agent-mesh-cap">
                      {cap}
                    </span>
                  ))}
                  <span className="agent-mesh-project">{projectName(a.projectId)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="agent-mesh-section">
        <header className="agent-mesh-head">
          <MessageSquare size={13} aria-hidden="true" />
          <span className="agent-mesh-title">Agent messages</span>
          <span className="agent-mesh-count">{messages.length}</span>
        </header>
        {recent.length === 0 ? (
          <p className="agent-mesh-empty">No agent-to-agent messages yet.</p>
        ) : (
          <ul className="agent-mesh-list">
            {recent.map((m) => (
              <MeshMessageRow key={m.id} message={m} now={now} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One row in the agent-message audit strip. Collapsed by default to a single
 * preview line so a dozen messages stay scannable; click (or Enter/Space) to
 * expand the full body inline. Self-contained expand state — the strip is a
 * read-only audit view, so each row owns its own open/closed flag.
 */
function MeshMessageRow({ message: m, now }: { message: AgentMessage; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);

  return (
    <li className={`agent-mesh-msg ${expanded ? 'is-expanded' : ''}`}>
      <div
        className="agent-mesh-msg-head"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={expanded}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
      >
        <ChevronDown size={12} className="agent-mesh-chevron" aria-hidden="true" />
        <span className="agent-mesh-route">
          <span className="agent-mesh-handle" title={`@${m.fromHandle}`}>
            @{prettyHandle(m.fromHandle)}
          </span>
          <ArrowRight size={11} aria-hidden="true" />
          <span className="agent-mesh-handle" title={`@${m.toHandle}`}>
            @{prettyHandle(m.toHandle)}
          </span>
        </span>
        {/* Collapsed: the body preview shares the header line so each message is
            one scannable row. Hidden once expanded (the full body shows below). */}
        {!expanded && <span className="agent-mesh-preview">{m.body}</span>}
        {/* State + time hug the right edge in both states (margin-left:auto), so
            the badges don't bunch up against the route when expanded. */}
        <span className="agent-mesh-msg-meta">
          {m.deliveredAt === undefined ? (
            <span
              className="agent-mesh-badge agent-mesh-badge--queued"
              title="Queued — the recipient hasn't read it yet"
            >
              queued
            </span>
          ) : (
            <span
              className="agent-mesh-badge agent-mesh-badge--delivered"
              title={`Delivered ${new Date(m.deliveredAt).toLocaleString()}`}
            >
              read
            </span>
          )}
          <time className="agent-mesh-time" title={new Date(m.ts).toLocaleString()}>
            {relativeTime(m.ts, now)}
          </time>
        </span>
      </div>
      {expanded && <p className="agent-mesh-body">{m.body}</p>}
    </li>
  );
}
