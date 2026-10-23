// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { AgentsTab } from '@/views/settings/AgentsSettingsView';
import { entries as agentsEntries } from '@/lib/settings-search/entries/agents';
import { findSecretValueViolations } from '@/lib/settings-search/secrets';

vi.mock('@/components/ui/PopoverPicklist', () => ({ PopoverPicklist: (props: any) => <select aria-label={props.ariaLabel} value={props.value} onChange={event => props.onChange(event.target.value)}>
  {props.options.map((row: any) => <option key={row.value} value={row.value}>{row.label}</option>)}
</select> }));

afterEach(cleanup);

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  worktreeIsolationDefault: true
};

describe('AgentsTab worktree isolation', () => {
  it('renders the global default as an accessible checked control', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Git worktrees');
    expect(html).toContain('Prefer a new git worktree by default');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Prefer a new git worktree by default"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('Durable squads use their own project and squad settings');
  });

  it('places PTY session ceilings under CLI Agent', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('CLI Agent');
    expect(html).toContain('Max live sessions');
    expect(html).toContain('Agent heap limit (MB)');
    expect(html).toContain('Remote defaults');
    expect(html).not.toContain('Performance &amp; limits');
  });

  it('offers a global toggle to include scheduled agents in Agent View', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('settings-anchor-scheduled');
    expect(html).toContain('>Scheduled<');
    expect(html).toContain('Include scheduled agents in Agent View');
    expect(html).toContain('aria-label="Include scheduled agents in Agent View"');
    expect(html).toContain('Scheduled column');
    expect(html).toContain('Off hides every scheduled session from Agent View');
    expect(html).toContain('including one that is currently working');
    expect(html).toContain('Scheduled runs never appear under a project in the sidebar');
    expect(html).toContain(
      'aria-checked="true" aria-label="Include scheduled agents in Agent View"'
    );
  });

  it('exposes a Default plan mode picklist that defaults to Infer (freeform)', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Default plan mode');
    expect(html).toContain('aria-label="Default plan mode"');
    // Absent config → the picklist shows the infer default (today's behavior).
    expect(html).toContain('Infer plan from goal');
  });

  it('reflects a persisted structured default in the plan-mode picklist', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={{ ...config, teamDefaultCoordinationMode: 'structured' }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Plan provided in goal');
  });

  it('uses orchestrator (not coordinator) in Teams organization help text', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('each orchestrator and its workers together');
    expect(html).toContain('one orchestrator row per run');
    expect(html).not.toContain('each coordinator and its workers');
    expect(html).not.toContain('one coordinator row per run');
  });

  it('groups CLI Agent, Overseer, and Auto mode after general settings, Auto mode last', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const guidance = html.indexOf('settings-anchor-agent-guidance');
    const worktrees = html.indexOf('settings-anchor-git-worktrees');
    const idle = html.indexOf('settings-anchor-auto-close-idle');
    const cli = html.indexOf('settings-anchor-legacy-agent');
    const overseer = html.indexOf('settings-anchor-overseer');
    const autoMode = html.indexOf('settings-anchor-auto-mode');
    expect(guidance).toBeGreaterThan(-1);
    expect(worktrees).toBeGreaterThan(guidance);
    expect(idle).toBeGreaterThan(worktrees);
    expect(cli).toBeGreaterThan(idle);
    expect(overseer).toBeGreaterThan(cli);
    expect(autoMode).toBeGreaterThan(overseer);
    expect(html.lastIndexOf('<h3>')).toBe(html.indexOf('<h3>Auto mode</h3>'));
  });
});

describe('AgentsTab phone notification settings', () => {
  const render = (over: Partial<AppConfig> = {}) =>
    renderToStaticMarkup(
      <AgentsTab
        config={{ ...config, ...over }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );

  it('shows the shipped defaults under Agent attention', () => {
    const html = render();
    const attention = html.indexOf('settings-anchor-agent-attention');
    const scheduled = html.indexOf('settings-anchor-scheduled');
    for (const label of [
      'Phone notifications: default level',
      'Phone notifications: child thread level',
      'Show previews in phone notifications'
    ]) {
      const at = html.indexOf(label);
      expect(at).toBeGreaterThan(attention);
      expect(at).toBeLessThan(scheduled);
    }
    expect(html).toContain('All activity');
    expect(html).toContain('Needs input only');
    expect(html).toContain('aria-label="Show previews in phone notifications"');
    expect(html).toContain('aria-checked="true" aria-label="Show previews in phone notifications"');
  });

  it('reflects configured levels and the previews opt-out', () => {
    const html = render({
      notificationDefaultLevel: 'muted',
      notificationChildLevel: 'inherit',
      notificationPreviews: false
    });
    expect(html).toContain('Muted');
    expect(html).toContain('Same as default');
    expect(html).toContain('aria-checked="false" aria-label="Show previews in phone notifications"');
  });

  it('falls back to the shipped defaults when the stored values are not valid levels', () => {
    const html = render({
      notificationDefaultLevel: 'loud' as never,
      notificationChildLevel: 7 as never
    });
    expect(html).toContain('All activity');
    expect(html).toContain('Needs input only');
  });
});

describe('Agents settings search entries', () => {
  const snapshot = (over: Partial<AppConfig> = {}) => ({ config: { ...config, ...over } });
  const byId = new Map(agentsEntries.map((e) => [e.id, e]));
  const valueOf = (id: string, over: Partial<AppConfig> = {}) => byId.get(id)?.value?.(snapshot(over));

  it('has unique ids and every dependsOn points at an entry', () => {
    expect(byId.size).toBe(agentsEntries.length);
    for (const e of agentsEntries) if (e.dependsOn) expect(byId.has(e.dependsOn)).toBe(true);
  });

  it('never exposes a value on a secret-looking entry', () => {
    expect(findSecretValueViolations(agentsEntries)).toEqual([]);
  });

  it('renders a data-settings-target for every entry when all gates are open', () => {
    const open: AppConfig = {
      ...config,
      idleTriageEnabled: true,
      heartbeatEnabled: true,
      autoCloseIdleEnabled: true,
      overseerMode: 'on',
      overseerLlmTierEnabled: true,
      autoModeEnabled: true,
      apiErrorResume: { enabled: true, rules: [], maxPerWindow: 3, windowMinutes: 15 }
    };
    const html = renderToStaticMarkup(
      <AgentsTab config={open} onConfigDraft={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />
    );
    for (const e of agentsEntries) expect(html).toContain(`data-settings-target="${e.id}"`);
  });

  it('reads defaults when config fields are absent', () => {
    expect(valueOf('agents.worktree-default')).toBe('On');
    expect(valueOf('agents.auto-name-tabs')).toBe('On');
    expect(valueOf('agents.list-organization')).toBe('By status');
    expect(valueOf('agents.project-navigation')).toBe('Sessions');
    expect(valueOf('agents.flow-all-view')).toBe('Combined canvas');
    expect(valueOf('agents.default-plan-mode')).toBe('Infer plan from goal');
    expect(valueOf('agents.idle-triage-delay')).toBe('20');
    expect(valueOf('agents.idle-triage-sensitivity')).toBe('Medium');
    expect(valueOf('agents.squad-idle-timeout')).toBe('45');
    expect(valueOf('agents.max-autonomous-rounds')).toBe('30');
    expect(valueOf('agents.max-live-sessions')).toBeUndefined();
    expect(valueOf('agents.overseer-mode')).toBe('Off');
    expect(valueOf('agents.auto-mode-enabled')).toBe('On');
    expect(valueOf('agents.inject-bundled-skills')).toBe('On');
    expect(valueOf('agents.notification-default-level')).toBe('All activity');
    expect(valueOf('agents.notification-child-level')).toBe('Needs input only');
    expect(valueOf('agents.notification-previews')).toBe('On');
  });

  it('indexes current worktree help for Squad defaults', () => {
    expect(byId.get('agents.git-worktrees.intro')?.help).toContain('Durable squads use their own project and squad settings');
    expect(byId.get('agents.worktree-default')?.help).toContain('Squads use it when their project and Squad settings use default behavior');
  });

  it('reads configured values', () => {
    expect(valueOf('agents.list-organization', { agentsListOrganization: 'team-run' })).toBe('By Squad run');
    expect(valueOf('agents.project-navigation', { projectNavigationOrganization: 'team-runs' })).toBe('Squad runs');
    expect(valueOf('agents.flow-all-view', { flowAllOrganization: 'team-runs' })).toBe('Separate Squad runs');
    expect(valueOf('agents.default-plan-mode', { teamDefaultCoordinationMode: 'structured' })).toBe('Plan provided in goal');
    expect(valueOf('agents.idle-triage-sensitivity', { idleAttentionSensitivity: 'high' })).toBe('High');
    expect(valueOf('agents.squad-idle-timeout', { autonomousTimeoutMs: 0 })).toBe('0');
    expect(valueOf('agents.squad-idle-timeout', { autonomousTimeoutMs: 120_000 })).toBe('2');
    expect(valueOf('agents.max-live-sessions', { maxLiveSessions: 12 })).toBe('12');
    expect(valueOf('agents.overseer-mode', { overseerMode: 'dryRun' })).toBe('Dry-run (observe only)');
    expect(valueOf('agents.overseer-deny-patterns', { overseerDenyPatterns: ['git push'] })).toEqual(['git push']);
    expect(valueOf('agents.heartbeat-message', { heartbeatMessage: 'Keep going' })).toBe('Keep going');
    expect(valueOf('agents.inject-product-guidance', { injectProductGuidance: false })).toBe('Off');
    expect(valueOf('agents.auto-mode-enabled', { autoModeEnabled: false })).toBe('Off');
    expect(valueOf('agents.notification-default-level', { notificationDefaultLevel: 'muted' })).toBe('Muted');
    expect(valueOf('agents.notification-child-level', { notificationChildLevel: 'inherit' })).toBe('Same as default');
    expect(valueOf('agents.notification-child-level', { notificationChildLevel: 'muted' })).toBe('Muted');
    expect(valueOf('agents.notification-previews', { notificationPreviews: false })).toBe('Off');
  });

  it('evaluates every value accessor without throwing', () => {
    for (const e of agentsEntries) expect(() => e.value?.(snapshot())).not.toThrow();
  });
});

describe('AgentsTab scheduled run limit', () => {
  const mount = (c: AppConfig = config) => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onConfigDraft = vi.fn();
    render(<AgentsTab config={c} onConfigDraft={onConfigDraft} onUpdate={onUpdate} />);
    return { onUpdate, onConfigDraft };
  };

  it('defaults to 5 runs and automatic overflow', () => {
    mount();
    expect((screen.getByLabelText('Max scheduled runs at once') as HTMLInputElement).value).toBe('5');
    expect((screen.getByRole('combobox', { name: 'When the limit is reached' }) as HTMLSelectElement).value).toBe('auto');
  });

  it('shows saved values', () => {
    mount({ ...config, scheduledRunConcurrency: 8, scheduledRunOverflow: 'skip' });
    expect((screen.getByLabelText('Max scheduled runs at once') as HTMLInputElement).value).toBe('8');
    expect((screen.getByRole('combobox', { name: 'When the limit is reached' }) as HTMLSelectElement).value).toBe('skip');
  });

  it('drafts while typing and clamps on blur', () => {
    const { onUpdate, onConfigDraft } = mount();
    const input = screen.getByLabelText('Max scheduled runs at once');
    fireEvent.change(input, { target: { value: '7' } });
    expect(onConfigDraft).toHaveBeenCalledWith({ ...config, scheduledRunConcurrency: 7 });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onConfigDraft).toHaveBeenCalledTimes(1);
    // Empty or invalid falls back to the default (5); numbers clamp to 1-20.
    for (const [raw, want] of [['7', 7], ['0', 1], ['50', 20], ['', 5], ['abc', 5]] as const) {
      fireEvent.blur(input, { target: { value: raw } });
      expect(onUpdate).toHaveBeenLastCalledWith({ scheduledRunConcurrency: want });
    }
  });

  it('writes each overflow choice', () => {
    const { onUpdate } = mount();
    const select = screen.getByRole('combobox', { name: 'When the limit is reached' });
    for (const v of ['queue', 'skip', 'auto']) {
      fireEvent.change(select, { target: { value: v } });
      expect(onUpdate).toHaveBeenLastCalledWith({ scheduledRunOverflow: v });
    }
  });
});

describe('AgentsTab idle thread sessions', () => {
  it('defaults to 30 minutes, offers Never, and saves the picked minutes', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<AgentsTab config={config} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    const picker = screen.getByLabelText('Stop idle thread sessions') as HTMLSelectElement;
    expect(picker.value).toBe('30');
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'After 30 minutes', 'After 1 hour', 'After 2 hours', 'After 4 hours', 'After 8 hours', 'Never'
    ]);
    fireEvent.change(picker, { target: { value: '0' } });
    expect(onUpdate).toHaveBeenCalledWith({ threadSessionReleaseMinutes: 0 });
  });

  it('keeps a hand-edited value selectable and labels it in search', () => {
    render(<AgentsTab config={{ ...config, threadSessionReleaseMinutes: 45 }} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />);
    const picker = screen.getByLabelText('Stop idle thread sessions') as HTMLSelectElement;
    expect(picker.value).toBe('45');
    expect(picker.options[0]?.textContent).toBe('After 45 minutes');
    const entry = agentsEntries.find((row) => row.id === 'agents.thread-session-release');
    expect(entry?.value?.({ config } as never)).toBe('After 30 minutes');
    expect(entry?.value?.({ config: { ...config, threadSessionReleaseMinutes: 0 } } as never)).toBe('Never');
  });
});

describe('AgentsTab resume after API errors', () => {
  it('renders the section for a config with no apiErrorResume and no window.cc', () => {
    const html = renderToStaticMarkup(
      <AgentsTab config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />
    );
    expect(html).toContain('Resume after API errors');
    expect(html).toContain('settings-anchor-api-error-resume');
  });
});
