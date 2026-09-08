/** Loopback product HTTP port. Override with `ZCC_SERVER_PORT`. */
export const DEFAULT_SERVER_PORT = 8780;

/**
 * Product HTTP port used by `pnpm dev` when `ZCC_SERVER_PORT` is unset.
 * Distinct from {@link DEFAULT_SERVER_PORT} so the unpackaged stack does not
 * bind the same loopback port as a leftover listen.ts or docs default.
 */
export const DEFAULT_DEV_SERVER_PORT = 8781;

/** Folder name under HOME for the isolated `pnpm dev` data dir (`~/.zcc-dev`). */
export const DEFAULT_DEV_DATA_DIR_NAME = '.zcc-dev';

/** Vite / electron-vite renderer port in development. */
export const DEFAULT_DEV_APP_PORT = 5173;

export function serverPortFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ZCC_SERVER_PORT;
  if (raw && /^\d+$/.test(raw)) {
    const port = Number(raw);
    if (port > 0 && port < 65536) return port;
  }
  return DEFAULT_SERVER_PORT;
}

export function devAppPortFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ZCC_DEV_APP_PORT ?? env.ELECTRON_RENDERER_URL;
  if (raw && /^\d+$/.test(raw)) {
    const port = Number(raw);
    if (port > 0 && port < 65536) return port;
  }
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.port) {
        const port = Number(url.port);
        if (port > 0 && port < 65536) return port;
      }
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_DEV_APP_PORT;
}
