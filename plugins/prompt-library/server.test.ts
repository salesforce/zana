import {expect,it,vi} from 'vitest';
import {createFakePluginHost} from '@zana-ai/zcc-plugin-sdk/testing';
import plugin,{validatedPrompt} from './server.js';
const row=(id='a')=>({id,createdAt:1,input:[{type:'text',text:'hello',mentions:[]},{type:'localImage',path:'file.png',sourceProjectId:'p'}]});
it('validates prompt content and bounds untrusted input',()=>{
 expect(validatedPrompt(row())).toMatchObject({title:'hello',input:[{}, {sourceProjectId:'p'}]});
 for(const value of [null,{}, {id:'a',input:[]}, {...row(),input:[{type:'text',text:'x'.repeat(40000)}]}, {...row(),id:'x'.repeat(101)}, {...row(),input:[{type:'unknown'}]}]) expect(()=>validatedPrompt(value)).toThrow();
 expect(validatedPrompt({...row(),createdAt:NaN})).toHaveProperty('createdAt');expect(validatedPrompt({id:'f',input:[{type:'localFile',path:'file'}]}).title).toBe('Attachments');
});
it('serializes stars, replaces existing entries, unstars and caps storage',async()=>{
 const host=createFakePluginHost();plugin(host.zcc);const rpc=host.harness.rpc;
 await Promise.all(Array.from({length:105},(_,i)=>rpc.get('star')!(row(String(i)))));
 let list=await rpc.get('list')!({}) as {entries:unknown[]};expect(list.entries).toHaveLength(100);
 await rpc.get('star')!(row('104'));list=await rpc.get('list')!({}) as typeof list;expect(list.entries).toHaveLength(100);
 await rpc.get('remove')!({id:'104'});expect((await rpc.get('list')!({}) as typeof list).entries).toHaveLength(99);
 expect(() => rpc.get('remove')!({id:5})).toThrow();
});
it('tolerates corrupt saved values, recovers failed writes and resolves the project from a thread',async()=>{
 const host=createFakePluginHost();host.harness.kv.set('starred-prompts-v1',[null,row()]);const list=vi.fn(async(args)=>({entries:[],nextCursor:null,args}));host.zcc.sdk.experimental_promptHistory.list=list;
 host.zcc.sdk.threads.get=vi.fn(async()=>({projectId:'p'} as never));plugin(host.zcc);
 expect((await host.harness.rpc.get('list')!({}) as {entries:unknown[]}).entries).toHaveLength(1);
 await host.harness.rpc.get('history')!({scope:'project',threadId:'t'});expect(list).toHaveBeenCalledWith({scope:'project',threadId:'t',projectId:'p'});
 const set=vi.spyOn(host.zcc.storage.kv,'set').mockRejectedValueOnce(new Error('quota'));
 await expect(host.harness.rpc.get('star')!(row('b'))).rejects.toThrow('quota');await host.harness.rpc.get('star')!(row('c'));expect(set).toHaveBeenCalledTimes(2);
});
