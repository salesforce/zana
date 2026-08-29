import { describe, expect, it } from 'vitest';
import {
  getChatGptCloudflareCookieHeader,
  resetChatGptCloudflareCookiesForTests,
  storeChatGptCloudflareCookies
} from './chatgpt-cloudflare-cookies.js';

describe('chatgpt cloudflare cookies', () => {
  it('keeps only Cloudflare cookies from ChatGPT hosts', () => {
    resetChatGptCloudflareCookiesForTests();
    storeChatGptCloudflareCookies('https://chatgpt.com/backend-api/transcribe', new Headers({
      'set-cookie': '__cf_bm=token; Path=/; Secure, session=secret; Path=/'
    }));
    expect(getChatGptCloudflareCookieHeader('https://chatgpt.com/x')).toBe('__cf_bm=token');
    expect(getChatGptCloudflareCookieHeader('https://evil.example/x')).toBeNull();
    resetChatGptCloudflareCookiesForTests();
    expect(getChatGptCloudflareCookieHeader('https://chatgpt.com/x')).toBeNull();
  });

  it('ignores invalid URLs and keeps ChatGPT staging hosts', () => {
    resetChatGptCloudflareCookiesForTests();
    storeChatGptCloudflareCookies('not a url', new Headers({ 'set-cookie': '__cf_bm=x' }));
    expect(getChatGptCloudflareCookieHeader('not a url')).toBeNull();
    storeChatGptCloudflareCookies('https://chatgpt-staging.com/backend-api/transcribe', new Headers({
      'set-cookie': 'cf_chl_opt=1; Path=/'
    }));
    expect(getChatGptCloudflareCookieHeader('https://chatgpt-staging.com/x')).toBe('cf_chl_opt=1');
  });
});
