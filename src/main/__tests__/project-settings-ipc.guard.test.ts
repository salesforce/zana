import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('project settings IPC failure handling', () => {
  it('keeps reads safe but lets mutation failures reject', () => {
    expect(source).toMatch(/safeHandle\(\s*IPC\.projectSettings\.get,[\s\S]*?\(\) => \(\{\} as ProjectSettings\)\s*\);/);
    expect(source).toMatch(/ipcMain\.handle\(IPC\.projectSettings\.set,[\s\S]*?runtimeSupervisor\s*\? runtimeSupervisor\.setProjectSettings\(id, patch\)[\s\S]*?: store\.setProjectSettings\(id, patch\)\s*\);/);
    expect(source).not.toMatch(/safeHandle[^;]*IPC\.projectSettings\.set/);
  });
});
