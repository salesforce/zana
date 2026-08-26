import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./NewThreadView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('NewThreadView', () => {
  it('is a composer-only create surface mounted at /threads/new', () => {
    expect(app).toContain('<Route path={NEW_THREAD_ROUTE_PATH} element={<NewThreadView />} />');
    expect(app).toContain('<Route path={PROJECT_NEW_THREAD_ROUTE_PATH} element={null} />');
    expect(app).toContain('<Route path={PROJECT_THREAD_ROUTE_PATH} element={null} />');
    expect(app.indexOf('NEW_THREAD_ROUTE_PATH')).toBeLessThan(app.indexOf('THREAD_ROUTE_PATH} element={<ThreadDetailView'));
    expect(view).toContain('<HomeAgentComposer project={project} />');
    expect(view).toContain('PluginNewThreadActions');
    expect(view).not.toContain('allowLegacyAgent');
    expect(view).toContain('search.get(\'project\')');
    expect(view).toContain('routeProjectId');
    expect(view).toContain('className="new-thread-view"');
    expect(view).not.toContain('AgentBoardLanes');
    expect(view).not.toContain('agents-board');
  });

  it('centers the Home composer instead of the board-width override', () => {
    expect(css).toContain('.new-thread-view > .home-agent-composer {');
    const start = css.indexOf('.new-thread-view > .home-agent-composer {');
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('width: min(820px, 100%);');
    expect(css).not.toContain('.agents-board > .home-agent-composer {');
  });
});
