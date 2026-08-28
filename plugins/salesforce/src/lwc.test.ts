import { describe, expect, it } from 'vitest';
import { diagnoseLwc, findLwcComponent, inspectLwc, parseLwcInput, resolveJestBin, scanLwcComponents } from '../lib/lwc.js';
import type { SalesforceDeps } from '../lib/types.js';

function memFs(files: Record<string, string>, dirs: Record<string, string[]>): SalesforceDeps {
  return {
    execSf: async () => ({ code: 1, stdout: '', stderr: '' }),
    request: async () => ({ status: 500, json: null, text: '' }),
    now: () => 0,
    exists: (path) => path in files || path in dirs,
    stat: (path) => (path in dirs ? 'dir' : path in files ? 'file' : 'missing'),
    readFile: (path) => files[path] ?? null,
    readdir: (path) => dirs[path] ?? [],
    realpath: (path) => path,
    spawnContained: async () => ({ code: 0, stdout: 'ok', stderr: '' }),
    writeFile: (path, content) => {
      files[path] = content;
    }
  };
}

describe('lwc local lifecycle', () => {
  it('rejects deploy-like actions and requires a component for inspect', () => {
    expect(parseLwcInput({ action: 'deploy' }).ok).toBe(false);
    expect(parseLwcInput({ action: 'inspect' }).ok).toBe(false);
    expect(parseLwcInput({ action: 'scan' }).ok).toBe(true);
  });

  it('scans confined LWC bundles', () => {
    const deps = memFs(
      {
        '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}',
        '/proj/force-app/main/default/lwc/hello/hello.js-meta.xml': '<xml/>',
        '/proj/force-app/main/default/lwc/hello/hello.js': 'export default class Hello {}',
        '/proj/force-app/main/default/lwc/hello/hello.html': '<template></template>'
      },
      {
        '/proj': ['sfdx-project.json', 'force-app'],
        '/proj/force-app': ['main'],
        '/proj/force-app/main': ['default'],
        '/proj/force-app/main/default': ['lwc'],
        '/proj/force-app/main/default/lwc': ['hello'],
        '/proj/force-app/main/default/lwc/hello': ['hello.js-meta.xml', 'hello.js', 'hello.html']
      }
    );
    const components = scanLwcComponents('/proj', deps);
    expect(components).toHaveLength(1);
    expect(components[0]?.name).toBe('hello');
    expect(findLwcComponent(components, 'hello')?.hasJs).toBe(true);
    expect(findLwcComponent(components, undefined, 'lwc/hello')).toMatchObject({ name: 'hello' });
    expect(diagnoseLwc(components[0]!)).toEqual([]);
    expect(inspectLwc(components[0]!, deps).publicApi).toEqual([]);
    expect(resolveJestBin('/proj', deps)).toBeNull();
    expect(findLwcComponent(components)).toBeNull();
    expect(
      diagnoseLwc({ name: 'Hello', dir: '/x', hasHtml: false, hasJs: false, hasCss: false, hasMeta: false })
    ).toHaveLength(4);
  });
});
