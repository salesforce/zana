export interface LocalAppOriginArgs {
  serverPort: number;
  devAppPort?: number;
  appUrl?: string;
}

/**
 * Origins a loopback browser may send as `Origin` when talking to the product
 * HTTP API. Only local app surfaces (the renderer origin and the server
 * origin) are listed — never a public host.
 */
export function buildLocalAppOrigins(args: LocalAppOriginArgs): Set<string> {
  const origins = new Set<string>([
    `http://127.0.0.1:${args.serverPort}`,
    `http://localhost:${args.serverPort}`
  ]);
  if (args.devAppPort !== undefined) {
    origins.add(`http://127.0.0.1:${args.devAppPort}`);
    origins.add(`http://localhost:${args.devAppPort}`);
  }
  if (args.appUrl) {
    try {
      origins.add(new URL(args.appUrl).origin);
    } catch {
      /* ignore malformed override */
    }
  }
  return origins;
}
