import { readdirSync, readFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { writePluginRecoveryArtifacts } from './plugin-recovery-artifacts.mjs';

// electron-builder invokes this for every packaging path, including --dir.
export default async function beforePack(context) {
  const { preparePluginRuntime } = await tsImport('../packages/plugin-build/src/prepare-plugin-runtime.ts', import.meta.url);
  const root = context.packager.projectDir;
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  mkdirSync(join(root, 'out'), { recursive: true });
  const stage = mkdtempSync(join(root, 'out', '.packaged-plugins-'));
  try {
    for (const entry of readdirSync(join(root, 'plugins'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = join(root, 'plugins', entry.name);
      if (!existsSync(join(source, 'package.json'))) continue;
      const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
      if (!pkg.zcc) continue;
      console.log(`Preparing packaged plugin ${entry.name}`);
      await preparePluginRuntime(source, join(stage, entry.name), version);
    }
    const destination = join(root, 'out', 'packaged-plugins');
    rmSync(destination, { recursive: true, force: true });
    renameSync(stage, destination);
    await writePluginRecoveryArtifacts(destination, join(root, 'dist'), version,
      context.electronPlatformName ?? process.platform,
      ['ia32', 'x64', 'arm', 'arm64', 'universal'][context.arch] ?? process.arch);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
