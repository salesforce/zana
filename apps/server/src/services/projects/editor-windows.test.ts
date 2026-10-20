import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  realWindowsEditorFs,
  resolveWindowsEditor,
  resolveWindowsEditorLaunch,
  windowsEditorVersion,
  type WindowsEditorFs
} from './editor-windows.js';

/**
 * In-memory Windows filesystem keyed by case-insensitive win32 paths, so the
 * resolver runs the same on a Linux/macOS CI runner as on Windows.
 */
function fakeFs(files: Record<string, string>, env: NodeJS.ProcessEnv = {}): WindowsEditorFs {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const byPath = new Map(Object.entries(files).map(([p, text]) => [norm(p), text]));
  return {
    env,
    isFile: async (p) => byPath.has(norm(p)),
    readText: async (p, maxBytes) => {
      const text = byPath.get(norm(p));
      return text === undefined || text.length > maxBytes ? null : text;
    },
    listDir: async (p) => {
      const prefix = `${norm(p)}\\`;
      const children = Object.keys(files).filter((f) => norm(f).startsWith(prefix));
      return [...new Set(children.map((f) => f.slice(prefix.length).split('\\')[0]))];
    }
  };
}

const VSCODE_SHIM =
  '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\Code.exe" "%~dp0..\\6d62b1d5da\\resources\\app\\out\\cli.js" %*\r\nendlocal\r\n';

describe('resolveWindowsEditor', () => {
  it('follows the code.cmd shim on PATH to Code.exe, skipping the extensionless POSIX script', async () => {
    const fs = fakeFs(
      {
        'C:\\Microsoft VS Code\\bin\\code': '#!/usr/bin/env sh',
        'C:\\Microsoft VS Code\\bin\\code.cmd': VSCODE_SHIM,
        'C:\\Microsoft VS Code\\Code.exe': ''
      },
      { Path: 'C:\\Windows;"C:\\Microsoft VS Code\\bin"', PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    );
    expect(await resolveWindowsEditor('code', 'code', fs)).toBe('C:\\Microsoft VS Code\\Code.exe');
  });

  it('follows the Cursor shim that sits three folders below Cursor.exe', async () => {
    const fs = fakeFs(
      {
        'D:\\Apps\\cursor\\resources\\app\\bin\\cursor.cmd': '@echo off\r\n"%~dp0..\\..\\..\\Cursor.exe" "%~dp0..\\out\\cli.js" %*\r\n',
        'D:\\Apps\\cursor\\Cursor.exe': ''
      },
      { PATH: 'D:\\Apps\\cursor\\resources\\app\\bin' }
    );
    expect(await resolveWindowsEditor('cursor', 'cursor', fs)).toBe('D:\\Apps\\cursor\\Cursor.exe');
  });

  it('reads an absolute exe from a Toolbox-style script, ignoring unexpanded variables', async () => {
    const fs = fakeFs(
      {
        'C:\\Toolbox\\scripts\\idea.cmd': '@echo off\r\nstart "" "%IDEA_HOME%\\idea64.exe"\r\nstart "" "C:\\JB\\IDEA\\bin\\idea64.exe" %*\r\n',
        'C:\\JB\\IDEA\\bin\\idea64.exe': ''
      },
      { PATH: 'C:\\Toolbox\\scripts' }
    );
    expect(await resolveWindowsEditor('intellij', 'idea', fs)).toBe('C:\\JB\\IDEA\\bin\\idea64.exe');
  });

  it('uses the sibling idea64.exe next to the idea.bat launcher', async () => {
    const fs = fakeFs(
      { 'C:\\IDEA\\bin\\idea.bat': '@echo off\r\n:: java launcher\r\n', 'C:\\IDEA\\bin\\idea64.exe': '' },
      { PATH: 'C:\\IDEA\\bin' }
    );
    expect(await resolveWindowsEditor('intellij', 'idea', fs)).toBe('C:\\IDEA\\bin\\idea64.exe');
  });

  it('accepts a configured absolute exe, or a path without its extension', async () => {
    const fs = fakeFs({ 'E:\\Tools\\Code.exe': '' }, { PATHEXT: '.EXE;.CMD' });
    expect(await resolveWindowsEditor('code', 'E:\\Tools\\Code.exe', fs)).toBe('E:\\Tools\\Code.exe');
    expect(await resolveWindowsEditor('code', 'E:\\Tools\\Code', fs)).toBe('E:\\Tools\\Code.exe');
  });

  it('falls back to the default per-user and machine-wide install folders', async () => {
    const local = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
    expect(
      await resolveWindowsEditor('code', 'code', fakeFs({ 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe': '' }, local))
    ).toBe('C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe');
    expect(
      await resolveWindowsEditor('cursor', '', fakeFs({ 'C:\\Program Files\\Cursor\\Cursor.exe': '' }, { ProgramFiles: 'C:\\Program Files' }))
    ).toBe('C:\\Program Files\\Cursor\\Cursor.exe');
  });

  it('picks the newest IntelliJ IDEA install folder', async () => {
    const fs = fakeFs(
      {
        'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2024.9\\bin\\idea64.exe': '',
        'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2024.10\\bin\\idea64.exe': '',
        'C:\\Program Files\\JetBrains\\PyCharm 2024.1\\bin\\pycharm64.exe': ''
      },
      { PROGRAMFILES: 'C:\\Program Files' }
    );
    expect(await resolveWindowsEditor('intellij', 'idea', fs)).toBe('C:\\Program Files\\JetBrains\\IntelliJ IDEA 2024.10\\bin\\idea64.exe');
  });

  it('ranks IntelliJ folders from every install root together, by version not edition name', async () => {
    const env = { LOCALAPPDATA: 'C:\\Local', PROGRAMFILES: 'C:\\PF' };
    const fs = fakeFs(
      {
        'C:\\Local\\Programs\\IntelliJ IDEA 2024.3\\bin\\idea64.exe': '',
        'C:\\PF\\JetBrains\\IntelliJ IDEA Community Edition 2025.2\\bin\\idea64.exe': '',
        'C:\\PF\\JetBrains\\IntelliJ IDEA 2025.1.4\\bin\\idea64.exe': ''
      },
      env
    );
    expect(await resolveWindowsEditor('intellij', 'idea', fs)).toBe('C:\\PF\\JetBrains\\IntelliJ IDEA Community Edition 2025.2\\bin\\idea64.exe');
    // Equal versions fall back to the name; a folder without a version comes last.
    const ties = fakeFs(
      {
        'C:\\Local\\Programs\\IntelliJ IDEA\\bin\\idea64.exe': '',
        'C:\\PF\\JetBrains\\IntelliJ IDEA Community Edition 2025.2\\bin\\idea64.exe': '',
        'C:\\PF\\JetBrains\\IntelliJ IDEA Ultimate 2025.2\\bin\\idea64.exe': ''
      },
      env
    );
    expect(await resolveWindowsEditor('intellij', 'idea', ties)).toBe('C:\\PF\\JetBrains\\IntelliJ IDEA Ultimate 2025.2\\bin\\idea64.exe');
    const unversioned = fakeFs(
      {
        'C:\\Local\\Programs\\IntelliJ IDEA\\bin\\idea64.exe': '',
        'C:\\PF\\JetBrains\\IntelliJ IDEA 2023.1\\bin\\idea64.exe': ''
      },
      env
    );
    expect(await resolveWindowsEditor('intellij', 'idea', unversioned)).toBe('C:\\PF\\JetBrains\\IntelliJ IDEA 2023.1\\bin\\idea64.exe');
  });

  it('returns null when neither a shim nor an install is found', async () => {
    const fs = fakeFs(
      { 'C:\\bin\\code.cmd': '@echo off\r\n"%~dp0missing.exe" %*\r\n' },
      { PATH: 'C:\\bin', LOCALAPPDATA: 'C:\\Local', PROGRAMFILES: 'C:\\PF' }
    );
    expect(await resolveWindowsEditor('code', 'code', fs)).toBeNull();
    expect(await resolveWindowsEditor('intellij', 'idea', fakeFs({}))).toBeNull();
  });
});

describe('resolveWindowsEditorLaunch', () => {
  it('takes VS Code’s cli.js from the code.cmd shim on PATH', async () => {
    const fs = fakeFs(
      {
        'C:\\Microsoft VS Code\\bin\\code.cmd': VSCODE_SHIM,
        'C:\\Microsoft VS Code\\Code.exe': '',
        'C:\\Microsoft VS Code\\6d62b1d5da\\resources\\app\\out\\cli.js': ''
      },
      { PATH: 'C:\\Microsoft VS Code\\bin' }
    );
    expect(await resolveWindowsEditorLaunch('code', 'code', fs)).toEqual({
      exe: 'C:\\Microsoft VS Code\\Code.exe',
      cliJs: 'C:\\Microsoft VS Code\\6d62b1d5da\\resources\\app\\out\\cli.js'
    });
  });

  it('takes Cursor’s cli.js from its shim three folders below Cursor.exe', async () => {
    const fs = fakeFs(
      {
        'D:\\Apps\\cursor\\resources\\app\\bin\\cursor.cmd': '@echo off\r\n"%~dp0..\\..\\..\\Cursor.exe" "%~dp0..\\out\\cli.js" %*\r\n',
        'D:\\Apps\\cursor\\Cursor.exe': '',
        'D:\\Apps\\cursor\\resources\\app\\out\\cli.js': ''
      },
      { PATH: 'D:\\Apps\\cursor\\resources\\app\\bin' }
    );
    expect(await resolveWindowsEditorLaunch('cursor', 'cursor', fs)).toEqual({
      exe: 'D:\\Apps\\cursor\\Cursor.exe',
      cliJs: 'D:\\Apps\\cursor\\resources\\app\\out\\cli.js'
    });
  });

  it('finds the shim inside the install for an exe set directly or found in a default folder', async () => {
    const files = {
      'E:\\VSC\\bin\\code.cmd': VSCODE_SHIM,
      'E:\\VSC\\Code.exe': '',
      'E:\\VSC\\6d62b1d5da\\resources\\app\\out\\cli.js': '',
      'C:\\Program Files\\Cursor\\resources\\app\\bin\\cursor.cmd': '"%~dp0..\\..\\..\\Cursor.exe" "%~dp0..\\out\\cli.js" %*',
      'C:\\Program Files\\Cursor\\Cursor.exe': '',
      'C:\\Program Files\\Cursor\\resources\\app\\out\\cli.js': ''
    };
    const fs = fakeFs(files, { ProgramFiles: 'C:\\Program Files' });
    expect((await resolveWindowsEditorLaunch('code', 'E:\\VSC\\Code.exe', fs))?.cliJs).toBe('E:\\VSC\\6d62b1d5da\\resources\\app\\out\\cli.js');
    expect((await resolveWindowsEditorLaunch('cursor', 'cursor', fs))?.cliJs).toBe('C:\\Program Files\\Cursor\\resources\\app\\out\\cli.js');
  });

  it('launches the exe alone when no shim names it with an existing cli.js, and always for IntelliJ', async () => {
    const fs = fakeFs({
      'E:\\VSC\\Code.exe': '',
      'E:\\VSC\\bin\\code.cmd': '"%~dp0..\\Other.exe" "%~dp0cli.js"',
      'E:\\VSC\\cli.js': '',
      'F:\\VSC\\Code.exe': '',
      'F:\\VSC\\bin\\code.cmd': VSCODE_SHIM,
      'C:\\IDEA\\bin\\idea.bat': '"%~dp0idea64.exe" "%~dp0x.js"',
      'C:\\IDEA\\bin\\idea64.exe': '',
      'C:\\IDEA\\bin\\x.js': ''
    });
    expect(await resolveWindowsEditorLaunch('code', 'E:\\VSC\\Code.exe', fs)).toEqual({ exe: 'E:\\VSC\\Code.exe' });
    expect(await resolveWindowsEditorLaunch('code', 'F:\\VSC\\Code.exe', fs)).toEqual({ exe: 'F:\\VSC\\Code.exe' });
    expect(await resolveWindowsEditorLaunch('intellij', 'C:\\IDEA\\bin\\idea.bat', fs)).toEqual({ exe: 'C:\\IDEA\\bin\\idea64.exe' });
    expect(await resolveWindowsEditorLaunch('code', 'nope', fakeFs({}))).toBeNull();
  });
});

describe('windowsEditorVersion', () => {
  it('reads VS Code’s version from the commit-named resources folder', async () => {
    const fs = fakeFs({
      'C:\\VSC\\Code.exe': '',
      'C:\\VSC\\6d62b1d5da\\resources\\app\\package.json': '{"name":"code-oss-dev","version":"1.105.1"}'
    });
    expect(await windowsEditorVersion('code', 'C:\\VSC\\Code.exe', fs)).toBe('1.105.1');
  });

  it('reads Cursor’s version from resources next to the exe', async () => {
    const fs = fakeFs({ 'C:\\Cur\\Cursor.exe': '', 'C:\\Cur\\resources\\app\\package.json': '{"version":"1.7.2"}' });
    expect(await windowsEditorVersion('cursor', 'C:\\Cur\\Cursor.exe', fs)).toBe('1.7.2');
  });

  it('reads IntelliJ’s name and version from product-info.json', async () => {
    const fs = fakeFs({ 'C:\\IDEA\\product-info.json': '{"name":"IntelliJ IDEA","version":"2025.2.3"}' });
    expect(await windowsEditorVersion('intellij', 'C:\\IDEA\\bin\\idea64.exe', fs)).toBe('IntelliJ IDEA 2025.2.3');
  });

  it('reads a product-info.json larger than the 64 KiB shim limit', async () => {
    const bundledPlugins = Array.from({ length: 5000 }, (_, i) => `com.example.plugin${i}`);
    const json = JSON.stringify({ name: 'IntelliJ IDEA', version: '2025.2.3', bundledPlugins });
    expect(json.length).toBeGreaterThan(64 * 1024);
    const fs = fakeFs({ 'C:\\IDEA\\product-info.json': json });
    expect(await windowsEditorVersion('intellij', 'C:\\IDEA\\bin\\idea64.exe', fs)).toBe('IntelliJ IDEA 2025.2.3');
  });

  it('returns undefined for missing or malformed install files', async () => {
    expect(await windowsEditorVersion('code', 'C:\\VSC\\Code.exe', fakeFs({ 'C:\\VSC\\resources\\app\\package.json': '{not json' }))).toBeUndefined();
    expect(await windowsEditorVersion('intellij', 'C:\\IDEA\\bin\\idea64.exe', fakeFs({ 'C:\\IDEA\\product-info.json': '{"version":"1"}' }))).toBeUndefined();
  });
});

describe('realWindowsEditorFs', () => {
  it('reads files and folders, and reports missing or oversized ones as absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-editor-windows-'));
    try {
      mkdirSync(join(dir, 'bin'));
      writeFileSync(join(dir, 'bin', 'code.cmd'), '@echo off');
      writeFileSync(join(dir, 'huge.cmd'), 'x'.repeat(64 * 1024 + 1));
      expect(await realWindowsEditorFs.isFile(join(dir, 'bin', 'code.cmd'))).toBe(true);
      expect(await realWindowsEditorFs.isFile(join(dir, 'bin'))).toBe(false);
      expect(await realWindowsEditorFs.isFile(join(dir, 'missing'))).toBe(false);
      expect(await realWindowsEditorFs.readText(join(dir, 'bin', 'code.cmd'), 64 * 1024)).toBe('@echo off');
      expect(await realWindowsEditorFs.readText(join(dir, 'huge.cmd'), 64 * 1024)).toBeNull();
      expect(await realWindowsEditorFs.readText(join(dir, 'huge.cmd'), 128 * 1024)).toHaveLength(64 * 1024 + 1);
      expect(await realWindowsEditorFs.readText(join(dir, 'missing'), 64 * 1024)).toBeNull();
      expect((await realWindowsEditorFs.listDir(dir)).sort()).toEqual(['bin', 'huge.cmd']);
      expect(await realWindowsEditorFs.listDir(join(dir, 'missing'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
