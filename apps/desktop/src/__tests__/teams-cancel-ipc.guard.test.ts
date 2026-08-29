import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const ipcSource = readSource('packages/desktop-contract/src/ipc.ts');
const preloadSource = readSource('apps/desktop/src/preload.ts');
const mainSource = readSource('apps/desktop/src/ipc/personas.ts');

describe('Team launch cancellation IPC', () => {
  it('accepts only launchRequestId from renderer and binds host-owned interactive authority', () => {
    expect(ipcSource).toContain("cancel: 'teams:cancel'");
    expect(preloadSource).toMatch(
      /cancel: \(launchRequestId\) => ipcRenderer\.invoke\(IPC\.teams\.cancel, launchRequestId\)/
    );
    expect(mainSource).toMatch(
      /IPC\.teams\.cancel,[\s\S]*async \(_e, launchRequestId: string\)[\s\S]*cancelTeamLaunch\('interactive:local', launchRequestId\)/
    );
  });
});
