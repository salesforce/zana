import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PLUGIN_SDK_VERSION } from '@zana-ai/zcc-plugin-sdk';
import { pluginScaffoldFileMap, type PluginScaffoldFiles } from './files.js';
import {
  clampPluginStarterKind,
  pluginPackageName,
  type PluginStarterKind
} from './kinds.js';

export interface ScaffoldPluginArgs {
  targetDir: string;
  /** Human title shown in the hub. */
  name: string;
  /** Derived plugin id (no `zcc-plugin-` prefix). */
  id: string;
  description?: string;
  kind?: PluginStarterKind | string;
  zccVersion?: string;
  pluginSdkVersion?: string;
  /** When false, skip files that already exist. Default true (never clobber). */
  skipExisting?: boolean;
}

export interface ScaffoldPluginResult {
  id: string;
  packageName: string;
  files: string[];
}

async function writeIfAbsent(file: string, contents: string, skipExisting: boolean): Promise<boolean> {
  if (skipExisting && existsSync(file)) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
  return true;
}

export async function scaffoldPlugin(args: ScaffoldPluginArgs): Promise<ScaffoldPluginResult> {
  const kind = clampPluginStarterKind(args.kind);
  const opts: PluginScaffoldFiles = {
    id: args.id,
    name: args.name,
    description: args.description || `${args.name} plugin`,
    kind,
    zccVersion: args.zccVersion ?? '1.0.0',
    pluginSdkVersion: args.pluginSdkVersion ?? PLUGIN_SDK_VERSION
  };
  const files = pluginScaffoldFileMap(opts);
  const skipExisting = args.skipExisting !== false;
  const written: string[] = [];
  for (const [rel, contents] of Object.entries(files)) {
    const dest = join(args.targetDir, rel);
    if (await writeIfAbsent(dest, contents, skipExisting)) written.push(rel);
  }
  return {
    id: args.id,
    packageName: pluginPackageName(args.id),
    files: written
  };
}

export { pluginScaffoldFileMap } from './files.js';
export {
  PLUGIN_STARTER_KINDS,
  VALID_PLUGIN_STARTER_KINDS,
  clampPluginStarterKind,
  pluginPackageName,
  type PluginStarterKind
} from './kinds.js';
