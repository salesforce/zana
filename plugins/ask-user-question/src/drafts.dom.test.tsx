// @vitest-environment jsdom
import React from 'react';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AskUserQuestionForm,loadDraft,saveDraft,clearDraft} from '../app.js';
beforeEach(()=>{(globalThis as any).__ZCC_HOST_REACT__=React;localStorage.clear();});afterEach(cleanup);
it('preserves multi-question drafts through navigation and failed submissions, clearing only success',async()=>{
 const interaction={id:'one',threadId:'t',payload:{questions:[{question:'First',multiSelect:true,options:[{label:'A'},{label:'B'}]},{question:'Second',options:[]}]}};
 const submit=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);const props={interaction,submit,cancel:vi.fn()};
 let view=render(<AskUserQuestionForm {...props}/>);fireEvent.click(screen.getByLabelText('A'));fireEvent.click(screen.getByLabelText('B'));fireEvent.change(screen.getByLabelText('Your answer to question 2'),{target:{value:'draft'}});view.unmount();
 view=render(<AskUserQuestionForm {...props}/>);expect((screen.getByLabelText('A') as HTMLInputElement).checked).toBe(true);expect((screen.getByLabelText('Your answer to question 2') as HTMLTextAreaElement).value).toBe('draft');
 fireEvent.click(screen.getByRole('button',{name:'Send answers'}));await screen.findByRole('alert');view.unmount();view=render(<AskUserQuestionForm {...props}/>);expect((screen.getByLabelText('Your answer to question 2') as HTMLTextAreaElement).value).toBe('draft');fireEvent.click(screen.getByRole('button',{name:'Send answers'}));await waitFor(()=>expect(submit).toHaveBeenCalledTimes(2));await waitFor(()=>expect((screen.getByRole('button',{name:'Send answers'}) as HTMLButtonElement).disabled).toBe(false));view.unmount();
 render(<AskUserQuestionForm {...props}/>);expect((screen.getByLabelText('Your answer to question 2') as HTMLTextAreaElement).value).toBe('');
});
it('starts fresh when question definitions change',()=>{
 const props={interaction:{id:'two',threadId:'t',payload:{questions:[{question:'First',options:[{label:'A'}]}]}},submit:vi.fn(),cancel:vi.fn()};const view=render(<AskUserQuestionForm {...props}/>);fireEvent.click(screen.getByLabelText('A'));view.rerender(<AskUserQuestionForm {...props} interaction={{...props.interaction,payload:{questions:[{question:'New',options:[{label:'C'}]}]}}}/>);expect((screen.getByLabelText('C') as HTMLInputElement).checked).toBe(false);
});
it('bounds and validates retained answers, and keeps edits newer than a submission',()=>{
 const questions=[{question:'Pick',options:[{label:'A'}]}];
 const old=[{selected:['A'],freeText:'old'}],next=[{selected:['unknown','A'],freeText:'x'.repeat(33000)}];
 saveDraft('store-check',questions,old);saveDraft('store-check',questions,next);clearDraft('store-check',questions,old);
 expect(loadDraft('store-check',questions)).toEqual([{selected:['A'],freeText:'x'.repeat(32000)}]);
 for(let i=0;i<45;i++) saveDraft('bounded-'+i,questions,[{selected:[],freeText:'x'.repeat(32000)}]);
 expect(localStorage.getItem('zcc:plugin-question-drafts:v1')!.length).toBeLessThanOrEqual(256000);
 const blocked=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked');});
 saveDraft('memory',questions,old);expect(loadDraft('memory',questions)).toEqual(old);clearDraft('memory',questions,old);expect(loadDraft('memory',questions)).toEqual([{selected:[],freeText:''}]);blocked.mockRestore();
});
it('supports cancellation and changing a single selection without auto-submitting',async()=>{
 const cancel=vi.fn(),submit=vi.fn();
 render(<AskUserQuestionForm interaction={{id:'single',threadId:'t',payload:{questions:[{prompt:'Pick',options:['A','B']}]}}} cancel={cancel} submit={submit}/>);
 fireEvent.click(screen.getByLabelText('A'));fireEvent.click(screen.getByLabelText('B'));expect(submit).not.toHaveBeenCalled();
 expect((screen.getByLabelText('A') as HTMLInputElement).checked).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(cancel).toHaveBeenCalledOnce();
 await waitFor(()=>expect((screen.getByRole('button',{name:'Cancel'}) as HTMLButtonElement).disabled).toBe(false));
});
it.each(['broken','{}','x'.repeat(256001),JSON.stringify([false,[42,{}],['draft',{signature:'changed',answers:[]}]])])('ignores corrupt retained storage',async raw=>{
 localStorage.setItem('zcc:plugin-question-drafts:v1',raw);vi.resetModules();const fresh=await import('../app.js');
 expect(fresh.loadDraft('draft',[{question:'New'}])).toEqual([{selected:[],freeText:''}]);
});
it('normalizes malformed retained answers and starts empty questions disabled',async()=>{
 const questions=[{question:'Pick',options:[]}];
 localStorage.setItem('zcc:plugin-question-drafts:v1',JSON.stringify([['draft',{signature:JSON.stringify(questions),answers:[{selected:false,freeText:42}]}]]));
 vi.resetModules();const fresh=await import('../app.js');expect(fresh.loadDraft('draft',questions)).toEqual([{selected:[],freeText:''}]);
 render(<AskUserQuestionForm interaction={{id:'empty',threadId:'t',payload:{}}} submit={vi.fn()} cancel={vi.fn()}/>);
 expect((screen.getByRole('button',{name:'Send answers'}) as HTMLButtonElement).disabled).toBe(true);
});
