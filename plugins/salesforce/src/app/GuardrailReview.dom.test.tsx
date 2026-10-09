/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GuardrailReview } from './GuardrailReview.js';
import { describeSourcePath, parseGuardrailPreview } from './guardrail-preview.js';

const root = '/Users/me/work/proj/force-app/main/default';
const deployInput = {
  action: 'deploy.start',
  source_paths: [
    `${root}/classes/gui_OpportunityPickerController.cls`,
    `${root}/lwc/gui_OpportunityPicker`,
    `${root}/permissionsets/gui_OpportunityPicker.permissionset-meta.xml`,
    `${root}/aiAuthoringBundles/GuiAgent_1`
  ],
  api_version: '67.0',
  test_level: 'RunSpecifiedTests',
  tests: ['gui_OpportunityPickerControllerTest'],
  target_org: 'me@example.com.dev'
};

describe('parseGuardrailPreview', () => {
  it('orders scalars and maps source paths to metadata components', () => {
    const parsed = parseGuardrailPreview(JSON.stringify(deployInput))!;
    expect(parsed.fields.map(field => field.label)).toEqual(['Action', 'Target org', 'Test level', 'Tests', 'API version', 'Components']);
    expect(parsed.fields.find(field => field.key === 'source_paths')).toMatchObject({
      kind: 'components',
      value: [
        { type: 'Apex Class', name: 'gui_OpportunityPickerController', path: 'force-app/main/default/classes/gui_OpportunityPickerController.cls' },
        { type: 'Lightning Web Component', name: 'gui_OpportunityPicker' },
        { type: 'Permission Set', name: 'gui_OpportunityPicker' },
        { type: 'AI Authoring Bundle', name: 'GuiAgent_1' }
      ]
    });
    expect(parsed.fields.find(field => field.key === 'tests')).toMatchObject({ kind: 'list', value: ['gui_OpportunityPickerControllerTest'] });
  });

  it('returns null for truncated or non-object previews', () => {
    expect(parseGuardrailPreview(JSON.stringify(deployInput).slice(0, 40))).toBeNull();
    expect(parseGuardrailPreview('["a"]')).toBeNull();
  });

  it('reads workbench metadata members, elided counts and retrieve warnings', () => {
    const parsed = parseGuardrailPreview(JSON.stringify({ action: 'retrieve.start', components: ['ApexClass:One', 'LightningComponentBundle:two', '… +3 more'] }))!;
    expect(parsed.fields.find(field => field.key === 'components')).toMatchObject({
      kind: 'components',
      more: 3,
      value: [{ type: 'Apex Class', name: 'One' }, { type: 'Lightning Component Bundle', name: 'two' }]
    });
    expect(parsed.warning).toMatch(/overwrite/);
    expect(parseGuardrailPreview('{"action":"retrieve.preview"}')!.warning).toBeUndefined();
    expect(parseGuardrailPreview('{"action":"x","warning":"Careful"}')).toMatchObject({ warning: 'Careful' });
  });

  it('names object children and humanises unknown keys', () => {
    expect(describeSourcePath(`${root}/objects/Account/fields/Tier__c.field-meta.xml`)).toMatchObject({ type: 'Custom Field', name: 'Account.Tier__c' });
    expect(parseGuardrailPreview('{"ignoreConflicts":true}')!.fields[0]).toMatchObject({ label: 'Ignore conflicts', value: 'true' });
  });
});

describe('GuardrailReview', () => {
  const nodes: Array<() => void> = [];
  afterEach(() => {
    for (const unmount of nodes.splice(0)) unmount();
  });

  async function mount(payload: Record<string, string>) {
    const submit = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const reactRoot = createRoot(el);
    nodes.push(() => {
      reactRoot.unmount();
      el.remove();
    });
    await act(async () => {
      reactRoot.render(createElement(GuardrailReview, { interaction: { payload } as never, submit, cancel }));
    });
    return { el, submit, cancel };
  }

  const base = { kind: 'org.write', orgAlias: 'dev', orgKind: 'sandbox', orgId: '00D1', summary: 'sf_metadata deploy.start on dev' };

  it('renders structured fields and components instead of raw JSON', async () => {
    const { el, submit } = await mount({ ...base, preview: JSON.stringify(deployInput) });
    expect(el.querySelector('.sf-guard-badge[data-kind=sandbox]')?.textContent).toBe('sandbox');
    expect(el.querySelector('.sf-guard-badge[data-kind=write]')).toBeTruthy();
    expect(el.textContent).toContain('Components (4)');
    expect([...el.querySelectorAll('.sf-guard-components tr')].map(row => row.textContent)).toContain('Apex Classgui_OpportunityPickerController');
    expect(el.querySelector('.sf-guard-components')?.textContent).not.toContain('/Users/me');
    expect(el.querySelector('details pre')?.textContent).toContain('"action": "deploy.start"');
    const allow = [...el.querySelectorAll('button')].find(button => button.textContent === 'Allow this action')!;
    expect(allow.className).toBe('btn primary');
    await act(async () => allow.click());
    expect(submit).toHaveBeenCalledWith({ approved: true });
  });

  it('shows retrieve warnings and the hidden component count', async () => {
    const { el } = await mount({ ...base, preview: JSON.stringify({ action: 'retrieve.start', components: ['ApexClass:One', '… +4 more'] }) });
    expect(el.querySelector('[role=alert]')?.textContent).toMatch(/overwrite/);
    expect(el.textContent).toContain('Components (5)');
    expect(el.textContent).toContain('+4 more not shown');
  });

  it('falls back to raw text when the preview is not JSON and flags production', async () => {
    const { el, cancel } = await mount({ ...base, orgKind: 'production', preview: '{"action":"deploy.st' });
    expect(el.querySelector('.sf-guard-grid')).toBeNull();
    expect(el.querySelector('pre')?.textContent).toBe('{"action":"deploy.st');
    expect([...el.querySelectorAll('button')].find(button => button.textContent === 'Allow this action')?.className).toBe('btn danger');
    await act(async () => [...el.querySelectorAll('button')].find(button => button.textContent === 'Deny')!.click());
    expect(cancel).toHaveBeenCalled();
  });
});
