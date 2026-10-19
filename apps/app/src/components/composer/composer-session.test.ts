import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composerSession, resetComposerSessions, MAX_COMPOSER_SESSIONS } from './composer-session.js';

beforeEach(resetComposerSessions);

describe('composer sessions', () => {
  it('retains content and settings by identity and isolates other surfaces', () => {
    const chat = composerSession('thread:a');
    chat.setContent({ document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }] } });
    chat.setSetting('modern.model', 'chosen-model');
    expect(composerSession('thread:a')).toBe(chat);
    expect(chat.getSnapshot().settings['modern.model']).toBe('chosen-model');
    expect(composerSession('thread:b').getSnapshot().document).toBeUndefined();
  });

  it('clears only the submitted revision and keeps configuration', () => {
    const session = composerSession('a');
    session.setContent({ document: { type: 'doc' } });
    session.setSetting('permission', 'auto');
    const revision = session.getSnapshot().revision;
    session.setContent({ document: { type: 'doc', content: [{ type: 'paragraph' }] } });
    expect(session.clearIfRevision(revision)).toBe(false);
    const next = session.getSnapshot().revision;
    session.setSetting('model', 'new-model');
    expect(session.clearIfRevision(next)).toBe(true);
    expect(session.getSnapshot().settings).toEqual({ permission: 'auto', model: 'new-model' });
    expect(session.getSnapshot().document).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('does not invalidate a submission for an editor update with unchanged content', () => {
    const session = composerSession('editor');
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Submitted' }] }] };
    session.setContent({ document });
    const revision = session.getSnapshot().revision;
    session.setContent({ document: structuredClone(document) });
    expect(session.clearIfRevision(revision)).toBe(true);
  });

  it('notifies subscribers and releases image previews only when removed', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const session = composerSession('a');
    const listener = vi.fn();
    const off = session.subscribe(listener);
    const image = { id: 'image', previewSrc: 'blob:image', sizeBytes: 1 } as any;
    session.setContent({ images: [image] });
    expect(revoke).not.toHaveBeenCalled();
    session.clearIfRevision(session.getSnapshot().revision);
    expect(revoke).toHaveBeenCalledWith('blob:image');
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    session.setSetting('model', 'm');
    expect(listener).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });

  it('does not notify or loop when an async default repeats an equivalent object', () => {
    const session = composerSession('defaults');
    const listener = vi.fn();
    session.subscribe(listener);
    session.setSetting('workspace', { kind: 'personal' });
    session.setSetting('workspace', { kind: 'personal' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps identical attachment arrays at the same revision but detects replacements', () => {
    const session = composerSession('attachments');
    const image = { id: 'a', previewSrc: 'blob:a', sizeBytes: 1 } as any;
    session.setContent({ images: [image] });
    const revision = session.getSnapshot().revision;
    session.setContent({ images: [image] });
    expect(session.getSnapshot().revision).toBe(revision);
    session.setContent({ images: [{ ...image, file: { name: 'replacement' } }] });
    expect(session.getSnapshot().revision).toBe(revision + 1);
  });

  it('bounds retained sessions without evicting active or unsent work', () => {
    for (let i = 0; i < MAX_COMPOSER_SESSIONS; i++) {
      composerSession(String(i)).setContent({ document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: String(i) }] }] } });
    }
    const overflow = composerSession('overflow');
    expect(overflow.retentionError).toMatch(/draft storage/i);
    expect(composerSession('0').getSnapshot().document?.content?.[0]?.content?.[0]?.text).toBe('0');
  });

  it('reclaims inactive empty sessions, not mounted sessions', () => {
    const active = composerSession('active');
    const release = active.retain();
    for (let i = 1; i < MAX_COMPOSER_SESSIONS; i++) composerSession(String(i));
    expect(composerSession('next').retentionError).toBeUndefined();
    expect(composerSession('active')).toBe(active);
    release();
  });

  it('deletes a setting so it reads as never chosen', () => {
    const session = composerSession('delete');
    session.deleteSetting('missing');
    const listener = vi.fn();
    session.subscribe(listener);
    session.setSetting('modern.model', 'picked');
    session.deleteSetting('modern.model');
    expect(Object.hasOwn(session.getSnapshot().settings, 'modern.model')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('never evicts a session whose only draft is typed content settings', () => {
    const squad = composerSession('squad');
    squad.setSetting('team.title', 'Release squad', { content: true });
    const blank = composerSession('blank-content');
    blank.setSetting('team.title', '', { content: true });
    composerSession('config-only').setSetting('modern.model', 'm');
    for (let index = 3; index < MAX_COMPOSER_SESSIONS; index++) composerSession(`filler:${index}`).setSetting('team.title', 'x', { content: true });
    composerSession('overflow-1');
    composerSession('overflow-2');
    expect(composerSession('squad')).toBe(squad);
    expect(composerSession('blank-content')).not.toBe(blank);
  });

  it('keeps the seed record through a clear but not as content', () => {
    const session = composerSession('seeded');
    session.setContent({ document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Seed' }] }] } });
    session.setSeed({ text: 'Seed', revision: session.getSnapshot().revision });
    expect(session.clearIfRevision(session.getSnapshot().revision)).toBe(true);
    expect(session.getSeed()?.text).toBe('Seed');
    expect(session.reclaimable).toBe(true);
  });

  it('stores selection and seed without publishing a new snapshot', () => {
    const session = composerSession('quiet-selection');
    const before = session.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.setSelection({ from: 2, to: 4 });
    session.setSeed({ text: 'Quiet', revision: before.revision });
    expect(session.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(session.getSelection()).toEqual({ from: 2, to: 4 });
    expect(session.getSeed()).toEqual({ text: 'Quiet', revision: before.revision });
    unsubscribe();
  });
});
