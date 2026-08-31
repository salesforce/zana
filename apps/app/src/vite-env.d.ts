/// <reference types="vite/client" />
import type {} from '@zana-ai/zcc-desktop-contract';

// The `import type {}` above makes this file a module, so a bare `declare
// const` would be scoped to this module instead of ambient — wrap it in
// `declare global` so `__ZCC_DEV_WS_PORT__` stays visible repo-wide.
declare global {
  const __ZCC_DEV_WS_PORT__: number | undefined;
}

interface ImportMetaEnv {
}
