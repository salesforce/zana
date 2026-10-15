/**
 * Official release builds must bake the public relay origin and its token
 * together. An origin without a token produces a packaged app whose pairing
 * relay can never attach.
 */

export interface RelayBakeInput {
  releaseBuild: boolean;
  appUrl: string;
  relayToken: string;
}

/** Only the release workflow sets ZCC_RELEASE_BUILD=1; local and E2E builds do not. */
export function isReleaseBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZCC_RELEASE_BUILD?.trim() === '1';
}

export function assertRelayBake({ releaseBuild, appUrl, relayToken }: RelayBakeInput): void {
  if (releaseBuild && appUrl.trim() && !relayToken.trim()) {
    throw new Error('Release build bakes ZCC_APP_URL without ZCC_RELAY_TOKEN; set both or neither');
  }
}
