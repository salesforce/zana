/**
 * Re-export shim. `unwrapBareFence` now lives in the extension SDK
 * (`@zana-ai/zcc-extension-sdk/helpers`) so extensions and core share one
 * implementation. Core callers keep importing from here unchanged.
 */

export { unwrapBareFence } from '@zana-ai/zcc-extension-sdk/helpers';
