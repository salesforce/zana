import type { StudioDiagnostic } from '../../../lib/studio-contract.js';

/** STUB (WS-5 owns): diagnostics list with "Fix with agent". */
export interface ProblemsPanelProps {
  path: string | null;
  diagnostics: StudioDiagnostic[];
  compact?: boolean;
  onReveal?(line: number, column: number): void;
  onFixWithAgent?(): void;
}
export function ProblemsPanel(_props: ProblemsPanelProps) {
  return null;
}
