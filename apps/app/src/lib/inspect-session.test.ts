import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  classicSessionViewEnabled: false,
  threadTabsEnabled: false,
  compact: false,
  nav: 'agents' as string,
  focusedProjectId: null as string | null,
  scopedProjectId: null as string | null,
  openAgentModal: vi.fn(),
  openThreadModal: vi.fn(),
  enterProjectFocus: vi.fn()
}));

vi.mock('../store.js', () => ({
  useData: {
    getState: () => ({ classicSessionViewEnabled: h.classicSessionViewEnabled, threadTabsEnabled: h.threadTabsEnabled })
  },
  useUi: {
    getState: () => ({
      nav: h.nav,
      focusedProjectId: h.focusedProjectId,
      openAgentModal: h.openAgentModal,
      openThreadModal: h.openThreadModal,
      enterProjectFocus: h.enterProjectFocus
    })
  }
}));

vi.mock('../hooks/useIsCompactViewport.js', () => ({ isCompactViewport: () => h.compact }));

vi.mock('./windowScope.js', () => ({
  getScopedProjectId: () => h.scopedProjectId
}));

import { inspectAgentSession, inspectRouteProjectId, inspectThread, threadOpenListener } from './inspect-session.js';

describe('inspectRouteProjectId', () => {
  beforeEach(() => {
    h.nav = 'agents';
    h.focusedProjectId = null;
    h.scopedProjectId = null;
  });

  it('stays unscoped on the Agents board so a click cannot enter project view', () => {
    expect(inspectRouteProjectId('proj-1')).toBeNull();
  });

  it('ignores leftover store focus while the Agents canvas is showing', () => {
    h.focusedProjectId = 'proj-1';
    expect(inspectRouteProjectId('proj-1')).toBeNull();
  });

  it('keeps the project id while Inbox is open with the project rail', () => {
    h.nav = 'inbox';
    h.focusedProjectId = 'proj-1';
    expect(inspectRouteProjectId('proj-1')).toBe('proj-1');
  });

  it('keeps the project id while already in a project workspace', () => {
    h.nav = 'projects';
    h.focusedProjectId = 'proj-1';
    expect(inspectRouteProjectId('proj-1')).toBe('proj-1');
  });

  it('uses the focused project when already in a project workspace and the id is missing', () => {
    h.nav = 'projects';
    h.focusedProjectId = 'proj-1';
    expect(inspectRouteProjectId(null)).toBe('proj-1');
  });

  it('uses the dedicated window lock even when the shell nav is not projects', () => {
    h.scopedProjectId = 'proj-lock';
    expect(inspectRouteProjectId('proj-1')).toBe('proj-1');
    expect(inspectRouteProjectId(null)).toBe('proj-lock');
  });
});

describe('inspectAgentSession', () => {
  beforeEach(() => {
    h.classicSessionViewEnabled = false;
    h.threadTabsEnabled = false;
    h.compact = false;
    h.nav = 'agents';
    h.focusedProjectId = null;
    h.scopedProjectId = null;
    h.openAgentModal.mockReset();
    h.openThreadModal.mockReset();
  });

  it('opens the inspector overlay when classic session view is off', () => {
    const navigate = vi.fn();
    inspectAgentSession('sess-1', 'proj-1', navigate);
    expect(h.openAgentModal).toHaveBeenCalledWith('sess-1', 'proj-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the unscoped session page from the Agents board when Classic session view is on', () => {
    h.classicSessionViewEnabled = true;
    const navigate = vi.fn();
    inspectAgentSession('sess-1', 'proj-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/sessions/sess-1');
    expect(h.openAgentModal).not.toHaveBeenCalled();
  });

  it('navigates to the project session page when already in a project workspace', () => {
    h.classicSessionViewEnabled = true;
    h.nav = 'projects';
    h.focusedProjectId = 'proj-1';
    const navigate = vi.fn();
    inspectAgentSession('sess-1', 'proj-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/projects/proj-1/sessions/sess-1');
    expect(h.openAgentModal).not.toHaveBeenCalled();
  });
});

describe('inspectThread', () => {
  beforeEach(() => {
    h.classicSessionViewEnabled = false;
    h.threadTabsEnabled = false;
    h.compact = false;
    h.nav = 'agents';
    h.focusedProjectId = null;
    h.scopedProjectId = null;
    h.openAgentModal.mockReset();
    h.openThreadModal.mockReset();
  });

  it('opens the inspector overlay when classic session view is off', () => {
    const navigate = vi.fn();
    inspectThread('thr-1', 'proj-1', navigate);
    expect(h.openThreadModal).toHaveBeenCalledWith('thr-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the unscoped thread page from the Agents board when Classic session view is on', () => {
    h.classicSessionViewEnabled = true;
    const navigate = vi.fn();
    inspectThread('thr-1', 'proj-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/threads/thr-1');
    expect(h.openThreadModal).not.toHaveBeenCalled();
  });

  it('navigates to the project thread page when already in a project workspace', () => {
    h.classicSessionViewEnabled = true;
    h.nav = 'projects';
    h.focusedProjectId = 'proj-1';
    const navigate = vi.fn();
    inspectThread('thr-1', 'proj-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/projects/proj-1/threads/thr-1');
    expect(h.openThreadModal).not.toHaveBeenCalled();
  });

  it('navigates to the unscoped thread page when projectId is missing on the Agents board', () => {
    h.classicSessionViewEnabled = true;
    const navigate = vi.fn();
    inspectThread('thr-1', null, navigate);
    expect(navigate).toHaveBeenCalledWith('/threads/thr-1');
    expect(h.openThreadModal).not.toHaveBeenCalled();
  });
});

describe('threadOpenListener', () => {
  beforeEach(() => {
    h.classicSessionViewEnabled = false;
    h.threadTabsEnabled = false;
    h.compact = false;
    h.openThreadModal.mockClear();
    h.enterProjectFocus.mockClear();
  });

  it('focuses the project and opens the thread inspector', () => {
    const navigate = vi.fn();
    threadOpenListener({ current: navigate })({ type: 'thread-open', threadId: 't-1', projectId: 'p-1' });
    expect(h.enterProjectFocus).toHaveBeenCalledWith('p-1');
    expect(h.openThreadModal).toHaveBeenCalledWith('t-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates with the latest navigate function when Classic session view is on', () => {
    h.classicSessionViewEnabled = true;
    const ref = { current: vi.fn() };
    const listener = threadOpenListener(ref);
    const latest = vi.fn();
    ref.current = latest;
    listener({ type: 'thread-open', threadId: 't-1', projectId: 'p-1' });
    expect(latest).toHaveBeenCalledWith(expect.stringContaining('t-1'));
  });

  it('ignores file, terminal, malformed and foreign payloads', () => {
    const listener = threadOpenListener({ current: vi.fn() });
    for (const payload of [null, 'x', { type: 'other', threadId: 't', projectId: 'p' }, { type: 'thread-open', threadId: 't', projectId: 'p', file: 'a.ts' },
      { type: 'thread-open', threadId: 't', projectId: 'p', terminal: true }, { type: 'thread-open', threadId: 1, projectId: 'p' }, { type: 'thread-open', threadId: 't' }]) listener(payload);
    expect(h.enterProjectFocus).not.toHaveBeenCalled();
    expect(h.openThreadModal).not.toHaveBeenCalled();
  });
});


describe('desktop thread tabs inspection', () => {
  beforeEach(() => {
    h.classicSessionViewEnabled = false;
    h.threadTabsEnabled = true;
    h.compact = false;
    h.nav = 'agents';
    h.focusedProjectId = null;
    h.scopedProjectId = null;
    h.openThreadModal.mockReset();
    h.openAgentModal.mockReset();
  });
  it('opens a thread page while keeping CLI agents in their inspector', () => {
    const navigate = vi.fn();
    inspectThread('tabbed', 'p', navigate);
    expect(navigate).toHaveBeenCalledWith('/threads/tabbed');
    expect(h.openThreadModal).not.toHaveBeenCalled();
    inspectAgentSession('cli', 'p', navigate);
    expect(h.openAgentModal).toHaveBeenCalledWith('cli', 'p');
  });
  it('keeps the project rail when opening a tab from project view', () => {
    h.nav = 'projects'; h.focusedProjectId = 'p';
    const navigate = vi.fn();
    inspectThread('tabbed', 'p', navigate);
    expect(navigate).toHaveBeenCalledWith('/projects/p/threads/tabbed');
  });
  it('does not change compact inspection or override Classic session view', () => {
    h.compact = true;
    const navigate = vi.fn();
    inspectThread('tabbed', 'p', navigate);
    expect(h.openThreadModal).toHaveBeenCalledWith('tabbed');
    expect(navigate).not.toHaveBeenCalled();
    h.classicSessionViewEnabled = true;
    inspectThread('tabbed', 'p', navigate);
    expect(navigate).toHaveBeenCalledWith('/threads/tabbed');
  });
});
