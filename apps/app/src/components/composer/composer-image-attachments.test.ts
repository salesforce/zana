import { describe, expect, it } from 'vitest';
import {
  COMPOSER_IMAGE_LIMIT_BYTES,
  composerImageRejectReason,
  filterNonImageDroppedPaths,
  imageFilesFromClipboard,
  imageFilesFromList,
  isComposerImageFile,
  isComposerImageName,
  isHeifImageMime,
  mentionPathsAfterImageAttach,
  nextComposerImageId
} from './composer-image-attachments.js';

function file(name: string, type: string, size = 8): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('composer image attachments', () => {
  it('recognizes raster image names and MIME types, and refuses HEIC', () => {
    expect(isComposerImageName('shot.PNG')).toBe(true);
    expect(isComposerImageName('notes.txt')).toBe(false);
    expect(isComposerImageFile(file('a.png', 'image/png'))).toBe(true);
    expect(isComposerImageFile(file('a.bin', ''))).toBe(false);
    expect(isComposerImageFile(file('photo.heic', 'image/heic'))).toBe(false);
    expect(isHeifImageMime('image/heic')).toBe(true);
  });

  it('collects clipboard and file-list images and skips non-images from path drops', () => {
    const png = file('a.png', 'image/png');
    const txt = file('a.txt', 'text/plain');
    expect(isComposerImageFile(file('shot.png', ''))).toBe(true);
    expect(imageFilesFromList([png, txt])).toEqual([png]);
    const dropped = [
      { name: 'a.png', path: 'a.png' },
      { name: 'a.ts', path: 'a.ts' }
    ];
    expect(filterNonImageDroppedPaths(dropped)).toEqual([{ name: 'a.ts', path: 'a.ts' }]);
    expect(mentionPathsAfterImageAttach(dropped, [])).toEqual(dropped);
    expect(mentionPathsAfterImageAttach(dropped, [png])).toEqual([{ name: 'a.ts', path: 'a.ts' }]);
    expect(nextComposerImageId().length).toBeGreaterThan(4);

    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/heic', getAsFile: () => file('a.heic', 'image/heic') },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => png },
      { kind: 'file', type: 'image/png', getAsFile: () => png }
    ];
    expect(imageFilesFromClipboard({
      items: items as unknown as DataTransferItemList,
      files: [png] as unknown as FileList
    } as DataTransfer)).toEqual([png]);
    expect(imageFilesFromClipboard({
      items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] as unknown as DataTransferItemList,
      files: [png, png] as unknown as FileList
    } as DataTransfer)).toEqual([png]);
    expect(imageFilesFromClipboard({
      files: [png] as unknown as FileList
    } as DataTransfer)).toEqual([png]);
    expect(imageFilesFromClipboard({
      items: [
        { kind: 'file', type: 'application/pdf', getAsFile: () => file('a.pdf', 'application/pdf') }
      ] as unknown as DataTransferItemList,
      files: [png] as unknown as FileList
    } as DataTransfer)).toEqual([png]);
    expect(imageFilesFromClipboard(null)).toEqual([]);
    expect(imageFilesFromClipboard(undefined)).toEqual([]);
    const randomUUID = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
    expect(nextComposerImageId()).toMatch(/^img-/u);
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: randomUUID });
  });

  it('rejects HEIC and oversized images with a user-facing reason', () => {
    expect(composerImageRejectReason(file('a.heic', 'image/heic'))).toMatch(/HEIC/);
    expect(composerImageRejectReason(file('a.txt', 'text/plain'))).toMatch(/Only image/);
    const huge = file('a.png', 'image/png', COMPOSER_IMAGE_LIMIT_BYTES + 1);
    expect(composerImageRejectReason(huge)).toMatch(/10MB/);
    expect(composerImageRejectReason(file('a.png', 'image/png'))).toBeNull();
    expect(composerImageRejectReason(file('a.png', 'image/png; charset=binary'))).toBeNull();
  });
});
