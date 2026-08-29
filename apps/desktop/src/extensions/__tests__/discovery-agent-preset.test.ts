import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `agentPreset` opt-in: discovery must parse the manifest's optional framework
 * preset (the Advanced Quick-Agent primer an extension contributes) and project
 * it through to the renderer-safe `ExtensionManifestView`. `systemPrompt` is the
 * load-bearing field — a preset without a non-empty primer is DROPPED (it would
 * inject nothing). Other fields are sanitized structurally, and `model` /
 * `baseProfile` are narrowed to their enums so a typo can't smuggle an arbitrary
 * value into the persona/launch layer. discovery.ts is electron-free, so no
 * electron mock is needed.
 */
let extDir: string;

async function importDiscovery() {
  return await import('../discovery.js');
}

async function writeExt(dirName: string, manifest: Record<string, unknown>): Promise<void> {
  const dir = join(extDir, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf-8');
}

function base(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: 'X',
    icon: 'Box',
    engines: { zccApi: '^1.0.0' },
    entry: { renderer: 'renderer.js' },
    ...extra
  };
}

describe('discovery agentPreset parsing + projection', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-preset-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('carries a well-formed agentPreset through to the manifest view', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.fw',
      base('acme.fw', {
        agentPreset: {
          label: 'Acme',
          description: 'The Acme framework',
          icon: 'Blocks',
          systemPrompt: 'You are running inside Acme.',
          initialPrompt: 'Run /acme:status.',
          model: 'opus',
          baseProfile: 'claude'
        }
      })
    );

    const found = await discoverExtensions();
    const preset = found.find((x) => x.id === 'acme.fw')?.manifest?.agentPreset;
    expect(preset).toEqual({
      label: 'Acme',
      description: 'The Acme framework',
      icon: 'Blocks',
      systemPrompt: 'You are running inside Acme.',
      initialPrompt: 'Run /acme:status.',
      model: 'opus',
      baseProfile: 'claude'
    });
  });

  it('drops a preset with no (or blank) systemPrompt — it would inject nothing', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.nop', base('acme.nop', { agentPreset: { label: 'Nope' } }));
    await writeExt('acme.blank', base('acme.blank', { agentPreset: { systemPrompt: '   ' } }));

    const found = await discoverExtensions();
    expect(found.find((x) => x.id === 'acme.nop')?.manifest?.agentPreset).toBeUndefined();
    expect(found.find((x) => x.id === 'acme.blank')?.manifest?.agentPreset).toBeUndefined();
  });

  it('narrows a bad model / baseProfile to undefined but keeps the primer', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.badenum',
      base('acme.badenum', {
        agentPreset: { systemPrompt: 'hi', model: 'gpt-5', baseProfile: 'shell' }
      })
    );

    const found = await discoverExtensions();
    const preset = found.find((x) => x.id === 'acme.badenum')?.manifest?.agentPreset;
    expect(preset?.systemPrompt).toBe('hi');
    expect(preset?.model).toBeUndefined();
    expect(preset?.baseProfile).toBeUndefined();
  });

  it('treats a non-object agentPreset as absent', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.arr', base('acme.arr', { agentPreset: ['nope'] }));
    await writeExt('acme.none', base('acme.none'));

    const found = await discoverExtensions();
    expect(found.find((x) => x.id === 'acme.arr')?.manifest?.agentPreset).toBeUndefined();
    expect(found.find((x) => x.id === 'acme.none')?.manifest?.agentPreset).toBeUndefined();
  });
});
