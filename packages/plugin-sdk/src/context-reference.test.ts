// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_REFERENCE_MIME, contextReferenceFromClipboard, writeContextReference, copyContextSelection, contextReferenceFromEditorSelection } from './context-reference.js';
import { EDITOR_SELECTION_MIME } from './editor-selection.js';
const reference = {version:1 as const,label:'Report (selection)',text:'  exact\ntext',source:{kind:'plugin' as const,pluginId:'reports',resourceId:'r1'}};
const packet = (metadata = JSON.stringify(reference), text = reference.text) => ({ getData:(type:string) => type === CONTEXT_REFERENCE_MIME ? metadata : type === 'text/plain' ? text : '' });
afterEach(() => { document.body.innerHTML=''; window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); });

describe('shared reference clipboard', () => {
  it('reads metadata only alongside matching plain text', () => {
    expect(contextReferenceFromClipboard(packet())).toEqual(reference);
    expect(contextReferenceFromClipboard(packet(undefined, reference.text.replace(/\n/g,'\r\n')))).toEqual(reference);
    for (const data of [null,packet('', 'plain'),packet('{broken'),packet('x'.repeat(632769)),packet(undefined,'stale'),packet(JSON.stringify({...reference,version:2})),{getData:()=>{throw Error();}}]) expect(contextReferenceFromClipboard(data)).toBeNull();
    const selection = {version:1 as const,path:'src/code.ts',startLine:2,endLine:3,text:'code'};
    expect(contextReferenceFromClipboard({getData:type => type===EDITOR_SELECTION_MIME?JSON.stringify(selection):type==='text/plain'?'code':''})).toEqual(contextReferenceFromEditorSelection(selection));
    expect(contextReferenceFromEditorSelection({...selection,startLine:undefined,endLine:undefined}).label).toBe('code.ts (selection)');
  });
  it('writes interoperable formats and leaves native copy available on failure', () => {
    const values: Record<string,string>={};
    const event = {clipboardData:{setData:(type:string,value:string)=>{values[type]=value;}} as DataTransfer,preventDefault:vi.fn()};
    expect(writeContextReference(event,reference)).toBe(true);
    expect(values['text/plain']).toBe(reference.text); expect(JSON.parse(values[CONTEXT_REFERENCE_MIME]!)).toEqual(reference);
    const file = {...reference,source:{kind:'file' as const,path:'a.ts',startLine:1,endLine:1}};
    expect(writeContextReference(event,file)).toBe(true); expect(values[EDITOR_SELECTION_MIME]).toContain('a.ts');
    expect(writeContextReference({...event,clipboardData:null},reference)).toBe(false);
    expect(writeContextReference(event,{...reference,version:2} as never)).toBe(false);
    expect(writeContextReference({...event,clipboardData:{setData:()=>{throw Error();}} as unknown as DataTransfer},reference)).toBe(false);
  });
  it('confines both endpoints and leaves input widgets alone', () => {
    document.body.innerHTML='<div id="root"><p>  selected passage</p><div contenteditable="true">editable</div></div><p id="other">outside</p>';
    const root=document.getElementById('root')!;
    const selection=window.getSelection()!;
    const event={clipboardData:{setData:vi.fn()} as unknown as DataTransfer,preventDefault:vi.fn()};
    const select=(node:Node)=>{selection.removeAllRanges();const range=document.createRange();range.selectNodeContents(node);selection.addRange(range);};
    expect(copyContextSelection(event,root,reference)).toBe(false);
    select(root.querySelector('p')!); expect(copyContextSelection(event,root,reference)).toBe(true);
    select(document.getElementById('other')!); expect(copyContextSelection(event,root,reference)).toBe(false);
    for (const value of ['true', 'plaintext-only', '']) {
      const editable = root.querySelector('[contenteditable]')!;
      editable.setAttribute('contenteditable', value);
      select(editable); expect(copyContextSelection(event,root,reference)).toBe(false);
    }
    selection.removeAllRanges();const cross=document.createRange();cross.setStart(root.querySelector('p')!.firstChild!,0);cross.setEnd(document.getElementById('other')!.firstChild!,3);selection.addRange(cross);
    expect(copyContextSelection(event,root,reference)).toBe(false);
  });
});
