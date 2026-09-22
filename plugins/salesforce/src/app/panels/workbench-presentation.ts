import type { OperationKind } from '../../../lib/workbench-contract.js';

export const OPERATION_LABELS: Record<OperationKind, string> = {
  'apex.test': 'Apex tests', 'apex.anonymous': 'Anonymous Apex', 'lwc.test': 'LWC tests',
  'deploy.preview': 'Deployment preview', 'deploy.validate': 'Deployment validation',
  'deploy.start': 'Deployment', 'retrieve.preview': 'Retrieval preview', 'retrieve.start': 'Retrieval',
};

export function displayTime(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
