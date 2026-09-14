import type { PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';

export type PluginSettingDescriptor = PluginSettingsSnapshot['descriptors'][string];
export type PluginSettingValue = PluginSettingsSnapshot['values'][string];
export type PluginSettingDraft = string | boolean;
export type PluginSettingControlPlacement = 'inline' | 'below';

export const MULTILINE_MIN_ROWS = 6;
export const MULTILINE_MAX_ROWS = 24;

export function isMultilinePluginSetting(descriptor: PluginSettingDescriptor): boolean {
  return descriptor.type === 'string' && descriptor.multiline === true && descriptor.secret !== true;
}

export function pluginSettingControlPlacement(
  descriptor: PluginSettingDescriptor
): PluginSettingControlPlacement {
  return isMultilinePluginSetting(descriptor) ? 'below' : 'inline';
}

export function multilineSettingRows(value: string): number {
  const lines = value.split('\n').length;
  return Math.min(MULTILINE_MAX_ROWS, Math.max(MULTILINE_MIN_ROWS, lines + 1));
}

export function pluginSettingSavesOnChange(descriptor: PluginSettingDescriptor): boolean {
  return descriptor.type === 'boolean' || descriptor.type === 'select' || descriptor.type === 'project';
}

export function initialPluginSettingDraft(
  descriptor: PluginSettingDescriptor,
  storedValue: PluginSettingValue
): PluginSettingDraft {
  if (descriptor.type === 'boolean') return storedValue === true;
  if (descriptor.type === 'number') return typeof storedValue === 'number' ? String(storedValue) : '';
  if (descriptor.type === 'string' && descriptor.secret === true) return '';
  return typeof storedValue === 'string' ? storedValue : '';
}

export function parsePluginSettingDraft(
  descriptor: PluginSettingDescriptor,
  draft: PluginSettingDraft
): string | number | boolean | undefined {
  if (descriptor.type === 'boolean') return draft === true;
  if (descriptor.type === 'number') {
    const trimmed = typeof draft === 'string' ? draft.trim() : '';
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) throw new Error('Enter a finite number');
    return parsed;
  }
  return typeof draft === 'string' ? draft : '';
}

export function shouldSkipPluginSettingSave(
  descriptor: PluginSettingDescriptor,
  draft: PluginSettingDraft,
  storedValue: PluginSettingValue
): boolean {
  if (descriptor.type === 'string' && descriptor.secret === true && draft === '') return true;
  if (descriptor.type === 'number') {
    const trimmed = typeof draft === 'string' ? draft.trim() : '';
    if (trimmed.length === 0) return storedValue === undefined;
    return Number(trimmed) === storedValue;
  }
  return draft === storedValue;
}
