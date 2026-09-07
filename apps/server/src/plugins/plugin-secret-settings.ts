import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deleteSecretFile, writeSecretFile } from '@zana-ai/zcc-secret-storage';
import type { PluginSettingDescriptor, PluginSettingValue } from '@zana-ai/zcc-plugin-sdk/server';

export function isSecretSetting(descriptor: PluginSettingDescriptor | undefined): boolean {
  return descriptor?.type === 'string' && descriptor.secret === true;
}

export function pluginSecretsDir(kvDir: string): string {
  return join(kvDir, 'secrets');
}

export function pluginSecretFilePath(kvDir: string, key: string): string {
  return join(pluginSecretsDir(kvDir), `${key}.txt`);
}

export function readSecretSettingSync(kvDir: string, key: string): string | undefined {
  try {
    const value = readFileSync(pluginSecretFilePath(kvDir, key), 'utf8').trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function mergeSecretSettings(
  kvDir: string,
  descriptors: Record<string, PluginSettingDescriptor>,
  stored: Record<string, PluginSettingValue | undefined>
): Record<string, PluginSettingValue | undefined> {
  const next = { ...stored };
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!isSecretSetting(descriptor)) continue;
    const fromFile = readSecretSettingSync(kvDir, key);
    if (fromFile !== undefined) {
      next[key] = fromFile;
    }
  }
  return next;
}

export function publicSettingsValues(
  descriptors: Record<string, PluginSettingDescriptor>,
  values: Record<string, PluginSettingValue | undefined>
): Record<string, PluginSettingValue | undefined> {
  const next: Record<string, PluginSettingValue | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isSecretSetting(descriptors[key])) continue;
    next[key] = value;
  }
  return next;
}

export async function persistSecretSettings(
  kvDir: string,
  descriptors: Record<string, PluginSettingDescriptor>,
  values: Record<string, PluginSettingValue | undefined>
): Promise<void> {
  mkdirSync(pluginSecretsDir(kvDir), { recursive: true, mode: 0o700 });
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!isSecretSetting(descriptor)) continue;
    const value = values[key];
    const path = pluginSecretFilePath(kvDir, key);
    if (typeof value !== 'string' || value.length === 0) {
      if (existsSync(path)) await deleteSecretFile(path);
      continue;
    }
    await writeSecretFile(path, `${value}\n`);
  }
}
