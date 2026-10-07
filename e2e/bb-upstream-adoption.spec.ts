import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSqliteDatabase} from '../packages/db/src/sqlite.js';
import {test,expect} from './fixtures/app.js';
import {stubOpenDialog,stubNativeDialogs} from './sdk/native-dialog.js';
test.use({launchEnv:{ZCC_FAKE_PROVIDER:'1'},initialConfig:{sponsorPromptDismissed:true}});
async function project(app:any,name='project') {
 const path=join(app.home,name);mkdirSync(path);
 return app.window.evaluate(async path=>{const result=await window.cc.projects.add(path);if(!result.ok)throw Error(result.message);return result.value.id;},path);
}
async function thread(app:any,projectId:string,text='Library original prompt') {
 return app.window.evaluate(async({projectId,text})=>{const response=await fetch('/api/v1/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,providerId:'fake',input:[{type:'text',text,mentions:[]}]})});const body=await response.json();if(!response.ok)throw Error(JSON.stringify(body));return body.thread.id;},{projectId,text});
}
async function route(app:any,path:string) {await app.window.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'));},path);}
test('Prompt Library installs, stars scoped history, and restores structured prompts through the production plugin bridge',async({app})=>{
 const projectId=await project(app);const id=await thread(app,projectId);
 expect(await app.window.evaluate(()=>window.cc.extensions.install({kind:'bundled',id:'prompt-library'}))).toMatchObject({ok:true});
 await expect.poll(()=>app.window.evaluate(async()=>{const row=(await window.cc.pluginApps.list()).find(p=>p.id==='prompt-library');return JSON.stringify({status:row?.status,detail:row?.statusDetail,appUrl:row?.appUrl});})).toContain('"status":"running"');
 await route(app,`/threads/${id}`);
 await app.window.getByRole('button',{name:'Prompt Library',exact:true}).click();
 const dialog=app.window.getByRole('dialog',{name:'Prompt Library'});
 await dialog.getByLabel('Prompt scope').selectOption('thread');await expect(dialog).toContainText('Library original prompt');
 await dialog.getByRole('button',{name:'Star',exact:true}).click();await dialog.getByLabel('Prompt scope').selectOption('starred');await expect(dialog).toContainText('Library original prompt');
 await dialog.getByRole('button',{name:'Use prompt'}).click();await expect(app.window.getByTestId('thread-command-input')).toContainText('Library original prompt');
 await app.window.reload();await app.window.getByRole('button',{name:'Prompt Library',exact:true}).click();await expect(app.window.getByRole('dialog',{name:'Prompt Library'})).toContainText('Library original prompt');
});
test('safe mode tears down non-bundled plugins and restores enabled state while retaining storage',async({app})=>{
 const source=join(app.home,'safe-mode-plugin');mkdirSync(source);
 writeFileSync(join(source,'package.json'),JSON.stringify({name:'@zcc-ext/safe-mode-e2e',version:'0.1.0',type:'module',engines:{zcc:'>=1.0.0',zccPluginSdk:'>=0.1.0'},zcc:{name:'Safe mode fixture',description:'Lifecycle fixture',branding:{icon:'Puzzle'},server:'./server.mjs'}}));
 writeFileSync(join(source,'server.mjs'),`export default function(api){api.rpc.method('value',async()=>{const value=await api.storage.kv.get('value')??0;await api.storage.kv.set('value',value+1);return value;});}`);
 await stubOpenDialog(app.electron,[[source]]);await stubNativeDialogs(app.electron,[0,0]);
 const installed=await app.window.evaluate(()=>window.cc.extensions.install({kind:'localDir'}));
 expect(installed,JSON.stringify(installed)).toMatchObject({ok:true});
 expect(await app.window.evaluate(()=>window.cc.pluginApps.callRpc('safe-mode-e2e','value',{}))).toBe(0);
 await app.window.evaluate(()=>window.cc.config.set({pluginSafeMode:true}));
 await expect.poll(()=>app.window.evaluate(async()=>{const row=(await window.cc.pluginApps.list()).find(p=>p.id==='safe-mode-e2e');return `${row?.enabled}:${row?.status}`;})).toBe('true:disabled');
 await app.window.evaluate(()=>window.cc.config.set({pluginSafeMode:false}));
 await expect.poll(()=>app.window.evaluate(async()=>(await window.cc.pluginApps.list()).find(p=>p.id==='safe-mode-e2e')?.status)).toBe('running');
 expect(await app.window.evaluate(()=>window.cc.pluginApps.callRpc('safe-mode-e2e','value',{}))).toBe(1);
});
test('question drafts survive navigation and reload at the main-to-renderer boundary',async({app})=>{
 const projectId=await project(app);const id=await thread(app,projectId,'Question draft fixture');
 await expect.poll(()=>app.window.evaluate(async id=>(await(await fetch(`/api/v1/threads/${id}`)).json()).thread.status,id)).toBe('idle');
 const db=createSqliteDatabase(join(app.home,'.zcc','zcc.sqlite'));
 try {const now=Date.now();db.prepare(`INSERT INTO pending_interactions(id,thread_id,origin_kind,turn_id,provider_id,provider_thread_id,provider_request_id,status,payload,created_at,updated_at) VALUES(?,?,'provider','turn-question','fake',?,?,'pending',?,?,?)`).run(randomUUID(),id,'native-question',randomUUID(),JSON.stringify({kind:'user_question',questions:[{id:'first',prompt:'First draft question',options:[],multiSelect:false,allowFreeText:true},{id:'second',prompt:'Second draft question',options:[],multiSelect:false,allowFreeText:true}]}),now,now);}finally{db.close();}
 await route(app,`/threads/${id}`);await app.window.getByLabel('First draft question').fill('First saved answer');await app.window.getByRole('button',{name:'Next',exact:true}).click();await app.window.getByLabel('Second draft question').fill('Second saved answer');
 await route(app,`/projects/${projectId}`);await route(app,`/threads/${id}`);await expect(app.window.getByLabel('Second draft question')).toHaveValue('Second saved answer');await app.window.reload();await expect(app.window.getByLabel('Second draft question')).toHaveValue('Second saved answer');
});
test('message links point to a stable sequence and reload the selected message',async({app})=>{
 const projectId=await project(app);const id=await thread(app,projectId,'Permalink fixture');await route(app,`/threads/${id}`);await expect(app.window.getByTestId('thread-timeline')).toContainText('Response to: Permalink fixture');
 await app.window.locator('.thread-timeline-row.is-assistant').last().hover();
 await app.window.getByRole('button',{name:'Copy message link',exact:true}).last().click();const link=await app.electron.evaluate(({clipboard})=>clipboard.readText());expect(new URL(link).pathname).toBe(`/threads/${id}`);expect(new URL(link).searchParams.get('message')).toMatch(/^\d+$/);
 await route(app,new URL(link).pathname+new URL(link).search);await app.window.reload();await expect(app.window.getByTestId('thread-timeline')).toContainText('Response to: Permalink fixture');
});
test('reused attachments are copied before queuing and reject foreign-machine paths',async({app})=>{
 const source=await project(app,'source');const destination=await project(app,'destination');const id=await thread(app,destination,'Attachment queue');
 const attachment=await app.window.evaluate(async projectId=>{
  const form=new FormData();form.append('file',new File(['portable contents'],'notes.txt',{type:'text/plain'}));
  const response=await fetch(`/api/v1/projects/${projectId}/attachments`,{method:'POST',body:form});if(!response.ok)throw Error(await response.text());return response.json();
 },source);
 const queued=await app.window.evaluate(async ({id,source,attachment})=>{
  const response=await fetch(`/api/v1/threads/${id}/queued-messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:[{...attachment,sourceProjectId:source}]})});
  if(!response.ok)throw Error(await response.text());return response.json();
 },{id,source,attachment});
 const copied=queued.content[0];expect(copied.path).not.toBe(attachment.path);expect(copied.sourceProjectId).toBeUndefined();
 unlinkSync(join(app.home,'.zcc','attachments',source,attachment.path));
 const result=await app.window.evaluate(async ({destination,path})=>{
  const response=await fetch(`/api/v1/projects/${destination}/attachments/content?path=${encodeURIComponent(path)}`);return {status:response.status,text:await response.text()};
 },{destination,path:copied.path});expect(result).toEqual({status:200,text:'portable contents'});
 const rejected=await app.window.evaluate(async id=>{
  const response=await fetch(`/api/v1/threads/${id}/queued-messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:[{type:'localImage',path:'/tmp/foreign.png',hostId:'another-host'}]})});return {status:response.status,body:await response.json()};
 },id);expect(rejected).toMatchObject({status:400,body:{error:'attachment-host-mismatch'}});
});
