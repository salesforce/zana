import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
// @ts-expect-error js-yaml has no bundled type declarations
import { load as loadYaml } from 'js-yaml';

const ROOT = resolve(__dirname, '../../../../../..');

describe('macOS microphone permission', () => {
  it('entitlements.mac.plist contains audio-input entitlement', () => {
    const plist = readFileSync(resolve(ROOT, 'resources/entitlements.mac.plist'), 'utf8');
    expect(plist).toContain('com.apple.security.device.audio-input');
  });

  it('entitlements.mac.inherit.plist contains audio-input entitlement', () => {
    const plist = readFileSync(resolve(ROOT, 'resources/entitlements.mac.inherit.plist'), 'utf8');
    expect(plist).toContain('com.apple.security.device.audio-input');
  });

  it('apps/desktop/electron-builder.yml has NSMicrophoneUsageDescription in extendInfo', () => {
    const raw = readFileSync(resolve(ROOT, 'apps/desktop/electron-builder.yml'), 'utf8');
    const config = loadYaml(raw) as Record<string, unknown>;
    const mac = config.mac as Record<string, unknown>;
    const extendInfo = mac.extendInfo as Record<string, string>;
    expect(extendInfo.NSMicrophoneUsageDescription).toContain('microphone');
  });
});
