// AES-GCM storage follows BB's machine environment design; see docs/third-party/BB-LICENSE.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  HostEnvironmentEntrySchema, HOST_ENVIRONMENT_MAX_ENTRIES, MachineEnvironmentNameSchema,
  MachineEnvironmentSaveSchema, type MachineEnvironmentSave, type MachineEnvironmentSettings,
} from '@zana-ai/zcc-contracts/host-rpc';
import { HostCommandError } from './host-command-error.js';
import { runInSerialLane } from './serial-lane.js';

const MARKER = 'ZCC_SAVED_ENV_NAMES';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const locks = new Map<string, Promise<void>>();
const diskSchema = z.object({
  version: z.literal(1), revision: z.string().uuid(),
  variables: z.array(z.object({ name: MachineEnvironmentNameSchema, sealed: z.string().max(50_000) }).strict()).max(HOST_ENVIRONMENT_MAX_ENTRIES),
}).strict();
type Disk = z.infer<typeof diskSchema>;
const empty = (): Disk => ({ version: 1, revision: '00000000-0000-0000-0000-000000000000', variables: [] });
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }

async function boundedRead(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Invalid environment storage');
    const buffer = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > info.size) throw new Error('Environment storage changed during read');
    return buffer.subarray(0, size).toString('utf8');
  } finally { await file.close(); }
}

/** One store per daemon. All writes in a process share the same per-path serial lane. */
export class SavedMachineEnvironment {
  private disk: Disk = empty();
  private readonly applied = new Map<string, string>();
  private values = new Map<string, string>();
  private ready = false;
  private readonly path: string;
  private readonly keyPath: string;
  constructor(private readonly dataDir: string, private readonly target: NodeJS.ProcessEnv = process.env) {
    this.path = join(dataDir, 'machine-environment.enc');
    this.keyPath = join(dataDir, 'machine-environment.key');
  }

  /** Opaque process generation, never a credential digest or value. */
  get revision(): string | undefined { return this.disk.variables.length || this.disk.revision !== empty().revision ? this.disk.revision : undefined; }

  async initialize(): Promise<void> {
    if (this.ready) return;
    await runInSerialLane(locks, this.path, async () => {
      if (this.ready) return;
      // A self-updated daemon must reload its own store rather than inheriting stale values.
      const marker = this.target[MARKER];
      if (marker) for (const name of marker.split(',')) {
        if (MachineEnvironmentNameSchema.safeParse(name).success) delete this.target[name];
      }
      delete this.target[MARKER];
      const disk = await this.read();
      const values = await this.decrypt(disk);
      this.apply(disk, values);
      this.ready = true;
    });
  }

  status(): MachineEnvironmentSettings {
    if (!this.ready) throw new HostCommandError('environment_unavailable', 'Environment settings could not be loaded on this machine.');
    return {
      revision: this.disk.revision,
      variables: this.disk.variables.map(({ name }) => ({ name, overriddenByEnvironment: !this.applied.has(name) })),
    };
  }

  async save(input: MachineEnvironmentSave): Promise<MachineEnvironmentSettings> {
    const parsed = MachineEnvironmentSaveSchema.safeParse(input);
    if (!parsed.success) throw new HostCommandError('invalid_environment', 'Invalid environment variable.');
    if (!this.ready) this.status();
    return runInSerialLane(locks, this.path, async () => {
      const disk = await this.read();
      if (disk.revision !== input.expectedRevision) throw new HostCommandError('environment_conflict', 'Environment settings changed. Reload and try again.');
      const current = disk.variables.find((row) => row.name === input.name);
      if (input.value !== null && !current && disk.variables.length >= HOST_ENVIRONMENT_MAX_ENTRIES) {
        throw new HostCommandError('environment_limit', 'Remove a saved variable before adding another.');
      }
      // Validate/decrypt the entire old store before creating a key or changing anything.
      const values = await this.decrypt(disk);
      const variables = disk.variables.filter((row) => row.name !== input.name);
      if (input.value === null) values.delete(input.name);
      else {
        const key = await this.key(disk.variables.length === 0);
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(input.name));
        const ciphertext = Buffer.concat([cipher.update(input.value, 'utf8'), cipher.final()]);
        variables.push({ name: input.name, sealed: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64') });
        values.set(input.name, input.value);
      }
      const next: Disk = { version: 1, revision: randomUUID(), variables: variables.sort((a, b) => a.name.localeCompare(b.name)) };
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw new HostCommandError('environment_limit', 'Saved environment is too large. Remove a variable before adding another.');
      await this.atomicWrite(this.path, serialized);
      this.apply(next, values);
      return this.status();
    });
  }

  /** Server-forwarded gateway configuration has priority even after a daemon restart. */
  withHigherPriorityEnvironment<T>(update: () => T): T {
    this.removeApplied();
    try { return update(); }
    finally { if (this.ready) this.apply(this.disk, this.values); }
  }

  private removeApplied(): void {
    for (const [name, value] of this.applied) if (this.target[name] === value) delete this.target[name];
    this.applied.clear();
  }

  clear(): void {
    this.removeApplied();
    this.values.clear();
    delete this.target[MARKER];
    this.ready = false;
  }

  private async read(): Promise<Disk> {
    try { return diskSchema.parse(JSON.parse(await boundedRead(this.path))); }
    catch (error) {
      if (missing(error)) return empty();
      throw new HostCommandError('environment_unavailable', 'Saved environment is unreadable. Restore it from backup.');
    }
  }

  private async key(create: boolean): Promise<Buffer> {
    try {
      let raw: string;
      try { raw = (await boundedRead(this.keyPath)).trim(); }
      catch (error) {
        if (!create || !missing(error)) throw error;
        await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
        const generated = randomBytes(32).toString('hex');
        try { await writeFile(this.keyPath, generated, { mode: 0o600, flag: 'wx' }); }
        catch (raced) { if ((raced as NodeJS.ErrnoException).code !== 'EEXIST') throw raced; }
        raw = (await boundedRead(this.keyPath)).trim();
      }
      if (!/^[a-f0-9]{64}$/.test(raw)) throw new Error('Invalid key');
      return Buffer.from(raw, 'hex');
    } catch { throw new HostCommandError('environment_unavailable', 'Environment encryption key is unavailable. Restore it from backup.'); }
  }

  private async decrypt(disk: Disk): Promise<Map<string, string>> {
    const values = new Map<string, string>();
    if (!disk.variables.length) return values;
    const key = await this.key(false);
    try {
      for (const { name, sealed } of disk.variables) {
        if (values.has(name)) throw new Error('Duplicate name');
        const bytes = Buffer.from(sealed, 'base64');
        const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        cipher.setAAD(Buffer.from(name)); cipher.setAuthTag(bytes.subarray(12, 28));
        const value = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
        HostEnvironmentEntrySchema.parse({ name, value });
        values.set(name, value);
      }
      return values;
    } catch { throw new HostCommandError('environment_unavailable', 'Saved environment cannot be decrypted. Restore it from backup.'); }
  }

  private apply(disk: Disk, values: Map<string, string>): void {
    this.removeApplied();
    this.values = values;
    for (const [name, value] of values) {
      // Never overwrite host-owned environment, including gateway routing or credentials.
      if (this.target[name] !== undefined && this.target[name] !== '') continue;
      this.target[name] = value; this.applied.set(name, value);
    }
    this.disk = disk;
    if (this.applied.size) this.target[MARKER] = [...this.applied.keys()].join(',');
    else delete this.target[MARKER];
  }

  private async atomicWrite(path: string, value: string): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, value, { mode: 0o600, flag: 'wx' }); await rename(temp, path); }
    catch { throw new HostCommandError('environment_unavailable', 'Environment settings could not be saved.'); }
    finally { await rm(temp, { force: true }).catch(() => {}); }
  }
}
