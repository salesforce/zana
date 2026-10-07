// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {PromptLibrary} from './app.tsx';
const mocks=vi.hoisted(()=>({call:vi.fn(),composer:{scope:{kind:'thread',threadId:'t'},experimental_replacePrompt:vi.fn(),setText:vi.fn(),focus:vi.fn()}}));
vi.mock('@zana-ai/zcc-plugin-sdk/app',()=>{const rpc={call:mocks.call};return ({definePluginApp:(setup:unknown)=>({setup}),useComposer:()=>mocks.composer,useRpc:()=>rpc});});
const row={id:'p',createdAt:1,input:[{type:'text',text:'Remember @file',mentions:[]},{type:'localImage',path:'img.png',sourceProjectId:'p'}]};
beforeEach(()=>{vi.clearAllMocks();mocks.call.mockResolvedValue({entries:[row],nextCursor:null});});afterEach(cleanup);
it('opens starred prompts, restores structured metadata, stars history, and paginates',async()=>{
 render(<PromptLibrary/>);fireEvent.click(screen.getByRole('button',{name:'Prompt Library'}));await screen.findByText('Remember @file');
 fireEvent.click(screen.getByRole('button',{name:'Use prompt'}));expect(mocks.composer.experimental_replacePrompt).toHaveBeenCalledWith(row.input,undefined);expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Prompt Library'}));await screen.findByText('Remember @file');fireEvent.click(screen.getByRole('button',{name:'Unstar'}));await waitFor(()=>expect(screen.queryByText('Remember @file')).toBeNull());
 mocks.call.mockResolvedValueOnce({entries:[row],nextCursor:'next'});fireEvent.change(screen.getByLabelText('Prompt scope'),{target:{value:'all'}});await screen.findByText('Remember @file');
 fireEvent.click(screen.getByRole('button',{name:'Star',exact:true}));await waitFor(()=>expect(mocks.call).toHaveBeenCalledWith('star',row));
 mocks.call.mockResolvedValueOnce({entries:[{...row,id:'more'}],nextCursor:null});fireEvent.click(screen.getByRole('button',{name:'Load more'}));await waitFor(()=>expect(screen.getAllByText('Remember @file')).toHaveLength(2));
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps failed requests visible and cancels obsolete searches on scope changes',async()=>{
 mocks.call.mockRejectedValueOnce(new Error('offline'));render(<PromptLibrary/>);fireEvent.click(screen.getByRole('button',{name:'Prompt Library'}));await screen.findByRole('alert');
 fireEvent.change(screen.getByLabelText('Search prompts'),{target:{value:'Remember'}});await screen.findByText('Remember @file');
 fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(screen.queryByRole('dialog')).toBeNull();
});
it('contains keyboard focus and keeps pagination failures visible',async()=>{
 mocks.call.mockResolvedValueOnce({entries:[row],nextCursor:'next'});
 render(<PromptLibrary/>);fireEvent.click(screen.getByRole('button',{name:'Prompt Library'}));await screen.findByText('Remember @file');
 const dialog=screen.getByRole('dialog');const first=screen.getByLabelText('Prompt scope');const last=screen.getByRole('button',{name:'Load more'});
 last.focus();fireEvent.keyDown(dialog,{key:'Tab'});expect(document.activeElement).toBe(first);
 first.focus();fireEvent.keyDown(dialog,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(last);
 mocks.call.mockRejectedValueOnce(new Error('page failed'));fireEvent.click(last);await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain('page failed');
 expect(screen.getByText('Remember @file')).toBeTruthy();
});
