import { homedir } from 'node:os';
import { join } from 'node:path';
import { ControlError } from './errors.js';
import { ProductHttpClient, probeHealth } from './http.js';
import { DEFAULT_DEV_URL, DEFAULT_PROD_URL, type ConnectOptions, type ProviderMode } from './types.js';

export interface ResolvedConnect {
  http: ProductHttpClient;
  serverUrl: string;
  dataDir: string;
  provider: ProviderMode;
  isolated: boolean;
}

function defaultDataDirFor(serverUrl: string, override?: string): string {
  if (override) return override;
  if (process.env.ZCC_DATA_DIR) return process.env.ZCC_DATA_DIR;
  if (process.env.ZCC_CENTER_DIR) return process.env.ZCC_CENTER_DIR;
  const trimmed = serverUrl.replace(/\/+$/, '');
  if (trimmed === DEFAULT_DEV_URL) return join(homedir(), '.zcc-dev');
  return join(homedir(), '.zcc');
}

export async function resolveConnect(opts: ConnectOptions = {}): Promise<ResolvedConnect> {
  if (process.env.ZCC_SESSION_ID) {
    throw new ControlError(
      'FORBIDDEN_AGENT',
      'Live control must run from a host shell, not a ZCC agent terminal (ZCC_SESSION_ID is set).'
    );
  }
  if (opts.provider === 'fake') {
    throw new ControlError(
      'FAKE_ATTACH',
      'provider: "fake" cannot inject PATH into an already-running app. Use Zcc.launch({ isolated: true, fake: true }) or start the app with fake binaries on PATH.'
    );
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const explicit = (opts.serverUrl ?? process.env.ZCC_SERVER_URL)?.replace(/\/+$/, '');
  let serverUrl: string;
  if (explicit) {
    if (!(await probeHealth(explicit, fetchImpl))) {
      throw new ControlError('APP_NOT_RUNNING', `Zana Command Center is not running at ${explicit}.`);
    }
    serverUrl = explicit;
  } else {
    const prodOk = await probeHealth(DEFAULT_PROD_URL, fetchImpl);
    const devOk = await probeHealth(DEFAULT_DEV_URL, fetchImpl);
    if (prodOk && devOk) {
      throw new ControlError(
        'AMBIGUOUS_SERVER',
        'Both http://127.0.0.1:8780 and :8781 answered. Set ZCC_SERVER_URL to pick one.'
      );
    }
    if (prodOk) serverUrl = DEFAULT_PROD_URL;
    else if (devOk) serverUrl = DEFAULT_DEV_URL;
    else {
      throw new ControlError(
        'APP_NOT_RUNNING',
        'Zana Command Center is not running. Open the app (or pnpm dev) and retry.'
      );
    }
  }
  return {
    http: new ProductHttpClient(serverUrl, {
      fetchImpl,
      nowMs: opts.nowMs,
      sleep: opts.sleep
    }),
    serverUrl,
    dataDir: defaultDataDirFor(serverUrl, opts.dataDir),
    provider: opts.provider ?? 'live',
    isolated: false
  };
}
