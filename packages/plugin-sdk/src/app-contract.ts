import type { ComponentType } from 'react';

export interface PluginSlotBase {
  id: string;
  pluginId: string;
  generation: number;
}

export interface PluginNavPanelRegistration extends PluginSlotBase {
  title: string;
  icon: string;
  path?: string;
  component: ComponentType<{ pluginId: string; subPath: string }>;
}

export interface PluginSettingsSectionRegistration extends PluginSlotBase {
  title?: string;
  description?: string;
  component: ComponentType<{ pluginId: string }>;
}

export interface PluginHomepageSectionRegistration extends PluginSlotBase {
  title: string;
  component: ComponentType<{ pluginId: string; projectId: string | null }>;
}

export interface PluginProjectTabRegistration extends PluginSlotBase {
  label: string;
  icon?: string;
  order?: number;
  global?: boolean;
  component: ComponentType<{ pluginId: string; projectId: string }>;
}

export interface PluginSidebarFooterActionRegistration extends PluginSlotBase {
  title: string;
  icon: string;
  run: () => void | Promise<void>;
}

export interface PluginAppSlots {
  navPanel(registration: Omit<PluginNavPanelRegistration, 'generation' | 'pluginId'>): void;
  settingsSection(registration: Omit<PluginSettingsSectionRegistration, 'generation' | 'pluginId'>): void;
  homepageSection(registration: Omit<PluginHomepageSectionRegistration, 'generation' | 'pluginId'>): void;
  projectTab(registration: Omit<PluginProjectTabRegistration, 'generation' | 'pluginId'>): void;
  sidebarFooterAction(registration: Omit<PluginSidebarFooterActionRegistration, 'generation' | 'pluginId'>): void;
}

export interface PluginAppBuilder {
  slots: PluginAppSlots;
}

export type PluginAppSetup = (app: PluginAppBuilder) => void;

export interface PluginAppDefinition {
  readonly __zccPluginApp: true;
  readonly setup: PluginAppSetup;
}

export interface PluginRegistrationSet {
  pluginId: string;
  generation: number;
  navPanels: PluginNavPanelRegistration[];
  settingsSections: PluginSettingsSectionRegistration[];
  homepageSections: PluginHomepageSectionRegistration[];
  projectTabs: PluginProjectTabRegistration[];
  sidebarFooterActions: PluginSidebarFooterActionRegistration[];
}

export function emptyRegistrationSet(pluginId: string, generation: number): PluginRegistrationSet {
  return {
    pluginId,
    generation,
    navPanels: [],
    settingsSections: [],
    homepageSections: [],
    projectTabs: [],
    sidebarFooterActions: []
  };
}

export function collectPluginApp(
  pluginId: string,
  generation: number,
  definition: PluginAppDefinition
): PluginRegistrationSet {
  const set = emptyRegistrationSet(pluginId, generation);
  const stamp = <T extends { id: string }>(row: T): T & { generation: number; pluginId: string } => ({
    ...row,
    generation,
    pluginId
  });
  definition.setup({
    slots: {
      navPanel: (registration) => {
        set.navPanels.push(stamp(registration));
      },
      settingsSection: (registration) => {
        set.settingsSections.push(stamp(registration));
      },
      homepageSection: (registration) => {
        set.homepageSections.push(stamp(registration));
      },
      projectTab: (registration) => {
        set.projectTabs.push(stamp(registration));
      },
      sidebarFooterAction: (registration) => {
        set.sidebarFooterActions.push(stamp(registration));
      }
    }
  });
  return set;
}
