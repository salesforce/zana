/**
 * Official release builds should bake the public relay origin and its token
 * together. An origin without a token produces a packaged app whose legacy
 * pairing relay can never attach; pairing then uses the SSH tunnel. Until the
 * legacy relay is removed (docs/legacy-relay-removal-plan.md) this is a warning,
 * not a build failure.
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

/** The warning for a release build that bakes an origin without a token, or null. */
export function relayBakeWarning({ releaseBuild, appUrl, relayToken }: RelayBakeInput): string | null {
  if (releaseBuild && appUrl.trim() && !relayToken.trim()) {
    return 'Release build bakes ZCC_APP_URL without ZCC_RELAY_TOKEN; the legacy pairing relay stays off and machine pairing uses the SSH tunnel';
  }
  return null;
}
