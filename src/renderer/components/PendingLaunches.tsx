import { useUi } from '../store';

/**
 * W1-4 trust inversion — the human confirm surface for session launches a MAIN
 * extension module requested via `ctx.host.requestLaunch`. Main NEVER spawns
 * directly (Rule 1): it parks the request, and the human approves it here, which
 * drives the extension's own CONFINED `launchSession` path (re-gates
 * session:launch, sanitizes flags, re-checks the project). Dismiss drops it.
 *
 * A parked launch is durable — it survives a shell that wasn't listening (drained
 * from main on mount) — so this surface is the only path an extension-requested
 * launch reaches a pty, and it always crosses a human.
 */
export function PendingLaunches() {
  const pending = useUi((s) => s.pendingLaunches);
  const approve = useUi((s) => s.approvePendingLaunch);
  const dismiss = useUi((s) => s.dismissPendingLaunch);

  if (pending.length === 0) return null;

  return (
    <div className="pending-launches" role="region" aria-label="Pending launch requests">
      {pending.map((p) => (
        <div key={p.requestId} className="pending-launch">
          <div className="pending-launch-body">
            <div className="pending-launch-title">
              {p.spec.label ?? p.spec.title ?? 'Launch requested'}
            </div>
            <div className="pending-launch-meta">
              <span className="pending-launch-ext">{p.moduleId}</span>
              {p.spec.personaId && <span className="pending-launch-persona">{p.spec.personaId}</span>}
            </div>
          </div>
          <div className="pending-launch-actions">
            <button
              type="button"
              className="pending-launch-approve"
              onClick={() => void approve(p.requestId)}
            >
              Launch
            </button>
            <button
              type="button"
              className="pending-launch-dismiss"
              onClick={() => dismiss(p.requestId)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
