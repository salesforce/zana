import type { ProposalOutcome } from '../../lib/studio-contract.js';
import { computeHunks, hunkSignature, type ChangeHunk } from '../../lib/line-diff.js';

/** How one pending hunk is drawn: deleted base lines are decorated, added lines live in a view zone. */
export interface HunkLayout {
  index: number;
  /** Base lines to strike through (absent for pure insertions). */
  deleteRange?: { startLine: number; endLine: number };
  /** The view zone with the added lines is placed after this line (0 = before the first line). */
  zoneAfterLine: number;
  addLines: string[];
  /** Line the per-hunk Accept/Reject widget is anchored to. */
  widgetLine: number;
}

/**
 * Pure state of one agent edit proposal. The editor model always holds the *current* text; hunks are re-derived
 * from (current text, proposed text) after every accept, reject or foreign edit, so positions never drift.
 * Rejected hunks are remembered by signature and stay hidden.
 */
export class ProposalSession {
  readonly proposalId: string;
  readonly summary: string;
  readonly actor: string;
  readonly proposed: string;
  accepted = 0;
  rejected = 0;
  private pendingHunks: ChangeHunk[] = [];
  private readonly rejectedSignatures = new Set<string>();

  constructor(input: { proposalId: string; proposed: string; summary: string; actor: string }) {
    this.proposalId = input.proposalId;
    this.proposed = input.proposed;
    this.summary = input.summary;
    this.actor = input.actor;
  }

  get hunks(): readonly ChangeHunk[] {
    return this.pendingHunks;
  }

  get resolved(): boolean {
    return this.pendingHunks.length === 0;
  }

  /** Re-derive the pending hunks against the editor's current text. */
  refresh(current: string): readonly ChangeHunk[] {
    const computed = computeHunks(current, this.proposed) ?? [wholeFileHunk(current, this.proposed)];
    this.pendingHunks = computed.filter(hunk => !this.rejectedSignatures.has(hunkSignature(hunk))).map((hunk, index) => ({ ...hunk, index }));
    return this.pendingHunks;
  }

  rejectHunk(index: number): boolean {
    const hunk = this.pendingHunks.find(row => row.index === index);
    if (!hunk) return false;
    this.rejectedSignatures.add(hunkSignature(hunk));
    this.rejected += 1;
    this.pendingHunks = this.pendingHunks.filter(row => row !== hunk);
    return true;
  }

  rejectAll(): number {
    const count = this.pendingHunks.length;
    for (const hunk of this.pendingHunks) this.rejectedSignatures.add(hunkSignature(hunk));
    this.rejected += count;
    this.pendingHunks = [];
    return count;
  }

  /** Call after the editor applied `count` hunks (the caller then calls refresh). */
  noteAccepted(count: number): void {
    this.accepted += count;
  }

  outcome(): ProposalOutcome {
    const outcome = this.rejected === 0 ? 'accepted' : this.accepted === 0 ? 'rejected' : 'partial';
    return { outcome, acceptedHunks: this.accepted, rejectedHunks: this.rejected };
  }

  layout(): HunkLayout[] {
    return this.pendingHunks.map(hunk => {
      const oldCount = hunk.oldLines.length;
      return {
        index: hunk.index,
        deleteRange: oldCount > 0 ? { startLine: hunk.baseStart, endLine: hunk.baseStart + oldCount - 1 } : undefined,
        zoneAfterLine: hunk.baseStart + oldCount - 1,
        addLines: hunk.newLines,
        widgetLine: hunk.baseStart
      };
    });
  }
}

function wholeFileHunk(current: string, proposed: string): ChangeHunk {
  return { index: 0, baseStart: 1, oldLines: current.split('\n'), newLines: proposed.split('\n') };
}

/** "2 changes" / "1 change" label for the sticky bar. */
export function proposalLabel(pending: number): string {
  return `${pending} change${pending === 1 ? '' : 's'}`;
}
