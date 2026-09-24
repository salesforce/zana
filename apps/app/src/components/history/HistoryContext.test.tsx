// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HistoryContext } from './HistoryContext.js';
import { clearPluginSlots, interpretPluginApp } from '../../plugins/plugin-slots.js';
import codexApp from '../../../../../plugins/provider-codex/app.tsx';
import claudeApp from '../../../../../plugins/provider-claude-code/app.tsx';

afterEach(cleanup);

it.each([
  ['codex', codexApp, 'OpenAI'],
  ['claude-code', claudeApp, 'Claude']
] as const)('passes the sizing class to the installed %s icon', (harnessId, app, iconTitle) => {
  interpretPluginApp('history-icon-test', app);
  try {
    const { container } = render(<HistoryContext harnessId={harnessId} projectName="Customer portal" />);
    const icon = container.querySelector('svg.history-harness-icon');
    expect(icon?.querySelector('title')?.textContent).toBe(iconTitle);
  } finally {
    cleanup();
    clearPluginSlots('history-icon-test');
  }
});

it.each([
  ['codex', 'Codex'],
  ['claude', 'Claude Code'],
  ['claude-code', 'Claude Code'],
  ['opencode', 'OpenCode'],
  ['acp-opencode', 'OpenCode'],
  ['acp-cursor', 'Cursor'],
  ['custom-harness', 'custom-harness']
])('shows the %s harness and project as icon and name', (harnessId, harness) => {
  render(<HistoryContext harnessId={harnessId} projectName="Customer portal" />);
  const harnessField = screen.getByTitle(`Harness: ${harness}`);
  expect(within(harnessField).queryByText('Harness')).toBeNull();
  expect(within(harnessField).getByText(harness)).toBeTruthy();
  expect(harnessField.querySelector('svg.history-harness-icon')).toBeTruthy();
  const projectField = screen.getByTitle('Project: Customer portal');
  expect(within(projectField).queryByText('Project')).toBeNull();
  expect(projectField.querySelector('svg')).toBeTruthy();
  expect(within(projectField).getByText('Customer portal')).toBeTruthy();
});

it.each([undefined, ''])('makes a missing project explicit (%s)', (projectName) => {
  render(<HistoryContext harnessId="codex" projectName={projectName} />);
  expect(screen.getByText('Unknown project')).toBeTruthy();
});

it('preserves a long project name in the visible text and tooltip', () => {
  const projectName = 'customer-portal-production-services-with-a-long-project-name';
  render(<HistoryContext harnessId="codex" projectName={projectName} />);
  expect(screen.getByText(projectName)).toBeTruthy();
  expect(screen.getByTitle(`Project: ${projectName}`)).toBeTruthy();
});
