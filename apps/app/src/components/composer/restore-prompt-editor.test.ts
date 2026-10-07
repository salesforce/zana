import {expect,it} from 'vitest';
import {promptEditorDocument} from './restore-prompt-editor.js';
import {serializePromptEditor} from './serialize-prompt-editor.js';
it('round trips text, multiple parts, mentions, and skips invalid ranges', () => {
  const resource = {kind:'thread' as const, threadId:'t',label:'Thread'};
  const input = [{type:'text' as const,text:'hi @Thread!',mentions:[{start:3,end:10,resource},{start:-2,end:4,resource},{start:20,end:30,resource}]},{type:'localImage' as const,path:'pic.png'},{type:'text' as const,text:'second',mentions:[]}];
  expect(serializePromptEditor(promptEditorDocument(input))).toEqual({text:'hi @Thread!\nsecond',mentions:[{start:3,end:10,resource}]});
  expect(serializePromptEditor(promptEditorDocument([]))).toEqual({text:'',mentions:[]});
});
