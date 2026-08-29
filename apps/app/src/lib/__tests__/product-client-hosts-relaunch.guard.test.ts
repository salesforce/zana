import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('product-client hosts.relaunchLocal', () => {
  it('prefers the desktop host-utility IPC over loopback HTTP steal', () => {
    const source = readFileSync(new URL('../product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain("name === 'hosts'");
    expect(source).toContain('relaunchLocal');
    expect(source).toContain("'/hosts/relaunch-local'");
    const hostsStart = source.indexOf("if (name === 'hosts')");
    const hostsBlock = source.slice(hostsStart, source.indexOf("if (name === 'threads'", hostsStart));
    expect(hostsBlock).toContain('hasDesktopBridge()');
    expect(hostsBlock).toContain('desktop?.relaunchLocal');
  });
});
