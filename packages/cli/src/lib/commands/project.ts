import { errResult, type CliResult } from '../cli-result.js';
import { flagValue } from '../flag-parse.js';
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

  return errResult(
    `unknown project command '${subcommand}'. Try list, show, create, files, content, skills.`,
    2
  );
}
