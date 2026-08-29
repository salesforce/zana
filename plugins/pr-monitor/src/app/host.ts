export interface ProjectInfo {
  id: string;
  name: string;
  path?: string;
}

export interface PluginPanelCache {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete?(key: string): void;
    refreshBadge: () => void;
}

export interface PluginPanelHost {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
  cache: PluginPanelCache;
  toast(message: string, kind?: 'info' | 'error'): void;
  listProjects(): ProjectInfo[];
  openExternal(url: string): void;
  pushInbox(input: { comments: string; projectId?: string }): Promise<{ id: string }>;
}

/** Alias kept so ported renderer tests that mocked ModuleHost keep compiling. */
export type ModuleHost = PluginPanelHost;
