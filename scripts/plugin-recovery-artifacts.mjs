import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

/** Publish exactly the compiled runtime shipped by this platform's packager. */
export async function writePluginRecoveryArtifacts(root, output, version, platform = process.platform, arch = process.arch) {
  const plugins = [];
  await mkdir(output, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    const id = pkg.name.replace(/^@[^/]+\//, '').replace(/^zcc-plugin-/, '');
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) throw new Error('Invalid recovery plugin identity');
    const files = [];
    let bytes = 0;
    async function visit(path = '', depth = 0) {
      if (depth > 32) throw new Error('Recovery runtime exceeds depth limit');
      for (const child of await readdir(join(directory, path))) {
        const relative = path ? `${path}/${child}` : child;
        const stat = await lstat(join(directory, relative));
        if (stat.isSymbolicLink()) throw new Error('Recovery runtime contains a symlink');
        if (stat.isDirectory()) { await visit(relative, depth + 1); continue; }
        bytes += stat.size;
        if (!stat.isFile() || bytes > 64 * 1024 * 1024 || files.length >= 10_000) throw new Error('Recovery runtime exceeds file limits');
        files.push({ path: relative, base64: (await readFile(join(directory, relative))).toString('base64'), executable: Boolean(stat.mode & 0o111) });
      }
    }
    await visit();
    const payload = await promisify(gzip)(JSON.stringify({ version: 1, id, files }));
    const file = `plugin-recovery-${version}-${platform}-${arch}-${id}.json.gz`;
    await writeFile(join(output, file), payload);
    plugins.push({ id, file, sha256: createHash('sha256').update(payload).digest('hex') });
  }
  const file = `plugin-recovery-${platform}-${arch}.json`;
  await writeFile(join(output, file), JSON.stringify({ version: 1, zccVersion: version, plugins }));
}
