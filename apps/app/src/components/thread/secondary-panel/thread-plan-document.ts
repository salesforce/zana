import {
  isApprovalPendingInteractionPayload,
  type PendingInteraction
} from '@zana-ai/zcc-domain/thread-runtime';

export type ThreadPlanDocument = {
  markdown: string | null;
  filePath: string | null;
  prompt: string | null;
  source: 'approval' | 'durable' | 'empty';
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

export function resolveThreadPlanDocument(args: {
  promptMode: { mode: string; prompt?: string } | null | undefined;
  pendingInteractions: readonly PendingInteraction[];
  durablePlan?: {
    markdown: string | null;
    filePath?: string | null;
    requestedExecutionMode?: string | null;
    effectiveExecutionMode?: string | null;
    executionModeMismatch?: boolean;
  } | null;
}): ThreadPlanDocument | null {
  const inPlanMode = args.promptMode?.mode === 'plan';
  const durable = args.durablePlan;
  const approval = pendingPlanApprovalSubject(args.pendingInteractions);
  if (!inPlanMode && !approval && !durable) return null;
  const prompt = inPlanMode ? (args.promptMode?.prompt?.trim() || null) : null;
  const durableFilePath = durable?.filePath?.trim() ? durable.filePath : null;
  if (approval) {
    return {
      markdown: approval.plan,
      filePath: approval.planFilePath,
      prompt,
      source: 'approval'
    };
  }
  if (durable?.markdown) {
    return {
      markdown: durable.markdown,
      filePath: durableFilePath,
      prompt,
      source: 'durable'
    };
  }
  return {
    markdown: durable?.markdown ?? null,
    filePath: durableFilePath,
    prompt,
    source: durable ? 'durable' : 'empty'
  };
}
