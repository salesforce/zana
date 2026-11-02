import { DesignDocError } from './store.js';

export type ProjectLister = () => Promise<Array<{ id: string; name?: string }>>;

/**
 * Main-side check that a project id names a registered project. Fails closed:
 * an unknown id or a failed project listing both reject. A null, undefined or
 * empty id needs no check (the doc is global / unchanged). With `hint`, the
 * error lists valid projects so an agent can retry.
 */
export async function assertRegisteredProject(
  list: ProjectLister | undefined,
  projectId: string | null | undefined,
  options: { hint?: boolean } = {}
): Promise<void> {
  if (!projectId) return;
  if (!list) throw new DesignDocError('invalid', `unknown project ${projectId} (project list unavailable)`);
  let projects: Array<{ id: string; name?: string }>;
  try {
    projects = await list();
  } catch {
    throw new DesignDocError('invalid', `cannot verify project ${projectId}: project list unavailable`);
  }
  if (projects.some((project) => project.id === projectId)) return;
  const valid = options.hint
    ? `. Valid projects: ${projects.map((project) => (project.name ? `${project.name} (${project.id})` : project.id)).join(', ') || 'none'}`
    : '';
  throw new DesignDocError('invalid', `unknown project ${projectId}${valid}`);
}

/**
 * The project an authoring call names, verified. `projectId` and `global` are
 * exclusive. Returns undefined when neither is passed, null for global, or the
 * registered id.
 */
export async function resolveNamedProject(
  list: ProjectLister | undefined,
  input: Record<string, unknown>
): Promise<string | null | undefined> {
  const global = input.global === true || input.global === 'true';
  const raw = input.projectId;
  if (raw !== undefined && raw !== null && (typeof raw !== 'string' || !raw.trim())) {
    throw new DesignDocError('invalid', 'projectId must be a non-empty string');
  }
  const projectId = typeof raw === 'string' ? raw : undefined;
  if (projectId && global) throw new DesignDocError('invalid', 'pass either projectId or global, not both');
  if (global) return null;
  if (!projectId) return undefined;
  await assertRegisteredProject(list, projectId, { hint: true });
  return projectId;
}
