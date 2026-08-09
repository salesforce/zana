import type { ExecutionConsentGrant } from './execution-consent-store.js';
import type { ProjectExecutionConsentGrant } from '../../shared/types.js';

interface ExecutionConsentManagementStore {
  list(): Promise<{ grants: ExecutionConsentGrant[] }>;
  revokeProject(grantId: string, projectId: string): Promise<boolean>;
}

export function createExecutionConsentManagement(deps: {
  store: ExecutionConsentManagementStore;
  projectExists: (projectId: string) => boolean;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());

  function authorizeProject(projectId: unknown): asserts projectId is string {
    if (typeof projectId !== 'string' || !deps.projectExists(projectId)) {
      throw new Error('project not found');
    }
  }

  async function listProjectGrants(projectId: unknown): Promise<ProjectExecutionConsentGrant[]> {
    authorizeProject(projectId);
    const timestamp = now();
    const { grants } = await deps.store.list();
    return grants
      .filter((grant) => isActiveProjectGrant(grant, projectId, timestamp))
      .map(({ id, adapterId, targetId, launchScope, createdAt, expiresAt }) => ({
        id,
        adapterId,
        targetId,
        launchScope,
        createdAt,
        ...(expiresAt === undefined ? {} : { expiresAt })
      }));
  }

  async function revokeProjectGrant(projectId: unknown, grantId: unknown): Promise<ProjectExecutionConsentGrant[]> {
    authorizeProject(projectId);
    if (typeof grantId !== 'string' || !grantId) throw new Error('grant not found');

    // Re-read at commit time. Renderer knows only opaque ids; main verifies the
    // live grant still belongs to this project and is project-scoped.
    const timestamp = now();
    const { grants } = await deps.store.list();
    const grant = grants.find((candidate) => candidate.id === grantId);
    if (!grant || !isActiveProjectGrant(grant, projectId, timestamp)) {
      throw new Error('grant not found');
    }
    if (!await deps.store.revokeProject(grant.id, projectId)) throw new Error('grant not found');
    return listProjectGrants(projectId);
  }

  return { listProjectGrants, revokeProjectGrant };
}

function isActiveProjectGrant(
  grant: ExecutionConsentGrant,
  projectId: string,
  timestamp: number
): boolean {
  return grant.scope === 'project'
    && grant.projectId === projectId
    && grant.revokedAt === undefined
    && grant.consumedAt === undefined
    && (grant.expiresAt === undefined || grant.expiresAt > timestamp);
}
