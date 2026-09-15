import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  classicSessionViewEnabled: false,
  openAgentModal: vi.fn(),
  openThreadModal: vi.fn()
}));

vi.mock('../store.js', () => ({
  useData: {
    getState: () => ({ classicSessionViewEnabled: h.classicSessionViewEnabled })
  },
  useUi: {
    getState: () => ({
      openAgentModal: h.openAgentModal,
      openThreadModal: h.openThreadModal
    })
  }
}));

import { inspectAgentSession, inspectThread } from './inspect-session.js';

describe('inspectAgentSession', () => {
  beforeEach(() => {
    h.classicSessionViewEnabled = false;
    h.openAgentModal.mockReset();
    h.openThreadModal.mockReset();
  });

  it('opens the inspector overlay when classic session view is off', () => {
    const navigate = vi.fn();
    inspectAgentSession('sess-1', 'proj-1', navigate);
    expect(h.openAgentModal).toHaveBeenCalledWith('sess-1', 'proj-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the session page when classic session view is on', () => {
    h.classicSessionViewEnabled = true;
    const navigate = vi.fn();
    inspectAgentSession('sess-1', 'proj-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/projects/proj-1/sessions/sess-1');
    expect(h.openAgentModal).not.toHaveBeenCalled();
  });
});

describe('inspectThread', () => {
  beforeEach(() => {
    h.classicSessionViewEnabled = false;
    h.openAgentModal.mockReset();
    h.openThreadModal.mockReset();
  });

  it('opens the inspector overlay when classic session view is off', () => {
    const navigate = vi.fn();
    inspectThread('thr-1', 'proj-1', navigate);
    expect(h.openThreadModal).toHaveBeenCalledWith('thr-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the project thread page when classic session view is on', () => {
    h.classicSessionViewEnabled = true;
    const navigate = vi.fn();
    inspectThread('thr-1', 'proj-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/projects/proj-1/threads/thr-1');
    expect(h.openThreadModal).not.toHaveBeenCalled();
  });

  it('navigates to the unscoped thread page when projectId is missing', () => {
    h.classicSessionViewEnabled = true;
    const navigate = vi.fn();
    inspectThread('thr-1', null, navigate);
    expect(navigate).toHaveBeenCalledWith('/threads/thr-1');
  });
});
