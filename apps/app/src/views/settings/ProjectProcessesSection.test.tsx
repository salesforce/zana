import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectProcessList, ProjectProcessesSection } from '@/views/settings/ProjectSettingsView';
import type { Project } from '@zana-ai/zcc-domain/product';

const processes = [
  { pid: 4242, cwd: '/tmp/proj', command: 'vite' },
  { pid: 4243, cwd: '/tmp/proj/app', command: 'node' }
];

describe('ProjectProcessList', () => {
  it('renders an empty state', () => {
    const html = renderToStaticMarkup(
      <ProjectProcessList
        processes={[]}
        selected={new Set()}
        killing={false}
        onToggle={vi.fn()}
        onKillSelected={vi.fn()}
      />
    );
    expect(html).toContain('No running processes with a working directory in this project.');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Kill selected');
  });

  it('lists pid, command, and cwd and disables kill until a row is selected', () => {
    const html = renderToStaticMarkup(
      <ProjectProcessList
        processes={processes}
        selected={new Set()}
        killing={false}
        onToggle={vi.fn()}
        onKillSelected={vi.fn()}
      />
    );
    expect(html).toContain('aria-label="Running processes"');
    expect(html).toContain('4242');
    expect(html).toContain('vite');
    expect(html).toContain('/tmp/proj');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Kill selected');
  });

  it('enables kill when a process is selected and shows stopping while killing', () => {
    const selected = renderToStaticMarkup(
      <ProjectProcessList
        processes={processes}
        selected={new Set([4242])}
        killing={false}
        onToggle={vi.fn()}
        onKillSelected={vi.fn()}
      />
    );
    expect(selected).toContain('checked=""');
    expect(selected).not.toContain('disabled=""');

    const killing = renderToStaticMarkup(
      <ProjectProcessList
        processes={processes}
        selected={new Set([4242])}
        killing
        onToggle={vi.fn()}
        onKillSelected={vi.fn()}
      />
    );
    expect(killing).toContain('Stopping...');
    expect(killing).toContain('disabled=""');
  });
});

describe('ProjectProcessesSection', () => {
  it('renders the Running processes heading while loading', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        cc: {
          projects: {
            listProcesses: vi.fn(() => new Promise(() => {}))
          }
        }
      }
    });
    const project = { id: 'p1', name: 'Project', path: '/tmp/project' } as Project;
    const html = renderToStaticMarkup(<ProjectProcessesSection project={project} />);
    expect(html).toContain('Running processes');
    expect(html).toContain('Refresh');
  });
});
