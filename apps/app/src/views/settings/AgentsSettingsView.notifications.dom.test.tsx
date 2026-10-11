// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
vi.mock('@/components/ui/PopoverPicklist', () => ({ PopoverPicklist: (props: any) => <select aria-label={props.ariaLabel} value={props.value} onChange={event => props.onChange(event.target.value)}>
  {props.options.map((row: any) => <option key={row.value} value={row.value}>{row.label}</option>)}
</select> }));
// These panes load their own data; the notification controls don't depend on them.
vi.mock('./RemoteMachineDefaultsList.js', () => ({ RemoteMachineDefaultsList: () => null }));
vi.mock('./AgentGuidanceSettings.js', () => ({ AgentGuidanceSettings: () => null }));
vi.mock('@/components/settings/OverseerRecentPane', () => ({ OverseerRecentPane: () => null }));
import { AgentsTab } from './AgentsSettingsView';

afterEach(cleanup);

const config: AppConfig = { version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };

it('saves the phone notification levels and the previews opt-out', () => {
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  render(<AgentsTab config={config} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);

  fireEvent.change(screen.getByRole('combobox', { name: 'Phone notifications: default level' }), { target: { value: 'muted' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Phone notifications: child thread level' }), { target: { value: 'inherit' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Show previews in phone notifications' }));

  expect(onUpdate.mock.calls).toEqual([
    [{ notificationDefaultLevel: 'muted' }],
    [{ notificationChildLevel: 'inherit' }],
    [{ notificationPreviews: false }]
  ]);
});
