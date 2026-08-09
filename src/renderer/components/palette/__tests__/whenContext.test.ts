import { describe, it, expect } from 'vitest';
import { evaluateWhen, type WhenContext } from '../whenContext.js';

const base: WhenContext = {
  activeNav: 'projects',
  hasActiveProject: true,
  hasActiveTab: true,
  tabCount: 3,
  activeTabStatus: 'running',
  activeTabProfile: 'claude',
  workspaceMode: 'terminals',
  platform: 'darwin',
  panelFocused: false,
  scopedWindow: false
};

function ev(expr: string | undefined, ctx: Partial<WhenContext> = {}): boolean {
  return evaluateWhen(expr, { ...base, ...ctx });
}

describe('evaluateWhen', () => {
  it('shows the command when expr is absent or empty', () => {
    expect(ev(undefined)).toBe(true);
    expect(ev('')).toBe(true);
    expect(ev('   ')).toBe(true);
  });

  it('truthy-tests a bare boolean key', () => {
    expect(ev('hasActiveProject')).toBe(true);
    expect(ev('hasActiveProject', { hasActiveProject: false })).toBe(false);
    expect(ev('panelFocused')).toBe(false);
  });

  it('truthy-tests numbers and strings', () => {
    expect(ev('tabCount')).toBe(true);
    expect(ev('tabCount', { tabCount: 0 })).toBe(false);
    expect(ev('activeTabStatus')).toBe(true);
    expect(ev('activeTabStatus', { activeTabStatus: '' })).toBe(false);
  });

  it('supports == and != comparisons against bare idents and strings', () => {
    expect(ev('activeNav == projects')).toBe(true);
    expect(ev('activeNav == settings')).toBe(false);
    expect(ev('activeNav != settings')).toBe(true);
    expect(ev("workspaceMode == 'terminals'")).toBe(true);
    expect(ev('workspaceMode == "explorer"')).toBe(false);
  });

  it('supports numeric comparison', () => {
    expect(ev('tabCount == 3')).toBe(true);
    expect(ev('tabCount == 2')).toBe(false);
  });

  it('supports !, &&, ||, and parentheses', () => {
    expect(ev('!panelFocused')).toBe(true);
    expect(ev('hasActiveProject && hasActiveTab')).toBe(true);
    expect(ev('hasActiveProject && panelFocused')).toBe(false);
    expect(ev('panelFocused || hasActiveProject')).toBe(true);
    expect(ev('(panelFocused || hasActiveProject) && workspaceMode == terminals')).toBe(true);
    expect(ev('panelFocused || (hasActiveTab && tabCount == 1)')).toBe(false);
  });

  it('fails closed (hidden) on an unknown context key', () => {
    expect(ev('projectPath')).toBe(false);       // sensitive key — not in vocab
    expect(ev('sessionContents == x')).toBe(false);
    expect(ev('hasActiveProject && secretKey')).toBe(false);
  });

  it('fails closed on a malformed expression', () => {
    expect(ev('hasActiveProject &&')).toBe(false);
    expect(ev('== projects')).toBe(false);
    expect(ev('(hasActiveProject')).toBe(false);
    expect(ev('hasActiveProject ===')).toBe(false);
    expect(ev('&^%$')).toBe(false);
  });
});
