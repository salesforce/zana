import { product } from '../../lib/product-client.js';
import React, { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Play,
  Trash2,
  Copy,
  Square,
  ExternalLink,
  FileText,
  Power,
  PowerOff,
  Columns2
} from 'lucide-react';
import type { ScheduledTask, ScheduleGroup } from '@zana-ai/zcc-domain/product';
import { useData, useUi } from '../../store.js';
import { groupIcon, GROUP_FALLBACK_COLOR } from '../scheduleGroupMeta.js';
import {
  pickLiveRun,
  formatCountdown,
  PROFILE_LABEL
} from './schedulerUtils.js';
import { openScheduledLive } from './openScheduledLive.js';

interface ScheduleRowProps {
  task: ScheduledTask;
  projectName: string;
  group?: ScheduleGroup | null;
  onOpen: () => void;
  onOpenInSplit: () => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
}

export const ScheduleRow = React.memo(function ScheduleRow({
  task,
  projectName,
  group,
  onOpen,
  onOpenInSplit,
  onDuplicate,
  onAskDelete
}: ScheduleRowProps) {
  const isExternal = task.external?.kind === 'claude-loop';
  const nextRun = task.status.nextRunAt ? new Date(task.status.nextRunAt) : null;
  const terminals = useData((s) => s.terminals);
  const pushToast = useUi((s) => s.pushToast);

  const toggle = async () => {
    const result = await product.scheduler.setEnabled(task.id, !task.enabled);
    if (!result.ok) pushToast(result.message, 'error');
  };
  const runNow = async () => {
    const result = await product.scheduler.runNow(task.id);
    if (!result.ok) {
      pushToast(`Run failed: ${result.message}`, 'error');
      return;
    }
    pushToast(`Fired "${task.name}"`, 'info');
  };

  const projectTerminals = terminals[task.projectId] ?? [];
  const isSessionAlive = (sessionId: string) =>
    projectTerminals.some(
      (s) => s.id === sessionId && (s.status === 'running' || s.status === 'starting')
    );

  const runs = task.status.runs ?? [];
  const lastReportRun = runs.find((r) => !!r.report) ?? null;
  const liveRun = pickLiveRun(runs, isSessionAlive);
  const liveSessionId = liveRun?.sessionId ?? null;
  const isWorking = !!liveRun && !liveRun.finishedAt;
  const isFinishedOpen = !!liveRun && !!liveRun.finishedAt;

  const stopLive = async (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (!liveSessionId) return;
    try {
      if (!await product.terminals.close(liveSessionId)) {
        throw new Error('session remains live');
      }
      pushToast(`Stopped "${task.name}"`, 'info');
    } catch {
      pushToast(`Failed to stop "${task.name}"`, 'error');
    }
  };

  const openLive = (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (!liveSessionId) return;
    openScheduledLive(task.projectId, liveSessionId);
  };

  const statusKind = isWorking
    ? 'running'
    : isFinishedOpen
      ? 'done'
      : task.enabled
        ? 'idle'
        : 'off';
  const statusLabel = statusKind;
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  const [rowMenu, setRowMenu] = useState<{ x: number; y: number } | null>(null);
  const openRowMenu = (e: ReactMouseEvent) => {
    if (isExternal) return;
    e.preventDefault();
    e.stopPropagation();
    setRowMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <li className={`scheduler-card ${task.enabled ? '' : 'is-disabled'} ${isWorking ? 'is-running' : ''} ${isFinishedOpen ? 'is-done' : ''}`}>
      <div
        className="scheduler-card-main scheduler-card-main--compact"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onContextMenu={openRowMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        title="Open schedule"
      >
        <span
          className={`scheduler-status-dot scheduler-status-dot--${statusKind}`}
          aria-label={statusLabel}
          title={statusLabel}
        />
        {isExternal ? (
          <span className="scheduler-toggle scheduler-toggle--readonly" aria-hidden title="Managed by Claude Code" />
        ) : (
          <label className="scheduler-toggle" onClick={stop} title={task.enabled ? 'Disable schedule' : 'Enable schedule'}>
            <input type="checkbox" checked={task.enabled} onChange={toggle} />
            <span aria-hidden />
          </label>
        )}
        <div className="scheduler-card-compact-body">
          <span className="scheduler-card-title">
            {task.name}
            {isExternal && (
              <span className="scheduler-claude-badge" title="A Claude Code /loop job — manage it from Claude Code">
                Claude
              </span>
            )}
            {group && (
              <span
                className="scheduler-group-chip"
                style={{
                  color: group.color ?? GROUP_FALLBACK_COLOR,
                  borderColor: group.color ?? GROUP_FALLBACK_COLOR
                }}
                title={`Group: ${group.name}`}
              >
                {(() => {
                  const Icon = groupIcon(group.icon);
                  return <Icon size={11} />;
                })()}
                {group.name}
              </span>
            )}
          </span>
          <span className="scheduler-card-compact-meta">
            {isExternal
              ? `${task.source && task.source !== 'global' ? `${projectName} · ` : ''}Claude /loop · ${task.schedule.every}`
              : `${projectName} · ${PROFILE_LABEL[task.profile]} · every ${task.schedule.every}`}
          </span>
        </div>
        <div className="scheduler-card-compact-when">
          {isExternal ? (
            <span className="scheduler-card-compact-next scheduler-card-compact-next--muted" title="Managed by Claude Code">
              {task.schedule.every}
            </span>
          ) : isWorking ? (
            <span className="scheduler-pill scheduler-pill--running" title="Agent is working — turn in progress">
              running
            </span>
          ) : isFinishedOpen ? (
            <span
              className="scheduler-pill scheduler-pill--done"
              title="Agent finished its turn — session still open at the prompt"
            >
              done
            </span>
          ) : task.enabled && nextRun ? (
            <span className="scheduler-card-compact-next" title="Next fire">
              in {formatCountdown(nextRun)}
            </span>
          ) : (
            <span className="scheduler-card-compact-next scheduler-card-compact-next--muted">paused</span>
          )}
        </div>
        <div className="scheduler-card-actions" onClick={stop}>
          {!isExternal && liveSessionId && (
            <>
              <button
                className="scheduler-icon-btn"
                onClick={openLive}
                title={isFinishedOpen ? 'Open session (finished)' : 'Open running terminal'}
                aria-label={isFinishedOpen ? 'Open session (finished)' : 'Open running terminal'}
              >
                <ExternalLink size={14} />
              </button>
              <button
                className="scheduler-icon-btn scheduler-icon-btn--danger"
                onClick={stopLive}
                title={isFinishedOpen ? 'Close session' : 'Stop running terminal'}
                aria-label={isFinishedOpen ? 'Close session' : 'Stop running terminal'}
              >
                <Square size={14} />
              </button>
            </>
          )}
          {!isExternal && !liveSessionId && (
            <button className="scheduler-icon-btn" onClick={runNow} title="Run now" aria-label="Run now">
              <Play size={14} />
            </button>
          )}
          {lastReportRun && (
            <button
              className="scheduler-icon-btn scheduler-icon-btn--report"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              title="See what happened — open the schedule"
              aria-label="Open schedule report"
            >
              <FileText size={14} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      {rowMenu && (
        <ScheduleRowMenu
          anchor={rowMenu}
          enabled={task.enabled}
          liveSessionId={liveSessionId}
          isFinishedOpen={isFinishedOpen}
          hasReport={!!lastReportRun}
          onClose={() => setRowMenu(null)}
          onOpen={onOpen}
          onOpenInSplit={onOpenInSplit}
          onRunNow={() => void runNow()}
          onOpenLive={() => openLive()}
          onStopLive={() => void stopLive()}
          onShowReport={onOpen}
          onToggleEnabled={() => void toggle()}
          onDuplicate={onDuplicate}
          onDelete={onAskDelete}
        />
      )}
    </li>
  );
});

function ScheduleRowMenu({
  anchor,
  enabled,
  liveSessionId,
  isFinishedOpen,
  hasReport,
  onClose,
  onOpen,
  onOpenInSplit,
  onRunNow,
  onOpenLive,
  onStopLive,
  onShowReport,
  onToggleEnabled,
  onDuplicate,
  onDelete
}: {
  anchor: { x: number; y: number };
  enabled: boolean;
  liveSessionId: string | null;
  isFinishedOpen: boolean;
  hasReport: boolean;
  onClose: () => void;
  onOpen: () => void;
  onOpenInSplit: () => void;
  onRunNow: () => void;
  onOpenLive: () => void;
  onStopLive: () => void;
  onShowReport: () => void;
  onToggleEnabled: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const PAD = 8;
    const rect = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > window.innerWidth - PAD) {
      left = Math.max(PAD, window.innerWidth - rect.width - PAD);
    }
    if (top + rect.height > window.innerHeight - PAD) {
      top = Math.max(PAD, window.innerHeight - rect.height - PAD);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor]);

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      role="menu"
      style={{ top: anchor.y, left: anchor.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button role="menuitem" onClick={() => { onClose(); onOpen(); }}>
        Open
      </button>
      <button role="menuitem" onClick={() => { onClose(); onOpenInSplit(); }}>
        <Columns2 size={13} /> Open in split
      </button>
      <div className="tab-context-sep" />
      {liveSessionId ? (
        <>
          <button role="menuitem" onClick={() => { onClose(); onOpenLive(); }}>
            <ExternalLink size={13} /> {isFinishedOpen ? 'Open session' : 'Open running terminal'}
          </button>
          <button role="menuitem" className="tab-context-danger" onClick={() => { onClose(); onStopLive(); }}>
            <Square size={13} /> {isFinishedOpen ? 'Close session' : 'Stop terminal'}
          </button>
        </>
      ) : (
        <button role="menuitem" onClick={() => { onClose(); onRunNow(); }}>
          <Play size={13} /> Run now
        </button>
      )}
      {hasReport && (
        <button role="menuitem" onClick={() => { onClose(); onShowReport(); }}>
          <FileText size={13} /> View latest report
        </button>
      )}
      <div className="tab-context-sep" />
      <button role="menuitem" onClick={() => { onClose(); onToggleEnabled(); }}>
        {enabled ? <><PowerOff size={13} /> Disable</> : <><Power size={13} /> Enable</>}
      </button>
      <button role="menuitem" onClick={() => { onClose(); onDuplicate(); }}>
        <Copy size={13} /> Duplicate
      </button>
      <div className="tab-context-sep" />
      <button role="menuitem" className="tab-context-danger" onClick={() => { onClose(); onDelete(); }}>
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}
