import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { load } = createRequire(import.meta.url)('js-yaml');
const workflow = load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
const builder = load(readFileSync(new URL('../apps/desktop/electron-builder.yml', import.meta.url), 'utf8'));

describe('Windows release pipeline', () => {
  it('makes Windows opt-in for manual rebuilds while retaining both Mac architectures and release gates', () => {
    expect(workflow.on.workflow_dispatch.inputs.build_windows).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(workflow.jobs['build-windows'].if)
      .toBe("github.event_name != 'workflow_dispatch' || inputs.build_windows");
    expect(workflow.jobs.build.if).toBeUndefined();
    expect(workflow.jobs.build.strategy.matrix.include).toEqual([
      { os: 'macos-15', arch: 'arm64' },
      { os: 'macos-15-intel', arch: 'x64' },
    ]);
    expect(workflow.jobs.build.needs).toEqual(['verify', 'smoke']);
    expect(workflow.on.push.tags).toContain('v*');
  });

  it('gates Mac and Windows artifact uploads on packaged plugin authoring', () => {
    for (const [job, gate] of [['build', 'Verify packaged plugin authoring'], ['build-windows', 'Verify packaged Windows plugin authoring']]) {
      const steps = workflow.jobs[job].steps;
      const gateIndex = steps.findIndex((step: any) => step.name === gate);
      const uploadIndex = steps.findIndex((step: any) => step.name === (job === 'build' ? 'Upload artifact' : 'Upload Windows artifacts'));
      expect(gateIndex).toBeGreaterThan(0);
      expect(gateIndex).toBeLessThan(uploadIndex);
      expect(steps[gateIndex].run).toContain('e2e/plugin-authoring-live.spec.ts');
      expect(steps[gateIndex].run).toContain('e2e/packaged-provider-startup.spec.ts');
      expect(steps[gateIndex]['continue-on-error']).toBeUndefined();
    }
    const mac = workflow.jobs.build.steps.find((step: any) => step.name === 'Verify packaged plugin authoring');
    expect(mac.run).toContain('ZCC_E2E_EXECUTABLE_PATH="$APP_PATH"');
    expect(mac.run).toContain('e2e/smoke.spec.ts');
    const windows = workflow.jobs['build-windows'].steps.find((step: any) => step.name === 'Verify packaged Windows plugin authoring');
    expect(windows.env.ZCC_E2E_EXECUTABLE_PATH).toContain('win-unpacked');
  });

  it('retains packaged test diagnostics for each Mac architecture without uploading release assets on failure', () => {
    const steps = workflow.jobs.build.steps;
    const report = steps.find((step: any) => step.name === 'Upload Playwright report on failure');
    expect(report.if).toBe('failure()');
    expect(report.with.name).toBe('mac-${{ matrix.arch }}-packaged-playwright-report');
    expect(report.with.path.split('\n')).toContain('e2e/.artifacts');
    const artifacts = steps.find((step: any) => step.name === 'Upload artifact');
    expect(artifacts.if).toBeUndefined();
    expect(artifacts['continue-on-error']).toBeUndefined();
  });
  it('gates draft publication on both Mac and Windows builds', () => {
    expect(workflow.jobs.release.needs).toEqual(['build', 'build-windows']);
    expect(workflow.jobs.release.if).toBe("startsWith(github.ref, 'refs/tags/v')");
    const publish = workflow.jobs.release.steps.find((step: any) => step.uses?.startsWith('softprops/action-gh-release@'));
    expect(publish.with.draft).toBe(true);
    for (const asset of ['merged/*.exe', 'merged/*.blockmap', 'merged/latest.yml', 'merged/latest-mac.yml']) {
      expect(publish.with.files.split('\n')).toContain(asset);
    }
    expect(workflow.jobs.release.steps.find((step: any) => step.id === 'meta').run)
      .toContain('artifacts/release-windows-x64/latest.yml');
  });

  it('publishes the curated notes as the release body the update banner previews', () => {
    // The app reads this body back from the feed for its pre-update "What's new";
    // dropping body_path silently empties that preview.
    const publish = workflow.jobs.release.steps.find((step: any) => step.uses?.startsWith('softprops/action-gh-release@'));
    expect(publish.with.body_path).toBe('docs/releases/${{ steps.meta.outputs.title }}.md');
    expect(workflow.jobs.release.steps.find((step: any) => step.id === 'meta').run).toContain('title=${GITHUB_REF_NAME#v}');
    expect(workflow.jobs.verify.steps.some((step: any) => step.run === 'pnpm run check:release-notes')).toBe(true);
  });

  it('builds natively and tests the actual Windows package before uploading', () => {
    const windows = workflow.jobs['build-windows'];
    expect(windows['runs-on']).toBe('windows-2025');
    expect(windows.needs).toEqual(['verify', 'smoke']);
    const steps = windows.steps;
    const index = (name: string) => steps.findIndex((step: any) => step.name === name);
    expect(index('Stage Windows OpenCode binary')).toBeLessThan(index('Build app'));
    expect(index('Build app')).toBeLessThan(index('Package Windows installer'));
    expect(index('Package Windows installer')).toBeLessThan(index('Smoke test packaged Windows app'));
    expect(index('Smoke test packaged Windows app')).toBeLessThan(index('Upload Windows artifacts'));
    const smoke = steps[index('Smoke test packaged Windows app')];
    expect(smoke.run).toBe('pnpm run test:smoke:only');
    expect(smoke.env.ZCC_E2E_EXECUTABLE_PATH).toBe('${{ github.workspace }}\\dist\\win-unpacked\\Zana.exe');
    expect(smoke['continue-on-error']).toBeUndefined();
    const pack = steps[index('Package Windows installer')];
    expect(pack.run).toContain('electron-builder --win --x64 --publish never');
    expect(pack.run).toContain('if ($env:WIN_CSC_LINK_SECRET)');
    expect(Object.keys(pack.env)).toEqual(['WIN_CSC_LINK_SECRET', 'WIN_CSC_KEY_PASSWORD_SECRET']);
    const upload = steps[index('Upload Windows artifacts')];
    expect(upload.with.name).toBe('release-windows-x64');
    expect(upload.with.path.split('\n')).toEqual(expect.arrayContaining(['dist/*.exe', 'dist/*.blockmap', 'dist/latest.yml']));
  });

  it('keeps the Unix supervisor out of Windows and uses stable installer names', () => {
    const supervisor = { from: 'resources/scheduled-supervisor', to: 'scheduled-supervisor' };
    expect(builder.extraResources).not.toContainEqual(supervisor);
    expect(builder.mac.extraResources).toContainEqual(supervisor);
    expect(builder.linux.extraResources).toContainEqual(supervisor);
    expect(builder.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(builder.win.artifactName).toBe('Zana-Command-Center-${version}-win-${arch}-Setup.${ext}');
    expect(builder.publish).toMatchObject({ provider: 'github', owner: 'salesforce', repo: 'zana' });
  });
});
