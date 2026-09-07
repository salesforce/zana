import { describe, expect, it } from 'vitest';
import type { PluginAppSlots } from '@zana-ai/zcc-plugin-sdk';
import { SURFACES } from './surfaces.js';

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
