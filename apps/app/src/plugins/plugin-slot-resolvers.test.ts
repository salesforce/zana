import { afterEach, describe, expect, it } from 'vitest';
import {
  composerCustomizationApplies,
  fileExtensionOf,
  parseMessageDirectives,
  readFileOpenerPins,
  resolveFileOpener,
  resolveProviderIcon,
  writeFileOpenerPin
} from './plugin-slot-resolvers.js';

const memory = new Map<string, string>();

function installStorage(): void {
  const storage = {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
    removeItem(key: string) {
      memory.delete(key);
    },
    clear() {
      memory.clear();
    }
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

installStorage();

afterEach(() => {
  memory.clear();
});

describe('plugin slot resolvers', () => {
  it('matches composer scopes and treats an empty list as all scopes', () => {
    expect(composerCustomizationApplies({ id: 'a', pluginId: 'p', generation: 1, scopes: ['thread'] }, 'thread')).toBe(true);
    expect(composerCustomizationApplies({ id: 'a', pluginId: 'p', generation: 1, scopes: ['thread'] }, 'new-thread')).toBe(false);
    expect(composerCustomizationApplies({ id: 'a', pluginId: 'p', generation: 1 }, 'new-thread')).toBe(true);
  });

  it('resolves the first matching provider icon', () => {
    const Icon = () => null;
    expect(
      resolveProviderIcon('claude-code', [
        { pluginId: 'provider-claude-code', generation: 1, providerId: 'claude-code', icon: Icon }
      ])?.pluginId
    ).toBe('provider-claude-code');
    expect(resolveProviderIcon('missing', [])).toBeNull();
  });

  it('pins a file opener and still prefers an explicit override', () => {
    const opener = {
      id: 'md',
      pluginId: 'docs',
      generation: 1,
      title: 'Docs',
      extensions: ['md'],
      component: () => null
    };
    expect(fileExtensionOf('/tmp/note.md')).toBe('md');
    expect(resolveFileOpener('/tmp/note.md', [opener])?.pluginId).toBe('docs');
    writeFileOpenerPin('md', 'host');
    expect(resolveFileOpener('/tmp/note.md', [opener])).toBeNull();
    expect(readFileOpenerPins()).toEqual({ md: 'host' });
    writeFileOpenerPin('md', 'docs/md');
    expect(resolveFileOpener('/tmp/note.md', [opener])?.id).toBe('md');
    expect(resolveFileOpener('/tmp/note.md', [opener], 'host')).toBeNull();
  });

  it('parses ::directive{attr} leaves', () => {
    const found = parseMessageDirectives('Hello\n::task{id=1 title="Ship it"}\nMore');
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('task');
    expect(found[0]?.attributes).toEqual({ id: '1', title: 'Ship it' });
  });
});
