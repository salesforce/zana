import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('ThreadChat host wiring', () => {
  it('forwards leadingContent and messageActions into the embedded thread', () => {
    const source = readFileSync(fileURLToPath(new URL('./plugin-runtime.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('leadingContent={props.leadingContent}');
    expect(source).toContain('messageActions={props.messageActions}');
    expect(source).toContain('includePluginMessageActions={props.includePluginMessageActions ?? false}');
  });
});
