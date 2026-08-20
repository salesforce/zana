import type { Result } from '../../shared/types.js';
import type { ExecutionRecord } from './store.js';

interface MonitorProject {
  id: string;
  path: string;
}

interface MonitorPersona {
  id: string;
}

interface CreatedMonitor {
  id: string;
}

interface MonitorCreationInput {
  projectId: string;
  profile: 'claude';
  personaId: string;
  cols: number;
  rows: number;
  title: string;
  cwd: string;
  headless: false;
  cohort: {
    cohortId: string;
    teamId: string;
    teamName: string;
    role: 'orchestrator';
    executionId: string;
    executionJobTitle: string;
  };
}

export interface RelaunchMonitorDeps {
  findProject(projectId: string): MonitorProject | undefined;
  getExecution(projectId: string, executionId: string): Promise<ExecutionRecord | undefined>;
  confirm(record: ExecutionRecord): Promise<boolean>;
  readToken(projectId: string, executionId: string): string | undefined;
  findOrchestratorPersona(): MonitorPersona | undefined;
  createMonitor(input: MonitorCreationInput): Result<CreatedMonitor>;
  bindMonitor(sessionId: string, projectId: string, executionId: string, token: string): Promise<Result<unknown>>;
  closeMonitor(sessionId: string): void;
  clearToken(projectId: string, executionId: string): void;
}

/** Main-only relaunch flow. Validate route ownership before touching token state. */
export async function relaunchExecutionMonitor(
  deps: RelaunchMonitorDeps,
  projectId: string,
  executionId: string
): Promise<Result<{ sessionId: string }>> {
  const project = deps.findProject(projectId);
  const record = project ? await deps.getExecution(project.id, executionId) : undefined;
  if (!project || !record) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for project' };

  if (!await deps.confirm(record)) return { ok: false, code: 'CANCELED', message: 'monitor relaunch canceled' };

  const token = deps.readToken(project.id, record.id);
  if (!token) return { ok: false, code: 'NOT_FOUND', message: 'no current resume token for execution' };
  const persona = deps.findOrchestratorPersona();
  if (!persona) return { ok: false, code: 'NOT_FOUND', message: 'builtin monitor persona is unavailable' };

  try {
    const created = deps.createMonitor({
      projectId: project.id,
      profile: 'claude',
      personaId: persona.id,
      cols: 120,
      rows: 36,
      title: `Monitor: ${record.jobTitle}`,
      cwd: project.path,
      headless: false,
      cohort: {
        cohortId: record.id,
        teamId: record.teamId,
        teamName: record.teamId,
        role: 'orchestrator',
        executionId: record.id,
        executionJobTitle: record.jobTitle
      }
    });
    if (!created.ok) return created;

    try {
      const bound = await deps.bindMonitor(created.value.id, project.id, record.id, token);
      if (!bound.ok) {
        deps.closeMonitor(created.value.id);
        return { ok: false, code: bound.code, message: bound.message };
      }
    } catch (error) {
      deps.closeMonitor(created.value.id);
      return { ok: false, code: 'SPAWN_FAILED', message: error instanceof Error ? error.message : String(error) };
    }

    deps.clearToken(project.id, record.id);
    return { ok: true, value: { sessionId: created.value.id } };
  } catch (error) {
    return { ok: false, code: 'SPAWN_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}
