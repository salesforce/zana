import {
  DesktopBrowserHandle,
  importDesktopBrowserCookies,
  listDesktopBrowserImportSources,
  listDesktopBrowserInstances,
  pickDesktopBrowserInstance
} from './browsers.js';
import { cleanupRun, cleanupStale } from './cleanup.js';
import { resolveConnect, type ResolvedConnect } from './connect.js';
import { health, preflight } from './harness.js';
import { listHosts } from './hosts.js';
import { ensureLiveSandbox, listProjects } from './projects.js';
import { createRunId } from './tags.js';
import { launchCliAgent, rejectIsolatedCliAgent, type CliAgentHandle } from './cli-agents.js';
import { spawnThread, type ThreadHandle } from './threads.js';
import type {
  CliAgentLaunchSpec,
  ConnectOptions,
  IsolatedLaunchOptions,
  ThreadLaunchSpec
} from './types.js';
import type { IsolatedHandle } from './isolated.js';

export class Zcc {
  private isolated?: IsolatedHandle;

  private constructor(
    readonly resolved: ResolvedConnect,
    readonly runId: string
  ) {}

  get serverUrl(): string {
    return this.resolved.serverUrl;
  }

  get dataDir(): string {
    return this.resolved.dataDir;
  }

  get http() {
    return this.resolved.http;
  }

  static async connect(opts: ConnectOptions = {}): Promise<Zcc> {
    const resolved = await resolveConnect(opts);
    return new Zcc(resolved, createRunId(opts.runId));
  }

  static async launch(opts: IsolatedLaunchOptions): Promise<Zcc> {
    const { launchIsolated } = await import('./isolated.js');
    const isolated = await launchIsolated(opts);
    const zcc = new Zcc(isolated.connect, createRunId(opts.runId));
    zcc.isolated = isolated;
    return zcc;
  }

  async health() {
    return health(this.http);
  }

  readonly projects = {
    list: () => listProjects(this.http),
    ensureLiveSandbox: (opts?: { path?: string }) => ensureLiveSandbox(this.http, opts)
  };

  readonly hosts = {
    list: () => listHosts(this.http)
  };

  readonly harness = {
    preflight: (opts: { surface: 'thread' | 'cli-agent'; providerId?: string; profile?: string }) =>
      preflight(this.http, opts)
  };

  readonly browsers = {
    listInstances: (hostId: string) => listDesktopBrowserInstances(this.http, hostId),
    listImportSources: (scope: { hostId: string; instanceId: string; generation: string }) =>
      listDesktopBrowserImportSources(this.http, scope),
    importCookies: (input: {
      hostId: string;
      instanceId: string;
      generation: string;
      sourceId: string;
      sourceProfileDirectory: string;
      profile?: { kind: 'personal' } | { kind: 'automation'; id: string };
    }) => importDesktopBrowserCookies(this.http, input),
    pickInstance: (opts?: { hostId?: string }) =>
      pickDesktopBrowserInstance(this.http, { hostId: opts?.hostId, isolated: this.resolved.isolated }),
    session: (scope: {
      hostId: string;
      instanceId: string;
      generation: string;
      threadId: string;
    }) => new DesktopBrowserHandle(this.http, scope)
  };

  readonly threads = {
    spawn: (spec: Omit<ThreadLaunchSpec, 'surface'>) =>
      spawnThread(this.http, spec, { runId: this.runId, dataDir: this.dataDir })
  };

  readonly cliAgents = {
    launch: async (spec: Omit<CliAgentLaunchSpec, 'surface'>): Promise<CliAgentHandle> => {
      rejectIsolatedCliAgent(this.resolved.isolated);
      return launchCliAgent(this.http, spec, { runId: this.runId, dataDir: this.dataDir });
    }
  };

  async cleanup(opts?: { runId?: string; stale?: boolean }) {
    if (opts?.stale) return cleanupStale(this.http, this.dataDir);
    return cleanupRun(this.http, this.dataDir, opts?.runId ?? this.runId);
  }

  async close(): Promise<void> {
    await this.cleanup().catch(() => undefined);
    await this.isolated?.stop();
  }
}

export type { ThreadHandle, CliAgentHandle, DesktopBrowserHandle };
