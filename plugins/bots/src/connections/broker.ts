import { randomUUID } from 'node:crypto';
import { open, seal, type Envelope } from '../vault/encryption.js';
import {
  SalesforceConnection,
  AuthorizationPending,
  appId,
  appSecret,
  domain,
  type DeviceLogin,
  type Grant
} from './salesforce.js';

const STORE = 'connections.encrypted.v1';
const AAD = Buffer.from('zana-bot-connections/v1');
type Kv = { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
interface Pending extends DeviceLogin {
  grant: Grant;
  ticket: string;
  expires: number;
  nextPoll: number;
}
export class BotConnections {
  private session?: { key: Buffer; controller: AbortController };
  private pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  constructor(
    private kv: Kv,
    private provider = new SalesforceConnection(),
    private now = Date.now,
    private botExists: (key: string) => boolean = () => true
  ) {}
  resume(key: Buffer) {
    // An automatic editor timeout closes owner access. Explicit lock or shutdown also stops unattended work.
    if (this.session?.key.equals(key)) {
      key.fill(0);
      return;
    }
    this.pause();
    this.session = { key, controller: new AbortController() };
  }
  pause() {
    this.session?.controller.abort();
    this.session?.key.fill(0);
    this.session = undefined;
    this.pending.clear();
  }
  private run<T>(
    operation: (rows: Grant[], signal: AbortSignal, save: () => Promise<void>) => Promise<T>,
    owner?: () => void
  ) {
    const session = this.session;
    if (!session) return Promise.reject(new Error('Unlock the Vault to resume bot connections.'));
    if (this.queued >= 24) return Promise.reject(new Error('Connections are busy. Try again.'));
    this.queued++;
    const check = () => {
      if (this.session !== session) throw new Error('Bot connections were paused.');
      owner?.();
    };
    const work = this.queue
      .then(async () => {
        check();
        const envelope = await this.kv.get<Envelope>(STORE);
        check();
        const stored = envelope ? open<Grant>(envelope, session.key, AAD) : [];
        const rows = stored.filter((row) => this.botExists(row.bot));
        const save = async () => {
          check();
          await this.kv.set(STORE, seal(rows, session.key, '', AAD));
        };
        if (rows.length !== stored.length) await save();
        check();
        const result = await operation(rows, session.controller.signal, save);
        check();
        return result;
      })
      .finally(() => {
        this.queued--;
      });
    this.queue = work.catch(() => {});
    return work;
  }
  status(bot: string, owner: () => void) {
    return this.run(async (rows) => {
      const grant = rows.find((row) => row.bot === bot);
      return grant ? { origin: grant.origin, mode: grant.mode } : null;
    }, owner);
  }
  connect(bot: string, input: Record<string, unknown>, owner: () => void) {
    return this.run(async (rows, signal, save) => {
      if (rows.some((r) => r.bot === bot)) throw new Error('Disconnect the current account first.');
      if (rows.length >= 200) throw new Error('The connection limit has been reached.');
      const mode = input.mode;
      if (mode !== 'service' && mode !== 'delegated') throw new Error('Choose an identity.');
      const grant: Grant = {
        bot,
        mode,
        origin: domain(input.origin),
        clientId: appId(input.clientId),
        principal: ''
      };
      if (mode === 'service' || input.clientSecret) grant.clientSecret = appSecret(input.clientSecret);
      this.pending.delete(bot);
      if (mode === 'delegated') {
        for (const [id, p] of this.pending) if (p.expires <= this.now()) this.pending.delete(id);
        if (this.pending.size >= 24) throw new Error('Too many pending connections.');
        const device = await this.provider.begin(grant.origin, grant.clientId, signal);
        signal.throwIfAborted();
        owner();
        const ticket = randomUUID();
        this.pending.set(bot, {
          ...device,
          grant,
          ticket,
          nextPoll: this.now() + device.interval * 1000,
          expires: this.now() + 600_000
        });
        return {
          state: 'waiting' as const,
          ticket,
          code: device.userCode,
          url: device.verificationUrl,
          interval: device.interval
        };
      }
      const authorized = await this.provider.authorize(grant, signal);
      rows.push(authorized.grant);
      await save();
      return { state: 'connected' as const };
    }, owner);
  }
  finish(bot: string, ticket: unknown, owner: () => void) {
    return this.run(async (rows, signal, save) => {
      const attempt = this.pending.get(bot);
      if (!attempt || ticket !== attempt.ticket || attempt.expires <= this.now())
        throw new Error('Sign-in expired. Start the connection again.');
      if (this.now() < attempt.nextPoll) return { state: 'waiting', interval: attempt.interval };
      if (rows.length >= 200 || rows.some((row) => row.bot === bot))
        throw new Error('Account changed. Reopen Connections.');
      try {
        const { grant } = await this.provider.authorize(attempt.grant, signal, attempt.deviceCode);
        rows.push(grant);
        await save();
        this.pending.delete(bot);
        return { state: 'connected' };
      } catch (error) {
        if (!(error instanceof AuthorizationPending)) {
          this.pending.delete(bot);
          throw error;
        }
        if (error.slowDown) attempt.interval += 5;
        attempt.nextPoll = this.now() + attempt.interval * 1000;
        return { state: 'waiting', interval: attempt.interval };
      }
    }, owner);
  }
  disconnect(bot: string, owner: () => void) {
    return this.run(async (rows, _signal, save) => {
      this.pending.delete(bot);
      const index = rows.findIndex((row) => row.bot === bot);
      if (index !== -1) {
        rows.splice(index, 1);
        await save();
      }
      return { disconnected: true };
    }, owner);
  }
  assignedCases(bot: string, stillOwnsThread: () => boolean, caller?: AbortSignal) {
    const checkRole = () => {
      if (!stillOwnsThread()) throw new Error('Only the bot’s main thread can use this connection.');
    };
    return this.run(async (rows, sessionSignal, save) => {
      const signal = caller ? AbortSignal.any([caller, sessionSignal]) : sessionSignal;
      signal.throwIfAborted();
      checkRole();
      const index = rows.findIndex((row) => row.bot === bot);
      if (index < 0) throw new Error('Connect a Salesforce account in this bot’s Vault.');
      const prior = rows[index];
      const { grant, access } = await this.provider.authorize(prior, signal);
      if (prior.refreshToken !== grant.refreshToken) {
        rows[index] = grant;
        await save();
      }
      signal.throwIfAborted();
      checkRole();
      const result = await this.provider.cases(grant, access, signal);
      checkRole();
      return result;
    });
  }
}
