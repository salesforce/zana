// @vitest-environment happy-dom
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {contextReferencePrompt} from '@zana-ai/zcc-domain/thread-runtime';
import {ContextReferenceMessage,compactReferenceText} from './ContextReferenceMessage.js';
vi.mock('../MarkdownContent.js',()=>({MarkdownContent:({text}:{text:string})=><span>{text}</span>}));
afterEach(cleanup);
it('renders references at either edge and preserves ordinary text when metadata is invalid',()=>{
 const reference={version:1 as const,label:'Log',text:'exact snapshot'};const text=contextReferencePrompt(reference);
 const references=[{start:0,end:text.length,reference}];
 const view=render(<ContextReferenceMessage text={text} references={references} />);
 expect(screen.getByRole('button',{name:'Inspect Log'})).toBeTruthy();expect(document.body.textContent).not.toContain('exact snapshot');
 expect(compactReferenceText(text,references)).toBe(' [Log] ');
 view.rerender(<ContextReferenceMessage text="ordinary text" references={references} />);
 expect(document.body.textContent).toBe('ordinary text');
 expect(screen.queryByRole('button',{name:'Inspect Log'})).toBeNull();
});

it('caps ordinary text and keeps lifted images out of the body without reading snapshot contents',()=>{
 const reference={version:1 as const,label:'Log',text:'data:image/png;base64,c25hcHNob3Q='};
 const block=contextReferencePrompt(reference);const text='Before '+block+'\n/data/photo.png\nAfter';
 const references=[{start:7,end:7+block.length,reference}];
 const view=render(<ContextReferenceMessage text={text} references={references} maxTextChars={3} />);
 expect(document.body.textContent).toBe('Bef…');expect(screen.queryByRole('button',{name:'Inspect Log'})).toBeNull();
 view.rerender(<ContextReferenceMessage text={text} references={references} />);
 expect(screen.getByRole('button',{name:'Inspect Log'})).toBeTruthy();
 expect(document.body.textContent).toContain('Before');expect(document.body.textContent).toContain('After');
 expect(document.body.textContent).not.toContain('/data/photo.png');expect(document.body.textContent).not.toContain('base64');
});
