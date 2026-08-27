import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HostMachinePicker', () => {
  it('uses a short this-machine label, status line, and icons instead of a raw FQDN', () => {
    const source = readFileSync(new URL('./HostMachinePicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('hostPickerLabel(host)');
    expect(source).toContain('hostPickerDescription(host)');
    expect(source).toContain('host-machine-picker-option');
    expect(source).toContain('<Laptop size={14}');
    expect(source).toContain('<Monitor size={14}');
    expect(source).toContain('minWidth={280}');
    expect(source).toContain('title={selectedHost?.name}');
    expect(source).not.toContain('(this machine)');
  });
});
