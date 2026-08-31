/** Central site config — copy + env-driven endpoints, all in one place. */
export const site = {
  name: 'Zana Command Center',
  tagline: 'Run and orchestrate Claude Code, Cursor, OpenCode, Codex, and Pi sessions across every project from one window.',
  repo: 'https://github.com/salesforce/zana',
  /** PUBLIC release feed (github.com) — where the notarized artifacts +
   *  latest-mac.yml live and the auto-updater reads anonymously. */
  releasesRepo: 'https://github.com/salesforce/zana',
  /** Canonical README on the repo host — the docs "Getting started" links here
   *  rather than re-rendering a copy that drifts from the source. */
  readmeUrl: 'https://github.com/salesforce/zana/blob/main/README.md',
  /** Public plugin registry index.json (the same feed the app reads). */
  registryUrl: process.env.NEXT_PUBLIC_REGISTRY_URL,
  /** BB-shaped official plugin marketplace (pointers only). */
  marketplaceFeedPath: '/marketplace/v1/marketplace.json',
  /** electron-updater generic feed base (where latest-mac.yml + artifacts live). */
  updateFeedUrl: process.env.NEXT_PUBLIC_UPDATE_FEED_URL,
  /** Latest published app version (fallback when the feed is unreachable).
   *  Keep in sync with the current release when the update feed can't be read. */
  latestVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '2.0.2',
  /** Base URL this deployment is served from (`PUBLIC_BASE_URL`). Used by the
   *  dashboard publish snippet, the marketplace `zcc marketplace add` command,
   *  canonical URLs, robots, and sitemap. Server-only — pass into client
   *  components as a prop so a config change does not require a client rebuild. */
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:4321'
};

/**
 * True when this build's public base URL is still the localhost placeholder in
 * a PRODUCTION build — i.e. `PUBLIC_BASE_URL` was never set for the deploy.
 * Callers that emit crawler-facing absolute URLs (robots, sitemap) use this to
 * refuse indexing rather than publish `http://localhost:4321` links to search
 * engines. In dev, or in a correctly-configured prod deploy (https base), this
 * is always false and behavior is unchanged.
 */
export const isPlaceholderBaseUrl =
  process.env.NODE_ENV === 'production' && site.publicBaseUrl.startsWith('http://localhost');
