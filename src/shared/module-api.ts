/**
 * Re-export shim. The extension contract now lives in the published SDK
 * package (`@zana-ai/zcc-extension-sdk`); this file keeps core's existing
 * `@shared/module-api` imports working unchanged. New code should import
 * from `@zana-ai/zcc-extension-sdk/renderer` directly.
 */

export type { AppModule, ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
