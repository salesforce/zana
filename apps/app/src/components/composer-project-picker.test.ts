import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COMPOSER_NEW_PROJECT_LABEL,
  COMPOSER_NEW_PROJECT_VALUE,
  COMPOSER_NO_PROJECT_LABEL,
  COMPOSER_NO_PROJECT_VALUE,
  composerProjectPickerRows,
  resolveComposerProjectPickerChange
} from './composer-project-picker.js';
import { DEFAULT_COMPOSER_WORKSPACE_LABEL, SCRATCH_WORKSPACE_NAME } from './composer-project-default.js';

const alpha = { id: 'alpha', name: 'alpha-repo' };
const scratch = { id: 'scratch-1', name: SCRATCH_WORKSPACE_NAME, quickAgent: true };
const coreRepo = { id: 'core-repo', name: 'zana-command-center' };

describe('composerProjectPickerRows', () => {
  it('lists projects then New project and Do not work in a project', () => {
    expect(composerProjectPickerRows([alpha, scratch, coreRepo])).toEqual([
      { value: 'scratch-1', label: DEFAULT_COMPOSER_WORKSPACE_LABEL },
      { value: 'alpha', label: 'alpha-repo' },
      { value: 'core-repo', label: 'zana-command-center' },
      {
        value: COMPOSER_NEW_PROJECT_VALUE,
        label: COMPOSER_NEW_PROJECT_LABEL,
        sticky: true,
        action: 'new-project'
      },
      {
        value: COMPOSER_NO_PROJECT_VALUE,
        label: COMPOSER_NO_PROJECT_LABEL,
        sticky: true,
        action: 'no-project'
      }
    ]);
  });
});

describe('resolveComposerProjectPickerChange', () => {
  it('opens the folder picker for New project', () => {
    expect(resolveComposerProjectPickerChange(COMPOSER_NEW_PROJECT_VALUE, [scratch, coreRepo])).toEqual({
      type: 'new-project'
    });
  });

  it('maps no-project to zcc-workspace', () => {
    expect(resolveComposerProjectPickerChange(COMPOSER_NO_PROJECT_VALUE, [coreRepo, scratch, alpha])).toEqual({
      type: 'project',
      projectId: 'scratch-1'
    });
  });

  it('falls through to an empty id when scratch is not registered yet', () => {
    expect(resolveComposerProjectPickerChange(COMPOSER_NO_PROJECT_VALUE, [coreRepo, alpha])).toEqual({
      type: 'project',
      projectId: ''
    });
  });

  it('keeps a concrete project selection', () => {
    expect(resolveComposerProjectPickerChange('core-repo', [scratch, coreRepo])).toEqual({
      type: 'project',
      projectId: 'core-repo'
    });
  });
});

describe('ComposerProjectPicker', () => {
  it('opens the native folder finder on desktop and falls back to the path dialog on web', () => {
    const source = readFileSync(new URL('./ComposerProjectPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('hasDesktopBridge()');
    expect(source).toContain('addProject()');
    expect(source).toContain('AddLocalProjectDialog');
    expect(source).toContain('product.projects.pickDirectory()');
    expect(source).toContain('FolderPlus');
    expect(source).toContain('FolderX');
    expect(source).toContain('COMPOSER_NEW_PROJECT_LABEL');
    expect(source).toContain('COMPOSER_NO_PROJECT_LABEL');
    expect(source).toContain('emptyHint="No matching projects"');
    expect(source).toContain('sticky: row.sticky');
    expect(source).toContain("ariaLabel=\"Project\"");
    expect(source).not.toContain('showOpenDialog');
    expect(source).not.toContain('composer-project-action-start');

    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.composer-project-picker-option');
    const split = css.slice(
      css.indexOf('.launch-model-picker-menu--split {'),
      css.indexOf('.launch-model-picker-search {')
    );
    expect(split).toContain('overflow: hidden;');
    expect(split).toContain('flex-direction: column;');
    const options = css.slice(
      css.indexOf('.launch-model-picker-options {'),
      css.indexOf('.launch-model-picker-footer {')
    );
    expect(options).toContain('overflow-y: auto;');
    expect(options).toContain('min-height: 0;');
  });
});
