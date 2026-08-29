import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HostCommandError } from './host-command-error.js';

const GLOBAL_SKILL_ROOT_SEGMENTS: readonly (readonly string[])[] = [
  ['.agents', 'skills'],
  ['.claude', 'skills']
];

export function globalSkillPaths(homeDir: string, name: string): string[] {
  return GLOBAL_SKILL_ROOT_SEGMENTS.map((segments) => join(homeDir, ...segments, name));
}

function skillFilePath(skillDirectory: string): string {
  return join(skillDirectory, 'SKILL.md');
}

async function hashSkillFile(filePath: string): Promise<string | null> {
  try {
    const body = await readFile(filePath, 'utf8');
    return createHash('sha256').update(body).digest('hex');
  } catch {
    return null;
  }
}

async function replaceSkillFile(destinationDir: string, content: string): Promise<void> {
  await mkdir(destinationDir, { recursive: true });
  const destination = skillFilePath(destinationDir);
  const staging = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(staging, content, { encoding: 'utf8', mode: 0o600 });
    await rename(staging, destination);
  } finally {
    await rm(staging, { force: true });
  }
}

export async function readGlobalSkillsStatus(args: {
  names: string[];
  homeDir?: string;
}): Promise<{ entries: Array<{ name: string; path: string; installed: boolean; hash: string | null }> }> {
  const home = args.homeDir ?? homedir();
  const entries = [];
  for (const name of args.names) {
    for (const directory of globalSkillPaths(home, name)) {
      const file = skillFilePath(directory);
      const hash = await hashSkillFile(file);
      entries.push({
        name,
        path: directory,
        installed: hash !== null,
        hash
      });
    }
  }
  return { entries };
}

export async function installGlobalSkills(args: {
  skills: Array<{ name: string; content: string }>;
  homeDir?: string;
}): Promise<{ installations: Array<{ name: string; path: string }> }> {
  const home = args.homeDir ?? homedir();
  const installations: Array<{ name: string; path: string }> = [];
  for (const skill of args.skills) {
    if (skill.name.includes('/') || skill.name.includes('\\') || skill.name.includes('..')) {
      throw new HostCommandError('invalid_path', `Skill name is not a basename: ${skill.name}`);
    }
    for (const destinationDir of globalSkillPaths(home, skill.name)) {
      await replaceSkillFile(destinationDir, skill.content);
      installations.push({ name: skill.name, path: destinationDir });
    }
  }
  return { installations };
}

export function parentOfSkillDirectory(skillDirectory: string): string {
  return dirname(skillDirectory);
}
