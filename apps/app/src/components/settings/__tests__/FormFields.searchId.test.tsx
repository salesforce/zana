// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckboxField, ChipField, Field, Section, SettingsActionRow, TextArgsField, ToggleSwitch } from '../FormFields';

afterEach(cleanup);

describe('searchId -> data-settings-target', () => {
  it('is rendered on every primitive row wrapper', () => {
    const noop = () => {};
    const { container } = render(
      <div>
        <Section title="S" searchId="s.1"><span /></Section>
        <Field label="F" searchId="f.1"><input /></Field>
        <ToggleSwitch checked={false} onChange={noop} label="T" searchId="t.1" />
        <CheckboxField label="C" checked onChange={noop} searchId="c.1" />
        <SettingsActionRow label="A" searchId="a.1"><button>x</button></SettingsActionRow>
        <ChipField label="Ch" values={[]} onChange={noop} searchId="ch.1" />
        <TextArgsField label="Ta" values={[]} onChange={noop} searchId="ta.1" />
      </div>
    );
    const ids = [...container.querySelectorAll('[data-settings-target]')].map((e) => e.getAttribute('data-settings-target'));
    expect(ids).toEqual(['s.1', 'f.1', 't.1', 'c.1', 'a.1', 'ch.1', 'ta.1']);
  });

  it('renders no attribute when searchId is absent', () => {
    const { container } = render(<Field label="F"><input /></Field>);
    expect(container.querySelector('[data-settings-target]')).toBeNull();
  });
});
