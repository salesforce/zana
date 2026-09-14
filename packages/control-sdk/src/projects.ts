import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductHttpClient } from './http.js';
import { LIVE_SANDBOX_NAME } from './types.js';

export interface ProjectRecord {
  id: string;
  name?: string;
  path?: string;
  tag?: string;
}

export async function listProjects(http: ProductHttpClient): Promise<ProjectRecord[]> {
  const listed = await http.request<{ projects?: ProjectRecord[] } | ProjectRecord[]>(
    'GET',
    '/api/v1/projects'
  );
  return Array.isArray(listed) ? listed : listed.projects ?? [];
}

export async function ensureLiveSandbox(
  http: ProductHttpClient,
  opts?: { path?: string }
): Promise<ProjectRecord> {
  const existing = (await listProjects(http)).find((row) =>
    row.tag === LIVE_SANDBOX_NAME
    || row.name === LIVE_SANDBOX_NAME
    || (row.path ?? '').endsWith(`/${LIVE_SANDBOX_NAME}`)
    || (row.path ?? '').endsWith(`\\${LIVE_SANDBOX_NAME}`)
  );
  if (existing) return existing;
  const path = opts?.path ?? join(homedir(), 'zcc-workspace', LIVE_SANDBOX_NAME);
  mkdirSync(path, { recursive: true });
  const created = await http.request<{ project: ProjectRecord }>(
    'POST',
    '/api/v1/projects',
    { body: { path } }
  );
  let project = created.project;
  if (project.id && project.name !== LIVE_SANDBOX_NAME) {
    try {
      const patched = await http.request<{ project: ProjectRecord }>(
        'PATCH',
        `/api/v1/projects/${encodeURIComponent(project.id)}`,
        { body: { name: LIVE_SANDBOX_NAME } }
      );
      project = patched.project ?? { ...project, name: LIVE_SANDBOX_NAME };
    } catch {
      project = { ...project, name: LIVE_SANDBOX_NAME };
    }
  }
  return project;
}
