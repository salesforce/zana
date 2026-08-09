/**
 * Zod schemas for the publish request body (design §5):
 * `POST /api/extensions/:id/releases` accepts EITHER a decoded file-bundle
 * (`{ archive: { files: { "<name>": "<base64>" } } }`) — the shape a browser
 * or app can build without touching `publish-extension.mjs`'s archive
 * format directly — OR the fully-formed archive bytes, base64-encoded
 * (`{ archiveBase64: "<base64 of the {files:…} JSON>" }`), for CLI parity
 * with `scripts/publish-extension.mjs`'s own output.
 *
 * Deliberately small and reusable: this module only validates SHAPE (are the
 * right keys present, are they strings). Byte-level rules (path-escape names,
 * `extension.json` presence, the 16 MiB cap, manifest field types) live in
 * `lib/publish.ts`, which re-runs the engine's exact `decodeArchive` rules
 * over the derived canonical bytes — those rules can't be expressed in zod
 * alone (they depend on base64-decoded content, not just JSON shape).
 */
import { z } from 'zod';

/** `{ archive: { files: { "<name>": "<base64>" } } }` — a decoded file map. */
export const ArchiveFilesBody = z.object({
  archive: z.object({
    files: z.record(z.string(), z.string())
  })
});

/** `{ archiveBase64: "<base64>" }` — the full archive bytes, base64-encoded. */
export const ArchiveBase64Body = z.object({
  archiveBase64: z.string().min(1)
});

/** The publish request body accepts exactly one of the two shapes above. */
export const PublishRequestBodySchema = z.union([ArchiveFilesBody, ArchiveBase64Body]);

export type PublishRequestBody = z.infer<typeof PublishRequestBodySchema>;
