import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HostCommandError } from './host-command-error.js';

const CODEX_AUTH_FILE_NAME = 'auth.json';
const CHATGPT_AUTH_CLAIM_PATH = 'https://api.openai.com/auth';

export interface CodexChatGptAuthCredentials {
  type: 'chatgpt';
  accessToken: string;
  accountId: string;
  accountEmail: string | null;
  isFedrampAccount: boolean;
}

export interface CodexOpenAiApiKeyCredentials {
  type: 'apiKey';
  apiKey: string;
}

export type CodexAuthCredentials = CodexChatGptAuthCredentials | CodexOpenAiApiKeyCredentials;

export interface CodexAuthReadOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

interface CodexAuthJson {
  authMode: string | null;
  openAiApiKey: string | null;
  tokens: Record<string, unknown> | null;
  accessToken: string | null;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function resolveCodexHome(options: CodexAuthReadOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  return env.CODEX_HOME?.trim() || join(home, '.codex');
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return jsonObject(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

function getChatGptAuthClaims(token: string): Record<string, unknown> | null {
  const payload = decodeJwtPayload(token);
  return payload ? jsonObject(payload[CHATGPT_AUTH_CLAIM_PATH]) : null;
}

function getAccountIdFromToken(token: string): string | null {
  const auth = getChatGptAuthClaims(token);
  return auth ? optionalString(auth.chatgpt_account_id) : null;
}

function getAccountEmailFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const profile = jsonObject(payload['https://api.openai.com/profile']);
  return optionalString(payload.email) ?? optionalString(profile?.email);
}

function isFedrampToken(token: string): boolean {
  const auth = getChatGptAuthClaims(token);
  return auth ? optionalBoolean(auth.chatgpt_account_is_fedramp) === true : false;
}

function getAccountIdFromIdToken(value: unknown): string | null {
  if (typeof value === 'string') return getAccountIdFromToken(value);
  const idToken = jsonObject(value);
  return idToken ? optionalString(idToken.chatgpt_account_id) : null;
}

function isFedrampIdToken(value: unknown): boolean {
  if (typeof value === 'string') return isFedrampToken(value);
  const idToken = jsonObject(value);
  return idToken ? optionalBoolean(idToken.chatgpt_account_is_fedramp) === true : false;
}

function shouldUseOpenAiApiKeyAuth(auth: CodexAuthJson): boolean {
  return (
    auth.authMode === 'apikey' ||
    auth.authMode === 'apiKey' ||
    (auth.authMode === null && auth.openAiApiKey !== null)
  );
}

async function readCodexAuthJson(options: CodexAuthReadOptions): Promise<CodexAuthJson> {
  const authPath = join(resolveCodexHome(options), CODEX_AUTH_FILE_NAME);
  let raw: string;
  try {
    raw = await readFile(authPath, 'utf8');
  } catch {
    throw new HostCommandError(
      'codex_auth_missing',
      `Codex auth file not found at ${authPath}. Run \`codex login\` on this host or set OPENAI_API_KEY.`
    );
  }
  let parsed: Record<string, unknown> | null;
  try {
    parsed = jsonObject(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    throw new HostCommandError(
      'codex_auth_invalid',
      `Codex auth file at ${authPath} is not valid JSON. Run \`codex login\` on this host.`
    );
  }
  const tokens = jsonObject(parsed.tokens);
  return {
    authMode: optionalString(parsed.auth_mode),
    openAiApiKey: optionalString(parsed.OPENAI_API_KEY),
    tokens,
    accessToken: tokens ? optionalString(tokens.access_token) : null
  };
}

function buildOpenAiApiKeyCredentials(auth: CodexAuthJson, authPath: string): CodexOpenAiApiKeyCredentials {
  if (!auth.openAiApiKey) {
    throw new HostCommandError(
      'codex_auth_invalid',
      `Codex auth file at ${authPath} does not contain a usable API key. Run \`codex login\` on this host.`
    );
  }
  return { type: 'apiKey', apiKey: auth.openAiApiKey };
}

function buildChatGptCredentials(auth: CodexAuthJson, authPath: string): CodexChatGptAuthCredentials {
  if (!auth.tokens || !auth.accessToken) {
    throw new HostCommandError(
      'codex_auth_invalid',
      `Codex auth file at ${authPath} does not contain a usable access token. Run \`codex login\` on this host.`
    );
  }
  const accountId =
    optionalString(auth.tokens.account_id) ??
    getAccountIdFromToken(auth.accessToken) ??
    getAccountIdFromIdToken(auth.tokens.id_token);
  if (!accountId) {
    throw new HostCommandError(
      'codex_auth_invalid',
      'Codex auth tokens do not include a ChatGPT account id. Run `codex login` on this host.'
    );
  }
  return {
    type: 'chatgpt',
    accessToken: auth.accessToken,
    accountId,
    accountEmail:
      getAccountEmailFromToken(auth.accessToken) ??
      (typeof auth.tokens.id_token === 'string' ? getAccountEmailFromToken(auth.tokens.id_token) : null),
    isFedrampAccount:
      isFedrampToken(auth.accessToken) || isFedrampIdToken(auth.tokens.id_token)
  };
}

export async function readCodexAuthCredentials(
  options: CodexAuthReadOptions = {}
): Promise<CodexAuthCredentials> {
  const auth = await readCodexAuthJson(options);
  const authPath = join(resolveCodexHome(options), CODEX_AUTH_FILE_NAME);
  if (shouldUseOpenAiApiKeyAuth(auth)) {
    return buildOpenAiApiKeyCredentials(auth, authPath);
  }
  return buildChatGptCredentials(auth, authPath);
}

export async function resolveVoiceAuth(options: CodexAuthReadOptions = {}): Promise<CodexAuthCredentials> {
  try {
    return await readCodexAuthCredentials(options);
  } catch (error) {
    const code = error instanceof HostCommandError ? error.code : '';
    const key = (options.env ?? process.env).OPENAI_API_KEY?.trim();
    if (key && (code === 'codex_auth_missing' || code === 'codex_auth_invalid')) {
      return { type: 'apiKey', apiKey: key };
    }
    throw error;
  }
}
