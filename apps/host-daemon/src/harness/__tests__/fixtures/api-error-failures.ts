import type { ApiErrorFailureFixture } from './api-error-fixture-types.js';
import { codexFixture } from './codex-api-error.js';
import { openCodeFixture } from './opencode-api-error.js';
import { piFixture } from './pi-api-error.js';

export type { ApiErrorFailureFixture } from './api-error-fixture-types.js';

/** One entry per harness; each harness adds its own fixture file and one line here. */
export const API_ERROR_FAILURE_FIXTURES: Readonly<Record<string, () => ApiErrorFailureFixture>> = {
  codex: codexFixture,
  opencode: openCodeFixture,
  pi: piFixture
};
