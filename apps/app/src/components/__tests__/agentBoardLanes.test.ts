import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANES, type AgentCard } from '../AgentBoard.js';
import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';

// Build a minimal AgentCard for lane-classification tests. Only the fields the
// LANE matchers read (`status`, `exitCode`, `state`) matter.
function card(state: AgentState, status: TerminalSession['status'], exitCode?: number, scheduled = false): AgentCard {
  return {
    session: {
      id: 's',
      projectId: 'p',
      title: 't',
      profile: 'claude',
      cwd: '/tmp',
      status,
      exitCode,
      createdAt: 0,
      ...(scheduled ? { scheduled: true } : {})
    } as TerminalSession,
    state,
    projectId: 'p',
    projectName: 'Proj'
  };
}

/** Which lane (if any) a card lands in. The board renders a card in the FIRST
 *  matching lane, mirroring `LANES.map(... filter(match))` — but the matchers
 *  are mutually exclusive, so "first match" and "only match" coincide. */
function laneFor(c: AgentCard): string | null {
  const hit = LANES.find((l) => l.match(c));
  return hit ? hit.key : null;
}

describe('AgentBoard LANES classification', () => {
  it('routes a blocked, running agent to Needs you', () => {
    expect(laneFor(card('blocked', 'running'))).toBe('blocked');
  });

  it('routes a working agent to Working', () => {
    expect(laneFor(card('working', 'running'))).toBe('working');
  });

  it('routes idle / done / unknown live agents to Idle', () => {
    expect(laneFor(card('idle', 'running'))).toBe('idle');
    expect(laneFor(card('done', 'running'))).toBe('idle');
    expect(laneFor(card('unknown', 'running'))).toBe('idle');
    expect(laneFor(card('idle', 'starting'))).toBe('idle');
  });

  it('routes an at-rest parent with live sub-agents to Idle', () => {
    const c = card('idle', 'running');
    c.liveSubagents = 2;
    expect(laneFor(c)).toBe('idle');
  });

  it('routes any exited agent to Done regardless of last state', () => {
    expect(laneFor(card('working', 'exited', 0))).toBe('done');
    expect(laneFor(card('blocked', 'exited', 1))).toBe('done');
    expect(laneFor(card('idle', 'exited', 0))).toBe('done');
  });

  it('classifies every card into exactly one lane (no agent ever hidden)', () => {
    const states: AgentState[] = ['blocked', 'working', 'idle', 'done', 'unknown'];
    const statuses: TerminalSession['status'][] = ['starting', 'running', 'exited'];
    for (const scheduled of [false, true]) {
      for (const s of states) {
        for (const st of statuses) {
          const matches = LANES.filter((l) => l.match(card(s, st, undefined, scheduled)));
          expect(matches.length).toBe(1);
        }
      }
    }
  });

  it('routes waiting scheduled agents to Scheduled, running ones to Working', () => {
    expect(laneFor(card('idle', 'running', undefined, true))).toBe('scheduled');
    expect(laneFor(card('unknown', 'running', undefined, true))).toBe('scheduled');
    expect(laneFor(card('working', 'running', undefined, true))).toBe('working');
    expect(laneFor(card('blocked', 'running', undefined, true))).toBe('working');
    expect(laneFor(card('idle', 'exited', 0, true))).toBe('done');
    expect(laneFor(card('idle', 'running'))).toBe('idle');
  });
});

describe('AgentBoard thread cards', () => {
  it('passes grouped into thread cards and shows runtime/harness instead of the project slug', () => {
    const source = readFileSync(new URL('../AgentBoard.tsx', import.meta.url), 'utf8');
    expect(source).toContain('threadCardRuntimeLabel');
    expect(source).toContain('threadCardShowsProject');
    expect(source).toContain('renderThreadCard(item, laneKey, grouped)');
    expect(source).toContain('{(!showProject || grouped) && <span className="agent-card-sub">{runtime}</span>}');
    expect(source).not.toContain('<span className="agent-card-sub">{item.thread.status}</span>');
    expect(source).not.toContain('? renderThreadCard(item, laneKey) :');
    expect(source).toContain('<ProviderIcon providerId={item.thread.providerId}');
    expect(source).not.toContain('MessageSquare');
  });

  it('keeps chip then status dot then favorite star on both CLI and thread cards', () => {
    const source = readFileSync(new URL('../AgentBoard.tsx', import.meta.url), 'utf8');
    const agentHeadStart = source.indexOf('<span className="agent-card-head">');
    const agentHead = source.slice(
      agentHeadStart,
      source.indexOf('{triageBadge &&', agentHeadStart)
    );
    const threadFn = source.indexOf('const renderThreadCard');
    const threadHeadStart = source.indexOf('<span className="agent-card-head">', threadFn);
    const threadHead = source.slice(
      threadHeadStart,
      source.indexOf('<span className="agent-card-meta">', threadHeadStart)
    );
    for (const head of [agentHead, threadHead]) {
      const chip = head.indexOf('FleetKindChip');
      const dot = head.indexOf('tab-agent-dot');
      const star = head.indexOf('FavoriteStar');
      expect(chip).toBeGreaterThan(-1);
      expect(dot).toBeGreaterThan(chip);
      expect(star).toBeGreaterThan(dot);
    }
    expect(threadHead).toContain("kind: 'thread'");
    expect(threadHead).not.toContain('idle for');
  });

  it('renders schedule jobs as board cards in the Scheduled lane', () => {
    const source = readFileSync(new URL('../AgentBoard.tsx', import.meta.url), 'utf8');
    expect(source).toContain('renderScheduleCard');
    expect(source).toContain('isScheduleFleet');
    expect(source).toContain('compareScheduleFleet');
    expect(source).toContain('data-kind="schedule"');
  });

  it('pans the lanes canvas on empty-space drag', () => {
    const source = readFileSync(new URL('../AgentBoard.tsx', import.meta.url), 'utf8');
    const kanban = readFileSync(
      new URL('../../../../../packages/ui/src/kanban.tsx', import.meta.url),
      'utf8'
    );
    const kanbanCss = readFileSync(
      new URL('../../../../../packages/ui/src/kanban.css', import.meta.url),
      'utf8'
    );
    expect(source).toContain("from '@zana-ai/zcc-ui/kanban'");
    expect(source).toContain('<Kanban');
    expect(source).toContain('<KanbanColumn');
    expect(kanban).toContain("import './kanban.css'");
    expect(kanbanCss).toContain('.zcc-kanban.is-panning');
    expect(kanbanCss).toMatch(/\.zcc-kanban \{[^}]*overflow:\s*auto;/);
  });
});
