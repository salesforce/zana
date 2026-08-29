export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface PrMonitorStorage {
  get<T>(key: string): T | undefined | Promise<T | undefined>;
  set(key: string, value: unknown): void | Promise<void>;
}

export interface PrMonitorContext {
  moduleId: string;
  log: (message: string) => void;
  exec: (opts: { bin: string; args: string[]; timeoutMs?: number }) => Promise<ExecResult>;
  storage: PrMonitorStorage;
  cache?: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    delete?(key: string): void;
  };
}
