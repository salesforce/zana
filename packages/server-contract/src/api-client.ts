/**
 * Thin re-export of the public API client helpers.
 * Canonical definitions live in `public-api.ts`.
 */
export {
  createApiClient,
  createPublicApiClient,
  type ApiClient,
  type PublicApiClientOptions,
  type PublicApiFetch,
} from "./public-api.js";
