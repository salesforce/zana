/**
 * Task Shelves derivation (afl-04) — a PURE, host-owned mapping of the raw
 * session signals already available in the renderer into the three fixed shelves
 * (Sources / Background / Outputs). No React, no window, no persistence: the
 * first cut derives rows on demand from the polled `sessionStats` file touches,
 * the live sub-agent count, the agent's rollup state, and the overseer activity
 * stream.
 *
 * Generic + core (Rule 6): rows are structured data only — the host owns all
 * presentation (layout, truncation, icons, empty-states). Icons are icon NAMES
 * resolved renderer-side via resolveIcon; never components.
 */
import type {
  Shelf,
  ShelfRow,
  SessionFileTouch,
  OverseerActivity,
  AgentState,
  TerminalSession
} from '@zana-ai/zcc-domain/product';

/** Host-owned per-shelf row cap; overflow collapses into one "+K more" row. */
export const SHELF_ROW_CAP = 20;

/** Freshness window for the "waiting on approval" background row (ms). */
const OVERSEER_FRESH_MS = 60_000;

export interface BuildShelvesInput {
  files: SessionFileTouch[];
  subagentCount: number;
  overseer?: OverseerActivity;
  session: TerminalSession;
  agentState?: AgentState;
  /** Injectable for tests / freshness comparison; defaults to Date.now(). */
  now?: number;
}

/** Dedupe file touches by path (first wins — `files` is most-recent-first), map
 *  to rows, and collapse anything past the cap into a single overflow row. */
function fileRows(files: SessionFileTouch[], icon: string): ShelfRow[] {
  const seen = new Set<string>();
  const rows: ShelfRow[] = [];
  for (const f of files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    rows.push({ id: `${f.op}:${f.path}`, title: f.path, icon });
  }
  if (rows.length <= SHELF_ROW_CAP) return rows;
  const shown = rows.slice(0, SHELF_ROW_CAP);
  const extra = rows.length - SHELF_ROW_CAP;
  shown.push({ id: 'overflow', title: `+${extra} more`, tone: 'muted' });
  return shown;
}

export function buildShelves(input: BuildShelvesInput): Shelf[] {
  const { files = [], subagentCount = 0, overseer, agentState } = input;

  const sources = fileRows(
    files.filter((f) => f.op === 'R'),
    'FileText'
  );
  const outputs = fileRows(
    files.filter((f) => f.op === 'C' || f.op === 'W'),
    'FilePen'
  );

  const background: ShelfRow[] = [];
  if (agentState === 'working') {
    background.push({
      id: 'stream',
      title: 'Active stream',
      detail: 'Agent is working',
      status: 'active',
      tone: 'accent',
      icon: 'Activity'
    });
  }
  const nowMs = input.now ?? Date.now();
  if (
    overseer &&
    (overseer.wouldApprove > 0 || overseer.askedBack > 0) &&
    nowMs - overseer.lastAt < OVERSEER_FRESH_MS
  ) {
    const pending = overseer.wouldApprove + overseer.askedBack;
    background.push({
      id: 'approval',
      title: 'Waiting on approval',
      detail: `${pending} decision${pending === 1 ? '' : 's'} pending`,
      status: 'pending',
      tone: 'danger',
      icon: 'ShieldAlert'
    });
  }
  if (subagentCount > 0) {
    background.push({
      id: 'subagents',
      title: `${subagentCount} sub-agent${subagentCount === 1 ? '' : 's'}`,
      detail: 'Delegated work in flight',
      status: 'active',
      icon: 'Users'
    });
  }

  return [
    { id: 'sources', label: 'Sources', rows: sources },
    { id: 'background', label: 'Background', rows: background },
    { id: 'outputs', label: 'Outputs', rows: outputs }
  ];
}
