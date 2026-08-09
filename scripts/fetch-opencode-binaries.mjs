#!/usr/bin/env node
/**
 * Stage the embedded `opencode` binaries used by the OpenCode terminal profile
 * (see `src/main/env.ts` `resolveOpencodeBinDir`).
 *
 * opencode ships as per-platform/arch compiled binaries via npm
 * `optionalDependencies` on `opencode-ai` (e.g. `opencode-darwin-arm64`,
 * `opencode-darwin-x64`) — each package is just `package.json` + a single
 * `bin/opencode` executable, no separate runtime to bundle (verified by
 * inspecting the real tarball). This app's release CI is mac-only
 * (.github/workflows/release.yml), so only the two mac arches are staged here.
 *
 * Fetches the tarball directly from registry.npmjs.org via plain HTTPS rather
 * than `npm pack`/`npm install` — this workspace's npm is configured against a
 * corporate proxy (nexus-proxy) that does not mirror every upstream version,
 * so `npm pack opencode-darwin-arm64@<version>` can fail with ETARGET even
 * with an explicit --registry flag. A direct tarball fetch bypasses that.
 * Extraction shells out to the system `tar` (present on every mac/Linux CI
 * runner) rather than pulling in a new npm dependency for a build-time-only
 * script.
 *
 * Output: vendor/opencode/<arch>/opencode (executable), consumed by
 * electron-builder.yml's extraResources entry (vendor/opencode -> opencode).
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync, rmSync, renameSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Pin to the EXACT version the permission-event probe ran against
// (.zcc/library/findings/opencode-permission-event-probe-2026-07-30.md), not
// just "recent" — the opencode monorepo (checked at HEAD 0b4edfc, v1.18.7) is
// mid-migration onto a `/api/*` v2 surface (see its `V1_API_MIGRATION.md`);
// the legacy `/session/:id/message`, `/event`, and `permission.asked` contract
// this backend depends on is unmigrated there but not guaranteed stable
// across releases. Bump this only after re-running the probe against the new
// version and confirming the legacy contract still holds.
const OPENCODE_VERSION = '1.18.4';

const ARCHES = ['arm64', 'x64'];
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = join(repoRoot, 'vendor', 'opencode');

async function fetchBinary(arch) {
  const pkg = `opencode-darwin-${arch}`;
  const url = `https://registry.npmjs.org/${pkg}/-/${pkg}-${OPENCODE_VERSION}.tgz`;
  const outDir = join(vendorRoot, arch);
  const outBin = join(outDir, 'opencode');

  if (existsSync(outBin)) {
    console.log(`[fetch-opencode-binaries] ${arch}: already staged, skipping`);
    return;
  }

  console.log(`[fetch-opencode-binaries] ${arch}: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${pkg}@${OPENCODE_VERSION}: HTTP ${res.status} fetching ${url}`);
  }

  const tmpTarball = join(tmpdir(), `${pkg}-${OPENCODE_VERSION}-${process.pid}.tgz`);
  await pipeline(res.body, createWriteStream(tmpTarball));

  const extractDir = join(tmpdir(), `${pkg}-${OPENCODE_VERSION}-${process.pid}-extract`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  try {
    execFileSync('tar', ['-xzf', tmpTarball, '-C', extractDir]);
    const extractedBin = join(extractDir, 'package', 'bin', 'opencode');
    if (!existsSync(extractedBin)) {
      throw new Error(`${pkg}@${OPENCODE_VERSION}: tarball had no package/bin/opencode entry`);
    }
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    renameSync(extractedBin, outBin);
    chmodSync(outBin, 0o755);
    console.log(`[fetch-opencode-binaries] ${arch}: staged ${outBin}`);
  } finally {
    rmSync(tmpTarball, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

for (const arch of ARCHES) {
  await fetchBinary(arch);
}
