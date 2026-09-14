import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_OVERVIEW_MAX_CHARS,
  parsePluginOverviewMarkdown
} from './plugin-overview.js';

describe('parsePluginOverviewMarkdown', () => {
  it('accepts a short What you get overview', () => {
    const parsed = parsePluginOverviewMarkdown(
      'Use ACP agents in ZCC.\n\n## What you get\n\n- Cursor and OpenCode providers.\n'
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.overview).toContain('## What you get');
  });

  it('rejects empty, oversized, and HTML or image markup', () => {
    expect(parsePluginOverviewMarkdown('   \n')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePluginOverviewMarkdown(`${'a'.repeat(MARKETPLACE_OVERVIEW_MAX_CHARS + 1)}\n`)).toEqual({
      ok: false,
      reason: 'too-long'
    });
    expect(parsePluginOverviewMarkdown('Hello <script>x</script>\n')).toEqual({
      ok: false,
      reason: 'unsafe'
    });
    expect(parsePluginOverviewMarkdown('See ![logo](https://example.test/a.png)\n')).toEqual({
      ok: false,
      reason: 'unsafe'
    });
  });

  it('allows angle brackets and images inside fenced or inline code', () => {
    expect(parsePluginOverviewMarkdown('Use `<script>` in a setting.\n').ok).toBe(true);
    expect(parsePluginOverviewMarkdown('```\n![skip](x.png)\n```\n').ok).toBe(true);
  });
});
