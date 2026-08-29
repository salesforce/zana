import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'apps/desktop/src/host.ts'), 'utf8');

describe('startup repair IPC', () => {
  it('keeps every repair action main-side and gated on repair-required state', () => {
    expect(source).toMatch(/ipcMain\.handle\(IPC\.startup\.retry,[\s\S]*startupState\.mode !== 'repair-required'/);
    expect(source).toMatch(/ipcMain\.handle\(IPC\.startup\.diagnostics,[\s\S]*startupState\.mode !== 'repair-required'/);
    expect(source).toMatch(/ipcMain\.handle\(IPC\.startup\.quit,[\s\S]*startupState\.mode === 'repair-required'/);
  });

  it('opens a repair-only window without reading persisted window bounds', () => {
    expect(source).toContain('const saved = projectId || repairOnly ? undefined : config.windowBounds;');
    expect(source).toContain('projectId || repairOnly ? undefined : config.windowMaximized');
    expect(source).toContain('createWindow(undefined, true)');
    expect(source).toContain("createWindow(undefined, startupState.mode === 'repair-required')");
  });

  it('prevents concurrent retry success from bootstrapping normal services twice', () => {
    expect(source).toMatch(/function bootstrapNormal\(\) \{\s+if \(normalBootstrapStarted\) return;\s+normalBootstrapStarted = true;/);
  });
});
