import { describe, expect, it } from 'vitest';
import { isDxProject, listFilesRecursive, parsePackageDirectories, resolveUnderRoot, fingerprint } from '../lib/dx-project.js';
import { shouldContributeConstitution } from '../lib/constitution.js';

describe('DX project gating', () => {
  it('detects sfdx-project.json and package directories', () => {
    expect(isDxProject('/proj', (path) => path === '/proj/sfdx-project.json')).toBe(true);
    expect(isDxProject('/proj', () => false)).toBe(false);
    expect(isDxProject('', () => true)).toBe(false);
    expect(parsePackageDirectories('{"packageDirectories":[{"path":"app"}]}')).toEqual(['app']);
    expect(parsePackageDirectories('{"packageDirectories":[{}]}')).toEqual(['force-app']);
    expect(parsePackageDirectories('nope')).toEqual(['force-app']);
  });

  it('confines candidate paths to the project root', () => {
    const realpath = (path: string) => path;
    expect(resolveUnderRoot('/proj', 'force-app/main', realpath)).toBe('/proj/force-app/main');
    expect(resolveUnderRoot('/proj', '/etc/passwd', realpath)).toBeNull();
    expect(resolveUnderRoot('/proj', '../secrets', realpath)).toBeNull();
    expect(resolveUnderRoot('/proj', 'force-app\0x', realpath)).toBeNull();
    expect(resolveUnderRoot('', 'force-app', realpath)).toBeNull();
    expect(resolveUnderRoot('/proj', '/proj/force-app', realpath)).toBe('/proj/force-app');
  });

  it('contributes constitution only when an org or DX project is present', () => {
    expect(shouldContributeConstitution({ defaultOrg: '', dxProject: false })).toBe(false);
    expect(shouldContributeConstitution({ defaultOrg: 'dev', dxProject: false })).toBe(true);
    expect(shouldContributeConstitution({ defaultOrg: '', dxProject: true })).toBe(true);
    expect(fingerprint('abc')).toHaveLength(12);
    expect(
      listFilesRecursive('/proj', {
        stat: (path) => (path === '/proj' || path === '/proj/force-app' ? 'dir' : path.endsWith('.cls') ? 'file' : 'missing'),
        readdir: (path) => (path === '/proj' ? ['force-app', 'node_modules'] : path === '/proj/force-app' ? ['A.cls'] : []),
        realpath: (path) => path
      })
    ).toEqual(['/proj/force-app/A.cls']);
  });
});
