import { describe, expect, it } from 'vitest';
import { contextReferenceLocation, contextReferencePrompt, parseContextReference, parseContextReferences, validPromptReferences, relocatePromptReferences, type ContextReference } from './context-reference.js';
import { promptInputSchema, removeCommandMentionsFromPromptInput } from './shared-types.js';
const reference: ContextReference = {version: 1, label:'Passage', text:'  exact\n```code```', source:{kind:'plugin',pluginId:'notes',resourceId:'doc1',path:'intro.md',revision:'2',heading:'Intro'}};
const block = contextReferencePrompt(reference);
const refs = [{start:3,end:3+block.length,reference}];

describe('context references', () => {
  it('canonicalizes data without executing source metadata', () => {
    expect(parseContextReference({...reference, surprise:'ignored'})).toEqual(reference);
    expect(parseContextReference({version:1,label:'Log',text:'log'})).toEqual({version:1,label:'Log',text:'log'});
    expect(contextReferenceLocation(reference)).toBe('notes / doc1 / intro.md / Intro');
    expect(contextReferenceLocation({version:1,label:'Log',text:'x'})).toBe('Log');
    const file = {...reference,source:{kind:'file' as const,path:'/missing/file',startLine:2,endLine:4,projectId:'p',hostId:'h'}};
    expect(parseContextReference(file)).toEqual(file);
    expect(contextReferenceLocation(file)).toBe('/missing/file:2–4');
    expect(contextReferenceLocation({...file,source:{kind:'file',path:'/missing/file'}})).toBe('/missing/file');
    expect(block).toContain('\n````\n'+reference.text+'\n````\n');
  });
  it.each([null, [], '', {...reference,version:2}, {...reference,label:''}, {...reference,label:'a\nb'}, {...reference,text:''}, {...reference,text:'x'.repeat(100001)}, {...reference,source:null}, {...reference,source:{kind:'url'}}, {...reference,source:{kind:'file',path:''}}, {...reference,source:{kind:'file',path:'x',startLine:1}}, {...reference,source:{kind:'file',path:'x',startLine:4,endLine:2}}, {...reference,source:{kind:'file',path:'x',hostId:1}}, {...reference,source:{kind:'plugin',pluginId:'../bad/',resourceId:'d'}}, {...reference,source:{kind:'plugin',pluginId:'notes',resourceId:''}}, {...reference,source:{kind:'plugin',pluginId:'notes',resourceId:'d',heading:'a\nb'}}])('rejects invalid packets %#', value => expect(parseContextReference(value)).toBeNull());
  it('bounds aggregate count and characters', () => {
    expect(parseContextReferences([reference])).toEqual([reference]);
    expect(parseContextReferences({})).toBeNull();
    expect(parseContextReferences([null])).toBeNull();
    expect(parseContextReferences(Array(25).fill(reference))).toBeNull();
    expect(parseContextReferences(Array(5).fill({...reference,text:'x'.repeat(100000)}))).toBeNull();
  });
  it('only hides ranges matching the exact host serialization', () => {
    const text = 'Hi '+block+' end';
    expect(validPromptReferences(text,refs)).toEqual(refs);
    expect(promptInputSchema.parse({type:'text',text,mentions:[],references:refs}).references).toEqual(refs);
    for (const value of [null,{},[null],[{...refs[0],start:-1}],[{...refs[0],end:900000}],refs.concat(refs),[{...refs[0],reference:{...reference,text:'changed'}}]]) expect(validPromptReferences(text,value)).toEqual([]);
    expect(promptInputSchema.safeParse({type:'text',text:'wrong',mentions:[],references:refs}).success).toBe(false);
    expect(relocatePromptReferences(text,refs,'prefix '+text)).toEqual([{...refs[0],start:10,end:10+block.length}]);
    expect(relocatePromptReferences(text,refs,'changed')).toEqual([]);
    expect(relocatePromptReferences(text,refs,text+block)).toEqual([]);
  });
  it('shifts recorded snapshots when a command mention is removed', () => {
    const text = '/plan '+block;
    const input = promptInputSchema.parse({type:'text',text,mentions:[{start:0,end:5,resource:{kind:'command',trigger:'/',name:'plan',source:'command',origin:'builtin',label:'plan',argumentHint:null}}],references:[{start:6,end:text.length,reference}]});
    const cleaned = removeCommandMentionsFromPromptInput([input], {trigger: '/', name: 'plan'})[0]!;
    expect(promptInputSchema.safeParse(cleaned).success).toBe(true);
    expect((cleaned.type === 'text' ? cleaned.references : undefined)?.[0]?.reference).toEqual(reference);
  });
});

const annotated: ContextReference = { version: 1, label: 'Intro', text: 'Original introduction', comment: 'Shorten this.', source: { kind: 'thread', threadId: 'thread-1', messageId: 'message-2', sourceSeqEnd: 7 } };
it('validates and serializes thread annotations as immutable snapshots', () => {
 expect(parseContextReference(annotated)).toEqual(annotated);
 expect(contextReferenceLocation(annotated)).toBe('Thread thread-1 / message 7');
 expect(contextReferencePrompt(annotated)).toContain('User comment:\nShorten this.');
 const text = contextReferencePrompt(annotated);
 expect(validPromptReferences(text, [{start:0,end:text.length,reference:annotated}])).toHaveLength(1);
 for (const comment of [3, 'x'.repeat(4001), 'a\0b']) expect(parseContextReference({...annotated,comment})).toBeNull();
 for (const patch of [{threadId:''},{threadId:'a\nb'},{messageId:''},{messageId:'x'.repeat(501)},{sourceSeqEnd:0},{sourceSeqEnd:1.5}]) expect(parseContextReference({...annotated,source:{...annotated.source,...patch}})).toBeNull();
 expect(parseContextReferences(Array(4).fill({...annotated,text:'x'.repeat(100000)}))).toBeNull();
});
