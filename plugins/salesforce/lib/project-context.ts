import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import type { ExplorerKv } from "./soql-history.js";
import type { PluginSettingsValues, SalesforceDeps } from "./types.js";

export interface SalesforceProjectContext {
  projectId: string | null;
  projectName: string | null;
  targetSource: "override" | "project" | "shared";
  settings: PluginSettingsValues;
}

export function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function inputText(input: unknown, key: string): string {
  const value = inputRecord(input)[key];
  return typeof value === "string" ? value.trim() : "";
}

export class ProjectContextError extends Error {
  constructor(
    message: string,
    readonly code = "invalid_context",
  ) {
    super(message);
  }
}

/** Request-local snapshots keep concurrent projects and delayed approvals on their original target. */
export class ProjectContexts {
  private readonly scope = new AsyncLocalStorage<SalesforceProjectContext>();

  constructor(
    private readonly deps: {
      settings(): Promise<PluginSettingsValues>;
      projects(): Promise<Array<{ id: string; name: string; path?: string }>>;
      resolveAlias(): Promise<string | null>;
      kv: ExplorerKv;
      fs: Pick<SalesforceDeps, "realpath" | "exists">;
    },
  ) {}

  current(): SalesforceProjectContext | undefined {
    return this.scope.getStore();
  }

  async settings(): Promise<PluginSettingsValues> {
    return this.current()?.settings ?? this.deps.settings();
  }

  async resolve(input: unknown): Promise<SalesforceProjectContext> {
    const settings = { ...(await this.deps.settings()) };
    const projectId = inputText(input, "projectId");
    const override = inputText(input, "orgAlias");
    let projectName: string | null = null;
    let targetSource: SalesforceProjectContext["targetSource"] = "shared";
    if (projectId) {
      const project = (await this.deps.projects()).find(
        (row) => row.id === projectId,
      );
      if (!project)
        throw new ProjectContextError("This project is no longer registered.");
      if (!project.path)
        throw new ProjectContextError(
          "Salesforce tools require an available local project folder.",
          "project_unavailable",
        );
      try {
        settings.projectRoot = this.deps.fs.realpath(project.path);
      } catch {
        throw new ProjectContextError(
          "The project folder is unavailable on this host.",
          "project_unavailable",
        );
      }
      projectName = project.name;
      const alias = await this.deps.kv.get<string>(
        `sf:project:${projectId}:org`,
      );
      if (alias) {
        settings.defaultOrg = alias;
        targetSource = "project";
      }
    }
    if (override) {
      if (
        override.length > 255 ||
        override.startsWith("-") ||
        /[\r\n\0]/.test(override)
      ) {
        throw new ProjectContextError("Choose a valid Salesforce org alias.");
      }
      settings.defaultOrg = override;
      targetSource = "override";
    }
    // Pin a fallback once, before any asynchronous operation or approval.
    if (!settings.defaultOrg)
      settings.defaultOrg =
        (await this.scope.exit(() =>
          this.deps.resolveAlias().catch(() => null),
        )) ?? "";
    return {
      projectId: projectId || null,
      projectName,
      targetSource,
      settings,
    };
  }

  async run<T>(input: unknown, work: () => T | Promise<T>): Promise<T> {
    const context = await this.resolve(input);
    return this.scope.run(context, work);
  }

  async select(input: unknown, aliases: string[]): Promise<void> {
    const projectId = inputText(input, "projectId");
    if (!projectId)
      throw new ProjectContextError(
        "Choose a project before setting its target.",
      );
    await this.resolve({ projectId });
    const alias = inputText(input, "selectedAlias");
    if (alias && !aliases.includes(alias))
      throw new ProjectContextError(
        "Choose an org from the connected org list.",
      );
    await this.deps.kv.set(`sf:project:${projectId}:org`, alias);
  }

  isDx(): boolean {
    const root = this.current()?.settings.projectRoot;
    return Boolean(
      root && this.deps.fs.exists(join(root, "sfdx-project.json")),
    );
  }

  /** Keep legacy global history readable; project history has a distinct namespace. */
  key(key: string): string {
    const id = this.current()?.projectId;
    return id ? `sf:project:${id}:${key}` : key;
  }
}
