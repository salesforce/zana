// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
beforeEach(() => {localStorage.clear(); vi.resetModules(); vi.restoreAllMocks();});
it('retains transcripts for their owner across reload and conditional consumption', async () => {
 const drafts = await import('./voice-drafts.js'); const listener=vi.fn(); const off=drafts.subscribeVoiceDrafts(listener);
 drafts.appendVoiceDraft('one','first'); drafts.appendVoiceDraft('two','other'); drafts.appendVoiceDraft('one','second');
 drafts.consumeVoiceDraft('one','first'); expect(drafts.voiceDraft('one')).toBe('first second'); expect(listener).toHaveBeenCalledTimes(3);
 off(); vi.resetModules(); const restored=await import('./voice-drafts.js'); expect(restored.voiceDraft('one')).toBe('first second');
 restored.consumeVoiceDraft('one','first second'); expect(restored.voiceDraft('one')).toBe(''); expect(restored.voiceDraft('two')).toBe('other');
});
it('bounds owners and text and tolerates inaccessible storage', async () => {
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(() => {throw new Error('blocked');}); vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('blocked');});
 const drafts=await import('./voice-drafts.js'); for(let i=0;i<21;i++) drafts.appendVoiceDraft(String(i),'x'.repeat(13000));
 expect(drafts.voiceDraft('0')).toBe(''); expect(drafts.voiceDraft('20')).toHaveLength(12000);
});
it.each(['{}','broken',JSON.stringify([[2,'bad'],['one',false],['two','ok']]),'x'.repeat(256001)])('tolerates malformed stored content %s',async value => {
 localStorage.setItem('zcc:voice-drafts:v1',value); const drafts=await import('./voice-drafts.js'); expect(drafts.voiceDraft('one')).toBe('');
});
