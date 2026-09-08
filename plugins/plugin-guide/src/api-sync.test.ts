import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PluginAppSlots } from '@zana-ai/zcc-plugin-sdk';
import { SURFACE_GROUPS, SURFACES } from './surfaces.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');

const SLOT_SURFACE_IDS = [
  'navPanel',
  'settingsSection',
  'homepageSection',
  'projectTab',
  'experimental_projectMenuAction',
  'experimental_createProjectAction',
  'sidebarFooterAction',
  'projectStatusbarItem',
  'pendingInteraction',
  'threadPanelAction',
  'experimental_newThreadPanelAction',
  'experimental_threadList',
  'experimental_threadHeaderAction',
  'fileOpener',
  'messageDirective',
  'messageAction',
  'experimental_agentCardAction',
  'experimental_agentsBoardAction',
  'experimental_timelineRenderer',
  'commandPaletteAction',
  'experimental_providerIcon'
] as const satisfies readonly (keyof PluginAppSlots)[];

type MissingSlot = Exclude<keyof PluginAppSlots, (typeof SLOT_SURFACE_IDS)[number]>;
const _assertAllSlotsHaveGuideCards: MissingSlot extends never ? true : never = true;
void _assertAllSlotsHaveGuideCards;

describe('plugin guide surfaces', () => {
  it('documents every PluginAppSlots key', () => {
    const ids = new Set(SURFACES.map((surface) => surface.id));
    for (const id of SLOT_SURFACE_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('names threadPanelAction as thread side-panel tabs', () => {
    const surface = SURFACES.find((row) => row.id === 'threadPanelAction');
    expect(surface?.title).toBe('Thread side-panel tabs');
    expect(surface?.summary).toMatch(/side panel/);
    expect(surface?.bullets.some((line) => line.includes('agent-session'))).toBe(true);
  });

  it('documents composer, content scripts, and skill channels', () => {
    const ids = new Set(SURFACES.map((surface) => surface.id));
    expect(ids.has('composer')).toBe(true);
    expect(ids.has('contentScripts')).toBe(true);
    expect(ids.has('skills')).toBe(true);
    const composer = SURFACES.find((row) => row.id === 'composer');
    expect(composer?.bullets.some((line) => line.includes('cli-agent'))).toBe(true);
    expect(composer?.bullets.some((line) => line.includes('experimental_setLaunchPatch'))).toBe(true);
  });

  it('documents unlisted navPanels and footer toPluginPanel', () => {
    const nav = SURFACES.find((row) => row.id === 'navPanel');
    expect(nav?.bullets.some((line) => line.includes('unlisted'))).toBe(true);
    const footer = SURFACES.find((row) => row.id === 'sidebarFooterAction');
    expect(footer?.bullets.some((line) => line.includes('toPluginPanel'))).toBe(true);
    expect(footer?.firstParty).toEqual(['Connect', 'Salesforce']);
  });
});

const PLUGIN_GUIDE_SYNC_FILES = [
  'annotation.ts',
  'chip-position.ts',
  'product-map.tsx',
  'surface-card.tsx',
  'surfaces.ts',
  'wireframes.tsx'
] as const;

describe('plugin guide public docs', () => {
  const sdkReference = readFileSync(join(repoRoot, 'docs/extensions-sdk-reference.md'), 'utf8');
  const websiteHub = readFileSync(join(repoRoot, 'website/app/extensions/page.tsx'), 'utf8');
  const websiteSdk = readFileSync(join(repoRoot, 'website/app/extensions/sdk/page.tsx'), 'utf8');
  const pluginSrc = join(repoRoot, 'plugins/plugin-guide/src');
  const websiteCopy = join(repoRoot, 'website/lib/plugin-guide');

  it('lists every Plugin Guide group and surface in the public SDK reference', () => {
    for (const group of SURFACE_GROUPS) {
      expect(sdkReference, `docs/extensions-sdk-reference.md is missing group "${group.title}"`).toContain(
        `### ${group.title}`
      );
      for (const surface of group.surfaces) {
        expect(sdkReference, `docs/extensions-sdk-reference.md is missing \`${surface.id}\``).toContain(
          `\`${surface.id}\``
        );
      }
    }
  });

  it('keeps the website Plugin Guide map identical to plugin sources', () => {
    expect(websiteHub).toContain('PluginGuideMap');
    expect(websiteSdk).not.toContain('PluginGuideMap');
    expect(websiteHub).not.toContain('plugin-guide-catalog');
    const websiteImports = (source: string) =>
      source.replace(/(from\s+['"])(\.[^'"]+)\.js(['"])/g, '$1$2$3');
    for (const name of PLUGIN_GUIDE_SYNC_FILES) {
      expect(readFileSync(join(websiteCopy, name), 'utf8'), name).toBe(
        websiteImports(readFileSync(join(pluginSrc, name), 'utf8'))
      );
    }
    expect(readFileSync(join(websiteCopy, 'plugin-guide.css'), 'utf8')).toBe(
      readFileSync(join(repoRoot, 'plugins/plugin-guide/plugin-guide.css'), 'utf8')
    );
  });
});
