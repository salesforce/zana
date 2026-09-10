/** Compact suffix for distinguishing runs whose ids share a long prefix. */
export function shortRunId(executionId: string): string {
  const compact = executionId.replace(/[^a-zA-Z0-9]/g, '');
  return compact.slice(-8) || executionId;
}

/** Stable UI label for one concrete Team launch, including concurrent-run identity. */
export function teamRunLabel(input: {
  executionId?: string;
  cohortId: string;
  executionJobTitle?: string;
  teamName: string;
}): string {
  const id = input.executionId ?? input.cohortId;
  const run = `${input.teamName} · Run ${shortRunId(id)}`;
  return input.executionJobTitle?.trim() ? `${input.executionJobTitle.trim()} · ${run}` : run;
}
