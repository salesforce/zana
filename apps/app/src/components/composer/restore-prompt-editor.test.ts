import {expect,it} from 'vitest';
import {promptEditorDocument} from './restore-prompt-editor.js';
import {serializePromptEditor} from './serialize-prompt-editor.js';
it('round trips text, multiple parts, mentions, and skips invalid ranges', () => {
  const resource = {kind:'thread' as const, threadId:'t',label:'Thread'};
  const input = [{type:'text' as const,text:'hi @Thread!',mentions:[{start:3,end:10,resource},{start:-2,end:4,resource},{start:20,end:30,resource}]},{type:'localImage' as const,path:'pic.png'},{type:'text' as const,text:'second',mentions:[]}];
  expect(serializePromptEditor(promptEditorDocument(input))).toEqual({text:'hi @Thread!\nsecond',mentions:[{start:3,end:10,resource}]});
  expect(serializePromptEditor(promptEditorDocument([]))).toEqual({text:'',mentions:[]});
});

it('restores copied context as badges and preserves offsets through mode prefixes', async () => {
 const {contextReferencePrompt,validPromptReferences,promptInputSchema}=await import('@zana-ai/zcc-domain/thread-runtime');
 const {applyComposerWorkMode}=await import('../thread/pickers/composer-mode.js');
 const reference={version:1 as const,label:'Log',text:'exact snapshot'};
 const block=contextReferencePrompt(reference);
 const input={type:'text' as const,text:block+'Compare',mentions:[],references:[{start:0,end:block.length,reference}]};
 const document=promptEditorDocument([input]);
 expect(document.content?.[0]?.content?.[0]?.type).toBe('editorSelection');
 const serialized=serializePromptEditor(document);
 expect(serialized).toEqual({text:input.text,mentions:[],references:input.references});
 for(const mode of ['plan','goal'] as const) {
  const applied=applyComposerWorkMode(serialized,mode);
  expect(validPromptReferences(applied.text,applied.references)).toHaveLength(1);
  expect(promptInputSchema.safeParse({type:'text',...applied}).success).toBe(true);
 }
 expect(promptEditorDocument([{...input,references:[{...input.references[0]!,end:1}]}]).content?.[0]?.content?.[0]?.type).toBe('text');
});
