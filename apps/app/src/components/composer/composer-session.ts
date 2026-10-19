import type { JSONContent } from '@tiptap/react';
import type { PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
import type { ComposerImageAttachment } from './composer-image-attachments.js';

export const MAX_COMPOSER_SESSIONS = 100;
export const MAX_COMPOSER_IMAGE_BYTES = 128 * 1024 * 1024;
const EMPTY_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export interface ComposerSessionSnapshot {
  document?: JSONContent;
  images: ComposerImageAttachment[];
  attachments: PromptInput[];
  settings: Record<string, unknown>;
  revision: number;
}

type ComposerSelection = { from: number; to: number };
/** Last `initialText` applied and the revision it produced; an equal revision means the seed is unedited. */
type ComposerSeed = { text: string; revision: number };

export function isEmptyComposerDocument(document: JSONContent | undefined): boolean {
  return JSON.stringify(document ?? EMPTY_DOCUMENT) === JSON.stringify(EMPTY_DOCUMENT);
}

function equalSetting(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
}

/** Window-local, memory-only state. Never supplies authorization or persists File objects. */
export class ComposerSession {
  private snapshot: ComposerSessionSnapshot = { images: [], attachments: [], settings: {}, revision: 0 };
  private listeners = new Set<() => void>();
  private users = 0;
  /** Settings holding typed text (e.g. a Squad title) count as an unsent draft. */
  private contentSettingKeys = new Set<string>();
  // Not render inputs: kept out of the published snapshot so they never trigger re-renders.
  private selection: ComposerSelection | undefined;
  private seed: ComposerSeed | undefined;
  constructor(readonly retentionError?: string) {}
  getSnapshot = () => this.snapshot;
  getSelection = () => this.selection;
  getSeed = () => this.seed;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  retain() {
    this.users++;
    return () => { this.users--; };
  }
  get reclaimable() { return this.users === 0 && !this.hasContent(); }
  private hasContent(): boolean {
    const { images, attachments, document, settings } = this.snapshot;
    return images.length > 0 || attachments.length > 0 || !isEmptyComposerDocument(document)
      || [...this.contentSettingKeys].some(key => settings[key] !== undefined && settings[key] !== null && settings[key] !== '');
  }
  private publish(next: ComposerSessionSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  setContent(patch: Partial<Pick<ComposerSessionSnapshot, 'document' | 'images' | 'attachments'>>) {
    const unchanged = Object.entries(patch).every(([key, value]) => {
      if (key === 'images') {
        const images = value as ComposerImageAttachment[];
        return images.length === this.snapshot.images.length && images.every((image, index) => image === this.snapshot.images[index]);
      }
      return equalSetting(this.snapshot[key as 'document' | 'attachments'], value);
    });
    if (unchanged) return;
    if (patch.images) {
      for (const image of this.snapshot.images) {
        if (!patch.images.some(next => next.id === image.id)) URL.revokeObjectURL(image.previewSrc);
      }
    }
    this.publish({ ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 });
  }
  setSelection(selection: ComposerSelection | undefined) {
    this.selection = selection;
  }
  setSeed(seed: ComposerSeed | undefined) {
    this.seed = seed;
  }
  setSetting(key: string, value: unknown, options?: { content?: boolean }) {
    if (options?.content) this.contentSettingKeys.add(key);
    if (equalSetting(this.snapshot.settings[key], value) && Object.hasOwn(this.snapshot.settings, key)) return;
    this.publish({ ...this.snapshot, settings: { ...this.snapshot.settings, [key]: value } });
  }
  /** Returns a setting to "not chosen", so asynchronously arriving defaults apply again. */
  deleteSetting(key: string) {
    if (!Object.hasOwn(this.snapshot.settings, key)) return;
    const { [key]: _removed, ...settings } = this.snapshot.settings;
    this.publish({ ...this.snapshot, settings });
  }
  clearIfRevision(revision: number): boolean {
    if (revision !== this.snapshot.revision) return false;
    this.setContent({ document: EMPTY_DOCUMENT, images: [], attachments: [] });
    // The seed is kept: a cleared or sent prompt must not be refilled by the same seed.
    this.setSelection(undefined);
    return true;
  }
  dispose() {
    for (const image of this.snapshot.images) URL.revokeObjectURL(image.previewSrc);
    this.snapshot = { ...this.snapshot, images: [] };
    this.listeners.clear();
  }
}

const sessions = new Map<string, ComposerSession>();

export function composerSession(key: string): ComposerSession {
  const existing = sessions.get(key);
  if (existing) {
    sessions.delete(key);
    sessions.set(key, existing);
    return existing;
  }
  if (sessions.size >= MAX_COMPOSER_SESSIONS) {
    const oldest = [...sessions].find(([, session]) => session.reclaimable);
    if (!oldest) return new ComposerSession('Draft storage is full. This composer cannot retain its draft after navigation. Send or discard an existing draft first.');
    oldest[1].dispose();
    sessions.delete(oldest[0]);
  }
  const session = new ComposerSession();
  sessions.set(key, session);
  return session;
}

export function retainedComposerImageBytes(): number {
  return [...sessions.values()].reduce((total, session) => total + session.getSnapshot().images.reduce((sum, image) => sum + image.sizeBytes, 0), 0);
}

export function resetComposerSessions() {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
}
