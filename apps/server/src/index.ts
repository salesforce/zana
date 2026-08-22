/**
 * Server entrypoint. Domain service migration lands here incrementally; Electron
 * main remains the compatibility host until each capability has a tested server
 * adapter. This package must never trust renderer or daemon-supplied paths.
 */
export const SERVER_PROTOCOL_VERSION = 1;

export * from './static-host.js';
export * from './browser-bootstrap.js';
export * from './execution-service.js';
export * from './project-store.js';
export * from './terminal-execution-service.js';
export * from './terminal-session-service.js';
export * from './durable-store.js';
export * from './plugins/plugin-service.js';
export * from './plugins/plugin-store.js';
export * from './plugins/builtin-registry.js';
export * from './plugins/marketplace.js';
export * from './plugins/marketplace-store.js';
export * from './services/inbox/inbox-store.js';
export * from './services/inbox/inbox-summary.js';
export * from './services/feed/feed-store.js';
export * from './services/saved/saved-store.js';
export * from './services/suggestions/suggestions-store.js';
export * from './services/agents/agent-registry-store.js';
export * from './services/mcp/mcp-port-store.js';
export * from './services/config/config-store.js';
