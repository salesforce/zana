import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentDraftSource, createAgentDraft, draftDestination, DRAFT_METADATA } from '../lib/agent-drafts.js';
import { suggestedAgentName } from '../lib/agent-draft-contract.js';
import { parseAgentScriptSource } from '../lib/agent-script-parse.js';
const roots: string[] = [];
const root = () => { const path = mkdtempSync(join(tmpdir(), 'sf-draft-')); roots.push(path); return path; };
const input = { name: 'Support & help', apiName: 'Support', purpose: 'Be helpful.\n"Quote" < & >' };
afterEach(() => { roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

describe('local agent creation', () => {
  it('creates a paired valid draft in a managed DX child without an org or root config', () => {
    const project = root();
    expect(draftDestination(project)).toMatchObject({ initializesProject: true, directory: 'agentforce-drafts/force-app/main/default/aiAuthoringBundles' });
    const file = createAgentDraft(project, input);
    expect(file.projectRoot).toBe('agentforce-drafts');
    expect(existsSync(join(project, 'sfdx-project.json'))).toBe(false);
    expect(readFileSync(join(project, file.metadataPath), 'utf8')).toBe(DRAFT_METADATA);
    const source = readFileSync(join(project, file.path), 'utf8');
    expect(parseAgentScriptSource(source, 'agentforce').hasErrors).toBe(false);
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(draftDestination(project).initializesProject).toBe(false);
    expect(() => createAgentDraft(project, input)).toThrow('already exists');
    expect(readFileSync(join(project, file.path), 'utf8')).toBe(source);
    expect(readdirSync(join(project, 'agentforce-drafts/force-app/main/default/aiAuthoringBundles'))).toEqual(['Support']);
    createAgentDraft(project, { name: 'Next', apiName: 'Next' });
  });
  it('uses the declared default package and escapes all free text', () => {
    const project = root(); writeFileSync(join(project, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'one' }, { path: 'packages/two', default: true }] }));
    const file = createAgentDraft(project, input);
    expect(file.path).toBe('packages/two/main/default/aiAuthoringBundles/Support/Support.agent');
    expect(file.projectRoot).toBe('.');
    expect(agentDraftSource(input)).toContain(JSON.stringify(input.purpose));
    expect(suggestedAgentName('123 Élite service !!')).toBe('Elite_service');
  });
  it('copies source into a new unversioned identity without inherited metadata', () => {
    const source = agentDraftSource(input);
    const file = createAgentDraft(root(), { ...input, apiName: 'Copy', source });
    expect(file.apiName).toBe('Copy');
    expect(agentDraftSource({ ...input, apiName: 'Copy', source })).toContain('agent_name: "Copy"');
    expect(() => agentDraftSource({ ...input, source: 'missing config' })).toThrow('agent_name');
  });
  it.each(['../Outside', '/absolute', 'bad__name', 'bad_', '1Bad', 'bad-name', '', 'a'.repeat(81)])('rejects unsafe API name %s without writes', apiName => {
    const project = root(); expect(() => createAgentDraft(project, { ...input, apiName })).toThrow('API name'); expect(readdirSync(project)).toEqual([]);
  });
  it('bounds input and refuses invalid project/configuration', () => {
    expect(() => agentDraftSource({ ...input, name: '' })).toThrow('name');
    expect(() => agentDraftSource({ ...input, name: 'a\nb' })).toThrow('name');
    expect(() => agentDraftSource({ ...input, purpose: 'a'.repeat(4001) })).toThrow('Purpose');
    expect(() => agentDraftSource({ ...input, source: '' })).toThrow('source');
    const project = root(); writeFileSync(join(project, 'file'), 'x');
    expect(() => draftDestination(join(project, 'file'))).toThrow('local project');
    writeFileSync(join(project, 'sfdx-project.json'), '{"packageDirectories":[]}');
    expect(() => draftDestination(project)).toThrow('no package');
    writeFileSync(join(project, 'sfdx-project.json'), '{"packageDirectories":[{}]}');
    expect(() => draftDestination(project)).toThrow('Invalid');
  });
  it.each(['../escape', '/tmp/outside', 'a/../../b', 'a\\b', 'C:/outside', '.'])('refuses unconfined package %s', path => {
    const project = root(); writeFileSync(join(project, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path }] }));
    expect(() => createAgentDraft(project, input)).toThrow('inside');
  });
  it('refuses symlinked project, package, manifest and destination entries', () => {
    const outside = root(); const project = root();
    symlinkSync(outside, join(project, 'agentforce-drafts'));
    expect(() => createAgentDraft(project, input)).toThrow('symbolic');
    rmSync(join(project, 'agentforce-drafts')); writeFileSync(join(outside, 'manifest'), '{"packageDirectories":[{"path":"force-app"}]}');
    symlinkSync(join(outside, 'manifest'), join(project, 'sfdx-project.json'));
    expect(() => draftDestination(project)).toThrow('configuration');
    rmSync(join(project, 'sfdx-project.json')); writeFileSync(join(project, 'sfdx-project.json'), '{"packageDirectories":[{"path":"force-app"}]}');
    symlinkSync(outside, join(project, 'force-app'));
    expect(() => createAgentDraft(project, input)).toThrow('symbolic');
    rmSync(join(project, 'force-app')); mkdirSync(join(project, 'force-app/main/default/aiAuthoringBundles'), { recursive: true });
    symlinkSync(outside, join(project, 'force-app/main/default/aiAuthoringBundles/Support'));
    expect(() => createAgentDraft(project, input)).toThrow('already exists');
    expect(readdirSync(outside)).toEqual(['manifest']);
  });
});
