/**
 * Main-process side of plugin deep links (`<scheme>://plugin/<id>/<route>?d=<payload>`).
 *
 * Main owns validation: every link, whether it came from the OS (argv /
 * `open-url`) or from a renderer paste, is parsed here with the strict
 * `parseDeepLink` before anything reaches a plugin. A link never performs an
 * action; it only asks the renderer to route (pluginId, route, payload).
 *
 * Links that arrive before the host is armed (cold start) are queued and
 * flushed in order once `arm()` runs.
 */
import {
  IPC,
  DEEP_LINK_KNOWN_SCHEMES,
  findDeepLinkInArgv,
  parseAnyDeepLink,
  type DeepLinkChannel,
  type DeepLinkConfig,
  type DeepLinkDelivery,
  type DeepLinkOpenResult
} from '@zana-ai/zcc-desktop-contract';

/** Bound on links held before the host is armed; the oldest is dropped. */
export const DEEP_LINK_PENDING_LIMIT = 8;

export interface DeepLinkHostDeps {
  channel: DeepLinkChannel;
  /** Route one validated link to the renderer. Rejection is logged, never thrown. */
  deliver(delivery: DeepLinkDelivery): Promise<void> | void;
  logError(scope: string, detail: unknown): void;
}

export interface DeepLinkHost {
  /** A link handed over by the OS: exact channel scheme only. Never throws. */
  submitOsLink(raw: unknown): boolean;
  /** Links in a second-instance / initial argv. Returns whether one was accepted. */
  submitArgv(argv: readonly unknown[]): boolean;
  /** A link pasted into the app: every known scheme. Resolves once handed to delivery. */
  open(raw: unknown): Promise<DeepLinkOpenResult>;
  config(): DeepLinkConfig;
  /** Start delivering; flush anything queued before this point. */
  arm(): void;
  pendingCount(): number;
}

export function createDeepLinkHost(deps: DeepLinkHostDeps): DeepLinkHost {
  const pending: DeepLinkDelivery[] = [];
  const pasteSchemes = [...new Set([...DEEP_LINK_KNOWN_SCHEMES, ...deps.channel.acceptSchemes])];
  let armed = false;
  let chain: Promise<void> = Promise.resolve();

  const send = (delivery: DeepLinkDelivery): Promise<void> => {
    chain = chain.then(async () => {
      try {
        await deps.deliver(delivery);
      } catch (error) {
        deps.logError('deepLink.deliver', error);
      }
    });
    return chain;
  };

  const route = (delivery: DeepLinkDelivery): Promise<void> => {
    if (armed) return send(delivery);
    pending.push(delivery);
    while (pending.length > DEEP_LINK_PENDING_LIMIT) pending.shift();
    return Promise.resolve();
  };

  const submitOsLink = (raw: unknown): boolean => {
    const parsed = parseAnyDeepLink(raw, { acceptSchemes: deps.channel.acceptSchemes });
    if (!parsed.ok) {
      deps.logError('deepLink.rejected', parsed.reason);
      return false;
    }
    const { pluginId, route: linkRoute, payload } = parsed.link;
    void route({ pluginId, route: linkRoute, payload });
    return true;
  };

  return {
    submitOsLink,
    submitArgv(argv) {
      const link = findDeepLinkInArgv(Array.isArray(argv) ? argv : [], deps.channel.acceptSchemes);
      return link === null ? false : submitOsLink(link);
    },
    async open(raw) {
      const parsed = parseAnyDeepLink(raw, { acceptSchemes: pasteSchemes });
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      const { pluginId, route: linkRoute, payload } = parsed.link;
      await route({ pluginId, route: linkRoute, payload });
      return { ok: true, pluginId, route: linkRoute };
    },
    config() {
      return { base: deps.channel.base, acceptSchemes: pasteSchemes };
    },
    arm() {
      if (armed) return;
      armed = true;
      for (const delivery of pending.splice(0)) void send(delivery);
    },
    pendingCount: () => pending.length
  };
}

export interface RegisterDeepLinkSchemeInput {
  channel: DeepLinkChannel;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  execPath: string;
  /** Script argument of an unpackaged Electron (`process.argv[1]`). */
  appEntry: string | undefined;
  setAsDefaultProtocolClient(scheme: string, execPath?: string, args?: string[]): boolean;
  log(message: string): void;
}

export type RegisterDeepLinkSchemeResult =
  | 'registered'
  | 'skipped-e2e'
  | 'skipped-no-scheme'
  | 'skipped-not-enabled'
  | 'skipped-mac-dev'
  | 'skipped-no-entry'
  | 'failed';

/**
 * Register this channel's scheme with the OS. Packaged builds register the
 * prod scheme; dev only with `ZCC_REGISTER_DEV_PROTOCOL=1` (Windows/Linux, via
 * execPath + script; macOS resolves handlers from the app bundle, so an
 * unpackaged dev Electron cannot own a scheme there). E2E never registers.
 */
export function registerDeepLinkScheme(input: RegisterDeepLinkSchemeInput): RegisterDeepLinkSchemeResult {
  if (input.env.ZCC_E2E_HOME) return 'skipped-e2e';
  const { scheme, registerWithOs } = input.channel;
  if (!scheme) return 'skipped-no-scheme';
  if (!registerWithOs) return 'skipped-not-enabled';
  if (input.isPackaged) return input.setAsDefaultProtocolClient(scheme) ? 'registered' : 'failed';
  if (input.platform === 'darwin') {
    input.log(`deep links: ${scheme}:// cannot be registered from an unpackaged macOS build; use a packaged app or pnpm dev:open-link`);
    return 'skipped-mac-dev';
  }
  if (!input.appEntry) return 'skipped-no-entry';
  return input.setAsDefaultProtocolClient(scheme, input.execPath, [input.appEntry]) ? 'registered' : 'failed';
}

/** Whether this process should hold the single-instance lock. */
export function wantsSingleInstanceLock(input: {
  isPackaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
}): boolean {
  if (input.isPackaged) return true;
  // Unpackaged: only an isolated dev data dir (userData pinned under it), never E2E.
  return !input.env.ZCC_E2E_HOME && Boolean(input.env.ZCC_DATA_DIR?.trim());
}

type SafeHandleFromWindow = <TArgs extends unknown[], TResult>(
  channel: string,
  handler: (win: unknown, ...args: TArgs) => TResult | Promise<TResult>,
  onError: (err: unknown, ...args: TArgs) => TResult
) => void;

/** Renderer requests, handled through the trusted-renderer-URL gate; main re-validates every link. */
export function registerDeepLinkIpc(handle: SafeHandleFromWindow, host: DeepLinkHost): void {
  handle(IPC.deepLinks.config, () => host.config(), () => ({ base: null, acceptSchemes: [] }) as DeepLinkConfig);
  handle(
    IPC.deepLinks.open,
    (_win, raw: unknown) => host.open(raw),
    (_err, _raw: unknown): DeepLinkOpenResult => ({ ok: false, reason: 'unavailable' })
  );
}
