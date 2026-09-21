import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, statSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const DEVICE_LIMIT = 20;
export const DEVICE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
interface Device {
  id: string;
  label: string;
  hash: string;
  createdAt: number;
  expiresAt: number;
  pushToken?: string;
}

/** The gateway is the sole writer. All mutations are synchronous and atomic. */
export class MobileDeviceStore {
  private devices: Device[] = [];
  constructor(
    private readonly file?: string,
    private readonly now = Date.now
  ) {
    if (!file) return;
    try {
      if (statSync(file).size > 32_768) throw new Error('Mobile device store is too large');
      const content = readFileSync(file, 'utf8');
      if (content.length > 32_768) throw new Error('Mobile device store is too large');
      const parsed: unknown = JSON.parse(content);
      if (
        !Array.isArray(parsed) ||
        parsed.length > DEVICE_LIMIT ||
        parsed.some(
          (row) =>
            !row ||
            typeof row.id !== 'string' ||
            typeof row.label !== 'string' ||
            row.label.length > 80 ||
            typeof row.hash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(row.hash) ||
            (row.pushToken !== undefined &&
              (typeof row.pushToken !== 'string' ||
                !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,200}\]$/.test(
                  row.pushToken
                ))) ||
            !Number.isFinite(row.createdAt) ||
            !Number.isFinite(row.expiresAt)
        )
      ) {
        throw new Error('Invalid mobile device store');
      }
      this.devices = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  list() {
    return this.devices
      .filter((d) => d.expiresAt > this.now())
      .map(({ hash: _hash, pushToken: _pushToken, ...device }) => device);
  }
  authorize(credential: string): string | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) return null;
    return (
      this.devices.find((d) => d.expiresAt > this.now() && d.hash === digest(credential))?.id ??
      null
    );
  }
  add(label: string) {
    const live = this.devices.filter((d) => d.expiresAt > this.now());
    if (live.length >= DEVICE_LIMIT)
      throw new Error('Device limit reached. Revoke a device first.');
    const credential = randomBytes(32).toString('base64url');
    const device: Device = {
      id: randomUUID(),
      label: label.trim().slice(0, 80) || 'Phone',
      hash: digest(credential),
      createdAt: this.now(),
      expiresAt: this.now() + DEVICE_LIFETIME_MS
    };
    this.save([...live, device]);
    return { deviceId: device.id, credential, expiresAt: device.expiresAt };
  }
  revoke(id: string): boolean {
    if (!this.devices.some((d) => d.id === id)) return false;
    this.save(this.devices.filter((d) => d.id !== id));
    return true;
  }
  pushTargets() {
    return this.devices
      .filter((d) => d.expiresAt > this.now() && d.pushToken)
      .map((d) => ({ id: d.id, pushToken: d.pushToken! }));
  }
  setPushToken(id: string, pushToken: string | null) {
    if (
      pushToken !== null &&
      !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,200}\]$/.test(pushToken)
    )
      throw new Error('Invalid Expo push token');
    this.save(
      this.devices.map((d) => (d.id === id ? { ...d, pushToken: pushToken ?? undefined } : d))
    );
  }
  private save(next: Device[]) {
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
        renameSync(temp, this.file);
      } finally {
        try {
          unlinkSync(temp);
        } catch {
          /* renamed, or write failed */
        }
      }
    }
    this.devices = next;
  }
}
