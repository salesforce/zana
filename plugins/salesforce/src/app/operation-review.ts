import type { OperationKind } from '../../lib/workbench-contract.js';

export function needsOperationThread(kind: OperationKind) {
  return kind === 'apex.anonymous' || kind === 'deploy.start' || kind === 'retrieve.start';
}
export function operationReviewDraft(kind: OperationKind, orgAlias: string | undefined, input: Record<string, unknown>) {
  return `Review this Salesforce action with me before running it. Keep the target org fixed and request the required approval; do not execute automatically.\n\n${JSON.stringify({ ...input, operation: kind, orgAlias: orgAlias ?? 'Resolve the selected project target before approval' }, null, 2)}`;
}
