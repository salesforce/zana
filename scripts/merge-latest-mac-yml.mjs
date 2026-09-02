#!/usr/bin/env node
/**
 * Merge two per-arch electron-builder `latest-mac.yml` feeds into one.
 *
 * The Release workflow builds arm64 and x64 on separate runners; each
 * electron-builder invocation writes a feed that lists only that arch.
 * electron-updater clients read a single `latest-mac.yml`, so publishing
 * either file as-is points every Mac at one architecture.
 *
 * Usage: node scripts/merge-latest-mac-yml.mjs <a.yml> <b.yml> <out.yml>
 *
 * Fails if the versions differ, or if the merged `files:` list is missing
 * either `*-arm64.zip` or `*-x64.zip`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class MergeLatestMacYmlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MergeLatestMacYmlError';
  }
}

function die(msg) {
  throw new MergeLatestMacYmlError(msg);
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * @typedef {{ url: string, sha512: string, size: number }} FeedFile
 * @typedef {{ version: string, files: FeedFile[], path: string, sha512: string, releaseDate: string }} MacFeed
 */

/** @param {string} text @param {string} source */
export function parseLatestMacYml(text, source = 'latest-mac.yml') {
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!version) die(`${source}: missing version`);

  const path = /^path:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!path) die(`${source}: missing path`);

  const releaseDateRaw = /^releaseDate:\s*(.+)$/m.exec(text)?.[1];
  if (!releaseDateRaw) die(`${source}: missing releaseDate`);
  const releaseDate = unquote(releaseDateRaw);

  const files = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  let inFiles = false;
  for (const line of lines) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^[^\s]/.test(line)) {
      inFiles = false;
      if (current) files.push(current);
      current = null;
    }
    if (!inFiles) continue;
    const url = /^\s+- url:\s+(\S+)\s*$/.exec(line);
    if (url) {
      if (current) files.push(current);
      current = { url: url[1], sha512: '', size: 0 };
      continue;
    }
    if (!current) continue;
    const sha = /^\s+sha512:\s+(\S+)\s*$/.exec(line);
    if (sha) {
      current.sha512 = sha[1];
      continue;
    }
    const size = /^\s+size:\s+(\d+)\s*$/.exec(line);
    if (size) current.size = Number(size[1]);
  }
  if (current) files.push(current);

  if (files.length === 0) die(`${source}: no files: entries`);
  for (const file of files) {
    if (!file.sha512) die(`${source}: ${file.url} is missing sha512`);
    if (!file.size) die(`${source}: ${file.url} is missing size`);
  }

  // Top-level sha512 is the last `sha512:` that is not nested under files.
  // electron-builder emits it after the files block, same value as the zip.
  let topSha = '';
  inFiles = false;
  for (const line of lines) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles && /^[^\s]/.test(line)) inFiles = false;
    if (inFiles) continue;
    const sha = /^sha512:\s+(\S+)\s*$/.exec(line);
    if (sha) topSha = sha[1];
  }
  if (!topSha) die(`${source}: missing top-level sha512`);

  return { version, files, path, sha512: topSha, releaseDate };
}

/** @param {MacFeed} feed */
export function serializeLatestMacYml(feed) {
  const filesBlock = feed.files
    .map(
      (file) =>
        `  - url: ${file.url}\n    sha512: ${file.sha512}\n    size: ${file.size}`,
    )
    .join('\n');
  return [
    `version: ${feed.version}`,
    'files:',
    filesBlock,
    `path: ${feed.path}`,
    `sha512: ${feed.sha512}`,
    `releaseDate: '${feed.releaseDate}'`,
    '',
  ].join('\n');
}

function hasArchZip(files, arch) {
  const suffix = `-${arch}.zip`;
  return files.some((file) => file.url.endsWith(suffix));
}

/** @param {MacFeed} a @param {MacFeed} b */
export function mergeLatestMacFeeds(a, b) {
  if (a.version !== b.version) {
    die(`version mismatch: ${a.version} vs ${b.version}`);
  }

  const seen = new Set();
  const files = [];
  for (const file of [...a.files, ...b.files]) {
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    files.push(file);
  }
  files.sort((left, right) => left.url.localeCompare(right.url));

  if (!hasArchZip(files, 'arm64')) {
    die('merged feed is missing *-arm64.zip — Intel-only publish is not allowed');
  }
  if (!hasArchZip(files, 'x64')) {
    die('merged feed is missing *-x64.zip — arm64-only publish is not allowed');
  }

  const arm64Primary = hasArchZip(a.files, 'arm64') ? a : b;
  const releaseDate = a.releaseDate >= b.releaseDate ? a.releaseDate : b.releaseDate;

  return {
    version: a.version,
    files,
    path: arm64Primary.path,
    sha512: arm64Primary.sha512,
    releaseDate,
  };
}

export function mergeLatestMacYmlFiles(leftPath, rightPath, outPath) {
  const left = parseLatestMacYml(readFileSync(leftPath, 'utf8'), leftPath);
  const right = parseLatestMacYml(readFileSync(rightPath, 'utf8'), rightPath);
  const merged = mergeLatestMacFeeds(left, right);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serializeLatestMacYml(merged));
  return merged;
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const [left, right, out] = process.argv.slice(2);
  if (!left || !right || !out) {
    console.error('Usage: node scripts/merge-latest-mac-yml.mjs <a.yml> <b.yml> <out.yml>');
    process.exit(2);
  }
  try {
    const merged = mergeLatestMacYmlFiles(resolve(left), resolve(right), resolve(out));
    console.log(
      `merge-latest-mac-yml: ${merged.version} (${merged.files.length} files) → ${out}`,
    );
  } catch (error) {
    console.error(`merge-latest-mac-yml: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
