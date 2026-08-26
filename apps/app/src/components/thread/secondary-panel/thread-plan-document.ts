import {
  isApprovalPendingInteractionPayload,
  type PendingInteraction
} from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';

export type ThreadPlanDocument = {
  markdown: string | null;
  filePath: string | null;
  prompt: string | null;
  source: 'approval' | 'live' | 'empty';
};

export function planFileTabTitle(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function pendingPlanApprovalSubject(
  interactions: readonly PendingInteraction[]
): { plan: string; planFilePath: string | null } | null {
  for (const interaction of interactions) {
    if (!isApprovalPendingInteractionPayload(interaction.payload)) continue;
    if (interaction.payload.subject.kind !== 'plan') continue;
    return {
      plan: interaction.payload.subject.plan,
      planFilePath: interaction.payload.subject.planFilePath
    };
  }
  return null;
}

export function latestAssistantConversationText(rows: readonly TimelineRow[]): string | null {
  let latest: string | null = null;
  const visit = (list: readonly TimelineRow[] | null | undefined) => {
    if (!list) return;
    for (const row of list) {
      if (row.kind === 'turn') {
        visit(row.children);
        continue;
      }
      if (row.kind !== 'conversation' || row.role !== 'assistant') continue;
      const text = row.text.trim();
      if (text) latest = row.text;
    }
  };
  visit(rows);
  return latest;
}

export function resolveThreadPlanDocument(args: {
  promptMode: { mode: string; prompt?: string } | null | undefined;
  pendingInteractions: readonly PendingInteraction[];
  rows: readonly TimelineRow[];
}): ThreadPlanDocument | null {
  const inPlanMode = args.promptMode?.mode === 'plan';
  const approval = pendingPlanApprovalSubject(args.pendingInteractions);
  if (!inPlanMode && !approval) return null;
  const prompt = inPlanMode ? (args.promptMode?.prompt?.trim() || null) : null;
  const liveDraft = inPlanMode ? latestAssistantConversationText(args.rows) : null;
  if (approval) {
    return {
      markdown: approval.plan,
      filePath: approval.planFilePath,
      prompt,
      source: 'approval'
    };
  }
  if (liveDraft) {
    return {
      markdown: liveDraft,
      filePath: null,
      prompt,
      source: 'live'
    };
  }
  return {
    markdown: null,
    filePath: null,
    prompt,
    source: 'empty'
  };
}
