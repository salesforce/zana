import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectSettingsStore } from '../project-settings-store.js';
import { createProductHttpContext, type ProductHttpContext } from './product-context.js';

const roots: string[] = [];
const contexts: ProductHttpContext[] = [];
const make = (extra: Partial<Parameters<typeof createProductHttpContext>[0]> = {}, dir?: string) => {
  const dataDir = dir ?? mkdtempSync(join(tmpdir(), 'zcc-ctx-ps-'));
  if (!dir) roots.push(dataDir);
  const ctx = createProductHttpContext({ dataDir, origins: { serverPort: 0 }, ...extra });
  contexts.push(ctx);
  return { ctx, dataDir };
};

afterEach(async () => {
  for (const ctx of contexts.splice(0)) { ctx.hostHub.close(); ctx.dispose(); await ctx.whenIdle(); ctx.db.close(); }
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('product context projectSettings', () => {
  it('defaults to a store backed by project-settings.json in the data dir', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-ctx-ps-'));
    roots.push(dataDir);
    const file = join(dataDir, 'project-settings.json');
    writeFileSync(file, JSON.stringify({ p1: { model: 'opus' } }));
    const { ctx } = make({}, dataDir);
    const expected = createProjectSettingsStore({ projectSettingsFile: file }).get('p1');
    expect(ctx.projectSettings.get('p1')).toEqual(expected);
    expect(ctx.projectSettings.get('p1')).toMatchObject({ model: 'opus' });
    expect(ctx.projectSettings.get('missing')).toEqual(createProjectSettingsStore({ projectSettingsFile: file }).get('missing'));
  });

  it('uses an injected projectSettings store as-is', () => {
    const injected = { get: vi.fn(() => ({ marker: 'injected' })) };
    const { ctx } = make({ projectSettings: injected as never });
    expect(ctx.projectSettings).toBe(injected);
    expect(ctx.projectSettings.get('p1')).toEqual({ marker: 'injected' });
    expect(injected.get).toHaveBeenCalledWith('p1');
  });
});
