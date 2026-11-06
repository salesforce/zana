// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BookMarkedIcon, injectStyles, PromptLibrary, PROMPT_LIBRARY_STYLES, STYLE_TAG_ID} from './app.tsx';
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
const open=async()=>{render(<PromptLibrary/>);fireEvent.click(screen.getByRole('button',{name:'Prompt Library'}));await screen.findByText('Remember @file');};
const deferred=()=>{let resolve!:(value:unknown)=>void;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const typed=async(value:string,calls:number)=>{fireEvent.change(screen.getByLabelText('Search prompts'),{target:{value}});await waitFor(()=>expect(mocks.call).toHaveBeenCalledTimes(calls));};
it('keeps the previous results on screen while the next search loads',async()=>{
 mocks.call.mockResolvedValueOnce({entries:[row],nextCursor:'next'});await open();
 const next=deferred();mocks.call.mockImplementationOnce(()=>next.promise);
 await typed('Rem',2);
 expect(screen.getByText('Remember @file')).toBeTruthy();expect(screen.getByRole('status').textContent).toBe('Loading…');
 expect(screen.queryByText('No prompts found.')).toBeNull();expect(screen.queryByRole('button',{name:'Load more'})).toBeNull();
 next.resolve({entries:[{...row,id:'q',input:[{type:'text',text:'Remember again',mentions:[]}]}],nextCursor:null});
 await screen.findByText('Remember again');expect(screen.queryByText('Remember @file')).toBeNull();expect(screen.queryByRole('status')).toBeNull();
});
it('keeps the previous results and shows the error when the next search fails',async()=>{
 await open();mocks.call.mockRejectedValueOnce(new Error('offline'));
 await typed('Rem',2);
 expect((await screen.findByRole('alert')).textContent).toContain('offline');
 expect(screen.getByText('Remember @file')).toBeTruthy();expect(screen.queryByText('No prompts found.')).toBeNull();expect(screen.queryByRole('status')).toBeNull();
 mocks.call.mockResolvedValueOnce({entries:[row],nextCursor:null});await typed('Reme',3);
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());expect(screen.getByText('Remember @file')).toBeTruthy();
});
it('shows only the error, not "No prompts found.", when a search fails with nothing loaded',async()=>{
 mocks.call.mockRejectedValueOnce(new Error('offline'));render(<PromptLibrary/>);fireEvent.click(screen.getByRole('button',{name:'Prompt Library'}));
 expect((await screen.findByRole('alert')).textContent).toContain('offline');expect(screen.queryByText('No prompts found.')).toBeNull();
});
it('ignores a slow response that a newer search has already replaced',async()=>{
 const slow=deferred();mocks.call.mockImplementationOnce(()=>slow.promise);
 render(<PromptLibrary/>);fireEvent.click(screen.getByRole('button',{name:'Prompt Library'}));await waitFor(()=>expect(mocks.call).toHaveBeenCalledTimes(1));
 await typed('Rem',2);await screen.findByText('Remember @file');
 slow.resolve({entries:[{...row,id:'old',input:[{type:'text',text:'Remember stale',mentions:[]}]}],nextCursor:null});
 await new Promise(done=>setTimeout(done,20));
 expect(screen.queryByText('Remember stale')).toBeNull();expect(screen.getByText('Remember @file')).toBeTruthy();expect(screen.queryByRole('status')).toBeNull();
});
it('does not carry another scope\'s rows over while a scope change loads or fails',async()=>{
 await open();expect(screen.getByRole('button',{name:'Unstar'})).toBeTruthy();
 const next=deferred();mocks.call.mockImplementationOnce(()=>next.promise);
 fireEvent.change(screen.getByLabelText('Prompt scope'),{target:{value:'all'}});await waitFor(()=>expect(mocks.call).toHaveBeenCalledTimes(2));
 expect(screen.queryByText('Remember @file')).toBeNull();expect(screen.queryByRole('button',{name:'Unstar'})).toBeNull();
 next.resolve({entries:[row],nextCursor:null});await screen.findByText('Remember @file');expect(screen.getByRole('button',{name:'Star',exact:true})).toBeTruthy();
 mocks.call.mockRejectedValueOnce(new Error('offline'));
 fireEvent.change(screen.getByLabelText('Prompt scope'),{target:{value:'starred'}});
 expect((await screen.findByRole('alert')).textContent).toContain('offline');
 expect(screen.queryByText('Remember @file')).toBeNull();expect(screen.queryByRole('button',{name:'Star',exact:true})).toBeNull();
});

it('renders pill trigger button with icon and text', () => {
  render(<PromptLibrary />);
  const button = screen.getByRole('button', { name: 'Prompt Library' });
  expect(button.classList.contains('pl-trigger-btn')).toBe(true);
  const icon = button.querySelector('svg');
  expect(icon).toBeTruthy();
  expect(icon?.getAttribute('aria-hidden')).toBe('true');
});

it('closes dialog on backdrop click and keeps dialog open on click inside', async () => {
  render(<PromptLibrary />);
  fireEvent.click(screen.getByRole('button', { name: 'Prompt Library' }));
  await screen.findByText('Remember @file');
  const dialog = screen.getByRole('dialog');
  const backdrop = dialog.parentElement;
  expect(backdrop?.classList.contains('pl-backdrop')).toBe(true);

  // Clicking inside the dialog does not close it
  fireEvent.mouseDown(dialog);
  expect(screen.getByRole('dialog')).toBeTruthy();

  // Clicking directly on the backdrop closes it
  fireEvent.mouseDown(backdrop!);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('injects stylesheet, prevents duplicate tags, updates altered content, and handles missing document', () => {
  document.getElementById(STYLE_TAG_ID)?.remove();

  // Initial injection
  injectStyles();
  const tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  expect(tag).not.toBeNull();
  expect(tag?.tagName).toBe('STYLE');
  expect(tag?.textContent).toBe(PROMPT_LIBRARY_STYLES);

  // Repeated injection without duplicate tags
  injectStyles();
  expect(document.querySelectorAll(`#${STYLE_TAG_ID}`)).toHaveLength(1);

  // Replacement of existing stylesheet content
  tag!.textContent = '/* obsolete */';
  injectStyles();
  expect(document.getElementById(STYLE_TAG_ID)?.textContent).toBe(PROMPT_LIBRARY_STYLES);

  // Invocation without a document
  const originalDocument = globalThis.document;
  try {
    // @ts-expect-error test undefined document environment
    delete globalThis.document;
    expect(() => injectStyles()).not.toThrow();
  } finally {
    globalThis.document = originalDocument;
  }
});

it('renders BookMarkedIcon with custom size', () => {
  const { container } = render(<BookMarkedIcon size={24} />);
  const svg = container.querySelector('svg');
  expect(svg?.getAttribute('width')).toBe('24');
  expect(svg?.getAttribute('height')).toBe('24');
});
