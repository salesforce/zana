import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectDxProject } from '../lib/project-connect.js';
import type { SalesforceProjectContext } from '../lib/project-context.js';

const context: SalesforceProjectContext = {
  projectId: 'p', projectName: 'Project', targetSource: 'project',
  settings: { projectRoot: '/project', defaultOrg: '', apiVersion: '62.0', agentScriptDialect: 'agentforce' },
};
function deps() {
  return {
    exists: (path: string) => path.endsWith('sfdx-project.json'),
    realpath: (path: string) => path,
    execSf: vi.fn(async () => ({ code: 0, stdout: '{"status":0}', stderr: '' })),
  };
}
describe('connectDxProject', () => {
  it('sets only the registered project’s CLI default', async () => {
    const d = deps();
    await connectDxProject(context, 'dev', d, ['dev']);
    expect(d.execSf).toHaveBeenCalledWith(['config', 'set', 'target-org=dev', '--json'], { cwd: '/project', timeoutMs: 30_000 });
  });
  it('accepts existing configuration confined to the project', async () => {
    const d = { ...deps(), exists: () => true };
    await expect(connectDxProject(context, 'dev@example.com', d, ['dev@example.com'])).resolves.toBeUndefined();
  });
  it.each(['', 'missing', '--global', '../dev'])('rejects invalid or disconnected org %s', async alias => {
    const d = deps();
    await expect(connectDxProject(context, alias, d, ['dev', '--global', '../dev'])).rejects.toThrow('connected org list');
    expect(d.execSf).not.toHaveBeenCalled();
  });
  it('requires a registered DX project', async () => {
    const d = deps();
    await expect(connectDxProject({ ...context, projectId: null }, 'dev', d, ['dev'])).rejects.toThrow('registered');
    d.exists = () => false;
    await expect(connectDxProject(context, 'dev', d, ['dev'])).rejects.toThrow('registered');
    expect(d.execSf).not.toHaveBeenCalled();
  });
  it.each(['sfdx-project.json', '.sf', '.sf/config.json'])('rejects configuration escaping the project through %s', async path => {
    const d = { ...deps(), exists: () => true, realpath: (value: string) => value === `/project/${path}` ? '/outside' : value };
    await expect(connectDxProject(context, 'dev', d, ['dev'])).rejects.toThrow('inside the project');
    expect(d.execSf).not.toHaveBeenCalled();
  });
  it('rejects dangling configuration symlinks before running the CLI', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-connect-'));
    try {
      writeFileSync(join(root, 'sfdx-project.json'), '{}');
      symlinkSync(join(root, '../absent-sf-config'), join(root, '.sf'));
      const d = { ...deps(), exists: existsSync, realpath: realpathSync };
      await expect(connectDxProject({ ...context, settings: { ...context.settings, projectRoot: root } }, 'dev', d, ['dev'])).rejects.toThrow('inside the project');
      expect(d.execSf).not.toHaveBeenCalled();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it.each([
    { code: 127, stdout: '', stderr: 'missing' },
    { code: 1, stdout: '', stderr: 'denied' },
    { code: 0, stdout: '{"status":1}', stderr: '' },
    { code: 0, stdout: 'truncated', stderr: '' },
  ])('reports configuration failures', async result => {
    const d = deps(); d.execSf.mockResolvedValue(result);
    await expect(connectDxProject(context, 'dev', d, ['dev'])).rejects.toThrow('Could not set');
  });
});
