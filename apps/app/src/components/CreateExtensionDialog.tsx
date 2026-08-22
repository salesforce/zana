import { product } from '../lib/product-client.js';
/**
 * "Create your own extension" dialog — the entry point for authoring a LOCAL
 * extension in-app. The user gives a name (+ optional description); on submit we:
 *   1. ask main to createLocal — mint a unique id, scaffold a starter template
 *      into a scratch working dir, pack + install it (through the same trust
 *      gates + consent as any install), and record it as `local`;
 *   2. open the Extension Creator agent (persona `builtin:ext-creator`) as a
 *      Claude terminal whose cwd is the extension's working dir, so it can edit
 *      the source with the user;
 *   3. redirect into that agent's terminal.
 *
 * Main mints the id and derives every path (Rule 1) — the renderer supplies only
 * display intent. We preview the *shape* of the minted id (a slug + suffix) so
 * the user knows a unique apiName will be assigned, but the authoritative id
 * comes back from `createLocal`.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Puzzle, Wand2 } from 'lucide-react';
import { useData, useUi } from '../store.js';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap.js';

interface Props {
  onClose: () => void;
}

type ExtKind = 'panel' | 'main-panel' | 'mcp-consumer' | 'agent-preset';

/** The kind picker options, along the trust ladder. */
const KINDS: Array<{ id: ExtKind; label: string; hint: string }> = [
  { id: 'panel', label: 'Panel', hint: 'Renderer-only UI. No permissions.' },
  {
    id: 'main-panel',
    label: 'Panel + backend',
    hint: 'Runs a tool (git). Requests exec — you’ll approve it.'
  },
  {
    id: 'mcp-consumer',
    label: 'MCP consumer',
    hint: 'Talks to an integration server. Requests mcp — you’ll approve it.'
  },
  {
    id: 'agent-preset',
    label: 'Agent preset',
    hint: 'A reusable Quick Agent preset. No permissions.'
  }
];

/** Preview the id STEM main will mint from (slug only; main appends a suffix). */
function previewSlug(name: string): string {
  const base = (name || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return base && /^[a-z0-9]/.test(base) ? base : 'ext';
}

export function CreateExtensionDialog({ onClose }: Props) {
  const createTerminal = useData((s) => s.createTerminal);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ExtKind>('panel');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useDialogFocusTrap(dialogRef, onClose);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const canSubmit = !!trimmed && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await product.extensions.createLocal({
        name: trimmed,
        description: description.trim() || undefined,
        kind
      });
      if (!res.ok) {
        setError(res.message ?? 'Could not create the extension');
        setBusy(false);
        return;
      }
      const { workingDir, projectId } = res.value;
      // Launch the Extension Creator agent in the extension's working dir. The
      // cwd is under the scratch project root, so main's confinement accepts it;
      // the persona bounds the agent to an editor role.
      const session = await createTerminal(projectId, 'claude', 80, 24, {
        cwd: workingDir,
        personaId: 'builtin:ext-creator',
        title: `Build: ${trimmed}`
      });
      if (session) {
        const ui = useUi.getState();
        ui.enterProjectFocus(projectId);
        ui.selectTab(projectId, session.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="palette-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="palette launch-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create a new extension"
      >
        <div className="launch-panel">
          <div className="launch-header">
            <h3>
              <Puzzle size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Create an extension
            </h3>
            <p>
              Build your own extension in the app. We’ll scaffold a starter panel and open an
              AI agent to build it with you — no publishing required.
            </p>
          </div>

          <div className="launch-row">
            <span className="launch-row-label">Name</span>
            <input
              ref={nameRef}
              className="ext-create-input"
              style={{ flex: 1 }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) submit();
              }}
              placeholder="My Tool"
              maxLength={60}
              disabled={busy}
            />
          </div>

          <div className="launch-row">
            <span className="launch-row-label">About</span>
            <input
              className="ext-create-input"
              style={{ flex: 1 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) submit();
              }}
              placeholder="What does it do? (optional)"
              maxLength={140}
              disabled={busy}
            />
          </div>

          <div className="launch-row" style={{ alignItems: 'flex-start' }}>
            <span className="launch-row-label">Kind</span>
            <div className="ext-kind-picker">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className={`ext-kind-option ${kind === k.id ? 'active' : ''}`}
                  onClick={() => setKind(k.id)}
                  disabled={busy}
                  aria-pressed={kind === k.id}
                >
                  <span className="ext-kind-option-label">{k.label}</span>
                  <span className="ext-kind-option-hint">{k.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {trimmed && (
            <p className="settings-help settings-help--muted" style={{ marginTop: 4 }}>
              A unique id will be assigned, like{' '}
              <code className="ext-id-preview">{previewSlug(trimmed)}-xxxx</code>.
            </p>
          )}

          {error && <div className="launch-error" role="alert">{error}</div>}

          <div className="launch-actions">
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" onClick={submit} disabled={!canSubmit}>
              <Wand2 size={14} />
              {busy ? 'Creating…' : 'Create & build'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
