import { type CliResult } from '../cli-result.js';
import { productRequest, renderOrJson, type ProductHttpDeps } from '../product-http.js';

interface ThreadRow {
  id?: string;
  status?: string;
  title?: string | null;
  projectId?: string;
}

interface ProjectRow {
  id?: string;
}

export async function statusDashboardHttp(
  json: boolean,
  deps?: ProductHttpDeps
): Promise<CliResult> {
  const projects = await productRequest<{ projects?: ProjectRow[] } | ProjectRow[]>('GET', '/api/v1/projects', { deps });
  if (!projects.ok) return projects.result;
  const threads = await productRequest<{ threads?: ThreadRow[] }>('GET', '/api/v1/threads', { deps });
  if (!threads.ok) return threads.result;
  const projectList = Array.isArray(projects.data)
    ? projects.data
    : (projects.data.projects ?? []);
  const threadList = threads.data.threads ?? [];
  const payload = {
    projectCount: projectList.length,
    threadCount: threadList.length,
    currentProjectId: process.env.ZCC_PROJECT_ID ?? null,
    currentThreadId: process.env.ZCC_THREAD_ID ?? process.env.ZCC_SESSION_ID ?? null,
    threads: threadList.map((row) => ({
      id: row.id,
      status: row.status,
      title: row.title,
      projectId: row.projectId
    }))
  };
  if (json) return renderOrJson(true, payload, '');
  let out = 'Zana Command Center — live\n';
  out += `Projects: ${payload.projectCount}\n`;
  out += `Threads: ${payload.threadCount}\n`;
  if (payload.currentThreadId) out += `Current: ${payload.currentThreadId}\n`;
  out += '\n';
  if (threadList.length === 0) out += '  none\n';
  else {
    for (const row of threadList) {
      out += `  ${row.id ?? '?'}\t${row.status ?? '?'}\t${row.title ?? ''}\n`;
    }
  }
  return renderOrJson(false, payload, out);
}
