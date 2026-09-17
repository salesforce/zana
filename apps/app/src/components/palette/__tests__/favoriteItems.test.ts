import { describe, expect, it } from 'vitest';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { favoritePaletteKeys } from '../favoriteItems.js';

const project = (id: string, favorite = false) => ({ id, favorite }) as Project;
const session = (id: string, claudeSessionId?: string) => ({ id, claudeSessionId }) as TerminalSession;

describe('palette favorites', () => {
  it('combines project stars, namespaced thread follows, and CLI-session favorites', () => {
    const keys = favoritePaletteKeys([project('starred', true), project('plain')], {
      starred: [session('pty-new', 'conversation'), session('shell'), session('other')]
    }, { conversation: true, shell: true, 'thread:review': true, 'old-session': true });
    expect([...keys]).toEqual(['project:starred', 'thread:review', 'tab:pty-new', 'tab:shell']);
  });

  it('keeps restored CLI favorites attached to their stable conversation id', () => {
    const ids = { conversation: true } as const;
    expect(favoritePaletteKeys([], { p: [session('before', 'conversation')] }, ids).has('tab:before')).toBe(true);
    const restored = favoritePaletteKeys([], { p: [session('after', 'conversation')] }, ids);
    expect(restored.has('tab:after')).toBe(true);
    expect(restored.has('tab:before')).toBe(false);
  });

  it('keeps namespaces distinct and never treats a project star as following every agent in it', () => {
    const keys = favoritePaletteKeys([project('same', true)], { same: [session('same')] }, { 'thread:same': true });
    expect(keys.has('project:same')).toBe(true);
    expect(keys.has('thread:same')).toBe(true);
    expect(keys.has('tab:same')).toBe(false);
  });

  it('reflects removing favorites without writing to their sources', () => {
    const projects = [project('p')];
    const sessions = { p: [session('s')] };
    const favoriteIds = {};
    expect(favoritePaletteKeys(projects, sessions, favoriteIds).size).toBe(0);
    expect(projects[0].favorite).toBe(false);
    expect(favoriteIds).toEqual({});
  });
});
