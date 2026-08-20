/**
 * Server entrypoint. Domain service migration lands here incrementally; Electron
 * main remains the compatibility host until each capability has a tested server
 * adapter. This package must never trust renderer or daemon-supplied paths.
 */
export const SERVER_PROTOCOL_VERSION = 1;

export * from './static-host.js';
export * from './execution-service.js';
export * from './project-store.js';
export * from './terminal-execution-service.js';
export * from './terminal-session-service.js';
export * from './durable-store.js';
