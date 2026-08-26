import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as pluginSdkApp from '@zana-ai/zcc-plugin-sdk/app';
import type {
  PluginAppBuilder,
  PluginAppSlots,
  PluginHomepageSectionRegistration,
  PluginNavPanelRegistration,
  PluginPendingInteractionProps,
  PluginProjectTabRegistration,
  PluginSettingDescriptor,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionRegistration,
  PluginThreadEvent,
  ZccPluginApi
} from '@zana-ai/zcc-plugin-sdk';

const FRONTEND_RUNTIME_EXPORT_NAMES = Object.keys(pluginSdkApp).sort();

const SKILL_PATH = fileURLToPath(
  new URL('./builtin-skills/zcc-plugin-authoring/SKILL.md', import.meta.url)
);

const ZCC_PLUGIN_API_KEYS = [
  'pluginId',
  'log',
  'settings',
  'http',
  'rpc',
  'realtime',
  'storage',
  'background',
  'cli',
  'agents',
  'events',
  'ui',
  'status',
  'sdk',
  'host',
  'onDispose'
] as const satisfies readonly (keyof ZccPluginApi)[];

type MissingApiKey = Exclude<keyof ZccPluginApi, (typeof ZCC_PLUGIN_API_KEYS)[number]>;
const _assertAllApiKeysListed: MissingApiKey extends never ? true : never = true;
void _assertAllApiKeysListed;

const SETTING_DESCRIPTOR_TYPES = [
  'string',
  'boolean',
  'select',
  'project'
] as const satisfies readonly PluginSettingDescriptor['type'][];

type MissingSettingType = Exclude<
  PluginSettingDescriptor['type'],
  (typeof SETTING_DESCRIPTOR_TYPES)[number]
>;
const _assertAllSettingTypesListed: MissingSettingType extends never ? true : never = true;
void _assertAllSettingTypesListed;

const THREAD_EVENT_NAMES = [
  'thread.created',
  'thread.active',
  'thread.idle',
  'thread.failed',
  'thread.archived',
  'thread.deleted'
] as const satisfies readonly PluginThreadEvent['name'][];

type MissingThreadEvent = Exclude<PluginThreadEvent['name'], (typeof THREAD_EVENT_NAMES)[number]>;
const _assertAllThreadEventsListed: MissingThreadEvent extends never ? true : never = true;
void _assertAllThreadEventsListed;

const THREAD_EVENT_FIELDS = ['name', 'threadId', 'projectId'] as const satisfies readonly (keyof PluginThreadEvent)[];

type MissingThreadEventField = Exclude<
  keyof PluginThreadEvent,
  (typeof THREAD_EVENT_FIELDS)[number]
>;
const _assertAllThreadEventFieldsListed: MissingThreadEventField extends never ? true : never = true;
void _assertAllThreadEventFieldsListed;

type SlotPropsByName = {
  homepageSection: { pluginId: string; projectId: string | null };
  settingsSection: { pluginId: string };
  navPanel: { pluginId: string; subPath: string };
  projectTab: { pluginId: string; projectId: string };
  sidebarFooterAction: { title: string; icon: string; run: () => void | Promise<void> };
  pendingInteraction: PluginPendingInteractionProps;
};

type MissingSlot = Exclude<keyof PluginAppSlots, keyof SlotPropsByName>;
const _assertAllSlotsListed: MissingSlot extends never ? true : never = true;
void _assertAllSlotsListed;

const APP_BUILDER_FIELDS = ['slots'] as const satisfies readonly (keyof PluginAppBuilder)[];

type MissingAppBuilderField = Exclude<
  keyof PluginAppBuilder,
  (typeof APP_BUILDER_FIELDS)[number]
>;
const _assertAllAppBuilderFieldsListed: MissingAppBuilderField extends never ? true : never = true;
void _assertAllAppBuilderFieldsListed;

const NAV_PANEL_REGISTRATION_FIELDS = [
  'id',
  'title',
  'icon',
  'path',
  'component'
] as const satisfies readonly (keyof Omit<PluginNavPanelRegistration, 'generation' | 'pluginId'>)[];

const SETTINGS_SECTION_REGISTRATION_FIELDS = [
  'id',
  'title',
  'description',
  'component'
] as const satisfies readonly (keyof Omit<PluginSettingsSectionRegistration, 'generation' | 'pluginId'>)[];

const HOMEPAGE_SECTION_REGISTRATION_FIELDS = [
  'id',
  'title',
  'component'
] as const satisfies readonly (keyof Omit<PluginHomepageSectionRegistration, 'generation' | 'pluginId'>)[];

const PROJECT_TAB_REGISTRATION_FIELDS = [
  'id',
  'label',
  'icon',
  'order',
  'global',
  'component'
] as const satisfies readonly (keyof Omit<PluginProjectTabRegistration, 'generation' | 'pluginId'>)[];

const SIDEBAR_FOOTER_ACTION_REGISTRATION_FIELDS = [
  'id',
  'title',
  'icon',
  'run'
] as const satisfies readonly (keyof Omit<PluginSidebarFooterActionRegistration, 'generation' | 'pluginId'>)[];

const FRONTEND_SLOT_PROP_FIELDS = {
  homepageSection: ['pluginId', 'projectId'],
  settingsSection: ['pluginId'],
  navPanel: ['pluginId', 'subPath'],
  projectTab: ['pluginId', 'projectId'],
  sidebarFooterAction: ['title', 'icon', 'run'],
  pendingInteraction: ['interaction', 'submit', 'cancel']
} as const satisfies {
  [S in keyof SlotPropsByName]: readonly (keyof SlotPropsByName[S])[];
};

describe('zcc-plugin-authoring skill', () => {
  const skill = readFileSync(SKILL_PATH, 'utf8');

  it('has frontmatter naming the skill after its directory', () => {
    expect(skill).toMatch(/^---\nname: zcc-plugin-authoring\n/);
  });

  it('documents every ZccPluginApi property', () => {
    for (const key of ZCC_PLUGIN_API_KEYS) {
      expect(skill, `zcc.${key} is not documented in the skill`).toContain(`zcc.${key}`);
    }
  });

  it('documents every @zana-ai/zcc-plugin-sdk/app runtime export', () => {
    for (const name of FRONTEND_RUNTIME_EXPORT_NAMES) {
      expect(skill, `${name} is not documented in the skill`).toContain(name);
    }
  });

  it('documents PluginAppBuilder.slots', () => {
    for (const field of APP_BUILDER_FIELDS) {
      expect(skill, `PluginAppBuilder.${field} is not documented`).toContain(field);
    }
  });

  it('documents every settings descriptor type', () => {
    for (const type of SETTING_DESCRIPTOR_TYPES) {
      expect(skill, `settings descriptor type "${type}" is not documented`).toContain(`type: "${type}"`);
    }
  });

  it('documents every thread event and payload field', () => {
    for (const event of THREAD_EVENT_NAMES) {
      expect(skill, `${event} is not documented`).toContain(`"${event}"`);
    }
    for (const field of THREAD_EVENT_FIELDS) {
      if (field === 'name') continue;
      expect(skill, `thread event field "${field}" is not documented`).toContain(field);
    }
  });

  it('documents navPanel, settings, homepage, projectTab, and footer registration fields', () => {
    for (const field of NAV_PANEL_REGISTRATION_FIELDS) {
      expect(skill, `navPanel registration field "${field}" is not documented`).toContain(field);
    }
    for (const field of SETTINGS_SECTION_REGISTRATION_FIELDS) {
      expect(skill, `settingsSection registration field "${field}" is not documented`).toContain(field);
    }
    for (const field of HOMEPAGE_SECTION_REGISTRATION_FIELDS) {
      expect(skill, `homepageSection registration field "${field}" is not documented`).toContain(field);
    }
    for (const field of PROJECT_TAB_REGISTRATION_FIELDS) {
      expect(skill, `projectTab registration field "${field}" is not documented`).toContain(field);
    }
    for (const field of SIDEBAR_FOOTER_ACTION_REGISTRATION_FIELDS) {
      expect(skill, `sidebarFooterAction registration field "${field}" is not documented`).toContain(field);
    }
  });

  it('documents every frontend slot and its prop fields', () => {
    for (const [slot, fields] of Object.entries(FRONTEND_SLOT_PROP_FIELDS)) {
      expect(skill, `slot ${slot} is not documented`).toContain(slot);
      for (const field of fields) {
        expect(skill, `slot ${slot} prop field "${field}" is not documented`).toContain(field);
      }
    }
  });

  it('documents the authoring loop commands', () => {
    expect(skill).toContain('zcc plugin new');
    expect(skill).toContain('zcc plugin install');
    expect(skill).toContain('zcc plugin dev');
    expect(skill).toContain('zcc plugin types');
    expect(skill).toContain('plugin_cli_output_too_large');
  });

  it('keeps the packaged ~/.claude copy in lockstep with the injected skill', () => {
    const packaged = readFileSync(
      fileURLToPath(new URL('../../../../resources/zcc-plugin-authoring-skill.md', import.meta.url)),
      'utf8'
    );
    expect(packaged).toBe(skill);
  });
});
