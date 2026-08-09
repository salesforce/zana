import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi, type HostDialog } from '../store';
import { Modal } from './Modal';

/**
 * W1-5 host UX primitives — the host-rendered surface for the dialogs an
 * extension requests via `host.confirm/quickPick/prompt/alert/withProgress`
 * (renderer) or a MAIN module requests via `ctx.host.confirm/alert` (delivered
 * over the `hostCommand` channel). Every dialog is queued in `useUi.hostDialogs`
 * with a renderer-only `resolve`; this component draws the FIRST queued entry on
 * the shared {@link Modal} primitive (theme + focus-trap + Escape + aria — NO
 * CSS injection by the extension) and calls `settleHostDialog(id, answer)` with
 * the user's choice, which drops it and reveals the next.
 *
 * Dismiss (Escape / backdrop / ✕ / Cancel) resolves the "no answer" value —
 * `false` for confirm, `null` for prompt/quickPick/alert — never rejects. The
 * `progress` affordance has no dismiss; it's torn down by its owning task via
 * `settleHostDialog` when the task settles (Cancel just fires its AbortSignal).
 */
export function HostDialogs() {
  const dialogs = useUi((s) => s.hostDialogs);
  const dialog = dialogs[0];
  if (!dialog) return null;
  // Key on id so switching between queued dialogs remounts local input state.
  return <HostDialogView key={dialog.id} dialog={dialog} />;
}

function HostDialogView({ dialog }: { dialog: HostDialog }) {
  const settle = useUi((s) => s.settleHostDialog);

  switch (dialog.kind) {
    case 'confirm':
      return (
        <Modal
          title={dialog.opts.title}
          className="host-dialog"
          closeOnBackdrop={!dialog.opts.danger}
          onClose={() => settle(dialog.id, false)}
          footer={
            <>
              <button className="btn" onClick={() => settle(dialog.id, false)}>
                {dialog.opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={dialog.opts.danger ? 'btn danger' : 'btn primary'}
                onClick={() => settle(dialog.id, true)}
              >
                {dialog.opts.confirmLabel ?? 'OK'}
              </button>
            </>
          }
        >
          {dialog.opts.body && <div className="host-dialog-body">{dialog.opts.body}</div>}
        </Modal>
      );

    case 'prompt':
      return <PromptDialog dialog={dialog} settle={settle} />;

    case 'quickPick':
      return <QuickPickDialog dialog={dialog} settle={settle} />;

    case 'alert':
      return (
        <Modal
          title={dialog.opts.title}
          className={`host-dialog host-alert${dialog.opts.kind === 'error' ? ' host-alert-error' : ''}`}
          onClose={() => settle(dialog.id, null)}
          footer={
            (dialog.opts.actions?.length ?? 0) > 0 ? (
              <>
                {dialog.opts.actions!.map((a, i) => (
                  <button
                    key={a.id}
                    className={i === dialog.opts.actions!.length - 1 ? 'btn primary' : 'btn'}
                    onClick={() => settle(dialog.id, a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </>
            ) : (
              <button className="btn primary" onClick={() => settle(dialog.id, null)}>
                Dismiss
              </button>
            )
          }
        >
          {dialog.opts.body && <div className="host-dialog-body">{dialog.opts.body}</div>}
        </Modal>
      );

    case 'progress':
      return (
        <Modal
          title={dialog.opts.title}
          className="host-dialog host-progress"
          hideClose
          closeOnBackdrop={false}
          // Progress can't be dismissed by the user — only its owning task drops
          // it. onClose is required by Modal; make it a no-op (Escape won't kill
          // the task). Cancel (if offered) fires the AbortSignal.
          onClose={() => {}}
          footer={
            dialog.opts.cancellable ? (
              <button className="btn" onClick={() => dialog.abort()}>
                Cancel
              </button>
            ) : undefined
          }
        >
          <div className="host-progress-body">
            <span className="host-progress-spinner" aria-hidden />
            <span>Working…</span>
          </div>
        </Modal>
      );
  }
}

function PromptDialog({
  dialog,
  settle
}: {
  dialog: Extract<HostDialog, { kind: 'prompt' }>;
  settle: (id: string, answer: unknown) => void;
}) {
  const [value, setValue] = useState(dialog.opts.initialValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    settle(dialog.id, trimmed);
  };

  return (
    <Modal
      title={dialog.opts.title}
      className="host-dialog prompt-modal"
      onClose={() => settle(dialog.id, null)}
      footer={
        <>
          <button className="btn" onClick={() => settle(dialog.id, null)}>
            Cancel
          </button>
          <button className="btn primary" disabled={!value.trim()} onClick={submit}>
            {dialog.opts.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      {dialog.opts.hint && <div className="modal-hint">{dialog.opts.hint}</div>}
      <label className="prompt-modal-field">
        {dialog.opts.label && <span>{dialog.opts.label}</span>}
        <input
          ref={inputRef}
          value={value}
          placeholder={dialog.opts.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Modal>
  );
}

function QuickPickDialog({
  dialog,
  settle
}: {
  dialog: Extract<HostDialog, { kind: 'quickPick' }>;
  settle: (id: string, answer: unknown) => void;
}) {
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return dialog.items;
    return dialog.items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.description ? it.description.toLowerCase().includes(q) : false)
    );
  }, [filter, dialog.items]);

  return (
    <Modal
      title={dialog.opts.title ?? 'Select'}
      className="host-dialog host-quickpick"
      onClose={() => settle(dialog.id, null)}
      footer={
        <button className="btn" onClick={() => settle(dialog.id, null)}>
          Cancel
        </button>
      }
    >
      <input
        ref={inputRef}
        className="host-quickpick-filter"
        value={filter}
        placeholder={dialog.opts.placeholder ?? 'Type to filter…'}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && filtered.length > 0) {
            e.preventDefault();
            settle(dialog.id, filtered[0].index);
          }
        }}
      />
      <ul className="host-quickpick-list" role="listbox">
        {filtered.length === 0 && <li className="host-quickpick-empty">No matches</li>}
        {filtered.map((it) => (
          <li key={it.index} role="option" aria-selected={false}>
            <button className="host-quickpick-item" onClick={() => settle(dialog.id, it.index)}>
              <span className="host-quickpick-label">{it.label}</span>
              {it.description && (
                <span className="host-quickpick-desc">{it.description}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
