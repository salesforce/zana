import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectExecutionConsentGrant } from '../../../../shared/types.js';
import { ProjectExecutionConsentList, shouldShowExecutionConsent } from '../ProjectTab.js';

const grant: ProjectExecutionConsentGrant = {
  id: 'grant-1',
  adapterId: 'codex',
  targetId: 'codex.execution.accept-edits',
  launchScope: 'local',
  createdAt: Date.UTC(2026, 0, 2)
};

describe('ProjectExecutionConsentList', () => {
  it('hides the section until a grant or load error exists', () => {
    expect(shouldShowExecutionConsent(null, null)).toBe(false);
    expect(shouldShowExecutionConsent([], null)).toBe(false);
    expect(shouldShowExecutionConsent([grant], null)).toBe(true);
    expect(shouldShowExecutionConsent([], 'load failed')).toBe(true);
  });

  it('renders grant scope and a keyboard-native labeled revoke button', () => {
    const html = renderToStaticMarkup(
      <ProjectExecutionConsentList
        projectName="Command Center"
        grants={[grant]}
        revokingId={null}
        onRevoke={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="Execution grants for Command Center"');
    expect(html).toContain('codex.execution.accept-edits');
    expect(html).toContain('local');
    expect(html).toContain('aria-label="Revoke codex execution grant for Command Center"');
    expect(html).toContain('<button type="button"');
  });

  it('announces empty and loading states and disables all actions during revoke', () => {
    const loading = renderToStaticMarkup(
      <ProjectExecutionConsentList projectName="Project" grants={null} revokingId={null} onRevoke={vi.fn()} />
    );
    const empty = renderToStaticMarkup(
      <ProjectExecutionConsentList projectName="Project" grants={[]} revokingId={null} onRevoke={vi.fn()} />
    );
    const revoking = renderToStaticMarkup(
      <ProjectExecutionConsentList projectName="Project" grants={[grant]} revokingId={grant.id} onRevoke={vi.fn()} />
    );

    expect(loading).toContain('role="status"');
    expect(empty).toContain('role="status"');
    expect(revoking).toContain('disabled=""');
    expect(revoking).toContain('Revoking...');
  });
});
