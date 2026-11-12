import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, ...parts), 'utf8');
const serverSource = read('..', 'server.ts');
const bundledDts = read('..', '..', 'bundled-types', 'zcc-plugin-sdk.d.ts');
const referenceDoc = read('..', '..', '..', '..', 'docs', 'extensions-sdk-reference.md');

/** Resolve the shipped ambient declarations from an independent plugin directory. */
function pageContextTypeDiagnostics(source: string) {
  const directory = mkdtempSync(join(tmpdir(), 'zcc-page-context-types-'));
  const fixture = join(directory, 'plugin.ts');
  try {
    writeFileSync(fixture, source);
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
      files: [fixture, join(here, '..', '..', 'bundled-types', 'zcc-plugin-sdk.d.ts')],
      compilerOptions: {
        noEmit: true, strict: true, skipLibCheck: true, types: [],
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler'
      }
    }));
    // TypeScript 7 ships the native compiler without the old createProgram API.
    const typescriptRoot = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));
    const result = spawnSync(process.execPath, [join(typescriptRoot, 'bin', 'tsc'), '--project', directory, '--pretty', 'false'], {
      cwd: directory, encoding: 'utf8', timeout: 15_000, maxBuffer: 1_000_000
    });
    if (result.error) throw result.error;
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const diagnostics = output.split(/\r?\n/).flatMap(line => {
      const match = /(?:^|[/\\])plugin\.ts\(\d+,\d+\): error TS(\d+): (.*)/.exec(line);
      return match ? [{ code: Number(match[1]), message: match[2]! }] : [];
    });
    if (result.status !== 0 && diagnostics.length === 0) throw new Error(`Standalone plugin typecheck failed:\n${output}`);
    return diagnostics;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Member names declared directly in `export interface <name> { ... }`, skipping deprecated and experimental_ aliases. */
export function interfaceMembers(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`interface ${name} not found`);
  const body = source.slice(start).split(/\n}\n/)[0]!.split('\n');
  const members: string[] = [];
  let deprecated = false;
  for (const line of body.slice(1)) {
    if (/@deprecated/.test(line)) deprecated = true;
    const match = /^ {2}(?:readonly )?([A-Za-z_][A-Za-z0-9_]*)[?(:<]/.exec(line);
    if (!match) continue;
    if (!deprecated && !match[1]!.startsWith('experimental_')) members.push(match[1]!);
    deprecated = false;
  }
  return members;
}

const SURFACES: Array<[interfaceName: string, prefix: string]> = [
  ['ZccPluginApi', 'zcc.'],
  ['PluginHooks', 'zcc.hooks.'],
  ['PluginUi', 'zcc.ui.'],
  ['PluginAgents', 'zcc.agents.'],
  ['PluginEvents', 'zcc.events.'],
  ['PluginHostApi', 'zcc.host.'],
  ['PluginProcess', 'zcc.process.']
];

describe('bundled SDK types and reference doc cover the public API', () => {
  it('finds members to check', () => {
    expect(interfaceMembers(serverSource, 'ZccPluginApi')).toEqual(expect.arrayContaining(['hooks', 'ui', 'agents', 'host']));
  });

  for (const [interfaceName, prefix] of SURFACES) {
    for (const member of interfaceMembers(serverSource, interfaceName)) {
      it(`${prefix}${member} is in the bundled d.ts and the reference doc`, () => {
        expect(bundledDts, `bundled d.ts lacks ${member}`).toMatch(new RegExp(`\\b${member}\\b`));
        const topLevel = prefix === 'zcc.';
        const documented = topLevel
          ? new RegExp(`\`(?:zcc\\.)?${member}[\`.(]`)
          : new RegExp(`[\`./ ]${member}\\b`);
        expect(referenceDoc, `reference doc lacks ${prefix}${member}`).toMatch(documented);
      });
    }
  }

  it('carries the policy, admission, lifecycle and interaction shapes', () => {
    for (const fragment of [
      "action: 'ask'; prompt: string; timeoutMs?: number",
      "surface?: 'pty' | 'modern'",
      "'squad-member-start'",
      "'job-team-dispatch'",
      "export type DispatchOrigin = 'user' | 'agent' | 'system'",
      "surface?: 'modern' | 'pty'",
      "surface?: 'pty'",
      'sdk.capabilities'.split('.')[1]!
    ]) expect(bundledDts, fragment).toContain(fragment);
  });

  it('fails when a member is missing from the d.ts', () => {
    const without = bundledDts.replace(/registerProjectTabAvailability/g, 'removed');
    expect(without).not.toMatch(/\bregisterProjectTabAvailability\b/);
  });

  it('typechecks page-context publication against standalone bundled declarations', () => {
    expect(pageContextTypeDiagnostics(`
      import { useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
      import type { ZccPageContext, ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';

      const navigate: ZccNavigate = useZccNavigate();
      const context: ZccPageContext = {
        title: 'Current document',
        resourceId: 'doc-1',
        path: 'overview.md',
        view: 'preview',
        mention: { providerId: 'document', itemId: 'doc-1' }
      };
      navigate.setPageContext?.(context);
      navigate.setPageContext?.(null);
      const olderHost: Pick<ZccNavigate, 'setPageContext'> = {};
      olderHost.setPageContext?.({ title: 'Document catalogue' });
    `)).toEqual([]);
  });

  it('rejects invalid page-context fields in standalone plugin code', () => {
    const diagnostics = pageContextTypeDiagnostics(`
      import type { ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
      declare const navigate: ZccNavigate;
      navigate.setPageContext?.({ title: 42 });
      navigate.setPageContext?.({ title: 'Document', mention: { providerId: 'document' } });
    `);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics).toEqual(expect.arrayContaining([
      { code: 2322, message: "Type 'number' is not assignable to type 'string'." },
      expect.objectContaining({ code: 2741, message: expect.stringContaining("Property 'itemId' is missing") })
    ]));
  });
});
