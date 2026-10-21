import { isDxProject } from './dx-project.js';
import type { ExplorerKv } from './soql-history.js';
import type { SalesforceDeps } from './types.js';

/** A project the Salesforce hub can open the Studio in. Ids and labels only: no paths reach the renderer. */
export interface HubProject {
  id: string;
  name: string;
  /** DX layout, a Salesforce icon, or a project target: the hub lists these first. */
  salesforce: boolean;
  dxProject: boolean;
  targetAlias: string | null;
}

/** The hub's project menu stays small; the full list lives in the sidebar. */
export const HUB_PROJECT_LIMIT = 50;
/** Registered projects inspected per request; bounds the filesystem and storage reads. */
export const HUB_SCAN_LIMIT = 200;

/** Structural input keeps host SDK types at the plugin integration boundary. */
interface Project {
  id: string;
  name: string;
  path?: string;
  local?: boolean;
  quickAgent?: boolean;
  icon?: string;
}

/**
 * Local projects the hub offers for the Studio. Remote or folderless projects are left out
 * because Salesforce tools need a local folder; the built-in Default Project is left out too.
 */
export async function listHubProjects(
  projects: readonly Project[],
  kv: Pick<ExplorerKv, 'get'>,
  fs: Pick<SalesforceDeps, 'realpath' | 'exists'>,
): Promise<HubProject[]> {
  const candidates = projects
    .filter(project => project.path?.trim() && project.local !== false && !project.quickAgent)
    .slice(0, HUB_SCAN_LIMIT);
  const rows: HubProject[] = [];
  // One read at a time: plugin storage rejects bursts beyond its small admission limit.
  for (const project of candidates) {
    let root: string;
    try { root = fs.realpath(project.path!); } catch { continue; }
    const dxProject = isDxProject(root, fs.exists);
    const alias = await kv.get<string>(`sf:project:${project.id}:org`).catch(() => undefined);
    const targetAlias = typeof alias === 'string' && alias.trim() ? alias.trim() : null;
    rows.push({ id: project.id, name: project.name, salesforce: dxProject || project.icon === 'Cloud' || Boolean(targetAlias), dxProject, targetAlias });
  }
  return rows
    .sort((a, b) => Number(b.salesforce) - Number(a.salesforce) || a.name.localeCompare(b.name))
    .slice(0, HUB_PROJECT_LIMIT);
}
