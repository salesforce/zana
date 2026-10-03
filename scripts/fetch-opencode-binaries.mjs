#!/usr/bin/env node
/**
 * Stage the embedded `opencode` binaries used by the OpenCode terminal profile
 * (see `src/main/env.ts` `resolveOpencodeBinDir`).
 *
 * opencode ships as per-platform/arch compiled binaries via npm
 * `optionalDependencies` on `opencode-ai` (e.g. `opencode-darwin-arm64`,
 * `opencode-darwin-x64`) — each package is just `package.json` + a single
 * `bin/opencode` executable, no separate runtime to bundle (verified by
 * inspecting the real tarball). Stage both macOS arches on Mac, and the native
 * arch on Windows/Linux. Windows packages contain bin/opencode.exe.
 *
 * Fetches the tarball directly from registry.npmjs.org via plain HTTPS rather
 * than `npm pack`/`npm install` — this workspace's npm is configured against a
 * corporate proxy (nexus-proxy) that does not mirror every upstream version,
 * so `npm pack opencode-darwin-arm64@<version>` can fail with ETARGET even
 * with an explicit --registry flag. A direct tarball fetch bypasses that.
 * Extraction shells out to the system `tar` (present on every mac/Linux CI
 * runner, including Windows) rather than adding a build-time-only
 * script.
 *
 * Output: vendor/opencode/<arch>/opencode[.exe] (executable), consumed by
 * electron-builder.yml's extraResources entry (vendor/opencode -> opencode).
 * afterPack then deletes the unused arch so each artifact ships one binary.
 */
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, chmodSync, copyFileSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

// Pin to the EXACT version the permission-event probe ran against
// (.zcc/library/findings/opencode-permission-event-probe-2026-07-30.md), not
// just "recent" — the opencode monorepo (checked at HEAD 0b4edfc, v1.18.7) is
// mid-migration onto a `/api/*` v2 surface (see its `V1_API_MIGRATION.md`);
// the legacy `/session/:id/message`, `/event`, and `permission.asked` contract
// this backend depends on is unmigrated there but not guaranteed stable
// across releases. Bump this only after re-running the probe against the new
// version and confirming the legacy contract still holds.
export const OPENCODE_VERSION = '1.18.4';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = join(repoRoot, 'vendor', 'opencode');

export function binaryTargets(platform = process.platform, arch = process.arch) {
  const packagePlatform = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[platform];
  if (!packagePlatform || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported OpenCode build platform: ${platform}-${arch}`);
  }
  const arches = platform === 'darwin' ? ['arm64', 'x64'] : [arch];
  return arches.map(targetArch => ({
    arch: targetArch,
    pkg: `opencode-${packagePlatform}-${targetArch}`,
    binary: platform === 'win32' ? 'opencode.exe' : 'opencode'
  }));
}

export async function fetchBinary({ arch, pkg, binary }, {
  root = vendorRoot,
  fetchImpl = fetch,
  extract = execFileSync
} = {}) {
  const url = `https://registry.npmjs.org/${pkg}/-/${pkg}-${OPENCODE_VERSION}.tgz`;
  const outDir = join(root, arch);
  const outBin = join(outDir, binary);
  const marker = join(outDir, '.version');
  const identity = `${pkg}@${OPENCODE_VERSION}`;

  if (existsSync(outBin) && existsSync(marker) && readFileSync(marker, 'utf8') === identity) {
    console.log(`[fetch-opencode-binaries] ${arch}: already staged, skipping`);
    return;
  }

  console.log(`[fetch-opencode-binaries] ${arch}: downloading ${url}`);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`${pkg}@${OPENCODE_VERSION}: HTTP ${res.status} fetching ${url}`);
  }

  const stage = mkdtempSync(join(tmpdir(), `${pkg}-`));
  const tmpTarball = join(stage, 'download.tgz');
  const extractDir = join(stage, 'extract');
  const pendingBin = join(outDir, `.${basename(stage)}.tmp`);
  const pendingMarker = `${pendingBin}.version`;
  try {
    const download = createWriteStream(tmpTarball);
    const closed = new Promise(resolve => download.once('close', resolve));
    try {
      await pipeline(res.body, download);
    } finally {
      // An already-failed web stream can reject pipeline while the destination
      // is still opening its file. Wait for close before removing the stage.
      download.destroy();
      await closed;
    }
    mkdirSync(extractDir);
    extract('tar', ['-xzf', tmpTarball, '-C', extractDir]);
    const extractedBin = join(extractDir, 'package', 'bin', binary);
    if (!existsSync(extractedBin)) {
      throw new Error(`${pkg}@${OPENCODE_VERSION}: tarball had no package/bin/${binary} entry`);
    }
    mkdirSync(outDir, { recursive: true });
    // TEMP can be on another Windows drive. Copy, then rename on the output
    // volume; renaming directly from the extraction directory would fail EXDEV.
    copyFileSync(extractedBin, pendingBin);
    chmodSync(pendingBin, 0o755);
    renameSync(pendingBin, outBin);
    writeFileSync(pendingMarker, identity);
    renameSync(pendingMarker, marker);
    console.log(`[fetch-opencode-binaries] ${arch}: staged ${outBin}`);
  } finally {
    rmSync(pendingBin, { force: true });
    rmSync(pendingMarker, { force: true });
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const target of binaryTargets()) await fetchBinary(target);
}
