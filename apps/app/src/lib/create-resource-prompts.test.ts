import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CREATE_PLUGIN_PROMPT } from './create-resource-prompts.js';
import {
  PLUGIN_CREATE_ARCHETYPES,
  PLUGIN_CREATE_UTILITIES,
  pluginCreatePrompt
} from './create-plugin-examples.js';
import {
  composePromptSeedFrom,
  createPluginComposeNavigation
} from './compose-prompt-seed.js';

const SURFACES = [
  '../views/extensions/ExtensionsHub.tsx',
  '../views/extensions/MarketplaceView.tsx',
  '../plugins/PluginComposerChrome.tsx',
  '../components/plugin/CreatePluginExamples.tsx'
] as const;

describe('CREATE_PLUGIN_PROMPT', () => {
  it('is the shared prefix every create surface imports', () => {
    expect(CREATE_PLUGIN_PROMPT).toBe('Create a new zcc plugin that ');
    for (const rel of SURFACES) {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
      expect(source, rel).toContain('CREATE_PLUGIN_PROMPT');
      expect(source, rel).not.toMatch(/Create a new zcc plugin that /);
    }
  });

  it('hub New plugin navigates with the seed and keeps install/adopt on the overflow menu', () => {
    const source = readFileSync(new URL('../views/extensions/ExtensionsHub.tsx', import.meta.url), 'utf8');
    expect(source).toContain('createPluginComposeNavigation');
    expect(source).toContain('selectedProjectId');
    expect(source).toContain('createPluginComposeNavigation({ prompt, projectId: selectedProjectId })');
    expect(source).not.toContain('CreateExtensionDialog');
    expect(source).toContain('Open existing plugin');
    expect(source).toContain('Install from folder');
    expect(source).toContain('Install from repository');
  });

  it('composer Create plugin action inserts the shared prefix on new-thread only', () => {
    const source = readFileSync(new URL('../plugins/PluginComposerChrome.tsx', import.meta.url), 'utf8');
    expect(source).toContain('data-testid="composer-create-plugin"');
    expect(source).toContain('CREATE_PLUGIN_PROMPT');
    expect(source).toContain('Create plugin');
    expect(source).toContain("scope.kind === 'new-thread'");
  });

  it('builds archetype prompts from the shared prefix', () => {
    expect(pluginCreatePrompt(PLUGIN_CREATE_ARCHETYPES[0]!.brief).startsWith(CREATE_PLUGIN_PROMPT)).toBe(
      true
    );
    expect(PLUGIN_CREATE_UTILITIES.length).toBeGreaterThan(0);
  });

  it('reads location state and ?prompt= into composer seed', () => {
    expect(
      composePromptSeedFrom({
        searchParams: new URLSearchParams('prompt=from-query&focus=1'),
        state: null
      })
    ).toEqual({ initialText: 'from-query', focusPrompt: true });
    expect(
      composePromptSeedFrom({
        searchParams: new URLSearchParams(),
        state: { initialPrompt: CREATE_PLUGIN_PROMPT, focusPrompt: true }
      })
    ).toEqual({ initialText: CREATE_PLUGIN_PROMPT, focusPrompt: true });
  });

  it('sends Installed create to home compose and project create to new-thread', () => {
    expect(createPluginComposeNavigation()).toEqual({
      pathname: '/',
      state: { initialPrompt: CREATE_PLUGIN_PROMPT, focusPrompt: true }
    });
    expect(createPluginComposeNavigation({ projectId: 'p1' }).pathname).toBe(
      '/projects/p1/threads/new'
    );
  });
});
