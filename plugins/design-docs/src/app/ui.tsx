import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  Bot,
  CheckCheck,
  FileCode,
  FileImage,
  FileText,
  ListChecks,
  Loader2,
  MessageSquareText,
  ScanSearch,
  Sparkles,
  User,
  WandSparkles,
  Workflow,
  X,
  type LucideProps
} from 'lucide-react';
import { STATUS_LABELS, type DocActor, type DocStatus } from '../shared/contract.js';
import { relativeTime } from '../shared/display.js';
import type { FileKind } from '../shared/paths.js';

export type Icon = ComponentType<LucideProps>;

const ACTION_ICONS: Record<string, Icon> = {
  MessageSquareText,
  CheckCheck,
  WandSparkles,
  Workflow,
  ScanSearch,
  ListChecks
};

export function actionIcon(name: string): Icon {
  return ACTION_ICONS[name] ?? Sparkles;
}

export function FileIcon({ kind, size = 14 }: { kind: FileKind; size?: number }) {
  const Glyph = kind === 'image' || kind === 'svg' ? FileImage : kind === 'markdown' || kind === 'text' ? FileText : FileCode;
  return <Glyph size={size} className={`dd-file-icon dd-kind-${kind}`} aria-hidden />;
}

export function StatusPill({ status, compact = false }: { status: DocStatus; compact?: boolean }) {
  return (
    <span className={`dd-status dd-status-${status}${compact ? ' dd-status-compact' : ''}`}>
      <span className="dd-status-dot" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ActorLabel({ actor }: { actor: DocActor }) {
  const Glyph = actor.kind === 'agent' ? Bot : User;
  return (
    <span className={`dd-actor dd-actor-${actor.kind}`} title={actor.kind === 'agent' ? `Agent · ${actor.label}` : actor.label}>
      <Glyph size={12} aria-hidden />
      <span className="dd-actor-label">{actor.label}</span>
    </span>
  );
}

export function TimeAgo({ at, now }: { at: number; now: number }) {
  return (
    <time className="dd-time" dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
      {relativeTime(at, now)}
    </time>
  );
}

export function Spinner({ size = 14, label }: { size?: number; label?: string }) {
  return (
    <span className="dd-spinner" role="status" aria-label={label ?? 'Loading'}>
      <Loader2 size={size} className="dd-spin" aria-hidden />
    </span>
  );
}

export function EmptyState({ icon: Glyph, title, children }: { icon: Icon; title: string; children?: ReactNode }) {
  return (
    <div className="dd-empty">
      <span className="dd-empty-icon">
        <Glyph size={22} aria-hidden />
      </span>
      <div className="dd-empty-title">{title}</div>
      {children ? <div className="dd-empty-body">{children}</div> : null}
    </div>
  );
}

export function IconButton({
  icon: Glyph,
  label,
  onClick,
  active = false,
  danger = false,
  disabled = false,
  size = 14
}: {
  icon: Icon;
  label: string;
  onClick(): void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={`icon-btn dd-icon-btn${active ? ' on' : ''}${danger ? ' danger' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Glyph size={size} aria-hidden />
    </button>
  );
}

/** Close on outside pointer-down or Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: Event) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return ref;
}

/** A button-anchored popover; the anchor and the panel share one dismiss boundary. */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = 'end',
  className = ''
}: {
  open: boolean;
  onClose(): void;
  anchor: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const ref = useDismiss(open, onClose);
  return (
    <div className="dd-pop-anchor" ref={ref}>
      {anchor}
      {open ? (
        <div className={`dd-pop dd-pop-${align} ${className}`} role="dialog">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  icon: Glyph,
  label,
  hint,
  onSelect,
  danger = false,
  checked = false
}: {
  icon?: Icon;
  label: ReactNode;
  hint?: string;
  onSelect(): void;
  danger?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`dd-menu-item${danger ? ' dd-menu-danger' : ''}${checked ? ' dd-menu-checked' : ''}`}
      onClick={onSelect}
    >
      {Glyph ? <Glyph size={14} aria-hidden /> : null}
      <span className="dd-menu-label">{label}</span>
      {hint ? <span className="dd-menu-hint">{hint}</span> : null}
    </button>
  );
}

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  run(): void | Promise<void>;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await request.run();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Dialog
      title={request.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn primary${request.danger ? ' dd-btn-danger' : ''}`}
            disabled={busy}
            onClick={() => void confirm()}
            autoFocus
          >
            {request.confirmLabel}
          </button>
        </>
      }
    >
      <div className="dd-confirm-body">{request.body}</div>
    </Dialog>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="dd-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`dd-dialog${wide ? ' dd-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dd-dialog-header">
          <span className="dd-dialog-title">{title}</span>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="dd-dialog-body">{children}</div>
        {footer ? <div className="dd-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
