/**
 * ManifestDetector tests.
 *
 * Uses temp dirs for bundled/user manifests so no electron state is required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManifestDetector } from '../manifest-detector.js';

const REPO_BUNDLED_DIR = join(process.cwd(), 'manifests');

describe('ManifestDetector', () => {
  let bundledDir: string;
  let userDir: string;
  let detector: ManifestDetector;

  beforeEach(() => {
    // Create temp directories for each test
    const base = mkdtempSync(join(tmpdir(), 'manifest-detector-test-'));
    bundledDir = join(base, 'bundled');
    userDir = join(base, 'user');
    mkdirSync(bundledDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });

    detector = new ManifestDetector({ bundledDir, userDir });
  });

  afterEach(() => {
    detector.stop();
    // Clean up temp dirs
    try {
      rmSync(bundledDir, { recursive: true, force: true });
      rmSync(userDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('loads claude.toml from bundled directory', () => {
    // Write a minimal claude.toml
    writeFileSync(
      join(bundledDir, 'claude.toml'),
      `
id = "claude"
version = "1.0.0"

[[rules]]
id = "test_rule"
state = "working"
priority = 100
region = "bottom_non_empty_lines(5)"
visible_working = true
contains = ["test"]
`
    );

    detector.start();
    const rules = detector.listRules('claude');
    
    expect(rules.length).toBe(1);
    expect(rules[0].id).toBe('test_rule');
    expect(rules[0].state).toBe('working');
    expect(rules[0].priority).toBe(100);
    expect(rules[0].region).toBe('bottom_non_empty_lines(5)');
    expect(rules[0].visible_working).toBe(true);
    expect(rules[0].contains).toEqual(['test']);
  });

  it('user manifest overrides bundled manifest with same id', () => {
    // Bundled manifest
    writeFileSync(
      join(bundledDir, 'agent.toml'),
      `
id = "agent"
version = "1.0.0"

[[rules]]
id = "bundled_rule"
state = "idle"
priority = 50
region = "whole_recent"
`
    );

    // User manifest (same id)
    writeFileSync(
      join(userDir, 'agent.toml'),
      `
id = "agent"
version = "2.0.0"

[[rules]]
id = "user_rule"
state = "working"
priority = 100
region = "prompt_box_body"
`
    );

    detector.start();
    const rules = detector.listRules('agent');
    
    // User manifest should completely replace bundled
    expect(rules.length).toBe(1);
    expect(rules[0].id).toBe('user_rule');
    expect(rules[0].priority).toBe(100);
  });

  it('listRules returns rules sorted by priority descending', () => {
    writeFileSync(
      join(bundledDir, 'test.toml'),
      `
id = "test"

[[rules]]
id = "low"
state = "idle"
priority = 10
region = "whole_recent"

[[rules]]
id = "high"
state = "working"
priority = 100
region = "whole_recent"

[[rules]]
id = "medium"
state = "blocked"
priority = 50
region = "whole_recent"
`
    );

    detector.start();
    const rules = detector.listRules('test');
    
    expect(rules.length).toBe(3);
    expect(rules[0].id).toBe('high'); // priority 100
    expect(rules[1].id).toBe('medium'); // priority 50
    expect(rules[2].id).toBe('low'); // priority 10
  });

  it('resolves agent by alias', () => {
    writeFileSync(
      join(bundledDir, 'claude.toml'),
      `
id = "claude"
aliases = ["claude-code", "cc"]

[[rules]]
id = "test"
state = "idle"
priority = 50
region = "whole_recent"
`
    );

    detector.start();
    
    // Should work by id
    expect(detector.listRules('claude').length).toBe(1);
    
    // Should work by aliases
    expect(detector.listRules('claude-code').length).toBe(1);
    expect(detector.listRules('cc').length).toBe(1);
    
    // Unknown agent
    expect(detector.listRules('unknown').length).toBe(0);
  });

  it('returns empty array for unknown agent', () => {
    detector.start();
    expect(detector.listRules('nonexistent')).toEqual([]);
  });

  it('reload re-scans directories and emits changed event', () => {
    detector.start();
    expect(detector.listRules('new').length).toBe(0);

    // Set up event listener
    let changeCount = 0;
    detector.on('changed', () => changeCount++);

    // Write a new manifest
    writeFileSync(
      join(bundledDir, 'new.toml'),
      `
id = "new"

[[rules]]
id = "new_rule"
state = "idle"
priority = 75
region = "whole_recent"
`
    );

    // Manually reload
    detector.reload();
    
    expect(detector.listRules('new').length).toBe(1);
    expect(changeCount).toBe(1);
  });

  it('skips malformed TOML files without throwing', () => {
    // Valid manifest
    writeFileSync(
      join(bundledDir, 'good.toml'),
      `
id = "good"

[[rules]]
id = "good_rule"
state = "idle"
priority = 50
region = "whole_recent"
`
    );

    // Malformed manifest
    writeFileSync(
      join(bundledDir, 'bad.toml'),
      `
id = "bad"
this is not valid TOML [[[
`
    );

    // Should not throw
    expect(() => detector.start()).not.toThrow();
    
    // Good manifest should load
    expect(detector.listRules('good').length).toBe(1);
    
    // Bad manifest should be skipped
    expect(detector.listRules('bad').length).toBe(0);
  });

  it('parses all matcher field types', () => {
    writeFileSync(
      join(bundledDir, 'matchers.toml'),
      `
id = "matchers"

[[rules]]
id = "complex_rule"
state = "blocked"
priority = 80
region = "after_last_horizontal_rule"
visible_blocker = true
contains = ["enter to select", "esc to cancel"]
regex = ['^test']
line_regex = ['^\\s*/btw(?:\\s|$)', '(?i)esc to close\\s*$']

[[rules.any]]
contains = ["tab/arrow keys"]

[[rules.any]]
contains = ["arrow keys"]

[[rules]]
id = "with_all_not"
state = "idle"
priority = 60
region = "prompt_box_body"

[[rules.all]]
regex = ['yes']

[[rules.not]]
contains = ["enter to select"]
`
    );

    detector.start();
    const rules = detector.listRules('matchers');
    
    expect(rules.length).toBe(2);
    
    const rule1 = rules.find(r => r.id === 'complex_rule')!;
    expect(rule1.contains).toEqual(['enter to select', 'esc to cancel']);
    expect(rule1.regex).toEqual(['^test']);
    expect(rule1.line_regex).toHaveLength(2);
    expect(rule1.any).toHaveLength(2);
    
    const rule2 = rules.find(r => r.id === 'with_all_not')!;
    expect(rule2.all).toHaveLength(1);
    expect(rule2.not).toHaveLength(1);
  });

  it('handles missing directories gracefully', () => {
    // Create detector with non-existent dirs
    const missingBundled = join(tmpdir(), 'does-not-exist-bundled');
    const missingUser = join(tmpdir(), 'does-not-exist-user');
    
    const d = new ManifestDetector({
      bundledDir: missingBundled,
      userDir: missingUser
    });

    // Should not throw
    expect(() => d.start()).not.toThrow();
    expect(d.listRules('anything')).toEqual([]);
    
    d.stop();
  });

  it('loads the committed bundled claude.toml (herdr format, nested gates)', () => {
    if (!existsSync(join(REPO_BUNDLED_DIR, 'claude.toml'))) {
      // Bundled set not present in this checkout — skip rather than fail.
      return;
    }
    const d = new ManifestDetector({
      bundledDir: REPO_BUNDLED_DIR,
      userDir: join(tmpdir(), 'manifest-detector-no-user-xyz')
    });
    d.reload();
    const rules = d.listRules('claude');
    // Multiple rules parse, including ones with nested any/all/not and escaped
    // regex — proves herdr's real manifest round-trips through the parser.
    expect(rules.length).toBeGreaterThan(1);
    // Sorted highest-priority-first: the osc_title working rule (1100) leads.
    expect(rules[0].id).toBe('osc_title_working');
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1].priority).toBeGreaterThanOrEqual(rules[i].priority);
    }
    // Alias declared in claude.toml resolves to the same rule set.
    expect(d.listRules('claude-code').length).toBe(rules.length);
    d.stop();
  });
});
