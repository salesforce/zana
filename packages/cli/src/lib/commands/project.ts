import { errResult, type CliResult } from '../cli-result.js';
import { flagValue, flagValues } from '../flag-parse.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

interface ProjectRow {
  id?: string;
  name?: string;
  path?: string;
  tag?: string;
}

function projectsFrom(data: unknown): ProjectRow[] {
  if (Array.isArray(data)) return data as ProjectRow[];
  if (data && typeof data === 'object' && Array.isArray((data as { projects?: unknown }).projects)) {
    return (data as { projects: ProjectRow[] }).projects;
  }
  return [];
}

function formatProject(row: ProjectRow): string {
  return `${row.id ?? '?'}\t${row.name ?? '?'}\t${row.tag ?? '-'}\t${row.path ?? ''}`;
}

function formatProcess(row: { pid?: number; command?: string; cwd?: string }): string {
  return `${row.pid ?? '?'}\t${row.command || '-'}\t${row.cwd ?? ''}`;
}

function parseProcessPids(rest: string[]): number[] {
  return flagValues(rest, '--pid').map((value) => Number(value)).filter((pid) => Number.isInteger(pid) && pid > 0);
}

export async function runProjectCommand(
  subcommand: string | undefined,
  rest: string[],
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
    const listed = await productRequest<unknown>('GET', '/api/v1/projects', { deps });
    if (!listed.ok) return listed.result;
    const projects = projectsFrom(listed.data);
    if (json) return renderOrJson(true, projects, '');
    if (projects.length === 0) return renderOrJson(false, projects, 'No projects\n');
    return renderOrJson(false, projects, `${projects.map(formatProject).join('\n')}\n`);
  }

  if (subcommand === 'show') {
    const id = rest[0];
    if (!id) return errResult('project show requires <id>', 2);
    const listed = await productRequest<unknown>('GET', '/api/v1/projects', { deps });
    if (!listed.ok) return listed.result;
    const projects = projectsFrom(listed.data);
    const row = projects.find((project) => project.id === id || project.name === id || project.tag === id);
    if (!row) return errResult(`project not found: ${id}`, 3);
    return renderOrJson(json, row, `${formatProject(row)}\n`);
  }

  if (subcommand === 'create') {
    const path = flagValue(rest, '--path') ?? flagValue(rest, '--root');
    const hostId = flagValue(rest, '--host') ?? flagValue(rest, '--machine');
    if (!path) return errResult('project create requires --path <absolute-path>', 2);
    const created = await productRequest<{ project?: ProjectRow }>('POST', '/api/v1/projects', {
      deps,
      body: { path, hostId }
    });
    if (!created.ok) return created.result;
    const row = created.data.project ?? (created.data as ProjectRow);
    return renderOrJson(json, created.data, `${formatProject(row)}\n`);
  }

  if (subcommand === 'files' || subcommand === 'paths') {
    const id = rest[0];
    if (!id) return errResult(`project ${subcommand} requires <id>`, 2);
    const listed = await productRequest<unknown>('GET', `/api/v1/projects/${encodeURIComponent(id)}/paths`, {
      deps,
      query: { query: flagValue(rest, '--query') }
    });
    if (!listed.ok) return listed.result;
    return renderOrJson(json, listed.data, `${JSON.stringify(listed.data, null, 2)}\n`);
  }

  if (subcommand === 'content') {
    const id = rest[0];
    const filePath = rest[1];
    if (!id || !filePath) return errResult('project content requires <id> <path>', 2);
    const read = await productRequest<unknown>('GET', `/api/v1/projects/${encodeURIComponent(id)}/files/content`, {
      deps,
      query: { path: filePath }
    });
    if (!read.ok) return read.result;
    return renderOrJson(json, read.data, typeof read.data === 'string' ? read.data : `${JSON.stringify(read.data, null, 2)}\n`);
  }

  if (subcommand === 'skills') {
    const id = rest[0];
    if (!id) return errResult('project skills requires <id>', 2);
    const listed = await productRequest<unknown>('GET', `/api/v1/projects/${encodeURIComponent(id)}/commands`, { deps });
    if (!listed.ok) return listed.result;
    return renderOrJson(json, listed.data, `${JSON.stringify(listed.data, null, 2)}\n`);
  }

  if (subcommand === 'processes') {
    const action = rest[0] === 'kill' || rest[0] === 'list' ? rest[0] : 'list';
    const id = rest[0] === 'kill' || rest[0] === 'list' ? rest[1] : rest[0];
    if (!id) return errResult('project processes requires <id>', 2);
    if (action === 'kill') {
      const pids = parseProcessPids(rest);
      if (pids.length === 0) return errResult('project processes kill requires --pid <pid>', 2);
      const killed = await productRequest<{ killed?: Array<{ pid?: number; command?: string; cwd?: string }> }>(
        'POST',
        `/api/v1/projects/${encodeURIComponent(id)}/processes/kill`,
        { deps, body: { pids } }
      );
      if (!killed.ok) return killed.result;
      const rows = killed.data.killed ?? [];
      if (json) return renderOrJson(true, killed.data, '');
      if (rows.length === 0) return renderOrJson(false, killed.data, 'No matching processes\n');
      return renderOrJson(false, killed.data, `${rows.map(formatProcess).join('\n')}\n`);
    }
    const listed = await productRequest<{
      processes?: Array<{ pid?: number; command?: string; cwd?: string }>;
      supported?: boolean;
    }>('GET', `/api/v1/projects/${encodeURIComponent(id)}/processes`, { deps });
    if (!listed.ok) return listed.result;
    if (json) return renderOrJson(true, listed.data, '');
    if (listed.data.supported === false) {
      return renderOrJson(false, listed.data, 'Process listing is not available on this host\n');
    }
    const rows = listed.data.processes ?? [];
    if (rows.length === 0) return renderOrJson(false, listed.data, 'No running processes\n');
    return renderOrJson(false, listed.data, `${rows.map(formatProcess).join('\n')}\n`);
  }

  return errResult(
    `unknown project command '${subcommand}'. Try list, show, create, files, content, skills, processes.`,
    2
  );
}
