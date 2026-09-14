import type { ProductHttpClient } from './http.js';
import { deleteJournal, listJournals, readJournal, titleMatchesRun } from './tags.js';
import type { CliAgentRecord, ThreadRecord } from './types.js';

export async function cleanupRun(
  http: ProductHttpClient,
  dataDir: string,
  runId: string
): Promise<{
  stoppedThreads: string[];
  stoppedAgents: string[];
  killedPids: number[];
  destroyedEnvironments: string[];
}> {
  const journal = readJournal(dataDir, runId);
  const stoppedThreads: string[] = [];
  const stoppedAgents: string[] = [];
  const killedPids: number[] = [];
  const destroyedEnvironments: string[] = [];

  const threadIds = new Set(journal?.threadIds ?? []);
  try {
    const listed = await http.request<{ threads?: ThreadRecord[] }>('GET', '/api/v1/threads');
    for (const row of listed.threads ?? []) {
      if (row.id && (threadIds.has(row.id) || titleMatchesRun(row.title, runId))) {
        threadIds.add(row.id);
      }
    }
  } catch {
    /* list may fail if app is gone */
  }
  for (const id of threadIds) {
    try {
      await http.request('POST', `/api/v1/threads/${encodeURIComponent(id)}/stop`, { body: {} });
      stoppedThreads.push(id);
    } catch {
      /* already gone */
    }
  }

  const agentIds = new Set(journal?.cliAgentIds ?? []);
  try {
    const listed = await http.request<{ sessions?: CliAgentRecord[]; agents?: CliAgentRecord[] }>(
      'GET',
      '/api/v1/cli-agents',
      { query: { tag: runId } }
    );
    for (const row of [...(listed.sessions ?? []), ...(listed.agents ?? [])]) {
      if (row.id) agentIds.add(row.id);
    }
  } catch {
    /* optional resource */
  }
  for (const id of agentIds) {
    try {
      await http.request('POST', `/api/v1/cli-agents/${encodeURIComponent(id)}/stop`, { body: {} });
      stoppedAgents.push(id);
    } catch {
      /* already gone */
    }
  }

  const projectId = journal?.projectId;
  if (projectId) {
    try {
      const listed = await http.request<{ processes?: Array<{ pid: number }> }>(
        'GET',
        `/api/v1/projects/${encodeURIComponent(projectId)}/processes`
      );
      const pids = (listed.processes ?? []).map((row) => row.pid).filter((pid) => pid > 0);
      if (pids.length > 0) {
        const killed = await http.request<{ killed?: Array<{ pid: number }> }>(
          'POST',
          `/api/v1/projects/${encodeURIComponent(projectId)}/processes/kill`,
          { body: { pids } }
        );
        for (const row of killed.killed ?? []) killedPids.push(row.pid);
      }
    } catch {
      /* processes API may be unsupported */
    }

    const environmentIds = new Set<string>();
    try {
      const listed = await http.request<{
        environments?: Array<{ id?: string; workspaceProvisionType?: string }>;
      }>(
        'GET',
        `/api/v1/projects/${encodeURIComponent(projectId)}/environments`
      );
      for (const env of listed.environments ?? []) {
        if (env.id && env.workspaceProvisionType === 'managed-worktree') {
          environmentIds.add(env.id);
        }
      }
    } catch {
      /* optional */
    }
    for (const id of environmentIds) {
      try {
        await http.request('DELETE', `/api/v1/environments/${encodeURIComponent(id)}`);
        destroyedEnvironments.push(id);
      } catch {
        /* already gone or unmanaged */
      }
    }
  }

  deleteJournal(dataDir, runId);
  return { stoppedThreads, stoppedAgents, killedPids, destroyedEnvironments };
}

export async function cleanupStale(http: ProductHttpClient, dataDir: string): Promise<string[]> {
  const cleaned: string[] = [];
  for (const journal of listJournals(dataDir)) {
    await cleanupRun(http, dataDir, journal.runId);
    cleaned.push(journal.runId);
  }
  return cleaned;
}
